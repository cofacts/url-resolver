# Cofacts URL Resolver

[![Build Status](https://travis-ci.org/cofacts/url-resolver.svg?branch=master)](https://travis-ci.org/cofacts/url-resolver)

A GraphQL service that scraps the specified URL and returns scrapped result and summary extracted by
[Readability.js]

## Usage

Run url resolver from built docker images

```bash
$ docker pull johnsonliang/cofacts-url-resolver
$ docker run --rm -p 4000:4000 johnsonliang/cofacts-url-resolver
```

Visit http://localhost:4000, you will be given a GraphQL Playground. Consult the schema on the right
for reference and usage.

## Development

Install development dependencies

```bash
# After git clone
$ cd url-resolver
$ npm install
```

Start dev server

```bash
$ npm start
```
