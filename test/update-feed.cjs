'use strict';
// Exercises the actual NSIS updater against a local release feed. The installer
// handoff is intercepted: this test never installs software or changes shortcuts.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { NsisUpdater } = require('electron-updater');
const { NodeHttpExecutor } = require('builder-util/out/nodeHttpExecutor');
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');
const { UpdateService } = require('../updater');
(async () => {
  const installer = path.resolve(process.argv[2]);
  const payload = fs.readFileSync(installer);
  const filename = path.basename(installer);
  const version = require('../package.json').version;
  const hash = crypto.createHash('sha512').update(payload).digest('base64');
  let corrupt = false;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/latest.yml')) { res.end('version: ' + version + '\nfiles:\n  - url: ' + filename + '\n    sha512: ' + hash + '\n    size: ' + payload.length + '\npath: ' + filename + '\nsha512: ' + hash + '\n'); }
    else if (req.url.startsWith('/' + filename)) { res.end(corrupt ? Buffer.from('corrupt download') : payload); }
    else { res.writeHead(404); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const base = path.resolve(__dirname, '../verification/update-feed'); fs.mkdirSync(base, { recursive: true });
    function instance(name, version = '0.3.9') {
      const folder = path.join(base, name + '-' + Date.now()); fs.mkdirSync(folder, { recursive: true });
      const config = path.join(folder, 'app-update.yml');
      const url = 'http://127.0.0.1:' + server.address().port + '/';
      fs.writeFileSync(config, 'provider: generic\nurl: ' + url + '\nupdaterCacheDirName: ' + name + '\n');
      const quitHandlers = [];
      const adapter = { version, name: 'Larp Browser Test', isPackaged: true, appUpdateConfigPath: config, userDataPath: folder, baseCachePath: folder, whenReady: async () => {}, onQuit: callback => quitHandlers.push(callback) };
      const updater = new NsisUpdater(null, adapter);
      updater.httpExecutor = new NodeHttpExecutor();
      updater.httpExecutor.download = ElectronHttpExecutor.prototype.download;
      updater.setFeedURL({ provider: 'generic', url });
      updater.logger = { info() {}, warn() {}, error: console.error }; updater.disableDifferentialDownload = true;
      const service = new UpdateService({ updater, app: { getVersion: () => version }, supported: true, enabled: () => false });
      return { updater, service, quitHandlers };
    }
    const good = instance('verified'); await good.service.check(); await good.service.download();
    assert.equal(good.service.state.status, 'ready');
    console.log('PASS actual NSIS updater checks manifest, downloads installer, and verifies checksum');
    good.service.enabled = () => true; good.service.sync();
    let handedOff = false;
    good.updater.doInstall = options => { assert.equal(crypto.createHash('sha512').update(fs.readFileSync(good.updater.installerPath)).digest('base64'), hash); assert.equal(options.isSilent, true); handedOff = true; return true; };
    good.updater.addQuitHandler(); good.quitHandlers.forEach(handler => handler(0));
    assert.ok(handedOff); console.log('PASS automatic exit hands the verified installer to NSIS installation');
    const manual = instance('manual');
    let manualHandoff = false;
    manual.updater.doInstall = options => {
      assert.equal(crypto.createHash('sha512').update(fs.readFileSync(manual.updater.installerPath)).digest('base64'), hash);
      assert.equal(options.isSilent, true); assert.equal(options.isForceRunAfter, true);
      manualHandoff = true; return true;
    };
    manual.updater.quitAndInstall = (silent, forceRun) => {
      assert.equal(silent, true); assert.equal(forceRun, true);
      assert.equal(manual.updater.install(silent, forceRun), true);
    };
    await manual.service.install();
    assert.ok(manualHandoff); console.log('PASS update install checks, downloads, and requests a forced restart');
    corrupt = true;
    const bad = instance('corrupt'); bad.updater.logger.error = () => {}; await bad.service.check(); await assert.rejects(() => bad.service.download());
    assert.equal(bad.service.state.status, 'error'); console.log('PASS corrupted installer is rejected before installation');
    const current = instance('current', version); await current.service.check();
    assert.equal(current.service.state.status, 'current'); console.log('PASS current installed version does not download itself again');
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

