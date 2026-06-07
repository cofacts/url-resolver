const fetch = require('node-fetch');
const ResolveError = require('./ResolveError');
// eslint-disable-next-line node/no-unpublished-require
const { ResolveError: ResolveErrorEnum } = require('./resolve_error_pb');

const TIMEOUT = 2000; // ms
const MAX_HOPS = 5;
const USER_AGENT =
  process.env.URL_RESOLVER_USER_AGENT ||
  'CofactsBot/1.0 (+https://cofacts.tw/bot)';

const FETCH_OPTS = {
  redirect: 'manual',
  timeout: TIMEOUT,
  headers: { 'User-Agent': USER_AGENT },
};

function mapFetchError(e) {
  const errorStr = e.toString();
  switch (true) {
    case errorStr.startsWith('FetchError: network timeout at:'):
    case errorStr.endsWith('reason: socket hang up'):
    case errorStr.includes('reason: connect ECONNREFUSED'):
      return new ResolveError(ResolveErrorEnum.NOT_REACHABLE, e);

    case errorStr.includes(
      "reason: Hostname/IP doesn't match certificate's altnames"
    ):
      return new ResolveError(ResolveErrorEnum.HTTPS_ERROR, e);

    default:
      return null;
  }
}

/**
 * Follow up to MAX_HOPS redirects starting at `url`. HEAD is preferred; falls
 * back to GET when the server rejects HEAD with 405 or 501.
 *
 * @param {string} url
 * @returns {Promise<{ url: string, status: number }>} final URL and the last
 *   response status. `status` is 0 when no response was obtained.
 */
async function unshorten(url) {
  let current = url;
  let lastStatus = 0;
  const seen = new Set([current]);

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let res;
    try {
      res = await fetch(current, { method: 'HEAD', ...FETCH_OPTS });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(current, { method: 'GET', ...FETCH_OPTS });
      }
    } catch (e) {
      const mapped = mapFetchError(e);
      if (mapped) throw mapped;
      // eslint-disable-next-line no-console
      console.error('[unshorten]', current, e);
      return { url: current, status: lastStatus };
    }

    lastStatus = res.status;
    const location = res.headers.get('location');
    if (!location) return { url: current, status: lastStatus };

    let next;
    try {
      next = new URL(location, current).toString();
    } catch (e) {
      return { url: current, status: lastStatus };
    }

    if (seen.has(next)) return { url: next, status: lastStatus };
    seen.add(next);
    current = next;
  }

  return { url: current, status: lastStatus };
}

module.exports = unshorten;
module.exports.MAX_HOPS = MAX_HOPS;
