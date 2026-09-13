# Chart-selection test page — design

**Date:** 2026-09-13
**Status:** approved, ready for an implementation plan
**Where:** `examples/react-highcharts` (a page in the example, not a library change)

> Placement note: this repository keeps planning artifacts in `docs/plans/`, so the design
> lives here rather than in the skill default (`docs/superpowers/specs/`).

## The problem

The library declares 14 chart types. The example page shows all of them, but it shows them
from **hand-written specs** compiled into the page — no model involved. The one section that
does call a model ("Run the agent") offers ~15 presets grouped by *demo and mode*
(ask / present / monthly / gapped), and those presets cover roughly 5 of the 14 types.

So there is no way to answer, by hand or otherwise: **when a user asks a question, does the
model pick a chart type that suits it?** Eight of the declared types cannot be tested at all,
and for the rest nothing on the page says what type was expected, so a wrong pick looks
exactly like a right one.

The plan already wants this measured — §5.7 calls for "a labelled set (request → acceptable
type(s)) run in CI, asserting the hit rate of `result.spec.chart.type` against a floor".
This page is that labelled set, made runnable by hand first. CI can come later; the labels
are the expensive part and they are the same either way.

## Goal

A page where each declared chart type can be exercised by a real query, where the expected
result is stated, and where a wrong pick is visible immediately.

**Success:** every one of the 14 declared types can be exercised from the page, and after a
run the page says whether the type the model chose was an acceptable answer to that question.

## Non-goals

- **No batch "run all".** The owner chose one-at-a-time: 14+ provider calls in one click is a
  token bill and a slow page, and the point is to look at each result.
- **No persistence.** Results live in component state for the session, with a Clear button. A
  persisted verdict that survives a code change would be a stale claim about the current
  library, which is worse than having to re-run.
- **No change to the library.** This page only observes `createChartwright`; it adds no option,
  no export, and no behaviour. If the page needs something the library does not expose, that
  is a separate decision.
- **No CI gate.** Running a provider in CI needs credentials and is nondeterministic. The
  catalog is written to be reusable by such a job (`npm run smoke:live` is the existing
  precedent for a manual-only check), but wiring it is not part of this work.

## The honesty constraint that shapes everything

`line`, `spline`, `area` and `areaspline` are **stylistic variants of one answer**. No wording
distinguishes "show me the trend over months as a spline" from the same request as a line, and
the compiler treats them identically except for the Highcharts type. The same is true of
`columnrange` / `arearange` / `areasplinerange` / `errorbar` / `dumbbell` on a range question:
which one is right is a presentation preference, not a fact about the data.

A harness that demanded one exact type per query would therefore report **false failures** on
five of the fourteen types, and a false failure is worse than no test — it trains the reader
to ignore the verdict.

So every query declares an **accepted set**, and the verdict is:

```
picked ∈ accepts   →  ✓
picked ∉ accepts   →  ✗  (and the page shows what was accepted, and why)
```

This is not a loosening of the check. It is the check stated correctly: the question the page
answers is "did the model choose a type that suits this question", not "did it read my mind".

## Architecture

```
matrix.html ──────────► src/matrix-main.tsx ──► <TypeMatrix />
                                                   │
                              src/presets.ts ──────┤  the catalog: query, dataset, mode,
                              (single source)      │  accepts[], why
                                                   │
                              src/askOnce.ts ──────┘  one ask() against the browser client
```

`TypeMatrix` renders and holds session state. `presets.ts` holds data and no React. The ask
path is the same one `AgentDemo` already uses, so the page tests the real thing rather than a
parallel implementation of it.

### Files

| File | Action | Responsibility |
|---|---|---|
| `src/presets.ts` | create | The catalog. Types, the 11 queries, dataset registry lookup. No React, no I/O. |
| `src/components/TypeMatrix.tsx` | create | Coverage strip, grouped query list, per-query verdict, mismatch callout. |
| `src/matrix-main.tsx` | create | Mounts `<TypeMatrix />` into `#root`. |
| `matrix.html` | create | The second entry's shell. |
| `data/settlement-lag-band.json` | create (generated) | The range dataset: `month`, `lag_low_days`, `lag_high_days`. |
| `scripts/generate-data.mjs` | modify | Also emit `settlement-lag-band.json`. |
| `vite.config.ts` | modify | `build.rollupOptions.input` for both HTML entries. |
| `src/data.ts` | modify | Load and export the band dataset. |
| `src/demos.ts` | modify (one extraction) | Lift the three tables' `description`/`columns` text to named exports so both pages send one copy. |
| `src/App.tsx` | modify | A link from the main page to the matrix page. |
| `test/presets.test.ts` | create | The six catalog checks below. No provider needed. |
| `scripts/verify-tests.mjs` | modify | Also walk `examples/*/test/`, so the test above actually runs. |
| `server/proxy.test.mjs` → `test/proxy.test.mjs` | move (recommended) | It is currently run by nothing; the extended runner would pick it up. `test:proxy` follows. |

`src/demos.ts` is touched in exactly one way: the `description`/`columns` text for the three
pre-aggregated tables is lifted into named exports (`SUMMARY_TABLE`, `MONTHLY_TABLE`,
`CANCELLATIONS_TABLE`) so the matrix can send the same words. No behaviour changes, and the
`DEMOS` array keeps its own shape. Beyond that extraction, `AgentDemo.tsx` and `demos.ts` are
**deliberately untouched**: they demonstrate *modes* (present vs ask, column descriptions,
gapped dates); the matrix tests *type selection*. The two lists overlap in places but answer
different questions, and merging them would mean one list serving two purposes badly. Each
file's header will say so.

## The catalog

```ts
/** Which rows a preset hands over. Ids, not the rows themselves: the registry owns the data. */
export type DatasetId = 'post-trade' | 'counterparty-summary' | 'monthly-activity' | 'settlement-lag-band';

export type ChartPreset = {
  id: string;
  /** The type this query is meant to exercise — the row it appears under. */
  exercises: ChartType;
  /** Every type that would be an honest answer. The verdict is `picked ∈ accepts`. */
  accepts: ChartType[];
  query: string;
  dataset: DatasetId;
  mode: 'ask' | 'present';
  /** What a correct answer looks like, and what a wrong one would look like. Shown on the page. */
  why: string;
};

export const PRESETS: ChartPreset[] = [/* 11 entries, below */];

/** The datasets, so a preset names rows without importing them into every consumer. */
export const DATASETS: Record<DatasetId, { rows: Row[]; label: string; description?: string }> = {
  'post-trade': { rows: postTrade, label: 'post-trade.json' },
  'counterparty-summary': { rows: counterpartySummary, label: 'counterparty-summary.json', ...SUMMARY_TABLE },
  'monthly-activity': { rows: monthlyActivity, label: 'monthly-activity.json', ...MONTHLY_TABLE },
  'settlement-lag-band': { rows: settlementLagBand, label: 'settlement-lag-band.json' },
};
```

`SUMMARY_TABLE` and `MONTHLY_TABLE` are `{ description, columns }` pairs extracted from
`demos.ts` — the same strings it already sends, lifted to named exports so both pages use one
copy. A present-mode table whose columns are averages and distinct counts needs that text
whichever page asks, and two copies would eventually disagree. `post-trade` is raw and has
none: there is nothing about those rows a description would need to correct.

`ChartType` is imported from the library (`chartwright`), so a typo in a preset is a build
error rather than a query that silently never matches.

### The 11 queries, against the 14 types

Nine types use existing data; the five range types share the new band dataset. Grouped as the
page groups them:

| Group (types exercised) | Dataset | Mode | Query | accepts |
|---|---|---|---|---|
| `bar` | post-trade | ask | Which 10 counterparties have the largest traded notional? | `bar` |
| `line` · `spline` · `area` · `areaspline` | monthly-activity | present | How has traded notional developed over the six months? | `line`, `spline`, `area`, `areaspline` |
| `line` (ask) | post-trade | ask | How has monthly traded notional developed, split by asset class? | `line`, `spline`, `area`, `areaspline` |
| `pie` | post-trade | ask | What share of total notional does each asset class represent? | `pie` |
| `heatmap` | post-trade | ask | Show traded notional by desk and asset class as a grid | `heatmap` |
| `scatter` | post-trade | ask | Is there a relationship between trade size and commission? | `scatter` |
| `bubble` | post-trade | ask | Plot notional against commission, with how many trades as the bubble size | `bubble` |
| `columnrange` · `arearange` · `areasplinerange` · `errorbar` | settlement-lag-band | present | Chart the monthly settlement lag range | `columnrange`, `arearange`, `areasplinerange`, `errorbar` |
| `dumbbell` | settlement-lag-band | present | Compare the fastest and slowest settlement lag for each month | `dumbbell`, `columnrange`, `errorbar` |
| `bar` (present) | counterparty-summary | present | Chart the traded notional by counterparty | `bar` |
| `arearange` (second angle) | settlement-lag-band | present | How has the settlement lag band moved month by month? | `arearange`, `areasplinerange`, `columnrange` |

That is 11 rows covering 14 types. Every declared type appears in at least one `accepts` list;
the coverage strip is what asserts that, from `listChartTypes()` rather than from this table.

A query exercises more than one type where the types are interchangeable (see the honesty
constraint). `exercises` names the type the row is filed under; `accepts` is the set that
passes.

### The dataset for the range types

> **Changed during implementation.** This section specifies a *settlement-lag* band
> (`lag_low_days`/`lag_high_days`). Built and measured, that band was `0–3` in **every one of
> the six months** — settlement lag is a small bounded integer and the synthetic feed is
> stationary, so five identical bands would have made the page unable to show whether a range
> chart was drawing correctly. Min/max of trade size was tried next and had the opposite
> problem: heavy-tailed, so the band ran from a few thousand dollars to fifty million in every
> month and filled the plot. The dataset shipped is the **middle half of trade sizes** (p25–p75
> of `notional_usd` per month), whose edges both move:
>
> ```
> 2026-01  1.1M - 8.3M      2026-04  1.7M - 7.0M
> 2026-02  1.4M - 9.2M      2026-05  1.7M - 9.3M
> 2026-03  0.9M - 8.6M      2026-06  1.0M - 7.9M
> ```
>
> The file is `trade-size-band.json` with `notional_low_usd`/`notional_high_usd`. Everything
> else in this design is unchanged, including why the table exists at all.

`trade-size-band.json`, one row per month of 2026:

```json
{ "month": "2026-01", "lag_low_days": 1, "lag_high_days": 6, "trades": 128 }
```

Minimum and maximum settlement lag per month, computed from `post-trade.json` by
`scripts/generate-data.mjs` — the same source and the same script that produce the other four
datasets, so the numbers stay consistent with the feed they came from.

This shape serves all five range types: `low`/`high` per category is what they all declare.
A range over months is also the canonical use of `arearange`, so the example teaches the
type rather than merely exercising it.

## The page

### 1. Coverage strip

All 14 declared types, taken from `listChartTypes()` — **not** hand-written, so a newly
declared type appears here automatically and the list cannot drift from the library.

Per type, three states:

| State | Meaning |
|---|---|
| `✓ produced` | Some run picked this type, and that was acceptable for the query. |
| `· tested, not produced` | Every query that accepts this type has been run; none of them picked it. |
| `— not yet tested` | At least one query accepting this type has not been run. |

This is the direct answer to "which types can I not test yet", and it is the reason the strip
comes before the queries.

### 2. Queries, grouped

One group per distinct `accepts` set, ordered by declaration order of the first type in it —
so the page reads in the same order every other list in the project uses. Each group shows its
types as a heading (`line · spline · area · areaspline`), then one row per query:

```
line · spline · area · areaspline
  [ Run ]  How has traded notional developed over the six months?
           present · monthly-activity · 6 rows
           Picked: spline ✓ (accepted: line, spline, area, areaspline)   1.9s

  [ Run ]  How has monthly traded notional developed, split by asset class?
           ask · post-trade · 800 rows
           — not run
```

After a run the row reports the picked type, the verdict, elapsed seconds, and **any
warnings**. Warnings matter here: a run that needed a repair round (`submit_spec` refused,
then accepted) still produced a chart, but the fact is part of the result and should not be
invisible.

### 3. Mismatch callout

When `picked ∉ accepts`, the row expands to show the `why` text and the accepted set. A
failure that explains itself is a finding; a red cross is just a mood.

### Session summary

Under the strip: `N of 14 types verified · M queries run · K mismatches`, with a **Clear**
button. Keyboard-free, no persistence, no config.

## Error handling

| Situation | What the page does |
|---|---|
| No API key / proxy down | The row shows the error verbatim and stays "not run" — a transport failure must not read as a wrong pick. |
| `AgentGaveUpError` | Shown with `.explanation`; the row stays "not run". |
| A run that produced warnings | Verdict still computed; warnings displayed. |
| Picked a type that is declared but not in any `accepts` | `✗`, with the picked type named so it is obvious what happened. |
| A preset names a type the library no longer declares | Build-time type error (`ChartType` import), not a runtime surprise. |

## Testing

The page is a manual instrument; what is worth automating is the **data**, because a wrong
label makes the instrument lie.

**Where the test goes, and a gate hole this exposed.** `scripts/verify-tests.mjs` walks
`packages/*/test/*.test.ts` only — so a test living under `examples/` would never run, and
the catalog test cannot live in `packages/chartwright/test/` because that would make the
library's test suite import from the example (the library has zero example dependencies, and
that property is load-bearing). The runner is therefore extended to walk `examples/*/test/`
as well, matching `.test.ts` and `.test.mjs`, and the new test lives at
`examples/react-highcharts/test/presets.test.ts`.

The same hole already has a victim: `examples/react-highcharts/server/proxy.test.mjs` exists,
passes, and is run by nothing — `npm run test:proxy` is not in `npm run verify`. A test that
never runs is worse than no test, because it implies coverage. **Recommended alongside this
work:** move it to `examples/react-highcharts/test/proxy.test.mjs` (one file move plus the
`test:proxy` path) so the extended runner picks it up.

The checks, all provider-free:

1. **Every declared type is covered.** For each name from `listChartTypes()`, assert some
   preset's `accepts` includes it. This is the check that stops the catalog rotting when a
   type is added — the same guard shape as the existing "every declared type has a golden
   case" test.
2. **No preset accepts an undeclared type.** `accepts ⊆ declared`, enforced at compile time by
   the `ChartType` import and asserted against the runtime list.
3. **Every dataset id a preset names exists** in the registry.
4. **`exercises ∈ accepts`** — a query filed under a type it cannot accept is a copy-paste
   error the page would render as always-failing.
5. **Mode matches the data.** A `present` preset over `post-trade` (raw, unaggregated rows)
   would chart nonsense and blame the model; assert that present-mode presets only name
   pre-aggregated datasets.
6. **Every `accepts` set is honest about the interchangeable types.** Assert that no query
   accepting one of `line`/`spline`/`area`/`areaspline` accepts only some of them — those four
   are indistinguishable from wording, so accepting one and rejecting another would be a
   false failure by construction.

The manual half already exists: `npm run smoke:live` proves the provider path end to end. The
matrix is the same path with labels on it.

## What this deliberately does not decide

- **The CI hit-rate floor.** §5.7 wants one. Setting a floor before the labels have been run
  once would be inventing a number; the catalog is what a floor needs, so it comes first.
- **Whether the matrix later moves to a route in the main page.** A second HTML entry is the
  smallest thing that is genuinely a separate page. If the example grows a router, moving it
  is a file rename.
