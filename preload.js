const { contextBridge, ipcRenderer } = require('electron');
const calls = ['init','settings:save','prompts:save','chat:setPrompt','chat:pause','chat:notes','cal:test','ai:test','chat:send','draft:discard','draft:regenerate','wa:start','wa:logout','log:clear'];
const events = ['wa:status','wa:qr','log:new','draft:set','draft:clear','chat:thinking','chat:paused','toast'];
contextBridge.exposeInMainWorld('api', {
  invoke: (c, ...a) => calls.includes(c) ? ipcRenderer.invoke(c, ...a) : Promise.reject(new Error('blocked')),
  on: (c, cb) => { if (events.includes(c)) ipcRenderer.on(c, (_e, p) => cb(p)); }
});
