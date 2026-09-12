const parseMeta = require('./parseMeta');
const { createCapturingFetch } = require('./capturingFetch');

/**
 * Runs parseMeta with a single real network fetch, returning both the
 * ScrapeResult and the fetched page bytes so callers can run static/
 * Readability extraction on the SAME response instead of extractStatic
 * performing a second fetch. Throws whatever parseMeta throws (e.g. non-200,
 * non-HTML, network failure) — same terminal contract as calling parseMeta
 * directly.
 *
 * @param {string} url
 * @returns {Promise<{result: ScrapeResult, page: {buffer?: Buffer, status?: number, contentType?: string, finalUrl?: string}}>}
 */
async function fetchAndParseMeta(url) {
  const page = {};
  const result = await parseMeta(url, createCapturingFetch(page));
  return { result, page };
}

module.exports = fetchAndParseMeta;
