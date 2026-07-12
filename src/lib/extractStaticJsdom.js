const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const ScrapeResult = require('./ScrapeResult');
const ResolveError = require('./ResolveError');
// eslint-disable-next-line node/no-unpublished-require
const { ResolveError: ResolveErrorEnum } = require('./resolve_error_pb');

const FETCH_TIMEOUT = 5000; // ms
const MAX_BODY_BYTES = 5 * 1024 * 1024;
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
 * jsdom-backed mirror of extractStatic. Same public API and post-DOM logic;
 * different DOM implementation. Exists on this branch so the bench can measure
 * jsdom vs linkedom on an apples-to-apples Readability composition.
 *
 * Kept structurally identical to src/lib/extractStatic.js so any drift is
 * caught by bench/parity output.
 *
 * @param {string} url
 * @returns {Promise<ScrapeResult|null>}
 */
async function extractStaticJsdom(url) {
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
    if (res.body) res.body.resume();
    return new ScrapeResult({ canonical: finalUrl, status });
  }

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('text/html') && !ct.startsWith('application/xhtml')) {
    if (res.body) res.body.resume();
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

  try {
    const { document } = dom.window;

    const canonicalEl = document.querySelector('link[rel=canonical]');
    let canonical =
      (canonicalEl && canonicalEl.getAttribute('href')) ||
      pickMeta(document, 'meta[property="og:url"]') ||
      finalUrl;

    try {
      canonical = new URL(canonical, finalUrl).href;
    } catch (e) {
      canonical = finalUrl;
    }

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

    return new ScrapeResult({
      canonical,
      title: title || undefined,
      summary: summary || undefined,
      topImageUrl: topImageUrl || undefined,
      html,
      status,
    });
  } finally {
    // Release jsdom internal timers / observers.
    dom.window.close();
  }
}

module.exports = extractStaticJsdom;
