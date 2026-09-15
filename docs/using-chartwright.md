# Using chartwright in your own app

This is the consumer-facing guide: what you need, how to wire it up, and what you
get back. `examples/react-highcharts` is the same instructions with working code
around them.

> **Status: 0.1.0-alpha — pre-release.** Install it explicitly by tag, because `latest`
> is deliberately not pointed at a pre-release:
>
> ```bash
> npm install chartwright@alpha highcharts
> ```
>
> While the major version is 0, a minor bump may contain a breaking change; the promise is
> spelled out under "Versioning" in the package README, and every release is listed in its
> CHANGELOG. Vendoring the source (step 1's alternative) remains supported for anyone who
> wants to read or patch the compiler.

## What you need

| | Why |
|---|---|
| Rows in memory | chartwright compiles *your* data in *your* process; it never fetches anything |
| A chart library to render with | Today the compiler emits Highcharts options for 14 chart types: bar, line, spline, area, areaspline, pie, heatmap, scatter, bubble, columnrange, arearange, areasplinerange, errorbar, dumbbell — plus stacking, polar, donut holes, sparklines, dual-axis combo and range bands |
| An LLM that supports **tool calling** | The agent loop uses `tools` / `tool_calls` (function calling). Any OpenAI-compatible endpoint works — if it does not implement tool calling, the loop cannot run |
| Somewhere safe for the API key | **Not the browser.** A page holding a provider key leaks it to anyone with DevTools, and most providers disallow browser calls outright. Use your own backend endpoint (a ~60-line proxy; see step 3) |

You do **not** need: a database, a server for chartwright itself, a build step
for the library, or any runtime dependency — the package has none.

## 1. Install

```bash
npm install chartwright@alpha highcharts
```

chartwright itself has **no runtime dependencies**. Highcharts is yours: your version, your
licence, your bundle. Some chart types need a Highcharts module as well — `listChartTypes()`
reports which, per type (see §7).

**Vendoring the source instead.** If you want to read or patch the compiler, or your policy
is to build dependencies from source, copy `packages/chartwright` out of the repository and
point at it. Its `prepare` script builds `dist/` during your `npm install`, so this is one
step:

```jsonc
// your-app/package.json
{
  "dependencies": {
    "chartwright": "file:../my-deps/chartwright"
  }
}
```

```bash
npm install
```

**What does not work: `npm install github:<user>/chartwright`.** That fetches the
*repository root*, which is the monorepo — `chartwright-monorepo`, private, with no library
entry point. npm has no way to name a package in a subdirectory of a git dependency, so
point a git or `file:` dependency at `packages/chartwright` itself, not at the repository.
A downloaded source archive is the same story: it has no `dist/` (build output is not
committed), and the `prepare` hook is what builds it during install.

## 2. Nothing to configure

A normal install works in a normal project — bundler or plain node, TypeScript or
JavaScript. There is no `optimizeDeps` tweak and no `allowImportingTsExtensions` flag.

The published package ships a build (`dist/`, ESM + type declarations), so a normal install
works in a normal project — bundler or plain node, TypeScript or JavaScript. There is no
`optimizeDeps` tweak and no `allowImportingTsExtensions`.

That was not always true, and the difference is worth knowing if you are reading an older
guide: the entry point used to be TypeScript source, which node refuses to load from
`node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so consumers needed a
bundler plus two flags. The library's own source still uses extension-ful imports
internally — that is what lets its tests run with no build step — but `dist/` has those
rewritten to `.js`, which is what you import.

## 3. Give it an LLM, without giving it your key

The library asks for a **function**, not a provider SDK, so you decide where the
model call happens. The safe arrangement is a small endpoint of your own:

```
browser (your app)                your backend                 provider
  │  POST /api/llm ─────────────▶ reads the key from env
  │  { messages, tools }           adds Authorization ────────▶
  │  ◀── { content, toolCalls } ◀──────────────────────────────
```

`examples/react-highcharts/server/proxy.mjs` is a complete implementation
(~60 lines, no dependencies) including the translation between chartwright's
normalised messages and the provider's dialect. Copy it, or write the equivalent.

Its configuration, via environment variables:

| Variable | Default | Notes |
|---|---|---|
| `LLM_API_KEY` | — | required |
| `LLM_BASE_URL` | `https://api.deepseek.com/v1` | any OpenAI-compatible endpoint |
| `LLM_MODEL` | `deepseek-chat` | |
| `PORT` | `8787` | |

In a **Node-only** app (a CLI, a job, a backend) you can skip the proxy and call
the provider directly from your `complete()` implementation. The interface is the
same; only the transport differs.

## 4. Wire it up

The whole integration is three steps:

```ts
import type { LlmClient } from 'chartwright';
import { createChartwright } from 'chartwright';

// 1. A client that holds no credentials — it posts to your own endpoint.
const llm: LlmClient = {
  async complete(request) {
    const response = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: request.messages, tools: request.tools }),
      signal: request.signal,
    });
    if (!response.ok) throw new Error(`llm proxy failed (${response.status})`);
    return response.json();
  },
};

// 2. Configure once.
const chartwright = createChartwright({ llm });

// 3. Ask, then render.
const result = await chartwright.ask({
  query: 'Which 10 counterparties have the largest traded notional?',
  rows,
  onEvent: (event) => showProgress(event),   // optional; see "progress" below
});

Highcharts.chart(container, result.options);
```

### Your colours: the theme

Every colour the compiler emits comes from a **theme**: a set of roles —
`surface`, `text`, `structure`, `series`, `emphasis` — rather than a palette of
presets. The default is deliberately plain (neutral greys, one house blue, the
emphasis orange the examples use), because the point of the layer is that *your*
brand replaces it without forking the compiler:

```ts
const chartwright = createChartwright({
  llm,
  theme: {
    id: 'acme',
    roles: {
      series: { single: '#0b5cad', categorical: ['#0b5cad', '#f2a13c', '#2f8f5b'] },
      emphasis: { highlight: '#d92d20' },
    },
  },
});
```

Groups you omit keep their defaults, so an override can never leave a role
unresolved; an empty `categorical` palette is refused rather than silently
greyed.

Two rules worth knowing before you override:

- **Series colours never cycle.** More series than palette entries means the
  extras take the `overflow` role (grey by default). Two series in one colour is
  not a shortage of paint, it is a lie about the data.
- **A heatmap does not take the palette.** Its measure *is* the colour, so it
  draws the `series.sequential` ramp as the `colorAxis` ends — which role a type
  consumes is declared per type, and `listChartTypes()` reports it as
  `colorRoles`. Emphasis on a heatmap is a border rather than a fill, for the
  same reason: recolouring a cell would destroy the datum.

The theme is fixed at `createChartwright` and a request cannot change it: the
same spec must always mean the same picture.

### How much room the compiler assumes

Label rotation and label font size are **derived**, not hoped for: category count
times label length, measured against a reference plot width of 400px. A handful
of short labels never rotates; denser axes shrink the font, then turn the labels
to −45° and then −90° as the bands tighten. The compiler cannot see your
container, so on a wide screen the reference is conservative — tell it the width
you actually render into and the derivation becomes exact:

```ts
const chartwright = createChartwright({ llm, layout: { plotWidth: 720 } });
```

When labels would not fit even at the tightest band, nothing is dropped and
nothing is silently crowded: the compile returns a **warning** naming the axis,
every mark and every label is still drawn, and the warning says what would help
(aggregate, or a wider `plotWidth`).

### Two measures on one chart

When two measures have different units — notional in billions and commission in
basis points — putting both on one axis flattens the smaller one. The spec can
name a second measure with `encodings.y2`, and the compiler draws it on a second
(right) axis with its own title. Series are named after their measure field
(`notional_usd`, `avg_commission_bps`), which is what makes the legend readable.

**Emphasis has to say which measure it means, and the answer depends on the rule.** With
two measures every row is two data points, one per series, so a rule that names one
measure's *values* stays inside that measure:

| Rule | Reaches |
|---|---|
| `top_k` — including `rest: true` | only the measure it names. `top_k` on `avg_commission_bps` does not style the `notional_usd` bar in that category, and `rest` fades exactly what `top_k` selected, so it too stays in one series |
| `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between` | **every series of every row it matches.** These name a *row* rather than a measure — "counterparty is Globex" is true of Globex whichever series you read — so they are not limited to two: with a `series` encoding each matching row styles all 2N series. The predicate also reads whatever column it names, charted or not, so `gt` on `avg_commission_bps` mutes a row's **notional bars** too |

That asymmetry is deliberate, and it is the reason the series are named after their
fields at all: a ranking is a claim about one measure's values, so it must not reach
across into a series it never ranked. The practical cost is one extra rule:

```ts
// "highlight the largest of each, fade the rest" on a dual-axis chart is two pairs.
emphasis: [
  { when: { op: 'top_k', k: 1, field: 'notional_usd' }, style: { tone: 'highlight' } },
  { when: { op: 'top_k', k: 1, field: 'notional_usd', rest: true }, style: { tone: 'muted' } },
  { when: { op: 'top_k', k: 1, field: 'avg_commission_bps' }, style: { tone: 'highlight' } },
  { when: { op: 'top_k', k: 1, field: 'avg_commission_bps', rest: true }, style: { tone: 'muted' } },
]
```

Naming the series after their fields also protects the `top_k` half: without it the two
measures would share a datum key and a ranking on one would silently restyle the other.

**The risk:** independently scaled axes can be made to show any correlation. The
compiler will never volunteer a dual-axis chart; it draws one only when the spec
explicitly asks for `y2`. Both axes are always titled with their field name,
because two units need two labels and an unlabelled axis is an invitation to
misread.

### Scatter plots and axis kinds

When both channels are numeric measures rather than categories, the compiler
infers linear axes automatically. `scatter` and `bubble` declare their x channel
as a measure, so no axis override is needed:

```ts
{ chart: { type: 'scatter' }, encodings: { x: { field: 'tenure' }, y: { field: 'nps' } } }
```

For other chart types where you need to override the inferred axis kind (e.g.,
treating a date column as numeric), use `axes.*.kind`:

```ts
axes: { x: { kind: 'linear' } }   // 'band' | 'linear' | 'log'
```

Scatter allows duplicate x values — two points at the same position are normal
for a cloud, not a collision. Emphasis uses positional keys so "highlight the
highest" marks exactly one point even when several share an x value.

### Follow-up questions

The library is **stateless**. To continue a conversation, hand the transcript
back:

```ts
const next = await chartwright.ask({
  query: 'now fade everything except the top three',
  rows,
  messages: result.messages,
  sessionId: result.sessionId,
});
```

Nothing is retained between calls, so there is no session to leak and no memory
to grow. `sessionId` is an opaque correlation id.

### Progress, and cancelling

`onEvent` fires at every hop: `round_start`, `tool_call`, `tool_result`,
`assistant_text`, `warning`. Tool-level events are emitted by the loop itself, so
**a non-streaming client still shows progress** — it never leaves the user
staring at nothing. `signal` (an `AbortSignal`) cancels a run in flight.

## 5. Two modes: chart a question, or chart a result

`ask()` does one of two jobs, and one boolean picks which.

**Default — the model investigates.** You hand over a table and a question. The model
profiles the data, runs declarative queries over it, and submits a spec; the compiler
binds the result into the chart. This is the mode for "which counterparties are
biggest?" when all you have is the raw table.

**`present: true` — the model presents.** You hand over rows you have already produced:
your own `GROUP BY`, your own `ORDER BY`, the numbers you intend to show. The model
chooses how to draw them and nothing else.

```ts
const result = await chartwright.ask({
  query: 'which counterparty traded the most notional?',
  rows: myAggregatedResult,      // already grouped and ranked, by your own query
  present: true,
});
```

### What `present` guarantees

Not by instruction — by the tool list. In this mode the model is offered
`describe_table`, `preview_rows` and `submit_spec` and nothing else: there is no
aggregate, filter, sort, limit, derive or time binning it could call. A call for a tool
it was not offered is refused before any implementation is reached.

So, concretely:

- `result.spec.transform_plan.steps` is always `[]`;
- `result.dataset` is the rows you passed, in the order you passed them, unchanged;
- `result.options` is drawn from those rows, so any ranking on the chart is **your**
  ranking. Put the `ORDER BY` in your own query, which is where it belongs; the library
  will not second-guess it.

### What the model still decides

The chart type, the title, which column is x and which is the measure, the orientation,
and any `emphasis` — "highlight the top three" is a condition it declares and the
compiler evaluates against your rows. That is most of what makes a chart readable, and
it is the reason to use this rather than a fixed chart template.

### When it cannot do what you asked

Two honest failures, both of which say so instead of drawing something else:

- **Your table is finer-grained than the chart the model picked.** If two rows share the
  value it chose for x — a result grouped by country *and* asset class, charted by
  country — it cannot add them up. It is refused, told which column distinguishes those
  rows, and asked to put that in `encodings.series`; usually it does, and the only trace
  you see is a warning.
- **The request needs aggregation.** "Total by region" over a table with no such column
  is not something this mode can do. That is `ask` mode, where the model has `run_query`.

Anything the compiler refuses is handed back to the model **while it is still running**,
so a fixable submission gets fixed rather than turning into an exception for you to
handle.

### Descriptions, when the values cannot speak for themselves

Optional, never required. A pre-aggregated table is where they earn their place, because
the numbers cannot say what they mean:

```ts
const result = await chartwright.ask({
  query: 'which counterparty pays the highest commission?',
  rows: summary,
  present: true,
  dataDescription: 'One row per counterparty, already aggregated and ranked by notional.',
  columns: [
    { name: 'avg_commission_bps', description: 'Average commission. NOT additive.' },
    { name: 'distinct_venues', description: 'How many venues it used. NOT additive.' },
    { name: 'trade_id', type: 'string', description: 'An identifier, not a quantity.' },
  ],
});
```

A declared `type` overrides inference — only you know that an all-digit `trade_id` is an
identifier — and it is used in the prompt *and* by `describe_table`, so the model is not
told two different things about one column. A name that is not in your rows is ignored
rather than invented.

This text goes to the provider with the request: it is the one part of the prompt that
is yours. See "What the model sees" below.

## 6. What you get back

| Field | What it is | What it is for |
|---|---|---|
| `options` | Chart-library options with the data already bound | Render it |
| `spec` | The neutral chart spec: chart type, transform plan, encodings, emphasis | The auditable artifact — see "Replay" below |
| `dataset` | The complete table that was plotted | Tables, tooltips, exports. **Not sent to the model** — it may have previewed the first rows, never the table as a payload |
| `messages` | The transcript | Pass back for a follow-up |
| `sessionId` | Correlation id | Logging, support |
| `warnings` | Non-fatal problems (a tool error, an emphasis rule that matched nothing) | Surface them; do not swallow |
| `trace` | Every tool call with arguments, result summary and duration | Debugging, and showing the user what happened |

### Replay without the model

`result.spec` plus `result.dataset`'s source rows is enough to reproduce the
chart with no LLM involved:

```ts
import { compileToHighcharts } from 'chartwright';
const again = compileToHighcharts(result.spec, rows);
```

That is what makes golden tests, diffs and audit possible.

## 7. Supported chart types

The compiler supports **14 chart types** across four model kinds. Every type is
declared in `packages/chartwright/src/compile/chart-types.ts` — that table is the
single source of truth for the schema enum, the prompt list, the validator, and
this documentation. A type not in the table is refused with a clear error, and
the refusal goes back to the model inside the loop so it usually retries with a
supported type.

### By kind

| Kind | Types | What it means |
|------|-------|---------------|
| **Categorical** (10) | `bar`, `line`, `spline`, `area`, `areaspline`, `columnrange`, `arearange`, `areasplinerange`, `errorbar`, `dumbbell` | Band x axis + measure(s). Range types use `low`/`high` instead of `y`. |
| **Part-to-whole** (1) | `pie` | Slices sized by value. `chart.hole` makes it a donut. |
| **Matrix** (1) | `heatmap` | Two category axes + measure as colour. Needs `highcharts/modules/heatmap` + `coloraxis`. |
| **Point-cloud** (2) | `scatter`, `bubble` | Two numeric axes, no categories. Bubble adds `size` channel. Need `highcharts/highcharts-more`. |

### Chart-level modifiers

| Modifier | What it does | Honoured by |
|----------|-------------|-------------|
| `chart.stacking: 'normal' \| 'percent'` | Stack the series; `percent` rescales each category to 100 | bar, line, spline, area, areaspline |
| `chart.polar: true` | Wrap the axes around a circle — radar with line, rose with bars | bar, line, spline, area, areaspline |
| `chart.hole: 0..1` | The hole that makes a pie a donut | pie |
| `chart.compact: true` | Drop title, axes and legend — a sparkline | any type |
| `chart.type2: string` | How `encodings.y2` is drawn (default `'line'`) | categorical types |
| `axes.x.kind / axes.y.kind` | Override inferred axis type: `'band' \| 'linear' \| 'log'` | any type |
| `axes.y.range: { min?, max? }` | Fixed scale when it is a fact about the measure | any type |
| `axes.y2.range: { min?, max? }` | Fixed scale for the secondary axis | dual-axis combo |

A modifier a type cannot mean is **refused, not ignored**: `stacking` on a pie
comes back as an error naming what the type does honour.

### Encoding channels

`x` is the category and `y` is the measure, in every chart and whichever way the bars point:
`chart.orientation` is the only thing that says horizontal, and it does not move the channels.
A horizontal bar chart of `notional_usd` by `counterparty` is always `x: counterparty`,
`y: notional_usd` — which is worth stating because a model reading "horizontal" as a reason to
swap them produces a spec that validates and then draws axes, a title and no marks.

| Channel | Purpose | Used by |
|---------|---------|---------|
| `x` | Category or measure for the horizontal axis | all types |
| `y` | Primary measure | categorical, part-to-whole, matrix, point-cloud |
| `y2` | Secondary measure on a right axis (dual-axis combo) | categorical |
| `low` / `high` | Lower and upper bounds for range types | columnrange, arearange, areasplinerange, errorbar, dumbbell |
| `size` | Third numeric dimension | bubble |
| `series` | Split data into multiple series | categorical, point-cloud, matrix |

Every channel the declaration calls a **measure** must hold numbers; `x`, `series` and the
matrix's second category do not have to. A measure value that is blank — `null`, `undefined`,
or an empty string — is a **gap**, and a null and a real `0` are different pictures. A value
that is neither blank nor a number is **refused** rather than drawn as a hole, and the refusal
names the column and the channel it was written under. Two consequences worth stating, because
both are decided rather than incidental:

- **A gap is a hole in a categorical chart and a refusal in a point cloud.** In a row of bars
  or along a line, a missing value is visible as a gap, which is what it is. A point cloud has
  no gap to show — its marks are positioned, and Highcharts simply skips a datum whose
  coordinate is missing, so a scatter loses a point and a bubble with a null `size` draws
  nothing at all. A `scatter` or `bubble` whose `x`, `y` or `size` is empty is refused by name.
  A pie with a gap is refused too: a slice is a share of a whole.
- **A `Date` object on a measure channel is refused.** `Number(date)` is the epoch in
  milliseconds, so a date column on `y` used to compile to a chart of `1767225600000` against
  an epoch axis, silently. A date is a category: put it in `x`.

A numeric column on `x` is still read as categories on a band axis, so a numeric category is
legal; a channel that *is* a measure, on the other hand, cannot take a label.

### Modules your bundle needs

chartwright has **zero runtime dependencies** — it does not install or bundle
Highcharts. You render the options it produces with your own Highcharts instance.
Some chart types need Highcharts modules loaded alongside the core:

| Module | ESM import | Required by |
|--------|-----------|-------------|
| Core | `import Highcharts from 'highcharts/esm/highcharts.js'` | all types |
| highcharts-more | `import 'highcharts/esm/highcharts-more.js'` | scatter, bubble, columnrange, arearange, areasplinerange, errorbar, dumbbell |
| heatmap | `import 'highcharts/esm/modules/heatmap.js'` | heatmap |
| coloraxis | `import 'highcharts/esm/modules/coloraxis.js'` | heatmap |
| dumbbell | `import 'highcharts/esm/modules/dumbbell.js'` | dumbbell (also needs highcharts-more) |

**Under a bundler, always use the ESM builds.** Highcharts 12's `package.json`
has no `exports` field, so `import 'highcharts/modules/heatmap'` resolves to the
UMD file which creates a second Highcharts instance and throws at render time.
The ESM imports share one instance — verified in a browser.

Rather than memorise which modules, ask the library:

```ts
import { listChartTypes } from 'chartwright';
listChartTypes();
// → [{ name: 'arearange', kind: 'categorical', requires: ['x','low','high'],
//     honours: ['compact'], modules: ['highcharts/highcharts-more'], colorRoles: [...] }, ...]
```

### Known expressiveness boundaries

These return a warning rather than a lie:

- emphasis has **semantic tones only** (`highlight` / `muted`) — you cannot ask
  for a specific colour yet;
- emphasis can select the **top/bottom k**, value thresholds and named categories
  — not arbitrary ranks like "the 1st and 3rd". "Highlight the top one and fade
  the rest" is two rules over **one** ranking, not a bigger `k`: the second repeats
  the first's condition with `rest: true`, which marks the complement.

  ```ts
  emphasis: [
    { when: { op: 'top_k', k: 1, field: 'notional_usd' }, style: { tone: 'highlight' } },
    { when: { op: 'top_k', k: 1, field: 'notional_usd', rest: true }, style: { tone: 'muted' } },
  ]
  ```

  `rest` follows the same threshold *and the same ties* as the rule it complements,
  so the pair partitions the rows exactly. A larger `k` is not the complement and
  never was: `top_k` counts from the top, so on twelve rows `k: 11` fades the top
  eleven — including the bar the first rule just highlighted — and leaves the last
  bar at the default colour, where it reads as the selected one. On a dual-axis
  chart `rest` complements **one** series, the measure it names; see "Two measures
  on one chart" above for the two-rule form that covers both;
- sorting is the plan's job: "the largest 5" **must** sort before limiting;
- **a date column is a category.** There is no `datetime` axis yet: the x axis is
  spaced evenly whatever the dates say. For a monthly series with every month
  present that changes nothing; for one with a gap it draws the gap as though it
  were not there. That is a decision, not an omission.

## 8. What is not yet supported (and when it arrives)

The commitment is **Rung 3: ~36 types by end of P2**. Rungs 4 and 5 are not
refused — they are *triggered* by real demand evidence rather than by a date.

### Coming in P2 (committed)

| Family | Types | What's needed | Status |
|--------|-------|---------------|--------|
| **C** two/five-value points | `waterfall`, `bullet`, `boxplot` | `target` channel; percentile aggregation for ask-mode boxplot | planned |
| **F** two numeric axes | `packedbubble` | `size` channel wiring | planned |
| **H** part-to-whole extended | `funnel`, `pyramid`, `gauge`, `solidgauge` | `axes.y.range` (already supported) | planned |
| **A** band + one measure | `lollipop`, `dotplot`, `polygon`, `cylinder`, `columnpyramid` | declaration + mapper | planned |
| **B** stack/offset | `streamgraph` | `chart.stacking` (already supported) | planned |

### Rung 4 — triggered by demand

| Family | Types | Trigger |
|--------|-------|---------|
| **J** hierarchy | `treemap`, `sunburst`, `treegraph` | Consumer asks for hierarchical data visualization |
| **K** links / flow | `sankey`, `dependencywheel`, `networkgraph`, `arcdiagram`, `organization`, `flowmap` | Consumer asks for flow/relationship charts |
| **E** computed from raw | `histogram`, `bellcurve`, `pareto` | Consumer asks for statistical distributions |
| **O** special channels | `wordcloud`, `vector`, `windbarb` | Consumer asks for these specific types |

### Rung 5 — triggered + licence-gated

| Family | Types | Blocker |
|--------|-------|---------|
| **I** OHLC / financial | `candlestick`, `ohlc`, `hlc`, `heikinashi`, `hollowcandlestick`, `renko`, `pointandfigure`, `flags` | Highcharts Stock licence |
| **D** time + interval | `xrange`, `gantt`, `timeline` | Highcharts Gantt licence + time axis |

### Refused (will not be implemented)

| Family | Types | Reason |
|--------|-------|--------|
| **L** geo / maps | `map`, `mapbubble`, `mappoint`, `mapline`, `tiledwebmap`, `geoheatmap` | Requires a second data source (GeoJSON); out of scope |
| **V** set theory | `venn` | Set semantics do not fit the channel model |
| **O** (partial) | `item`, `pictorial` | Require icon resources; out of scope |

### Queryable at runtime

Your app can check what it actually got at integration time:

```ts
import { listChartTypes } from 'chartwright';
const types = listChartTypes();
console.log(`${types.length} types available`);
types.forEach(t => console.log(`  ${t.name} (${t.kind}) — modules: ${t.modules.join(', ') || 'none'}`));
```

A gap found on day one is a scoping decision; the same gap found in production
is a broken promise. This is why the list is generated from the declaration, not
hand-written.

## 9. What the model sees

The model never receives your table. It receives:

- column names and types, up front — plus any `dataDescription` or
  `columns[].description` text you chose to pass. That text is yours, and it goes to
  the provider with the request, so write only what the model needs to read a column
  correctly;
- what `describe_table` returns when it asks: per column the type, null rate,
  distinct count, numeric range and median, time span, and — for low-cardinality
  columns — **up to five real sample values**;
- in ask mode, what `run_query` returns: row count, column list, and a preview of at
  most three rows;
- in present mode, what `preview_rows` returns if it asks: the **first rows of your
  table, verbatim** — at most twenty. There is no offset to page with, so asking again
  returns the same rows and a run cannot walk the table.

That is the entire channel. Row values leave your process **only** through those last
three, and each is bounded: the sample values by `sampleValues`, the query preview by
`previewRowCount`, and `preview_rows` by its own ceiling of twenty rows.

What it is *told* about the spec — also derived from the declaration, never hand-written —
is decisive for one class of mistake. The submit tool's description carries the channel
roles (`x = category, y = measure, y2 = measure, …`), and each channel property says what it
is for, because a model that reads `chart.orientation: 'horizontal'` as a reason to swap the
data channels writes a spec that validates and draws nothing. The wording, the schema and the
compiler all read `CHART_TYPES`, so a role is stated once and enforced by the same fact.

Know what a *count* bound means for a small table: present mode exists for results that
are already aggregated, so a table of twenty rows or fewer can be previewed whole. The
ceiling stops the model pulling a large table; it does not stop it seeing a small one.
That is a deliberate trade — the rows in question are about to be drawn on screen — but
it is a trade, not an accident.

If the sample values are a problem in your domain, switch them off:

```ts
const chartwright = createChartwright({ llm, profile: { sampleValues: 0 } });
```

That switch covers `describe_table` only. It does **not** turn off `preview_rows`,
which has no off switch today. If you need the preview to be zero, that is a decision
to make deliberately rather than by setting a profiling option; both it and the
reasoning are recorded in `docs/roadmap.md`.

## 10. Budgets are yours to set

Out of the box the library imposes **no limits** — it is a library, not a policy
engine. If you want guard rails:

```ts
await chartwright.ask({ query, rows, budget: { maxRounds: 8, maxToolCalls: 12 } });
```

If a run passes 12 rounds without a limit set, the loop emits a `warning` event
but keeps going. A model that talks without ever calling `submit_spec` is stopped
after one nudge and reported as `AgentGaveUpError` (its own words are on
`.explanation`), so `ask()` always terminates.

## 11. Troubleshooting

| Symptom | Cause |
|---|---|
| `llm proxy failed (502)` | The proxy is not running, or `LLM_API_KEY` is unset |
| `llm proxy failed (401/403)` | Wrong key, or an endpoint that is not OpenAI-compatible |
| The model never calls a tool | The provider does not implement function calling |
| `AgentGaveUpError` | The request cannot be answered with these columns; the model's explanation is in `.explanation` |
| `TS5097` on `./x.ts` | Add `allowImportingTsExtensions` (step 3) |
| Vite error about pre-bundling | Add `optimizeDeps.exclude: ['chartwright']` (step 3) |
| `the table has more than one row for category 'X'` | The plan charted unaggregated rows; the model is told to add an `aggregate` step |
| `"limit: N" follows an aggregate with no "sort" in between` | "Top N" without an ordering; the model is told to sort first |
| `sort field 'X' is not in the table` | A typo'd column the model invented |
| `encoding field 'X' (encodings.y) is not a numeric measure` | A text column on a measure channel — usually the x/y channels reversed for a horizontal bar. The model is told, names the channel, and swaps them; if it persists, the model is ignoring the contract |
| `the measure 'X' is empty for category 'Y'` | A pie was asked for over a table with a gap in its measure. A slice is a share of a whole, so there is no honest way to draw a missing one |

## 12. API surface at a glance

```ts
// The agent layer
createChartwright(options)            // → { ask(request) }
runAgentLoop(options)                 // the loop on its own, if you want to drive it
AgentGaveUpError                      // thrown when the model cannot produce a chart
buildSystemPrompt(mode?) / buildUserPrompt(query, dataset)   // inspect what it sends
buildToolDefs(mode)                   // the tool surface of a run: 'ask' or 'present'

// The deterministic layer (no LLM involved)
compileToHighcharts(spec, rows)       // → { options, dataset, warnings }
materialize(spec, rows)               // → the table the plan produces
applyTransform(rows, steps)           // the engine, step by step
findCategoryCollision(rows, encodings) // two rows competing for one category, as data
isSupportedChartType(type) / SUPPORTED_CHART_TYPES
listChartTypes()                      // the support matrix as data: kind, channels,
                                      // modifiers, modules, colour roles, per type
resolveAvailableTypes(names) / resolveCapabilities(source)  // the capability handshake

// The local tools (usable without the agent, if you want your own orchestration)
describeTable(rows, options?, declared?)  // profile: aggregates only
previewRows(rows, { limit })          // the first rows, bounded
runQuery(rows, steps, options?)       // → { table, summary }
createToolHandlers(context)           // name → handler, bound to one dataset
applyColumnDescriptions(inferred, declared) // the caller's word on its own columns
TOOL_DEFS                             // the natural-language tool schemas
inferColumns(rows)                    // names + types, no values
binDate(value, granularity)
```

## Next steps for consumers

- Read the example: [`examples/react-highcharts`](../examples/react-highcharts).
- If you need a colour or a chart type that is not supported yet, open an issue
  rather than working around it — the boundaries are deliberate and visible.
