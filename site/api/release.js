'use strict';
const { latestRelease } = require('../lib/releases.cjs');
module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const release = await latestRelease();
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=300');
    return res.status(200).json(release);
  } catch { res.setHeader('Cache-Control', 'no-store'); return res.status(503).json({ error: 'Release information is temporarily unavailable.', releases: 'https://github.com/w7llywonka/larp-browser/releases/latest' }); }
};
