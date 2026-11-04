const pLimit = require('p-limit');
const scrape = require('../lib/scrape');
const unshorten = require('../lib/unshorten');
const {
  isFacebookUrl,
  resolveFacebookUrl,
} = require('../lib/resolveFacebookUrl');
const { readFacebookEmbed } = require('../lib/facebookEmbed');
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

/**
 * Resolve the URL to fetch before choosing a metadata extractor.
 * Facebook needs share/login/photo URL recovery; other URLs follow redirects.
 *
 * @param {string} url normalized URL
 * @returns {Promise<string>} target URL for metadata extraction
 */
async function resolveTargetUrl(url) {
  let targetUrl;
  try {
    ({ url: targetUrl } = await unshorten(url));
  } catch (e) {
    // Preserve the existing retry policy for explicitly supplied Facebook URLs.
    // For other inputs, a failed redirect lookup cannot establish a FB target.
    if (!isFacebookUrl(url)) throw e;
    targetUrl = url;
  }
  if (isFacebookUrl(targetUrl)) return resolveFacebookUrl(targetUrl, url);
  return targetUrl;
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

        const targetUrl = await resolveTargetUrl(normalized);
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
        // Facebook serves a login wall for both live and deleted posts, and
        // the browser hits the same wall; ask the embed instead.
        if (fetchResult.isIncomplete && isFacebookUrl(targetUrl)) {
          const embed = await readFacebookEmbed(targetUrl);
          const hasMetadata = ['title', 'summary', 'topImageUrl'].some(
            field => fetchResult[field] !== undefined
          );
          if (embed.unavailable && !hasMetadata) {
            // The page gave no metadata and the embed has nothing to show.
            // Reported as 410, the contract used for a gone Threads post, so
            // callers skip it. Unlike Threads this covers deleted posts,
            // non-public posts and pages the embed does not support (it shows
            // one notice for all): 410 means "not readable by the resolver",
            // not a confirmed deletion. Reusing the status keeps the gRPC
            // contract unchanged.
            fetchResult = new ScrapeResult({
              canonical: fetchResult.canonical,
              status: 410,
            });
          } else if (embed.post) {
            // Only fill fields the page did not provide: Open Graph text is
            // better than the embed's author name.
            ['canonical', 'title', 'summary', 'topImageUrl'].forEach(field => {
              if (fetchResult[field] === undefined) {
                fetchResult[field] = embed.post[field];
              }
            });
          }
        }

        // In the full-pipeline check behind this rule (Nov 2026, see PR #80),
        // Puppeteer reached only Facebook's login wall or an error page for
        // every Facebook URL that metadata and the embed could not read, and
        // reported that text as the post, so Facebook is never scraped.
        const isFacebook = isFacebookUrl(targetUrl);
        if (fetchResult.isIncomplete && !isGone && !isFacebook) {
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
