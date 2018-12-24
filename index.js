require('dotenv').config();

const schema = require('./src/schema');
const { ApolloServer } = require('apollo-server');
const PORT = process.env.PORT || 4000;

const server = new ApolloServer({
  schema,
  engine: { apiKey: process.env.ENGINE_API_KEY },
});
server
  .listen({
    port: PORT,
  })
  .then(({ url }) => {
    // eslint-disable-next-line no-console
    console.log(`🚀  Server ready at ${url}`);
  });
