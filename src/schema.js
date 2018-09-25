require('./lib/catchUnhandledRejection');
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { gql, makeExecutableSchema } = require('apollo-server');

const typeDefs = [
  loadTypeDef('ResolveError'),
  loadTypeDef('UrlResolveResult'),
  gql`
    type Query {
      resolvedUrls(
        """
        URLs to resolve
        """
        urls: [String]!
      ): [UrlResolveResult]
    }
  `,
];

const resolvers = {
  Query: {
    resolvedUrls: require('./resolvers/resolvedUrls'),
  },
};

const schema = makeExecutableSchema({ typeDefs, resolvers });

module.exports = schema;

function loadTypeDef(name) {
  return fs.readFileSync(path.join(__dirname, `./typeDefs/${name}.graphql`), {
    encoding: 'utf-8',
  });
}