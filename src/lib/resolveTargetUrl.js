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
  if (isFacebookUrl(url)) return resolveFacebookUrl(url);
  const { url: targetUrl } = await unshorten(url);
  return targetUrl;
}

module.exports = resolveTargetUrl;
