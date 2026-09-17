'use strict';
const fs = require('node:fs');
const path = require('node:path');

class UpdateService {
  constructor({ updater, app, enabled, supported, announce = () => {}, log = () => {} }) {
    this.updater = updater; this.app = app; this.enabled = enabled; this.supported = supported;
    this.announce = announce; this.log = log; this.busy = null;
    this.state = { status: supported ? 'idle' : 'unsupported', version: app.getVersion(), nextVersion: null, progress: 0 };
    updater.allowPrerelease = false; updater.allowDowngrade = false;
    updater.autoRunAppAfterInstall = false; updater.disableWebInstaller = true;
    updater.on('checking-for-update', () => this.set({ status: 'checking', error: null }));
    updater.on('update-available', info => this.set({ status: 'available', nextVersion: info.version, progress: 0 }));
    updater.on('update-not-available', () => this.set({ status: 'current', nextVersion: null, error: null }));
    updater.on('download-progress', info => this.set({ status: 'downloading', progress: Math.floor(info.percent) }));
    updater.on('update-downloaded', info => {
      this.set({ status: 'ready', nextVersion: info.version, progress: 100 });
      this.announce('Update ' + info.version + ' downloaded. ' + (this.enabled() ? 'It will install when you exit the browser. ' : '') + 'Use update install to restart now.');
    });
    updater.on('error', error => this.set({ status: 'error', error: error.message }));
    this.sync();
  }
  set(change) { Object.assign(this.state, change); this.log(JSON.stringify(change)); }
  sync() {
    this.updater.autoDownload = this.enabled();
    this.updater.autoInstallOnAppQuit = this.enabled();
  }
  start() {
    if (!this.supported) return;
    this.first = setTimeout(() => this.check(false), 15000); this.first.unref?.();
    this.interval = setInterval(() => this.check(false), 6 * 60 * 60 * 1000); this.interval.unref?.();
    this.app.once('before-quit', () => this.stop());
  }
  stop() { clearTimeout(this.first); clearInterval(this.interval); }
  async check(manual = true) {
    if (!this.supported || (!manual && !this.enabled())) return this.state;
    if (this.state.status === 'ready' || this.state.status === 'downloading') return this.state;
    if (this.busy) return this.busy;
    this.sync();
    this.busy = Promise.resolve().then(() => this.updater.checkForUpdates()).then(result => {
      // Automatic downloads outlive the check. Handle their rejection too,
      // so a failed download cannot become an unhandled main-process error.
      result?.downloadPromise?.catch(error => this.set({ status: 'error', error: error.message }));
    }).catch(error => {
      this.set({ status: 'error', error: error.message });
    }).then(() => this.state).finally(() => { this.busy = null; });
    return this.busy;
  }
  async download() {
    if (!this.supported) throw new Error('Install the browser using the setup EXE to enable updates.');
    if (this.state.status === 'ready' || this.state.status === 'downloading') return;
    await this.check(true);
    if (this.state.status !== 'available') return;
    try { await this.updater.downloadUpdate(); }
    catch (error) { this.set({ status: 'error', error: error.message }); throw new Error('Update download failed. Please try again later.'); }
  }
  install() {
    if (this.state.status !== 'ready') throw new Error('No downloaded update. Use update or update download first.');
    this.updater.quitAndInstall(true, true);
  }
  text() {
    if (!this.supported) return 'Automatic updates require the installed Windows edition. Download the setup EXE from https://github.com/w7llywonka/larp-browser/releases/latest. Your current profile will be preserved.';
    const messages = {
      idle: 'Waiting for the next update check.', checking: 'Checking for updates…', current: 'You have the latest version.',
      available: 'Update ' + this.state.nextVersion + ' is available. Use update download to download it.',
      downloading: 'Downloading ' + this.state.nextVersion + ': ' + this.state.progress + '%',
      ready: 'Update ' + this.state.nextVersion + ' is ready. It will install on exit when automatic updates are on. Use update install to restart now.',
      error: 'Update check failed. The browser still works; it will try again later.'
    };
    return 'PowerShell Browser ' + this.state.version + ' | Automatic updates: ' + (this.enabled() ? 'on' : 'off') + '\n' + messages[this.state.status];
  }
}

function createUpdateService({ app, enabled, announce, disabled = false }) {
  const { autoUpdater } = require('electron-updater');
  const log = message => {
    try { fs.appendFileSync(path.join(app.getPath('userData'), 'updater.log'), new Date().toISOString() + ' ' + message + '\n'); } catch {}
  };
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
  const supported = !disabled && app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR && !process.env.PORTABLE_EXECUTABLE_FILE && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  return new UpdateService({ updater: autoUpdater, app, enabled, supported, announce, log });
}
module.exports = { UpdateService, createUpdateService };
