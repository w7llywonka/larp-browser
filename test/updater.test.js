'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { UpdateService } = require('../updater');
function fixture(supported = true) {
  const updater = new EventEmitter(); let enabled = true; let calls = 0; const notices = [];
  updater.checkForUpdates = async () => { calls++; updater.emit('checking-for-update'); updater.emit('update-available', { version: '0.5.0' }); };
  updater.downloadUpdate = async () => { updater.emit('download-progress', { percent: 51.8 }); updater.emit('update-downloaded', { version: '0.5.0' }); };
  updater.quitAndInstall = (...args) => { updater.installArgs = args; };
  const app = new EventEmitter(); app.getVersion = () => '0.4.0';
  const service = new UpdateService({ updater, app, supported, enabled: () => enabled, announce: message => notices.push(message) });
  return { service, updater, notices, calls: () => calls, disable: () => { enabled = false; service.sync(); } };
}
test('updater tracks release download and explicit installation', async () => {
  const f = fixture(); await f.service.check();
  assert.equal(f.service.state.nextVersion, '0.5.0'); assert.equal(f.updater.autoDownload, true);
  f.updater.emit('download-progress', { percent: 51.8 }); assert.equal(f.service.state.progress, 51);
  f.updater.emit('update-downloaded', { version: '0.5.0' });
  assert.equal(f.service.state.status, 'ready'); assert.match(f.notices[0], /install when you exit/);
  f.service.install(); assert.deepEqual(f.updater.installArgs, [true, true]);
});
test('disabling updates stops background checks and automatic installation', async () => {
  const f = fixture(); f.disable(); await f.service.check(false);
  assert.equal(f.calls(), 0); assert.equal(f.updater.autoDownload, false); assert.equal(f.updater.autoInstallOnAppQuit, false);
  await f.service.check(true); assert.equal(f.calls(), 1);
  await f.service.download(); assert.equal(f.service.state.status, 'ready'); assert.equal(f.updater.autoInstallOnAppQuit, false);
});
test('unsupported portable mode never downloads or installs an update', async () => {
  const f = fixture(false); await f.service.check();
  assert.equal(f.calls(), 0); assert.match(f.service.text(), /setup EXE/);
  await assert.rejects(() => f.service.download(), /setup EXE/); assert.throws(() => f.service.install(), /No downloaded update/);
});
test('network errors leave browser usable and a future check retries', async () => {
  const f = fixture(); f.updater.checkForUpdates = async () => { throw new Error('offline'); };
  await f.service.check(); assert.equal(f.service.state.status, 'error'); assert.match(f.service.text(), /browser still works/);
  f.updater.checkForUpdates = async () => f.updater.emit('update-not-available');
  await f.service.check(); assert.equal(f.service.state.status, 'current');
});
test('concurrent requests share one release check', async () => {
  const f = fixture(); await Promise.all([f.service.check(), f.service.check()]); assert.equal(f.calls(), 1);
});
