# example: React + Highcharts

A working app that shows how chartwright is used: load rows, ask a question in
plain language, watch the agent investigate, render the returned options.

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

## What is here

| Path | What it is |
|---|---|
| `data/post-trade.json` | 800 synthetic post-trade records |
| `data/counterparty-summary.json` | A `GROUP BY counterparty` result of those records — a consumer's already-aggregated table |
| `data/monthly-activity.json` | The same, `GROUP BY month` |
| `scripts/generate-data.mjs` | Deterministic generator (fixed seed); no real trades or identifiers |
| `src/data.ts` | Loads all three |
| `src/App.tsx` | The integration: build a client, call `ask()`, render `result.options` |
| `src/llm/browserClient.ts` | Keyless browser-side `LlmClient` |
| `server/proxy.mjs` | Node proxy that holds the key and normalises the provider dialect |
| `server/proxy.test.mjs` | Tests for that translation (stubbed provider, no network) |
| `src/components/ChartView.tsx` | Thin imperative Highcharts wrapper — one options object in, one chart out |

`counterparty-summary.json` and `monthly-activity.json` exist because they are the
case a chart library usually gets wrong. They are **final numbers**: already grouped,
already ranked by the caller's own `ORDER BY`, and carrying columns that
re-aggregating would corrupt — an average, a distinct count, a maximum, a ratio.
`npm run gen:data` prints what re-aggregating each one would do to it.

## What the app shows after a request

The page has **four demos**, and they differ in what they hand over:

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

Both then show:

- **progress events** as the agent works (rounds, tool calls, results) — this is
  why a non-streaming client still never leaves the user staring at nothing;
- the **chart**, from `result.options`;
- a **query tool** verdict, read off `result.trace`: `not called`, `refused ×n`, or
  `ran ×n`. In the present demo it should never say `ran`;
- the **dataset that was plotted** (`result.dataset`) — bound into the chart here, in
  this tab. The model never received it as a payload; at most it saw a preview of the
  first rows, and what else leaves is a profile of the columns;
- the **neutral spec** (`result.spec`), replayable without the model;
- the **tool trace** (`result.trace`).

Follow-up questions reuse `result.messages` and `result.sessionId`: the library is
stateless, so the app carries the conversation.

## The data is synthetic

Real post-trade data is proprietary and often carries regulated identifiers, so
this example ships a **generated** dataset with a fixed seed. The ISIN-like codes
are random and are not real securities identifiers.

One modelling choice is worth knowing about, because a chart can make it visible:
counterparty flow is **not** uniform. A few dealers dominate and the rest are a long
tail (the top three hold about 57% of the trades, the smallest has nine), which is
what the real thing looks like and what makes a grouped table's averages differ from
the whole table's.
