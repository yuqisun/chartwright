# chartwright

> Ask for a chart in plain language. Get chart-library options back. No server, and no new place for your data to go.

chartwright turns a natural-language request plus your in-memory rows into a chart that you render with the library you already ship.

An **agentic loop** — you inject the LLM client, so the key stays yours — resolves the ambiguous parts the way a person would: it inspects your data first, through a small closed set of **local** tools (column cardinality, top-k, numeric spread, time granularity, null rate). Only compact **aggregate summaries** ever reach the model; your rows never do. The loop emits a **library-agnostic chart spec**, never library config.

A **deterministic compiler** does the rest: it executes the spec's declarative transform plan over your **full** dataset, validates the result, and emits **Highcharts options with the data already bound** — ready to render. The dataset is bound by the compiler rather than by the model, so the chart is exact even though the model only ever saw a summary.

## Design commitments

- **The model never writes chart-library config.** That is the compiler's job, and the compiler is deterministic and replayable.
- **The model never does arithmetic.** "Highlight the largest bar" is expressed as intent (`top_k: 1`); the compiler evaluates it against the real data, so the highlight stays correct when the data changes.
- **Two views of one dataset, never conflated.** The model gets a *budgeted summary*; the chart gets the *complete table*.
- **Your data stays in your process.** The only thing that leaves is what your tools choose to return.
- **The spec is an auditable artifact.** `applyTransform(rows, spec.transform_plan)` plus compilation reproduces the same chart without calling the LLM again.

## Layout

| Path | What it is |
|---|---|
| `packages/chartwright` | the library: neutral spec, transform engine, local tools, agent loop |
| `examples/react-highcharts` | a React + Highcharts app showing how to wire it up, over a synthetic post-trade dataset |

## Development

```bash
npm install
npm test --workspace chartwright          # unit tests (node:test, no test framework dependency)
npm run typecheck --workspace chartwright
npm run dev                               # the example app: http://localhost:5173
```

Node 22.6+ is required for the test script, which runs TypeScript directly via type stripping. The library keeps to erasable TypeScript syntax so it can be executed without a build step.

## Status

Early. **Highcharts is the first target backend**; other libraries are planned behind the same spec.

## Prior art

Built on ideas from two MIT-licensed projects:

- [flint-chart](https://github.com/microsoft/flint-chart) — semantic chart specs plus deterministic multi-backend compilation.
- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) — agent loop, tool runtime, and tool-output retention.

Where a design is borrowed, the source and the reason are noted in the code next to it.

## License

MIT
