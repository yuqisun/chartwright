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
npm run verify        # the whole gate: build, typecheck, all tests, showcase check, pack:check
npm test --workspace chartwright          # unit tests (node:test, no test framework dependency)
npm run dev                               # the example app: http://localhost:5173
npm run render                            # draw every corpus case in a real browser
```

Node 22.6+ is required. Two things are worth knowing about how this repository runs
TypeScript:

- **Tests run the source directly**, via node's type stripping — no build, no test framework.
  The library keeps to erasable TypeScript syntax so that stays possible.
- **Consumers get a build.** `npm run build:lib` emits `dist/` (ESM + `.d.ts`), and the
  package's `exports` point there, because node refuses to strip types for files under
  `node_modules`. The source keeps `.ts` extensions in its internal imports and
  `rewriteRelativeImportExtensions` turns them into `.js` on the way out.
- The example app depends on that build, so root `dev`/`build`/`verify` run `build:lib` first.

## Status

**0.1.0-alpha.** Published and installable; the boundary is known and queryable, and the API
may still change. 14 of a committed ~36 chart types are implemented — what exists, what is
planned and what is deliberately refused are all listed in
[`docs/using-chartwright.md`](docs/using-chartwright.md).

```bash
npm install chartwright@alpha highcharts
```

Highcharts is the first target backend. The spec is library-agnostic by design; a second
backend is what would prove it.

## Releasing

The publish target is declared in `packages/chartwright/package.json` (`publishConfig.registry`),
not inherited from the machine's npmrc — a mirror such as `registry.npmmirror.com` is read-only
and cannot accept a publish, so relying on the ambient config means `ENEEDAUTH` against a registry
that was never going to work.

```bash
# Once per machine. Note the explicit registry: `npm login` alone goes to whatever the
# default is, which on a mirror-configured machine is not where you can publish.
npm login --registry=https://registry.npmjs.org
npm whoami  --registry=https://registry.npmjs.org

npm run verify                                     # includes pack:check
npm publish --tag alpha --workspace chartwright    # targets npmjs via publishConfig
git push origin main --tags
```

`pack:check` is the gate that matters most here: it packs the tarball, installs it into a
scratch project, and imports it with **plain node** — no flags, no bundler, no build step.
Every other check in this repository imports from source, so that one is the only check that
sees what a consumer sees.

`--tag alpha` is deliberate: `latest` stays unset, so `npm install chartwright` cannot resolve
to a pre-release. Consumers opt in with `npm install chartwright@alpha`.

## Prior art

Built on ideas from two MIT-licensed projects:

- [flint-chart](https://github.com/microsoft/flint-chart) — semantic chart specs plus deterministic multi-backend compilation.
- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) — agent loop, tool runtime, and tool-output retention.

Where a design is borrowed, the source and the reason are noted in the code next to it.

## License

MIT
