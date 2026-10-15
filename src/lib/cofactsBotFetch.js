const fetch = require('node-fetch');

const FETCH_TIMEOUT = 5000; // ms
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MiB cap on HTML body
const USER_AGENT =
  process.env.URL_RESOLVER_USER_AGENT ||
  'CofactsBot/1.0 (+https://cofacts.tw/bot)';

/**
 * An unfurl-compatible `opts.fetch` that performs the real network request with
 * the CofactsBot User-Agent (unfurl's default is `facebookexternalhit`). unfurl
 * runs its own status/content-type/charset handling against the returned object.
 *
 * @param {string} url
 * @returns {Promise<{url: string, status: number, arrayBuffer: () => Promise<Buffer>, headers: {get: (name: string) => ?string}}>}
 */
async function cofactsBotFetch(url) {
  const res = await fetch(url, {
    method: 'GET',
    timeout: FETCH_TIMEOUT,
    size: MAX_BODY_BYTES,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  return {
    url: res.url || url,
    status: res.status,
    arrayBuffer: () => res.arrayBuffer(),
    headers: { get: name => res.headers.get(name) },
  };
}

module.exports = { cofactsBotFetch };
