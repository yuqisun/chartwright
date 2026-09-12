# Using chartwright in your own app

This is the consumer-facing guide: what you need, how to wire it up, and what you
get back. `examples/react-highcharts` is the same instructions with working code
around them.

> **Status: 0.0.0, source-only.** The package is not on npm yet, so you consume it
> by pointing at the source (below). That changes to `npm install chartwright`
> once it is published, and the two config tweaks in step 3 disappear with it —
> that is the only part of this document that will need revising.

## What you need

| | Why |
|---|---|
| Rows in memory | chartwright compiles *your* data in *your* process; it never fetches anything |
| A chart library to render with | Today the compiler emits Highcharts options (bar / line / spline / area / areaspline / pie, plus stacking, polar, donut holes and sparklines) |
| An LLM that supports **tool calling** | The agent loop uses `tools` / `tool_calls` (function calling). Any OpenAI-compatible endpoint works — if it does not implement tool calling, the loop cannot run |
| Somewhere safe for the API key | **Not the browser.** A page holding a provider key leaks it to anyone with DevTools, and most providers disallow browser calls outright. Use your own backend endpoint (a ~60-line proxy; see step 4) |

You do **not** need: a database, a server for chartwright itself, a build step
for the library, or any runtime dependency — the package has none.

## 1. Get the source

```bash
git clone https://github.com/yuqisun/chartwright.git
# or download the repository zip
```

You only need `packages/chartwright`. Copy it next to your project (or keep the
clone and reference it in place):

```
your-app/
  package.json
  src/
my-deps/
  chartwright/          # copied from packages/chartwright
```

## 2. Add the dependency

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

There is nothing else to install: the package declares **no dependencies**.

## 3. Two config tweaks

While the package is consumed as TypeScript source, two settings are required in
your app. Both exist because the library's internal imports carry `.ts`
extensions (so its own tests can run without a build step).

```ts
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ['chartwright'] },   // let Vite transform its TS source
});
```

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,   // the library imports './x.ts'
    "noEmit": true                        // implied by the flag above
  }
}
```

Missing the first gives a dependency pre-bundling error; missing the second gives
`TS5097: An import path can only end with a '.ts' extension when
'allowImportingTsExtensions' is enabled`.

## 4. Give it an LLM, without giving it your key

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

## 5. Wire it up

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
(right) axis with its own title. Series are named after their measure field so
emphasis on one cannot style the other.

**The risk:** independently scaled axes can be made to show any correlation. The
compiler will never volunteer a dual-axis chart; it draws one only when the spec
explicitly asks for `y2`. Both axes are always titled with their field name,
because two units need two labels and an unlabelled axis is an invitation to
misread.

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

## 6. Two modes: chart a question, or chart a result

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

## 7. What you get back

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

## 8. Supported today

`chart.type` accepts **`bar`**, **`line`**, **`spline`**, **`area`**, **`areaspline`**,
**`pie`** and **`heatmap`**. Anything else is rejected with a clear error — and because the
rejected spec goes back to the model inside the loop, it usually retries with a supported
type rather than failing. A wrong chart is never produced silently.

Five chart-level modifiers change how one of those is drawn rather than what it is:

| Modifier | What it does | Honoured by |
|---|---|---|
| `chart.stacking: 'normal' \| 'percent'` | stack the series; `percent` rescales each category to 100 | bar, line, spline, area, areaspline |
| `chart.polar: true` | wrap the axes around a circle — a radar with a line, a rose with bars | the same five |
| `chart.hole: 0..1` | the hole that makes a pie a donut | pie |
| `chart.compact: true` | drop title, axes and legend, keeping the marks: a sparkline | any type |
| `axes.y.range: { min?, max? }` | a fixed scale, when it is a fact about the measure rather than about these rows | any banded type |

A modifier a type cannot mean is **refused, not ignored**: `stacking` on a pie comes back
as an error naming what the type does honour, because a stacked pie would draw an unstacked
one and say nothing. The set is declared per type in `packages/chartwright/src/compile/chart-types.ts`,
which is also where the list above comes from — every other list in the library and these
docs is derived from it.

### The one type that needs a module

`heatmap` is the exception to "there is nothing to load": Highcharts keeps it in a module, so a
page that imports only `highcharts` cannot draw one — and the failure happens at render time in
**your** process, not in ours.

**Under a bundler, import the ESM builds — both ends of the pair:**

```ts
import Highcharts from 'highcharts/esm/highcharts.js';
import 'highcharts/esm/modules/heatmap.js';   // brings coloraxis in with it
import 'highcharts/esm/modules/coloraxis.js'; // explicit, and harmless: ESM dedupes it
```

**Why, because the obvious version is a trap.** Highcharts 12 ships two builds and its
`package.json` has no `exports` or `module` field to steer a bundler to the right one, so both
`highcharts` and `highcharts/modules/heatmap` resolve to the **UMD** files. Under Vite that cost us
two bugs in a row, neither of them at build time:

1. importing only `highcharts` and asking for a heatmap throws Highcharts error 17
   (`missingModuleFor=heatmap`) *at render time* — inside a React effect, which unmounted the whole
   showcase page rather than one card;
2. importing `highcharts/modules/heatmap` on top of that did **not** fix it. The import threw
   `Cannot read properties of undefined (reading 'Axis')` before any chart existed, because the
   pre-bundled module and the app's core were two different Highcharts objects and the module
   registered on the wrong one.

The ESM pair is what works, because `highcharts/esm/modules/heatmap.js` imports the ESM core, so
both ends are one instance — verified in a browser: the example draws 22 of 22 charts, heatmap
included. If you inline the UMD scripts as `<script>` tags instead of bundling, none of this
applies: classic scripts share one global, which is how this repository's own render matrix loads
them.

Rather than take our word for which modules, ask the library — the answer is generated from the
same declaration the compiler uses, and a test checks that every path it names exists in the
installed package:

```ts
import { listChartTypes } from 'chartwright';
listChartTypes();   // [{ name: 'heatmap', kind: 'matrix', requires: ['x','series','y'],
                    //    honours: ['compact'], modules: [...] }, ...]
```

A heatmap's three channels are the ones a bar chart already uses, read differently: `x` is the
column, `series` the row, and `y` is drawn as colour instead of height. That is why it needed no
new channel — only a type that says what the channels mean. One consequence is worth knowing:
on a heatmap the colour *is* the value, so `emphasis` highlights with a border rather than a fill.

Known expressiveness boundaries (they return a warning rather than a lie):

- emphasis has **semantic tones only** (`highlight` / `muted`) — you cannot ask
  for a specific colour yet;
- emphasis can select the **top/bottom k (contiguous)**, value thresholds and
  named categories — not arbitrary ranks like "the 1st and 3rd";
- sorting is the plan's job: "the largest 5" **must** sort before limiting, and a
  plan that does not is refused;
- **a date column is a category.** There is no `datetime` axis: the x axis is spaced
  evenly whatever the dates say. For a monthly series with every month present that
  changes nothing; for one with a gap it draws the gap as though it were not there. That
  is a decision rather than an omission, and `docs/roadmap.md` item 21 carries the cost
  and what would justify revisiting it.

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
