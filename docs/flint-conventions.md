# flint conventions — what to reimplement, and what to leave

The research note behind P1's theme, layout and selection work. In
`docs/spec-extension-plan.md` §6 the owner decided: **read flint, reimplement the
conventions we want, take no dependency.** This is what "read flint" produced.

Source: `flint-chart@0.5.1` (MIT, Microsoft Corporation, published 2026-08-14),
downloaded from npm. **The published tarball ships `src/` as readable TypeScript**,
so everything below is source reading, not reverse engineering of a bundle. Line
numbers are from that version; quote them, do not trust this file alone.

Method: three readers worked the layout, colour/theme and selection/axes areas
independently; every claim below carries a source citation, and the layout and
selection sections' citations were spot-checked against the files
(`DEFAULT_NESTED_SNAP_THRESHOLD`, `computeLabelSizing`'s ladder, `resolveDiscreteType`'s
cardinality rule).

## 0. Two corrections to our own repository

| Our text | Reality |
|---|---|
| `docs/roadmap.md` item 22 lists `getCategoryOrder` among the functions flint owns | **No such function exists** (repo-wide grep: zero matches). The category-order knowledge lives in `field-semantics.ts:801` `resolveCanonicalOrder`, `field-semantics.ts:1045` `resolveSortDirection`, `semantic-types.ts:1014` `inferOrdinalSortOrder`. The other five names item 22 lists do exist |
| This note's first draft said `compute-layout.ts` is 1,755 lines and `axis-detection.ts` is 75 | They are **1,940** and **90**. The first counts came from a tool that skips blank lines — the same species of rot that `docs/roadmap.md` warns about in its own size table |
| The same draft said `theme/ground.ts` is 2,008 lines and that flint ships 11 theme presets | `ground.ts` is **2,146**, and there are **10** presets (`theme/presets/icons.ts` is an icon, not a preset). Same tool, same cause |
| — and flint's own comments are not always true either: `theme/types.ts:110-116` says the Economist "strokes zero in its signature red", while `presets/economist.ts:38` actually sets `"zero": "#121317"` | Which is the point of this section: read the code, not the document about the code |

Both are one-line fixes, and both are the reason this section exists: a name read off
a document is not a name in the code.

## 1. Layout

flint's layout knowledge is documented in its own `src/docs/design-stretch-model.md`
("Axis Layout Compression"), which is why this section can be precise.

### 1.1 The decision tree (design-stretch-model.md:106-123)

```
For each positional axis:
1. nominal or ordinal?              -> banded (discrete)
2. axis is binned?                  -> banded (continuous), N = bin count
3. template declares banded (bar/rect/boxplot)? -> banded (continuous), N = cardinality
4. otherwise                        -> continuous (the "gas pressure" model)
```

For Highcharts, rule 3 is the one that matters most: bar, column, boxplot and
heatmap-like marks are banded by declaration, not by data type.

### 1.2 The elastic budget (design-stretch-model.md:204-241, `decisions.ts:583-600`)

```
p = N · ℓ0 / L0                    pressure = natural demand vs available room
s = min(β, max(1, p)^α)            stretch, power-law, never below 1
ℓ = clamp(L0 · s / N, ℓmin, ℓmax)  the band step, in pixels
```

| Parameter | Default | Meaning |
|---|---|---|
| α `elasticity` | **0.5** | how hard pressure turns into stretch |
| β `maxStretch` | **1.5** | the axis may grow to 150% of its natural length, no further |
| ℓmin `minStep` | **6 px** | the tightest a band compresses before overflow |
| ℓ0 `defaultBandSize` | **20 px** at a 300 px reference | natural band size *and* the density threshold |
| ℓmax `maxBandSize` | **100 px** (`SPARSE_FIT_BAND_CEILING`) | the widest a band expands when the chart is sparse |
| `stepPadding` | **0.1** | `barWidth = step × (1 − stepPadding)` |

Three regimes, and this is the answer to "will 20 categories look cramped":
sparse `N·ℓ0 ≤ L0`; dense `N·ℓ0 > L0 ∧ N·ℓmin < Lmax`; **overflow `N·ℓmin ≥ Lmax` →
`N' = floor(Lmax / ℓmin)`** — at 400 px with ℓmin 6, that is **66 items** before
anything is dropped.

### 1.3 Which family Highcharts is in — a correction to flint's own table

flint's backend table (design-stretch-model.md:236-241) shows the bounds are
**backend-specific** because sizing differs:

| Backend | Native sizing | ℓmin | ℓ0 | ℓmax |
|---|---|---:|---:|---:|
| Vega-Lite | `width: {step}` → plot is `N × step` | 6 | 20 | **20** |
| ECharts | fills the grid (`barCategoryGap`) | 6 | 24 | 100 |
| Chart.js | fills the canvas (`categoryPercentage`) | 6 | 30 | 100 |
| Plotly | fills the plot area (`bargap`) | 6 | 20 | 100 |
| **Highcharts** | **fills the plot area** (categories are spread across it) | 6 | ~20–24 | **100** |

Highcharts is not in flint's table, but its behaviour is the ECharts/Chart.js kind,
not Vega-Lite's: it does not size the plot from the step count. So our ℓmax is 100,
not 20 — and that matters, because it is the difference between "two bars look silly
stretched across 800 px" and "two bars stop growing".

### 1.4 Labels (`decisions.ts:765-803`, `compute-layout.ts:1090-1158`)

A ladder with real constants — the part most worth copying, because it is pure
geometry and backend-independent:

| Condition | Rotation | Label limit | Font |
|---|---|---|---|
| `step < 10` | **−90°** | 40 chars | `clamp(step, 6, baseFont−2)` |
| `10 ≤ step < 16` | **−45°** | 60 chars | `clamp(step, 6, baseFont−1)` |
| otherwise | 0° | `clamp(step×8, 30, 100)` | `clamp(step−1, 6, 10)` |

- Character-width estimate **0.62** (`compute-layout.ts:73`) — so
  `labelPx = longestLabel × fontSize × 0.62`, and the rotate test is
  `labelPx > step`.
- **Widen before rotating**: try `desiredStep = ceil(labelPx) + 6`, capped by
  `max(6, floor(maxSubplotWidth / count))` (`:1119-1120`). Only then rotate.
- "Few and short" is its own branch: `count ≤ 4 ∧ longestLabel ≤ 8` → never rotate.
- Real truncation is the **backend's** job: flint's core emits `labelLimit` and the
  backend does `substring + '…'`. That is exactly our split — the neutral layer
  decides, `backends/` renders.
- flint's core has **no label thinning/skipping**. Only the theme layer carries a
  density constant (`ground.ts:910-917`: one tick per 45 px, 30/60 dense/sparse,
  floor of 3). If we want thinning, we design it ourselves.

### 1.5 Category overflow (`computeChannelBudgets`, `filter-overflow.ts:143-281`)

- flint **does not** change chart type and **does not** merge into "Others". It
  truncates and warns: `maxToKeep = floor(maxSubplotWidth / minGroupStep)`, plus a
  `...N items omitted` placeholder. Merging "Others" is left to templates that read
  the full table.
- The keep-order is a **priority chain**: caller's `sortBy` → quantitative aggregate
  (sum for bars, else max) → canonical order → numeric/colour ascending → facet
  top-N → explicit `sortOrder` → encounter order.

This is a design decision worth copying verbatim: silently merging a tail is a lie
about the data, and a *counting* truncation with a visible placeholder is not.

### 1.6 Grouping (`band-dodge.ts:29-138`)

`band-dodge` decides **dodge vs nested** — not grouped vs stacked.

- `DEFAULT_NESTED_SNAP_THRESHOLD = 0.9`; `DodgeMode = 'none' | 'local' | 'global'`.
- `maxPerBand ≤ 1` → none; `nestedFraction ≥ 0.9` → none; `maxPerBand ≥ globalCount`
  → global; else local.
- The "near 1:1" case the comments mention is `nestedFraction = bands with a single
  value / all bands ≥ 0.9`: the colour column is nearly a copy of the axis, so a
  handful of dirty rows must not split the whole chart into sub-lanes.
- Group geometry: `MIN_GROUP_GAP_PX = 3`, `minGroupStep = max(ceil(3/stepPadding), 2×groupCount)`.

### 1.7 What to take, and what to leave

| Convention | Rule | Source | Lines |
|---|---|---|---|
| Canvas budget | β = canvas/base, clamp, `stepPadding` 0.1, `barWidth = step×(1−stepPadding)` | compute-layout.ts:169-244,297 | ~40 |
| Elastic budget + three regimes | the formula and the thresholds above | decisions.ts:583-600; doc:245-295 | ~60 |
| Label ladder | the 6/10/16 table | decisions.ts:765-803 | ~60 |
| Label pixel estimate | 0.62, widen-then-rotate | compute-layout.ts:73,1090-1158 | ~50 |
| Overflow budget + keep-order chain | `floor(width/minStep)`, the chain | :1431-1559; filter-overflow.ts:186-281 | ~120 |
| Dodge | three modes, 0.9 threshold, laneCount | band-dodge.ts:29-138 | ~70 |
| Axis bandedness | declared-first, cardinality fallback | axis-detection.ts:20-63 | ~40 |
| Font shrinks, never grows | `minDim 220`, 0.7 floor | decisions.ts:838-844 | ~20 |
| Group gap | 3 px rule | compute-layout.ts:416-418 | ~15 |
| | | **total** | **~475** |

**Not taken** (~150 lines): the banker's-AR / slope-optimisation model
(design-stretch-model.md §2.8-2.9), the 2-D "gas pressure" model, facet-grid
wrapping, and flint's backend chrome constants (the ECharts `gridLeft` 70/50/16
family) — chrome budgets belong to a backend, and ours is Highcharts.

So **~300–450 lines after that cut**, which puts P1's layout work at the middle of
the 300–600 line estimate in `docs/spec-extension-plan.md` §6 — it stands.

## 2. Colour and theme

### 2.1 The decision layer is the same shape as ours

`core/color-decisions.ts` is 208 lines and decides **the colour scheme family only**:
`ColorMapType = 'categorical' | 'sequential' | 'diverging'`. Its own comment
(`:36-39`) says the core leaves `schemeId` empty in the automatic path and lets each
backend's colormap module pick the actual palette from `schemeType` +
`categoryCount` + the backend theme.

That is the **same separation as our neutral spec vs `backends/`**, arrived at
independently — useful evidence that the split is the right one, and a reminder that
the decision layer should stay free of hex values.

| Rule | Source |
|---|---|
| An explicit `encoding.scheme` is passed through as an id, but the *family* is still inferred | :157-171 |
| A `diverging` hint wins, carrying its midpoint | :88-94 |
| A `sequential` hint → sequential | :96-98 |
| Categorical hint but semantic type `Rank` → **sequential** (a rank is a continuum) | :105-109 |
| Categorical hint but the channel is `color` and the encoding is `temporal` → **sequential** — a date must not get a categorical palette | :111-113 |
| Semantic type `Correlation` → diverging with midpoint 0 | :123-125 |
| Otherwise `quantitative`/`temporal` → sequential, everything else categorical | :127-131 |
| `categoryCount` = distinct count, handed to the backend so it can size the palette | :134-142 |
| `primary` and `dataDriven` flags distinguish the series colour from a constant | :43-46,72-76 |

`fill`/`stroke` are declared but reserved (`:198-199`) — flint shipped the vocabulary
before the behaviour, which is a deliberate and cheap pattern.

### 2.2 Theme structure

`ThemeSpec` (`theme/types.ts:614-639`) is not a palette; it is **16 groups** plus
metadata (`extends`/`id`/`label`): `ink, type, structure, marks, labels, legend,
dataLabels, annotation, furniture, facets, layout, geometry, chartDefaults,
compileDefaults, interaction, variants`. `ink` splits into four role layers plus an
accent (`types.ts:90-157`): `surface{source,canvas,plot,panel}` →
`text{primary,secondary,muted,inverse}` →
`structure{axis,grid,frame,rule,zero,connector}` →
`series{single,categorical,categoricalExtended,overflow,sequential,diverging,status,selection}`.
Themes compose: `resolveThemeSpec` accepts a preset id, a spec, or
`{ extends: 'economist', ...overrides }` merged with `deepMerge`.

**The mechanism worth understanding is late resolution**, because it is what makes one
theme serve both a light and a dark host: `surface` is decided first
(`ground.ts:748-753`), `text` falls back to a mixed ink (`:755-760`), and only then is
`structure` resolved *against the actual surface* (`:797-802`). Presence is an ordinal
scale — `omit < hairline < quiet < full < emphasised` (`types.ts:29`) with a strength
table `{0, .42, .72, 1, 1}` (`presence.ts:129-135`) — and `emphasised` takes the
foreground colour outright, ignoring the role's own ink (`:179`), at 1.5× width
(`:198`).

Three things flint does **not** have, which matters because it is easy to assume it
solved them:

- **No ramp direction or midpoint logic.** `Ramp{stops, neutral?, space?,
  endpointsAgainstSurface?, consumption?, quantizeCount?}` is declared
  (`types.ts:79-88`) but `space` and `neutral` are never read by `ground.ts`. Zero is a
  zero *baseline*, not a colour midpoint.
- **No colour-blind or contrast validation.** `colorblindSafe` appears in the backend
  colormap modules and is never read — dead metadata. The only contrast logic pulls
  ramp endpoints away from the canvas (`ENDPOINT_CONTRAST = 1.2`, `ground.ts:1819`).
- **No per-datum emphasis at all.** `accent` is declared by 9 of its 10 presets and
  used once, as a fallback for `single` (`ground.ts:1867`); its semantic tones are
  per-*series* (`status{positive,negative,neutral}`, `:1964-1971`), not per-point.
  There is no "highlight these, fade the rest" channel anywhere.

That last one is the useful result: **our `ResolvedTone` (`compile/emphasis.ts:15`) is
already the right shape, and flint has nothing to copy for it.** Swapping the two
hardcoded hexes in `backends/highcharts.ts:31-34` for theme resolution is the whole
job — and §5.6's harder question (what does "highlight" mean when the measure *is* the
colour, as on a heatmap) is ours alone.

One more counterintuitive rule, relevant to heatmap: selecting a ramp is driven by
**field type** (`quantitative`/`ordinal` → ramp, `ground.ts:1909,1986`), not by category
count. The only count-based rule runs the other way — part-to-whole falls back to
discrete colours once the value count exceeds the ramp's own control-point count
(`:1952-1961`). So "many categories ⇒ switch to a continuous scale" is not a rule flint
has; if we want it, we invent it deliberately.

Two ideas worth taking directly:

1. **Role vocabulary over hex values.** Our `createChartwright({ theme })` should
   speak in roles (surface, text, grid, series, emphasis, muted) and resolve them per
   backend, exactly as our tone → colour mapping already does for `highlight`/`muted`.
2. **`ThemePreset.guidance`** — flint ships *prose instructions with the theme*
   ("the key holds 3 colours", "name the measure in the subtitle"), which the model is
   meant to read. That is a neat answer to a problem we have: a theme is not only
   colours, it is a house style the model should follow. It also means theme guidance
   and prompt guidance are the same mechanism.

### 2.3 What to take

| Convention | Lines |
|---|---|
| Theme types (`surface`/`text`/`structure`/`series`/`Ramp`) | ~80 |
| Palette resolution: single / categorical / extended / overflow, including the **never-cycle** rule | ~120 |
| `Ramp`: interpolate / quantize / sample, plus the endpoint-contrast floor | ~130 |
| Presence ordinal: five levels, strength table, fallback contrast | ~90 |
| Tone → ink, replacing the two hexes in `backends/highcharts.ts:31-34` | ~60 |
| `extends` + deep-merge composition | ~40 |
| Highcharts emission: series colours, background, axis grid and text | ~120 |
| **total** | **~640** |
| *triggered: value-label formatting* | *~280* |

**Value labels are triggered, not scheduled** — we have none today (only emphasis turns
`dataLabels` on). When we do, `theme/value-label-format.ts` (283 lines) is a pure,
dependency-free reference, and its rules are worth copying rather than inventing:
`SIGNIFICANT_DIGITS = 3`, `SUFFIX_ABOVE = 10_000`, and a k/M abbreviation that only
applies when `max ≥ 1000` **and** the smallest non-zero value is `≥ 1` and three
significant digits still distinguish the values — so `0.00123` never renders as
`1.23m` (`:157-173`). Stated precision is raised only when it would otherwise print two
different values identically, or a non-zero as `0` (`:108-125`).

**Not taken:** the 10 publication presets (`economist`, `nyt`, `nature`, `mckinsey`,
`swiss`, `datawrapper`, `powerbi`, `powerbi-light`, `pop`, `cartoon` — `presets/icons.ts`
is an icon, not a preset) and `ground.ts` (2,146 lines). Two reasons, one of them legal
(§5). Their palettes are also the wrong goal: a consumer wants *their* brand, not a
newspaper pastiche. What the preset comparison *is* good for is knowing which axes a
theme actually varies along — palette size (6 vs 5+12), surface (host-provided vs a
warm `#f4f1ea`), grid style (solid vs dashed), axis ticks present or not,
`bandFraction` .66–.70, `strokeWeight`, legend placement, furniture — and that the font
family is identical across them, so typeface is not one of them.

## 3. Chart-type selection

### 3.1 The mechanism is scoring, and multi-answer is built in

`chart-type-recommendation.ts` profiles the table (`profileData` → `DataProfile`), then
applies `add(type, score, reason)` rules and returns **every candidate sorted, with its
reasons** (`:323-326`). There is no threshold and no single winner.

That matters for us twice over:

- it is the shape our P1 labelled set needs — "bar and line are both acceptable" is
  simply two adjacent entries (Grouped 72 / Stacked 70, `:285-288`);
- it is a *second chooser* in a library whose whole premise is that the model chooses.
  See §3.4 for why we take the thresholds and not the scorer.

| Rule | Score | Source |
|---|---:|---|
| lat + lon present | Map 96 | :253-255 |
| region field (or a column name hint: country/state/province/nation) + measure | Choropleth 92 | :256-261 |
| **time + measure** | **Line 88 and Area 66 together** — it does not check interval regularity or point count | :264-267 |
| **≥ 2 measures** | Scatter 84 | :270-272 |
| any dimension + measure | Bar 80 (the fallback) | :275-277 |
| measure, no dimension | Histogram 82 | :280-282 |
| ≥ 2 categorical-like, one with cardinality 2–12, + measure | **Grouped 72 and Stacked 70 together** | :285-288 |
| two low-cardinality dimensions (2–25) + measure | Heatmap 74 | :289-291 |
| exactly one categorical-like, no time, cardinality 2–8, rows ≤ card × 1.5 | Pie 64 | :294-300 |
| category + measure, no time, rows ≥ smallest card × 2 | Boxplot 58 / Strip 52 | :303-309 |
| nothing matched | Scatter 20 / Bar 15 | :318-321 |

Constants: `LOW_CARD_SERIES = 12`, `LOW_CARD_AXIS = 25`, `PIE_MAX_SLICES = 8`
(`:209-211`). `classifyRole` (`:113-136`) resolves ambiguity "most specific wins":
geo coordinates → geo name → temporal → identifier → measure → ordinal → categorical —
and **identifier is inferred from a column-name whitelist** `['id', 'index', 'idx',
'row', 'order', 'position', 'pos']`, matching exactly or as a `_suffix` (`:101-106`).

### 3.2 Two things we should take

1. **The thresholds as prompt rules and acceptance criteria.** "Near one row per
   category and ≤ 8 categories → pie", "≥ 2 measures and no group → scatter",
   "time + measure → line or area" are exactly the selection guidance our system prompt
   lacks (roadmap item 9 wants them grounded, and flint's numbers are a grounded
   starting point rather than a guess).
2. **`supportedTypes` post-filtering** (`:346-349`; the backend wrappers pass their own
   renderable set in, `vegalite/recommendation.ts:247,267`). This is *independent
   corroboration of our capability handshake* (§5.2 of the plan): another library at
   this scale also restricts the candidate set to what the backend can actually draw.

Also worth taking: the **identifier whitelist**. Our §2.1 problem was that a scatter's
datum identity collapses to the x value. flint's answer is an `id` channel *plus* a
convention for which column is an id — cheap, and it composes with the positional
fallback we already planned.

### 3.3 Where a labelled set can come from — and where it cannot

- flint's own repository has **no natural-language field anywhere** (grep for
  `prompt|natural language`: zero matches). Its test cases are
  `{ title, description, tags, chartType, data, fields, metadata, encodingMap }`
  (`test-data/types.ts:18-35`) where `chartType` is the *render input*, not an
  independently judged expectation.
- **`test-data/real-world-tests.ts` is the one usable corpus** (~30 cases, `:100-649`):
  each has a real dataset, a `title`, a prose `description`
  ("How each country splits generation across sources", `:362-364`) and a chart type
  (Stacked Bar `:362`, Grouped Bar `:343`, Line `:182`). Those descriptions reverse
  cleanly into requests, so the corpus can *seed* our labelled set.
- **The matrix generators are not a corpus.** `bar-tests.ts`'s
  `BAR_MATRIX`/`STACKED_BAR_MATRIX`/`GROUPED_BAR_MATRIX` (`:47-118`) and
  `scatter-tests.ts` enumerate (field type × cardinality × row count) and tag cases
  `temporal/nominal/quantitative/small/medium/large` (`buildBarTags`, `:352-367`).
  They generate *features*, not expectations — volume that looks like a test set and is
  not one.
- `rankChartTypes`'s `reasons` strings (`:254-320`) are a ready-made explanation
  skeleton, and score proximity is a principled way to define a multi-answer acceptance
  set.

### 3.4 What we take, and one thing we deliberately do not

**Take** (~150–250 lines): the thresholds as prompt rules, the acceptance-set idea, the
identifier whitelist, and `supportedTypes` as corroboration for §5.2.

**Do not take: the scorer.** Our library's premise is that the model picks the chart
from the request and a summary of the data; adding a deterministic scorer would create a
second source of truth about the same question — the failure mode R1 already names. If
the model ever becomes unavailable, a scorer is a reasonable *fallback*, and flint's is
then the reference implementation. Until then, the same numbers serve better as rules
the model reads and as the yardstick the labelled set measures against.

## 4. Channel vocabulary — align where it is free

Our plan's `ChannelName` has 12 entries; flint's `channels` constant
(`core/types.ts:12-26`) has 23, in five declared groups: positions
(`x x2 y y2 latitude longitude id radius detail order`), legends
(`color group size shape text opacity strokeDash`), price (`open high low close`),
facets (`column row`), kpi (`metric value goal`).

| flint has | Action for us |
|---|---|
| `id` | **Take** as an optional identity channel for point types (§2.1 of the plan), with the positional key as fallback |
| `x2`, `y2` | **Confirms** §3.4's `y2`; flint files it under *positions*, not legends — as we do |
| `color` and `group` as separate channels | Note only. Our `series` conflates "split into series" with "colour by"; the declaration table's per-type roles cover today's types, but a future facet or a true `color` channel will want them separate |
| `column`, `row` (facets) | **Out of scope** — Highcharts has no facet concept; small multiples are N charts and therefore the consumer's layout job |
| `latitude`, `longitude` | Out of scope (already refused, and flint's Map/Choropleth rules score 96/92 for them — the strongest rules in its scorer, and the ones we cannot use) |
| `opacity`, `shape`, `strokeDash`, `angle`, `radius`, `detail`, `order` | Out of scope for now; `order` is interesting later (connected scatter, where trajectory order is not the x value) |
| `metric`, `value`, `goal` | Out of scope: KPI cards are dashboard tiles, not charts. `goal` ≈ our `target` (bullet) |
| encoding `type: nominal \| ordinal \| quantitative \| temporal` per channel | **Align our names.** Our `axes.*.kind` (band/linear/time/log) is about the *scale*; theirs is the standard Vega-Lite vocabulary for the *encoding*, and aligning costs nothing while making a future translation layer cheap |
| `y: ['sales', 'profit']` array form → the assembler unpivots into a synthetic key/value pair (`static-series.ts`, `STATIC_SERIES_KEY_COLUMN`) | Note only. This is a wide-table convenience; our §3.4 handles the two-measure case with `y` + `y2`, and an array form matters only at three or more measures |
| `ChartAssemblyInput` requires `semantic_types` per field, but `inferVisCategory` fills in when absent | **Validation of our roadmap item 18**: "optional, declared-first, inferred otherwise" is the position we kept as a possible opt-in, and there is now an implementation at scale that chose it |

## 5. Licensing and attribution — the precise line

Every flint source file carries:

```
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
```

and the package ships its `LICENSE`. The practical rule:

- **Copying code or values** — a function body, or the concrete hex values in
  `theme/presets/*.ts` — is distributing their copyrighted material, so the MIT notice
  (copyright line and permission text) must travel with it.
- **Reimplementing a judgement** — a threshold, a formula, a decision tree — is not
  copying. A courtesy credit is enough, and this repository already has the place for it
  (`README.md`'s Prior art section names `flint-chart` and why).

Our design happens to land on the clean side: the theme we ship is the *consumer's*
brand, resolved from roles, so we need none of their palettes and none of their
preset values. If that ever changes — a preset named after a publication is exactly the
kind of *value* copy this section is about — the notice requirement comes with it.

## 6. What this changes in the plan

| Plan item | Change |
|---|---|
| §6 P1 estimate | Almost confirmed, and adjusted upward: layout ~300–450, theme ~500–650 (§2.3) → **~800–1,100 lines for both**, still inside P1's ~2,300 but in its upper half. The theme half is bigger than §6 assumed, because a role-resolving theme that serves light and dark is not a palette |
| §2.1 scatter identity | Add the optional `id` channel as the *preferred* identity (positional key as fallback), and reuse flint's identifier column-name convention |
| §5.8 / P1 labelled set | Seed requests from `real-world-tests.ts` descriptions; write the rest ourselves (flint has no NL corpus); define acceptance sets by score proximity |
| §5.2 capability | Cited as independent corroboration: flint also filters candidates by `supportedTypes` |
| §8 out of scope | Add: facets (`column`/`row`), KPI cards (`metric`/`value`/`goal`), and the visual channels (`opacity`, `shape`, `strokeDash`, `angle`, `radius`, `detail`, `order`) |
| Roadmap item 21 (date axis) | **Evidence is mixed and that is the finding.** flint puts a real `Date`/`DateTime`/`Timestamp` on a temporal encoding, `Year` on `temporal|ordinal` resolved by distinct ≤ 6 → ordinal, and **`Month`/`Quarter`/`Week`/`Day`/`Hour` on `ordinal` only** (`type-registry.ts:83-98`) — so a month column is deliberately *not* a time axis there, and `axis-detection.ts:27` even forces `temporal → ordinal` when an axis must be banded. That supports reopening item 21 for true timestamps, and **opposes** "every date column becomes a time axis". Recommend deciding by granularity |
| Roadmap item 22 | Two corrections: `getCategoryOrder` does not exist; the real names are in §0 |
| Roadmap item 8 (layout) | Now has a concrete reference implementation to reimplement from, with real constants instead of judgement calls |

## 7. What we did not read

Stated so the gaps are not mistaken for coverage:

- `theme/ground.ts` (2,146 lines) beyond the role-resolution and series-colour paths
  (~725-814, 1808-2040) — the per-chart grounding of all 16 theme groups is skimmed, not
  understood.
- The backend colour registries (`chartjs/colormap.ts`, `echarts/colormap.ts`,
  `plotly/colormap.ts`, ~140 lines each) — read only far enough to establish that their
  `colorblindSafe` flag is never read by anything.
- The 11 preset files' actual values — deliberately not inventoried (§5).
- The backend layers (`vegalite/assemble.ts` 1,378, `echarts/assemble.ts` 700,
  `instantiate-spec.ts` in each) beyond the specific citations above: chrome budgets,
  facet layout and format handling live there, and those are the parts we are *not*
  copying.
- `field-semantics.ts` (996) and `semantic-types.ts` (929) were read for the rules cited
  (scale type, stackability, canonical order, the 46-type registry) and not in full.
- Whether flint's rendering actually looks right: nothing here was rendered. Its own
  tests are data-level, exactly like ours (`spec-extension-plan.md` §5.4), so its
  constants are as unverified visually as anything we would write.
