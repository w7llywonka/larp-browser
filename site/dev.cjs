'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const publicRoot = path.join(__dirname, 'public');
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.status = code => { res.statusCode = code; return res; };
  res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  res.redirect = (code, target) => { res.writeHead(code, { Location: target }); res.end(); };
  req.query = Object.fromEntries(url.searchParams);
  if (['/api/release', '/api/download'].includes(url.pathname)) return require('./api/' + url.pathname.slice(5) + '.js')(req, res);
  let filename;
  try { filename = path.resolve(publicRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  if (!filename.startsWith(publicRoot + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const data = fs.readFileSync(filename);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(filename)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log('Download site: http://127.0.0.1:' + (process.env.PORT || 4173)));
