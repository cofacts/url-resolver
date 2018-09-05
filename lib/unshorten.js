const fetch = require('node-fetch');

/**
 * @param {string} url
 * @returns {string} unshortened URL, or original URL if not redirected at all
 */
async function unshorten(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual' });

    return res.headers.get('location') || url;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[unshorten]', e);
    return url;
  }
}

module.exports = unshorten;
