const { unfurl } = require('unfurl.js');
const ScrapResult = require('./ScrapResult');
const ResolveError = require('./ResolveError');
// eslint-disable-next-line node/no-unpublished-require
const { ResolveError: ResolveErrorEnum } = require('./resolve_error_pb');

/**
 * @param {string} url
 * @returns {Promise<ScrapResult>}
 */
async function parseMeta(url) {
  let result;
  try {
    result = await unfurl(url);
  } catch (e) {
    throw new ResolveError(ResolveErrorEnum.UNKNOWN_UNFURL_ERROR, e);
  }

  const get = (...path) =>
    path.reduce(
      (ret, propName) => (typeof ret === 'object' ? ret[propName] : undefined),
      result
    );

  return new ScrapResult({
    url,
    canonical: get('twitter_card', 'url') || get('open_graph', 'url'),
    title:
      get('oEmbed', 'title') ||
      get('twitter_card', 'title') ||
      get('open_graph', 'title') ||
      get('title'),
    summary:
      get('twitter_card', 'description') ||
      get('open_graph', 'description') ||
      get('description'),
    topImageUrl:
      get('oEmbed', 'thumbnails', 0, 'url') ||
      get('twitter_card', 'images', 0, 'url') ||
      get('open_graph', 'images', 0, 'url'),
    html: get('oEmbed', 'html'),
  });
}

module.exports = parseMeta;
