const pLimit = require('p-limit');
const scrape = require('../lib/scrape');
const unshorten = require('../lib/unshorten');
const normalize = require('../lib/normalize');
const parseMeta = require('../lib/parseMeta');
const ResolveError = require('../lib/ResolveError');
const ScrapeResult = require('../lib/ScrapeResult');

const SCRAPE_MAX_CONCURRENCY =
  parseInt(process.env.SCRAPE_MAX_CONCURRENCY, 10) || 3;

// Server-wide cap on concurrent scrape operations to bound puppeteer memory.
const limit = pLimit(SCRAPE_MAX_CONCURRENCY);

function resolveUrls(call) {
  const { urls } = call.request;
  return Promise.all(
    urls.map(async url => {
      let fetchResult;
      try {
        // Normalize and unshorten URLs, update fetchResult
        const normalized = normalize(url);
        fetchResult = new ScrapeResult({ canonical: normalized });

        const unshortened = await unshorten(normalized);
        fetchResult = new ScrapeResult({ canonical: unshortened });

        // Fetch info from page
        fetchResult = await parseMeta(unshortened);

        if (fetchResult.isIncomplete) {
          fetchResult.merge(await limit(() => scrape(unshortened)));
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
