require('./lib/catchUnhandledRejection');
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { gql, makeExecutableSchema } = require('apollo-server');

const typeDefs = [
  loadTypeDef('ResolveError'),
  loadTypeDef('UrlResolveResult'),
  loadTypeDef('BrowserStats'),
  gql`
    type Query {
      resolvedUrls(
        """
        URLs to resolve
        """
        urls: [String]!
      ): [UrlResolveResult]

      """
      The scrapper browser stat
      """
      browserStats: BrowserStats
    }
  `,
];

const resolvers = mergeResolvers([
  require('./resolvers/resolvedUrls'),
  require('./resolvers/browserStats'),
]);

const schema = makeExecutableSchema({ typeDefs, resolvers });

module.exports = schema;

function loadTypeDef(name) {
  return fs.readFileSync(path.join(__dirname, `./typeDefs/${name}.graphql`), {
    encoding: 'utf-8',
  });
}

function mergeResolvers(resolvers) {
  return resolvers.reduce(
    (merged, { Query = {}, ...types }) => ({
      ...merged,
      Query: {
        ...merged.Query,
        ...Query,
      },
      ...types,
    }),
    { Query: {} }
  );
}
