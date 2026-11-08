const { unfurl } = require('unfurl.js');
const ScrapeResult = require('./ScrapeResult');
const ResolveError = require('./ResolveError');
// eslint-disable-next-line node/no-unpublished-require
const { ResolveError: ResolveErrorEnum } = require('./resolve_error_pb');

/**
 * @param {string} url
 * @param {?Function} [fetchOverride] optional unfurl-compatible fetch, used to
 *   run the request with a custom User-Agent. See lib/cofactsBotFetch.js.
 * @param {{ structuredOnly?: boolean }} [options] structuredOnly skips the
 *   plain <title> / <meta name="description"> fallbacks.
 * @returns {Promise<ScrapeResult>}
 */
async function parseMeta(url, fetchOverride, { structuredOnly = false } = {}) {
  let result;
  try {
    result = await unfurl(url, fetchOverride ? { fetch: fetchOverride } : {});
  } catch (e) {
    throw new ResolveError(ResolveErrorEnum.UNKNOWN_UNFURL_ERROR, e);
  }

  const get = (...path) =>
    path.reduce(
      (ret, propName) => (typeof ret === 'object' ? ret[propName] : undefined),
      result
    );

  return new ScrapeResult({
    canonical: get('twitter_card', 'url') || get('open_graph', 'url') || url,
    title:
      get('oEmbed', 'title') ||
      get('twitter_card', 'title') ||
      get('open_graph', 'title') ||
      (structuredOnly ? undefined : get('title')),
    summary:
      get('twitter_card', 'description') ||
      get('open_graph', 'description') ||
      (structuredOnly ? undefined : get('description')),
    topImageUrl:
      get('oEmbed', 'thumbnails', 0, 'url') ||
      get('twitter_card', 'images', 0, 'url') ||
      get('open_graph', 'images', 0, 'url'),
    html: get('oEmbed', 'html'),
  });
}

module.exports = parseMeta;
