const getVideoId = require('get-video-id');
const rollbar = require('../lib/rollbar');

const scrap = require('../lib/scrap');
const unshorten = require('../lib/unshorten');
const normalize = require('../lib/normalize');
const fetchYoutube = require('../lib/fetchYoutube');
const ResolveError = require('../lib/ResolveError');

async function resolvedUrls(root, { urls }) {
  return await Promise.all(
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
        return {
          ...fetchResult,
          url,
        };
      } catch (e) {
        rollbar.error(e, '[resolvedUrls] error', { url });

        if (e instanceof ResolveError) {
          return {
            error: e.returnedError,
            url,
          };
        }
      }
    })
  );
}

module.exports = { Query: { resolvedUrls } };
