const scrap = require('../lib/scrap');
const unshorten = require('../lib/unshorten');
const normalize = require('../lib/normalize');
const parseMeta = require('../lib/parseMeta');
const ResolveError = require('../lib/ResolveError');

function resolveUrls(call) {
  const { urls } = call.request;
  return Promise.all(
    urls.map(async url => {
      try {
        const normalized = normalize(url);
        const unshortened = await unshorten(normalized);
        const fetchResult = await parseMeta(unshortened);

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
          url,
          error: errMsg,
        });
      }
    })
  ).then(() => call.end());
}

module.exports = { resolveUrls };
