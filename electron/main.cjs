const { app, BrowserWindow, crashReporter, ipcMain, dialog, Menu, shell, nativeTheme, net, protocol, session } = require('electron');
const { appendFileSync, mkdirSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Vault, isImage } = require('./vault.cjs');
const { inlineImages, printDocument, printOptions } = require('./export.cjs');
const { docxBuffer } = require('./docx.cjs');
const { nativeImage } = require('electron');
const { TreeWatcher } = require('./watcher.cjs');

if (process.env.LABDOC_TEST_DATA) app.setPath('userData', process.env.LABDOC_TEST_DATA);
app.setName('Document');
// The app is served over app:// instead of file://. A standard scheme gives the renderer a
// real origin, so fetch() works for bundled assets and the content security policy applies.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const distDirectory = path.join(__dirname, '../dist');
const entry = 'app://document/index.html';
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
const CHROME = { dark: { color: '#262626', symbolColor: '#dadada' }, light: { color: '#f4f4f4', symbolColor: '#222222' } };
let window = null, vault = null, watcher = null, config = { vault: null, recent: [], theme: 'system' };
let closing = false, quitting = false, closeTimer = null, closeDialogOpen = false;
const configFile = () => path.join(app.getPath('userData'), 'config.json');
const logsDirectory = () => path.join(app.getPath('userData'), 'logs');

// Errors and freezes go to logs/document.log. Native crashes go to minidumps next to it.
function log(level, message) {
  try {
    mkdirSync(logsDirectory(), { recursive: true });
    const file = path.join(logsDirectory(), 'document.log');
    appendFileSync(file, `${new Date().toISOString()} [${level}] ${String(message).slice(0, 4000)}\n`);
  } catch { /* logging must never throw */ }
}
process.on('uncaughtException', error => { log('error', `main uncaught: ${error?.stack || error}`); });
process.on('unhandledRejection', reason => { log('error', `main rejection: ${reason?.stack || reason}`); });
app.on('render-process-gone', (_event, contents, details) => log('error', `renderer gone: ${details.reason} (exit ${details.exitCode})`));
app.on('child-process-gone', (_event, details) => log('error', `child process gone: ${details.type} ${details.reason}`));
try { crashReporter.start({ uploadToServer: false, submitURL: '', compress: false }); } catch { /* unavailable */ }

async function loadConfig() {
  try {
    const saved = JSON.parse(await fs.readFile(configFile(), 'utf8'));
    config = { vault: typeof saved.vault === 'string' ? saved.vault : null, recent: Array.isArray(saved.recent) ? saved.recent.filter(v => typeof v === 'string').slice(0, 10) : [], theme: ['system', 'light', 'dark'].includes(saved.theme) ? saved.theme : 'system' };
  } catch { /* first start */ }
}
async function saveConfig() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(configFile(), JSON.stringify(config, null, 2));
}
function vaultInfo() { return { vault: vault ? { path: vault.root, name: vault.name } : null, recent: config.recent, theme: config.theme, platform: process.platform }; }

// A change on disk is sent to the renderer after a short pause. The app's own writes are included.
function startWatcher() {
  watcher?.close(); watcher = null;
  if (!vault) return;
  watcher = new TreeWatcher(vault.root, changed => window?.webContents.send('vault:changed', changed));
}
async function setVault(directory) {
  if (directory) {
    await fs.mkdir(directory, { recursive: true });
    vault = new Vault(directory);
    config.vault = vault.root;
    config.recent = [vault.root, ...config.recent.filter(v => v !== vault.root)].slice(0, 10);
  } else { vault = null; config.vault = null; }
  await saveConfig();
  startWatcher();
  return vaultInfo();
}
function requireVault() { if (!vault) throw Error('No vault is open.'); return vault; }

function handle(name, callback) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame?.url !== entry) throw Error('Untrusted request.');
    return callback(...args);
  });
}
function finishClose() {
  clearTimeout(closeTimer); closing = true;
  if (quitting) app.quit(); else window?.close();
}
async function failedClose(message = 'The editor did not respond. Recent edits might not be saved.') {
  clearTimeout(closeTimer);
  if (closeDialogOpen || !window || window.isDestroyed()) return;
  closeDialogOpen = true;
  try {
    const { response } = await dialog.showMessageBox(window, { type: 'warning', title: 'Unsaved changes', message: 'The latest changes are not saved.', detail: String(message).slice(0, 2000), buttons: ['Keep open', 'Close without saving'], defaultId: 0, cancelId: 0 });
    if (response === 0) { quitting = false; return; }
    finishClose();
  } finally { closeDialogOpen = false; }
}
async function pdfBuffer(title, body, options) {
  const settings = printOptions(options);
  const html = printDocument(title, await inlineImages(body, requireVault()), settings);
  const print = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'print' } });
  print.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await print.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await print.webContents.executeJavaScript('Promise.all([document.fonts.ready, ...Array.from(document.images, i => i.decode().catch(() => {}))])');
    return await print.webContents.printToPDF({
      printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: settings.pageNumbers,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;text-align:center;font-family:${settings.font ? settings.font.replace(/[^\w -]/g, '') + ',' : ''}serif;font-size:10px;color:#333"><span class="pageNumber"></span></div>`,
    });
  } finally { print.destroy(); }
}

app.on('before-quit', () => { quitting = true; });
app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.lab86.document');
  await loadConfig();
  nativeTheme.themeSource = config.theme;
  if (config.vault) { try { await setVault(config.vault); } catch { await setVault(null); } }

  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  if (!isMac) { try { session.defaultSession.setSpellCheckerLanguages(['en-US']); } catch { /* unavailable */ } }
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(app:|file:|data:|blob:|devtools:|vault:)/.test(details.url) }));
  protocol.handle('app', request => {
    try {
      const url = new URL(request.url);
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const full = path.resolve(distDirectory, relative);
      if (full !== distDirectory && !full.startsWith(distDirectory + path.sep)) return new Response('', { status: 403 });
      return net.fetch(pathToFileURL(full).href);
    } catch { return new Response('', { status: 404 }); }
  });
  protocol.handle('vault', request => {
    try {
      const url = new URL(request.url);
      const full = requireVault().resolve(decodeURIComponent(url.pathname.replace(/^\/+/, '')));
      if (!isImage(full)) return new Response('', { status: 403 });
      return net.fetch(pathToFileURL(full).href);
    } catch { return new Response('', { status: 404 }); }
  });

  handle('app:info', () => vaultInfo());
  handle('app:log', (level, message) => log(['error', 'warn', 'info'].includes(level) ? level : 'info', `renderer: ${message}`));
  handle('app:logs', async () => { await fs.mkdir(logsDirectory(), { recursive: true }); const error = await shell.openPath(logsDirectory()); if (error) throw Error(error); });
  handle('state:read', name => requireVault().readState(name));
  handle('state:write', (name, value) => requireVault().writeState(name, value));
  // The renderer reports the effective theme so the native caption buttons match it.
  handle('app:chrome', theme => { if (isWindows && window && !window.isDestroyed()) { try { window.setTitleBarOverlay(CHROME[theme === 'light' ? 'light' : 'dark']); } catch { /* not supported */ } } });
  handle('app:theme', async theme => { if (!['system', 'light', 'dark'].includes(theme)) throw Error('Unknown theme.'); config.theme = theme; nativeTheme.themeSource = theme; await saveConfig(); });
  handle('vault:choose', async create => {
    const result = await dialog.showOpenDialog(window, { title: create ? 'Choose a folder for the new vault' : 'Open folder as vault', buttonLabel: create ? 'Create vault' : 'Open vault', defaultPath: app.getPath('documents'), properties: ['openDirectory', 'createDirectory', 'promptToCreate'] });
    if (result.canceled || !result.filePaths[0]) return null;
    return setVault(result.filePaths[0]);
  });
  handle('vault:open', async directory => {
    if (typeof directory !== 'string' || !config.recent.includes(directory)) throw Error('Unknown vault.');
    try { await fs.access(directory); } catch { config.recent = config.recent.filter(v => v !== directory); await saveConfig(); throw Error('This vault folder no longer exists.'); }
    return setVault(directory);
  });
  handle('vault:forget', async directory => { config.recent = config.recent.filter(v => v !== directory); await saveConfig(); return vaultInfo(); });
  handle('vault:close', () => setVault(null));
  handle('vault:tree', () => requireVault().tree());
  handle('vault:index', () => requireVault().index());
  handle('vault:reveal', () => shell.openPath(requireVault().root));
  handle('note:read', relative => requireVault().read(relative));
  handle('note:write', (relative, text) => requireVault().write(relative, text));
  handle('note:create', (folder, name, text, extension) => requireVault().createNote(folder, name, text, extension));
  handle('folder:create', (folder, name) => requireVault().createFolder(folder, name));
  handle('entry:rename', (from, to) => requireVault().rename(from, to));
  handle('entry:trash', relative => shell.trashItem(requireVault().resolve(relative)));
  handle('entry:reveal', relative => shell.showItemInFolder(requireVault().resolve(relative)));
  handle('attachment:import', async folder => {
    const result = await dialog.showOpenDialog(window, { title: 'Insert an image', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] }], properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    return requireVault().saveAttachment(path.basename(file), await fs.readFile(file), folder);
  });
  handle('attachment:save', (name, data, folder) => requireVault().saveAttachment(String(name), data, folder));
  handle('export:pdf', async (title, body, options) => {
    if (typeof title !== 'string' || typeof body !== 'string' || body.length > 30_000_000) throw Error('Invalid export request.');
    const result = await dialog.showSaveDialog(window, { title: 'Export to PDF', defaultPath: path.join(app.getPath('documents'), `${title.replace(/[/\\:*?"<>|]/g, '-') || 'Note'}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, await pdfBuffer(title, body, options));
    return { fileName: path.basename(result.filePath) };
  });
  handle('export:docx', async (title, text, options, imagePaths) => {
    if (typeof title !== 'string' || typeof text !== 'string' || text.length > 20_000_000) throw Error('Invalid export request.');
    const result = await dialog.showSaveDialog(window, { title: 'Export to Word', defaultPath: path.join(app.getPath('documents'), `${title.replace(/[/\\:*?"<>|]/g, '-') || 'Note'}.docx`), filters: [{ name: 'Word document', extensions: ['docx'] }] });
    if (result.canceled || !result.filePath) return null;
    const images = {};
    for (const [target, relative] of Object.entries(imagePaths && typeof imagePaths === 'object' ? imagePaths : {}).slice(0, 200)) {
      try {
        const full = requireVault().resolve(String(relative));
        if (!isImage(full) || (await fs.stat(full)).size > 25_000_000) continue;
        const picture = nativeImage.createFromPath(full);
        if (picture.isEmpty()) continue;
        const { width, height } = picture.getSize();
        const jpeg = /\.jpe?g$/i.test(full);
        images[target] = { type: jpeg ? 'jpg' : 'png', data: jpeg ? await fs.readFile(full) : picture.toPNG(), width, height };
      } catch { /* unreadable images are skipped */ }
    }
    await fs.writeFile(result.filePath, await docxBuffer(title, text, options, images));
    return { fileName: path.basename(result.filePath) };
  });
  handle('shell:external', url => {
    if (typeof url !== 'string' || !/^(https?:\/\/|mailto:)/i.test(url) || url.length > 4000) throw Error('This link cannot be opened.');
    return shell.openExternal(url);
  });
  handle('app:close-ready', finishClose);
  handle('app:close-failed', failedClose);

  function createWindow() {
    closing = false;
    if (vault && !watcher) startWatcher();
    window = new BrowserWindow({
      width: 1360, height: 900, minWidth: 760, minHeight: 500,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
      title: 'Document', icon: path.join(__dirname, '../resources/icon.png'),
      titleBarStyle: isMac ? 'hiddenInset' : isWindows ? 'hidden' : 'default',
      titleBarOverlay: isWindows ? { ...CHROME[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'], height: 40 } : undefined,
      trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
      autoHideMenuBar: !isMac,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    // A native context menu in text fields: spelling suggestions and the edit actions.
    window.webContents.on('context-menu', (_event, params) => {
      if (!params.isEditable) return;
      const template = [];
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) template.push({ label: suggestion, click: () => window?.webContents.replaceMisspelling(suggestion) });
      if (params.misspelledWord) template.push({ label: 'Add to dictionary', click: () => window?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' });
      template.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
      Menu.buildFromTemplate(template).popup({ window });
    });
    window.on('close', event => {
      if (closing) return;
      event.preventDefault(); clearTimeout(closeTimer);
      window.webContents.send('app:before-close');
      closeTimer = setTimeout(() => void failedClose(), 6000);
    });
    window.on('closed', () => { window = null; });
    window.webContents.on('render-process-gone', () => void failedClose());
    // A frozen renderer gets a dialog after a few seconds instead of a silent hang.
    let unresponsiveDialog = false;
    window.on('unresponsive', async () => {
      log('error', 'renderer unresponsive');
      if (unresponsiveDialog || !window || window.isDestroyed()) return;
      unresponsiveDialog = true;
      try {
        const { response } = await dialog.showMessageBox(window, { type: 'warning', title: 'Document is not responding', message: 'The window stopped responding.', detail: 'Wait for it to recover, or reload the window. Unsaved changes from the last second could be lost on reload.', buttons: ['Wait', 'Reload'], defaultId: 0, cancelId: 0 });
        if (response === 1 && window && !window.isDestroyed()) { log('info', 'renderer reloaded by user'); window.webContents.forcefullyCrashRenderer(); window.webContents.reload(); }
      } finally { unresponsiveDialog = false; }
    });
    window.on('responsive', () => log('info', 'renderer responsive again'));
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) log('error', `console: ${message}`); });
    window.loadURL(entry);
  }
  const command = name => () => window?.webContents.send('app:command', name);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'New note', accelerator: 'CmdOrCtrl+N', click: command('new-note') },
      { label: 'New tab', accelerator: 'CmdOrCtrl+T', click: command('new-tab') },
      { label: 'Close tab', accelerator: 'CmdOrCtrl+W', click: command('close-tab') },
      { label: 'Next tab', accelerator: 'Control+Tab', click: command('next-tab') },
      { label: 'Previous tab', accelerator: 'Control+Shift+Tab', click: command('previous-tab') },
      { label: "Open today's daily note", accelerator: 'CmdOrCtrl+D', click: command('daily-note') },
      { label: 'New folder', click: command('new-folder') },
      { label: 'Quick switcher', accelerator: 'CmdOrCtrl+O', click: command('quick-switcher') },
      { type: 'separator' },
      { label: 'Open vault…', click: command('open-vault') },
      { label: 'Export to PDF…', accelerator: 'CmdOrCtrl+Shift+E', click: command('export-pdf') },
      { label: 'Export to Word…', click: command('export-docx') },
      { label: 'Show in file manager', click: command('reveal') },
      { label: 'Show logs folder', click: command('logs') },
      { type: 'separator' },
      { label: 'Close window', accelerator: 'CmdOrCtrl+Shift+W', role: 'close' },
    ] },
    // Undo and redo go to the editor. The native roles would run the browser's own undo
    // on the editor's content and corrupt it.
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: command('undo') },
      { label: 'Redo', accelerator: isMac ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y', click: command('redo') },
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' },
      { label: 'Find in note', accelerator: 'CmdOrCtrl+F', click: command('find') },
    ] },
    { label: 'View', submenu: [
      { label: 'Command palette', accelerator: 'CmdOrCtrl+P', click: command('command-palette') },
      { label: 'Search in all notes', accelerator: 'CmdOrCtrl+Shift+F', click: command('search') },
      { type: 'separator' },
      { label: 'Toggle reading view', accelerator: 'CmdOrCtrl+E', click: command('toggle-reading') },
      { label: 'Toggle source mode', click: command('toggle-source') },
      { label: 'Toggle left sidebar', accelerator: 'CmdOrCtrl+Shift+L', click: command('toggle-left') },
      { label: 'Toggle right sidebar', accelerator: 'CmdOrCtrl+Shift+R', click: command('toggle-right') },
      { type: 'separator' },
      { label: 'Back', accelerator: 'Ctrl+Alt+Left', click: command('back') },
      { label: 'Forward', accelerator: 'Ctrl+Alt+Right', click: command('forward') },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
    ] },
    { role: 'windowMenu' },
  ]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { watcher?.close(); watcher = null; if (!isMac) app.quit(); });
