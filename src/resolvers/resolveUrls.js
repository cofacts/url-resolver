const pLimit = require('p-limit');
const scrap = require('../lib/scrap');
const unshorten = require('../lib/unshorten');
const normalize = require('../lib/normalize');
const parseMeta = require('../lib/parseMeta');
const ResolveError = require('../lib/ResolveError');
const ScrapResult = require('../lib/ScrapResult');

const SCRAP_MAX_CONCURRENCY =
  parseInt(process.env.SCRAP_MAX_CONCURRENCY, 10) || 3;

// Server-wide cap on concurrent scrap operations to bound puppeteer memory.
const limit = pLimit(SCRAP_MAX_CONCURRENCY);

function resolveUrls(call) {
  const { urls } = call.request;
  return Promise.all(
    urls.map(url =>
      limit(async () => {
        let fetchResult;
        try {
          // Normalize and unshorten URLs, update fetchResult
          const normalized = normalize(url);
          fetchResult = new ScrapResult({ canonical: normalized });

          const unshortened = await unshorten(normalized);
          fetchResult = new ScrapResult({ canonical: unshortened });

          // Fetch info from page
          fetchResult = await parseMeta(unshortened);

          if (fetchResult.isIncomplete) {
            fetchResult.merge(await scrap(unshortened));
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
    )
  ).then(() => call.end());
}

module.exports = { resolveUrls };
module.exports.SCRAP_MAX_CONCURRENCY = SCRAP_MAX_CONCURRENCY;
