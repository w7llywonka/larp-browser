import { packager } from '@electron/packager';
import path from 'node:path';
const output = process.env.BROWSER_OUTPUT || path.resolve('dist');
const paths = await packager({
  dir: '.', name: 'PowerShell Browser', platform: 'win32', arch: 'x64',
  out: output, overwrite: true, asar: true, prune: true,
  icon: 'assets/powershell.ico', executableName: 'PowerShell Browser',
  appVersion: process.env.npm_package_version, appCopyright: 'Independent PowerShell Browser project',
  win32metadata: { CompanyName: 'Independent project', FileDescription: 'PowerShell Browser', ProductName: 'PowerShell Browser' },
  ignore: [/^\/(?:test|site|release)(?:\/|$)/, /^\/test-profile-/, /^\/verification(?:\/|$)/, /^\/dist(?:\/|$)/, /^\/\.github(?:\/|$)/, /^\/screenshots(?:\/|$)/, /^\/package\.mjs$/, /^\/node_modules\/(?:electron|@electron)(?:\/|$)/],
  windowsSign: undefined
});
console.log(paths.join('\n'));
