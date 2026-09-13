# Chart-selection test page — implementation plan

**Design:** `docs/plans/2026-09-13-chart-selection-matrix-design.md` (read that first; this
file is the task breakdown, not a second design).

**Note on detail level:** the design doc is unusually complete, and the same session that
wrote it implements it immediately, so the tasks below state each step's acceptance criterion
and the *decisive* code shape rather than transcribing every line. Anything left out here is
mechanical (JSX layout, CSS values) rather than a decision.

## One change to the design, found while planning

The design put `DATASETS` (which holds rows) in `presets.ts`. That breaks the catalog test:
`data.ts` imports `.json`, and plain `node --experimental-strip-types` needs an import
attribute for JSON — which the Vite build does not, so the test and the page would need
different syntaxes for the same file.

Split instead:

| Module | Holds | Imports JSON? | Who imports it |
|---|---|---|---|
| `src/presets.ts` | `ChartPreset[]`, `DatasetId`, `DATASET_META` (label, `preAggregated`) | no | the test **and** the page |
| `src/datasets.ts` | `id → { rows, description?, columns? }` | yes | the page only |

Every catalog check in the design needs only metadata (which dataset, is it pre-aggregated,
which types), never a row — so the test stays a pure Node test with no bundler.

---

## Task 1 — the range dataset

**Files:** `scripts/generate-data.mjs`, `data/settlement-lag-band.json` (generated),
`src/data.ts`

- [ ] Add `SETTLEMENT_LAG_BAND_OUT` alongside the other three output paths.
- [ ] Compute it the way the other summaries are: group `rows` by `trade_date.slice(0, 7)`,
      map to `{ month, lag_low_days, lag_high_days, trades }`, sort by month. Low/high are
      `min`/`max` of `settlement_lag_days` — not additive, and the generator already prints a
      "what re-aggregating would do" report, so add this table to it.
- [ ] `writeJson` it and log the row count.
- [ ] `src/data.ts`: import and export `settlementLagBand`, with a header line saying what the
      band is for (a range needs a low and a high; this is the only dataset that has both).

**Acceptance:** `npm run gen:data` writes the file; it has one row per month with
`lag_low_days <= lag_high_days`; re-running produces byte-identical output.

## Task 2 — the catalog

**Files:** `src/presets.ts` (create), `src/demos.ts` (extract three constants)

- [ ] `demos.ts`: lift the `dataDescription`/`columns` pairs for `counterparty-summary`,
      `monthly-activity` and `cancellations-by-month` into exported constants
      (`SUMMARY_TABLE`, `MONTHLY_TABLE`, `CANCELLATIONS_TABLE`), and have the `DEMOS` entries
      spread them. No behaviour change; this is what lets the matrix send the same words.
- [ ] `src/presets.ts`:
      ```ts
      export type DatasetId = 'post-trade' | 'counterparty-summary' | 'monthly-activity' | 'settlement-lag-band';
      export type ChartPreset = {
        id: string; exercises: ChartType; accepts: ChartType[]; query: string;
        dataset: DatasetId; mode: 'ask' | 'present'; why: string;
      };
      export const DATASET_META: Record<DatasetId, { label: string; preAggregated: boolean; rows: number }> = {…};
      export const PRESETS: ChartPreset[] = [ …the 11 rows from the design's table… ];
      ```
      `ChartType` is `import type` from `chartwright` (erased at runtime, so the test stays
      dependency-free). `DATASET_META.rows` is the count, recorded so the page can print it
      without loading the rows.

**Acceptance:** `tsc` accepts it; a mistyped type is a compile error; no JSON import.

## Task 3 — the catalog test, and putting it where tests run

**Files:** `test/presets.test.ts` (create), `scripts/verify-tests.mjs` (modify),
`server/proxy.test.mjs` → `test/proxy.test.mjs` (move), `examples/react-highcharts/package.json`
(`test:proxy` path)

- [ ] `scripts/verify-tests.mjs`: walk `examples/*/test/` as well as `packages/*/test/`,
      matching `.test.ts` and `.test.mjs`. Update the header comment: the reason is that the
      example's tests were outside the gate entirely.
- [ ] Move `server/proxy.test.mjs` to `test/` so the extended runner picks it up, and fix the
      `test:proxy` script path. It currently passes and runs nowhere — a test that never runs
      is worse than no test, because it implies coverage.
- [ ] `test/presets.test.ts`, six checks, no provider:
      1. every declared type appears in some `accepts` list (`listChartTypes()` as the source);
      2. `accepts` contains only declared types;
      3. every `dataset` id is a key of `DATASET_META`;
      4. `exercises ∈ accepts` for every preset;
      5. a `present` preset never names a dataset with `preAggregated: false`;
      6. no query accepts *some but not all* of `line`/`spline`/`area`/`areaspline` — those four
         are indistinguishable from wording, so accepting one and rejecting another would be a
         false failure by construction.

**Acceptance:** `node --experimental-strip-types test/presets.test.ts` passes and fails when a
check is deliberately broken; `npm run verify` runs it.

## Task 4 — the page

**Files:** `src/components/TypeMatrix.tsx` (create), `src/datasets.ts` (create)

- [ ] `src/datasets.ts`: `id → { rows, description?, columns? }`, spreading the constants from
      Task 2 for the three pre-aggregated tables. Page-only, because it imports JSON.
- [ ] `TypeMatrix.tsx`:
      - coverage strip from `listChartTypes()`, three states (`✓ produced` /
        `· tested, not produced` / `— not yet tested`) derived from the run results;
      - one group per distinct `accepts` set, ordered by declaration order of its first type;
      - per query: a Run button, the query, `mode · dataset label · row count`, and after a run
        the picked type, verdict, elapsed seconds and any warnings;
      - a mismatch callout showing `accepts` and `why` when `picked ∉ accepts`;
      - a summary line and a Clear button.
      - state is one `Record<presetId, RunState>` in `useState`; `RunState` is a discriminated
        union over `idle | running | error | done` so "not run" and "failed" cannot be confused.
      - the ask path is `createChartwright({ llm: createBrowserClient() })` — the same client
        `AgentDemo` uses, so the page tests the real thing.

**Acceptance:** the page renders all 14 types in the strip and all 11 queries; a query run
without a proxy shows the error and stays "not run".

## Task 5 — the second entry

**Files:** `matrix.html` (create), `src/matrix-main.tsx` (create), `vite.config.ts` (modify),
`src/App.tsx` (modify)

- [ ] `matrix.html`: same shell as `index.html`, mounting `/src/matrix-main.tsx`, with a title
      that says what the page is for.
- [ ] `src/matrix-main.tsx`: mount `<TypeMatrix />` in `StrictMode`.
- [ ] `vite.config.ts`: `build.rollupOptions.input = { main: 'index.html', matrix: 'matrix.html' }`,
      with a comment saying why (two entries, no router, no dependency).
- [ ] `src/App.tsx`: a link to `/matrix.html` beside the existing nav, saying it needs a key.

**Acceptance:** dev server serves `/matrix.html`; `npm run build` emits both pages;
`npm run typecheck:example` passes.

## Task 6 — verification

- [ ] `npm run verify` — build, typecheck (both), the new test file in the run, showcase check,
      pack:check.
- [ ] Browser: open `/matrix.html`, confirm the strip lists 14 declared types and the 11
      queries render with their groups.
- [ ] Browser: open `/` and confirm the showcase is untouched (30 of 30 still drawn) and the new
      nav link works.
- [ ] `git status` clean, commit.

## What this plan does not include

- The CI hit-rate floor (§5.7). The catalog is what a floor needs; the number wants one real
  run first. Recorded in the design.
- Persisting results across reloads. A persisted ✓ that survives a library change is a stale
  claim; re-running is cheap and honest.
- Any change to the library. This page only observes it.
