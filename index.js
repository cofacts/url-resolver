require('dotenv').config();

const grpc = require('grpc');
const protoLoader = require('@grpc/proto-loader');
const { resolvedUrls } = require('./src/resolvers/resolvedUrls');
const { getBrowserStats } = require('./src/resolvers/browserStats');

const PROTO_PATHS = {
  urlResolver: __dirname + '/src/typeDefs/url_resolver.proto',
  browserStats: __dirname + '/src/typeDefs/browser_stats.proto',
};
const protoLoaderOptions = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

const packageDefinitions = {};
Object.keys(PROTO_PATHS).map(key => {
  packageDefinitions[key] = protoLoader.loadSync(
    PROTO_PATHS[key],
    protoLoaderOptions
  );
});

const urlResolverProto = grpc.loadPackageDefinition(
  packageDefinitions.urlResolver
).url_resolver;
const browserProto = grpc.loadPackageDefinition(packageDefinitions.browserStats)
  .browser_stats;

const PORT = process.env.PORT || 4000;

const server = new grpc.Server();
server.addService(urlResolverProto.UrlResolver.service, {
  resolveUrl: resolvedUrls,
});
server.addService(browserProto.BrowserStats.service, {
  GetStats: getBrowserStats,
});
server.bind(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure());
server.start();
