# bench/

Compare `extractStatic` (jsdom + Readability) vs `scrap` (puppeteer) on a list
of URLs to quantify when puppeteer is actually needed.

## Run

```bash
# Default: read bench/sample-urls.txt, run both methods, write
# bench/results/<timestamp>.csv
node --expose-gc bench/compare.js

# Only the static path (no chromium boot)
node --expose-gc bench/compare.js --method static --urls my-urls.txt

# Only puppeteer
node --expose-gc bench/compare.js --method puppeteer --urls my-urls.txt
```

`--expose-gc` is recommended so the script can `gc()` between URLs and
produce cleaner V8 heap deltas. Without it, deltas drift upwards as the
process accumulates allocations across URLs.

The URL list file is plain text, one URL per line; lines starting with `#`
are comments.

## What it measures

For each URL × method, one CSV row with:

| Column | What it is |
|---|---|
| `url` | The input URL |
| `method` | `static` or `puppeteer` |
| `status` | HTTP status from the extractor |
| `elapsed_ms` | Wall-clock time of the extraction call |
| `rss_delta_mb` | `process.memoryUsage().rss` delta around the call |
| `v8_heap_delta_mb` | `process.memoryUsage().heapUsed` delta around the call |
| `pup_js_heap_used_mb` | `page.metrics().JSHeapUsedSize` after scrap (puppeteer only) |
| `title_chars` | Length of extracted title |
| `summary_chars` | Length of extracted summary |
| `topimg_present` | 1 if a top image URL was extracted, else 0 |
| `success` | 1 if extraction returned a complete `ScrapResult`, else 0 |
| `title` | First 60 chars of the title (for spot-checking) |
| `error` | Error message if any |

A summary block is also printed at the end of stdout per method:
success rate, average elapsed_ms, average V8 heap delta, average RSS
delta, and average puppeteer page heap.

## Methodology caveats

**Memory numbers are approximate**, not absolute peaks:

- **`v8_heap_delta_mb`** is the difference of `heapUsed` snapshots immediately
  before and after the extraction call. With `--expose-gc` we force a major
  GC before each call so the baseline starts clean. The snapshot after the
  call captures whatever survived the call's own GCs, plus anything jsdom
  retained that has not yet been collected. The delta over-estimates the
  steady-state cost when the V8 heap is growing, and under-estimates the
  peak during the call.
- **`rss_delta_mb`** captures process-wide RSS, including buffers, mmap, and
  shared memory. For the static path this is mostly V8 heap + node-fetch
  socket buffers + jsdom internal allocations. For the puppeteer path the
  Chromium process is **separate**, so this value is dominated by IPC
  buffers and per-page V8 heap inside the Node process — the actual
  Chromium memory is **not** reflected here.
- **`pup_js_heap_used_mb`** comes from `page.metrics().JSHeapUsedSize` and
  is sampled from a remaining page in the puppeteer browser AFTER scrap
  finished closing its own page. It approximates the per-page V8 heap that
  was active while rendering. The persistent ~500 MB Chromium browser
  process overhead is **not** counted per URL — that overhead is amortized
  across all puppeteer pages.

For a clean apples-to-apples comparison of the two paths, run them in
**separate processes**:

```bash
node --expose-gc bench/compare.js --method static    --out bench/results/static.csv
node --expose-gc bench/compare.js --method puppeteer --out bench/results/puppeteer.csv
```

then join the two CSVs by `url`.

## Interpreting results

The headline question this bench answers is: **what fraction of URLs is
extractable by the static path alone?** That fraction is the multiplier on
how much puppeteer concurrency you can shrink in production — and the
~500 MB Chromium overhead can scale down proportionally.

Secondary signals:

- `success=1` rate per method per URL category (docs / news / SPA / social).
- `elapsed_ms` ratio: static is typically 5–20× faster than puppeteer for
  SSR pages.
- `summary_chars` and `topimg_present` parity: when both methods succeed,
  do they extract similar content? Big regressions on either side warn of
  edge cases (paywalls, lazy-loaded images, JS-injected content).
