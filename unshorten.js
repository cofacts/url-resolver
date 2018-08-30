const fetch = require('node-fetch');

/**
 * @param {string} url
 * @returns {string} unshortened URL, or original URL if not redirected at all
 */
async function unshorten(url) {
  const res = await fetch(url, { method: 'HEAD', redirect: 'manual' });

  return res.headers.get('location') || url;
}

module.exports = unshorten;
