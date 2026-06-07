const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const ScrapResult = require('./ScrapResult');
const ResolveError = require('./ResolveError');
// eslint-disable-next-line node/no-unpublished-require
const { ResolveError: ResolveErrorEnum } = require('./resolve_error_pb');

const FETCH_TIMEOUT = 5000; // ms
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MiB cap on HTML body
const USER_AGENT =
  process.env.URL_RESOLVER_USER_AGENT ||
  'CofactsBot/1.0 (+https://cofacts.tw/bot)';

function pickMeta(document, ...selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.getAttribute('content')) return el.getAttribute('content');
  }
  return '';
}

/**
 * Fetch the URL via plain HTTP and run Mozilla Readability inside a
 * server-side jsdom DOM (no script execution). For SSR-rendered pages this
 * is sufficient and avoids booting puppeteer.
 *
 * Returns null if the response is not text/html or jsdom cannot be built;
 * throws ResolveError on the same network-level failures as `unshorten` so
 * the caller can decide whether to fall back to puppeteer.
 *
 * @param {string} url
 * @returns {Promise<ScrapResult|null>}
 */
async function extractStatic(url) {
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      timeout: FETCH_TIMEOUT,
      size: MAX_BODY_BYTES,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
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
        return null;
    }
  }

  const finalUrl = res.url || url;
  const status = res.status;

  if (!res.ok) {
    return new ScrapResult({ canonical: finalUrl, status });
  }

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('text/html') && !ct.startsWith('application/xhtml')) {
    return null;
  }

  let html;
  try {
    html = await res.text();
  } catch (e) {
    return null;
  }

  let dom;
  try {
    dom = new JSDOM(html, { url: finalUrl });
  } catch (e) {
    return null;
  }

  const document = dom.window.document;

  const canonicalEl = document.querySelector('link[rel=canonical]');
  const canonical =
    (canonicalEl && canonicalEl.href) ||
    pickMeta(document, 'meta[property="og:url"]') ||
    finalUrl;

  let topImageUrl = '';
  const ogImage = pickMeta(
    document,
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[name="twitter:image"]'
  );
  if (ogImage) {
    try {
      topImageUrl = new URL(ogImage, canonical).href;
    } catch (e) {
      topImageUrl = '';
    }
  }

  let article = null;
  try {
    article = new Readability(document).parse();
  } catch (e) {
    article = null;
  }

  const title =
    (article && article.title && article.title.trim()) ||
    pickMeta(document, 'meta[property="og:title"]') ||
    (document.title || '').trim();

  const summary =
    (article && article.textContent && article.textContent.trim()) ||
    pickMeta(
      document,
      'meta[property="og:description"]',
      'meta[name=description]'
    );

  return new ScrapResult({
    canonical,
    title: title || undefined,
    summary: summary || undefined,
    topImageUrl: topImageUrl || undefined,
    html,
    status,
  });
}

module.exports = extractStatic;
