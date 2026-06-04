require('dotenv').config();

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { resolveUrls } = require('./src/resolvers/resolveUrls');
const { getBrowserStats } = require('./src/resolvers/browser');

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
  ResolveUrl: resolveUrls,
});
server.addService(browserProto.BrowserStats.service, {
  GetStats: getBrowserStats,
});
server.bindAsync(
  `0.0.0.0:${PORT}`,
  grpc.ServerCredentials.createInsecure(),
  (err, port) => {
    if (err) {
      throw new Error(`gRPC bind failed: ${err.message}`);
    }
    // eslint-disable-next-line no-console
    console.log(`gRPC server listening on ${port}`);
  }
);
