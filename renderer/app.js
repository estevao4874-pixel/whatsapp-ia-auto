const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dt = t => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const S = { data: null, wa: { status: 'idle', detail: '' }, qr: null, drafts: {}, thinking: {}, view: 'chats', active: null, prompt: null, compose: '', test: { msgs: [], prompt: '', busy: false } };

function toast(text, type = 'info') {
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = text;
  $('#toasts').append(t); setTimeout(() => t.remove(), 6000);
}
const call = (...a) => api.invoke(...a).catch(e => { toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error'); });

const STATUS = { idle: ['Desconectado', ''], starting: ['Iniciando…', 'warn'], qr: ['Aguardando QR Code', 'warn'], authenticated: ['Autenticado…', 'warn'], ready: ['WhatsApp conectado', 'ok'], error: ['Erro de conexão', 'bad'] };
function chats() {
  const map = {};
  for (const m of S.data.log) map[m.chatId] = { id: m.chatId, name: m.name, last: m };
  for (const d of Object.values(S.drafts)) if (!map[d.chatId]) map[d.chatId] = { id: d.chatId, name: d.name, last: { text: '', ts: d.ts } };
  return Object.values(map).sort((a, b) => b.last.ts - a.last.ts);
}

function renderChrome() {
  const [label, cls] = STATUS[S.wa.status] || STATUS.idle;
  const p = $('#wa-pill'); p.textContent = label; p.className = 'pill ' + cls;
  document.querySelectorAll('.mode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === S.data.settings.mode)));
  document.querySelectorAll('#rail button').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
  const n = Object.keys(S.drafts).length; $('#badge').hidden = !n; $('#badge').textContent = n;
}

function connectCard() {
  const st = S.wa.status;
  let body = '<p>Conecte o WhatsApp para começar. Você vai escanear um QR Code com o celular.</p><button class="btn p" data-act="wa-start">Conectar WhatsApp</button>';
  if (st === 'starting' || st === 'authenticated') body = '<p>' + (st === 'starting' ? 'Abrindo o WhatsApp… isso pode levar alguns segundos.' : 'Autenticado. Carregando conversas…') + '</p>';
  if (st === 'qr' && S.qr) body = '<p>No celular, abra WhatsApp → Aparelhos conectados → Conectar um aparelho e escaneie:</p><img class="qr" alt="QR Code do WhatsApp" src="' + S.qr + '">';
  if (st === 'error') body = '<p>Não foi possível conectar: ' + esc(S.wa.detail) + '</p><button class="btn p" data-act="wa-start">Tentar de novo</button>';
  return '<div class="empty">' + body + '</div>';
}

function viewChats() {
  const list = chats();
  if (!list.length) return S.wa.status === 'ready' ? '<div class="empty">Nenhuma conversa ainda. As mensagens recebidas aparecem aqui.</div>' : connectCard();
  if (!S.active || !list.find(c => c.id === S.active)) S.active = list[0].id;
  const items = list.map(c => '<button class="item ' + (c.id === S.active ? 'on' : '') + '" data-act="open" data-id="' + esc(c.id) + '"><b>' + (S.drafts[c.id] ? '<span class="dot" title="Rascunho aguardando"></span>' : '') + esc(c.name) + '</b><small>' + (S.data.chatPaused[c.id] ? 'IA pausada · ' : '') + esc(c.last.text) + '</small></button>').join('');
  const id = S.active, c = list.find(x => x.id === id), d = S.drafts[id];
  const msgs = S.data.log.filter(m => m.chatId === id).slice(-200).map(m => '<div class="m ' + m.dir + '">' + esc(m.text) + '<small>' + hhmm(m.ts) + (m.auto ? ' · IA' : '') + (m.phone ? ' · celular' : '') + '</small></div>').join('');
  const opts = '<option value="">Prompt padrão</option>' + S.data.prompts.map(p => '<option value="' + esc(p.id) + '"' + (S.data.chatPrompts[id] === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
  const paused = !!S.data.chatPaused[id];
  const bk = d && d.book ? '<div class="book"><b>Agendamento sugerido: ' + esc(fmtSlot(d.book.inicio)) + '</b><div class="row" style="margin-top:6px"><input type="text" id="bk-name" class="grow" placeholder="Nome" value="' + esc(d.book.nome) + '"><input type="text" id="bk-email" class="grow" placeholder="E-mail do cliente" value="' + esc(d.book.email) + '"></div></div>' : '';
  const draft = d ? '<div class="draft"><h3>Rascunho da IA</h3>' + (d.thought ? '<details><summary>Como a IA pensou</summary>' + esc(d.thought) + '</details>' : '') + '<textarea id="draft-text" aria-label="Rascunho">' + esc(d.reply) + '</textarea>' + bk + '<div class="row" style="margin-top:8px"><button class="btn p" data-act="send-draft">' + (d.book ? 'Enviar e agendar' : 'Enviar') + '</button><button class="btn" data-act="regen">Gerar de novo</button><button class="btn d" data-act="discard">Descartar</button></div></div>' : '';
  return '<div class="split"><div class="list">' + items + '</div><section class="conv"><div class="conv-h"><strong>' + esc(c.name) + '</strong><select id="chat-prompt" style="width:auto" aria-label="Prompt desta conversa">' + opts + '</select><button class="btn" data-act="pause">' + (paused ? 'Retomar IA' : 'Pausar IA') + '</button></div><details class="notes"' + (S.data.chatNotes[id] ? ' open' : '') + '><summary>Notas sobre este cliente</summary><textarea id="chat-notes" rows="3" placeholder="Ex.: cliente antigo, prefere atendimento à tarde">' + esc(S.data.chatNotes[id] || '') + '</textarea></details><div class="msgs" id="msgs">' + msgs + '</div>' + (S.thinking[id] ? '<div class="think">A IA está pensando…</div>' : '') + draft + '<div class="composer row"><textarea id="compose" class="grow" rows="2" placeholder="Escreva você mesmo uma resposta">' + esc(S.compose) + '</textarea><button class="btn p" data-act="send-own">Enviar</button></div></section></div>';
}

function viewPrompts() {
  const ps = S.data.prompts; if (!S.prompt || !ps.find(p => p.id === S.prompt)) S.prompt = ps[0]?.id;
  const p = ps.find(x => x.id === S.prompt);
  const items = ps.map(x => '<button class="item ' + (x.id === S.prompt ? 'on' : '') + '" data-act="pick-prompt" data-id="' + esc(x.id) + '"><b>' + esc(x.name) + '</b><small>' + (x.id === S.data.defaultPromptId ? 'Padrão' : '') + '</small></button>').join('');
  const ed = p ? '<label for="p-name">Nome</label><input type="text" id="p-name" value="' + esc(p.name) + '"><label for="p-text">Instruções para a IA</label><textarea id="p-text" rows="14">' + esc(p.text) + '</textarea><p class="hint">Descreva quem é a empresa, o tom de voz, preços, horários, regras e o que fazer quando não souber. A IA usa isto como base em toda resposta.</p><div class="check"><input type="checkbox" id="p-def" ' + (p.id === S.data.defaultPromptId ? 'checked' : '') + '><label for="p-def" style="margin:0;font-weight:400">Usar como padrão</label></div><div class="row" style="margin-top:14px"><button class="btn p" data-act="save-prompt">Salvar prompt</button><button class="btn d" data-act="del-prompt">Excluir</button></div>' : '';
  return '<div class="split prompts"><div class="list">' + items + '<button class="item" data-act="new-prompt"><b>+ Novo prompt</b></button></div><div class="page">' + ed + '</div></div>';
}

function viewLog() {
  const rows = [...S.data.log].reverse().slice(0, 300).map(m => '<tr><td>' + dt(m.ts) + '</td><td>' + esc(m.name) + '</td><td><span class="tag ' + (m.auto ? 'auto' : '') + '">' + (m.dir === 'in' ? 'Recebida' : m.auto ? 'Automática' : m.phone ? 'Você (celular)' : 'Enviada por você') + '</span></td><td>' + esc(m.text) + '</td></tr>').join('');
  return '<div class="page log" style="max-width:none"><div class="row"><h2 class="grow">Registro de mensagens</h2><button class="btn d" data-act="clear-log">Limpar registro</button></div>' + (rows ? '<table><thead><tr><th>Quando</th><th>Contato</th><th>Tipo</th><th>Mensagem</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="hint">Nada registrado ainda.</p>') + '</div>';
}

const fmtSlot = iso => new Date(iso).toLocaleString('pt-BR', { timeZone: S.data.settings.calTz, weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function viewSettings() {
  const s = S.data.settings;
  const hint = h => h ? '<p class="hint">' + h + '</p>' : '';
  const num = (id, v, l, h) => '<label for="' + id + '">' + l + '</label><input type="number" id="' + id + '" value="' + v + '" min="0">' + hint(h);
  const txt = (id, v, l, t, h) => '<label for="' + id + '">' + l + '</label><input type="' + (t || 'text') + '" id="' + id + '" value="' + esc(v) + '" autocomplete="off">' + hint(h);
  const ck = (id, v, l) => '<div class="check"><input type="checkbox" id="' + id + '" ' + (v ? 'checked' : '') + '><label for="' + id + '" style="margin:0;font-weight:400">' + l + '</label></div>';
  const opt = (v, l) => '<option value="' + v + '"' + (s.provider === v ? ' selected' : '') + '>' + l + '</option>';
  return '<div class="page"><h2>Configurações</h2>' +
    '<h3>Inteligência artificial</h3><label for="s-prov">Provedor de IA</label><select id="s-prov">' + opt('gemini', 'Gemini (Google) — entende fotos e áudios') + opt('anthropic', 'Claude (Anthropic) — só texto') + opt('openai', 'OpenAI ou compatível — só texto') + '</select>' +
    txt('s-key', s.apiKey, 'Chave de API', 'password', 'Fica salva só neste computador.') + txt('s-url', s.baseUrl, 'Endereço da API (só para OpenAI ou compatível)') + txt('s-model', s.model, 'Modelo') +
    ck('s-think', s.thinking, 'Mostrar como a IA pensou (análise curta no rascunho)') + ck('s-groups', s.ignoreGroups, 'Ignorar grupos') + num('s-hist', s.historySize, 'Mensagens de histórico enviadas à IA') +
    '<h3>Respostas automáticas</h3>' + num('s-dmin', s.delayMin, 'Espera mínima antes de responder (segundos)') + num('s-dmax', s.delayMax, 'Espera máxima (segundos)') + num('s-max', s.maxPerHour, 'Limite de respostas automáticas por hora') +
    ck('s-media', s.mediaToDraft, 'Respostas a fotos e áudios viram rascunho para eu revisar, mesmo no modo autônomo') +
    '<h3>Quando você assume a conversa</h3>' + num('s-hpm', s.humanPauseMin, 'Pausar a IA por quantos minutos depois que você responde pelo celular', 'Com 0, a IA continua respondendo. Quando a IA pede um atendente humano, ela pausa naquela conversa até você clicar em Retomar IA.') +
    '<h3>Horário de atendimento</h3>' + ck('s-hours', s.hoursEnabled, 'Só responder automaticamente dentro do horário') + txt('s-hstart', s.hoursStart, 'Início (ex.: 08:00)') + txt('s-hend', s.hoursEnd, 'Fim (ex.: 18:00)') +
    txt('s-hdays', s.hoursDays.join(','), 'Dias da semana (0 = domingo … 6 = sábado)', 'text', 'Ex.: 1,2,3,4,5 para segunda a sexta.') + ck('s-away', s.awayEnabled, 'Enviar um aviso fora do horário (uma vez a cada 12 horas por contato)') + txt('s-awaytext', s.awayText, 'Texto do aviso', 'text', 'Vale só no modo autônomo. No modo "Você revisa" a IA sempre prepara rascunhos.') +
    '<h3>Agenda (Cal.com)</h3>' + ck('s-cal', s.calEnabled, 'A IA consulta os horários livres e sugere agendamentos') + txt('s-calkey', s.calKey, 'Chave de API do Cal.com', 'password', 'Crie em Settings → Developer → API Keys no Cal.com.') +
    txt('s-caluser', s.calUser, 'Seu usuário no Cal.com', 'text', 'É a parte que aparece em cal.com/SEU-USUARIO.') + txt('s-calevent', s.calEvent, 'Tipo de evento', 'text', 'A parte final do link do evento, por exemplo "consulta-30min".') +
    num('s-caldays', s.calDays, 'Quantos dias à frente consultar') + txt('s-caltz', s.calTz, 'Fuso horário', 'text', 'Ex.: America/Sao_Paulo.') +
    '<div class="row" style="margin-top:10px"><button class="btn" data-act="cal-test">Testar conexão com o Cal.com</button></div>' + hint('Salve as configurações antes de testar. Agendamentos sempre passam pela sua aprovação.') +
    '<h3>Computador</h3>' + ck('s-awake', s.keepAwake, 'Manter o computador acordado no modo autônomo') + ck('s-login', s.openAtLogin, 'Abrir o app quando o computador ligar') +
    '<div class="row" style="margin:18px 0 30px"><button class="btn p" data-act="save-settings">Salvar configurações</button><button class="btn" data-act="wa-start">Conectar WhatsApp</button><button class="btn d" data-act="wa-logout">Desconectar</button></div></div>';
}

function viewTest() {
  const t = S.test, opts = S.data.prompts.map(p => '<option value="' + esc(p.id) + '"' + ((t.prompt || S.data.defaultPromptId) === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
  const bub = t.msgs.map(m => m.role === 'user' ? '<div class="m">' + esc(m.text) + '</div>' :
    '<div class="m out">' + esc(m.text || '(sem resposta)') + (m.thought ? '<details><summary>Como a IA pensou</summary>' + esc(m.thought) + '</details>' : '') +
    (m.book ? '<small>Agendaria: ' + esc(fmtSlot(m.book.inicio)) + ' — ' + esc(m.book.nome) + ' ' + esc(m.book.email) + '</small>' : '') + (m.human ? '<small>A IA chamaria um atendente humano.</small>' : '') + '</div>').join('');
  return '<div class="conv" style="height:100%"><div class="conv-h"><strong>Testar a IA — nada é enviado no WhatsApp</strong><select id="t-prompt" style="width:auto" aria-label="Prompt">' + opts + '</select><button class="btn" data-act="test-clear">Limpar</button></div><div class="msgs" id="msgs">' +
    (bub || '<div class="empty">Escreva como se fosse um cliente e veja como a IA responde com o prompt e a agenda atuais.</div>') + '</div>' + (t.busy ? '<div class="think">A IA está pensando…</div>' : '') +
    '<div class="composer row"><textarea id="t-text" class="grow" rows="2" placeholder="Mensagem do cliente"></textarea><button class="btn p" data-act="test-send">Enviar</button></div></div>';
}

function render() {
  renderChrome();
  const v = { chats: viewChats, prompts: viewPrompts, log: viewLog, test: viewTest, settings: viewSettings }[S.view]();
  const m = $('#main'); m.innerHTML = v;
  const box = $('#msgs'); if (box) box.scrollTop = box.scrollHeight;
}

async function setMode(mode) {
  if (mode === 'auto' && !confirm('No modo autônomo a IA responde sozinha aos clientes, sem sua revisão. Ativar?')) return;
  S.data.settings = await call('settings:save', { mode }) || S.data.settings; render();
}
const val = id => $('#' + id).value, chk = id => $('#' + id).checked;
const acts = {
  open: t => { S.active = t.dataset.id; render(); },
  'wa-start': () => call('wa:start'), 'wa-logout': () => call('wa:logout'),
  pause: async () => { await call('chat:pause', S.active, !S.data.chatPaused[S.active]); S.data.chatPaused[S.active] ? delete S.data.chatPaused[S.active] : S.data.chatPaused[S.active] = true; render(); },
  'send-draft': async () => {
    const d = S.drafts[S.active]; let book = null;
    if (d && d.book) { const name = val('bk-name').trim(), email = val('bk-email').trim(); if (!name || !email.includes('@')) return toast('Preencha o nome e o e-mail do cliente para agendar.', 'error'); book = { start: d.book.inicio, name, email }; }
    await call('chat:send', S.active, val('draft-text'), book); render();
  },
  'test-send': async () => {
    const text = $('#t-text').value.trim(); if (!text || S.test.busy) return;
    S.test.msgs.push({ role: 'user', text }); S.test.busy = true; render();
    const out = await call('ai:test', { promptId: S.test.prompt || S.data.defaultPromptId, messages: S.test.msgs.map(m => ({ role: m.role, text: m.text })) });
    S.test.busy = false; if (out) S.test.msgs.push({ role: 'assistant', text: out.reply, thought: out.thought, book: out.book, human: out.human }); render();
  },
  'test-clear': () => { S.test.msgs = []; render(); },
  'cal-test': async () => { const r = await call('cal:test'); if (r) toast('Cal.com conectado. Primeiros horários livres:\n' + r); },
  'send-own': async () => { const t = val('compose').trim(); if (!t) return; S.compose = ''; await call('chat:send', S.active, t); render(); },
  regen: () => call('draft:regenerate', S.active), discard: () => call('draft:discard', S.active),
  'pick-prompt': t => { S.prompt = t.dataset.id; render(); },
  'new-prompt': async () => { const p = { id: crypto.randomUUID(), name: 'Novo prompt', text: '' }; S.data.prompts.push(p); S.prompt = p.id; await call('prompts:save', { prompts: S.data.prompts, defaultPromptId: S.data.defaultPromptId }); render(); },
  'save-prompt': async () => { const p = S.data.prompts.find(x => x.id === S.prompt); p.name = val('p-name') || 'Sem nome'; p.text = val('p-text'); if (chk('p-def')) S.data.defaultPromptId = p.id; await call('prompts:save', { prompts: S.data.prompts, defaultPromptId: S.data.defaultPromptId }); toast('Prompt salvo.'); render(); },
  'del-prompt': async () => { if (S.data.prompts.length < 2) return toast('Mantenha pelo menos um prompt.', 'error'); if (!confirm('Excluir este prompt?')) return; S.data.prompts = S.data.prompts.filter(x => x.id !== S.prompt); if (S.data.defaultPromptId === S.prompt) S.data.defaultPromptId = S.data.prompts[0].id; await call('prompts:save', { prompts: S.data.prompts, defaultPromptId: S.data.defaultPromptId }); render(); },
  'clear-log': async () => { if (!confirm('Apagar todo o registro?')) return; await call('log:clear'); S.data.log = []; render(); },
  'save-settings': async () => { S.data.settings = await call('settings:save', { provider: val('s-prov'), apiKey: val('s-key').trim(), baseUrl: val('s-url').trim(), model: val('s-model').trim(), thinking: chk('s-think'), ignoreGroups: chk('s-groups'), mediaToDraft: chk('s-media'), humanPauseMin: +val('s-hpm'), hoursEnabled: chk('s-hours'), hoursStart: val('s-hstart').trim(), hoursEnd: val('s-hend').trim(), hoursDays: val('s-hdays').split(',').map(x => parseInt(x)).filter(x => x >= 0 && x <= 6), awayEnabled: chk('s-away'), awayText: val('s-awaytext'), calEnabled: chk('s-cal'), calKey: val('s-calkey').trim(), calUser: val('s-caluser').trim(), calEvent: val('s-calevent').trim(), calDays: +val('s-caldays') || 7, calTz: val('s-caltz').trim() || 'America/Sao_Paulo', keepAwake: chk('s-awake'), openAtLogin: chk('s-login'), delayMin: +val('s-dmin'), delayMax: +val('s-dmax'), maxPerHour: +val('s-max'), historySize: +val('s-hist') }); toast('Configurações salvas.'); render(); }
};
document.addEventListener('click', e => {
  const m = e.target.closest('.mode button'); if (m) return setMode(m.dataset.mode);
  const n = e.target.closest('#rail button'); if (n) { S.view = n.dataset.view; return render(); }
  const a = e.target.closest('[data-act]'); if (a && acts[a.dataset.act]) acts[a.dataset.act](a);
});
document.addEventListener('input', e => {
  if (e.target.id === 'compose') S.compose = e.target.value;
  if (e.target.id === 'draft-text' && S.drafts[S.active]) S.drafts[S.active].reply = e.target.value;
  if (e.target.id === 'bk-name' && S.drafts[S.active]) S.drafts[S.active].book.nome = e.target.value;
  if (e.target.id === 'bk-email' && S.drafts[S.active]) S.drafts[S.active].book.email = e.target.value;
  if (e.target.id === 'chat-notes') S.data.chatNotes[S.active] = e.target.value;
});
document.addEventListener('change', async e => {
  if (e.target.id === 't-prompt') S.test.prompt = e.target.value;
  if (e.target.id === 'chat-notes') await call('chat:notes', S.active, e.target.value.trim());
  if (e.target.id === 'chat-prompt') { await call('chat:setPrompt', S.active, e.target.value); e.target.value ? S.data.chatPrompts[S.active] = e.target.value : delete S.data.chatPrompts[S.active]; } });

api.on('wa:status', p => { S.wa = p; render(); });
api.on('wa:qr', q => { S.qr = q; render(); });
api.on('log:new', m => { S.data.log.push(m); render(); });
api.on('draft:set', d => { S.drafts[d.chatId] = d; render(); });
api.on('draft:clear', id => { delete S.drafts[id]; render(); });
api.on('chat:thinking', p => { p.on ? S.thinking[p.chatId] = true : delete S.thinking[p.chatId]; render(); });
api.on('chat:paused', p => { p.paused ? S.data.chatPaused[p.chatId] = true : delete S.data.chatPaused[p.chatId]; render(); });
api.on('toast', t => toast(t.text, t.type));
api.invoke('init').then(r => { S.data = r.data; S.wa = { status: r.waStatus, detail: r.waDetail }; S.qr = r.qr; S.drafts = r.drafts; render(); });
