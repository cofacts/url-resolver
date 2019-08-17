require('dotenv').config();

const PROTO_PATH = __dirname + '/src/typeDefs/url_resolver.proto';
const grpc = require('grpc');
const protoLoader = require('@grpc/proto-loader');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const urlResolverProto = grpc.loadPackageDefinition(packageDefinition)
  .url_resolver;

const main = () => {
  const PORT = process.env.PORT || 4000;
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
  call.on('end', () => {});
};

main();

/** For browser stats **/
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

function main() {
  var client = new browserProto.BrowserStats(
    'localhost:4000',
    grpc.credentials.createInsecure()
  );
  const call = client.GetStats({}, (err, res) => {
    if (err) {
      console.log(err);
      return;
    }
    console.log(res);
    console.log(res.pages[0].metrics)
  });
}
*/
