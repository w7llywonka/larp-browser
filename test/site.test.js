'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { releaseInfo } = require('../site/lib/releases.cjs');
const base = 'https://github.com/w7llywonka/larp-browser/releases/download/v0.4.0/';
test('download metadata selects the uploaded installer and verifies repository URLs', () => {
  const release = releaseInfo({ tag_name: 'v0.4.0', assets: [
    { name: 'Larp-Browser-Setup-0.4.0.exe', state: 'uploaded', browser_download_url: base + 'Larp-Browser-Setup-0.4.0.exe', digest: 'sha256:' + 'a'.repeat(64), size: 123 },
    { name: 'PowerShell-Browser-Windows.zip', state: 'uploaded', browser_download_url: 'https://evil.example/file.zip' }
  ] });
  assert.equal(release.version, '0.4.0'); assert.equal(release.installer.size, 123); assert.equal(release.installer.sha256, 'a'.repeat(64)); assert.equal(release.portable, null);
});
test('unpublished installers and unstable releases are not advertised', () => {
  assert.throws(() => releaseInfo({ tag_name: 'v0.4.0', prerelease: true }), /Invalid/);
  assert.throws(() => releaseInfo({ tag_name: '../invalid' }), /Invalid/);
  assert.equal(releaseInfo({ tag_name: 'v0.4.0', assets: [{ name: 'Larp-Browser-Setup-0.4.0.exe', state: 'new', browser_download_url: base + 'setup.exe' }] }).installer, null);
});
