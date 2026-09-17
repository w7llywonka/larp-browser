const { test } = require('node:test');
const assert = require('node:assert/strict');
const { destination, splitCommand, unquote, safeWebURL } = require('../core');
const { tabIndex } = require('../core');
const { candidates } = require('../completion');
test('addresses and searches resolve without evaluating command text', () => {
  assert.equal(destination('example.com'), 'https://example.com/');
  assert.equal(destination('localhost:8080/page'), 'http://localhost:8080/page');
  assert.equal(destination('127.0.0.1:8080'), 'http://127.0.0.1:8080/');
  assert.equal(destination('https://example.com/a?q=1'), 'https://example.com/a?q=1');
  assert.equal(destination('some search words'), 'https://duckduckgo.com/?q=some%20search%20words');
  assert.equal(destination('example.com', 'google', true), 'https://www.google.com/search?q=example.com');
  assert.equal(destination('$(Get-Process)'), 'https://duckduckgo.com/?q=%24(Get-Process)');
});
test('privileged protocols and embedded credentials cannot become web pages', () => {
  for (const value of ['file:///C:/Windows/system.ini', 'javascript:alert(1)', 'data:text/html,test', 'https://user:secret@example.com']) assert.throws(() => destination(value));
  assert.equal(safeWebURL('file:///C:/test'), false);
  assert.equal(safeWebURL('https://example.com'), true);
  assert.throws(() => destination(''));
});
test('command parsing preserves URLs, spacing within searches, and quotes', () => {
  assert.deepEqual(splitCommand(' OPEN https://example.com/?q=a=b '), { name: 'open', argument: 'https://example.com/?q=a=b', raw: 'OPEN https://example.com/?q=a=b' });
  assert.equal(unquote('"hello world"'), 'hello world');
  assert.equal(splitCommand('search cats   and dogs').argument, 'cats   and dogs');
});
test('tab names resolve uniquely and ambiguous names do not switch arbitrarily', () => {
  const tabs = [{ title: 'Wikipedia', url: 'https://wikipedia.org/' }, { title: 'GitHub', url: 'https://github.com/' }, { title: 'GitHub issues', url: 'https://github.com/issues' }];
  assert.equal(tabIndex('wiki', tabs, 0), 0);
  assert.equal(tabIndex('NEXT', tabs, 2), 0);
  assert.equal(tabIndex('prev', tabs, 0), 2);
  assert.equal(tabIndex('last', tabs, 0), 2);
  assert.equal(tabIndex('2', tabs, 0), 1);
  assert.throws(() => tabIndex('github', tabs, 0), /More than one/);
  assert.throws(() => tabIndex('99', tabs, 0), /does not exist/);
  assert.throws(() => tabIndex('missing', tabs, 0), /No matching/);
});
test('completion understands command arguments and bookmark/history titles', () => {
  const state = { tabs: [{}, {}], bookmarks: [{}], addresses: [{ title: 'Wikipedia', url: 'https://wikipedia.org/' }, { title: 'Duplicate', url: 'https://wikipedia.org/' }], downloads: [{ id: 7, state: 'completed' }, { id: 8, state: 'progressing' }] };
  assert.deepEqual(candidates('reop', state), ['reopen ']);
  assert.deepEqual(candidates('tab ', state), ['tab 1', 'tab 2', 'tab next', 'tab prev', 'tab last', 'tab new', 'tab close', 'tab remove']);
  assert.deepEqual(candidates('tab remove 1 ', state), ['tab remove 1 2']);
  assert.deepEqual(candidates('open wiki', state), ['open https://wikipedia.org/']);
  assert.deepEqual(candidates('bookmark open ', state), ['bookmark open 1']);
  assert.deepEqual(candidates('download pause ', state), ['download pause 8']);
  assert.deepEqual(candidates('settings search g', state), ['settings search google']);
  assert.deepEqual(candidates('javascript:', state), []);
});
