# bench/

Compare `linkedom + Readability` against `jsdom + Readability` as the DOM
backend for `src/lib/extractStatic.js`. Four phases, each addressing a
distinct measurement concern.

## Layout

```
bench/
  fetch.js         # phase 1: cache HTML fixtures on disk
  parsers.js       # shared parse-only helpers for both backends
  parse.js         # phase 2: parse-only timing on fixtures, N runs, median/p95
  parity.js        # content diff between backends per URL
  e2e.js           # phase 3: end-to-end timing on live URLs, interleaved runs
  cold-start.js    # phase 4: per-backend cold-start RSS via child processes
  sample-urls.txt  # URL list (docs / TW news / SPA)
  fixtures/        # HTML cache (gitignored)
  results/         # CSVs and content dumps (gitignored)
```

## Recommended workflow

```bash
# 1. Fixtures are committed to the branch so numbers reproduce. Rerun
#    only when refreshing the URL set or verifying no network drift.
node bench/fetch.js               # idempotent: skips URLs that already
                                  # have a fixture. --refetch to force.

# 2. Parse-only benchmark. This is the pure DOM comparison — no network.
node --expose-gc bench/parse.js --runs 10

# 3. Compare full extraction output between backends.
node bench/parity.js bench/results/parse-<timestamp>

# 4. End-to-end benchmark (includes fetch). Noisier; use for reference.
node --expose-gc bench/e2e.js --runs 3

# 5. Cold-start RSS (spawns child processes).
node bench/cold-start.js --runs 10
```

## Why fixtures are committed

`bench/fixtures/` is checked in so `bench/parse.js` and `bench/parity.js`
measure against a pinned input. Websites change (redesigns, lazy-load
migrations, A/B experiments, personalization), and two independent
`bench/fetch.js` runs on different days can return different HTML — that
turns the input into a variable and stops the numbers being comparable
across time or across reviewers. Committing the fixture set removes that
variable: whoever pulls this branch parses exactly the HTML that the
reported numbers were measured against.

`bench/results/` stays gitignored: those are run outputs and vary per
machine / per run. The whole point of the reviewer running the harness
is producing their own results to compare against ours.

## Why phase 2 is the meaningful DOM comparison

Timing `extractStatic()` end-to-end mixes DNS, TLS, server latency, and
HTML download into the measurement — network cost typically dominates
and dwarfs any DOM parser difference. Two independent fetches also risk
receiving different HTML (server-side variance, A/B experiments,
personalization), so the two backends may not even be parsing the same
input.

Phase 1 fetches each URL once and caches the response body. Phase 2
loads the cached HTML from disk and times only the parse + Readability
step, with:

- N runs per URL per backend (default: 5).
- Backend order alternated per run to defeat V8 warm-cache bias
  (whichever backend runs second is otherwise favored by JIT / GC
  state).
- Forced GC between runs when launched with `--expose-gc` so
  `heap_delta_mb` reflects allocations from the parse call itself.
- Reports per-URL median and p95, not mean.

## Interpreting the parity report

`bench/parity.js` classifies each `(URL, field)` pair as:

- `exact` — byte-identical output between backends.
- `whitespace-only` — differences only in `\s+` runs (both DOMs
  normalize whitespace slightly differently; not a correctness issue).
- `prefix-superset` — one output is a strict prefix of the other after
  whitespace normalization (typically one backend captured a longer
  version of the article body).
- `mismatch` — genuinely different content.

`exact + whitespace-only + prefix-superset` is reported as the parity
score. A high score is the empirical justification for calling the DOM
swap "correctness-neutral". A low score means the backends disagree on
content and any speed or memory win must be weighed against the
regression.

## Cold-start RSS caveats

`bench/cold-start.js` spawns child Node processes so each measurement
starts from a clean V8 heap. It reports RSS **after** the `require()`
call for each backend, plus deltas above a `baseline` backend (Node +
node-fetch + Readability + ScrapeResult, without any DOM library). The
delta above baseline is the DOM implementation's footprint.

RSS is a whole-process metric and includes mmap, native buffers, and
shared library residency, so absolute numbers depend on the OS and the
Node build. Cross-machine comparisons of absolute RSS are unreliable;
the delta between backends on the same machine is what the harness is
scoped to measure.

## Adding your own URLs

Edit `bench/sample-urls.txt` — one URL per line, `#` for comments —
then rerun from phase 1. Fixtures are keyed by SHA-256 of the URL, so
adding new URLs does not re-fetch existing ones.

For production tuning, replace the sample list with a real slice of
Cofacts traffic. The static-path success rate (per `bench/parity.js`
plus the `success` column in `parse.js` output) drives how much
puppeteer concurrency can be reclaimed.
