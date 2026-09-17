'use strict';
const { latestRelease } = require('../lib/releases.cjs');
module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return res.status(405).json({ error: 'Method not allowed' }); }
  const kind = req.query.kind || 'installer';
  if (!['installer', 'portable', 'source'].includes(kind)) return res.status(400).json({ error: 'Unknown download type.' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    const release = await latestRelease();
    const file = release[kind];
    if (!file) return res.redirect(302, release.url);
    return res.redirect(302, file.url);
  } catch { return res.redirect(302, 'https://github.com/w7llywonka/larp-browser/releases/latest'); }
};
