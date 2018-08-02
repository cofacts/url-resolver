const { ApolloServer, gql } = require('apollo-server');
const puppeteer = require('puppeteer');

const PORT = process.env.PORT || 4000;

const browserPromise = puppeteer.launch({args: ['--no-sandbox', '--disable-setuid-sandbox']});

const typeDefs = gql`
  type UrlResolveResult {
    raw: String
  }

  type Query {
    resolvedUrls(urls: [String]!): [UrlResolveResult]
  }
`

const resolvers = {
  Query: {
    resolvedUrls: async (root, {urls}) => {
      const browser = await browserPromise;
      const page = await browser.newPage();
      const response = await page.goto(urls[0]);
      const raw = await page.content();
      page.close();

      return [{raw}]
    }
  }
}

const server = new ApolloServer({typeDefs, resolvers});
server.listen({
  port: PORT
}).then(({ url }) => {
  console.log(`🚀  Server ready at ${url}`);
});
