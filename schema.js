require('./lib/catchUnhandledRejection');
require('dotenv').config();

const { gql, makeExecutableSchema } = require('apollo-server');
const getVideoId = require('get-video-id');

const scrap = require('./lib/scrap');
const unshorten = require('./lib/unshorten');
const normalize = require('./lib/normalize');
const fetchYoutube = require('./lib/fetchYoutube');

const typeDefs = gql`
  enum ResolveError {
    # DNS cannot resolve the given URL
    NAME_NOT_RESOLVED

    # Malformed URL
    INVALID_URL

    UNKNOWN_SCRAP_ERROR
    UNKNOWN_YOUTUBE_ERROR
  }

  type UrlResolveResult {
    """
    The exact URL givne as input
    """
    url: String

    """
    Canonical URL extracted from HTML source
    """
    canonical: String

    """
    Page title extracted from HTML source
    """
    title: String

    """
    Summary of the given page. Generated via API or readability.js
    """
    summary: String

    """
    Fetched HTML
    """
    html: String

    """
    URL of the detected top image for the page
    """
    topImageUrl: String

    """
    HTTP status of fetch result. 0 for timeouts, etc.
    """
    status: Int

    """
    Known fatal error during the resolution process. These errors are not related to HTTP, thus
    cannot be represented as HTTP status codes.
    """
    error: ResolveError
  }

  type Query {
    resolvedUrls(
      """
      URLs to resolve
      """
      urls: [String]!
    ): [UrlResolveResult]
  }
`;

const resolvers = {
  Query: {
    resolvedUrls: async (root, { urls }) => {
      return await Promise.all(
        urls.map(async url => {
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
        })
      );
    },
  },
};

const schema = makeExecutableSchema({ typeDefs, resolvers });

module.exports = schema;
