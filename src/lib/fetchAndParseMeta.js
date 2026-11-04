const parseMeta = require('./parseMeta');
const { cofactsBotFetch } = require('./cofactsBotFetch');
const ScrapeResult = require('./ScrapeResult');
const { isThreadsGone, applyThreadsMetadata } = require('./threadsMetadata');
const { isFacebookUrl, isFacebookLoginUrl } = require('./resolveFacebookUrl');

/**
 * Runs parseMeta with the CofactsBot User-Agent fetch (unfurl defaults to
 * `facebookexternalhit`), retaining the response URL/status for Threads rules.
 * Confirmed Threads deletions return 410; other parsing and network failures
 * propagate to the caller for browser fallback.
 *
 * @param {string} url
 * @returns {Promise<ScrapeResult>}
 */
/**
 * @param {string} url
 * @param {?ArrayBuffer} body
 * @returns {boolean} whether a Facebook response body is the login page
 */
function isFacebookLoginPage(url, body) {
  return (
    isFacebookUrl(url) &&
    Boolean(body) &&
    Buffer.from(body)
      .toString('latin1')
      .includes('<form id="login_form"')
  );
}

async function fetchAndParseMeta(url) {
  let response;
  let body;
  let result;
  // In the observed responses (Nov 2026), some Facebook pages CofactsBot
  // cannot read (deleted or region-blocked content, dead reels and videos)
  // carried no Open Graph tags, only a placeholder <title> such as "Facebook"
  // or "影片", while readable posts carried Open Graph tags. So skip the plain
  // <title> / description fallbacks for Facebook; a page with a real <title>
  // but no Open Graph tags would come back without a title. The login page is
  // different: it has Open Graph tags of its own and is dropped below.
  const structuredOnly = isFacebookUrl(url);
  try {
    result = await parseMeta(
      url,
      async target => {
        response = await cofactsBotFetch(target);
        const read = response.arrayBuffer;
        // Keep the body so the Facebook login page can be recognized below.
        response.arrayBuffer = async () => {
          body = await read();
          return body;
        };
        return response;
      },
      { structuredOnly }
    );
  } catch (e) {
    // unfurl rejects non-200 responses. Preserve a confirmed Threads deletion
    // even when parsing fails; other failures still reach browser fallback.
    if (response && isThreadsGone(response.url, response.status)) {
      return new ScrapeResult({ canonical: response.url, status: 410 });
    }
    throw e;
  }
  if (!response) return result;
  // Facebook's login page renders its own Open Graph tags. It is reached by a
  // redirect to /login, or served in place (e.g. by some /share/ links). The
  // in-place page is recognized by its login form element, a fixed id rather
  // than localized text; readable posts did not render it in the observed
  // responses (Nov 2026).
  if (isFacebookLoginUrl(response.url) || isFacebookLoginPage(url, body)) {
    return new ScrapeResult({ canonical: url, status: response.status });
  }
  result.status = response.status;
  return applyThreadsMetadata(result, response.url, response.status);
}

module.exports = fetchAndParseMeta;
