'use strict';
const page = document.querySelector('#demo-page');
const openButton = document.querySelector('#demo-open');
const disguiseButton = document.querySelector('#demo-disguise');
function preview(disguised) {
  page.hidden = disguised;
  document.querySelector('#demo-log').hidden = disguised;
  document.querySelector('#demo-typed').textContent = disguised ? '' : 'open example.com';
  document.querySelector('#disguise-stamp').hidden = !disguised;
  openButton.setAttribute('aria-pressed', String(!disguised)); disguiseButton.setAttribute('aria-pressed', String(disguised));
}
openButton.addEventListener('click', () => preview(false));
disguiseButton.addEventListener('click', () => preview(true));
async function loadRelease() {
  const status = document.querySelector('#release-status');
  try {
    const response = await fetch('/api/release');
    if (!response.ok) throw new Error('Unavailable');
    const release = await response.json();
    document.querySelectorAll('[data-version]').forEach(el => el.textContent = 'v' + release.version);
    document.querySelector('#release-link').href = release.url;
    document.querySelector('#release-date').textContent = release.publishedAt ? 'Released ' + new Date(release.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Latest public release';
    status.textContent = release.installer ? '✓ Latest installer ready to download' : 'Installer coming soon · view latest release';
    document.querySelectorAll('[data-installer]').forEach(link => { link.setAttribute('aria-label', 'Download Larp Browser ' + release.version + ' for Windows'); });
  } catch {
    document.querySelectorAll('[data-version]').forEach(el => el.textContent = 'Latest stable release');
    document.querySelector('#release-date').textContent = 'Release details temporarily unavailable.';
    status.textContent = 'Download links still open the latest GitHub release.';
  }
}
loadRelease();
