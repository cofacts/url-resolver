const fetch = require('node-fetch');
const ResolveError = require('./ResolveError');
// eslint-disable-next-line node/no-unpublished-require
const { ResolveError: ResolveErrorEnum } = require('./resolveError_pb');

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
    const errorStr = e.toString();

    switch (true) {
      case errorStr.startsWith('FetchError: network timeout at:'):
      case errorStr.endsWith('reason: socket hang up'):
      case errorStr.includes('reason: connect ECONNREFUSED'):
        throw new ResolveError(ResolveErrorEnum.NOT_REACHABLE, e);

      case errorStr.includes(
        "reason: Hostname/IP doesn't match certificate's altnames"
      ):
        throw new ResolveError(ResolveErrorEnum.HTTPS_ERROR, e);

      default:
        // eslint-disable-next-line no-console
        console.error('[unshorten]', url, e);
        return url;
    }
  }
}

module.exports = unshorten;
