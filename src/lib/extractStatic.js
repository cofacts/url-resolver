const fetch = require('node-fetch');
const { parseHTML } = require('linkedom');
const { Readability } = require('@mozilla/readability');
const ScrapeResult = require('./ScrapeResult');
const { decodeHtml } = require('./decodeHtml');
const { platformExtractorFor } = require('./platformExtractors');
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
 * Run Mozilla Readability (or a host-specific extractor) over already-fetched
 * HTML inside a server-side linkedom DOM (no script execution, no CSS
 * engine). Pure — no network access — so callers that already have the page
 * bytes (e.g. reused from parseMeta's fetch) can extract without a second
 * request.
 *
 * @param {{html: string, status?: number, finalUrl: string}} page
 * @returns {ScrapeResult|null} null if the DOM cannot be built
 */
function extractFromHtml({ html, status, finalUrl }) {
  let document;
  try {
    ({ document } = parseHTML(html));
  } catch (e) {
    return null;
  }

  const canonicalEl = document.querySelector('link[rel=canonical]');
  // linkedom does not auto-resolve HTMLAnchorElement.href to an absolute URL,
  // so read the raw attribute and resolve it against finalUrl manually.
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

  // Host-specific extractors (e.g. Threads) read the DOM directly and know
  // which fields hold the real content, so they replace the generic
  // Readability + Open Graph pass below. They are keyed and canonicalized on
  // the final post URL, not the page's self-declared canonical: a Threads
  // login/Home shell declares the homepage canonical, which would otherwise
  // hide the post shortcode and overwrite the post URL. See platformExtractors.
  const platformExtract = platformExtractorFor(finalUrl);
  if (platformExtract) {
    const platform = platformExtract(document, html, finalUrl);

    // Observability: the URL DB stores only the resolved fields (and an
    // unreliable status), not the redirect target or the classification. Emit
    // one structured line per platform resolution so the parse-outcome
    // distribution, plus any ?error= code beyond invalid_post, stays auditable
    // from service logs.
    let errorParam = null;
    try {
      errorParam = new URL(finalUrl).searchParams.get('error');
    } catch (e) {
      errorParam = null;
    }
    const platformClass = platform.isUnavailable
      ? 'unavailable'
      : platform.title || platform.summary
      ? 'content'
      : 'empty';
    // eslint-disable-next-line no-console
    console.info(
      '[platform]',
      JSON.stringify({ finalUrl, class: platformClass, error: errorParam })
    );

    if (platform.isUnavailable) {
      // The target post is gone (Threads 302s to ?error=invalid_post). Report
      // 410 Gone so the caller treats it as terminal and skips puppeteer,
      // instead of surfacing the login-wall boilerplate as content.
      return new ScrapeResult({ canonical: finalUrl, status: 410, html });
    }
    return new ScrapeResult({
      canonical: finalUrl,
      title: platform.title || undefined,
      summary: platform.summary || undefined,
      topImageUrl: platform.topImageUrl || topImageUrl || undefined,
      html,
      status,
    });
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
}

/**
 * Fetch the URL via plain HTTP, then run `extractFromHtml` over the result.
 * For SSR-rendered pages this is sufficient and avoids booting puppeteer.
 *
 * Returns null if the response is not text/html or the DOM cannot be built;
 * throws ResolveError on the same network-level failures as `unshorten` so
 * the caller can decide whether to fall back to puppeteer.
 *
 * @param {string} url
 * @returns {Promise<ScrapeResult|null>}
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
    // Consume the body so node-fetch releases the socket back to the pool.
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
    const buf = Buffer.from(await res.arrayBuffer());
    html = decodeHtml(buf, res.headers.get('content-type'));
  } catch (e) {
    return null;
  }

  return extractFromHtml({ html, status, finalUrl });
}

module.exports = { extractStatic, extractFromHtml };
