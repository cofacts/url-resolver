const { ApolloServer, gql } = require('apollo-server');
const scrap = require('./scrap');
const unshorten = require('./unshorten');

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
          const scrapResult = await scrap(unshortened);

          return {
            url,
            ...scrapResult,
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
