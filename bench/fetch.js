#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Phase 1: fetch each URL once, cache the HTML + response metadata to
 * bench/fixtures/. Idempotent: existing fixtures are skipped unless
 * --refetch is passed. bench/parse.js and bench/parity.js read from
 * this cache so benchmark runs do not fetch the URL again and can be
 * repeated cheaply.
 *
 * Usage:
 *   node bench/fetch.js [--urls path] [--refetch]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const DEFAULT_URLS_FILE = path.join(__dirname, 'sample-urls.txt');
const FETCH_TIMEOUT = 15000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const USER_AGENT =
  process.env.URL_RESOLVER_USER_AGENT ||
  'CofactsBot/1.0 (+https://cofacts.tw/bot)';

function parseArgs(argv) {
  const args = { urls: DEFAULT_URLS_FILE, refetch: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--urls') args.urls = argv[++i];
    else if (a === '--refetch') args.refetch = true;
    else if (a === '-h' || a === '--help') {
      console.log(
        'Usage: node bench/fetch.js [--urls path] [--refetch]\n' +
          '  --urls <path>  URL list file (default: bench/sample-urls.txt)\n' +
          '  --refetch      Re-download URLs even if fixture exists'
      );
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function urlHash(url) {
  return crypto
    .createHash('sha256')
    .update(url)
    .digest('hex')
    .slice(0, 16);
}

async function fetchOne(url) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      timeout: FETCH_TIMEOUT,
      size: MAX_BODY_BYTES,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
  } catch (e) {
    return { ok: false, error: e.message || String(e), elapsed_ms: Date.now() - t0 };
  }

  const finalUrl = res.url || url;
  const status = res.status;
  const contentType = res.headers.get('content-type') || '';
  let body = '';
  try {
    body = await res.text();
  } catch (e) {
    return { ok: false, error: `read body: ${e.message}`, elapsed_ms: Date.now() - t0 };
  }

  return {
    ok: true,
    status,
    finalUrl,
    contentType,
    body,
    elapsed_ms: Date.now() - t0,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.urls)) {
    console.error(`URLs file not found: ${args.urls}`);
    process.exit(1);
  }
  const urls = fs
    .readFileSync(args.urls, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  console.log(`Fetching ${urls.length} URLs to ${FIXTURES_DIR}\n`);

  for (const url of urls) {
    const hash = urlHash(url);
    const htmlPath = path.join(FIXTURES_DIR, `${hash}.html`);
    const metaPath = path.join(FIXTURES_DIR, `${hash}.meta.json`);

    if (!args.refetch && fs.existsSync(htmlPath) && fs.existsSync(metaPath)) {
      console.log(`[skip] ${hash}  ${url}`);
      continue;
    }

    const result = await fetchOne(url);
    if (!result.ok) {
      const meta = {
        url,
        fetchedAt: new Date().toISOString(),
        ok: false,
        error: result.error,
        elapsed_ms: result.elapsed_ms,
      };
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      console.log(
        `[FAIL] ${hash}  ${result.elapsed_ms}ms  ${result.error}  ${url}`
      );
      continue;
    }

    fs.writeFileSync(htmlPath, result.body);
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          url,
          fetchedAt: new Date().toISOString(),
          ok: true,
          status: result.status,
          finalUrl: result.finalUrl,
          contentType: result.contentType,
          bytes: Buffer.byteLength(result.body, 'utf8'),
          elapsed_ms: result.elapsed_ms,
        },
        null,
        2
      )
    );
    console.log(
      `[ok]   ${hash}  ${result.status}  ${result.elapsed_ms}ms  ` +
        `${(Buffer.byteLength(result.body, 'utf8') / 1024).toFixed(0)}KB  ${url}`
    );
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
