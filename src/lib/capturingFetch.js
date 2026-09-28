const fetch = require('node-fetch');

const FETCH_TIMEOUT = 5000; // ms
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MiB cap on HTML body
const USER_AGENT =
  process.env.URL_RESOLVER_USER_AGENT ||
  'CofactsBot/1.0 (+https://cofacts.tw/bot)';

/**
 * Returns an unfurl-compatible `opts.fetch` that performs the real network
 * request and, as a side effect, records the raw response bytes into
 * `capture` so the caller can reuse them (e.g. for Readability) without a
 * second request. unfurl's own status/content-type/charset handling runs
 * unmodified against the object this returns, so behavior stays identical
 * to unfurl's default fetch — only the transport is shared.
 *
 * @param {{buffer?: Buffer, status?: number, contentType?: string, finalUrl?: string}} capture
 * @returns {(url: string) => Promise<{status: number, arrayBuffer: () => Promise<Buffer>, headers: {get: (name: string) => ?string}}>}
 */
function createCapturingFetch(capture) {
  return async function capturingFetch(url) {
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
    const buf = Buffer.from(await res.arrayBuffer());
    capture.buffer = buf;
    capture.status = res.status;
    capture.contentType = res.headers.get('content-type');
    capture.finalUrl = res.url;
    return {
      status: res.status,
      arrayBuffer: async () => buf,
      headers: { get: name => res.headers.get(name) },
    };
  };
}

module.exports = { createCapturingFetch };
