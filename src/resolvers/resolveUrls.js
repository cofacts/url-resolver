const pLimit = require('p-limit');
const scrape = require('../lib/scrape');
const unshorten = require('../lib/unshorten');
const normalize = require('../lib/normalize');
const fetchAndParseMeta = require('../lib/fetchAndParseMeta');
const { isThreadsUrl } = require('../lib/threadsMetadata');
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
        // Resolve the target URL before selecting a metadata extractor.
        const normalized = normalize(url);
        fetchResult = new ScrapeResult({ canonical: normalized });

        const { url: targetUrl } = await unshorten(normalized);
        fetchResult = new ScrapeResult({ canonical: targetUrl });

        try {
          fetchResult = await fetchAndParseMeta(targetUrl);
        } catch (e) {
          // Metadata failures leave the target URL available for browser fallback.
          // eslint-disable-next-line no-console
          console.error('[fetchAndParseMeta]', targetUrl, e);
        }

        const isGone =
          isThreadsUrl(fetchResult.canonical) && fetchResult.status === 410;
        if (fetchResult.isIncomplete && !isGone) {
          fetchResult.merge(await limit(() => scrape(targetUrl)));
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
