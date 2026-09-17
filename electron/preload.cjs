const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('vault', {
  platform: process.platform,
  info: () => invoke('app:info'),
  setTheme: theme => invoke('app:theme', theme),
  setChrome: theme => invoke('app:chrome', theme),
  chooseVault: create => invoke('vault:choose', create),
  openVault: directory => invoke('vault:open', directory),
  forgetVault: directory => invoke('vault:forget', directory),
  closeVault: () => invoke('vault:close'),
  tree: () => invoke('vault:tree'),
  index: () => invoke('vault:index'),
  revealVault: () => invoke('vault:reveal'),
  read: relative => invoke('note:read', relative),
  write: (relative, text) => invoke('note:write', relative, text),
  createNote: (folder, name, text) => invoke('note:create', folder, name, text),
  createFolder: (folder, name) => invoke('folder:create', folder, name),
  rename: (from, to) => invoke('entry:rename', from, to),
  trash: relative => invoke('entry:trash', relative),
  reveal: relative => invoke('entry:reveal', relative),
  importImage: () => invoke('attachment:import'),
  saveAttachment: (name, data) => invoke('attachment:save', name, data),
  exportPdf: (title, html, options) => invoke('export:pdf', title, html, options),
  exportDocx: (title, text, options, images) => invoke('export:docx', title, text, options, images),
  openExternal: url => invoke('shell:external', url),
  closeReady: () => invoke('app:close-ready'),
  closeFailed: message => invoke('app:close-failed', message),
  onChanged: callback => subscribe('vault:changed', callback),
  onCommand: callback => subscribe('app:command', callback),
  onClose: callback => subscribe('app:before-close', callback),
});
