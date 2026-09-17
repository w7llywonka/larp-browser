'use strict';
const { dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { destination, splitCommand, unquote, safeWebURL, tabIndex } = require('./core');
const { preferences, PRESETS, workspaceName } = require('./preferences');

module.exports = (Controller, env) => {
  const { app, controllers, getStore, saveStore, testing, getUpdates } = env;
  const p = Controller.prototype;
  const original = { state: p.state, current: p.current, navigate: p.navigate, closeTab: p.closeTab, output: p.output, execute: p.execute, shortcut: p.shortcut, addTab: p.addTab, switchTab: p.switchTab };
  const prefs = () => getStore().preferences;
  p.state = function () {
    return { ...original.state.call(this), preferences: prefs(), onboarding: this.setupOpen, editorVisible: this.editorVisible, disguised: this.disguised, consoleRole: this.consoleRole, split: !!this.splitTab, tabCount: this.allTabs().length, tabs: this.allTabs().map(e => ({ url: e.tab.url, title: e.tab.title })) };
  };
  p.output = function (text, kind, clear) {
    if (!this.disguised) original.output.call(this, text, kind, clear);
    const hub = this.controlHub;
    if (hub !== this && !hub.win.isDestroyed() && !hub.disguised) original.output.call(hub, text, kind, clear);
  };
  p.allTabs = function () {
    const windows = prefs().windows || prefs().consoleWindow ? [...controllers.values()].filter(c => !c.win.isDestroyed() && !c.consoleRole && c.ses === this.ses) : [this];
    return windows.flatMap(c => c.tabs.map((tab, index) => ({ controller: c, tab, index })));
  };
  p.chooseTab = function (argument) {
    const entries = this.allTabs();
    const active = entries.findIndex(e => e.tab === this.current());
    const entry = entries[tabIndex(argument, entries.map(e => e.tab), active)];
    this.controlHub.selectedTab = entry.tab; this.selectedTab = entry.tab;
    entry.controller.switchTab(entry.index);
    if (entry.controller.visible) { entry.controller.win.show(); entry.controller.win.focus(); }
  };
  p.current = function () {
    if (!this.consoleRole) return original.current.call(this);
    if (this.selectedTab?.owner?.tabs.includes(this.selectedTab)) return this.selectedTab;
    return this.allTabs()[0]?.tab || original.current.call(this);
  };
  p.navigate = function (url, tab = this.current()) {
    if (this.consoleRole) {
      if (tab && tab.owner !== this) { this.selectedTab = tab; tab.owner.navigate(url, tab); this.notify(); return; }
      this.addTab(url); return;
    }
    original.navigate.call(this, url, tab);
  };
  p.closeTab = function (index) {
    if (this.consoleRole) {
      const tab = this.current();
      if (tab && tab.owner !== this) return tab.owner.closeTab(tab.owner.tabs.indexOf(tab));
      return this.output('No open tabs.');
    }
    return original.closeTab.call(this, index);
  };
  p.newSibling = function () {
    return new Controller(this.private, this.visible, { role: 'browser', hub: this.controlHub, session: this.ses, history: this.history, downloads: this.downloads, noteState: this.noteState, closedTabs: this.closedTabs });
  };
  p.dropBlank = function () {
    if (this.tabs.length !== 1 || this.tabs[0].url) return;
    const tab = this.tabs.pop(); this.active = -1;
    this.win.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
  };
  p.addTab = function (url, options = {}, background = false, internal = false) {
    if (this.consoleRole && this.tabs.length && !internal) {
      let target = !prefs().windows && [...controllers.values()].find(c => !c.consoleRole && c.controlHub === this && !c.win.isDestroyed());
      if (!target) { target = this.newSibling(); target.dropBlank(); }
      const tab = target.addTab(url, options, background, true);
      if (!background) { this.selectedTab = tab; this.notify(); }
      return tab;
    }
    if (prefs().windows && this.tabs.length && !internal) {
      const sibling = this.newSibling(); sibling.dropBlank();
      return original.addTab.call(sibling, url, options, background);
    }
    return original.addTab.call(this, url, options, background);
  };
  p.transferTab = function (tab, target) {
    const index = this.tabs.indexOf(tab);
    if (index < 0 || target === this) return;
    tab.view.setVisible(false);
    this.win.contentView.removeChildView(tab.view);
    this.tabs.splice(index, 1);
    if (index <= this.active) this.active = Math.max(0, this.active - 1);
    if (this.splitTab === tab || this.splitPair?.includes(tab)) { this.splitTab = null; this.splitPair = null; }
    if (this.attached === tab.view) this.attached = null;
    target.win.contentView.addChildView(tab.view);
    target.tabs.push(tab); target.active = target.tabs.length - 1;
    target.wireTab(tab);
    target.showPage();
    if (this.tabs.length) this.resize();
    this.notify(); target.notify();
  };
  p.applyWindowMode = function (on) {
    const windows = [...controllers.values()].filter(c => !c.win.isDestroyed() && !c.consoleRole);
    if (on) {
      for (const c of windows) {
        c.splitTab = null; c.splitPair = null;
        for (const tab of c.tabs.slice(1)) { const target = c.newSibling(); target.dropBlank(); c.transferTab(tab, target); }
        c.resize();
      }
    } else {
      const groups = new Map();
      for (const c of windows) {
        const target = groups.get(c.controlHub);
        if (!target) { groups.set(c.controlHub, c); continue; }
        for (const tab of [...c.tabs]) c.transferTab(tab, target);
        c.win.destroy();
      }
    }
  };
  p.applyConsoleMode = function (on) {
    if (on) {
      const windows = [...controllers.values()].filter(c => !c.win.isDestroyed() && !c.consoleRole && c.controlHub === c);
      for (const hub of windows) {
        const pages = hub.tabs.filter(t => t.url); hub.consoleRole = true;
        if (pages.length) {
          const target = hub.newSibling(); target.dropBlank();
          for (const tab of pages) hub.transferTab(tab, target);
          hub.selectedTab = pages[0];
        }
        if (!hub.tabs.length) original.addTab.call(hub);
        hub.showConsole('');
      }
    } else {
      for (const hub of [...controllers.values()].filter(c => c.consoleRole && !c.win.isDestroyed())) {
        hub.consoleRole = false;
        const children = [...controllers.values()].filter(c => c !== hub && c.controlHub === hub && !c.win.isDestroyed());
        if (children.some(c => c.tabs.length)) hub.dropBlank();
        for (const child of children) { for (const tab of [...child.tabs]) child.transferTab(tab, hub); child.win.destroy(); }
        if (!hub.tabs.length) original.addTab.call(hub);
        hub.showConsole('');
      }
    }
  };
  p.configure = function (value, complete = false) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings.');
    const store = getStore();
    const wasWindows = prefs().windows;
    const wasConsole = prefs().consoleWindow;
    store.preferences = preferences(value);
    getUpdates()?.sync();
    store.fontSize = prefs().fontSize; store.search = prefs().search;
    if (complete) store.setupComplete = true;
    if (wasConsole !== prefs().consoleWindow) this.applyConsoleMode(prefs().consoleWindow);
    if (wasWindows !== prefs().windows || (wasConsole !== prefs().consoleWindow && prefs().windows)) this.applyWindowMode(prefs().windows);
    for (const c of controllers.values()) {
      if (complete) c.setupOpen = false;
      if (!prefs().notifications) { clearTimeout(c.noticeTimer); c.noticeActive = false; c.win.flashFrame(false); }
      c.updateTitle(); c.resize(); c.notify();
    }
    saveStore(); return this.state();
  };
  p.updateTitle = function () {
    if (this.win.isDestroyed() || this.noticeActive) return;
    let title = 'Windows PowerShell';
    if (!this.disguised) {
      if (this.private) title += ' - Private';
      if (prefs().title === 'page' && this.current()?.url) title += ' - ' + this.current().title;
    }
    this.win.setTitle(title);
  };
  p.recordEvent = function (type, message) {
    if (this.win.isDestroyed()) return;
    const text = '[' + new Date().toLocaleTimeString() + '] ' + type.padEnd(8) + ' ' + message;
    this.events.push(text); if (this.events.length > 200) this.events.shift();
    const hub = this.controlHub;
    if (hub !== this && !hub.win.isDestroyed()) { hub.events.push(text); if (hub.events.length > 200) hub.events.shift(); hub.updateTitle(); }
    if (prefs().watch && !this.disguised && !this.editorVisible) this.output(text);
    this.updateTitle();
  };
  p.downloadNotice = function (name) {
    if (!prefs().notifications || this.disguised || this.win.isDestroyed()) return;
    this.noticeActive = true;
    this.win.setTitle('Windows PowerShell - Download complete: ' + name);
    if (this.visible) this.win.flashFrame(true);
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.noticeActive = false;
      if (!this.win.isDestroyed()) { this.win.flashFrame(false); this.updateTitle(); }
    }, 8000);
  };
  p.detach = function () { for (const tab of this.tabs) tab.view.setVisible(false); this.attached = null; };
  p.resize = function () {
    if (this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    if (this.consoleVisible) { this.shellView.setBounds({ x: 0, y: 0, width, height }); return; }
    const hasControlWindow = this.controlHub !== this && this.controlHub.consoleRole && !this.controlHub.win.isDestroyed();
    const dock = prefs().watch && !this.disguised && !hasControlWindow ? Math.min(180, Math.round(height * 0.35)) : 0;
    this.shellView.setVisible(!!dock);
    this.shellView.setBounds({ x: 0, y: dock ? height - dock : 0, width, height: dock || height });
    const current = this.current();
    if (!current) return;
    let pair = this.splitTab && this.splitPair?.length === 2 && this.splitPair.every(t => this.tabs.includes(t)) ? this.splitPair : null;
    if (pair && !pair.includes(current)) { pair = [current, this.splitTab]; this.splitPair = pair; }
    if (!pair) { this.splitTab = null; this.splitPair = null; }
    const shown = pair || [current];
    for (const tab of this.tabs) tab.view.setVisible(shown.includes(tab));
    const left = Math.floor(width * this.splitRatio / 100);
    shown[0].view.setBounds({ x: 0, y: 0, width: pair ? left - 1 : width, height: height - dock });
    if (pair) shown[1].view.setBounds({ x: left + 1, y: 0, width: width - left - 1, height: height - dock });
    this.attached = current.view;
  };
  p.showConsole = function (value) {
    if (this.win.isDestroyed()) return;
    this.editorVisible = false;
    this.shellView.webContents.send('browser:editor', { open: false });
    this.detach(); this.consoleVisible = true;
    this.shellView.setVisible(true); this.resize();
    this.shellView.webContents.focus(); this.notify();
    this.shellView.webContents.send('browser:focus', value);
  };
  p.showPage = function () {
    if (this.win.isDestroyed()) return;
    const tab = this.current();
    if (this.consoleRole) {
      this.disguised = false;
      if (tab?.owner && tab.owner !== this) tab.owner.showPage();
      this.notify(); return;
    }
    if (!tab?.url || tab.url === 'about:blank') return this.showConsole();
    this.disguised = false; this.editorVisible = false;
    this.shellView.webContents.send('browser:editor', { open: false });
    this.consoleVisible = false;
    this.resize(); this.updateTitle(); this.notify(); tab.view.webContents.focus();
  };
  p.panic = function () {
    this.disguised = true; this.noticeActive = false; this.setupOpen = false; this.settingsMenu = false;
    clearTimeout(this.noticeTimer);
    this.showConsole(''); this.win.flashFrame(false); this.updateTitle();
    this.shellView.webContents.send('browser:panic');
  };
  p.reopen = async function () {
    const snapshot = this.closedTabs.pop();
    if (!snapshot) return this.output('No closed tabs to reopen in this window.');
    const tab = !this.consoleRole && this.tabs.length === 1 && !this.current().url ? this.current() : this.addTab();
    const owner = tab.owner;
    tab.url = snapshot.url; tab.title = snapshot.title;
    const wc = tab.view.webContents;
    const apply = () => { if (!wc.isDestroyed()) { wc.setZoomFactor(snapshot.zoom); wc.setAudioMuted(snapshot.muted); } };
    wc.once('did-finish-load', apply); owner.showPage();
    if (snapshot.entries.length && snapshot.index >= 0 && snapshot.entries.every(e => safeWebURL(e.url))) {
      try { await wc.navigationHistory.restore({ entries: snapshot.entries, index: snapshot.index }); } catch { owner.navigate(snapshot.url, tab); }
    } else owner.navigate(snapshot.url, tab);
    apply(); owner.persistTabs();
  };
  p.readNote = function () { return this.private ? this.noteState.text : getStore().note; };
  p.saveNote = function (value) {
    if (typeof value !== 'string' || value.length > 1048576) throw new Error('Scratchpad is limited to 1 MB of text.');
    if (this.private) this.noteState.text = value;
    else { getStore().note = value; saveStore(); }
    return { saved: true, private: this.private };
  };
  p.settingsText = function () {
    const s = prefs();
    return `Browser configuration\n\n  [1] Realism         ${s.realism} (strict / balanced / browser)\n  [2] Separate windows ${s.windows ? 'on' : 'off'}\n  [3] Window title    ${s.title} (classic / page)\n  [4] Startup banner  ${s.banner ? 'on' : 'off'}\n  [5] Live console    ${s.watch ? 'on' : 'off'}\n  [6] Download alerts ${s.notifications ? 'on' : 'off'}\n  [7] Cursor blinking ${s.blink ? 'on' : 'off'}\n  [8] Console font    ${s.fontSize} px\n  [9] Disguise key    ${s.panic} (f8 / f12 / ctrlshiftspace)\n  [10] Command window ${s.consoleWindow ? 'on' : 'off'}\n  [11] Auto updates    ${s.updates ? 'on' : 'off'}\n\nEnter a number to cycle, or a number and value, e.g. 2 on.\nUse settings console on, settings windows on, settings realism strict, or settings search google.\nUse setup to reopen the visual preview. Type done to leave this menu.\nSeparate windows gives each tab its own native PowerShell window.\nChoose windows off for split browsing.`;
  };
  p.changeSetting = function (key, value) {
    const s = { ...prefs() };
    if (key === 'realism') {
      if (!PRESETS[value]) throw new Error('Choose strict, balanced, or browser.');
      Object.assign(s, PRESETS[value]);
    } else {
      if (['consoleWindow', 'windows', 'banner', 'watch', 'notifications', 'blink', 'updates'].includes(key)) {
        if (!['on', 'off'].includes(value)) throw new Error('Use ' + key + ' on or off.');
        s[key] = value === 'on';
      } else if (key === 'font') {
        const size = Number(value); if (!Number.isInteger(size) || size < 12 || size > 32) throw new Error('Font size must be 12–32.'); s.fontSize = size;
      } else if (key === 'title' && ['classic', 'page'].includes(value)) s.title = value;
      else if (key === 'panic' && ['f8', 'f12', 'ctrlshiftspace'].includes(value)) s.panic = value;
      else if (key === 'search' && ['duckduckgo', 'google', 'bing'].includes(value)) s.search = value;
      else throw new Error('Unknown setting or value. Type settings for choices.');
      if (key !== 'search' && key !== 'font') s.realism = 'custom';
    }
    this.configure(s); this.output(key + ': ' + value);
  };
  p.shortcut = function (event, input) {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase(); const ctrl = input.control || input.meta;
    if (this.editorVisible && ctrl && key === 's' && !input.shift) return;
    const panic = prefs().panic === key || (prefs().panic === 'ctrlshiftspace' && ctrl && input.shift && (key === ' ' || key === 'space'));
    let action;
    if (panic) action = () => { for (const c of controllers.values()) c.panic(); if (this.visible) this.win.focus(); };
    else if (ctrl && key === 'l') action = () => this.consoleVisible && !this.setupOpen ? this.showPage() : this.showConsole(this.current()?.url || '');
    else if (ctrl && input.shift && key === 's') action = () => this.execute('snapshot');
    else if (ctrl && /^[1-9]$/.test(key)) action = () => this.chooseTab(key === '9' ? 'last' : key);
    else if (ctrl && key === 'tab') action = () => this.chooseTab(input.shift ? 'prev' : 'next');
    if (action) { event.preventDefault(); Promise.resolve().then(action).catch(e => this.output(e.message, 'error')); }
    else original.shortcut.call(this, event, input);
  };
  p.execute = async function (line) {
    let { name, argument, raw } = splitCommand(line);
    let arg = unquote(argument);
    if (this.disguised && raw) { this.disguised = false; this.updateTitle(); this.notify(); }
    try {
      if (name === 'update' || name === 'updates') {
        const service = getUpdates();
        if (arg === 'install') { writeStore(); service.install(); }
        else if (arg === 'download') { await service.download(); this.output(service.text()); }
        else if (!arg || arg === 'check') { await service.check(true); this.output(service.text()); }
        else if (arg === 'status') this.output(service.text());
        else throw new Error('Use update, update status, update download, or update install.');
        return;
      }
      if (this.settingsMenu && /^\d+$/.test(name)) {
        const keys = ['realism', 'windows', 'title', 'banner', 'watch', 'notifications', 'blink', 'font', 'panic', 'consoleWindow', 'updates'];
        const key = keys[Number(name) - 1]; if (!key) throw new Error('Choose a setting from 1 through 11.');
        const s = prefs();
        if (!arg) {
          const values = key === 'realism' ? ['strict', 'balanced', 'browser'] : key === 'title' ? ['classic', 'page'] : key === 'panic' ? ['f8', 'f12', 'ctrlshiftspace'] : key === 'font' ? ['16', '18', '20'] : ['off', 'on'];
          const current = key === 'font' ? String(s.fontSize) : typeof s[key] === 'boolean' ? s[key] ? 'on' : 'off' : s[key];
          arg = values[(values.indexOf(current) + 1) % values.length];
        }
        this.changeSetting(key, arg); this.output(this.settingsText()); return;
      }
      if (name === 'done' && this.settingsMenu) { this.settingsMenu = false; this.output('Settings saved. Ctrl+L returns to your page.'); return; }
      if (name === 'settings') {
        if (!arg) { this.settingsMenu = true; this.output(this.settingsText()); }
        else { const setting = splitCommand(arg); this.changeSetting(setting.name === 'console' ? 'consoleWindow' : setting.name, setting.argument.toLowerCase()); }
        return;
      }
      if (name === 'setup') { this.showConsole(''); this.setupOpen = true; this.notify(); return; }
      if (name === 'font') { this.changeSetting('font', arg); return; }
      if (name === 'panic' || name === 'disguise') { for (const c of controllers.values()) c.panic(); return; }
      if (name === 'watch') {
        if (!arg) this.output(this.events.slice(-30).join('\n') || 'No recent events. Use watch on to show a live console below webpages.');
        else { this.changeSetting('watch', arg.toLowerCase()); if (arg === 'on' && this.current().url) this.showPage(); }
        return;
      }
      if (name === 'tabs' || (name === 'tab' && !arg)) {
        const entries = this.allTabs();
        if (!entries.length) { this.output('No open tabs.'); return; }
        this.output(entries.map((e, i) => `${e.tab === this.current() ? '*' : ' '} ${i + 1}  ${e.tab.title}${prefs().windows ? ' [window]' : ''}${e.tab.loading ? ' [loading]' : ''}${e.tab.error ? ' [failed]' : ''}\n     ${e.tab.url || '(empty)'}`).join('\n')); return;
      }
      if (name === 'tab' && arg && !/^(new|close|remove)(\s|$)/i.test(arg)) { this.chooseTab(arg); return; }
      if ((name === 'close' && arg) || (name === 'tab' && /^(close|remove)(\s|$)/i.test(arg))) {
        const selector = name === 'close' ? arg : splitCommand(arg).argument;
        if (!selector) { await this.closeTab(); return; }
        const entries = this.allTabs();
        const numbers = selector.split(/\s+/);
        // Resolve the entire list before closing anything. Later numbers must
        // continue to refer to the original list, even as indexes shift.
        const indexes = numbers.length === 1 ? [tabIndex(selector, entries.map(e => e.tab), 0)] : numbers.map(number => {
          if (!/^\d+$/.test(number)) throw new Error('Use tab remove <numbers>, e.g. tab remove 1 2 3.');
          return tabIndex(number, entries.map(e => e.tab), 0);
        });
        const targets = [...new Set(indexes)].map(index => entries[index]);
        for (const entry of targets) {
          const owner = entry.tab.owner;
          const index = owner.tabs.indexOf(entry.tab);
          if (index >= 0 && !owner.win.isDestroyed()) await owner.closeTab(index);
        }
        return;
      }
      if (name === 'split') {
        if (this.consoleRole && this.current()?.owner !== this) return await this.current().owner.execute(line);
        if (prefs().windows) throw new Error('Split browsing uses tabs in one window. Run settings windows off first.');
        const left = this.current();
        if (!left.url) throw new Error('Open a page before splitting.');
        if (['off', 'close'].includes(arg)) { this.splitTab = null; this.splitPair = null; this.showPage(); return; }
        if (arg.startsWith('ratio ')) {
          const ratio = Number(arg.slice(6)); if (ratio < 25 || ratio > 75 || !Number.isFinite(ratio)) throw new Error('Use split ratio 25–75.');
          this.splitRatio = ratio; this.showPage(); return;
        }
        if (arg === 'swap') { if (!this.splitPair) throw new Error('Start split browsing first.'); this.splitPair.reverse(); this.showPage(); return; }
        if (arg.startsWith('focus ')) {
          if (!this.splitPair) throw new Error('Start split browsing first.');
          const position = arg.slice(6); if (!['left', 'right'].includes(position)) throw new Error('Use split focus left or right.');
          this.active = this.tabs.indexOf(this.splitPair[position === 'left' ? 0 : 1]); this.showPage(); return;
        }
        let right;
        if (arg.startsWith('tab ')) right = this.tabs[tabIndex(arg.slice(4), this.tabs, this.active)];
        else if (arg) right = this.addTab(destination(arg, getStore().search), {}, true, true);
        else right = this.tabs.find(t => t !== left && t.url);
        if (!right || right === left) throw new Error('Use split <website> or split tab <number>.');
        this.splitTab = right; this.splitPair = [left, right]; this.showPage(); return;
      }
      if (name === 'workspace' || name === 'workspaces') {
        if (this.private) throw new Error('Workspaces are saved and opened in regular windows.');
        const store = getStore(); const command = splitCommand(arg); const title = unquote(command.argument);
        if (!arg || name === 'workspaces' || command.name === 'list') this.output(store.workspaces.length ? store.workspaces.map(w => w.name + ' (' + w.tabs.length + ' tabs)').join('\n') : 'No workspaces. Use workspace save <name>.');
        else if (command.name === 'save') {
          const titleName = workspaceName(title); const entries = this.allTabs().filter(e => safeWebURL(e.tab.url) && e.tab.url !== 'about:blank');
          if (!entries.length) throw new Error('Open websites before saving a workspace.');
          const layout = this.consoleRole ? this.current().owner : this;
          const workspace = { name: titleName, tabs: entries.slice(0, 100).map(e => ({ url: e.tab.url, zoom: e.tab.view.webContents.getZoomFactor(), muted: e.tab.view.webContents.isAudioMuted() })), split: layout.splitPair ? layout.splitPair.map(t => entries.findIndex(e => e.tab === t)) : null, ratio: layout.splitRatio };
          const index = store.workspaces.findIndex(w => w.name.toLowerCase() === titleName.toLowerCase());
          if (index < 0) store.workspaces.push(workspace); else store.workspaces[index] = workspace;
          saveStore(); this.output('Workspace saved: ' + titleName);
        } else {
          const index = store.workspaces.findIndex(w => w.name.toLowerCase() === title.toLowerCase());
          if (index < 0) throw new Error('Workspace not found. Use workspaces to list saved names.');
          if (command.name === 'remove') { store.workspaces.splice(index, 1); saveStore(); this.output('Workspace removed.'); }
          else if (command.name === 'open') {
            const w = store.workspaces[index]; const opened = [];
            for (const item of w.tabs) if (safeWebURL(item.url)) {
              const tab = this.addTab(item.url); opened.push(tab);
              tab.view.webContents.once('did-finish-load', () => { if (!tab.view.webContents.isDestroyed()) { tab.view.webContents.setZoomFactor(Math.min(5, Math.max(.25, item.zoom || 1))); tab.view.webContents.setAudioMuted(!!item.muted); } });
            }
            if (!prefs().windows && w.split?.length === 2 && w.split.every(i => opened[i]) && w.split[0] !== w.split[1]) {
              const owner = opened[w.split[0]].owner;
              owner.splitPair = w.split.map(i => opened[i]); owner.splitTab = owner.splitPair[1]; owner.splitRatio = Math.min(75, Math.max(25, w.ratio || 50)); owner.active = owner.tabs.indexOf(owner.splitPair[0]); this.selectedTab = owner.splitPair[0]; owner.showPage();
            }
          } else throw new Error('Use workspace save|open|remove <name>.');
        }
        return;
      }
      if (name === 'note' || name === 'scratchpad') {
        if (arg) throw new Error('Use note to open the scratchpad editor.');
        this.showConsole(); this.editorVisible = true;
        this.shellView.webContents.send('browser:editor', { open: true, text: this.readNote(), private: this.private }); this.notify(); return;
      }
      if (name === 'snapshot') {
        const tab = this.current(); if (!tab.url || tab.error) throw new Error('Open a working website before taking a snapshot.');
        const folder = testing ? path.join(app.getPath('userData'), 'snapshots') : app.getPath('pictures');
        const filename = (tab.title || 'page').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 60) + '-' + Date.now() + '.png';
        let file = path.join(folder, filename);
        if (!testing) { const result = await dialog.showSaveDialog(this.win, { title: 'Save page snapshot', defaultPath: file, filters: [{ name: 'PNG image', extensions: ['png'] }] }); if (result.canceled) return; file = result.filePath; }
        const wasConsole = this.consoleVisible;
        this.showPage();
        try {
          await new Promise(resolve => setTimeout(resolve, 250));
          const image = await tab.view.webContents.capturePage();
          fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, image.toPNG());
          this.lastSnapshot = file; this.recordEvent('snapshot', file);
        } finally { if (wasConsole) this.showConsole(); }
        this.output('Snapshot saved: ' + file); return;
      }
      if (name === 'help' || name === 'get-help' || name === '?') {
        await original.execute.call(this, line);
        this.output('\nNew commands:\n  settings               Numbered realism settings\n  setup                  Visual configuration with live preview\n  split <address>        Two webpages side by side\n  split tab <n>          Split with an existing tab\n  split focus left/right Select which pane commands control\n  split ratio <25–75>    Adjust divider; split swap swaps sides\n  split off              Return to one page\n  workspace save <name>  Save a named group of tabs\n  workspace open <name>  Open a saved group\n  workspaces             List saved workspaces\n  watch on/off           Live loading, download, and find output\n  snapshot               Save a PNG of the active page\n  note                   Autosaving console scratchpad\n  panic                  Instantly show a clean PowerShell prompt\n\nCtrl+L toggles between the prompt and your current tab.\nF8 is the default disguise key. Ctrl+Shift+S saves a snapshot.'); return;
      }
      return await original.execute.call(this, line);
    } catch (error) { this.output(error.message, 'error'); }
  };
};

