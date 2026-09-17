'use strict';
window.setupUI = (() => {
  const root = document.getElementById('onboarding');
  const boot = document.getElementById('boot');
  const panel = document.getElementById('setup-panel');
  const form = document.getElementById('setup-form');
  let initialized = false;
  let booted = false;
  let pagePreview = false;
  let disguised = false;
  let custom = false;
  const $ = id => document.getElementById(id);
  const presets = {
    strict: { title: 'classic', watch: false, notifications: false, banner: true, blink: true },
    balanced: { title: 'classic', watch: false, notifications: true, banner: true, blink: true },
    browser: { title: 'page', watch: true, notifications: true, banner: true, blink: true }
  };
  function fill(s) {
    for (const key of ['consoleWindow', 'windows', 'banner', 'watch', 'notifications', 'blink']) $('pref-' + key).checked = s[key];
    $('pref-title').checked = s.title === 'page';
    $('pref-font').value = s.fontSize;
    $('pref-search').value = s.search;
    $('pref-panic').value = s.panic;
    form.querySelectorAll('[name=realism]').forEach(input => input.checked = input.value === s.realism);
    custom = s.realism === 'custom'; renderPreview();
  }
  function value() {
    return {
      realism: custom ? 'custom' : form.querySelector('[name=realism]:checked')?.value || 'custom',
      consoleWindow: $('pref-consoleWindow').checked, windows: $('pref-windows').checked, title: $('pref-title').checked ? 'page' : 'classic',
      banner: $('pref-banner').checked, watch: $('pref-watch').checked, notifications: $('pref-notifications').checked,
      blink: $('pref-blink').checked, fontSize: Number($('pref-font').value), panic: $('pref-panic').value, search: $('pref-search').value
    };
  }
  function renderPreview() {
    const s = value();
    $('font-value').textContent = s.fontSize + ' px';
    $('preview-title').textContent = !disguised && s.title === 'page' ? 'Windows PowerShell - Example Domain' : 'Windows PowerShell';
    $('preview-banner').hidden = !s.banner && !disguised;
    $('preview-console').style.fontSize = Math.round(s.fontSize * .75) + 'px';
    $('preview-console').style.display = pagePreview && !disguised && !s.consoleWindow ? 'none' : 'block';
    $('preview-web').style.display = pagePreview && !disguised && !s.consoleWindow ? 'block' : 'none';
    $('preview-live').hidden = !pagePreview || !s.watch || disguised;
    $('preview-extra').hidden = (!s.windows && !s.consoleWindow) || disguised;
    document.querySelector('#preview-extra div').textContent = s.consoleWindow ? 'Example Domain — webpage in a separate window' : 'PS C:\\Users\\You> _';
    document.querySelector('#preview-extra div').classList.toggle('separate-page-preview', s.consoleWindow && pagePreview);
    $('preview-command').textContent = disguised ? '' : 'open example.com';
    $('preview-hint').hidden = disguised;
    root.querySelector('.preview-cursor').style.animation = s.blink ? '' : 'none';
    $('panic-key').textContent = s.panic === 'ctrlshiftspace' ? 'Ctrl+Shift+Space' : s.panic.toUpperCase();
    $('preview-toggle').textContent = pagePreview && !disguised ? 'Preview prompt' : 'Preview webpage';
    $('preview-disguise').textContent = disguised ? 'Return to preview' : 'Try disguise key';
  }
  form.addEventListener('input', event => {
    if (event.target.name === 'realism') {
      custom = false;
      const s = presets[event.target.value];
      for (const key of ['watch', 'notifications', 'banner', 'blink']) $('pref-' + key).checked = s[key];
      $('pref-title').checked = s.title === 'page';
    } else if (!['pref-font', 'pref-search', 'pref-panic'].includes(event.target.id)) {
      custom = true; form.querySelectorAll('[name=realism]').forEach(input => input.checked = false);
    }
    renderPreview();
  });
  $('preview-toggle').addEventListener('click', () => { disguised = false; pagePreview = !pagePreview; renderPreview(); });
  $('preview-disguise').addEventListener('click', () => { disguised = !disguised; renderPreview(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    $('start-browsing').disabled = true;
    try { await window.browser.configure(value()); root.hidden = true; document.getElementById('command').focus(); }
    catch (error) { $('setup-error').textContent = error.message; }
    finally { $('start-browsing').disabled = false; }
  });
  return {
    sync(state) {
      const shouldOpen = state.onboarding && !state.disguised;
      const opening = root.hidden && shouldOpen;
      root.hidden = !shouldOpen;
      if (!shouldOpen) { initialized = false; return; }
      if (!initialized || opening) { fill(state.preferences); initialized = true; }
      if (!booted) {
        booted = true; panel.hidden = true;
        const lines = ['[OK] Chromium engine initialized', '[OK] Local profile loaded', '[OK] Console interface ready', '[→] Configure your browser'];
        lines.forEach((line, index) => setTimeout(() => { const row = document.createElement('div'); row.textContent = line; $('boot-log').appendChild(row); }, index * 180));
        setTimeout(() => { boot.hidden = true; panel.hidden = false; form.querySelector('input').focus(); }, 900);
      } else { boot.hidden = true; panel.hidden = false; }
    }
  };
})();
