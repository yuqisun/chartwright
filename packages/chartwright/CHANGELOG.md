# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) — with the pre-1.0 caveat
spelled out under [Versioning](#versioning) in the README.

## [Unreleased]

Nothing yet.

## [0.1.0-alpha.0] - 2026-09-13

The first published build. It exists to make the library installable and to put the
boundary where a consumer can see it, not to claim completeness: 14 of a committed ~36
chart types are implemented, and `listChartTypes()` reports exactly which.

### Added

**The pipeline**

- `createChartwright({ llm, ... })` → `ask({ query, rows, ... })`: an agentic loop that
  inspects your rows through local tools and submits a neutral chart spec, which a
  deterministic compiler turns into Highcharts options with the data already bound.
- `present: true` mode: chart a table you have already aggregated and ordered, with the
  model choosing only how to draw it. `result.dataset` is your rows, in your order,
  unchanged.
- `compileToHighcharts(spec, rows)` and its companions (`materialize`, `applyTransform`,
  `findCategoryCollision`, `binDate`) as the deterministic layer, usable with no LLM at all.
- Local profiling and query tools (`describeTable`, `previewRows`, `runQuery`,
  `createToolHandlers`, `inferColumns`, `applyColumnDescriptions`) usable without the loop.

**Chart types — 14**

- Categorical (10): `bar`, `line`, `spline`, `area`, `areaspline`, `columnrange`,
  `arearange`, `areasplinerange`, `errorbar`, `dumbbell`
- Part-to-whole (1): `pie`
- Matrix (1): `heatmap`
- Point-cloud (2): `scatter`, `bubble`

**Modifiers and channels**

- `chart.stacking` (`normal` | `percent`), `chart.polar`, `chart.hole`, `chart.compact`.
- Dual-axis combo: `encodings.y2` + `chart.type2`, with both axes titled and series named
  after their measure field so emphasis on one measure cannot style the other.
- Range channels: `encodings.low` / `encodings.high`.
- `encodings.size` for bubble.
- `axes.x.kind` / `axes.y.kind` (`band` | `linear` | `log`), inferred from the channel role
  by default; `axes.y.range` and `axes.y2.range` for a fixed scale.

**Presentation**

- A theme layer of roles (`surface`, `text`, `structure`, `series`, `emphasis`) rather than
  presets, injectable at `createChartwright` and deep-merged, so a partial override cannot
  leave a role unresolved. Series colours never cycle — more series than palette entries
  take the overflow role instead of repeating a colour.
- Layout derivation: label rotation and font size computed from category count against a
  reference plot width (`layout.plotWidth`), never silently crowded. When labels cannot fit
  even at the tightest band, the compile warns and draws everything anyway.
- Emphasis with semantic tones (`highlight` / `muted`), evaluated by the compiler against
  the real data rather than chosen by the model.

**Boundary and safety**

- `listChartTypes()` — the support matrix as data: each type with its kind, required
  channels, honoured modifiers, Highcharts modules and colour roles, so a consumer can
  query what it actually got at integration time.
- Capability handshake: `capabilities` narrows the offered types to what your bundle can
  draw, with `resolveAvailableTypes` / `resolveCapabilities` exposed for custom sources.
- Custom `ChartwrightOptions.theme` and `ChartwrightOptions.layout`, fixed per consumer so
  one request cannot change how the same spec looks.

### Packaging

- The published artifact is `dist/` (ESM + `.d.ts` + source maps), built by
  `npm run build`. The package entry previously pointed at TypeScript source, which Node
  refuses to load from `node_modules`
  (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) — that is fixed here, and `pack:check`
  now installs the packed tarball into a scratch project and imports it with plain `node`
  to prove it stays fixed.
- Zero runtime dependencies. Highcharts is the consumer's dependency and version choice.
- `listChartTypes` is now actually reachable from the package entry point; it was
  documented and implemented but not exported, which the packaging test caught.

### Requested through the agent loop

- Range types (5 of the 14) could not be produced by `ask()`: the submit schema required
  `encodings.y` and the assembler hardcoded the same check, so a spec using `low`/`high`
  was rejected before compilation. Direct `compileToHighcharts` calls were unaffected,
  which is why the unit tests did not see it.

### Known gaps

Carried deliberately, and recorded rather than discovered:

- **36 chart types is the commitment; 14 exist.** `waterfall`, `boxplot`, `bullet`,
  `gauge`, `funnel`, `lollipop`, `streamgraph` and the rest are planned in P2; the
  hierarchy, flow and statistical families are triggered by demand; the OHLC and Gantt
  families are licence-gated. Geo/maps, `venn` and `item`/`pictorial` are refused.
- **No datetime axis.** A date column is a category, so a missing month draws as though it
  were never there.
- **Emphasis has semantic tones only** — no arbitrary colour, and no non-contiguous rank
  selection ("the 1st and 3rd").
- **Highcharts is the only backend.** The spec is library-agnostic by design; a second
  backend is what would demonstrate it.

[Unreleased]: https://github.com/yuqisun/chartwright/compare/v0.1.0-alpha.0...HEAD
[0.1.0-alpha.0]: https://github.com/yuqisun/chartwright/releases/tag/v0.1.0-alpha.0
