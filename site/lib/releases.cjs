'use strict';
const REPO = 'w7llywonka/larp-browser';
let cache;
function releaseInfo(release) {
  if (release.draft || release.prerelease || !/^v?\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('Invalid stable release.');
  const assets = (release.assets || []).filter(asset => typeof asset.browser_download_url === 'string' && asset.browser_download_url.startsWith('https://github.com/' + REPO + '/releases/download/'));
  const asset = expression => {
    const value = assets.find(a => expression.test(a.name) && a.state === 'uploaded');
    return value ? { name: value.name, url: value.browser_download_url, size: value.size, sha256: /^sha256:[a-f0-9]{64}$/.test(value.digest || '') ? value.digest.slice(7) : null } : null;
  };
  return { version: release.tag_name.replace(/^v/, ''), publishedAt: release.published_at, notes: String(release.body || '').slice(0, 12000), url: 'https://github.com/' + REPO + '/releases/tag/' + release.tag_name,
    installer: asset(/^Larp-Browser-Setup-\d+\.\d+\.\d+\.exe$/), portable: asset(/^PowerShell-Browser-Windows\.zip$/), source: asset(/^PowerShell-Browser-Source\.zip$/) };
}
async function latestRelease() {
  if (cache && cache.until > Date.now()) return cache.value;
  const response = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Larp-Browser-Downloads', ...(process.env.GITHUB_RELEASE_TOKEN ? { Authorization: 'Bearer ' + process.env.GITHUB_RELEASE_TOKEN } : {}) }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Release service unavailable.');
  const value = releaseInfo(await response.json());
  cache = { value, until: Date.now() + 60000 };
  return value;
}
module.exports = { latestRelease, releaseInfo };
