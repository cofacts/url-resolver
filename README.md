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

## Running with Cloudflare Browser Rendering

Instead of launching a local Chromium, url-resolver can talk to Cloudflare Browser Rendering over its WebSocket CDP endpoint, offloading the ~500 MB chromium process to Cloudflare's edge.

Set in `.env`:

```
BROWSER_BACKEND=cloudflare
CLOUDFLARE_ACCOUNT_ID=<your account ID>
CLOUDFLARE_API_TOKEN=<API token with Browser Rendering: Edit permission>
```

The token needs the **Browser Rendering: Edit** scope at the account level. Create it under **My Profile → API Tokens → Custom token**.

### Plan requirement

Workers Free only allows 10 minutes of browser time per day, which is insufficient for production URL resolution. The **Workers Paid** plan ($5/month) is required, with $0.09 per browser-hour beyond the 10 hours included monthly.

Indicative cost at 5 seconds per resolution:

| Volume | Browser-hours/month | Estimated cost |
|---|---|---|
| 10,000 URLs/day | ~417 | ~$37 |
| 100,000 URLs/day | ~4,170 | ~$374 |

See https://developers.cloudflare.com/browser-run/pricing/ for current rates.

Local Chromium remains the default and works as a fallback — the Docker image still bundles it, so unsetting `BROWSER_BACKEND` rolls back instantly without redeploy.

## Build

Directly use docker to build image.

```bash
$ docker build -t cofacts/url-resolver:latest .
```

## Resource limits

Two env vars bound puppeteer memory at scrap time. Both are optional.

| Variable | Default | Description |
|---|---|---|
| `SCRAP_MAX_CONCURRENCY` | `3` | Maximum concurrent `scrap()` operations across all gRPC calls. Each in-flight scrap holds one puppeteer page (image, JS heap, network sockets). Lower this if the server OOMs; raise it if tail latency dominates and there is RAM headroom. |
| `SCRAP_BLOCK_RESOURCES` | `image,media,font` | Comma-separated [puppeteer resourceType](https://pptr.dev/api/puppeteer.httprequest.resourcetype) list aborted before they hit the wire. Set to empty string to load every resource. The default leaves `document`, `stylesheet`, `script`, and `xhr` intact, so Readability.js sees the same DOM. |

`og:image` is read from the meta tag in HTML, not from a loaded image, so the default block list does not affect `topImageUrl` for sites that expose Open Graph metadata. Sites without `og:image` fall back to scanning `<img>` tags by rendered size; with image loading blocked, all images report `0x0`, so the fallback returns the first `<img>` instead of the largest.