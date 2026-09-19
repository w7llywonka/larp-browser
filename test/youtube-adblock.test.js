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

test('page helper finishes each ad once and restores normal playback afterward', () => {
  let tick;
  let removed = false;
  let showing = true;
  let source = 'ad-one';
  let duration = 10;
  let currentTime = 0;
  let seeks = 0;
  let clicks = 0;
  let plays = 0;
  const video = {
    get duration() { return duration; },
    get currentSrc() { return source; },
    get currentTime() { return currentTime; },
    set currentTime(value) { currentTime = value; seeks++; },
    muted: false, playbackRate: 1, isConnected: true,
    play() { plays++; }
  };
  const style = { id: '', textContent: '', remove() { removed = true; } };
  const document = {
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    createElement() { return style; },
    querySelectorAll() { return [{ click() { clicks++; } }]; },
    querySelector(selector) {
      if (selector !== '#movie_player') return null;
      return { classList: { contains(value) { return showing && value === 'ad-showing'; } }, querySelector() { return video; } };
    }
  };
  const context = { window: {}, location: { hostname: 'www.youtube.com' }, document, setInterval(fn) { tick = fn; return 7; }, clearInterval() {} };
  assert.equal(vm.runInNewContext(injection(true), context), true);
  tick(); tick();
  assert.equal(seeks, 1);
  assert.ok(Math.abs(currentTime - 9.99) < 0.001);
  assert.equal(video.muted, true);
  assert.equal(video.playbackRate, 16);
  assert.equal(plays, 1);
  assert.ok(clicks >= 3);

  source = 'ad-two'; duration = 5; tick();
  assert.equal(seeks, 2);
  assert.ok(Math.abs(currentTime - 4.99) < 0.001);

  showing = false; tick();
  assert.equal(video.muted, false);
  assert.equal(video.playbackRate, 1);
  assert.equal(vm.runInNewContext(injection(false), context), false);
  assert.equal(removed, true);
});
