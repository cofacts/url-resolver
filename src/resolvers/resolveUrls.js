const pLimit = require('p-limit');
const scrape = require('../lib/scrape');
const unshorten = require('../lib/unshorten');
const normalize = require('../lib/normalize');
const fetchAndParseMeta = require('../lib/fetchAndParseMeta');
const { extractStatic, extractFromHtml } = require('../lib/extractStatic');
const { decodeHtml } = require('../lib/decodeHtml');
const { platformExtractorFor } = require('../lib/platformExtractors');
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

async function runExtractStatic(url) {
  try {
    return await extractStatic(url);
  } catch (e) {
    // Static extraction only handles SSR pages; if it fails (network error,
    // ResolveError, etc.), log and let the caller fall back to puppeteer.
    // eslint-disable-next-line no-console
    console.error('[extractStatic]', url, e);
    return null;
  }
}

// Only skip puppeteer when a GET has confirmed a terminal status. unshorten's
// HEAD status is not authoritative (many sites reject HEAD with 401/403/5xx
// while serving GET 200), and extractStatic returning null (non-HTML) or
// throwing (network error) means we do not know — err toward trying puppeteer.
async function scrapeIfIncomplete(result, staticResult, url) {
  const hasTerminalGetStatus =
    staticResult && isTerminalHttpError(staticResult.status);
  if (result.isIncomplete && !hasTerminalGetStatus) {
    result.merge(await limit(() => scrape(url)));
  }
  return result;
}

// Generic URLs: fetch once via fetchAndParseMeta (parseMeta/unfurl performs
// the real request), then reuse those same bytes for the Readability
// fallback instead of extractStatic fetching again.

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

        // Known platforms (e.g. Threads) are fetched and parsed once by
        // extractStatic, which dispatches to a host-specific extractor. This
        // skips the parseMeta/unfurl fetch that would otherwise return a
        // superficially-complete but wrong result (e.g. Threads' og:title
        // account label). See lib/platformExtractors.js.
        if (platformExtractorFor(unshortened)) {
          const staticResult = await runExtractStatic(unshortened);
          if (staticResult) fetchResult = staticResult;
          fetchResult = await scrapeIfIncomplete(
            fetchResult,
            staticResult,
            unshortened
          );
        } else {
          // fetchAndParseMeta failing (non-200, non-HTML, network error) is
          // treated like an incomplete result, not a terminal one: unfurl
          // folds all of these into one opaque error, and a non-200/wrong-
          // content-type response can be a bot-detection artifact (the same
          // reasoning that already makes unshorten's HEAD status non-
          // authoritative above) — puppeteer, a real browser, may get past
          // it where a plain fetch could not. This replaces the "no
          // puppeteer on parseMeta throw" contract this codebase had since
          // 2020 (PR #70): an artifact of that code's original control flow,
          // never documented as an intentional policy. fetchResult keeps its
          // prior (unshortened) canonical on failure, matching the
          // incremental-assignment pattern above.
          let page = null;
          try {
            const outcome = await fetchAndParseMeta(unshortened);
            fetchResult = outcome.result;
            page = outcome.page;
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[fetchAndParseMeta]', unshortened, e);
          }

          if (fetchResult.isIncomplete) {
            const staticResult = page
              ? extractFromHtml({
                  html: decodeHtml(page.buffer, page.contentType),
                  status: page.status,
                  finalUrl: page.finalUrl,
                })
              : null;
            if (staticResult) fetchResult.merge(staticResult);
            if (fetchResult.isIncomplete) {
              fetchResult.merge(await limit(() => scrape(unshortened)));
            }
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
