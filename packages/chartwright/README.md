# chartwright

> Ask for a chart in plain language. Get chart-library options back. No server, and no new place for your data to go.

chartwright turns a natural-language request plus your in-memory rows into a chart that you render with the library you already ship.

- **An agentic loop** — you inject the LLM client, so the key stays yours — resolves the ambiguous parts the way a person would: it inspects your data first, through a small closed set of **local** tools (column cardinality, top-k, numeric spread, time granularity, null rate). Only compact **aggregate summaries** ever reach the model; your rows never do.
- **A deterministic compiler** does the rest: it executes the spec's declarative transform plan over your **full** dataset, validates the result, and emits **Highcharts options with the data already bound**.

The dataset is bound by the compiler rather than by the model, so the chart is exact even though the model only ever saw a summary.

## Install

```bash
npm install chartwright highcharts
```

chartwright has **no runtime dependencies** — Highcharts is your dependency, and you choose its version.

## Quickstart

```ts
import { createChartwright } from 'chartwright';
import Highcharts from 'highcharts/esm/highcharts.js';
import type { LlmClient } from 'chartwright';

// 1. A client that holds no credentials — post to your own endpoint.
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
});

Highcharts.chart(container, result.options);
```

## Two modes

- **Default (`ask`)** — you hand over a table and a question. The model profiles the data, runs declarative queries over it, and submits a spec.
- **`present: true`** — you hand over rows you have already aggregated and ordered. The model chooses how to draw them and nothing else: `result.dataset` is your rows, in your order, unchanged.

## Design commitments

- **The model never writes chart-library config.** That is the compiler's job, and the compiler is deterministic and replayable.
- **The model never does arithmetic.** "Highlight the largest bar" is expressed as intent (`top_k: 1`); the compiler evaluates it against the real data, so the highlight stays correct when the data changes.
- **Two views of one dataset, never conflated.** The model gets a *budgeted summary*; the chart gets the *complete table*.
- **Your data stays in your process.** The only thing that leaves is what your tools choose to return.
- **The spec is an auditable artifact.** `compileToHighcharts(result.spec, rows)` reproduces the same chart without calling the LLM again.

## Supported chart types

14 types today. Ask the library rather than trusting a list:

```ts
import { listChartTypes } from 'chartwright';
listChartTypes();   // name, kind, required channels, modifiers, modules, colour roles
```

| Kind | Types |
|---|---|
| Categorical | `bar`, `line`, `spline`, `area`, `areaspline`, `columnrange`, `arearange`, `areasplinerange`, `errorbar`, `dumbbell` |
| Part-to-whole | `pie` |
| Matrix | `heatmap` |
| Point-cloud | `scatter`, `bubble` |

Plus chart-level modifiers: `stacking`, `polar`, `hole`, `compact`, `type2` (dual-axis combo), and `axes.*.kind` / `axes.*.range`.

**Some types need a Highcharts module.** `listChartTypes()` reports which, per type. Under a bundler, import the **ESM** builds — Highcharts 12 has no `exports` field, so the UMD paths create a second Highcharts instance and fail at render time:

```ts
import Highcharts from 'highcharts/esm/highcharts.js';
import 'highcharts/esm/highcharts-more.js';   // bubble + range family
import 'highcharts/esm/modules/heatmap.js';   // heatmap
import 'highcharts/esm/modules/coloraxis.js'; // heatmap
```

## Status

**0.1.0-alpha.** The boundary is known and queryable; the API may still change. 14 of a committed ~36 chart types are implemented — the full list, what is planned, and what is deliberately refused are documented in [`docs/using-chartwright.md`](https://github.com/yuqisun/chartwright/blob/main/docs/using-chartwright.md).

Highcharts is the first target backend. The spec is library-agnostic by design; a second backend is what would prove it.

## Versioning

Semantic Versioning, with the usual pre-1.0 reading: **while the major version is 0, a
minor bump may contain a breaking change.** Concretely, until `1.0.0`:

| Change | Version bump |
|---|---|
| A breaking change to an exported signature, or a removed export | minor (`0.2.0`) |
| A new chart type, channel, modifier or option | minor (`0.2.0`) |
| A bug fix, or a change to emitted options that no reasonable consumer depends on | patch (`0.1.1`) |
| Pre-release iterations of the above | `-alpha.N`, published under the `alpha` dist-tag |

What will **not** change without a major bump, because consumers build on them:

- the shape of `AskResult` and `CompiledChart`;
- the meaning of an existing channel (`x`, `y`, `series`, …);
- `compileToHighcharts` being deterministic and free of I/O — the property that makes a
  spec an auditable artifact;
- the guarantee that all new fields are optional, so an existing spec keeps compiling.

Alpha releases are published with `npm publish --tag alpha`, so `npm install chartwright`
never resolves to one until `latest` is pointed at a stable version.

Every release is listed in [`CHANGELOG.md`](./CHANGELOG.md).

## Documentation

- [`docs/using-chartwright.md`](https://github.com/yuqisun/chartwright/blob/main/docs/using-chartwright.md) — the consumer guide: wiring, themes, layout, budgets, troubleshooting, the full API surface.
- [`examples/react-highcharts`](https://github.com/yuqisun/chartwright/tree/main/examples/react-highcharts) — a working React app, with a ~60-line LLM proxy that keeps the provider key on the server.

## License

MIT
