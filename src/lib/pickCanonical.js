// A homepage may be served as /index.html etc. and carry tracking params
// (?utm_source=facebook). Any other query can select different content
// (e.g. WordPress /?p=123), so such a page is not treated as the homepage.
// The tracking params are a minimal list of common ones, not exhaustive: a
// homepage with another tracking param keeps its own URL.
const INDEX_PATH_RE = /^\/(?:index\.(?:html?|php))?$/i;
const TRACKING_PARAM_RE = /^(?:utm_\w+|fbclid|gclid)$/i;

function isSiteRoot(url) {
  const { pathname, searchParams } = new URL(url);
  return (
    INDEX_PATH_RE.test(pathname) &&
    [...searchParams.keys()].every(key => TRACKING_PARAM_RE.test(key))
  );
}

/**
 * Some sites declare their homepage as og:url / twitter:url on every page.
 * Ignore such a declaration unless the page itself is the homepage.
 *
 * @param {string} declared canonical URL the page declares
 * @param {string} pageUrl URL the page was actually served from
 * @returns {string}
 */
function pickCanonical(declared, pageUrl) {
  try {
    return isSiteRoot(declared) && !isSiteRoot(pageUrl) ? pageUrl : declared;
  } catch (e) {
    return pageUrl;
  }
}

module.exports = pickCanonical;
