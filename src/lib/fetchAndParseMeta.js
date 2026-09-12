const parseMeta = require('./parseMeta');
const { cofactsBotFetch } = require('./cofactsBotFetch');

/**
 * Runs parseMeta with the CofactsBot User-Agent fetch (unfurl defaults to
 * `facebookexternalhit`). Throws whatever parseMeta throws (e.g. non-200,
 * non-HTML, network failure) — same terminal contract as calling parseMeta
 * directly.
 *
 * @param {string} url
 * @returns {Promise<ScrapeResult>}
 */
function fetchAndParseMeta(url) {
  return parseMeta(url, cofactsBotFetch);
}

module.exports = fetchAndParseMeta;
