#!/usr/bin/env node
/* eslint-disable no-console */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const extractStatic = require('../src/lib/extractStatic');

function parseArgs(argv) {
  const args = {
    method: 'both',
    urls: 'bench/sample-urls.txt',
    out: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--urls') args.urls = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--method') args.method = argv[++i];
    else if (a === '-h' || a === '--help') {
      printHelp();
      process.exit(0);
    } else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    }
  }
  if (!['both', 'static', 'puppeteer'].includes(args.method)) {
    console.error(`--method must be one of: both, static, puppeteer`);
    process.exit(2);
  }
  if (!args.out) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    args.out = path.join('bench/results', `${stamp}.csv`);
  }
  return args;
}

function printHelp() {
  console.log(`
Usage: node bench/compare.js [options]

Compare extractStatic (jsdom + Readability) vs scrap (puppeteer) on a list
of URLs. Records elapsed time, RSS delta, V8 heap delta, and (for the
puppeteer path) the per-page JSHeapUsedSize from page.metrics(). Output
CSV is appended one row per URL+method combination.

Options:
  --urls <path>        Path to URL list file. One URL per line; '#' is a
                       comment marker. (default: bench/sample-urls.txt)
  --method <name>      One of: both, static, puppeteer. (default: both)
  --out <path>         CSV output path. (default: bench/results/<timestamp>.csv)
  -h, --help           Show this help.

Tip: launch with --expose-gc so the script can call gc() between URLs
and produce cleaner heap-delta numbers:

  node --expose-gc bench/compare.js --method static
`);
}

function bytesToMb(b) {
  return Math.round((b / 1024 / 1024) * 100) / 100;
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/\r?\n/g, ' ');
  if (s.includes(',') || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const COLUMNS = [
  'url',
  'method',
  'status',
  'elapsed_ms',
  'rss_delta_mb',
  'v8_heap_delta_mb',
  'pup_js_heap_used_mb',
  'title_chars',
  'summary_chars',
  'topimg_present',
  'success',
  'title',
  'error',
];

async function measureStatic(url) {
  if (global.gc) global.gc();
  const m0 = process.memoryUsage();
  const t0 = Date.now();
  let result;
  let err;
  try {
    result = await extractStatic(url);
  } catch (e) {
    err = e.message || String(e);
  }
  const ms = Date.now() - t0;
  const m1 = process.memoryUsage();
  const success = !err && result && !result.isIncomplete;
  return {
    method: 'static',
    status: (result && result.status) || '',
    elapsed_ms: ms,
    rss_delta_mb: bytesToMb(m1.rss - m0.rss),
    v8_heap_delta_mb: bytesToMb(m1.heapUsed - m0.heapUsed),
    pup_js_heap_used_mb: '',
    title_chars: ((result && result.title) || '').length,
    summary_chars: ((result && result.summary) || '').length,
    topimg_present: result && result.topImageUrl ? 1 : 0,
    success: success ? 1 : 0,
    title: (result && result.title) || '',
    error: err || '',
  };
}

async function measurePuppeteer(url, scrap) {
  if (global.gc) global.gc();
  const m0 = process.memoryUsage();
  const t0 = Date.now();
  let result;
  let err;
  try {
    result = await scrap(url);
  } catch (e) {
    err = e.message || String(e);
  }
  const ms = Date.now() - t0;
  const m1 = process.memoryUsage();

  let pupHeap = '';
  try {
    const browser = await scrap.getBrowserPromise();
    const pages = await browser.pages();
    if (pages.length) {
      const metrics = await pages[0].metrics();
      pupHeap = bytesToMb(metrics.JSHeapUsedSize);
    }
  } catch (e) {
    // ignore — page may have been closed before metrics could be sampled
  }

  const success = !err && result && !result.isIncomplete;
  return {
    method: 'puppeteer',
    status: (result && result.status) || '',
    elapsed_ms: ms,
    rss_delta_mb: bytesToMb(m1.rss - m0.rss),
    v8_heap_delta_mb: bytesToMb(m1.heapUsed - m0.heapUsed),
    pup_js_heap_used_mb: pupHeap,
    title_chars: ((result && result.title) || '').length,
    summary_chars: ((result && result.summary) || '').length,
    topimg_present: result && result.topImageUrl ? 1 : 0,
    success: success ? 1 : 0,
    title: (result && result.title) || '',
    error: err || '',
  };
}

function toCsvLine(url, m) {
  return [
    csvEscape(url),
    m.method,
    m.status,
    m.elapsed_ms,
    m.rss_delta_mb,
    m.v8_heap_delta_mb,
    m.pup_js_heap_used_mb,
    m.title_chars,
    m.summary_chars,
    m.topimg_present,
    m.success,
    csvEscape(m.title),
    csvEscape(m.error),
  ].join(',');
}

function summarize(rows) {
  const byMethod = {};
  for (const r of rows) {
    if (!byMethod[r.method]) {
      byMethod[r.method] = {
        count: 0,
        succ: 0,
        ms: 0,
        v8: 0,
        rss: 0,
        pup: 0,
        pupCount: 0,
      };
    }
    const m = byMethod[r.method];
    m.count++;
    if (r.success) m.succ++;
    m.ms += r.elapsed_ms;
    m.v8 += r.v8_heap_delta_mb;
    m.rss += r.rss_delta_mb;
    if (typeof r.pup_js_heap_used_mb === 'number') {
      m.pup += r.pup_js_heap_used_mb;
      m.pupCount++;
    }
  }
  console.log('\n=== Summary ===');
  for (const [name, m] of Object.entries(byMethod)) {
    const succRate = ((m.succ / m.count) * 100).toFixed(1);
    const avgMs = (m.ms / m.count).toFixed(0);
    const avgV8 = (m.v8 / m.count).toFixed(2);
    const avgRss = (m.rss / m.count).toFixed(2);
    const pupAvg = m.pupCount ? (m.pup / m.pupCount).toFixed(2) : '-';
    console.log(
      `  ${name.padEnd(10)} success=${succRate}% ` +
        `avg_ms=${avgMs} avg_v8_delta_mb=${avgV8} ` +
        `avg_rss_delta_mb=${avgRss} avg_pup_js_heap_mb=${pupAvg}`
    );
  }
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

  console.log(`URLs file:  ${args.urls} (${urls.length} URLs)`);
  console.log(`Method:     ${args.method}`);
  console.log(`Output CSV: ${args.out}`);
  console.log(
    global.gc
      ? '(GC exposed: process.memoryUsage will be cleaner between URLs.)'
      : '(GC NOT exposed: launch with `node --expose-gc` for cleaner heap deltas.)'
  );
  console.log('');

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${COLUMNS.join(',')}\n`);

  const runStatic = args.method === 'static' || args.method === 'both';
  const runPup = args.method === 'puppeteer' || args.method === 'both';

  let scrap;
  if (runPup) {
    // eslint-disable-next-line global-require
    scrap = require('../src/lib/scrap');
    await scrap.getBrowserPromise();
  }

  const rows = [];
  for (const url of urls) {
    if (runStatic) {
      const m = await measureStatic(url);
      rows.push(m);
      fs.appendFileSync(args.out, `${toCsvLine(url, m)}\n`);
      console.log(
        `[static]    ${String(m.elapsed_ms).padStart(5)}ms ` +
          `v8+${String(m.v8_heap_delta_mb).padStart(5)}MB ` +
          `success=${m.success} ${m.error || `"${m.title.slice(0, 60)}"`}`
      );
    }
    if (runPup) {
      const m = await measurePuppeteer(url, scrap);
      rows.push(m);
      fs.appendFileSync(args.out, `${toCsvLine(url, m)}\n`);
      const pup =
        m.pup_js_heap_used_mb !== ''
          ? `pup_heap=${m.pup_js_heap_used_mb}MB `
          : '';
      console.log(
        `[puppeteer] ${String(m.elapsed_ms).padStart(5)}ms ${pup}` +
          `success=${m.success} ${m.error || `"${m.title.slice(0, 60)}"`}`
      );
    }
  }

  summarize(rows);
  console.log(`\nCSV: ${args.out}`);

  if (runPup) {
    await scrap.closeBrowser();
  }
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
