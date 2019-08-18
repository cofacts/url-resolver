require('dotenv').config();

const grpc = require('grpc');
const protoLoader = require('@grpc/proto-loader');

const PORT = process.env.PORT || 4000;

const PROTO_PATH = __dirname + '/src/typeDefs/url_resolver.proto';
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const urlResolverProto = grpc.loadPackageDefinition(packageDefinition)
  .url_resolver;

const testResolveUrl = () => {
  const client = new urlResolverProto.UrlResolver(
    `localhost:${PORT}`,
    grpc.credentials.createInsecure()
  );
  const urls = [];
  const call = client.ResolveUrl({ urls });
  const responses = [];
  call.on('data', response => {
    responses.push(response);
  });
  call.on('error', err => {
    throw new Error(`Test failed: ${err}`);
  });
  // eslint-disable-next-line no-console
  call.on('end', () => console.log(JSON.stringify(responses, null, 4)));
};

testResolveUrl();

/** For browser stats; uncomment to use it **/
/*
const BROWSER_PROTO_PATH = __dirname + '/src/typeDefs/browser_stats.proto';
const browserPackageDefinition = protoLoader.loadSync(BROWSER_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const browserProto = grpc.loadPackageDefinition(browserPackageDefinition)
  .browser_stats;

const testGetBrowserStats = () => {
  const client = new browserProto.BrowserStats(
    `localhost:${PORT}`,
    grpc.credentials.createInsecure()
  );
  client.GetStats({}, (err, res) => {
    if (err) {
      throw new Error(err);
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(res, null, 4));
  });
};

testGetBrowserStats();
*/
