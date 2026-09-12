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

- **progress events** as the agent works (rounds, tool calls, results) — this is
  why a non-streaming client still never leaves the user staring at nothing;
- the **chart**, from `result.options`;
- the **dataset that was plotted** (`result.dataset`) — which the model never saw;
- the **neutral spec** (`result.spec`), replayable without the model;
- the **tool trace** (`result.trace`).

Follow-up questions reuse `result.messages` and `result.sessionId`: the library is
stateless, so the app carries the conversation.

## The data is synthetic

Real post-trade data is proprietary and often carries regulated identifiers, so
this example ships a **generated** dataset with a fixed seed. The ISIN-like codes
are random and are not real securities identifiers.
