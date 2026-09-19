'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { UpdateService } = require('../updater');

function fixture(supported = true, hasUpdate = true) {
  const updater = new EventEmitter();
  let enabled = true; let calls = 0; let downloads = 0;
  const notices = [];
  updater.downloadUpdate = async () => {
    downloads++;
    updater.emit('download-progress', { percent: 51.8 });
    updater.emit('update-downloaded', { version: '0.5.1' });
  };
  updater.checkForUpdates = async () => {
    calls++;
    updater.emit('checking-for-update');
    if (!hasUpdate) { updater.emit('update-not-available'); return {}; }
    updater.emit('update-available', { version: '0.5.1' });
    return updater.autoDownload ? { downloadPromise: updater.downloadUpdate() } : {};
  };
  updater.quitAndInstall = (...args) => { updater.installArgs = args; };
  const app = new EventEmitter(); app.getVersion = () => '0.5.0';
  const service = new UpdateService({ updater, app, supported, enabled: () => enabled, announce: message => notices.push(message) });
  return { service, updater, notices, calls: () => calls, downloads: () => downloads, disable: () => { enabled = false; service.sync(); } };
}

test('update install checks, waits for download, and restarts in one command', async () => {
  const f = fixture();
  await f.service.install();
  assert.equal(f.calls(), 1); assert.equal(f.downloads(), 1);
  assert.equal(f.service.state.status, 'installing');
  assert.deepEqual(f.updater.installArgs, [true, true]);
  assert.match(f.notices[0], /restart now/);
});

test('downloaded updates can be installed explicitly', async () => {
  const f = fixture();
  f.updater.emit('update-downloaded', { version: '0.5.1' });
  await f.service.install();
  assert.deepEqual(f.updater.installArgs, [true, true]);
});

test('disabling updates stops background checks and automatic installation', async () => {
  const f = fixture(); f.disable(); await f.service.check(false);
  assert.equal(f.calls(), 0); assert.equal(f.updater.autoDownload, false); assert.equal(f.updater.autoInstallOnAppQuit, false);
  await f.service.check(true); assert.equal(f.calls(), 1); assert.equal(f.service.state.status, 'available');
  await f.service.download(); assert.equal(f.service.state.status, 'ready'); assert.equal(f.updater.autoInstallOnAppQuit, false);
});

test('unsupported portable mode never downloads or installs an update', async () => {
  const f = fixture(false); await f.service.check();
  assert.equal(f.calls(), 0); assert.match(f.service.text(), /setup EXE/);
  await assert.rejects(() => f.service.download(), /setup EXE/);
  await assert.rejects(() => f.service.install(), /setup EXE/);
});

test('update install reports when the current version is already latest', async () => {
  const f = fixture(true, false);
  await assert.rejects(() => f.service.install(), /already the latest/);
  assert.equal(f.updater.installArgs, undefined);
});

test('network errors leave browser usable and a future check retries', async () => {
  const f = fixture(); f.updater.checkForUpdates = async () => { throw new Error('offline'); };
  await f.service.check(); assert.equal(f.service.state.status, 'error'); assert.match(f.service.text(), /offline/);
  f.updater.checkForUpdates = async () => f.updater.emit('update-not-available');
  await f.service.check(); assert.equal(f.service.state.status, 'current');
});

test('concurrent requests share one release check', async () => {
  const f = fixture(); await Promise.all([f.service.check(), f.service.check()]);
  assert.equal(f.calls(), 1);
});
