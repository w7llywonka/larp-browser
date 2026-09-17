'use strict';
const input = document.getElementById('command');
const form = document.getElementById('command-form');
const transcript = document.getElementById('transcript');
const consoleElement = document.getElementById('console');
const prompt = document.getElementById('prompt');
const cursor = document.getElementById('cursor');
const note = document.getElementById('note-text');
const scratchpad = document.getElementById('scratchpad');
let noteRevision = 0;
let noteFlush = Promise.resolve();
const history = [];
let historyIndex = 0;
let draft = '';
let busy = false;
let state;
let completion = null;
const canvas = document.createElement('canvas');
const context = canvas.getContext('2d');

function scrollBottom() { consoleElement.scrollTop = consoleElement.scrollHeight; }
function updateCursor() {
  context.font = getComputedStyle(input).font;
  const width = context.measureText(input.value.slice(0, input.selectionStart || 0)).width - input.scrollLeft;
  cursor.style.left = Math.max(0, width) + 'px';
  cursor.style.width = context.measureText('M').width + 'px';
  cursor.style.visibility = input.selectionStart !== input.selectionEnd ? 'hidden' : '';
}
function print(text, kind = '') {
  const row = document.createElement('div');
  row.className = 'line' + (kind ? ' ' + kind : '');
  row.textContent = text || ' ';
  transcript.appendChild(row);
  while (transcript.children.length > 2000) transcript.firstElementChild.remove();
  scrollBottom();
}
function applyState(value) {
  state = value;
  prompt.textContent = value.prompt;
  document.documentElement.style.setProperty('--font-size', value.fontSize + 'px');
  document.documentElement.style.setProperty('--line-height', Math.round(value.fontSize * 1.1875) + 'px');
  document.body.classList.toggle('no-blink', value.preferences?.blink === false);
  document.querySelectorAll('.startup-line').forEach(row => row.hidden = value.preferences?.banner === false && !value.disguised);
  window.setupUI.sync(value);
  consoleElement.hidden = value.onboarding || value.editorVisible;
  updateCursor();
}
window.browser.onOutput(({ text, kind, clear }) => {
  if (clear) transcript.replaceChildren();
  if (text !== undefined) print(text, kind);
});
function flushNote() {
  const text = note.value;
  const revision = ++noteRevision;
  document.getElementById('note-status').textContent = 'Saving…';
  noteFlush = noteFlush.catch(() => {}).then(() => window.browser.noteSave(text)).then(result => {
    if (revision === noteRevision) document.getElementById('note-status').textContent = result.private ? 'Saved for this private session' : 'Saved';
  }).catch(error => { document.getElementById('note-status').textContent = error.message; });
  return noteFlush;
}
window.browser.onEditor(value => {
  scratchpad.hidden = !value.open;
  if (value.open) {
    note.value = value.text; consoleElement.hidden = true;
    document.getElementById('note-status').textContent = value.private ? 'Private session only' : 'Saved'; note.focus();
  }
});
note.addEventListener('input', flushNote);
note.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); flushNote(); }
  if (event.key === 'Escape') { event.preventDefault(); flushNote().then(() => window.browser.command('home')); }
});
window.browser.onPanic(() => {
  transcript.replaceChildren();
  for (const text of ['Windows PowerShell', 'Copyright (C) Microsoft Corporation. All rights reserved.', ' ']) print(text);
  input.value = ''; history.length = 0; historyIndex = 0; completion = null;
  scratchpad.hidden = true; document.getElementById('onboarding').hidden = true; consoleElement.hidden = false; input.focus();
});
window.browser.onState(applyState);
window.browser.onFocus(value => {
  completion = null;
  if (typeof value === 'string') input.value = value;
  input.focus();
  if (typeof value === 'string') input.select();
  else input.setSelectionRange(input.value.length, input.value.length);
  scrollBottom(); updateCursor();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const line = input.value;
  print(prompt.textContent + line);
  input.value = '';
  if (line.trim()) { history.push(line); if (history.length > 250) history.shift(); }
  historyIndex = history.length;
  draft = '';
  busy = true;
  updateCursor();
  try { await window.browser.command(line); }
  catch (error) { print(error.message || 'Command failed.', 'error'); }
  finally {
    busy = false;
    completion = null;
    // Do not move focus away from a webpage after a navigation command.
    try { applyState(await window.browser.state()); } catch {}
    if (state?.consoleVisible && !state?.editorVisible && !state?.onboarding) input.focus();
    scrollBottom(); updateCursor();
  }
});
input.addEventListener('keydown', event => {
  if (event.key !== 'Tab') completion = null;
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    if (historyIndex === history.length) draft = input.value;
    historyIndex = Math.max(0, Math.min(history.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
    input.value = historyIndex === history.length ? draft : history[historyIndex];
    input.setSelectionRange(input.value.length, input.value.length);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    if (input.value) input.value = '';
    else window.browser.resume();
  } else if (event.ctrlKey && event.key.toLowerCase() === 'c' && input.selectionStart === input.selectionEnd && !window.getSelection().toString()) {
    event.preventDefault(); print(prompt.textContent + input.value + '^C'); input.value = '';
  } else if (event.key === 'Tab') {
    event.preventDefault();
    if (!completion || input.value !== completion.last) {
      completion = { values: window.browserCompletion.candidates(input.value, state), index: event.shiftKey ? 0 : -1, last: input.value };
    }
    if (completion.values.length) {
      completion.index = (completion.index + completion.values.length + (event.shiftKey ? -1 : 1)) % completion.values.length;
      input.value = completion.values[completion.index];
      completion.last = input.value;
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
  requestAnimationFrame(updateCursor);
});
input.addEventListener('input', () => { completion = null; });
['input', 'click', 'keyup', 'scroll', 'select'].forEach(event => input.addEventListener(event, updateCursor));
consoleElement.addEventListener('click', event => {
  if (!window.getSelection().toString() && event.target !== input) input.focus();
});
window.addEventListener('resize', updateCursor);
window.browser.state().then(applyState).then(() => { input.focus(); updateCursor(); });
