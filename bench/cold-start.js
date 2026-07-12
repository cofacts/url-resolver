#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Phase 4: cold-start RSS measurement.
 *
 * Spawns child Node processes that each: (a) sample RSS baseline before
 * require, (b) require the backend module, (c) sample RSS again, (d)
 * print both numbers plus the module load time. Repeats N times per
 * backend so the harness can report mean / median / p95 RSS delta.
 *
 * We use child processes because process.memoryUsage() in a long-lived
 * process shifts as V8 heap and native buffers accumulate. Cold-start
 * RSS is only meaningful measured on a freshly-spawned interpreter.
 *
 * The "baseline" backend measures Node + node-fetch + Readability +
 * ScrapeResult only (no DOM), so the linkedom / jsdom deltas are the
 * DOM implementation's own footprint above shared cost.
 *
 * Usage:
 *   node bench/cold-start.js [--runs N]
 */

const { spawnSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

const BACKENDS = {
  baseline: [
    "require('node-fetch');",
    "require('@mozilla/readability');",
    "require('./src/lib/ScrapeResult');",
  ],
  linkedom: [
    "require('node-fetch');",
    "require('@mozilla/readability');",
    "require('./src/lib/ScrapeResult');",
    "require('linkedom');",
  ],
  jsdom: [
    "require('node-fetch');",
    "require('@mozilla/readability');",
    "require('./src/lib/ScrapeResult');",
    "require('jsdom');",
  ],
  extractStatic: ["require('./src/lib/extractStatic');"],
  extractStaticJsdom: ["require('./src/lib/extractStaticJsdom');"],
};

function parseArgs(argv) {
  const args = { runs: 10 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') args.runs = parseInt(argv[++i], 10);
    else if (a === '-h' || a === '--help') {
      console.log(
        'Usage: node bench/cold-start.js [--runs N]\n' +
          '  --runs <N>  Runs per backend (default: 10)'
      );
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function makeChildScript(requires) {
  return [
    "const m0 = process.memoryUsage();",
    "const t0 = process.hrtime.bigint();",
    ...requires,
    "const t1 = process.hrtime.bigint();",
    "const m1 = process.memoryUsage();",
    "console.log(JSON.stringify({",
    "  rss_before: m0.rss,",
    "  rss_after: m1.rss,",
    "  heap_before: m0.heapUsed,",
    "  heap_after: m1.heapUsed,",
    "  load_ns: Number(t1 - t0),",
    "}));",
  ].join('\n');
}

function runOnce(backend, requires) {
  const script = makeChildScript(requires);
  const res = spawnSync(process.execPath, ['-e', script], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(
      `[${backend}] child exited ${res.status}: ${res.stderr.trim() || res.stdout.trim()}`
    );
  }
  return JSON.parse(res.stdout);
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

function bytesToMb(b) {
  return Math.round((b / 1024 / 1024) * 100) / 100;
}

function main() {
  const args = parseArgs(process.argv);
  console.log(`Runs per backend: ${args.runs}`);
  console.log(`Node: ${process.version}\n`);

  const results = {};
  for (const [backend, requires] of Object.entries(BACKENDS)) {
    const samples = [];
    for (let i = 0; i < args.runs; i++) {
      const m = runOnce(backend, requires);
      samples.push({
        rss_after: m.rss_after,
        rss_delta: m.rss_after - m.rss_before,
        heap_after: m.heap_after,
        heap_delta: m.heap_after - m.heap_before,
        load_ms: m.load_ns / 1e6,
      });
    }
    results[backend] = samples;
  }

  const COLS = ['backend', 'runs', 'field', 'mean', 'median', 'p95'];
  console.log(COLS.join('\t'));
  for (const [backend, samples] of Object.entries(results)) {
    const fields = {
      rss_after_mb: samples.map(s => bytesToMb(s.rss_after)),
      rss_delta_mb: samples.map(s => bytesToMb(s.rss_delta)),
      heap_after_mb: samples.map(s => bytesToMb(s.heap_after)),
      heap_delta_mb: samples.map(s => bytesToMb(s.heap_delta)),
      load_ms: samples.map(s => s.load_ms),
    };
    for (const [field, values] of Object.entries(fields)) {
      const sorted = [...values].sort((a, b) => a - b);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      console.log(
        [
          backend,
          samples.length,
          field,
          mean.toFixed(2),
          median(sorted).toFixed(2),
          percentile(sorted, 95).toFixed(2),
        ].join('\t')
      );
    }
  }
}

main();
