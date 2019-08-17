require('dotenv').config();

const grpc = require('grpc');
const protoLoader = require('@grpc/proto-loader');
const { resolvedUrls } = require('./src/resolvers/resolvedUrls');

const PROTO_PATH = __dirname + '/src/typeDefs/urlResolver.proto';
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const urlResolverProto = grpc.loadPackageDefinition(packageDefinition)
  .urlResolver;

const PORT = process.env.PORT || 4000;

const server = new grpc.Server();
server.addService(urlResolverProto.UrlResolver.service, {
  resolveUrl: resolvedUrls,
});
server.bind(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure());
server.start();
