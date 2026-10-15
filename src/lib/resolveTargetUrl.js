const unshorten = require('./unshorten');
const { isFacebookUrl, resolveFacebookUrl } = require('./resolveFacebookUrl');

/**
 * Resolve the URL to fetch before choosing a metadata extractor.
 * Facebook needs share/login/photo URL recovery; other URLs follow redirects.
 *
 * @param {string} url normalized URL
 * @returns {Promise<string>} target URL for metadata extraction
 */
async function resolveTargetUrl(url) {
  let targetUrl;
  try {
    ({ url: targetUrl } = await unshorten(url));
  } catch (e) {
    // Preserve the existing retry policy for explicitly supplied Facebook URLs.
    // For other inputs, a failed redirect lookup cannot establish a FB target.
    if (!isFacebookUrl(url)) throw e;
    targetUrl = url;
  }
  if (isFacebookUrl(targetUrl)) return resolveFacebookUrl(targetUrl, url);
  return targetUrl;
}

module.exports = resolveTargetUrl;
