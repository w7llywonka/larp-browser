'use strict';
const { app, BaseWindow, WebContentsView, Menu, ipcMain, session, dialog, shell, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { destination, splitCommand, unquote, safeWebURL, tabIndex, ENGINES } = require('./core');
const { preferences } = require('./preferences');

const testing = !app.isPackaged && process.argv.includes('--self-test');
const smokeTesting = process.argv.includes('--smoke-test');
if (testing) app.disableHardwareAcceleration();
if (testing || smokeTesting) process.on('uncaughtException', error => { console.error(error); app.exit(1); });
app.setName('PowerShell Browser');
app.setPath('userData', testing ? path.join(__dirname, 'test-profile-' + process.pid) : smokeTesting ? (process.env.PSB_SMOKE_PROFILE || path.join(os.tmpdir(), 'PowerShell-Browser-Smoke-' + process.pid)) : path.join(app.getPath('appData'), 'PowerShell Browser'));
const controllers = new Map();
const retiredShells = new WeakSet();
const sessions = new WeakSet();
let store;
let storeFile;
let saveTimer;
let downloadCounter = 0;
let updates;
const liveDownloads = new Map();
const ownsInstance = testing || smokeTesting || app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
else if (!testing && !smokeTesting) app.on('second-instance', (_event, args) => {
  const browser = [...controllers.values()].find(c => !c.private) || [...controllers.values()][0];
  if (!browser || browser.win.isDestroyed()) return;
  if (browser.win.isMinimized()) browser.win.restore();
  browser.win.show(); browser.win.focus();
  const address = args.find(value => /^https?:\/\//i.test(value));
  if (address) { try { browser.addTab(destination(address, store.search)); } catch (error) { browser.showConsole(); browser.output(error.message, 'error'); } }
});
const HELP = `Browser commands (these are browser commands, not actual PowerShell):

  open <address>          Open a website; a bare address also works
  search <words>          Search the web; plain words also work
  back / forward         Move through the current tab's history
  reload / stop          Reload or stop loading
  tabs                   List tabs with their numbers
  tab <number>           Switch to a tab
  tab <title or domain>  Switch by name; tab next / prev also work
  new [address]          Open a new tab (also: tab new)
  close [number]         Close a tab (also: tab close)
  tab remove 1 2 3       Close multiple tabs using their original numbers
  reopen                 Reopen the last closed tab with its history
  restore                Reopen your saved regular tabs
  history [words]        List or filter browsing history
  history clear          Clear regular browsing history
  bookmark [name]        Bookmark the current website
  bookmarks              List numbered bookmarks
  bookmark open <n>      Open a numbered bookmark
  bookmark remove <n>    Remove a numbered bookmark
  downloads              List download progress and saved paths
  download <verb> <n>    open, show, pause, resume, or cancel a download
  private                Open a private window
  window                 Open another regular window
  site                   Show the current URL and connection type
  status                 Show current tab, loading state, zoom, and audio
  find <words>           Find text in the page
  find next / prev       Move between matches; find clear ends search
  zoom <percent>         Set page zoom (25 through 500)
  font <pixels>          Set console font size (12 through 32)
  settings               Show preferences
  update                 Check for a newer installed edition
  update status          Show update progress and automatic update setting
  update download        Download an available update manually
  update install         Apply a downloaded update and restart
  settings updates off   Disable automatic downloads and installation
  settings search <name> Choose duckduckgo, google, or bing
  save                   Save the current page as HTML
  print                  Print the current page
  mute                   Toggle audio for the current tab
  home                   Return to the console
  clear / cls            Clear console output
  exit                   Close this window

Keyboard shortcuts:
  Ctrl+L / Alt+D         Bring up the prompt with the current URL
  Escape                 Return to the page from an empty prompt
  Ctrl+T / Ctrl+W        New tab / close tab
  Ctrl+Shift+T           Reopen the last closed tab
  Ctrl+Shift+A / F2      Show the tab list in the console
  Ctrl+1 through Ctrl+8  Switch directly to a tab; Ctrl+9 selects last
  Ctrl+Tab               Next tab (Ctrl+Shift+Tab goes backward)
  Alt+Left / Alt+Right   Back / forward
  F5 / Ctrl+R            Reload (Ctrl+Shift+R bypasses cache)
  Ctrl+D                 Bookmark this page
  Ctrl+H / Ctrl+J        History / downloads
  Ctrl+F                 Bring up the find command
  Ctrl+Shift+N           Private window
  Ctrl++ / Ctrl+- / Ctrl+0  Page zoom
  Ctrl+S / Ctrl+P        Save / print
  F11                    Full screen
  Up / Down              Recall console commands
  Tab / Shift+Tab        Cycle command, tab, bookmark, and URL completions`;

function writeStore() {
  if (!storeFile) return;
  try {
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    fs.writeFileSync(storeFile + '.tmp', JSON.stringify(store, null, 2));
    fs.renameSync(storeFile + '.tmp', storeFile);
  } catch (error) { console.error('Could not save browser data:', error.message); }
}
function saveStore() { clearTimeout(saveTimer); saveTimer = setTimeout(writeStore, 250); }
function loadStore() {
  storeFile = path.join(app.getPath('userData'), 'browser-data.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(storeFile, 'utf8')); } catch {}
  store = {
    history: Array.isArray(saved.history) ? saved.history.slice(-2000) : [],
    bookmarks: Array.isArray(saved.bookmarks) ? saved.bookmarks.filter(b => safeWebURL(b.url)) : [],
    downloads: Array.isArray(saved.downloads) ? saved.downloads.slice(-100) : [],
    tabs: Array.isArray(saved.tabs) ? saved.tabs.filter(safeWebURL).slice(0, 100) : [],
    fontSize: Number.isInteger(saved.fontSize) && saved.fontSize >= 12 && saved.fontSize <= 32 ? saved.fontSize : 16,
    search: ENGINES[saved.search] ? saved.search : 'duckduckgo',
    preferences: preferences({ fontSize: saved.fontSize, search: saved.search, ...saved.preferences }),
    setupComplete: saved.setupComplete === true,
    note: typeof saved.note === 'string' ? saved.note.slice(0, 1048576) : '',
    workspaces: Array.isArray(saved.workspaces) ? saved.workspaces.filter(w => typeof w.name === 'string' && Array.isArray(w.tabs)).slice(0, 100) : []
  };
  downloadCounter = store.downloads.reduce((max, d) => Math.max(max, Number(d.id) || 0), 0);
}
function controllerFor(wc) {
  for (const c of controllers.values()) if (c.shellView.webContents === wc || c.tabs.some(t => t.view.webContents === wc)) return c;
}
function configureSession(ses) {
  if (sessions.has(ses)) return;
  sessions.add(ses);
  const grants = new Set();
  ses.setPermissionCheckHandler((_wc, permission, origin) => ['fullscreen', 'sanitized-clipboard-write'].includes(permission) || grants.has(origin + ':' + permission));
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (['fullscreen', 'sanitized-clipboard-write'].includes(permission)) return callback(true);
    const c = controllerFor(wc);
    if (!c || c.win.isDestroyed() || !['media', 'geolocation', 'notifications', 'clipboard-read', 'pointerLock'].includes(permission)) return callback(false);
    let origin;
    try { origin = new URL(details.requestingUrl || wc.getURL()).origin; } catch { return callback(false); }
    if (grants.has(origin + ':' + permission)) return callback(true);
    try {
      const result = await dialog.showMessageBox(c.win, { type: 'question', title: 'Website permission', message: origin + ' requests ' + permission + ' access.', buttons: ['Deny', 'Allow'], defaultId: 0, cancelId: 0 });
      if (result.response === 1) grants.add(origin + ':' + permission);
      callback(result.response === 1);
    } catch { callback(false); }
  });
  ses.on('will-download', (_event, item, wc) => {
    const c = controllerFor(wc);
    if (!c) { item.cancel(); return; }
    const record = { id: ++downloadCounter, name: item.getFilename(), url: item.getURL(), path: '', state: 'progressing', received: 0, total: item.getTotalBytes(), time: Date.now() };
    c.downloads.push(record);
    if (!c.private) { if (c.downloads.length > 100) c.downloads.shift(); saveStore(); }
    liveDownloads.set(record.id, item);
    if (testing) {
      const folder = path.join(app.getPath('userData'), 'test-downloads');
      fs.mkdirSync(folder, { recursive: true });
      item.setSavePath(path.join(folder, path.basename(item.getFilename())));
    } else item.setSaveDialogOptions({ title: 'Save download', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
    const update = state => {
      record.state = state;
      record.received = item.getReceivedBytes();
      record.total = item.getTotalBytes();
      record.path = item.getSavePath();
      if (!c.private) saveStore();
    };
    item.on('updated', (_e, state) => update(item.isPaused() ? 'paused' : state));
    item.once('done', (_e, state) => {
      update(state); liveDownloads.delete(record.id);
      c.output('Download ' + record.id + ': ' + record.name + ' [' + state + ']' + (record.path ? '\n' + record.path : ''), state === 'completed' ? '' : 'warning');
      const owner = !c.win.isDestroyed() ? c : [...controllers.values()].find(other => other.ses === ses);
      if (owner) { owner.recordEvent('download', record.name + ' [' + state + ']'); if (state === 'completed') owner.downloadNotice(record.name); }
    });
  });
}

class BrowserController {
  constructor(isPrivate = false, visible = true, options = {}) {
    this.private = isPrivate;
    this.visible = visible;
    this.consoleRole = options.role === 'browser' ? false : store.preferences.consoleWindow;
    this.controlHub = options.hub || this;
    this.events = [];
    this.disguised = false;
    this.editorVisible = false;
    this.setupOpen = !isPrivate && options.role !== 'browser' && !store.setupComplete;
    this.settingsMenu = false;
    this.splitTab = null;
    this.splitRatio = 50;
    this.noteState = options.noteState || { text: '' };
    this.tabs = [];
    this.active = -1;
    this.attached = null;
    this.consoleVisible = true;
    this.nextTabId = 1;
    this.closedTabs = options.closedTabs || [];
    this.history = options.history || (isPrivate ? [] : store.history);
    this.downloads = options.downloads || (isPrivate ? [] : store.downloads);
    this.ses = options.session || session.fromPartition(isPrivate ? 'private-' + Date.now() + '-' + Math.random().toString(36).slice(2) : 'persist:browser');
    configureSession(this.ses);
    this.win = new BaseWindow({
      width: 1040, height: 650, minWidth: 480, minHeight: 300,
      title: isPrivate ? 'Windows PowerShell - Private' : 'Windows PowerShell',
      icon: path.join(__dirname, 'assets', 'powershell.ico'),
      backgroundColor: '#012456', show: false, autoHideMenuBar: true
    });
    this.win.setMenu(null);
    const windowId = this.win.id;
    this.shellView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: testing } });
    this.win.contentView.addChildView(this.shellView);
    controllers.set(this.win.id, this);
    this.ready = this.shellView.webContents.loadFile(path.join(__dirname, 'index.html'));
    this.ready.then(() => { if (visible && !this.win.isDestroyed()) this.win.show(); }).catch(error => {
      if (!this.win.isDestroyed()) { console.error('Console startup failed:', error); this.win.close(); }
    });
    this.shellView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.shellView.webContents.on('will-navigate', event => event.preventDefault());
    this.shellView.webContents.on('before-input-event', (event, input) => this.shortcut(event, input));
    this.win.on('resize', () => this.resize());
    this.win.on('closed', () => {
      retiredShells.add(this.shellView.webContents);
      this.persistTabs();
      writeStore();
      controllers.delete(windowId);
      for (const tab of this.tabs) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      if (!this.shellView.webContents.isDestroyed()) this.shellView.webContents.close();
      clearTimeout(this.noticeTimer);
      if (this.private && ![...controllers.values()].some(c => c.ses === this.ses)) this.ses.clearStorageData().catch(() => {});
    });
    this.addTab();
    this.resize();
  }
  current() { return this.tabs[this.active]; }
  state() {
    const username = os.userInfo().username.replace(/[\r\n<>]/g, '');
    return {
      prompt: 'PS C:\\Users\\' + username + '> ', fontSize: store.fontSize, private: this.private,
      currentURL: this.current()?.url || '', consoleVisible: this.consoleVisible, tabCount: this.tabs.length,
      tabs: this.tabs.map(t => ({ url: t.url, title: t.title })),
      bookmarks: store.bookmarks.map(b => ({ url: b.url, title: b.title })),
      downloads: this.downloads.map(d => ({ id: d.id, state: d.state, path: d.path })),
      addresses: [...store.bookmarks, ...this.history.slice(-100).reverse()].map(e => ({ url: e.url, title: e.title }))
    };
  }
  output(text, kind = '', clear = false) {
    if (!this.win.isDestroyed()) this.shellView.webContents.send('browser:output', { text, kind, clear });
  }
  notify() { if (!this.win.isDestroyed()) this.shellView.webContents.send('browser:state', this.state()); }
  persistTabs() {
    if (this.private) return;
    store.tabs = [...controllers.values()].filter(c => !c.private).flatMap(c => c.tabs.map(t => t.url)).filter(url => url && url !== 'about:blank').slice(0, 100);
    saveStore();
  }
  resize() {
    if (this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    this.shellView.setBounds({ x: 0, y: 0, width, height });
    if (this.attached) this.attached.setBounds({ x: 0, y: 0, width, height });
  }
  detach() {
    if (this.attached) this.attached.setVisible(false);
    this.attached = null;
  }
  showConsole(value) {
    if (this.win.isDestroyed()) return;
    this.detach(); this.consoleVisible = true;
    this.shellView?.setVisible(true);
    this.shellView.webContents.focus(); this.notify();
    this.shellView.webContents.send('browser:focus', value);
  }
  showPage() {
    if (this.win.isDestroyed()) return;
    const tab = this.current();
    if (!tab || !tab.url || tab.url === 'about:blank') { this.showConsole(); return; }
    if (this.attached !== tab.view) this.detach();
    this.attached = tab.view;
    this.shellView?.setVisible(false);
    tab.view.setVisible(true);
    this.consoleVisible = false; this.resize(); this.notify();
    tab.view.webContents.focus();
  }
  addTab(url, options = {}, background = false) {
    const view = new WebContentsView({ ...(options.webContents ? { webContents: options.webContents } : {}), webPreferences: { ...options.webPreferences, session: this.ses, preload: undefined, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false, sandbox: true, webSecurity: true, offscreen: testing } });
    this.win.contentView.addChildView(view);
    view.setVisible(false);
    const tab = { id: this.nextTabId++, view, url: '', title: 'New tab', findText: '', error: null, loading: false };
    this.tabs.push(tab);
    const wc = view.webContents;
    wc.setZoomMode('isolated');
    this.wireTab(tab);
    if (!background) { this.active = this.tabs.length - 1; if (!options.webPreferences) this.showConsole(); }
    if (url) this.navigate(url, tab);
    else if (options.webPreferences && !background) {
      // Chromium performs popup navigation itself, preserving POST bodies and opener semantics.
      tab.url = 'about:blank';
      wc.once('did-start-navigation', (_e, target, inPlace, mainFrame) => { if (mainFrame && target !== 'about:blank') { tab.url = target; if (tab === this.current()) setImmediate(() => this.showPage()); } });
    }
    this.notify();
    return tab;
  }
  wireTab(tab) {
    const wc = tab.view.webContents;
    for (const [event, handler] of tab.listeners || []) wc.removeListener(event, handler);
    tab.listeners = [];
    tab.owner = this;
    const listen = (event, handler) => { tab.listeners.push([event, handler]); wc.on(event, handler); };
    wc.setWindowOpenHandler(details => {
      if (!safeWebURL(details.url)) return { action: 'deny' };
      return { action: 'allow', outlivesOpener: true, createWindow: childOptions => {
        const child = this.addTab(undefined, childOptions, details.disposition === 'background-tab');
        if (!childOptions.webContents) this.navigate(details.url, child);
        return child.view.webContents;
      } };
    });
    listen('will-navigate', (event, target) => { if (!safeWebURL(target)) { event.preventDefault(); this.output('Unsupported address: ' + target, 'error'); } });
    listen('will-redirect', (event, target) => { if (!safeWebURL(target)) event.preventDefault(); });
    listen('did-navigate', (_event, target) => this.navigated(tab, target));
    listen('did-navigate-in-page', (_event, target, isMainFrame) => { if (isMainFrame) this.navigated(tab, target); });
    listen('page-title-updated', (_event, title) => { tab.title = title; this.updateTitle(); this.notify(); });
    listen('focus', () => { if (this.splitPair?.includes(tab)) { this.active = this.tabs.indexOf(tab); this.attached = tab.view; } this.controlHub.selectedTab = tab; if (this.controlHub !== this) this.controlHub.notify(); });
    listen('did-start-loading', () => { tab.loading = true; this.notify(); });
    listen('did-stop-loading', () => { tab.loading = false; this.notify(); });
    listen('did-start-navigation', (_event, url, inPlace, mainFrame) => { if (mainFrame && !inPlace) this.recordEvent('loading', url); });
    listen('did-fail-load', (_event, code, description, target, mainFrame) => {
      if (code === -3 || !mainFrame) return;
      tab.error = { code, description }; tab.loading = false;
      if (safeWebURL(target)) tab.url = target;
      if (this.current() === tab) this.showConsole();
      const reason = code === -105 ? 'The website address could not be found. Check the spelling and your connection.' : code === -102 ? 'The website refused the connection.' : code === -106 ? 'Your computer appears to be offline.' : code === -118 ? 'The website took too long to respond.' : description;
      this.output('Unable to open ' + target + '\n' + reason + ' (' + code + ')\nUse reload to retry this exact address, or back to return to the previous page.', 'error');
      this.notify();
    });
    listen('did-finish-load', () => { this.recordEvent('ready', tab.title || tab.url); if (tab === this.current() && !this.consoleVisible) this.showPage(); });
    listen('before-input-event', (event, input) => this.shortcut(event, input));
    listen('context-menu', (_event, p) => this.contextMenu(tab, p));
    listen('found-in-page', (_event, result) => { if (result.finalUpdate) { this.output('Find: ' + result.activeMatchOrdinal + ' of ' + result.matches + ' matches.'); this.recordEvent('find', result.activeMatchOrdinal + ' of ' + result.matches + ' matches'); } });
    listen('render-process-gone', () => { tab.error = { description: 'Page renderer stopped.' }; if (tab === this.current()) this.showConsole(); this.output('This page stopped responding. Use reload to reopen it.', 'error'); });
    listen('destroyed', () => {
      if (this.win.isDestroyed()) return;
      const index = this.tabs.indexOf(tab);
      if (index === -1) return;
      if (tab.closeSnapshot) {
        this.closedTabs.push(tab.closeSnapshot);
        if (this.closedTabs.length > 20) this.closedTabs.shift();
      }
      if (this.attached === tab.view) this.detach();
      this.win.contentView.removeChildView(tab.view);
      if (this.splitTab === tab) this.splitTab = null;
      this.tabs.splice(index, 1);
      if (index < this.active) this.active--;
      this.active = Math.min(this.active, this.tabs.length - 1);
      const hub = this.controlHub;
      if (!this.tabs.length && hub !== this && hub.consoleRole && !hub.win.isDestroyed()) {
        if (hub.selectedTab === tab) hub.selectedTab = null;
        this.persistTabs();
        this.win.close();
        hub.updateTitle(); hub.notify();
        return;
      }
      if (!this.tabs.length) this.addTab(); else this.showPage();
      this.persistTabs();
    });
    listen('will-prevent-unload', event => {
      const choice = dialog.showMessageBoxSync(this.win, { type: 'question', title: 'Leave website?', message: 'Changes you made may not be saved.', buttons: ['Stay', 'Leave'], defaultId: 0, cancelId: 0 });
      if (choice === 1) event.preventDefault();
    });
  }
  navigated(tab, url) {
    tab.url = url;
    tab.error = null;
    if (url !== 'about:blank') {
      const entry = { url, title: tab.view.webContents.getTitle() || url, time: Date.now() };
      if (this.history.at(-1)?.url !== url) this.history.push(entry);
      if (this.history.length > 2000) this.history.shift();
    }
    this.persistTabs(); this.notify();
  }
  navigate(url, tab = this.current()) {
    if (!safeWebURL(url)) throw new Error('Unsupported website address.');
    tab.url = url; tab.title = url; tab.error = null;
    if (tab === this.current()) this.showPage();
    tab.view.webContents.loadURL(url).catch(() => {});
    this.persistTabs();
  }
  switchTab(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.tabs.length) throw new Error('That tab does not exist. Type tabs to see tab numbers.');
    this.active = index; this.showPage(); this.notify();
  }
  async closeTab(index = this.active) {
    if (!Number.isInteger(index) || index < 0 || index >= this.tabs.length) throw new Error('That tab does not exist.');
    const tab = this.tabs[index];
    const wc = tab.view.webContents;
    if (tab.url && tab.url !== 'about:blank') tab.closeSnapshot = {
      url: tab.url, title: tab.title, entries: wc.navigationHistory.getAllEntries(),
      index: wc.navigationHistory.getActiveIndex(), zoom: wc.getZoomFactor(), muted: wc.isAudioMuted()
    };
    // Respect a page's beforeunload handler before removing its tab.
    await new Promise(resolve => {
      const closed = () => resolve();
      wc.once('destroyed', closed);
      wc.close({ waitForBeforeUnload: true });
      // A canceled beforeunload means the tab remains open. Do not hold IPC open.
      setTimeout(() => { if (!wc.isDestroyed()) { tab.closeSnapshot = null; wc.removeListener('destroyed', closed); resolve(); } }, 150);
    });
  }
  async reopen() {
    const snapshot = this.closedTabs.pop();
    if (!snapshot) return this.output('No closed tabs to reopen in this window.');
    const tab = this.tabs.length === 1 && !this.current().url ? this.current() : this.addTab();
    tab.url = snapshot.url; tab.title = snapshot.title;
    const wc = tab.view.webContents;
    const applyPreferences = () => { if (!wc.isDestroyed()) { wc.setZoomFactor(snapshot.zoom); wc.setAudioMuted(snapshot.muted); } };
    wc.once('did-finish-load', applyPreferences);
    this.showPage();
    if (snapshot.entries.length && snapshot.index >= 0 && snapshot.entries.every(e => safeWebURL(e.url))) {
      try { await wc.navigationHistory.restore({ entries: snapshot.entries, index: snapshot.index }); }
      catch { this.navigate(snapshot.url, tab); }
    } else this.navigate(snapshot.url, tab);
    applyPreferences();
    this.persistTabs();
  }
  status() {
    const tab = this.current();
    if (!tab.url || tab.url === 'about:blank') return 'Tab ' + (this.active + 1) + ' of ' + this.tabs.length + ': New tab';
    const wc = tab.view.webContents;
    return 'Tab ' + (this.active + 1) + ' of ' + this.tabs.length + ': ' + tab.title + '\n' + tab.url + '\n' +
      (tab.error ? 'Failed: ' + tab.error.description : tab.loading ? 'Loading...' : 'Ready') + ' | ' +
      (tab.url.startsWith('https:') ? 'HTTPS' : 'HTTP / no encryption') + ' | Zoom ' + Math.round(wc.getZoomFactor() * 100) + '% | ' +
      (wc.isAudioMuted() ? 'Muted' : 'Audio on') + (this.private ? ' | Private session' : '');
  }
  navigation(direction) {
    const wc = this.current().view.webContents;
    const nav = wc.navigationHistory;
    if (direction === 'back' && nav.canGoBack()) { nav.goBack(); this.showPage(); }
    else if (direction === 'forward' && nav.canGoForward()) { nav.goForward(); this.showPage(); }
    else this.output('No page to go ' + direction + ' to.');
  }
  bookmark(name) {
    const tab = this.current();
    if (!tab.url || tab.url === 'about:blank') throw new Error('Open a website before bookmarking it.');
    const existing = store.bookmarks.find(b => b.url === tab.url);
    if (existing) { if (name) existing.title = name; }
    else store.bookmarks.push({ url: tab.url, title: name || tab.title, time: Date.now() });
    saveStore(); this.output('Bookmark saved: ' + (name || tab.title));
  }
  setZoom(factor) { const wc = this.current().view.webContents; wc.setZoomFactor(Math.max(0.25, Math.min(5, factor))); }
  shortcut(event, input) {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const ctrl = input.control || input.meta;
    let action;
    if ((ctrl && key === 'l') || (input.alt && key === 'd')) action = () => this.showConsole(this.current().url || '');
    else if (ctrl && input.shift && key === 'n') action = () => new BrowserController(true);
    else if (ctrl && key === 'n') action = () => new BrowserController();
    else if (ctrl && input.shift && key === 't') action = () => this.reopen();
    else if (ctrl && key === 't') action = () => this.addTab();
    else if (key === 'f2' || (ctrl && input.shift && key === 'a')) action = () => { this.showConsole(''); this.execute('tabs'); };
    else if (ctrl && /^[1-9]$/.test(key)) action = () => this.switchTab(key === '9' ? this.tabs.length - 1 : Number(key) - 1);
    else if (ctrl && key === 'w') action = () => this.closeTab();
    else if (ctrl && key === 'tab') action = () => this.switchTab((this.active + this.tabs.length + (input.shift ? -1 : 1)) % this.tabs.length);
    else if (input.alt && key === 'arrowleft') action = () => this.navigation('back');
    else if (input.alt && key === 'arrowright') action = () => this.navigation('forward');
    else if (key === 'f5' || (ctrl && key === 'r')) action = () => this.reload(input.shift);
    else if (ctrl && key === 'd') action = () => { this.bookmark(); this.showConsole(); };
    else if (ctrl && key === 'h') action = () => { this.showConsole(); this.execute('history'); };
    else if (ctrl && key === 'j') action = () => { this.showConsole(); this.execute('downloads'); };
    else if (ctrl && key === 'f') action = () => this.showConsole('find ');
    else if (ctrl && ['+', '=', '-', '0'].includes(key)) action = () => { const current = this.current().view.webContents.getZoomFactor(); this.setZoom(key === '0' ? 1 : current + (key === '-' ? -0.1 : 0.1)); };
    else if (ctrl && key === 's') action = () => this.execute('save');
    else if (ctrl && key === 'p') action = () => this.execute('print');
    else if (key === 'f11') action = () => this.win.setFullScreen(!this.win.isFullScreen());
    if (action) { event.preventDefault(); Promise.resolve().then(action).catch(error => { this.showConsole(); this.output(error.message, 'error'); }); }
  }
  reload(ignoreCache = false) {
    const tab = this.current();
    if (!tab.url || tab.url === 'about:blank') return this.output('Open a website first.');
    this.showPage();
    if (tab.error || !tab.view.webContents.getURL()) this.navigate(tab.url);
    else if (ignoreCache) tab.view.webContents.reloadIgnoringCache(); else tab.view.webContents.reload();
  }
  contextMenu(tab, p) {
    const wc = tab.view.webContents;
    const template = [];
    if (p.linkURL && safeWebURL(p.linkURL)) template.push({ label: 'Open link in new tab', click: () => this.addTab(p.linkURL) }, { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) });
    if (p.isEditable) template.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    else if (p.selectionText) template.push({ label: 'Copy', click: () => wc.copy() }, { label: 'Search selection', click: () => this.addTab(destination(p.selectionText, store.search, true)) });
    template.push({ type: 'separator' }, { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => this.navigation('back') }, { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => this.navigation('forward') }, { label: 'Reload', click: () => this.reload() }, { label: 'Command prompt', click: () => this.showConsole(tab.url) });
    Menu.buildFromTemplate(template).popup({ window: this.win });
  }
  async execute(line) {
    const { name, argument, raw } = splitCommand(line);
    const arg = unquote(argument);
    const tab = this.current();
    const wc = tab.view.webContents;
    try {
      if (!name) return;
      switch (name) {
        case 'help': case 'get-help': case '?': this.output(HELP); break;
        case 'open': case 'start': this.navigate(destination(arg, store.search)); break;
        case 'search': this.navigate(destination(arg, store.search, true)); break;
        case 'back': case 'forward': this.navigation(name); break;
        case 'reload': this.reload(); break;
        case 'stop': wc.stop(); this.output('Loading stopped.'); break;
        case 'tabs': this.output(this.tabs.map((t, i) => `${i === this.active ? '*' : ' '} ${i + 1}  ${t.title}${t.error ? ' [failed]' : t.loading ? ' [loading]' : ''}${t.url && t.title !== t.url ? '\n     ' + t.url : ''}`).join('\n')); break;
        case 'tab':
          if (/^new(?:\s|$)/i.test(arg)) this.addTab(arg.slice(3).trim() ? destination(unquote(arg.slice(3).trim()), store.search) : undefined);
          else if (/^close(?:\s|$)/i.test(arg)) await this.closeTab(arg.slice(5).trim() ? Number(arg.slice(5).trim()) - 1 : this.active);
          else if (!arg) await this.execute('tabs');
          else this.switchTab(tabIndex(arg, this.tabs, this.active));
          break;
        case 'new': this.addTab(arg ? destination(arg, store.search) : undefined); break;
        case 'close': await this.closeTab(arg ? Number(arg) - 1 : this.active); break;
        case 'reopen': await this.reopen(); break;
        case 'restore': {
          if (this.private) throw new Error('Saved tabs are available in regular windows.');
          const urls = [...store.tabs];
          if (!urls.length) this.output('No saved tabs.');
          else for (const url of urls) this.addTab(url);
          break;
        }
        case 'history':
          if (arg === 'clear') { this.history.length = 0; if (!this.private) saveStore(); this.output('History cleared.'); }
          else {
            const entries = this.history.filter(h => (h.url + ' ' + h.title).toLowerCase().includes(arg.toLowerCase())).slice(-100).reverse();
            this.output(entries.length ? entries.map(h => new Date(h.time).toLocaleString() + '\n  ' + h.url).join('\n') : 'No browsing history.');
          }
          break;
        case 'bookmarks': this.output(store.bookmarks.length ? store.bookmarks.map((b, i) => (i + 1) + '  ' + b.title + '\n   ' + b.url).join('\n') : 'No bookmarks. Use bookmark on a website to save it.'); break;
        case 'bookmark': {
          const parts = splitCommand(arg);
          if (['open', 'remove'].includes(parts.name)) {
            const index = Number(parts.argument) - 1;
            if (!Number.isInteger(index) || !store.bookmarks[index]) throw new Error('That bookmark does not exist. Type bookmarks to see numbers.');
            if (parts.name === 'open') this.navigate(store.bookmarks[index].url);
            else { store.bookmarks.splice(index, 1); saveStore(); this.output('Bookmark removed.'); }
          } else this.bookmark(arg);
          break;
        }
        case 'downloads': this.output(this.downloads.length ? this.downloads.slice(-50).reverse().map(d => d.id + '  ' + d.name + ' [' + d.state + '] ' + (d.total ? Math.round(d.received / d.total * 100) + '%' : Math.round(d.received / 1024) + ' KB') + (d.path ? '\n   ' + d.path : '')).join('\n') : 'No downloads.'); break;
        case 'download': {
          const parts = splitCommand(arg);
          const id = Number(parts.argument);
          const record = this.downloads.find(d => d.id === id);
          if (!record) throw new Error('That download does not exist. Type downloads to see numbers.');
          const item = liveDownloads.get(id);
          if (parts.name === 'show' && record.path) shell.showItemInFolder(record.path);
          else if (parts.name === 'open' && record.state === 'completed' && record.path) {
            const confirm = await dialog.showMessageBox(this.win, { title: 'Open downloaded file?', type: 'question', message: 'Open ' + record.name + ' with its default Windows application?', detail: record.path, buttons: ['Cancel', 'Open'], defaultId: 0, cancelId: 0 });
            if (confirm.response === 1) { const error = await shell.openPath(record.path); if (error) throw new Error(error); }
          }
          else if (item && parts.name === 'pause') item.pause();
          else if (item && parts.name === 'resume' && item.canResume()) item.resume();
          else if (item && parts.name === 'cancel') item.cancel();
          else throw new Error('Use download open|show|pause|resume|cancel <number>. This action must apply to the download state.');
          break;
        }
        case 'private': new BrowserController(true); break;
        case 'window': new BrowserController(); break;
        case 'site': this.output(tab.url ? tab.url + '\n' + (tab.url.startsWith('https:') ? 'HTTPS connection.' : 'This address does not use HTTPS.') + '\n' + (this.private ? 'Private session.' : 'Regular session.') : 'No website is open.'); break;
        case 'status': this.output(this.status()); break;
        case 'find':
          if (arg === 'clear') { wc.stopFindInPage('clearSelection'); tab.findText = ''; this.showPage(); }
          else {
            if (!tab.url) throw new Error('Open a website first.');
            const repeat = ['next', 'prev'].includes(arg);
            if (!repeat) tab.findText = arg;
            if (!tab.findText) throw new Error('Use find <words> first.');
            wc.findInPage(tab.findText, { forward: arg !== 'prev', findNext: repeat }); this.showPage();
          }
          break;
        case 'zoom': {
          const percent = Number(arg.replace('%', ''));
          if (!Number.isFinite(percent) || percent < 25 || percent > 500) throw new Error('Use zoom <percent>, from 25 through 500.');
          this.setZoom(percent / 100); this.output('Zoom: ' + percent + '%'); this.showPage(); break;
        }
        case 'font': {
          const size = Number(arg);
          if (!Number.isInteger(size) || size < 12 || size > 32) throw new Error('Use font <pixels>, from 12 through 32.');
          store.fontSize = size; saveStore(); for (const c of controllers.values()) c.notify(); this.output('Console font size: ' + size); break;
        }
        case 'settings':
          if (!arg) this.output('Search engine: ' + store.search + '\nConsole font: Consolas, ' + store.fontSize + ' px\nBrowser data: ' + app.getPath('userData') + '\nUse settings search duckduckgo|google|bing or font <pixels>.');
          else {
            const parts = splitCommand(arg);
            if (parts.name !== 'search' || !ENGINES[parts.argument]) throw new Error('Use settings search duckduckgo|google|bing.');
            store.search = parts.argument; saveStore(); this.output('Search engine: ' + store.search);
          }
          break;
        case 'save': {
          if (!tab.url) throw new Error('Open a website first.');
          const result = await dialog.showSaveDialog(this.win, { title: 'Save webpage', defaultPath: path.join(app.getPath('downloads'), (tab.title || 'page').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) + '.html'), filters: [{ name: 'HTML page', extensions: ['html'] }] });
          if (!result.canceled) { await wc.savePage(result.filePath, 'HTMLComplete'); this.output('Page saved: ' + result.filePath); }
          break;
        }
        case 'print': if (!tab.url) throw new Error('Open a website first.'); wc.print({}, (success, reason) => { if (!success && reason !== 'cancelled') this.output('Print: ' + reason, 'warning'); }); break;
        case 'mute': wc.setAudioMuted(!wc.isAudioMuted()); this.output('Tab audio ' + (wc.isAudioMuted() ? 'muted.' : 'unmuted.')); break;
        case 'home': this.showConsole(); break;
        case 'clear': case 'cls': this.output(undefined, '', true); break;
        case 'exit': this.win.close(); break;
        case 'about': this.output('PowerShell Browser ' + app.getVersion() + '\nStandalone browser with a classic Windows PowerShell interface.\nChromium ' + process.versions.chrome + ' / Electron ' + process.versions.electron + '\nIndependent project; not affiliated with Microsoft.\nType help for browser commands.'); break;
        default: this.navigate(destination(raw, store.search));
      }
    } catch (error) { this.output(error.message, 'error'); }
  }
}

require('./features')(BrowserController, { app, controllers, getStore: () => store, saveStore, writeStore, testing, getUpdates: () => updates });

function fromIPC(event) {
  const controller = controllerFor(event.sender);
  if (!controller || event.sender !== controller.shellView.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted browser command.');
  return controller;
}
ipcMain.handle('browser:state', event => retiredShells.has(event.sender) ? null : fromIPC(event).state());
ipcMain.handle('browser:command', (event, line) => {
  if (typeof line !== 'string' || line.length > 8192) throw new Error('Invalid command.');
  return fromIPC(event).execute(line);
});
ipcMain.handle('browser:resume', event => fromIPC(event).showPage());
ipcMain.handle('browser:configure', (event, value) => fromIPC(event).configure(value, true));
ipcMain.handle('browser:note-read', event => fromIPC(event).readNote());
ipcMain.handle('browser:note-save', (event, value) => fromIPC(event).saveNote(value));
app.on('window-all-closed', () => { if (!testing && !smokeTesting) app.quit(); });
app.on('before-quit', writeStore);
app.whenReady().then(async () => {
  if (!ownsInstance) return;
  Menu.setApplicationMenu(null);
  loadStore();
  updates = require('./updater').createUpdateService({ app, disabled: testing || smokeTesting, enabled: () => store.preferences.updates, announce: message => {
    const c = [...controllers.values()].find(c => !c.private && c.consoleRole) || [...controllers.values()].find(c => !c.private);
    if (c) c.output(message);
  } });
  if (testing) {
    try { await require('./test/integration')( { BrowserController, store, writeStore, app, storeFile, controllers } ); app.exit(0); }
    catch (error) { console.error(error); app.exit(1); }
  } else if (smokeTesting) {
    try {
      const browser = new BrowserController(false, false);
      await browser.ready;
      const wc = browser.shellView.webContents;
      await browser.configure(store.preferences, true);
      await wc.executeJavaScript('window.browser.command("help")');
      await new Promise(resolve => setTimeout(resolve, 200));
      const good = await wc.executeJavaScript('document.querySelector("#transcript").textContent.includes("Browser commands") && getComputedStyle(document.body).backgroundColor === "rgb(1, 36, 86)" && window.browserCompletion.candidates("reop")[0] === "reopen "');
      if (!good) throw new Error('Packaged console failed smoke check.');
      browser.win.destroy();
      await new Promise(resolve => setTimeout(resolve, 100));
      console.log('PASS packaged startup, bridge, appearance, command completion, and window close');
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  } else {
    const browser = new BrowserController();
    const requested = process.argv.find(value => /^https?:\/\//i.test(value));
    if (requested) { await browser.ready; browser.navigate(destination(requested)); }
    updates.start();
  }
});
