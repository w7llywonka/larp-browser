'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, description, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await predicate()) return; await wait(50); }
  throw new Error('Timed out: ' + description);
}

module.exports = async ({ BrowserController, store, writeStore, app, storeFile, controllers }) => {
  let checks = 0;
  const check = (condition, label) => { assert.ok(condition, label); checks++; console.log('PASS ' + label); };
  let postBody = '';
  const server = http.createServer((req, res) => {
    if (req.url === '/download') {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="browser-test.txt"');
      res.end('A real download from the browser engine.');
      return;
    }
    if (req.url === '/cookie') { res.setHeader('Set-Cookie', 'sessionTest=present; Path=/'); }
    if (req.url === '/post') {
      req.on('data', data => postBody += data);
      req.on('end', () => { res.setHeader('Content-Type', 'text/html'); res.end('<title>POST result</title><p>Posted successfully</p>'); });
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><title>${req.url === '/second' ? 'Second page' : 'Browser test'}</title><h1>Browser test page</h1><p id="text">alpha beta alpha</p><a id="second" href="/second">Second</a><a id="popup" href="/popup" target="_blank">New tab</a><form id="post" method="POST" action="/post" target="_blank"><input name="value" value="preserved"><button>Post</button></form>`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const root = 'http://127.0.0.1:' + server.address().port;
  const out = process.env.PSB_VERIFY_OUTPUT || path.resolve(__dirname, '../verification'); fs.mkdirSync(out, { recursive: true });
  const browser = new BrowserController(false, false); await browser.ready;
  const shellWC = browser.shellView.webContents;
  const failures = [];
  shellWC.on('console-message', event => { if (event.level === 'error') failures.push(event.message); });
  await until(() => shellWC.executeJavaScript('!!window.browser && document.querySelector("#prompt").textContent.startsWith("PS C:")'), 'preload and console');
  check(await shellWC.executeJavaScript('getComputedStyle(document.body).backgroundColor === "rgb(1, 36, 86)"'), 'exact classic PowerShell blue');
  check(await shellWC.executeJavaScript('getComputedStyle(document.querySelector("#command")).fontFamily.startsWith("Consolas")'), 'Consolas console typography');
  check(browser.win.getTitle() === 'Windows PowerShell', 'native window title');
  await wait(1100);
  check(await shellWC.executeJavaScript('!document.querySelector("#setup-panel").hidden'), 'first launch shows configuration and preview');
  fs.writeFileSync(path.join(out, 'setup.png'), (await shellWC.capturePage()).toPNG());
  await shellWC.executeJavaScript('document.querySelector("#pref-consoleWindow").checked = false; document.querySelector("#setup-form").requestSubmit();');
  await until(() => store.setupComplete && !browser.setupOpen && !browser.consoleRole, 'setup persists submitted options');
  await wait(250);
  fs.writeFileSync(path.join(out, 'console.png'), (await shellWC.capturePage()).toPNG());

  const formCommand = line => shellWC.executeJavaScript(`document.querySelector('#command').value = ${JSON.stringify(line)}; document.querySelector('#command-form').requestSubmit();`);
  await shellWC.executeJavaScript('window.testFocusCount = 0; const nativeFocus = document.querySelector("#command").focus; document.querySelector("#command").focus = function (...args) { window.testFocusCount++; nativeFocus.apply(this, args); }; void 0;');
  await formCommand('open ' + root + '/cookie');
  await until(() => browser.current().view.webContents.getTitle() === 'Browser test', 'command IPC opens webpage');
  check(browser.consoleVisible === false && browser.attached === browser.current().view, 'webpage occupies window after prompt navigation');
  const firstWC = browser.current().view.webContents;
  check(await firstWC.executeJavaScript('typeof window.browser === "undefined" && typeof require === "undefined" && typeof process === "undefined"'), 'remote webpage cannot access app bridge or Node');
  check((await browser.ses.cookies.get({ url: root })).some(c => c.name === 'sessionTest'), 'regular browsing stores cookies');
  await wait(500);
  check(await shellWC.executeJavaScript('window.testFocusCount === 0'), 'navigation submission never refocuses the hidden console');
  fs.writeFileSync(path.join(out, 'webpage.png'), (await firstWC.capturePage()).toPNG());
  await firstWC.executeJavaScript('document.querySelector("#second").click()', true);
  await until(() => firstWC.getTitle() === 'Second page' && !firstWC.isLoading(), 'link navigation');
  await until(() => firstWC.navigationHistory.canGoBack(), 'back navigation enabled');
  browser.navigation('back'); await until(() => firstWC.getURL() === root + '/cookie', 'back navigation');
  browser.navigation('forward'); await until(() => firstWC.getURL() === root + '/second', 'forward navigation');
  check(firstWC.getURL().endsWith('/second'), 'back and forward work across real page loads');

  const mockEvent = { preventDefault() {} };
  browser.shortcut(mockEvent, { type: 'keyDown', control: true, key: 'l' });
  await until(() => browser.consoleVisible && !browser.attached, 'Ctrl+L console');
  check(browser.consoleVisible && !browser.attached, 'Ctrl+L brings up the actual command console');
  await until(() => shellWC.executeJavaScript('document.querySelector("#command").value.endsWith("/second")'), 'address selected in prompt');
  const key = (key, shift = false) => shellWC.executeJavaScript(`document.querySelector('#command').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, shiftKey: ${shift}, bubbles: true, cancelable: true }));`);
  await shellWC.executeJavaScript('document.querySelector("#command").value="reop"; document.querySelector("#command").dispatchEvent(new Event("input"));');
  await key('Tab');
  check(await shellWC.executeJavaScript('document.querySelector("#command").value === "reopen "'), 'Tab key completes a command in the actual prompt');
  await shellWC.executeJavaScript('document.querySelector("#command").value="tab "; document.querySelector("#command").dispatchEvent(new Event("input"));');
  await key('Tab'); await key('Tab'); await key('Tab', true);
  check(await shellWC.executeJavaScript('document.querySelector("#command").value === "tab 1"'), 'Tab and Shift+Tab cycle argument completions forward and backward');
  await formCommand('bookmark "Integration bookmark"');
  await until(() => store.bookmarks.length === 1, 'bookmark form command');
  await formCommand('history'); await wait(150);
  check(await shellWC.executeJavaScript('document.querySelector("#transcript").textContent.includes("/cookie")'), 'history appears as console output');
  await formCommand('help'); await wait(150);
  check(await shellWC.executeJavaScript('document.querySelector("#transcript").textContent.includes("Ctrl+L")'), 'help documents console commands and shortcuts');
  await formCommand('cls'); await wait(150);
  check(await shellWC.executeJavaScript('document.querySelector("#transcript").children.length === 0'), 'cls clears transcript');
  await formCommand('javascript:alert(1)'); await wait(150);
  check(await shellWC.executeJavaScript('document.querySelector("#transcript .error").textContent.includes("Only http")'), 'unsafe URL blocked through actual prompt');
  check(firstWC.getURL() === root + '/second', 'blocked address leaves website unchanged');

  await browser.execute('new ' + root + '/second');
  await until(() => browser.current().view.webContents.getTitle() === 'Second page', 'new tab loads');
  check(browser.tabs.length === 2, 'new tab command creates separate web contents');
  await browser.execute('tab 1');
  check(browser.current().view.webContents === firstWC, 'tab command switches to original tab');
  await browser.execute('tab next');
  check(browser.active === 1, 'tab next switches without needing a number');
  await browser.execute('tab prev');
  check(browser.active === 0, 'tab prev cycles back');
  await browser.execute('zoom 150'); check(firstWC.getZoomFactor() === 1.5, 'per-page zoom');
  await browser.execute('find alpha'); await wait(250);
  check(browser.current().findText === 'alpha', 'find command searches rendered page');
  const closingWC = browser.tabs[1].view.webContents;
  await closingWC.loadURL(root + '/third');
  closingWC.setZoomFactor(1.25);
  await browser.execute('close 2');
  check(browser.tabs.length === 1 && browser.current().view.webContents === firstWC, 'closing a tab retains the other page');
  await browser.execute('reopen');
  await until(() => browser.current().view.webContents.getURL().endsWith('/third') && !browser.current().view.webContents.isLoading(), 'reopened tab');
  check(browser.tabs.length === 2 && browser.current().view.webContents.getZoomFactor() === 1.25, 'reopen restores closed page and its zoom');
  check(browser.current().view.webContents.navigationHistory.getAllEntries().some(e => e.url.endsWith('/second')), 'reopen preserves the tab navigation history');
  await browser.execute('tab third');
  check(browser.active === 1, 'tab can switch by a matching URL fragment');
  await browser.execute('close 2');
  browser.shortcut(mockEvent, { type: 'keyDown', control: true, shift: true, key: 't' });
  await until(() => browser.tabs.length === 2 && browser.current().view.webContents.getURL().endsWith('/third'), 'Ctrl+Shift+T reopen');
  check(browser.tabs.length === 2, 'Ctrl+Shift+T reopens the closed tab');
  browser.shortcut(mockEvent, { type: 'keyDown', control: true, key: '1' });
  await until(() => browser.active === 0, 'direct tab shortcut');
  check(browser.current().view.webContents === firstWC, 'Ctrl+1 selects the first tab');
  await browser.execute('close 2');
  firstWC.executeJavaScript('document.querySelector("#popup").click()', true).catch(error => console.error('POPUP', error));
  await until(() => browser.tabs.length === 2 && browser.current().view.webContents.getURL().endsWith('/popup'), 'target blank link');
  check(browser.tabs.length === 2 && !browser.consoleVisible, 'target blank links open as browser tabs');
  await browser.execute('tab 1');
  firstWC.executeJavaScript('document.querySelector("#post").requestSubmit()', true).catch(error => console.error('POST', error));
  await until(() => browser.tabs.length === 3 && browser.current().view.webContents.getTitle() === 'POST result', 'POST popup');
  check(postBody === 'value=preserved', 'popup form preserves POST data');

  const privateWindow = new BrowserController(true, false); await privateWindow.ready;
  const beforeHistory = store.history.length;
  const beforeBookmarks = store.bookmarks.length;
  await privateWindow.execute('open ' + root + '/private');
  await until(() => privateWindow.current().view.webContents.getTitle() === 'Browser test', 'private page');
  check((await privateWindow.ses.cookies.get({ url: root })).length === 0, 'private window does not inherit regular cookies');
  check(store.history.length === beforeHistory && privateWindow.history.length === 1, 'private history stays out of persistent profile');
  check(store.bookmarks.length === beforeBookmarks, 'opening private page does not modify bookmarks');
  writeStore();
  const saved = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  check(saved.bookmarks.some(b => b.title === 'Integration bookmark') && saved.history.some(h => h.url.endsWith('/second')), 'bookmarks and history persist on disk');
  check(!saved.history.some(h => h.url.endsWith('/private')), 'private URL absent from saved profile');

  const downloadWC = browser.current().view.webContents;
  downloadWC.downloadURL(root + '/download');
  await until(() => store.downloads.some(d => d.name === 'browser-test.txt' && d.state === 'completed'), 'actual engine download');
  const downloaded = store.downloads.find(d => d.name === 'browser-test.txt');
  check(fs.readFileSync(downloaded.path, 'utf8') === 'A real download from the browser engine.', 'engine downloads and saves exact file contents');
  browser.showConsole(); await browser.execute('downloads');
  await wait(150);
  check(await shellWC.executeJavaScript('document.querySelector("#transcript").textContent.includes("browser-test.txt [completed]")'), 'completed downloads visible in console');
  browser.shortcut(mockEvent, { type: 'keyDown', key: 'F2' });
  await until(() => browser.consoleVisible, 'quick tab list');
  check(browser.consoleVisible, 'F2 brings the tab list into the console');

  // Retry a failed navigation to an address that becomes available afterward.
  const retryServer = http.createServer((_req, res) => res.end('<title>Recovered page</title><h1>Back online</h1>'));
  retryServer.listen(0, '127.0.0.1'); await once(retryServer, 'listening');
  const retryPort = retryServer.address().port;
  await new Promise(resolve => retryServer.close(resolve));
  const retryURL = 'http://127.0.0.1:' + retryPort + '/recovery';
  const originalTab = browser.current();
  await browser.execute('new ' + root + '/before-failure');
  await until(() => browser.current().view.webContents.getTitle() === 'Browser test', 'page before connection failure');
  await browser.execute('open ' + retryURL);
  await until(() => browser.current().error && browser.consoleVisible, 'failed page');
  check(browser.current().url === retryURL, 'failed navigation retains the requested address');
  await browser.execute('status'); await wait(100);
  check(await shellWC.executeJavaScript('document.querySelector("#transcript").textContent.includes("Failed:")'), 'status reports failed connection in console');
  retryServer.listen(retryPort, '127.0.0.1'); await once(retryServer, 'listening');
  await browser.execute('reload');
  await until(() => browser.current().view.webContents.getTitle() === 'Recovered page', 'recovery reload');
  check(browser.current().url === retryURL && !browser.current().error, 'reload retries failed address and clears error on success');
  await browser.closeTab();
  retryServer.close();

  // Blank second windows must not erase existing windows from the saved session.
  const secondWindow = new BrowserController(false, false); await secondWindow.ready;
  await secondWindow.execute('open ' + root + '/other-window');
  await until(() => secondWindow.current().view.webContents.getTitle() === 'Browser test', 'second regular window');
  check(store.tabs.some(url => url.endsWith('/other-window')) && store.tabs.some(url => url.endsWith('/second')), 'saved session includes tabs from both regular windows');
  check(!privateWindow.state().addresses.some(e => e.url.endsWith('/other-window')), 'private completion does not inherit regular history');
  secondWindow.win.destroy();

  await browser.execute('tab 3');
  const spontaneous = browser.current().view.webContents;
  spontaneous.executeJavaScript('window.close()', true).catch(() => {});
  await until(() => browser.tabs.length === 2, 'webpage-initiated tab close');
  check(browser.tabs.length === 2, 'window.close removes the popup tab without leaving a broken entry');

  const previousURL = firstWC.getURL();
  const activeBeforeInvalid = browser.current();
  await browser.execute('tab 99'); check(browser.current() === activeBeforeInvalid, 'invalid tab number cannot change current tab');
  browser.showConsole(); await browser.execute('font 18');
  await until(() => shellWC.executeJavaScript('getComputedStyle(document.querySelector("#command")).fontSize === "18px"'), 'font preferences IPC');
  await browser.execute('font 16');
  check(failures.length === 0, 'no console renderer errors');
  await require('./features.integration')({ browser, privateWindow, shellWC, root, store, writeStore, storeFile, controllers, BrowserController, check, until, wait, out });
  // Check a real public HTTPS site without making it a prerequisite for offline tests.
  await browser.execute('open https://example.com');
  try {
    await until(() => browser.current().view.webContents.getTitle() === 'Example Domain', 'public HTTPS', 15000);
    check(browser.current().view.webContents.getURL().startsWith('https://example.com'), 'public HTTPS website loads');
  } catch (error) { console.log('NETWORK NOTE ' + error.message); }
  for (const c of [...controllers.values()]) c.win.destroy(); server.close();
  await wait(100);
  check(browser.win.isDestroyed() && privateWindow.win.isDestroyed(), 'regular and private window destruction completes without exceptions');
  console.log(`VERIFIED ${checks} integration checks. Screenshots: ${out}`);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: checks, rendererErrors: failures, date: new Date().toISOString(), electron: process.versions.electron, chromium: process.versions.chrome }, null, 2));
};
