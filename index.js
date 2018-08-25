/* eslint-disable no-console */

const { ApolloServer, gql } = require('apollo-server');
const puppeteer = require('puppeteer');
const scrap = require('./scrap');

const PORT = process.env.PORT || 4000;

const browserPromise = puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
browserPromise.then(() => {
  console.log(`Browser launched successfully.`);
});

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
      const browser = await browserPromise;
      return await Promise.all(urls.map(url => scrap(browser, url)));
    },
  },
};

const server = new ApolloServer({ typeDefs, resolvers });
server
  .listen({
    port: PORT,
  })
  .then(({ url }) => {
    console.log(`🚀  Server ready at ${url}`);
  });
