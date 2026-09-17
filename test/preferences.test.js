'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { preferences, DEFAULTS, workspaceName } = require('../preferences');
test('invalid persisted preferences fall back to safe defaults', () => {
  assert.deepEqual(preferences({ fontSize: 100, windows: 'yes', panic: 'x', search: 'bad', consoleWindow: 0 }), DEFAULTS);
});
test('all separate window options and user selections survive validation', () => {
  const s = preferences({ consoleWindow: false, windows: true, fontSize: 20, panic: 'f12', title: 'page' });
  assert.equal(s.consoleWindow, false); assert.equal(s.windows, true); assert.equal(s.fontSize, 20); assert.equal(s.panic, 'f12');
});
test('workspace names reject empty and control text', () => {
  assert.equal(workspaceName(' Work '), 'Work'); assert.throws(() => workspaceName('')); assert.throws(() => workspaceName('bad\nname'));
});
