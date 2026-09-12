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
| A chart library to render with | Today the compiler emits Highcharts options (bar / line / pie) |
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

## 7. Supported today

`chart.type` accepts **`bar`**, **`line`**, **`pie`**. Anything else is rejected
with a clear error — and because the rejected spec goes back to the model inside
the loop, it usually retries with a supported type rather than failing. A wrong
chart is never produced silently.

Known expressiveness boundaries (they return a warning rather than a lie):

- emphasis has **semantic tones only** (`highlight` / `muted`) — you cannot ask
  for a specific colour yet;
- emphasis can select the **top/bottom k (contiguous)**, value thresholds and
  named categories — not arbitrary ranks like "the 1st and 3rd";
- sorting is the plan's job: "the largest 5" **must** sort before limiting, and a
  plan that does not is refused.

## 8. What the model sees

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

## 9. Budgets are yours to set

Out of the box the library imposes **no limits** — it is a library, not a policy
engine. If you want guard rails:

```ts
await chartwright.ask({ query, rows, budget: { maxRounds: 8, maxToolCalls: 12 } });
```

If a run passes 12 rounds without a limit set, the loop emits a `warning` event
but keeps going. A model that talks without ever calling `submit_spec` is stopped
after one nudge and reported as `AgentGaveUpError` (its own words are on
`.explanation`), so `ask()` always terminates.

## 10. Troubleshooting

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

## 11. API surface at a glance

```ts
// The agent layer
createChartwright(options)            // → { ask(request) }
runAgentLoop(options)                 // the loop on its own, if you want to drive it
AgentGaveUpError                      // thrown when the model cannot produce a chart
buildSystemPrompt() / buildUserPrompt(query, dataset)   // inspect what it sends

// The deterministic layer (no LLM involved)
compileToHighcharts(spec, rows)       // → { options, dataset, warnings }
materialize(spec, rows)               // → the table the plan produces
applyTransform(rows, steps)           // the engine, step by step
isSupportedChartType(type) / SUPPORTED_CHART_TYPES

// The local tools (usable without the agent, if you want your own orchestration)
describeTable(rows, options?)         // profile: aggregates only
runQuery(rows, steps, options?)       // → { table, summary }
createToolHandlers(context)           // name → handler, bound to one dataset
TOOL_DEFS                             // the tool schemas the model is given
inferColumns(rows)                    // names + types, no values
binDate(value, granularity)
```

## Next steps for consumers

- Read the example: [`examples/react-highcharts`](../examples/react-highcharts).
- If you need a colour or a chart type that is not supported yet, open an issue
  rather than working around it — the boundaries are deliberate and visible.
