# Broad Highcharts coverage — feasibility and spec-extension plan

Can chartwright ever support most of Highcharts, or will a consumer adopt it and
then discover it draws three kinds of chart?

**This document answers that before any chart type is added**, because the answer
decides whether the next three types are worth adding at all.

Written in English to sit beside `docs/roadmap.md`, `docs/using-chartwright.md`
and `docs/present-mode-plan.md`, and to be committed with them.

> **v2 — rewritten after a three-way review.** v1 claimed "~60 of 71 types
> reachable" on the strength of six spec additions. That claim did not survive its
> own §4: seven capabilities the matrix's own "Needs" column demanded were missing
> from §3, two families had no phase, and the arithmetic did not close. v2 replaces
> the headline with a tiered, additive accounting, moves the enforcement question
> (who runs the gates?) into the plan, and adds the four things the review showed
> were missing entirely: theme, layout, bundle budget and options typing. What was
> accepted, and what was rebutted, is recorded in **Review history** at the end.

## Why

The library today supports `bar`, `line`, `pie` (`src/compile/model.ts:14`), and
the roadmap lists five more as "next, cheapest first" (roadmap item 6). That
framing invites a trap: add `area`, then `donut`, then `stackedBar`, and discover
at type eight that the neutral spec cannot express a scatter, a heatmap or a
sankey — because they need a *linear axis*, a *value-as-colour channel* and an
*edge shape*, none of which the spec has a place for.

So the real question is not "which type is next" but "what shape must the spec
have for types four through fifty". This document measures that, proposes the
shape, and prices it — including the parts that are not chart types at all.

## Verdict

**The majority of what real applications use is reachable, and the ceiling is
high — but the mechanism is not a list of names, and the price includes
infrastructure this project does not have yet.**

| | |
|---|---|
| Series types in the installed Highcharts 12.6.0 | **71** (extracted from every `registerSeriesType` call across 80 module files plus `highcharts-more/3d/gantt`) |
| Of those, available from `highcharts.js` alone | **8** — `area areaspline bar column line pie scatter spline` (read at runtime from `Highcharts.seriesTypes`) |
| Types chartwright can draw today | **3** |
| **Reachable with the spec extensions alone** (no licence, no missing DSL) | **48** |
| Reachable only if the consumer licenses Highcharts **Stock / Gantt** | **11** — four registered by `highstock.js` (`candlestick flags hlc ohlc`), two by `highcharts-gantt.js` (`gantt xrange`), five shipped as their own modules (`timeline heikinashi hollowcandlestick renko pointandfigure`) |
| Reachable only after transform-DSL work | **3** (`histogram bellcurve pareto`) |
| Refused, with reasons | **9** (6 map/geo, `item`, `pictorial`, `venn`) |
| 48 + 11 + 3 + 9 | **71** |
| The mechanism that carries the coverage | a **per-kind mapper strategy + one declaration row per type**, not 71 branches |

**89% of Highcharts lives in modules** (63 of 71 types; the module directory is 80
files / 1,665 KB). That fact has a consequence no amount of spec design removes:
**which charts can be drawn is a property of the consumer's bundle, not of this
library.** §5.2 turns that into a feature rather than a caveat.

## Evidence

Everything below was produced in this working copy. The probes are
`packages/chartwright/spike/spec-probes.ts` and `spike/gate-ok.ts` /
`spike/gate-missing.ts` (throwaway, not shipped, outside `tsconfig`).

Baseline: **119 tests across 9 files pass**; `npm run typecheck` is clean.
(`npm test` cannot run in a restricted sandbox — `node --test` spawns a child per
file and hits `spawn EPERM`, roadmap item 17 — so the counts come from running
each file directly.)

### The four probes

| Probe | What it asked | What came back |
|---|---|---|
| **scatter** | Can a point cloud be asked for without library words? | Three separate blockers, one of them a silent wrong answer — see §2.1 |
| **arearange** | Does the existing transform DSL produce the table? | **Yes, unchanged**: `min`/`max` already exist, so `group_by [day], measures [min→low, max→high]` is a plan the model can write today |
| **boxplot** | Same question for five numbers | **No**: `agg: 'median'` throws *"unknown aggregation 'median'. Supported: sum, avg, count, countDistinct, min, max"* (`src/types.ts:56`). The spec side is cheap; the DSL side is the cost — §2.3 |
| **heatmap** | Does "value → colour" need a channel of its own? | **No new channel at all.** The table a heatmap needs — one row per (x, series) — is exactly the table the existing collision rule already enforces, and today's compiler already accepts it (verified by compiling it as `bar`: `[{name:'EMEA',data:[250,310]},{name:'AMER',data:[180,205]}]`) |
| **sankey** | What is the smallest honest way to say "these rows are edges"? | One explicit shape: `data.shape: 'links'` with `from`/`to`/`value`. Nodes are derived by the backend from the edges, so the spec never names a node |

### What the probes did **not** prove

This is the limitation that produced v1's overstated headline, and it is stated
here so it cannot be forgotten again:

- **The probes exercised the compiler, not the submission path.** They call
  `compileToHighcharts(spec, rows)` directly with a hand-written spec. The path a
  model's spec actually takes goes through `loop.ts`'s `validateSpec`, which —
  verified — **requires `encodings.x.field` and `encodings.y.field` to be non-empty
  strings for every type** (`loop.ts:181-182`), and `model.ts:189` repeats the
  requirement. The sankey probe's "OK" therefore proves the spec is *expressible*,
  not that it is *submittable*: as written, a links spec would be rejected before it
  reached the compiler.
- **Four types were probed out of 71.** The other 67 are classified by family, from
  Highcharts' own data-shape declarations (`pointArrayMap`, verified at
  `heatmap.src.js:4291`, `sankey.src.js:3599`, `highcharts-more.src.js:2941/3807`,
  `highcharts.src.js:26290`). Family verdicts are marked **probed** or **assumed**
  in §4, and "assumed" is not evidence.

### Facts v1 got wrong

| v1 | Corrected |
|---|---|
| "six places across three files, plus three documents" | **11 sites across 8 files**: 5 source (`model.ts:14`, `loop.ts:176`, `tools.ts:338/404/418`, `types.ts:114` doc comment, `prompt.ts:23` a *per-type* prompt rule), 1 test (`loop.test.ts:109` pins the exact error sentence), 2 docs (3 lines: `roadmap.md:125`, `using-chartwright.md:17/288`) |
| "Two thirds of Highcharts lives in modules" | **89%** (63/71) |
| "~60 reachable" | **48** reachable without external blockers; 62 reachable in total; the other 9 are refused. The tiers in the Verdict sum to 71 |
| "7 geo refused" against a §4 row of 6 | 6 types are purely geo (`map mapbubble mappoint mapline tiledwebmap geoheatmap`); `flowmap` is counted once, in the links family |
| "CI is currently the only place the suite can run" | **There is no CI.** No `.github`, and the root `package.json` has no `test`/`typecheck`/`verify` script. See §5.1 |
| Bundle cost: no number anywhere | **§5.5** — measured, raw and gzipped |
| Theme, layout, options typing: absent | **§5.6, §5.7** |
| "estimates follow roadmap's convention" (the `preview` option, costed but **declined and never built**) | Now calibrated against **shipped commits** — see §6 |

## Decisions taken (and why)

| Decision | Rationale |
|---|---|
| **A gate with no runner is not a gate** | Both of v1's guarantees — "an unmapped type fails the build" and "supported means rendered" — depended on a check nobody runs. The mechanism was verified to work (`spike/gate-missing.ts` fails with `TS1360: Property 'scatter' is missing`), and verified to be bypassed: the same file **runs clean under `--experimental-strip-types`**, which is exactly how this repo runs tests. Infrastructure is therefore part of the plan, not an assumption (§5.1) |
| **Per-kind mapper strategy + one row per type** | v1 sold the declaration table as "the single source of truth" and claimed it makes type #20 cheap. Half true: it removes the *bookkeeping* (six list sites, the gate, the dispatch, the collision policy, the key strategy) and removes **none** of the per-type logic — a pivot for a matrix, edge-derived nodes for a flow, `[low, high]` packing for a range, a different meaning for `tone` where colour *is* the measure. New types inside an existing kind are cheap; a new kind (matrix, point-cloud, links) is a project of its own. §3 and §6 are written that way |
| **The declaration table must carry `required`, not just roles** | `validateSpec` and `model.ts` hard-require x and y today. A table that only names roles cannot express "a links spec has no x" or "a range chart has no y", so the gate would derive a validator that rejects the very types the plan adds |
| **A per-type *channel role* table, before any new channel** | The heatmap probe settles the design: `x` + `series` + `y` are enough for a matrix chart once each channel can be told what it *means*. New channels are added only where a type genuinely needs a second value |
| **Axis kind inferred from the role, with an explicit override** | A `measure` channel wants a linear axis and a `category` channel wants a band axis, so scatter needs no new axis field. An explicit `axes.x.kind` remains for what inference cannot know (a date column that should be `time`) |
| **Capability is declared in *neutral* type names** | Two independent reviews reached this: a consumer passing Highcharts names inverts the translation the backend exists to own, and the namespaces collide — neutral `bar` is a vertical column, Highcharts `bar` is a horizontal bar. The consumer names what it can draw in the library's own vocabulary (§5.2) |
| **The model is told only what is available** | Which resolves the tension between breadth and choice quality. The tool panel becomes per-consumer, which is also roadmap item 19's `list_chart_types` |
| **A type is not "supported" until it is rendered once** | With zero rendering assertions today (roadmap item 4), breadth without the matrix is a wish list (§5.4) |
| **Theme and layout come with the types, not after them** | Both reviews put this before breadth: colour semantics diverge per type (`tone` on a heatmap must not be a fill colour), and 20 categories with real labels is the first complaint an adopter files. Roadmap items 7 and 8 are P1 exit criteria now (§5.6) |
| **No second data source, ever** | Every channel is a `{ field }` reference into the one table passed to `ask()`. The library holds the full table in-process by design — that is what the compiler is for — and the model never does. A type needing geometry, an icon or a tile URL needs a *separate* decision |

## 1. The adoption bar, stated precisely

Not all 71 types are equally wanted. The set below is what the two reviewers and
this document agree a real product dashboard asks for; it is the bar for "another
project can adopt this". Every entry is either delivered by a named phase or called
out as blocked — v1 listed "combo with a second axis" and "sparkline" here while
§3 provided neither, which is the kind of gap the review was right to reject.

| Wanted | Delivered by |
|---|---|
| column / bar / line / spline / area / areaspline | P1 (family A) |
| stacked variants of the above | P1 (`chart.stacking` modifier) |
| pie / donut | P1 (family H, `chart.hole`) |
| heatmap | P1 (family G — needs no new channel, §2.2) |
| funnel / gauge / solidgauge | P1 (family H; needs `axes.y.range`) |
| lollipop / dumbbell / bullet | P2 (families A and C) |
| scatter / bubble | P2 (family F, §2.1) |
| range band (`arearange`) | P2 (family C) |
| boxplot | P2 in **present mode** (the caller's SQL has the percentiles); ask mode needs §3's percentile addition |
| waterfall | P2 (family C — the compiler already accumulates) |
| treemap | P3 (family J) |
| sankey | P3 (family K) |
| sparkline | P1 (`chart.compact` modifier — no axes, no legend, no title) |
| **combo with a second axis** | **P2 add-on**: needs `encodings.y2` + `axes.y2`. Not free, and v1 should not have implied it was |
| gantt / timeline | **licence-gated** (§7 R11) — not part of the bar until that is answered |

## 2. What the probes changed

### 2.1 scatter must fix identity, not just the axis

Three blockers, in the order they bite:

1. **The collision rule refuses the data.** Two rows sharing an x is normal for a
   cloud, and today it throws — with advice that is *wrong for this type*:
   *"the table has more than one row for category '9' in series 'SME'. Add an
   aggregate step (group_by 'tenure_months')"*. Aggregating is the opposite of what
   a scatter wants.
2. **The axis is a lie when it does compile.** Drop the duplicate and the same
   intent compiles to `xAxis.categories = ["3","9","14","5","11"]` with no axis
   type: points at equal spacing in row order. Plausible on screen, wrong as a
   scatter — the same class of bug as the horizontal-bar sorting bug the backend
   exists to prevent.
3. **The datum key conflates two points into one.** Keys are the x *value*
   (`datumKey`, `compile/model.ts:68`), so two points at x=9 share one key.
   Measured: `top_k: 1` — "highlight the single highest NPS" — marks **1 key = 2
   points**. Today the collision rule masks this, because such a table is never
   accepted. Exempt the rule for point types without changing the key, and the mask
   comes off.

**This is bigger than a flag on the declaration row.** The key strategy is not a
parameter today: `DatumKey = (row: Row) => string` (`compile/emphasis.ts:18`) and
`resolveEmphasis` passes only a row (`:113`), so a *positional* key cannot be
expressed without changing that signature — and the resulting key is consumed by
two independent implementations (`compile/index.ts:27-31`'s `keyOf`, and
`keyForCategory` in the backend). Consequences to settle in P2, not to discover
there:

- **Which position.** For a scatter that declares `series`, a global row index and
  a per-series index give different emphasis results. Per-series is the one that
  matches "highlight the single highest in this series" and is the proposal.
- **The assumption must be tested, not asserted.** v1 justified positional keys
  with "a point-cloud backend does not reorder points". That is an assumption about
  our own mapper, and the review asked for evidence. For sankey the cited evidence
  does not hold — `orderNodes: true` (`sankey.src.js:3597`) only computes node
  *levels* via `this.order(node, 0)` (`:3243`) and never reorders `points`; the
  module's only `.sort()` calls are on chart `events` (`:208`, `:678`). So the
  assumption is *unrefuted but unverified*, and needs a guard test per point-cloud
  and links type: compile → assert the emitted data is in table order → assert
  emphasis marks the intended datum.

### 2.2 heatmap needs nothing new — and that is the design

`x` = the column category, `series` = the row category, `y` = the measure drawn as
colour. All three channels exist; the collision rule fits a matrix exactly; the
emphasis key already includes the series. The compiler must add a pivot
(`[xIndex, yIndex, value]`, verified `pointArrayMap: ['y','value']` at
`modules/heatmap.src.js:4291`) and a `colorAxis`.

The generalisation is the point: **a type declares what each channel means for
it**, and a family of charts falls out of three channels that already exist.

One convention lives in the backend, and it is the proof that theme must come with
breadth: what `tone: 'highlight'` looks like when the measure *is* the colour. A
fill would overwrite the datum, so a heatmap highlights with a border or an opacity
change. Nothing in the spec changes — but the consumer's palette has to reach it
(§5.6).

### 2.3 boxplot's cost is in the transform DSL, not the spec

Five channels is cheap. The blocker is that `AggregationFn` is
`sum | avg | count | countDistinct | min | max` — no percentile — so a boxplot
cannot be produced in ask mode from raw rows at all. Two honest options:

- **present mode** (available today, zero new code): the caller's own SQL has
  `percentile_cont` and passes five numbers per group — the same trade the
  present-mode work already made for averages and ratios.
- **add `median` / `percentile`** to `AggregationFn` — a transform-DSL change with
  its own decision (§3, layer B), not a chart-type change.

### 2.4 sankey is the one genuinely new shape — and it is small

`data.shape: 'links'` with `from`/`to`/`value` (verified `pointArrayMap:
['from','to','weight']` at `modules/sankey.src.js:3599`). Reusing `x`/`y`/`series`
with inverted meanings was the alternative: fewer fields, worse spec, because `x`
meaning "target" is a lie the model will get wrong and a reader cannot audit. Nodes
are derived by the backend. The collision rule generalises: one row per
`(from, to)`.

**But the submit path must change with it** (§Evidence): `validateSpec` requires x
and y for every type today, so `required` belongs in the declaration table.

## 3. Proposed spec surface (v2)

Nothing here is library vocabulary. The test each addition must pass: **could a
reader who has never heard of Highcharts audit this spec?** If not, it belongs in
the backend.

### 3.1 The declaration — what a type *is*

```ts
/** Which channel names exist at all. A channel is always a `{ field }` reference. */
type ChannelName =
  | 'x' | 'y' | 'series'
  | 'low' | 'high' | 'open' | 'close'   // ranges and OHLC
  | 'size' | 'width' | 'target' | 'direction';

type ChannelRole =
  | 'category'   // a band on an axis
  | 'measure'    // the value drawn (height, position, colour)
  | 'series'     // splits the data through the chart
  | 'part'       // one end of a range/OHLC point
  | 'magnitude'  // radius, weight, arrow length
  | 'direction'; // an angle

type Modifier = 'stacking' | 'polar' | 'hole' | 'compact' | '3d' | 'colorAxis';

type ChartTypeSpec = {
  /** Which mapper strategy builds it. A new kind is a project; a new type inside one is not. */
  kind: 'categorical' | 'part-to-whole' | 'matrix' | 'point-cloud' | 'links';
  /** Roles, and which of them the spec MUST carry. `required` is what the validator derives from. */
  channels: Partial<Record<ChannelName, ChannelRole>>;
  required: readonly ChannelName[];
  /** Channels that must NOT be present — "a links spec has no x" said out loud. */
  forbidden?: readonly ChannelName[];
  /** For links/hierarchy: the shape is declared, not inferred from the channels. */
  dataShape?: 'rows' | 'links' | 'hierarchy';
  modifiers: readonly Modifier[];
  /** How emphasis addresses one mark. 'row' needs the signature change in §2.1. */
  key: 'category' | 'category+series' | 'row';
  /** The collision rule, per type. */
  allowsDuplicateCategories: boolean;
  /** Which Highcharts module must be loaded. Names are NOT derivable from the type name:
   *  `solidgauge` → solid-gauge.js, `dependencywheel` → dependency-wheel.js,
   *  `flags` → highstock.js, `xrange` → highcharts-gantt.js. A hand-checked table. */
  module?: string;
  /** Highcharts series types this row covers, and the first version that has them. */
  libraryTypes?: Record<string, string>;
  /** Which product's licence it needs, if not core. */
  licence?: 'core' | 'stock' | 'gantt' | 'maps';
  since?: string;
};

export const CHART_TYPES = {
  bar: { kind: 'categorical', channels: { x: 'category', y: 'measure', series: 'series' },
         required: ['x', 'y'], modifiers: ['stacking'],
         key: 'category+series', allowsDuplicateCategories: false },
  line:   { /* elided: identical to bar but for its mapper */ },
  pie:    { kind: 'part-to-whole', channels: { x: 'category', y: 'measure' }, required: ['x', 'y'],
            modifiers: ['hole'], key: 'category', allowsDuplicateCategories: false },
  heatmap: { kind: 'matrix', channels: { x: 'category', series: 'category', y: 'measure' },
             required: ['x', 'series', 'y'], modifiers: ['colorAxis'],
             key: 'category+series', allowsDuplicateCategories: false,
             module: 'heatmap', libraryTypes: { heatmap: '6.0' } },
  scatter: { kind: 'point-cloud', channels: { x: 'measure', y: 'measure', series: 'series' },
             required: ['x', 'y'], modifiers: ['compact'],
             key: 'row', allowsDuplicateCategories: true },
  arearange: { kind: 'categorical', channels: { x: 'category', low: 'part', high: 'part', series: 'series' },
               required: ['x', 'low', 'high'], modifiers: ['stacking'],
               key: 'category+series', allowsDuplicateCategories: false,
               module: 'highcharts-more', libraryTypes: { arearange: '2.3' } },
  sankey: { kind: 'links', dataShape: 'links',
            channels: {},   // an edge is not a channel: from/to/value arrive via `data`, §3.2
            required: [], forbidden: ['series', 'x', 'y'], modifiers: [],
            key: 'row', allowsDuplicateCategories: false,
            module: 'sankey', libraryTypes: { sankey: '6.0' } },
} as const satisfies Record<string, ChartTypeSpec>;
```

Two properties the reviewers asked for and this shape provides: **the table can
express its own impossibilities** (`required`, `forbidden`, `dataShape`), and
**`key` is a fact the mapper must honour**, with the guard test of §2.1 as its only
enforcement — `satisfies` proves a mapper *exists*, not that it implements the
declared strategy.

### 3.2 Spec additions — complete, phased, and costed

Layer A — `ChartSpec` fields. Nothing else is proposed; anything a family needs
that is not here is a reason that family is not yet reachable.

| Addition | Shape | Needed by | Phase |
|---|---|---|---|
| `axes.x.kind`, `axes.y.kind` | `'band' \| 'linear' \| 'time' \| 'log'`, **inferred by default** | `time`/`log` opt-ins; scatter needs only inference | P2 (`time` needs the item 21 decision) |
| `axes.y.range` | `{ min?: number; max?: number }` | gauge/solidgauge scales; also a fixed 0–100 axis for percentages | P1 |
| `chart.stacking` | `'none' \| 'normal' \| 'percent' \| 'stream'` | stacked bar/area/column, `streamgraph` | P1 |
| `chart.polar`, `chart.hole`, `chart.compact` | `boolean`, `number`, `boolean` | radar and rose (**not new types at all**), donut, sparkline | P1 |
| `encodings.low` / `.high` | `Encoding` | range family (8) | P2 |
| `encodings.open` / `.close` | `Encoding` | OHLC family (8) — with `high`/`low` above | P4 (licence-gated) |
| `encodings.size` | `Encoding` | bubble, packedbubble, wordcloud | P2 |
| `encodings.direction` | `Encoding` | `vector`, `windbarb` | P3 (with family O) |
| `encodings.width`, `encodings.target` | `Encoding` | `variwide`, `bullet` | P2 |
| `encodings.y2` + `axes.y2` | `Encoding` | **combo charts** — the adoption bar's last gap | P2 add-on |
| `data.shape: 'links'` + `from`/`to`/`value` | explicit shape, with its own three fields — an edge sits on no axis, so it is not a channel | sankey family (6) | P3 |
| `data.shape: 'hierarchy'` | a list of group-by levels | treemap family (3) | P3 |

Layer B — transform DSL, a **different layer with its own decisions** (v1 buried
these in prose and then counted them as spec additions):

| Addition | Why | Phase |
|---|---|---|
| `median` / `percentile` in `AggregationFn` | ask-mode `boxplot`/`errorbar`/`candlestick`-style points | P2 (boxplot) |
| a numeric `bin` operator, and a running-total step | `histogram` and `bellcurve` need binning; `pareto` needs binning **and** a cumulative share | P3 |
| nothing for `renko`/`pointandfigure` | algorithmic transforms: present mode only, and they stay in the licence-gated tier anyway | never (as spec) |

### 3.3 Not proposed, and why

Layer C — the honest half of v1's missing seven needs: each of these was demanded by
§4's "Needs" column and is **not** in layer A, so the family it belongs to is either
refused or deferred by name.

| Family need | Verdict |
|---|---|
| `venn` set semantics (2–3 sets + intersections) | **refused** — not a row shape; there is no honest `{ field }` for "the intersection of A and B" |
| node attributes for `organization`/`networkgraph` (`size`/`color` per node) | **deferred** — links v1 supports `from`/`to`/`value` only; nodes are derived, and derived nodes take their styling from the backend |
| geo geometry / tile URLs (`map`, `geoheatmap`, `tiledwebmap`) | **refused** — a second data source (§4) |
| icon resources (`item`, `pictorial`) | **refused** — same reason |

## 4. Coverage matrix — the full accounting of 71

Confidence is stated per family: **probed** (a probe ran), **declared** (Highcharts'
own data-shape fields read), **assumed** (this document's judgement, marked so it
can be falsified).

| Family | Types | Needs | Confidence | Blocker | Phase |
|---|---|---|---|---|---|
| **A** band + one measure | `column bar line spline area areaspline polygon lollipop dotplot cylinder columnpyramid` (11) | declaration + mapper; `area` verified through the gate alone | probed (area) / declared | none | P1 |
| **B** stack/offset | `streamgraph` (1) | `chart.stacking` | declared | none | P1 |
| **C** two/five-value points | `columnrange arearange areasplinerange errorbar dumbbell bullet boxplot waterfall variwide` (9) | `low`/`high` (+`width`, `target`); percentile for ask-mode boxplot | probed (arearange) / declared | none | P2 |
| **D** time + interval axis | `xrange gantt timeline` (3) | `axes.x.kind: 'time'` — **reopens roadmap item 21** | declared | **licence: Gantt** | P4 |
| **E** computed from raw | `histogram bellcurve pareto` (3) | numeric `bin` operator, or present mode | declared | DSL | P3 |
| **F** two numeric axes | `scatter bubble packedbubble scatter3d` (4) | role-driven linear axis + `size`; scatter also needs §2.1 | probed (scatter) | none | P2 |
| **G** matrix + colour | `heatmap tilemap contour` (3) | **nothing new** (§2.2) + `colorAxis` | probed (heatmap) | none | P1 |
| **H** part-to-whole extended | `pie variablepie funnel pyramid funnel3d pyramid3d gauge solidgauge` (8) | `hole`, `axes.y.range`; `variablepie` needs a radius channel | declared | `variablepie`'s `z` channel is **not** in layer A → P2, not P1 | P1/P2 |
| **I** OHLC / financial | `candlestick ohlc hlc heikinashi hollowcandlestick renko pointandfigure flags` (8) | `open`/`close` channels + time axis | declared | **licence: Stock** (all of them) + DSL for `renko`/`pointandfigure` | P4 |
| **J** hierarchy | `treemap sunburst treegraph` (3) | `data.shape: 'hierarchy'` **and derived parent rows** — the engine emits leaves only | declared + probed (leaves-only) | per-type backend work (parent synthesis, value semantics) | P3 |
| **K** links / flow | `sankey dependencywheel networkgraph arcdiagram organization flowmap` (6) | `data.shape: 'links'` | probed (sankey, compiler path only) | `validateSpec` change (§2.4) | P3 |
| **L** geo / maps | `map mapbubble mappoint mapline tiledwebmap geoheatmap` (6) | a **second data source** | declared | **refused** | — |
| **O** special channels | `wordcloud vector windbarb` (3) + `item pictorial` (2) | `size`/`direction` for three; icon resource for two | assumed | `item`/`pictorial` **refused** | P3 / — |
| **N** radar / rose | *no types* | `chart.polar: true` on line/area/column | declared | none | P1 |
| **V** `venn` | `venn` (1) | set semantics | assumed | **refused** (§3.3) | — |

Arithmetic, one term per family row: 11+1+9+3+3+4+3+8+8+3+6+6+5+0+1 = **71**
(family O's 5 is 3 reachable + 2 refused; family N contributes no types of its own).
Tiers: **48 reachable** (A11 B1 C9 F4 G3 H8 J3 K6 O3) + **11 licence-gated** (D3 I8)
+ **3 DSL-gated** (E) + **9 refused** (L6 `item` `pictorial` `venn`) = 71.

### Why geo is refused rather than deferred

Not for privacy — the library holds the full table in-process by design, because
the deterministic compiler must run the transform plan over every row. The reason is
the **input contract**: `ask()` takes one table of rows, and every channel this plan
adds is a `{ field }` reference into it. A map needs a *second* input (geometry or a
tile URL), so supporting it means introducing resource references — the library
would have to know where map data comes from and who loads it. The same test refuses
`item`/`pictorial` (icon URLs) and `tiledwebmap` (a network dependency in a library
whose selling point is no server).

## 5. Infrastructure — what v1 assumed and v2 has to build

### 5.1 A gate with no runner is not a gate

Both v1 guarantees depended on a check nobody runs.

- The mapper gate **works**: `spike/gate-missing.ts` fails with
  `TS1360: Property 'scatter' is missing in type '{ bar: Mapper; pie: Mapper; }'`,
  under this repo's own compiler settings including `erasableSyntaxOnly`.
- The mapper gate **is bypassed**: the same file runs with **exit 0** under
  `node --experimental-strip-types`, which is how `npm test` runs.
- There is **no CI**: no `.github` directory; the root `package.json` has only
  `dev`, `build`, `gen:data`.

So the plan must contain: a root `verify` script (`typecheck` + per-file tests, the
one thing this sandbox cannot do was already solved by running files directly), a CI
job that runs it, and a headless-browser matrix job. This is also where the library
gets its **first dev dependency** — roadmap item 17 says that needs a concrete
reason, and this is it: a rendering assertion cannot be written with
`node:test` alone. Costed in §6, not hidden in P0's prose.

### 5.2 Capability: neutral names, per-ask, versioned

63 of 71 types live in modules. Emitting options for a module the consumer never
loaded fails **in the consumer's process** (Highcharts error 17) and is invisible to
every test we can write. Measured: `require('highcharts/modules/heatmap')` outside a
browser/bundler dies with *Cannot read properties of undefined (reading 'Axis')*.

```ts
createChartwright({
  llm,
  // Neutral names — the library's own vocabulary, never Highcharts'.
  // May be lazy, because a real app code-splits: the answer can differ per route,
  // and `import()` of a chart module can happen after this call.
  capabilities: () => (routeNeedsHeatmap() ? ['bar', 'line', 'pie', 'heatmap'] : ['bar', 'line', 'pie']),
  highcharts: '>=12 <13',   // declared support range; a mismatch warns, never guesses
})
```

Four requirements the reviews produced, all of which v1's static
`seriesTypes: ['column', 'bar', ...]` failed:

1. **Neutral vocabulary.** Highcharts names collide with ours (`bar`) and would make
   the consumer the owner of a translation only the backend can do.
2. **Per-ask and lazy.** The registry is a global mutable singleton and modules are
   `import()`-ed per route, so a value captured at `createChartwright()` time is
   wrong for half the app. Both failure directions must be avoided: "declared but
   not loaded" (error 17, in the consumer's process) and "loaded but not declared"
   (the model never picks the type).
3. **A version dimension.** The 71/8/`module` facts are Highcharts 12.6.0 facts;
   `tiledwebmap`, `flowmap`, `arcdiagram` are recent additions and a consumer pinned
   to v11 has a different registry. "Available" ≠ "renderable": compare against a
   declared support range and put unknown or misspelled names into `warnings` rather
   than silently shrinking the panel — a capability mismatch whose only symptom is
   "the model never picks heatmaps" is the worst possible bug report.
4. **A server-side story.** `require('highcharts')` yields the 8 core types in Node,
   but the modules throw on import there, so a server-rendered app cannot derive its
   capability list — it must be reported by the browser or written down and checked.
   §5.7's diagnostics should say which of the two happened.

No `capabilities` = today's `bar | line | pie`, byte-for-byte.

### 5.3 The single source, and the silent-drop trap

Deriving the gate, the schema enum, the prompt list, the backend dispatch, the
collision policy and the key strategy from `CHART_TYPES` removes **10 of the 11
sites** in §Evidence. The eleventh is `loop.ts`'s error sentence, which becomes
generated text — and note `test/loop.test.ts:109` pins that sentence verbatim, so it
goes red by design when the message becomes dynamic.

The silent-drop trap needs its own guard, independent of this work: whatever the
schema declares must survive into the spec. **Verified**: submitting
`{ chart: { type: 'bar', stacking: 'percent' }, axes: { x: { kind: 'linear' } } }`
is `accepted: true`, and the returned spec contains neither field — the model is
told nothing. A test that walks every property in `SUBMIT_PROPERTIES` and asserts it
survives `validateSpec` converts a class of invisible failures into a red test, and
`required`/`forbidden` from §3.1 have to be threaded through that same assembler.

### 5.4 "Supported" must mean "rendered once"

The suite compares values, never pixels (roadmap item 4). At three types that is a
gap; at 48 it is the difference between a support matrix and a wish list:

- every type gets a **golden options snapshot** under a **fixed theme** (catches
  mapping mistakes like `donut`, which silently produces `chart.type = 'donut'`, a
  type Highcharts does not have);
- every family gets **one render** in a headless-browser matrix — not every type, to
  keep the matrix maintainable; the check is "Highcharts did not throw", plus a
  screenshot, plus a **labels-do-not-overlap** assertion (§5.6);
- **a type is not listed as supported until both exist.**

### 5.5 Bundle budget — the cost this library does not add but does expose

Measured from `node_modules/highcharts` 12.6.0, gzipped:

| Consumer wants | Modules | gzip |
|---|---|---|
| Core only (today's 8 types) | `highcharts.js` | **98 KB** (269 KB raw) |
| + matrix family | heatmap, tilemap, coloraxis | 116 KB |
| + range/bubble/gauge/waterfall family | `highcharts-more` | 132 KB |
| + links family | sankey, networkgraph, dependency-wheel, arc-diagram | 125 KB |
| + hierarchy family | treemap, sunburst, treegraph | 134 KB |
| + Stock (needed for OHLC, `flags`, and Gantt's `xrange`) | `highstock.js` | **247 KB** |
| The adoption set of §1 (core + more + heatmap + treemap + sankey + small modules) | — | **≈230 KB** (≈480 KB raw) |

The modules are **side-effect UMD with no `exports`/`module` field** in
`highcharts/package.json` (`main: highcharts.js`), so a bundler cannot tree-shake
them: the module directory is 80 files / 1,665 KB, all of it potential. Two
consequences for the plan:

- chartwright itself stays zero-dependency — the cost is the consumer's, and it is
  the cost of the charts it asked for. What the library must not do is hide it:
  **the capability handshake is the budget control**, and a first-paint budget
  belongs in the adoption conversation before breadth does.
- Because the modules are not tree-shakeable, per-route `import()` is the only real
  lever, which is the second reason capabilities must be lazy (§5.2).

### 5.6 Theme and layout come with the types

- **Theme.** `backends/highcharts.ts:31-34` holds the library's only two colours
  (`highlight` `#e8590c`, `muted` `#c9ced6`), and every other colour is a Highcharts
  default — a palette layer is roadmap item 7, and it cannot wait: `tone` means
  different things per type (§2.2), and a heatmap's `colorAxis` gradient *is* the
  data encoding, so a default blue-red ramp is a brand decision made by accident.
  `createChartwright({ theme })` is P1: a named palette resolved in the backend, plus
  a per-type declaration of which colour roles it consumes. Golden snapshots include
  the theme.
- **Layout.** Roadmap item 8 (canvas size, margins, label rotation, long labels) does
  not appear in v1's phases at all, and `chart.orientation` is no help for a heatmap's
  two label axes. P1 exit: the backend derives `rotation` and label `step` from
  category count × label length, and the render matrix asserts labels do not overlap.
  The consumer's escape hatch stays `chart.height`-style options in the app, which is
  what `ChartView.tsx:23` already does with a hardcoded 460.

### 5.7 Debuggability and options typing

At 3 types a wrong chart is traceable; at 48, triage cost is a product feature.

- `ChartOptions = Record<string, unknown>` (`highcharts.ts:23`) means the *read* side
  is untyped: passing `result.options` into `Highcharts.chart()` needs no cast
  (verified: `const o: Highcharts.Options = result.options` compiles), but
  `result.options.xAxis` is statically `unknown`, so theming, resizing and asserting
  all happen in an untyped zone. P1 exit: narrow the exported type from
  `CHART_TYPES` (a discriminated union keyed by `chart.type`, or at minimum
  `OptionsFor<'heatmap'>`).
- **Structured warnings** (`{ code, field }`) instead of `string[]` — roadmap item 14
  is no longer a nicety when 48 types can each fail differently, and §5.2's
  capability mismatch has to surface as a warning rather than as silence.
- **`AskResult.diagnostics`**: `resolvedType` (what the backend actually emitted, the
  thing that would have caught `donut`), which mapper ran, whether the type needs a
  module, and `declared ∩ available`. Plus **`explainSpec(spec)`** — one human
  sentence — because the example today can only `JSON.stringify` the spec
  (`App.tsx:373-389`).
- **Choice quality is measurable, not hoped for.** The reviews rejected v1's "one
  selection line per type + watch the example app". Instead: a labelled set
  (request → acceptable type(s)) run in CI, asserting the hit rate of
  `result.spec.chart.type` against a floor, and expanded whenever a real run
  misfires. That is also the evidence roadmap item 9 was waiting for.

## 6. Phases and effort

Calibrated on **shipped commits** rather than on a declined proposal. The repo's own
sizes, from `git log --stat`:

| Precedent | Size |
|---|---|
| `d81079e` refactor(compile): delete the datetime branch | 16 files, +154/−127 — the shape of a wide, shallow refactor |
| `f701a21` feat(agent): accept a submission only when a chart comes out of it | 9 files, +539/−31 — the shape of one compiler/loop behaviour change |
| `363f939`, `829f10e`, `36c981c` (tools + descriptions) | 7–9 files, +136…+243 each |
| **present mode, end to end** (9 commits, including tests and docs) | **≈1,980 insertions** |

So a "unit" here is roughly **500 changed lines including tests and docs**, and a
full feature the size of present mode is ~4 units.

| Phase | Content | Files / lines | Units | Unknowns |
|---|---|---|---|---|
| **P0a — single source, zero behaviour change** | `CHART_TYPES` in its own module; derive the 11 sites; `required`/`forbidden` in the validator; schema↔`validateSpec` reachability test. **Acceptance: the existing three types compile byte-identically.** | 10–14 files, ~250–400 lines (precedent `d81079e`) | ~0.7 | whether the prompt's per-type rule can move into the table without losing the model's phrasing |
| **P0b — capability + gates** | `capabilities` (neutral, lazy, versioned) through `ask`/`tools`/`loop`; root `verify`; CI; golden harness | 10–14 files, ~600–800 lines (precedent `f701a21`) | ~1.5 | **CI and a headless runner have no precedent here** — first dev dependency, first workflow file |
| **P1 — cheap families + theme + layout** | families A, B, G, N, and H-minus-`variablepie`; `stacking`/`polar`/`hole`/`compact`; `axes.y.range`; theme layer; layout derivation; labelled selection set; structured warnings; `explainSpec` | ~2,000 lines (present-mode scale) | ~4 | layout heuristics are judgement-heavy; the selection set's floor needs real runs to set |
| **P2 — axes, points, ranges** | `axes.*.kind` + linear axis; `low`/`high`/`width`/`target`; `size`; scatter/bubble with §2.1's collision + key signature change; percentile for ask-mode boxplot; `y2` combo add-on; **item 21 decision executed** | ~1,800 lines | ~3.5 | the key signature change touches two consumers; the item 21 decision reaches present mode's ordering promise |
| **P3 — new shapes + DSL** | links (6) with the `validateSpec` change; hierarchy (3) with parent-row synthesis; numeric `bin`; `direction` for `vector`/`windbarb` | ~1,700 lines | ~3.5 | parent-row value semantics for treemap (the engine emits leaves only) |
| **P4 — licence-gated** | `time` axis for `xrange`/`gantt`/`timeline`; `open`/`close` for the OHLC family | ~1,200 lines | ~2.5 | **blocked on the licence answer (§7 R11)** |
| **Verification** | headless matrix, screenshot baselines, flake policy | ~400 lines + infra | ~1 | ongoing maintenance is the real cost, not the first version |
| | **Total** | **~10,000 lines** | **~17** | **≈8–10 weeks of focused work** |

**Twelve of §1's fifteen rows are reached at the end of P1–P2** — about 5 weeks,
which is longer than v1's 3 weeks because v1 excluded CI, the render matrix, theme,
layout and the selection set from its own accounting. The two remaining rows
(treemap, sankey) land with P3 at ~7 weeks, which is also where the 48 reachable
types stand; the licence-gated families add ~2.5 units on top of that, at ~10 weeks.
Those extras are not optional: the reviews were right that breadth without them is
not adoptable.

### The decision gate that fires before P1

Roadmap item 22 says to reopen the flint question at **"more than ~8 chart types"**.
P1 crosses that line. v1 framed this as binary (self-build vs vendor the 78k-line
pipeline) and dismissed flint on the grounds that upstream has no Highcharts backend.
That argument shows flint does not *give* us the types; it does not show its pipeline
is worthless. The roadmap itself records the third option:

1. **Self-built grammar** — ~2–3k lines, keeps the zero-dependency promise, keeps the
   spec ours. **Recommended**, because the coverage question is about *our* neutral
   vocabulary, and every alternative makes someone else's spec the source of truth.
2. **flint as a plain dependency, our spec → `ChartAssemblyInput`** — buys
   `getCategoryOrder`, `compute-layout`, `band-dodge`, `color-decisions`, i.e. exactly
   roadmap items 7 and 8 and the "library conventions" knowledge that produced the
   horizontal-bar sorting bug. Costs a second spec dialect (the same drift risk as
   R1) and a translation layer.
3. **Vendor the pipeline** — 78k lines, publishing difficulty, no Highcharts backend
   upstream. Not recommended.

**Before P1**: a timeboxed spike that maps our three current types through option 2
and compares the emitted options with what the backend produces today. The answer is
either "the conventions are worth a dependency" or "we now know which of those
functions to reimplement", and both are cheaper than guessing.

## 7. Risks

| ID | Risk | Why it is real | Mitigation |
|---|---|---|---|
| R1 | `CHART_TYPES` becomes a second, driftable source of truth | Only an improvement if nothing reads the old sites | Delete all 10 derived sites in the same commit; a test asserts the schema enum equals the derived set; `test/loop.test.ts:109` is updated, not deleted |
| R2 | A schema property is silently dropped by `validateSpec` | Whitelist assembler, by design; **verified**: `stacking` and `axes` vanish with `accepted: true` | The reachability test §5.3; `required`/`forbidden` threaded through the same assembler |
| R3 | Collision-rule exemption weakens bar/line protection | It is a recorded invariant ("duplicate categories are refused"), implemented in **three** places: `model.ts:121` (exported detector), `model.ts:242` (compiler message), `submit.ts:80` + its present-mode advice text (`submit.ts:35-53`) | Exemption is per-type declared; the *advice text* must branch by type too — "put it in `encodings.series`" is nonsense for a point cloud; regression test that bar still refuses |
| R4 | The key-strategy change alters the existing three types | The value key is why emphasis survives axis reversal (`model.ts:60-70`), and it is a *signature* change (`emphasis.ts:18`, `:113`) consumed in two places (`compile/index.ts:27-31`, backend `keyForCategory`) | Per-type strategy; global-vs-per-series index decided explicitly (§2.1); golden + emphasis tests pin bar/line/pie unchanged; guard test that the emitted order equals the table order |
| R5 | Time axis contradicts present mode's "the order you pass is the order shown" | Roadmap item 21 states the tension | P2 begins with that decision as its own item; nothing in P1 depends on it |
| R6 | Module-dependent types fail in the consumer's process | Measured; our tests cannot observe it | Capability handshake (§5.2), and a type whose module the handshake cannot cover is refused |
| R7 | "Supported" outruns "verified" | Zero rendering assertions today | §5.4 makes the matrix a gate; per-family rather than per-type to stay maintainable |
| R8 | Model choice quality falls as the type list grows | No few-shot examples, deliberately (item 9); 48 types with no selection corpus is worse than 3 | Capability-scoped panel; the labelled selection set in CI (§5.7) with a hit-rate floor |
| R9 | Sprawl in `model.ts` (248 lines) and `tools.ts` (486 lines) | They are already the largest files in the library | `CHART_TYPES` in its own module; per-type knowledge stays in `backends/`; per-kind mapper strategy rather than per-type branches |
| R10 | Version skew between our mapping and the consumer's Highcharts | The 71/8/`module` facts are 12.6.0 facts; a v11 or v13 consumer has a different registry, and `available` ≠ `renderable` | Declared support range + `since` per row; unknown names warn; a second-version (v11) pin test for capability and option shape |
| R11 | **Stock / Gantt are separate licensed products** | 11 of the 71 types are not in `highcharts.js`: four are registered by `highstock.js` (`candlestick flags hlc ohlc`), two by `highcharts-gantt.js` (`gantt xrange`), and five ship as their own modules (`timeline heikinashi hollowcandlestick renko pointandfigure`). `highstock.js` and `highcharts-gantt.js` are separate builds, and historically separate products with their own terms ([EULA note](https://www.highcharts.com/blog/news/our-new-eula-makes-free-usage-clearer/)) — a consumer cannot render what it has not licensed | **Precondition, not a risk to manage later**: state the licence in one sentence per type or leave those families out of the supported list. Answer before P4, and before promising financial or Gantt charts to anyone |
| R12 | The plan now includes infrastructure with no precedent here | CI, a headless runner, screenshot baselines and their flake policy are new for this repo, and the first dev dependency contradicts its zero-dependency habit (roadmap item 17 asks for a concrete reason; this is one) | Costed as its own line in §6 rather than folded into P0; start with the per-family matrix, grow only when a type needs it |

## 8. Explicitly out of scope

- **Geo family** (§4) — a second data source.
- **`item`, `pictorial`** — icon resources. **`venn`** — set semantics (§3.3).
- **`tiledwebmap`** — network dependency.
- **Library features that are not chart types**: boost, navigator/rangeselector,
  annotations, drilldown, exporting, marker clusters, sonification. `drilldown`
  deserves naming: it introduces a second dataset by construction, so it is a product
  decision rather than a type.
- **3D beyond the modifier** — `options3d` on existing types is cheap; the 3D module
  adds its own render surface and belongs in the matrix first.

## 9. Open decisions

1. **flint** — self-built grammar (recommended) vs a dependency on flint's
   conventions vs vendoring; decided by the spike in §6, before P1.
2. **Stock / Gantt licences** (R11) — the precondition for 11 types and for any
   promise involving financial or Gantt charts.
3. **Roadmap item 21 (date axis)** — decided at the start of P2, not incidentally.
4. **`schema_version`** — v1 asked "1 or 2?". Better answer: it is written once
   (`loop.ts:193`) and **read nowhere**, so it is the same shape of field as the
   `value_type` this project already deleted for being unreachable. Either make it
   load-bearing (refuse an unknown version at the door) or leave it alone; adding
   `2` as decoration repeats a recorded mistake.
5. **`AggregationFn` percentile** — needed for ask-mode boxplot; P2, or earlier if a
   consumer asks.
6. **Keep or delete the `spike/` files** — `spec-probes.ts`, `gate-ok.ts`,
   `gate-missing.ts` are evidence for this document; as permanent fixtures they need
   `tsconfig` entries and a purpose (the mapper gate is arguably worth keeping as a
   compile-time fixture).

## Acceptance criteria

Plan-wide:

- [ ] `verify` exists at the repo root and CI runs it: typecheck **and** tests. A
      gate nobody runs is not a gate (§5.1).
- [ ] `CHART_TYPES` is the only place a chart type is declared; the schema enum, the
      loop's error text, the prompt's list and the backend dispatch are derived from it.
- [ ] Adding a type without a backend mapper **fails `verify`** — not the render, and
      not only in an editor.
- [ ] Every property in the submit schema survives into the compiled spec (test) —
      the R2 trap.
- [ ] `required` / `forbidden` come from the table, so a links spec is not rejected
      for lacking an x.
- [ ] The existing three types compile to **byte-identical options** (golden test),
      and no capabilities declared = today's tool panel.
- [ ] Capability is accepted in neutral names, may be lazy, and reports a version
      mismatch as a warning.
- [ ] Every type listed as supported has a golden snapshot; every family has a render.
- [ ] A theme is injectable, and golden snapshots are taken under a fixed one.
- [ ] Exported options type narrows by `chart.type`.
- [ ] The selection set runs in CI with a hit-rate floor.
- [ ] `docs/using-chartwright.md` §8 and `docs/roadmap.md` item 6 are checked against
      `CHART_TYPES` in the same test that checks the schema enum.

Per type, the definition of done:

1. one row in `CHART_TYPES` (kind, channels, `required`, modifiers, key, duplicate
   policy, module, licence, `since`);
2. a mapper under the right **kind strategy**, with the type-name → Highcharts-type
   and data-shape decision explicit;
3. a guard test where the key strategy is positional (emitted order = table order);
4. one golden options test, one refusal test, one emphasis test;
5. a render row for its family;
6. documentation: the supported list, a boundary note if it has one, and a line in
   the roadmap change log.

## Review history

v1 was reviewed by two independent reviewers (an architecture pass and a
frontend-adoption pass), each reading the code and re-running its own experiments,
plus the author's own verification pass. Everything material below is recorded so the
same arguments are not re-run.

**Accepted — changed the document:**

1. The headline did not follow from the text: §4's own "Needs" column demanded seven
   capabilities §3 never declared, families D and I had no phase, and P3's ceiling
   (58) was below the claimed total (~60). → tiered accounting, §4, and the Verdict
   now sums to 71.
2. `validateSpec` requires x and y for **every** type, so the sankey probe's "OK"
   was overstated: it exercised the compiler, not the submit path. → stated under
   "What the probes did not prove", and `required`/`forbidden` added to the table.
3. The declaration table was oversold as a single source of truth and as making
   "type #20 cheap". It removes bookkeeping, not per-type logic. → per-kind mapper
   strategy in §3.1/§6, and the cheap/expensive split stated.
4. The capability handshake put Highcharts vocabulary in a public API, in a
   namespace that collides with ours, with no version dimension and no support for
   lazy loading. → §5.2 rewritten around four requirements.
5. Both gates had no runner: no CI, and the test path bypasses typecheck. → §5.1, and
   infrastructure is now a costed line.
6. Duration estimates were calibrated on a proposal that was **declined and never
   built**. → calibrated on shipped commits (§6), and the total revised upward.
7. Theme, layout, bundle cost, options typing and debuggability were missing
   entirely. → §5.5–§5.7, and theme/layout are P1 exit criteria.
8. Item-by-item corrections: the site count (11, not 6), "two thirds" (89%),
   geo arithmetic, `prompt.ts:23` and `loop.test.ts:109` as count sites,
   `schema_version` as an unread field, and the flint decision's missing third
   option.

**Rebuttals — checked, and the review was wrong or too strong:**

1. **`orderNodes` does not falsify `key: 'row'` for sankey.** The review cited
   `orderNodes: true` as evidence that Highcharts reorders sankey data. It does not:
   the branch only walks `this.nodes` and assigns levels via `this.order(node, 0)`
   (`sankey.src.js:3243`), and the module's only `.sort()` calls are on chart
   `events` (`:208`, `:678`) — nothing reorders `points`/links. The *requirement*
   stands (the no-reordering assumption is unverified and needs a guard test), the
   inference does not.
2. **The "seven places" count conflated list sites with compiler call sites.**
   `submit.ts:89` is a call to `compileToHighcharts`, not a place the type list is
   written; adding a type does not touch it. The accurate inventory is the 11 sites
   in §Evidence.
3. **"A never-implemented estimate cannot calibrate" is right; "600–800 lines in one
   week contradicts a 200–260-line precedent" is not** — line counts are not equal
   across mechanical and new-logic work. The requirement for falsifiable granularity
   was accepted (§6 gives files, lines, units and unknowns); the inference about a
   specific week was not.

Two review findings deserve their own line because they changed the *sequencing*
rather than the text: **theme must precede breadth** (colour semantics diverge per
type and a `colorAxis` gradient is a brand decision), and **choice quality must be
measured** rather than observed in the example app.

## Self-review

- **Arithmetic:** the coverage table, the tier sum and the Verdict all reconcile to
  71; the phase table's unlocks match §4's phase column.
- **Provenance:** every claim is marked probed, declared, assumed, or measured — and
  the "assumed" families are named in §4 rather than presented as evidence.
- **Scope:** each phase is independently shippable; P0a changes no behaviour and is
  accepted on byte-identical options.
- **Known weakness, stated rather than hidden:** the calendar estimate (8–10 weeks)
  rests on a ~500-line unit derived from four commits. It is the least defensible
  number here, and the phase table lists the unknowns that would move it.
