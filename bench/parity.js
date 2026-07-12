#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Content parity report.
 *
 * Reads the per-URL content dump written by bench/parse.js and diffs
 * the linkedom output against the jsdom output for each URL. Reports:
 *   - Exact match / near match (normalized whitespace) / mismatch per field
 *   - Field-level char delta
 *   - Overall parity score
 *
 * A high parity score is the empirical justification for calling the
 * backend swap "correctness-neutral". A low score means the two DOM
 * implementations are seeing the page differently and the claim does
 * not hold — investigate the offending URLs before swapping.
 *
 * Usage:
 *   node bench/parity.js <content-dir>
 *   node bench/parity.js bench/results/parse-2026-07-12T12-00-00.000Z
 */

const fs = require('fs');
const path = require('path');

function normalize(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\s+/g, ' ').trim();
}

function classify(a, b) {
  if (a === b) return 'exact';
  if (a === null && b === null) return 'exact';
  if (a === null || b === null) return 'mismatch';
  if (normalize(a) === normalize(b)) return 'whitespace-only';
  const na = normalize(a);
  const nb = normalize(b);
  // Same prefix up to shorter length + one is a strict extension?
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  if (longer.startsWith(shorter) && shorter.length > 0) return 'prefix-superset';
  return 'mismatch';
}

function main() {
  const contentDir = process.argv[2];
  if (!contentDir) {
    console.error('Usage: node bench/parity.js <content-dir>');
    process.exit(2);
  }
  if (!fs.existsSync(contentDir)) {
    console.error(`Not found: ${contentDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(contentDir).filter(f => f.endsWith('.json'));
  const byHash = new Map();
  for (const f of files) {
    const m = f.match(/^([a-f0-9]+)-(linkedom|jsdom)\.json$/);
    if (!m) continue;
    const [, hash, method] = m;
    if (!byHash.has(hash)) byHash.set(hash, {});
    byHash.get(hash)[method] = JSON.parse(
      fs.readFileSync(path.join(contentDir, f), 'utf8')
    );
  }

  const FIELDS = ['title', 'summary', 'canonical', 'topImageUrl'];
  const totals = { exact: 0, 'whitespace-only': 0, 'prefix-superset': 0, mismatch: 0 };
  const rows = [];
  for (const [hash, data] of byHash.entries()) {
    if (!data.linkedom || !data.jsdom) continue;
    const url = data.linkedom.url;
    const perField = {};
    for (const field of FIELDS) {
      const a = data.linkedom.result && data.linkedom.result[field];
      const b = data.jsdom.result && data.jsdom.result[field];
      const cls = classify(a, b);
      perField[field] = {
        class: cls,
        linkedomLen: (a || '').length,
        jsdomLen: (b || '').length,
      };
      totals[cls] = (totals[cls] || 0) + 1;
    }
    rows.push({ hash, url, perField });
  }

  console.log(`Parity report for ${contentDir}`);
  console.log(`URLs compared: ${rows.length}\n`);

  const totalCells = rows.length * FIELDS.length;
  console.log('Field × class matrix');
  console.log('====================');
  for (const cls of ['exact', 'whitespace-only', 'prefix-superset', 'mismatch']) {
    const pct = totalCells
      ? ((totals[cls] / totalCells) * 100).toFixed(1)
      : '0.0';
    console.log(`  ${cls.padEnd(18)} ${String(totals[cls] || 0).padStart(4)}  (${pct}%)`);
  }
  console.log(`  total              ${String(totalCells).padStart(4)}\n`);

  console.log('Per-URL detail');
  console.log('==============');
  for (const row of rows) {
    const summary = FIELDS.map(f => {
      const pf = row.perField[f];
      const marker = pf.class === 'exact' ? '=' : pf.class === 'mismatch' ? 'X' : '~';
      return `${f}:${marker}`;
    }).join(' ');
    console.log(`${row.hash}  ${summary}  ${row.url}`);
    for (const f of FIELDS) {
      const pf = row.perField[f];
      if (pf.class !== 'exact') {
        console.log(
          `    ${f} ${pf.class}: linkedom=${pf.linkedomLen}ch jsdom=${pf.jsdomLen}ch`
        );
      }
    }
  }

  const parityScore = totalCells
    ? (
        (100 *
          ((totals.exact || 0) +
            (totals['whitespace-only'] || 0) +
            (totals['prefix-superset'] || 0))) /
        totalCells
      ).toFixed(1)
    : '0.0';
  console.log(
    `\nParity score (exact + whitespace-only + prefix-superset): ${parityScore}%`
  );
}

main();
