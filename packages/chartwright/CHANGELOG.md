# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) — with the pre-1.0 caveat
spelled out under [Versioning](#versioning) in the README.

## [Unreleased]

### Added

- **`emphasis` can mark the complement of a ranked set.** `{ op: 'top_k', k, field, rest: true }`
  styles the rows the ranked set *excludes*, so "highlight the top one and fade the rest" is two
  rules over one ranking:

  ```ts
  emphasis: [
    { when: { op: 'top_k', k: 1, field: 'notional_usd' }, style: { tone: 'highlight' } },
    { when: { op: 'top_k', k: 1, field: 'notional_usd', rest: true }, style: { tone: 'muted' } },
  ]
  ```

  There was no way to express the complement before. The one construction that worked was an
  always-true threshold (`gte: 0`) — a fact about a measure's sign, where a threshold at a real
  bound is a value the model is forbidden to look up — so a model asked to fade the rest reached
  for the nearest thing the schema offered, a *larger* `top_k`. `top_k` counts from the top: on a
  twelve-row table `k: 11` faded ranks 1-11, including the winner an earlier rule had just
  highlighted, and left rank 12 as the only default-coloured bar — a picture of the opposite of
  what was asked, with `warnings: []`, because neither rule was wrong on its own. The complement
  is taken over the same threshold and the same ties as the rule it mirrors, so the pair
  partitions the rows exactly. `rest` outside `top_k` is refused rather than ignored, and an
  empty complement warns.

### Fixed

- **A measure channel must hold numbers, and now says so.** A text column on `encodings.y`
  (or `y2`, `size`, `low`, `high`, or a point cloud's `x`) used to reach `Number()`, become
  `NaN`, serialise to `null`, and draw a chart with axes, a title and **no marks** — with
  `warnings: []`. It is now refused with the column and the channel named, so the model
  repairs it in the same run. The case that produced this: a real provider read
  `chart.orientation: 'horizontal'` as an instruction to swap the data channels and
  submitted `x: notional_usd, y: counterparty`, which is schema-valid and semantically
  empty. The prompt and the submit schema now state that the channels do not move with the
  orientation, and one place enforces it.
- **A blank measure is a gap again, not a zero.** `Number(null)` is `0`, so every missing
  measure was drawn as a real data point claiming the value zero — a null and a `0` were
  the same picture, which the `nulls-and-zeros` corpus case exists to forbid. `null`,
  `undefined` and `''` now leave a gap, in categorical series, range bounds and point
  clouds alike. A measure value that is neither blank nor a number is refused rather than
  drawn as an unasked-for hole.
- A pie asked for over a table with a gap in its measure is refused by name: a slice is a
  share of a whole, and a missing one cannot be drawn without silently answering a
  different question.
- **A gap is a refusal in a point cloud, not a gap.** A blank `x`, `y` or `size` on a `scatter`
  or `bubble` is refused by name. Highcharts skips a datum whose coordinate is missing, so a
  scatter silently lost the point and a null `size` on a bubble dropped *every* mark in the
  series — measured at `0 of 3` drawn, with `warnings: []`. A categorical chart keeps the gap,
  where the reader sees a hole in a row rather than a point that was never there.
- **A `Date` object on a measure channel is refused.** `Number(date)` is the epoch in
  milliseconds and passes `Number.isFinite`, so a date column on `y` compiled to a chart of
  `1767225600000` against an epoch axis, silently. A date-like *string* was already caught;
  the object walked through the same gap. A date belongs in `x`, where it is a category.
- The empty-complement warning says what is empty. `top_k … rest: true` whose complement comes
  out empty — most often because every value ties, so a `k` of 1 swallows the table — used to
  report "matched no rows", which sends the reader looking for a wrong field name instead of at
  their `k`.

### Changed

- **The channel roles are now derived from the type declarations everywhere the model reads
  them.** The submit tool's description said only that "`encodings.x` is the category column,
  `encodings.y` the measure"; `y2`, `size`, `low` and `high` are measures too, and a type's own
  `channels` map is where that was already declared. The description now carries a generated
  role list (`x = category, y = measure, …`) and every channel property describes itself from
  the same declaration, so the text a model reads and the rule the compiler enforces are one
  fact rather than two that can drift.
- The `present`-mode prompt offered "which column is the x axis and which is the measure" as a
  free choice, directly above a hard rule fixing `x` as the category. It now offers the
  *measure* as the choice and states that `x` is fixed.

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
