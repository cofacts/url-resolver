#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Phase 3: end-to-end benchmark (fetch + parse).
 *
 * Calls the production extractStatic (linkedom) and extractStaticJsdom
 * (jsdom) on each URL. Includes network cost, so numbers are noisier
 * than bench/parse.js and only meaningful with multiple runs and
 * interleaved order.
 *
 * Each run alternates method order to average network variance across
 * backends (URL 1: linkedom then jsdom; URL 2: jsdom then linkedom; ...
 * plus per-run alternation).
 *
 * Reports per-URL median / p95 elapsed_ms per method. Use this to see
 * the practical latency users would observe, and use bench/parse.js
 * for the pure DOM cost.
 *
 * Usage:
 *   node --expose-gc bench/e2e.js [--urls path] [--runs N] [--out csv]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const extractStatic = require('../src/lib/extractStatic');
const extractStaticJsdom = require('../src/lib/extractStaticJsdom');

const RESULTS_DIR = path.join(__dirname, 'results');
const DEFAULT_URLS_FILE = path.join(__dirname, 'sample-urls.txt');

function parseArgs(argv) {
  const args = { urls: DEFAULT_URLS_FILE, runs: 3, out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--urls') args.urls = argv[++i];
    else if (a === '--runs') args.runs = parseInt(argv[++i], 10);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log(
        'Usage: node --expose-gc bench/e2e.js [options]\n' +
          '  --urls <path>  URL list file (default: bench/sample-urls.txt)\n' +
          '  --runs <N>     Runs per URL per backend (default: 3)\n' +
          '  --out <path>   CSV output (default: bench/results/e2e-<ts>.csv)'
      );
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    }
  }
  if (!args.out) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    args.out = path.join(RESULTS_DIR, `e2e-${stamp}.csv`);
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

function median(sorted) {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n % 2) return sorted[(n - 1) / 2];
  return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function percentile(sorted, p) {
  const n = sorted.length;
  if (n === 0) return 0;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
  return sorted[idx];
}

const EXTRACTORS = { linkedom: extractStatic, jsdom: extractStaticJsdom };

async function measureE2e(method, url) {
  if (global.gc) global.gc();
  const t0 = performance.now();
  let result;
  let err;
  try {
    result = await EXTRACTORS[method](url);
  } catch (e) {
    err = e.message || String(e);
  }
  return {
    elapsed_ms: performance.now() - t0,
    result: err ? null : result,
    error: err || null,
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

  fs.mkdirSync(path.dirname(args.out), { recursive: true });

  console.log(`URLs:    ${urls.length} (from ${args.urls})`);
  console.log(`Runs:    ${args.runs} per URL per backend`);
  console.log(`Out CSV: ${args.out}`);
  console.log('');

  const COLUMNS = [
    'url',
    'method',
    'runs',
    'median_ms',
    'p95_ms',
    'success',
    'error',
  ];
  fs.writeFileSync(args.out, `${COLUMNS.join(',')}\n`);

  for (let ui = 0; ui < urls.length; ui++) {
    const url = urls[ui];
    const hash = urlHash(url);

    const samples = { linkedom: [], jsdom: [] };
    let lastResult = { linkedom: null, jsdom: null };
    let lastError = { linkedom: null, jsdom: null };

    for (let r = 0; r < args.runs; r++) {
      // Cross-alternation: URL index parity XOR run index parity chooses order.
      // Over the matrix, each method runs first 50% of the time.
      const linkedomFirst = (ui + r) % 2 === 0;
      const order = linkedomFirst
        ? ['linkedom', 'jsdom']
        : ['jsdom', 'linkedom'];
      for (const method of order) {
        const m = await measureE2e(method, url);
        samples[method].push(m.elapsed_ms);
        if (m.result) lastResult[method] = m.result;
        if (m.error) lastError[method] = m.error;
      }
    }

    for (const method of ['linkedom', 'jsdom']) {
      const sorted = [...samples[method]].sort((a, b) => a - b);
      const med = median(sorted);
      const p95 = percentile(sorted, 95);
      const success = lastResult[method] && !lastResult[method].isIncomplete ? 1 : 0;
      const err = lastError[method] || '';
      fs.appendFileSync(
        args.out,
        `${[
          url.replace(/,/g, '%2C'),
          method,
          args.runs,
          med.toFixed(2),
          p95.toFixed(2),
          success,
          err,
        ].join(',')}\n`
      );
      console.log(
        `[${method.padEnd(8)}] ${hash}  ` +
          `med=${med.toFixed(0)}ms p95=${p95.toFixed(0)}ms  ` +
          `success=${success}  ${err || ''}`
      );
    }
  }

  console.log(`\nCSV: ${args.out}`);
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
