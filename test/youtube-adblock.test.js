'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { shouldBlockYouTubeRequest, configureYouTubeAdBlocking, injection } = require('../youtube-adblock');

test('request filter blocks YouTube ad routes without blocking video and page requests', () => {
  assert.equal(shouldBlockYouTubeRequest({ url: 'https://www.youtube.com/api/stats/ads?ver=2' }), true);
  assert.equal(shouldBlockYouTubeRequest({ url: 'https://www.youtube.com/pagead/adview' }), true);
  assert.equal(shouldBlockYouTubeRequest({ url: 'https://www.youtube.com/watch?v=abc' }), false);
  assert.equal(shouldBlockYouTubeRequest({ url: 'https://rr1---sn.googlevideo.com/videoplayback?id=abc', initiator: 'https://www.youtube.com' }), false);
  assert.equal(shouldBlockYouTubeRequest({ url: 'https://googleads.g.doubleclick.net/pagead/id', initiator: 'https://www.youtube.com' }), true);
  assert.equal(shouldBlockYouTubeRequest({ url: 'https://googleads.g.doubleclick.net/pagead/id', initiator: 'https://example.com' }), false);
});

test('session filter reads the current setting for every request', () => {
  let listener;
  let active = true;
  const ses = { webRequest: { onBeforeRequest(filter, callback) { assert.ok(filter.urls.includes('*://*.youtube.com/*')); listener = callback; } } };
  configureYouTubeAdBlocking(ses, () => active);
  let result;
  listener({ url: 'https://www.youtube.com/ptracking' }, value => { result = value; });
  assert.deepEqual(result, { cancel: true });
  active = false;
  listener({ url: 'https://www.youtube.com/ptracking' }, value => { result = value; });
  assert.deepEqual(result, { cancel: false });
});

test('page helper skips an in-player ad and cleans up immediately when disabled', () => {
  let tick;
  let removed = false;
  const video = { duration: 10, currentTime: 0, muted: false, playbackRate: 1, isConnected: true };
  const style = { id: '', textContent: '', remove() { removed = true; } };
  const document = {
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    createElement() { return style; },
    querySelectorAll() { return [{ click() {} }]; },
    querySelector(selector) {
      if (selector !== '#movie_player') return null;
      return { classList: { contains(value) { return value === 'ad-showing'; } }, querySelector() { return video; } };
    }
  };
  const context = { window: {}, location: { hostname: 'www.youtube.com' }, document, setInterval(fn) { tick = fn; return 7; }, clearInterval() {} };
  assert.equal(vm.runInNewContext(injection(true), context), true);
  tick();
  assert.equal(video.currentTime, 9.95);
  assert.equal(video.muted, true);
  assert.equal(vm.runInNewContext(injection(false), context), false);
  assert.equal(video.muted, false);
  assert.equal(removed, true);
});
