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
    const errString = e.toString();

    switch (true) {
      case errString.startsWith('FetchError: network timeout at:'):
      case errString.endsWith('reason: socket hang up'):
      case errString.includes('reason: connect ECONNREFUSED'):
        throw new ResolveError('NOT_REACHABLE', e);

      default:
        // eslint-disable-next-line no-console
        console.error('[unshorten]', url, e);
        return url;
    }
  }
}

module.exports = unshorten;
