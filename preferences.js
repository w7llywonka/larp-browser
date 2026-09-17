'use strict';
const DEFAULTS = Object.freeze({ realism: 'balanced', consoleWindow: true, windows: false, title: 'classic', banner: true, watch: false, notifications: true, blink: true, fontSize: 16, panic: 'f8', search: 'duckduckgo' });
const PRESETS = {
  strict: { realism: 'strict', title: 'classic', banner: true, watch: false, notifications: false, blink: true },
  balanced: { realism: 'balanced', title: 'classic', banner: true, watch: false, notifications: true, blink: true },
  browser: { realism: 'browser', title: 'page', banner: true, watch: true, notifications: true, blink: true }
};
function preferences(value = {}) {
  const result = { ...DEFAULTS };
  for (const key of ['consoleWindow', 'windows', 'banner', 'watch', 'notifications', 'blink']) if (typeof value[key] === 'boolean') result[key] = value[key];
  if (['strict', 'balanced', 'browser', 'custom'].includes(value.realism)) result.realism = value.realism;
  if (['classic', 'page'].includes(value.title)) result.title = value.title;
  if (['f8', 'f12', 'ctrlshiftspace'].includes(value.panic)) result.panic = value.panic;
  if (['duckduckgo', 'google', 'bing'].includes(value.search)) result.search = value.search;
  if (Number.isInteger(value.fontSize) && value.fontSize >= 12 && value.fontSize <= 32) result.fontSize = value.fontSize;
  return result;
}
function workspaceName(value) {
  const name = value.trim();
  if (!name || name.length > 80 || /[\x00-\x1f]/.test(name)) throw new Error('Use a workspace name of 1–80 characters.');
  return name;
}
module.exports = { DEFAULTS, PRESETS, preferences, workspaceName };
