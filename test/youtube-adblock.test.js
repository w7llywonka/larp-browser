'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  shouldBlockYouTubeRequest, configureYouTubeAdBlocking, injection, clickVisibleSkipButton
} = require('../youtube-adblock');

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

test('page helper accelerates ads without synthetic clicks or seeking and restores playback', () => {
  let tick;
  let removed = false;
  let showing = true;
  let currentTime = 0;
  let seeks = 0;
  let plays = 0;
  const video = {
    get currentTime() { return currentTime; },
    set currentTime(value) { currentTime = value; seeks++; },
    muted: false, playbackRate: 1, paused: true, isConnected: true,
    play() { plays++; }
  };
  const style = { id: '', textContent: '', remove() { removed = true; } };
  const document = {
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    createElement() { return style; },
    querySelectorAll() { return []; },
    querySelector(selector) {
      if (selector !== '#movie_player') return null;
      return { classList: { contains(value) { return showing && value === 'ad-showing'; } }, querySelector() { return video; } };
    }
  };
  const context = {
    window: {}, location: { hostname: 'www.youtube.com' }, document,
    getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
    setInterval(fn) { tick = fn; return 7; }, clearInterval() {}
  };
  assert.equal(vm.runInNewContext(injection(true), context), true);
  tick(); tick();
  assert.equal(seeks, 0);
  assert.equal(currentTime, 0);
  assert.equal(video.muted, true);
  assert.equal(video.playbackRate, 16);
  assert.ok(plays >= 1);

  showing = false; tick();
  assert.equal(video.muted, false);
  assert.equal(video.playbackRate, 1);
  assert.equal(vm.runInNewContext(injection(false), context), false);
  assert.equal(removed, true);
});

test('native skip helper sends an Electron mouse click to a visible button', async () => {
  const events = [];
  const webContents = {
    isDestroyed() { return false; },
    getURL() { return 'https://www.youtube.com/watch?v=abc'; },
    async executeJavaScript(source) {
      assert.match(source, /elementFromPoint/);
      return { x: 640, y: 360 };
    },
    sendInputEvent(event) { events.push(event); }
  };
  assert.equal(await clickVisibleSkipButton(webContents), true);
  assert.deepEqual(events.map(event => event.type), ['mouseMove', 'mouseDown', 'mouseUp']);
  assert.equal(events[1].button, 'left');
  assert.equal(events[2].x, 640);
});
