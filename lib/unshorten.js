const fetch = require('node-fetch');
const ResolveError = require('./ResolveError');

const TIMEOUT = 2000; // ms

/**
 * @param {string} url
 * @returns {string} unshortened URL, or original URL if not redirected at all
 */
async function unshorten(url) {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      timeout: TIMEOUT,
    });

    return res.headers.get('location') || url;
  } catch (e) {
    if (e.toString().startsWith('FetchError: network timeout at:')) {
      throw new ResolveError('NOT_REACHABLE', e);
    }

    // eslint-disable-next-line no-console
    console.error('[unshorten]', e);
    return url;
  }
}

module.exports = unshorten;
