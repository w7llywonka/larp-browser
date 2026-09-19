'use strict';

const YOUTUBE_HOST = /(^|\.)youtube\.com$/i;
const AD_HOST = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com)$/i;
const YOUTUBE_AD_PATH = /(?:^|\/)(?:api\/stats\/ads|pagead|ptracking|get_midroll_info)(?:\/|$)/i;
const nativeSkipTimers = new WeakMap();

function youtubeURL(value) {
  try { return YOUTUBE_HOST.test(new URL(value).hostname); } catch { return false; }
}

function shouldBlockYouTubeRequest(details = {}) {
  let url;
  try { url = new URL(details.url); } catch { return false; }
  if (YOUTUBE_HOST.test(url.hostname) && YOUTUBE_AD_PATH.test(url.pathname)) return true;
  if (!AD_HOST.test(url.hostname)) return false;
  return [details.initiator, details.documentURL, details.referrer].some(youtubeURL);
}

function configureYouTubeAdBlocking(ses, enabled) {
  const urls = [
    '*://youtube.com/*', '*://*.youtube.com/*',
    '*://*.doubleclick.net/*', '*://*.googlesyndication.com/*', '*://*.googleadservices.com/*'
  ];
  ses.webRequest.onBeforeRequest({ urls }, (details, callback) => {
    callback({ cancel: enabled() && shouldBlockYouTubeRequest(details) });
  });
}

function injection(enabled) {
  return `(() => {
    const KEY = '__powershellBrowserYouTubeAdBlocker';
    const old = window[KEY];
    if (old) old.stop();
    if (!${enabled ? 'true' : 'false'} || !/(^|\\.)youtube\\.com$/i.test(location.hostname)) { delete window[KEY]; return false; }
    const style = document.createElement('style');
    style.id = 'powershell-browser-youtube-adblock';
    style.textContent = [
      '#player-ads', '#masthead-ad', 'ytd-ad-slot-renderer', 'ytd-display-ad-renderer',
      'ytd-in-feed-ad-layout-renderer', 'ytd-promoted-sparkles-web-renderer',
      'ytd-companion-slot-renderer', 'ytd-action-companion-ad-renderer',
      'ytd-player-legacy-desktop-watch-ads-renderer', '.ytp-ad-overlay-slot',
      'yt-mealbar-promo-renderer', 'ytd-banner-promo-renderer'
    ].join(',') + '{display:none!important}';
    (document.head || document.documentElement).appendChild(style);
    const state = { style, timer: 0, video: null, muted: false, rate: 1 };
    const restore = () => {
      if (state.video && state.video.isConnected) {
        if (!state.muted) state.video.muted = false;
        if (state.video.playbackRate > 2) state.video.playbackRate = state.rate;
      }
      state.video = null;
    };
    const visible = element => {
      if (!element) return false;
      const box = element.getBoundingClientRect?.();
      const css = getComputedStyle(element);
      return !!box && box.width > 0 && box.height > 0 && css.display !== 'none' &&
        css.visibility !== 'hidden' && Number(css.opacity || 1) > 0;
    };
    const tick = () => {
      const player = document.querySelector('#movie_player');
      const video = player && player.querySelector('video');
      const adMarker = document.querySelector([
        '.ytp-ad-player-overlay-layout__ad-info-container', '.ytp-ad-progress',
        '.ytp-ad-preview-container', '.ytp-ad-text'
      ].join(','));
      const showing = !!player && (player.classList.contains('ad-showing') ||
        player.classList.contains('ad-interrupting') || visible(adMarker));
      if (!showing || !video) { restore(); return; }
      if (state.video !== video) { restore(); state.video = video; state.muted = video.muted; state.rate = video.playbackRate; }
      video.muted = true;
      video.playbackRate = 16;
      if (video.paused) Promise.resolve(video.play?.()).catch(() => {});
    };
    state.timer = setInterval(tick, 250);
    state.stop = () => { clearInterval(state.timer); restore(); state.style.remove(); };
    window[KEY] = state;
    tick();
    return true;
  })()`;
}

function skipButtonCoordinates() {
  return `(() => {
    const selector = [
      '.ytp-ad-skip-button', '.ytp-skip-ad-button', '.ytp-ad-skip-button-modern',
      '.ytp-ad-skip-button-slot button', 'button[aria-label^="Skip"]'
    ].join(',');
    for (const match of document.querySelectorAll(selector)) {
      const button = match.closest('button') || match;
      const box = button.getBoundingClientRect();
      const css = getComputedStyle(button);
      const x = Math.floor(box.left + box.width / 2);
      const y = Math.floor(box.top + box.height / 2);
      const top = document.elementFromPoint(x, y);
      if (!button.disabled && box.width >= 20 && box.height >= 10 &&
          box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight &&
          css.display !== 'none' && css.visibility !== 'hidden' && css.pointerEvents !== 'none' &&
          Number(css.opacity || 1) > 0 && top && (top === button || button.contains(top))) {
        return { x, y };
      }
    }
    return null;
  })()`;
}

async function clickVisibleSkipButton(webContents) {
  if (!webContents || webContents.isDestroyed() || !youtubeURL(webContents.getURL())) return false;
  try {
    const point = await webContents.executeJavaScript(skipButtonCoordinates(), true);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
    webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    return true;
  } catch { return false; }
}

function stopNativeSkipping(webContents) {
  const state = nativeSkipTimers.get(webContents);
  if (!state) return;
  clearInterval(state.timer);
  nativeSkipTimers.delete(webContents);
}

function startNativeSkipping(webContents) {
  stopNativeSkipping(webContents);
  const state = { busy: false, lastClick: 0, timer: null };
  const tick = async () => {
    if (webContents.isDestroyed() || !youtubeURL(webContents.getURL())) {
      stopNativeSkipping(webContents);
      return;
    }
    if (state.busy || Date.now() - state.lastClick < 750) return;
    state.busy = true;
    if (await clickVisibleSkipButton(webContents)) state.lastClick = Date.now();
    state.busy = false;
  };
  state.timer = setInterval(tick, 250);
  state.timer.unref?.();
  nativeSkipTimers.set(webContents, state);
  tick();
}

async function syncYouTubeAdBlocking(webContents, enabled) {
  if (!webContents || webContents.isDestroyed()) return false;
  if (enabled && youtubeURL(webContents.getURL())) startNativeSkipping(webContents);
  else stopNativeSkipping(webContents);
  try { return await webContents.executeJavaScript(injection(enabled), true); } catch { return false; }
}

module.exports = {
  shouldBlockYouTubeRequest, configureYouTubeAdBlocking, syncYouTubeAdBlocking,
  injection, skipButtonCoordinates, clickVisibleSkipButton
};
