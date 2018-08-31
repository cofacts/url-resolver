require('./lib/catchUnhandledRejection');
require('dotenv').config();

const { ApolloServer, gql } = require('apollo-server');
const getVideoId = require('get-video-id');

const scrap = require('./lib/scrap');
const unshorten = require('./lib/unshorten');
const fetchYoutube = require('./lib/fetchYoutube');

const PORT = process.env.PORT || 4000;

const typeDefs = gql`
  type UrlResolveResult {
    url: String
    canonical: String
    title: String
    summary: String
    html: String
    topImageUrl: String
    status: Int
  }

  type Query {
    resolvedUrls(urls: [String]!): [UrlResolveResult]
  }
`;

const resolvers = {
  Query: {
    resolvedUrls: async (root, { urls }) => {
      return await Promise.all(
        urls.map(async url => {
          const unshortened = await unshorten(url);
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

const server = new ApolloServer({ typeDefs, resolvers });
server
  .listen({
    port: PORT,
  })
  .then(({ url }) => {
    // eslint-disable-next-line no-console
    console.log(`🚀  Server ready at ${url}`);
  });
