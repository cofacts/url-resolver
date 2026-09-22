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

// One structured line per resolved URL. The URL DB only keeps the final
// fields (and an unreliable status), so this is the only place to audit the
// parse outcome per host and spot which sites extract poorly and may need a
// dedicated extractor. Title is truncated; summary is logged as a length so
// article bodies do not flood the logs.
function logResolution(url, result, error) {
  const r = result || {};
  let host = '';
  try {
    host = new URL(r.canonical || url).hostname;
  } catch (e) {
    host = '';
  }
  // eslint-disable-next-line no-console
  console.info(
    '[resolve]',
    JSON.stringify({
      url,
      canonical: r.canonical,
      host,
      title: (r.title || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80),
      summaryLen: (r.summary || '').length,
      image: Boolean(r.topImageUrl),
      status: r.status,
      error,
    })
  );
}

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

        logResolution(url, fetchResult);
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
        logResolution(url, fetchResult, errMsg);
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
