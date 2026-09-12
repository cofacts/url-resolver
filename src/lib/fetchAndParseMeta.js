const parseMeta = require('./parseMeta');
const { cofactsBotFetch } = require('./cofactsBotFetch');
const ScrapeResult = require('./ScrapeResult');
const { isThreadsGone, applyThreadsMetadata } = require('./threadsMetadata');

/**
 * Runs parseMeta with the CofactsBot User-Agent fetch (unfurl defaults to
 * `facebookexternalhit`), retaining the response URL/status for Threads rules.
 * Confirmed Threads deletions return 410; other parsing and network failures
 * propagate to the caller for browser fallback.
 *
 * @param {string} url
 * @returns {Promise<ScrapeResult>}
 */
async function fetchAndParseMeta(url) {
  let response;
  let result;
  try {
    result = await parseMeta(url, async target => {
      response = await cofactsBotFetch(target);
      return response;
    });
  } catch (e) {
    // unfurl rejects non-200 responses. Preserve a confirmed Threads deletion
    // even when parsing fails; other failures still reach browser fallback.
    if (response && isThreadsGone(response.url, response.status)) {
      return new ScrapeResult({ canonical: response.url, status: 410 });
    }
    throw e;
  }
  if (!response) return result;
  result.status = response.status;
  return applyThreadsMetadata(result, response.url, response.status);
}

module.exports = fetchAndParseMeta;
