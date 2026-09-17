'use strict';

const ENGINES = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q='
};

function destination(text, engine = 'duckduckgo', forceSearch = false) {
  const input = String(text || '').trim();
  if (!input) throw new Error('Enter a website address or a search.');
  if (input.length > 8192) throw new Error('The address is too long.');
  const search = () => (ENGINES[engine] || ENGINES.duckduckgo) + encodeURIComponent(input);
  if (forceSearch) return search();
  if (input === 'about:blank') return input;
  if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^(localhost|[\w.-]+\.\w+):\d+(\/|$)/i.test(input)) {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http:// and https:// website addresses are supported.');
    if (url.username || url.password) throw new Error('Addresses containing embedded passwords are not supported.');
    return url.href;
  }
  if (!/\s/.test(input) && /^(localhost(:\d+)?|\[[:\da-f]+\](:\d+)?|[\w-]+(?:\.[\w-]+)+(:\d+)?)([/?#].*)?$/i.test(input)) {
    return new URL((/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(input) ? 'http://' : 'https://') + input).href;
  }
  return search();
}

function splitCommand(line) {
  const trimmed = String(line).trim();
  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  return match ? { name: match[1].toLowerCase(), argument: (match[2] || '').trim(), raw: trimmed } : { name: '', argument: '', raw: '' };
}

function unquote(value) {
  return /^(["'])[\s\S]*\1$/.test(value) ? value.slice(1, -1) : value;
}

function safeWebURL(url) {
  try { return ['http:', 'https:'].includes(new URL(url).protocol) || url === 'about:blank'; } catch { return false; }
}

function tabIndex(argument, tabs, active) {
  const value = argument.toLowerCase().trim();
  if (value === 'next') return (active + 1) % tabs.length;
  if (['prev', 'previous'].includes(value)) return (active + tabs.length - 1) % tabs.length;
  if (value === 'last') return tabs.length - 1;
  if (/^\d+$/.test(value)) {
    const index = Number(value) - 1;
    if (index >= 0 && index < tabs.length) return index;
    throw new Error('That tab does not exist. Type tabs to see tab numbers.');
  }
  const matches = tabs.map((tab, index) => ({ tab, index })).filter(({ tab }) => (tab.title + ' ' + tab.url).toLowerCase().includes(value));
  if (!value || !matches.length) throw new Error('No matching tab. Type tabs to see open tabs.');
  if (matches.length > 1) throw new Error('More than one tab matches. Use a tab number: ' + matches.map(m => m.index + 1).join(', '));
  return matches[0].index;
}

module.exports = { destination, splitCommand, unquote, safeWebURL, tabIndex, ENGINES };
