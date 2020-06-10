# Cofacts URL Resolver

[![Build Status](https://travis-ci.org/cofacts/url-resolver.svg?branch=master)](https://travis-ci.org/cofacts/url-resolver) [![Coverage Status](https://coveralls.io/repos/github/cofacts/url-resolver/badge.svg?branch=master)](https://coveralls.io/github/cofacts/url-resolver?branch=master)

A gRPC service that scraps the specified URL and returns scrapped result and summary extracted by
[Readability.js]

## Usage

First, create an `.env` file from `.env.sample`.

Run url resolver from built docker images

```bash
$ docker pull cofacts/url-resolver
$ docker run --rm --env-file .env -p 4000:4000 cofacts/url-resolver
```
You can use gRPC clients like [BloomRPC](https://github.com/uw-labs/bloomrpc) to access the service for testing purpose.

To access the gRPC service, you can see `docker-test.js` for an example that uses `@grpc/proto-loader`.

## Development

First, create an `.env` file from `.env.sample`. Fill in your env.

Install development dependencies

```bash
# After git clone
$ cd url-resolver
$ npm install

# Build js binary from proto files
$ npm run compile
```

Start dev server

```bash
$ npm start
```

After editing `proto` files, run `npm run compile` to generate corresponding Javascript binary.

## Build

Directly use docker to build image.

```bash
$ docker build -t cofacts/url-resolver:latest .
```