const pLimit = require('p-limit');
const scrape = require('../lib/scrape');
const unshorten = require('../lib/unshorten');
const normalize = require('../lib/normalize');
const parseMeta = require('../lib/parseMeta');
const extractStatic = require('../lib/extractStatic');
const ResolveError = require('../lib/ResolveError');
const ScrapeResult = require('../lib/ScrapeResult');

const SCRAPE_MAX_CONCURRENCY =
  parseInt(process.env.SCRAPE_MAX_CONCURRENCY, 10) || 3;

// Server-wide cap on concurrent scrape operations to bound puppeteer memory.
const limit = pLimit(SCRAPE_MAX_CONCURRENCY);

function isTerminalHttpError(status) {
  return (
    status >= 500 ||
    status === 401 ||
    status === 403 ||
    status === 410 ||
    status === 451
  );
}

function resolveUrls(call) {
  const { urls } = call.request;
  return Promise.all(
    urls.map(async url => {
      let fetchResult;
      try {
        // Normalize and unshorten URLs, update fetchResult
        const normalized = normalize(url);
        fetchResult = new ScrapeResult({ canonical: normalized });

        const { url: unshortened } = await unshorten(normalized);
        fetchResult = new ScrapeResult({ canonical: unshortened });

        // Fetch info from page
        fetchResult = await parseMeta(unshortened);

        if (fetchResult.isIncomplete) {
          let staticResult = null;
          try {
            staticResult = await extractStatic(unshortened);
          } catch (e) {
            // Static extraction only handles SSR pages; if it fails
            // (network error, ResolveError, etc.), log and fall back to
            // the puppeteer path below.
            // eslint-disable-next-line no-console
            console.error('[extractStatic]', unshortened, e);
          }
          if (staticResult) fetchResult.merge(staticResult);

          // Only skip puppeteer when a GET has confirmed a terminal
          // status. unshorten's HEAD status is not authoritative (many
          // sites reject HEAD with 401/403/5xx while serving GET 200),
          // and extractStatic returning null (non-HTML response) or
          // throwing (network error) means we simply do not know — err
          // toward trying puppeteer.
          const hasTerminalGetStatus =
            staticResult && isTerminalHttpError(staticResult.status);
          if (fetchResult.isIncomplete && !hasTerminalGetStatus) {
            fetchResult.merge(await limit(() => scrape(unshortened)));
          }
        }

        call.write({
          ...fetchResult,
          top_image_url: fetchResult.topImageUrl,
          url, // Provide the most original url
          successfully_resolved: true,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[resolvedUrls]', url, e);
        let errMsg;
        if (e instanceof ResolveError) {
          errMsg = e.returnedError;
        }
        call.write({
          ...fetchResult, // Still try return available fetch result
          url,
          error: errMsg,
        });
      }
    })
  ).then(() => call.end());
}

module.exports = { resolveUrls };
module.exports.SCRAPE_MAX_CONCURRENCY = SCRAPE_MAX_CONCURRENCY;
