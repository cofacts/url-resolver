#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Phase 2: parse-only benchmark.
 *
 * For each fixture cached by bench/fetch.js, run bench/parsers.js
 * (linkedom + Readability, then jsdom + Readability) N times on the
 * same HTML in memory. Report per-URL median / p95 elapsed_ms and
 * heap delta per backend. Also save the full extraction output per
 * (URL, backend) so bench/parity.js can diff them and detect drift or
 * correctness differences.
 *
 * The two backends are interleaved across runs to defeat V8
 * warm-cache bias (whichever backend runs second is otherwise favored
 * by JIT / GC state).
 *
 * Recommended: launch with `node --expose-gc bench/parse.js` so the
 * script can force a GC between runs and produce cleaner heap deltas.
 *
 * Usage:
 *   node --expose-gc bench/parse.js [--urls path] [--runs N] [--out csv]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { parseLinkedom, parseJsdom } = require('./parsers');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const RESULTS_DIR = path.join(__dirname, 'results');
const DEFAULT_URLS_FILE = path.join(__dirname, 'sample-urls.txt');

function parseArgs(argv) {
  const args = {
    urls: DEFAULT_URLS_FILE,
    runs: 5,
    out: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--urls') args.urls = argv[++i];
    else if (a === '--runs') args.runs = parseInt(argv[++i], 10);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log(
        'Usage: node --expose-gc bench/parse.js [options]\n' +
          '  --urls <path>  URL list file (default: bench/sample-urls.txt)\n' +
          '  --runs <N>     Runs per URL per backend (default: 5)\n' +
          '  --out <path>   Aggregate CSV output (default: bench/results/parse-<ts>.csv)'
      );
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    }
  }
  if (!args.out) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    args.out = path.join(RESULTS_DIR, `parse-${stamp}.csv`);
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

// Percentile-nearest-rank (matches Prometheus / most CI tooling).
function percentile(sorted, p) {
  const n = sorted.length;
  if (n === 0) return 0;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
  return sorted[idx];
}

function bytesToMb(b) {
  return Math.round((b / 1024 / 1024) * 100) / 100;
}

const PARSERS = {
  linkedom: parseLinkedom,
  jsdom: parseJsdom,
};

function measureParse(method, html, finalUrl) {
  if (global.gc) global.gc();
  const m0 = process.memoryUsage();
  const t0 = performance.now();
  let result;
  let err;
  try {
    result = PARSERS[method](html, finalUrl);
  } catch (e) {
    err = e.message || String(e);
  }
  const t1 = performance.now();
  const m1 = process.memoryUsage();
  return {
    elapsed_ms: t1 - t0,
    heap_delta_mb: bytesToMb(m1.heapUsed - m0.heapUsed),
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
  const runId = path.basename(args.out, '.csv');
  const contentDir = path.join(RESULTS_DIR, runId);
  fs.mkdirSync(contentDir, { recursive: true });

  console.log(`URLs:    ${urls.length} (from ${args.urls})`);
  console.log(`Runs:    ${args.runs} per URL per backend`);
  console.log(`Out CSV: ${args.out}`);
  console.log(`Content: ${contentDir}/<url-hash>-<method>.json`);
  console.log(
    global.gc
      ? '(GC exposed: heap deltas will be cleaner between runs.)'
      : '(GC NOT exposed: launch with `node --expose-gc` for cleaner heap deltas.)'
  );
  console.log('');

  const COLUMNS = [
    'url',
    'method',
    'runs',
    'median_ms',
    'p95_ms',
    'median_heap_delta_mb',
    'success',
    'error',
  ];
  fs.writeFileSync(args.out, `${COLUMNS.join(',')}\n`);

  for (const url of urls) {
    const hash = urlHash(url);
    const htmlPath = path.join(FIXTURES_DIR, `${hash}.html`);
    const metaPath = path.join(FIXTURES_DIR, `${hash}.meta.json`);
    if (!fs.existsSync(htmlPath) || !fs.existsSync(metaPath)) {
      console.log(`[skip] ${hash}  no fixture  ${url}`);
      continue;
    }
    const html = fs.readFileSync(htmlPath, 'utf8');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (!meta.ok) {
      console.log(`[skip] ${hash}  fetch failed: ${meta.error}  ${url}`);
      continue;
    }
    const finalUrl = meta.finalUrl || url;

    const samples = { linkedom: [], jsdom: [] };
    const heapSamples = { linkedom: [], jsdom: [] };
    const lastResults = {};
    const lastErrors = {};
    for (let r = 0; r < args.runs; r++) {
      // Alternate method order per run to defeat warm-cache bias.
      const order = r % 2 === 0 ? ['linkedom', 'jsdom'] : ['jsdom', 'linkedom'];
      for (const method of order) {
        const m = measureParse(method, html, finalUrl);
        samples[method].push(m.elapsed_ms);
        heapSamples[method].push(m.heap_delta_mb);
        if (m.result) lastResults[method] = m.result;
        if (m.error) lastErrors[method] = m.error;
      }
    }

    for (const method of ['linkedom', 'jsdom']) {
      const sortedMs = [...samples[method]].sort((a, b) => a - b);
      const sortedHeap = [...heapSamples[method]].sort((a, b) => a - b);
      const med = median(sortedMs);
      const p95 = percentile(sortedMs, 95);
      const heapMed = median(sortedHeap);
      const result = lastResults[method];
      const err = lastErrors[method] || '';
      const titleSlice = ((result && result.title) || '').slice(0, 40);
      const line = [
        url.replace(/,/g, '%2C'),
        method,
        args.runs,
        med.toFixed(2),
        p95.toFixed(2),
        heapMed.toFixed(2),
        result ? 1 : 0,
        err,
      ].join(',');
      fs.appendFileSync(args.out, `${line}\n`);
      console.log(
        `[${method.padEnd(8)}] ${hash}  ` +
          `med=${med.toFixed(1)}ms p95=${p95.toFixed(1)}ms ` +
          `heap=${heapMed.toFixed(2)}MB  ${err || `"${titleSlice}"`}`
      );

      const contentFile = path.join(contentDir, `${hash}-${method}.json`);
      fs.writeFileSync(
        contentFile,
        JSON.stringify(
          {
            url,
            finalUrl,
            method,
            runs: args.runs,
            median_ms: med,
            p95_ms: p95,
            median_heap_delta_mb: heapMed,
            result,
            error: err || null,
          },
          null,
          2
        )
      );
    }
  }

  console.log(`\nAggregate CSV:   ${args.out}`);
  console.log(`Per-URL content: ${contentDir}/`);
  console.log(`Run bench/parity.js against this run to diff backends.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
