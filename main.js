const { app, BrowserWindow, ipcMain, Notification, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

let win, client = null, waStatus = 'idle', waDetail = '', lastQr = null;
let drafts = {}, sentTimes = [], timers = {}, lastMedia = {};
let pauseUntil = {}, awaySent = {}, ownIds = new Set(), blockerId = null;
function notify(title, body) { try { if (Notification.isSupported()) new Notification({ title, body }).show(); } catch {} }
function inHours() {
  const s = data.settings; if (!s.hoursEnabled) return true;
  const d = new Date(), t = d.getHours() * 60 + d.getMinutes(), cv = x => { const [h, m] = String(x).split(':'); return (+h || 0) * 60 + (+m || 0); };
  return s.hoursDays.includes(d.getDay()) && t >= cv(s.hoursStart) && t < cv(s.hoursEnd);
}
function applyPower() {
  const want = data.settings.mode === 'auto' && data.settings.keepAwake;
  if (want && blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension');
  if (!want && blockerId !== null) { powerSaveBlocker.stop(blockerId); blockerId = null; }
  try { app.setLoginItemSettings({ openAtLogin: !!data.settings.openAtLogin }); } catch {}
}
const mediaCache = new Map();   // id da mensagem -> {kind, mime, data(base64)}; só em memória
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dataFile = () => path.join(app.getPath('userData'), 'data.json');
const sessionDir = () => path.join(app.getPath('userData'), 'wa-session');

const defaults = {
  settings: { provider: 'gemini', apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gemini-2.5-flash',
    mode: 'manual', mediaToDraft: true, thinking: true, calEnabled: false, calKey: '', calUser: '', calEvent: '', calDays: 7, calTz: 'America/Sao_Paulo',
    hoursEnabled: false, hoursStart: '08:00', hoursEnd: '18:00', hoursDays: [1, 2, 3, 4, 5], awayEnabled: true, awayText: 'Olá! No momento estamos fora do horário de atendimento. Retornaremos assim que possível.',
    humanPauseMin: 30, openAtLogin: false, keepAwake: true, delayMin: 8, delayMax: 25, maxPerHour: 30, ignoreGroups: true, historySize: 20 },
  prompts: [{ id: 'default', name: 'Atendimento padrão', text: 'Você é o assistente de atendimento da minha empresa. Responda de forma educada, curta e clara, em português do Brasil. Se não souber algo, diga que um atendente humano vai continuar a conversa.' }],
  defaultPromptId: 'default', chatPrompts: {}, chatPaused: {}, chatNotes: {}, log: []
};
let data = structuredClone(defaults);
function load() {
  try { const j = JSON.parse(fs.readFileSync(dataFile(), 'utf8')); data = { ...structuredClone(defaults), ...j, settings: { ...defaults.settings, ...j.settings } }; } catch {}
}
function save() { data.log = data.log.slice(-1500); fs.writeFileSync(dataFile(), JSON.stringify(data, null, 2)); }
const send = (c, p) => win && !win.isDestroyed() && win.webContents.send(c, p);
const nameOf = id => ([...data.log].reverse().find(m => m.chatId === id) || {}).name || id;
function addLog(e) { const m = { id: crypto.randomUUID(), ts: Date.now(), ...e }; data.log.push(m); save(); send('log:new', m); return m; }
function setStatus(s, d = '') { waStatus = s; waDetail = d; if (s !== 'qr') lastQr = null; send('wa:status', { status: s, detail: d }); }

// ---------- WhatsApp ----------
// O instalador não leva um Chromium junto: usa o Chrome, Edge ou Brave já instalado no computador.
function findBrowser() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', lad = process.env.LOCALAPPDATA || '';
  const list = process.platform === 'win32'
    ? [pf86 + '\\Microsoft\\Edge\\Application\\msedge.exe', pf + '\\Microsoft\\Edge\\Application\\msedge.exe', pf + '\\Google\\Chrome\\Application\\chrome.exe', pf86 + '\\Google\\Chrome\\Application\\chrome.exe', lad + '\\Google\\Chrome\\Application\\chrome.exe']
    : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return list.find(p => fs.existsSync(p));   // undefined = usa o Chromium baixado pelo npm install (modo desenvolvimento)
}
function startWhatsApp() {
  if (client) return;
  if (app.isPackaged && !findBrowser()) return setStatus('error', 'Instale o Google Chrome (ou Microsoft Edge) para o WhatsApp funcionar.');
  setStatus('starting');
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionDir() }),
    puppeteer: { headless: true, executablePath: findBrowser(), args: ['--no-sandbox', '--disable-setuid-sandbox'] }
  });
  client.on('qr', async qr => { lastQr = await QRCode.toDataURL(qr, { margin: 1, width: 300 }); setStatus('qr'); send('wa:qr', lastQr); });
  client.on('authenticated', () => setStatus('authenticated'));
  client.on('ready', () => setStatus('ready'));
  client.on('auth_failure', m => setStatus('error', String(m)));
  client.on('disconnected', r => { setStatus('idle', String(r)); client = null; });
  client.on('message', onIncoming);
  client.on('message_create', async msg => {              // você respondeu pelo celular: entra no histórico e a IA pausa um tempo
    try {
      if (!msg.fromMe || msg.isStatus || msg.to.endsWith('@g.us')) return;
      await sleep(1500);
      if (ownIds.has(msg.id._serialized)) return;
      addLog({ chatId: msg.to, name: nameOf(msg.to), dir: 'out', text: msg.body || '[mídia]', phone: true });
      pauseUntil[msg.to] = Date.now() + data.settings.humanPauseMin * 60000;
      clearTimeout(timers[msg.to]); delete drafts[msg.to]; send('draft:clear', msg.to);
    } catch {}
  });
  client.initialize().catch(e => { setStatus('error', e.message); client = null; });
}

async function onIncoming(msg) {
  try {
    if (msg.fromMe || msg.isStatus || msg.from === 'status@broadcast') return;
    if (data.settings.ignoreGroups && msg.from.endsWith('@g.us')) return;
    const c = await msg.getContact();
    const name = c.pushname || c.name || c.number || msg.from;
    const hasText = !!(msg.body && msg.body.trim());
    const kind = msg.hasMedia ? (msg.type === 'image' ? 'image' : (msg.type === 'ptt' || msg.type === 'audio') ? 'audio' : null) : null;
    let media = null;
    if (kind && data.settings.provider === 'gemini') {      // fotos e áudios só com Gemini
      try { const d = await msg.downloadMedia(); if (d && d.data.length * 0.75 < 8e6) media = { kind, mime: (d.mimetype || '').split(';')[0], data: d.data }; } catch {}
    }
    const label = kind === 'image' ? '[foto]' : kind === 'audio' ? '[áudio]' : '[anexo ou mídia]';
    const entry = addLog({ chatId: msg.from, name, dir: 'in', text: hasText ? (kind ? label + ' ' + msg.body : msg.body) : label });
    if (media) { mediaCache.set(entry.id, media); if (mediaCache.size > 40) mediaCache.delete(mediaCache.keys().next().value); }
    if (!(hasText || media) || data.chatPaused[msg.from] || (pauseUntil[msg.from] || 0) > Date.now()) return;
    if (data.settings.mode === 'auto' && !inHours()) {       // fora do horário de atendimento
      const s = data.settings;
      if (s.awayEnabled && s.awayText && Date.now() - (awaySent[msg.from] || 0) > 12 * 3600e3) { awaySent[msg.from] = Date.now(); await sendReply(msg.from, s.awayText, true).catch(() => {}); }
      return;
    }
    if (media) lastMedia[msg.from] = true;
    clearTimeout(timers[msg.from]);               // agrupa mensagens seguidas
    timers[msg.from] = setTimeout(() => handleChat(msg.from), 4000);
  } catch (e) { send('toast', { type: 'error', text: 'Erro ao receber mensagem: ' + e.message }); }
}

async function handleChat(chatId) {
  send('chat:thinking', { chatId, on: true });
  try {
    const out = await generate(chatId);
    const viaMedia = lastMedia[chatId]; delete lastMedia[chatId];
    const hasReply = !!out.reply.trim(), auto = data.settings.mode === 'auto';
    if (!hasReply && !out.human && !out.book) { send('toast', { type: 'info', text: `A IA decidiu não responder ${nameOf(chatId)}.` }); return; }
    let done = false;
    const review = out.book || (viaMedia && data.settings.mediaToDraft);
    if (auto && hasReply && !review) done = await sendReply(chatId, out.reply, true);
    else if (auto && review) send('toast', { type: 'info', text: `A resposta para ${nameOf(chatId)} ficou como rascunho para você revisar (${out.book ? 'agendamento' : 'foto/áudio'}).` });
    if (out.human) {
      data.chatPaused[chatId] = true; save(); send('chat:paused', { chatId, paused: true });
      notify('Cliente precisa de você', nameOf(chatId) + ': a IA foi pausada nesta conversa.');
    }
    if (!done && (hasReply || out.book)) {
      drafts[chatId] = { chatId, name: nameOf(chatId), thought: out.thought, reply: out.reply, book: out.book, ts: Date.now() };
      send('draft:set', drafts[chatId]);
      if (!auto) notify('Novo rascunho de resposta', nameOf(chatId));
    }
  } catch (e) { send('toast', { type: 'error', text: `Falha com ${nameOf(chatId)}: ${e.message}` }); }
  finally { send('chat:thinking', { chatId, on: false }); }
}

async function sendReply(chatId, text, auto) {
  if (!client || waStatus !== 'ready') throw new Error('WhatsApp não está conectado.');
  const now = Date.now();
  sentTimes = sentTimes.filter(t => now - t < 3600e3);
  if (auto && sentTimes.length >= data.settings.maxPerHour) throw new Error('Limite de respostas por hora atingido. A resposta virou rascunho.');
  const chat = await client.getChatById(chatId);
  if (auto) {
    const { delayMin, delayMax } = data.settings;
    await chat.sendStateTyping();
    await sleep((delayMin + Math.random() * Math.max(0, delayMax - delayMin)) * 1000);
    if (data.settings.mode !== 'auto' || data.chatPaused[chatId] || (pauseUntil[chatId] || 0) > Date.now()) { await chat.clearState().catch(() => {}); return false; }
  }
  const sent = await client.sendMessage(chatId, text);
  try { ownIds.add(sent.id._serialized); } catch {}
  await chat.clearState().catch(() => {});
  sentTimes.push(Date.now());
  addLog({ chatId, name: nameOf(chatId), dir: 'out', text, auto });
  return true;
}

// ---------- Cal.com ----------
let slotCache = { ts: 0, text: '' };
async function calSlots(force) {
  const s = data.settings;
  if (!force && (!s.calEnabled || !s.calKey)) return '';
  if (!force && Date.now() - slotCache.ts < 120000 && slotCache.text) return slotCache.text;
  const start = new Date().toISOString(), end = new Date(Date.now() + s.calDays * 864e5).toISOString();
  const tries = [
    { v: '2024-09-04', q: { username: s.calUser, eventTypeSlug: s.calEvent, start, end, timeZone: s.calTz } },
    { v: '2024-08-13', q: { username: s.calUser, eventSlug: s.calEvent, startTime: start, endTime: end, timeZone: s.calTz } }
  ];
  let err = '';
  for (const t of tries) {
    const r = await fetch('https://api.cal.com/v2/slots?' + new URLSearchParams(t.q), { headers: { Authorization: 'Bearer ' + s.calKey, 'cal-api-version': t.v } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { err = (j.error && j.error.message) || j.message || r.statusText; continue; }
    const days = (j.data && j.data.slots) || j.data || {}, lines = [];
    for (const arr of Object.values(days)) {
      if (!Array.isArray(arr) || !arr.length) continue;
      const iso = x => x.time || x.start;
      const day = new Date(iso(arr[0])).toLocaleDateString('pt-BR', { timeZone: s.calTz, weekday: 'long', day: '2-digit', month: '2-digit' });
      lines.push(day + ': ' + arr.slice(0, 12).map(x => new Date(iso(x)).toLocaleTimeString('pt-BR', { timeZone: s.calTz, hour: '2-digit', minute: '2-digit' }) + ' = ' + iso(x)).join('; '));
    }
    slotCache = { ts: Date.now(), text: lines.join('\n') || '(nenhum horário livre nos próximos dias)' };
    return slotCache.text;
  }
  throw new Error('Cal.com: ' + err);
}
async function createBooking(b, chatId) {
  const s = data.settings;
  if (!s.calEnabled || !s.calKey) throw new Error('Configure o Cal.com em Configurações.');
  const attendee = { name: b.name, email: b.email, timeZone: s.calTz, language: 'pt' };
  if (chatId.endsWith('@c.us')) attendee.phoneNumber = '+' + chatId.split('@')[0];
  const r = await fetch('https://api.cal.com/v2/bookings', { method: 'POST',
    headers: { Authorization: 'Bearer ' + s.calKey, 'cal-api-version': '2024-08-13', 'content-type': 'application/json' },
    body: JSON.stringify({ start: b.start, eventTypeSlug: s.calEvent, username: s.calUser, attendee }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('O Cal.com não agendou: ' + ((j.error && j.error.message) || j.message || r.statusText));
  slotCache.ts = 0;
}

// ---------- IA ----------
function rules(s, slots, slotErr) {
  const keys = (s.thinking ? '"pensamento":"análise curta do que o cliente quer e do que falta", ' : '') + '"resposta":"mensagem para o cliente, vazia se não houver o que responder", "precisa_humano":false, "agendar":null';
  let f = 'REGRAS:\n- Use apenas as informações destas instruções e da conversa. Nunca invente preços, prazos ou promessas. Se não souber, diga que um atendente humano vai ajudar e marque precisa_humano como true.\n- Marque precisa_humano como true também se o cliente pedir um atendente, estiver irritado ou o assunto fugir do que você pode resolver.\n- O cliente pode enviar fotos e áudios: entenda o conteúdo e responda a ele. Se estiver ilegível, peça para reenviar.\n';
  if (s.calEnabled) {
    f += slotErr ? '\nAGENDA: não foi possível consultar a agenda agora. Não prometa horários e diga que vai confirmar em breve.\n'
      : '\nAGENDA: horários livres (formato "hora local = data ISO"):\n' + slots + '\nOfereça só horários desta lista. Antes de marcar, confirme com o cliente o horário, o nome e o e-mail (pergunte o que faltar). Quando tudo estiver confirmado, preencha "agendar":{"inicio":"<ISO exato da lista>","nome":"...","email":"..."} e escreva a confirmação em "resposta". Enquanto faltar algo, use "agendar":null.\n';
  }
  return f + '\nResponda SOMENTE com JSON válido neste formato: {' + keys + '}';
}
function parseOut(raw) {
  try {
    const j = JSON.parse(raw.replace(/```json|```/g, '').match(/\{[\s\S]*\}/)[0]);
    const b = j.agendar && j.agendar.inicio ? { inicio: String(j.agendar.inicio), nome: j.agendar.nome || '', email: j.agendar.email || '' } : null;
    return { thought: j.pensamento || '', reply: String(j.resposta || ''), human: !!j.precisa_humano, book: b };
  } catch { return { thought: '', reply: raw.trim(), human: false, book: null }; }
}
async function askAI(msgs, promptId, name, notes) {
  const s = data.settings;
  if (!s.apiKey) throw new Error('Cole sua chave de API em Configurações.');
  const p = data.prompts.find(x => x.id === (promptId || data.defaultPromptId)) || data.prompts[0];
  let slots = '', slotErr = '';
  if (s.calEnabled) { try { slots = await calSlots(); } catch (e) { slotErr = e.message; } }
  const now = new Date().toLocaleString('pt-BR', { timeZone: s.calTz, dateStyle: 'full', timeStyle: 'short' });
  const ctx = 'Agora é ' + now + '.' + (name ? '\nNome do cliente no WhatsApp: ' + name + '.' : '') + (notes ? '\nNotas sobre este cliente: ' + notes : '');
  const system = [p.text, ctx, rules(s, slots, slotErr)].join('\n\n');
  const flat = msgs.map(x => ({ role: x.role, content: x.parts.filter(q => q.text).map(q => q.text).join('\n') }));
  const raw = s.provider === 'gemini' ? await callGemini(s, system, msgs)
    : s.provider === 'anthropic' ? await callAnthropic(s, system, flat) : await callOpenAI(s, system, flat);
  return parseOut(raw);
}
async function generate(chatId) {
  const s = data.settings, msgs = [];
  for (const x of data.log.filter(x => x.chatId === chatId).slice(-s.historySize)) {
    const role = x.dir === 'in' ? 'user' : 'assistant', parts = [{ text: x.text }], md = mediaCache.get(x.id);
    if (md) parts.push({ inline_data: { mime_type: md.mime, data: md.data } });
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].parts.push(...parts);
    else msgs.push({ role, parts });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return askAI(msgs, data.chatPrompts[chatId], nameOf(chatId), data.chatNotes[chatId]);
}

async function callGemini(s, system, msgs) {
  const contents = msgs.map(x => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: x.parts }));
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(s.model) + ':generateContent', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': s.apiKey },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: 4096 } }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || r.statusText);
  const t = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  if (!t && j.promptFeedback?.blockReason) throw new Error('O Gemini bloqueou a resposta (' + j.promptFeedback.blockReason + ').');
  return t;
}
async function callAnthropic(s, system, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: s.model, max_tokens: 1024, system, messages }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || r.statusText);
  return j.content.filter(b => b.type === 'text').map(b => b.text).join('');
}
async function callOpenAI(s, system, messages) {
  const r = await fetch(s.baseUrl.replace(/\/$/, '') + '/chat/completions', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + s.apiKey },
    body: JSON.stringify({ model: s.model, messages: [{ role: 'system', content: system }, ...messages] }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || r.statusText);
  return j.choices[0].message.content || '';
}

// ---------- IPC ----------
ipcMain.handle('init', () => ({ data, waStatus, waDetail, qr: lastQr, drafts }));
ipcMain.handle('settings:save', (_e, s) => { data.settings = { ...data.settings, ...s }; save(); slotCache.ts = 0; applyPower(); return data.settings; });
ipcMain.handle('prompts:save', (_e, { prompts, defaultPromptId }) => { data.prompts = prompts; data.defaultPromptId = defaultPromptId; save(); });
ipcMain.handle('chat:setPrompt', (_e, id, pid) => { pid ? data.chatPrompts[id] = pid : delete data.chatPrompts[id]; save(); });
ipcMain.handle('chat:pause', (_e, id, v) => { v ? data.chatPaused[id] = true : (delete data.chatPaused[id], delete pauseUntil[id]); save(); });
ipcMain.handle('chat:notes', (_e, id, t) => { t ? data.chatNotes[id] = t : delete data.chatNotes[id]; save(); });
ipcMain.handle('chat:send', async (_e, id, text, book) => {
  if (book) { await createBooking(book, id); if (drafts[id]) { drafts[id].book = null; send('draft:set', drafts[id]); } send('toast', { type: 'info', text: 'Agendado no Cal.com.' }); }
  await sendReply(id, text, false); delete drafts[id]; send('draft:clear', id);
});
ipcMain.handle('cal:test', async () => {
  const s = data.settings; if (!s.calKey || !s.calUser || !s.calEvent) throw new Error('Preencha chave, usuário e tipo de evento e salve antes de testar.');
  return (await calSlots(true)).split('\n').slice(0, 3).join('\n');
});
ipcMain.handle('ai:test', (_e, { promptId, name, messages }) => askAI(messages.map(x => ({ role: x.role, parts: [{ text: x.text }] })), promptId, name || 'Cliente de teste', ''));
ipcMain.handle('draft:discard', (_e, id) => { delete drafts[id]; send('draft:clear', id); });
ipcMain.handle('draft:regenerate', (_e, id) => { handleChat(id); });
ipcMain.handle('wa:start', () => startWhatsApp());
ipcMain.handle('wa:logout', async () => {
  if (client) { try { await client.logout(); } catch {} try { await client.destroy(); } catch {} client = null; }
  setStatus('idle');
});
ipcMain.handle('log:clear', () => { data.log = []; save(); });

app.whenReady().then(() => {
  load(); applyPower();
  win = new BrowserWindow({ width: 1240, height: 800, minWidth: 980, minHeight: 640, backgroundColor: '#EDF0F1', title: 'WhatsApp IA',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.loadFile('renderer/index.html');
  if (fs.existsSync(sessionDir())) startWhatsApp();
});
app.on('window-all-closed', async () => { try { if (client) await client.destroy(); } catch {} app.quit(); });
