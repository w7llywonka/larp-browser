'use strict';
(function (root) {
  const commands = ['open', 'search', 'back', 'forward', 'reload', 'stop', 'tabs', 'tab', 'new', 'close', 'reopen', 'restore', 'history', 'bookmark', 'bookmarks', 'downloads', 'download', 'private', 'window', 'find', 'zoom', 'settings', 'font', 'home', 'clear', 'cls', 'help', 'site', 'status', 'save', 'print', 'mute', 'about', 'exit', 'setup', 'split', 'workspace', 'workspaces', 'watch', 'snapshot', 'note', 'scratchpad', 'panic', 'disguise', 'update', 'updates', 'adblock'];
  function candidates(line, state = {}) {
    const match = line.match(/^(\S+)\s+([\s\S]*)$/);
    if (!match) return commands.filter(c => c.startsWith(line.toLowerCase())).map(c => c + ' ');
    const command = match[1].toLowerCase();
    const argument = match[2];
    const prefix = match[1] + ' ';
    let values = [];
    if (command === 'tab') {
      const removal = argument.match(/^(remove|close)\s+(.*)$/);
      if (removal) {
        const parts = removal[2].match(/^(.*\s)?(\S*)$/);
        const previous = parts[1] || '';
        const selected = previous.trim().split(/\s+/);
        return (state.tabs || []).map((_, i) => String(i + 1)).filter(number => !selected.includes(number) && number.startsWith(parts[2])).map(number => prefix + removal[1] + ' ' + previous + number);
      }
      values = [...(state.tabs || []).map((_, i) => String(i + 1)), 'next', 'prev', 'last', 'new', 'close', 'remove'];
    }
    else if (command === 'close') values = (state.tabs || []).map((_, i) => String(i + 1));
    else if (command === 'find') values = ['next', 'prev', 'clear'];
    else if (command === 'history') values = ['clear'];
    else if (command === 'settings') values = ['console on', 'console off', 'windows on', 'windows off', 'realism strict', 'realism balanced', 'realism browser', 'title classic', 'title page', 'watch on', 'watch off', 'notifications on', 'notifications off', 'search duckduckgo', 'search google', 'search bing', 'updates on', 'updates off', 'youtubeads on', 'youtubeads off'];
    else if (command === 'split') values = ['off', 'swap', 'focus left', 'focus right', 'ratio 50', ...(state.tabs || []).map((_, i) => 'tab ' + (i + 1))];
    else if (command === 'update' || command === 'updates') values = ['check', 'status', 'download', 'install'];
    else if (command === 'adblock') values = ['on', 'off', 'status'];
    else if (command === 'watch') values = ['on', 'off'];
    else if (command === 'workspace') values = ['save ', 'open ', 'remove ', 'list'];
    else if (command === 'bookmark') values = [...(state.bookmarks || []).flatMap((_, i) => ['open ' + (i + 1), 'remove ' + (i + 1)])];
    else if (command === 'download') values = (state.downloads || []).flatMap(d => {
      if (d.state === 'completed') return ['open ' + d.id, 'show ' + d.id];
      if (['paused', 'interrupted'].includes(d.state)) return ['resume ' + d.id, 'cancel ' + d.id];
      if (d.state === 'progressing') return ['pause ' + d.id, 'cancel ' + d.id];
      return d.path ? ['show ' + d.id] : [];
    });
    else if (['open', 'new', 'start'].includes(command)) {
      return [...new Set((state.addresses || []).filter(entry => {
        const query = argument.toLowerCase();
        return entry.url.toLowerCase().includes(query) || (entry.title || '').toLowerCase().includes(query);
      }).map(entry => prefix + entry.url))].slice(0, 100);
    }
    return values.filter(v => v.toLowerCase().startsWith(argument.toLowerCase())).map(v => prefix + v);
  }
  const api = { candidates };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.browserCompletion = api;
})(typeof window === 'undefined' ? globalThis : window);

