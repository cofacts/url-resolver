require('dotenv').config();

const schema = require('./src/schema');
const { ApolloServer } = require('apollo-server');
const PORT = process.env.PORT || 4000;

const apolloOption = { schema };
if (process.env.ENGINE_API_KEY) {
  apolloOption.engine = { apiKey: process.env.ENGINE_API_KEY };
}

const server = new ApolloServer(apolloOption);
server
  .listen({
    port: PORT,
  })
  .then(({ url }) => {
    // eslint-disable-next-line no-console
    console.log(`🚀  Server ready at ${url}`);
  });
