const getVideoId = require('get-video-id');

const scrap = require('../lib/scrap');
const unshorten = require('../lib/unshorten');
const normalize = require('../lib/normalize');
const fetchYoutube = require('../lib/fetchYoutube');
const ResolveError = require('../lib/ResolveError');

async function resolveUrls(call) {
  const { urls } = call.request;
  Promise.all(
    urls.map(async url => {
      try {
        const normalized = normalize(url);
        const unshortened = await unshorten(normalized);
        const { id: videoId, service } = getVideoId(unshortened);

        let fetcher;
        if (videoId && service === 'youtube') {
          fetcher = fetchYoutube(videoId);
        } else {
          fetcher = scrap(unshortened);
        }

        const fetchResult = await fetcher;
        call.write({
          ...fetchResult,
          top_image_url: fetchResult.topImageUrl,
          url,
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
