'use strict';

const YOUTUBE_HOST = /(^|\.)youtube\.com$/i;
const AD_HOST = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com)$/i;
const YOUTUBE_AD_PATH = /(?:^|\/)(?:api\/stats\/ads|pagead|ptracking|get_midroll_info)(?:\/|$)/i;

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
      'ytd-player-legacy-desktop-watch-ads-renderer', '.ytp-ad-overlay-container',
      'yt-mealbar-promo-renderer', 'ytd-banner-promo-renderer'
    ].join(',') + '{display:none!important}';
    (document.head || document.documentElement).appendChild(style);
    const state = { style, timer: 0, video: null, muted: false, rate: 1, adKey: '', seeked: false };
    const restore = () => {
      if (state.video && state.video.isConnected) {
        if (!state.muted) state.video.muted = false;
        if (state.video.playbackRate > 2) state.video.playbackRate = state.rate;
      }
      state.video = null; state.adKey = ''; state.seeked = false;
    };
    const tick = () => {
      document.querySelectorAll('.ytp-ad-skip-button,.ytp-skip-ad-button,.ytp-ad-skip-button-modern,.ytp-ad-skip-button-slot button,.ytp-ad-overlay-close-button').forEach(button => button.click());
      const player = document.querySelector('#movie_player');
      const video = player && player.querySelector('video');
      const showing = !!player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
      if (!showing || !video) { restore(); return; }
      if (state.video !== video) { restore(); state.video = video; state.muted = video.muted; state.rate = video.playbackRate; }
      const adKey = (video.currentSrc || video.src || '') + '|' + video.duration;
      if (state.adKey !== adKey) { state.adKey = adKey; state.seeked = false; }
      video.muted = true;
      video.playbackRate = 16;
      if (!state.seeked && Number.isFinite(video.duration) && video.duration > 0) {
        state.seeked = true;
        // Seek only once per ad. Repeatedly pinning the playhead near the end
        // prevents YouTube from receiving the media ended transition.
        try { video.currentTime = Math.max(0, video.duration - .01); } catch {}
        Promise.resolve(video.play?.()).catch(() => {});
      }
    };
    state.timer = setInterval(tick, 250);
    state.stop = () => { clearInterval(state.timer); restore(); state.style.remove(); };
    window[KEY] = state;
    tick();
    return true;
  })()`;
}

async function syncYouTubeAdBlocking(webContents, enabled) {
  if (!webContents || webContents.isDestroyed()) return false;
  try { return await webContents.executeJavaScript(injection(enabled), true); } catch { return false; }
}

module.exports = { shouldBlockYouTubeRequest, configureYouTubeAdBlocking, syncYouTubeAdBlocking, injection };
