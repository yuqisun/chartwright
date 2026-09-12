# example: React + Highcharts

A working app that shows how chartwright is used: load rows, ask a question in
plain language, watch the agent investigate, render the returned options.

The page has **three zones**, and the split is the point: a demo that can only be seen
by spending tokens is a demo nobody looks at, so the library's surface is shown without a
model in the loop, and the model is shown separately where its behaviour is the subject.

| Zone | What it shows | Needs a key? |
|---|---|---|
| **Supported today** | Every declared chart type, drawn from options compiled into the page. Each card carries the input, the data, the mode and what to expect | **No** |
| **The boundary** | The shapes with no type yet, and the ones the compiler refuses today, each with what it is waiting for | **No** |
| **Run the agent** | The real thing: a model investigating a table with local tools and submitting a spec | Yes |

## Run it

```bash
# from the repo root
npm install

# then, in this directory
cp .env.example .env        # and put your key in it
npm run dev                 # proxy on :8787, app on http://localhost:5173
```

`npm run dev` starts two processes: the node LLM proxy (`server/proxy.mjs`) and
Vite. If you prefer, run `npm run dev:api` and `npm run dev:web` in two terminals.

`npm run test:proxy` runs the proxy's translation tests — no network, no key.

The first two zones work without `.env` at all: they are generated, and the charts come
from options compiled at generation time, not from a model.

## Where the API key lives

**In the node process only.** The browser never holds a credential:

```
browser (React)                 node (server/proxy.mjs)              provider
  │  POST /api/llm ───────────▶  reads LLM_API_KEY from .env
  │  { messages, tools }          adds Authorization ──────────────▶
  │  ◀── { content, toolCalls } ◀──────────────────────────────────
```

- The page calls its own origin, so there is no CORS problem to negotiate.
- The key is never bundled, never in DevTools, and never returned by `/api/llm`.
- Any OpenAI-compatible endpoint works (`LLM_BASE_URL`).
- `src/llm/browserClient.ts` is the whole browser-side client — around 20 lines,
  with no credentials in it.

In production this proxy is a route in your own backend; the shape does not change.

## Regenerating the showcase

`data/showcase.json` is generated, never hand-written:

```bash
npm run showcase            # rewrites examples/react-highcharts/data/showcase.json
npm run showcase -- --check # fails if the committed file is stale
```

It is built from the corpus (`packages/chartwright/test/fixtures/corpus.ts`) and the real
compiler, so the page cannot drift from what the library does: the queries, the data, the
modes, the expectations and the compiled options all come from that one file. The generator
**refuses to run** if a declared chart type is not represented, which is what makes "this
page shows every supported type" a property rather than a claim.

`npm run verify` runs the `--check`, the library's tests, and a typecheck of this example,
so a corpus or compiler change that the page has not been rebuilt for fails in CI.

## What is here

| Path | What it is |
|---|---|
| `data/post-trade.json` | 800 synthetic post-trade records |
| `data/counterparty-summary.json` | A `GROUP BY counterparty` result of those records — a consumer's already-aggregated table |
| `data/monthly-activity.json` | The same, `GROUP BY month` |
| `data/cancellations-by-month.json` | `GROUP BY month` again, but sparse: only the months that had a cancellation |
| `data/showcase.json` | **Generated** — the three zones' cases, their data and their compiled options |
| `scripts/generate-data.mjs` | Deterministic generator (fixed seed); no real trades or identifiers |
| `src/data.ts` | Loads the datasets |
| `src/demos.ts` | The four interactive demos, each preset with what it should come back with |
| `src/showcase.ts` | Types the generated file, and the page's own check on the compiled options |
| `src/ui.tsx` | The few shared primitives (badge, table, field, disclosure) |
| `src/App.tsx` | The page: header, supported zone, boundary zone, agent zone |
| `src/components/ShowcaseCard.tsx` | One supported case |
| `src/components/BoundarySection.tsx` | The shapes that are not drawn above, and why |
| `src/components/AgentDemo.tsx` | The interactive half: `ask()`, progress, results |
| `src/components/ChartView.tsx` | Thin imperative Highcharts wrapper — one options object in, one chart out |
| `src/llm/browserClient.ts` | Keyless browser-side `LlmClient` |
| `server/proxy.mjs` | Node proxy that holds the key and normalises the provider dialect |
| `server/proxy.test.mjs` | Tests for that translation (stubbed provider, no network) |

`counterparty-summary.json` and `monthly-activity.json` exist because they are the
case a chart library usually gets wrong. They are **final numbers**: already grouped,
already ranked by the caller's own `ORDER BY`, and carrying columns that
re-aggregating would corrupt — an average, a distinct count, a maximum, a ratio.
`npm run gen:data` prints what re-aggregating each one would do to it.

## What the supported zone shows

Twenty-one cases, each a card carrying six things: the query a person would type, the
dataset it runs on (with its rows a click away), the mode it runs in **and why**, what the
data stresses, what you should see, and the chart itself. The badge in each corner is the
page checking the compiled options against the count the corpus states — a card that drew
the wrong shape says so. The browser-rendered version of that check runs in CI
(`scripts/render-matrix.ts`).

Between them the cards cover the six declared types (bar, line, spline, area, areaspline,
pie), the five chart-level modifiers (stacking, polar, a donut hole, compact sparklines, a
fixed y range), and the shapes that break naive implementations: sixty categories against
a fixed axis, four labels far wider than their bands, a month missing from a series, a null
next to a real zero, signed values, and a single-row table.

## What the boundary zone shows

The shapes a consumer will ask for that are not drawn above: a second axis for two
measures of different units, a point cloud, a range or box per group, flow between venues,
two grouping levels. Each says whether the compiler refuses it today or whether no declared
type can express it, what it is waiting for, and — where a nearby type does compile — what
that costs. The dual-axis case is the clearest: it compiles only if you drop a measure, and
the card names the column that disappears.

The thinking behind putting this on the page rather than in a roadmap: a gap found here is
a scoping decision, and the same gap found in production is a broken promise.

## What the agent zone shows

Four demos, and they differ in what they hand over. Each says which dataset it hands over,
how many rows, and which mode — and every preset says what it should come back with, so a
wrong answer is visible rather than plausible.

- **Ask the data** — 800 raw executions, the model investigates with tools and shapes the
  table with a query plan;
- **Present a result** — a twelve-row table a query already produced: grouped, ranked,
  carrying an average and a distinct count. The model chooses how to draw it and has no
  tool that could change it (`present: true`);
- **Present a time series** — six monthly rows from the same kind of query, where the
  column that matters is an average: a second pass over it would be wrong by an amount
  too small to see, which is the whole argument for the mode;
- **Present gapped dates** — five monthly rows, and one month is missing because nothing
  was cancelled in it. There to be looked at rather than admired: a date column is drawn
  as a *category* axis here — a decision, not an oversight — so five months that are 31,
  28, 31 and **61** days apart are drawn as five equal steps, and nothing on the chart
  says a month went by. See `docs/roadmap.md` item 21 for the decision and its cost.

After a request it shows:

- **progress events** as the agent works (rounds, tool calls, results) — this is
  why a non-streaming client still never leaves the user staring at nothing;
- the **chart**, from `result.options`;
- a **query tool** verdict, read off `result.trace`: `not called`, `refused ×n`, or
  `ran ×n`. In the present demos it should never say `ran`;
- the **dataset that was plotted** (`result.dataset`) — bound into the chart here, in
  this tab. The model never received it as a payload; at most it saw a preview of the
  first rows, and what else leaves is a profile of the columns;
- the **neutral spec** (`result.spec`), replayable without the model;
- the **tool trace** (`result.trace`) and any warnings.

Follow-up questions reuse `result.messages` and `result.sessionId`: the library is
stateless, so the app carries the conversation.

The client is configured with `capabilities: ['bar', 'line', 'pie']`. This app can draw
every declared type, so it is the full set — the interesting part is the shape: the panel
the model is offered is built from what the consumer says its bundle can render, so a
deployment that shipped fewer Highcharts modules would list fewer types, and the model
would never be offered a chart that cannot render.

## The data is synthetic

Real post-trade data is proprietary and often carries regulated identifiers, so
this example ships a **generated** dataset with a fixed seed. The ISIN-like codes
are random and are not real securities identifiers.

One modelling choice is worth knowing about, because a chart can make it visible:
counterparty flow is **not** uniform. A few dealers dominate and the rest are a long
tail (the top three hold about 57% of the trades, the smallest has nine), which is
what the real thing looks like and what makes a grouped table's averages differ from
the whole table's.
