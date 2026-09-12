# Roadmap and backlog

Everything that is known to be missing, planned, or deliberately refused. Written
so that a decision made in a review does not have to be re-derived later.

**Current size** — library: 12 source files / 1,973 lines, 7 test files / 70 tests,
zero runtime dependencies. Example: 989 lines of `.ts`/`.tsx`/`.mjs` source, 124 of
which are the proxy's 6 tests. Counted over `src/`, `server/` and `scripts/` only — the
`.json` datasets are generated and `.env` is configuration, so neither is source.

Priorities are about *user value*, not effort:

- **P0** — blocks real use by someone else, or is a correctness gap.
- **P1** — the next features, in the order they are worth doing.
- **P2** — later, or waiting on a decision.
- **Deferred with triggers** — will be revisited when a stated condition happens.
- **Refused by design** — do not build these without reopening the decision.

---

## P0 — correctness and usability gaps

### 1. `emphasis` cannot select arbitrary ranks

`top_k` selects a **contiguous** range (ranks 1..k). "Highlight the first and the
third one", "the best and the last", "every other one" cannot be expressed — so
the model either approximates them (a `top_k: 3` highlights ranks 1–3, which is
not what was asked) or drops the emphasis entirely.

**Shape:** add `{ op: 'rank', field, ranks: [1, 3] }`, 1-based, negative counting
from the end (`ranks: [1, -1]` = first and last). Evaluate in `compile/emphasis.ts`
with the same deterministic comparator as `top_k`.

**Must be documented:** the tie policies differ on purpose —
`top_k` **includes ties at the boundary** (four rows tied for 3rd are all "top 3"),
`rank` is **positional** (value descending, then name ascending as the tiebreak).

### 2. `emphasis` cannot name a colour

Only two tones exist (`highlight` → `#e8590c`, `muted` → `#c9ced6`), so
"highlight top 3 **in yellow**" silently produces orange. The word is dropped
with no signal.

**Decided direction:** add an optional **named** colour — closed set, resolved by
the backend, e.g. `style: { tone, color?: 'yellow' | 'red' | 'green' | 'blue' | 'orange' | 'grey' }`.
A colour *name* is intent; a hex value is library config, which the spec must not
carry. Free-form hex and arbitrary styling stay refused.

### 3. A request we cannot honour must make a sound

The pattern behind gaps 1 and 2: the user asks for something the spec cannot
express and the chart is drawn anyway. Three cases, with three different fixes:

- **The pipeline can detect it.** A rejected chart type, a plan refused for
  `limit` without `sort`, an emphasis rule that matches nothing — all already
  surface in `AskResult.warnings` and go back to the model as tool results. Keep
  doing this for every new rule.
- **Only the model knows.** "Highlight it in yellow" and "the 1st and 3rd" are
  invisible to the pipeline: nothing in the submitted spec says the requirement
  was dropped. This part can only be fixed at the prompt level — instruct the
  model to state, in its final reply, anything it could not represent — and then
  to have the loop carry that text into `warnings` rather than into a chat
  message nobody renders.
- **The pipeline can detect it and does not.** A *value* `sort` on a temporal
  chart: the step runs, so `result.dataset` is genuinely reordered, and then
  `compile/model.ts` sorts temporal points by time — the drawn points are
  unchanged and no warning is emitted. The request is dropped in a way the caller
  cannot see, even though both facts (the sort step, the temporal encoding) are in
  hand before compilation. Reachable in `'ask'` mode only; discovered while
  designing present mode, where `sort` does not exist at all.

### 4. Visual behaviour is asserted nowhere

`yAxis.reversed = true` for horizontal bars was derived from Highcharts' docs and
forum threads, never rendered: no browser, no rendering test. The same is true of
every per-point colour and of `dataLabels` on emphasised points.

Data-level tests (including any cross-backend parity gate) compare **values**, not
pixels, so this class of mistake is invisible to them.

**Needed:** either a documented manual check per convention, or a rendering-level
regression (headless browser + screenshot) once the chart types stabilise.

### 5. The package-level end-to-end test depends on the example

`test/e2e.test.ts` reads `../../../examples/react-highcharts/data/post-trade.json`.
If `packages/chartwright` is copied on its own — which is the documented
consumption route — the test cannot run.

**Fix:** keep a small fixture inside the package for package-level tests, and
leave the 800-row run to the example.

---

## P1 — next features

### 6. More chart types

Today: `bar`, `line`, `pie`. Unsupported types are **rejected** (never drawn
wrongly), and the model is told why, so it usually retries.

Suggested order, cheapest first: `groupedBar`, `stackedBar`, `area`, `donut`,
`scatter`. Beyond that the "module-dependent" family (waterfall, boxplot, gauge,
funnel, radar, rose, streamgraph, lollipop) needs a different mechanism — see the
deferred flint decision below.

### 7. Colour and theming

The library contains exactly two hard-coded hex values. Every other colour is a
Highcharts default, so an app cannot match its brand. This is also the first
thing an integrating product will complain about.

**Needed:** a palette/theme layer, and the decision in item 21 about where the
knowledge comes from.

### 8. Layout and geometry

No canvas sizing, margins, label rotation or long-label handling. Charts with many
categories will look cramped. flint solves this with `compute-layout`,
`band-dodge` and axis-label measurement (see item 21).

### 9. Prompt tuning against real runs

The prompt has no few-shot examples — deliberately, so that examples are written
from **observed** failures rather than guessed ones. The app runs now, so the
failure modes are collectable.

Specifically worth checking after real use: does the model reliably sort before
limiting, choose `orientation: horizontal` for long labels, and use `emphasis`
instead of naming a category it saw in a preview?

### 10. Provider convenience for Node consumers

Consumers implement `LlmClient` themselves (about 20 lines). That is the right
default, but a Node consumer calling a provider directly should not have to
re-derive the request/response translation.

**Needed:** an optional subpath (e.g. `chartwright/providers/openai-compat`) with
a clear warning that it is **server-side only** — a browser must keep going
through the consumer's own endpoint.

### 11. Streaming

`LlmClient.completeStream` is supported by the loop and **no implementation
exists**: the example does not stream, and token deltas are never seen. Tool-level
progress events already work without it, so this is a refinement, not a gap.

Also deferred: an `askStream()` async-iterable form of `ask()`.

### 12. Amending an existing chart

Follow-ups work (stateless transcript) but every turn produces a **new** spec. A
user saying "make it a line chart" or "use green" gets a fresh decision rather
than a targeted edit, and there is no way to express "keep everything, change one
thing".

**Needed:** decide whether the follow-up path needs an explicit amend/merge step,
or whether re-deciding is acceptable.

---

## P2 — later

### 13. Token budget

`budget.maxRounds` and `budget.maxToolCalls` are enforced (see the change log).
There is no token accounting: a pathological run inside the round limits
can still be expensive.

### 14. Typed error codes

Consumers currently branch on `instanceof AgentGaveUpError` versus message text
for provider and compiler failures. A small `code` field would make error handling
robust.

### 15. `library` option is inert

`ask({ library: 'highcharts' })` is accepted and ignored — there is one backend.
Either honour it when a second backend lands, or remove it until then.

### 16. Data source abstraction (DuckDB)

Today every tool reads `rows: Row[]` in memory. Planned: read through a thin
`DataSource` interface (`columns()`, `getRows()`, later `query(predicate, agg)`
pushed down to DuckDB), so the tools do not change when the source does. Recorded
now, not implemented.

### 17. Test runner

`npm test` uses `node --experimental-strip-types --test`, which needs Node ≥ 22.6
and spawns a process per file. That is why this repository's own tests cannot run
inside a restricted sandbox. Vitest would be conventional but adds the package's
first dev dependency; the zero-dependency property is worth keeping until there is
a concrete reason not to.

### 18. Optional column semantics

Deliberately **not** required: a decision made while designing present mode.

The idea considered was to have the consumer declare what each column *means* —
additive, a ratio, an average, a snapshot balance — so the library could refuse to
`sum` an average, or refuse to aggregate a column that must not be added. That would
make a class of wrong charts impossible rather than merely unlikely.

**Rejected as a requirement**, because it asks the consumer to do real work at the
call site: audit every column, decide its semantics, keep it correct as the schema
changes — and everything then depends on that declaration being right, with the
failure mode being a confidently wrong chart rather than a missing one. For a
library whose first promise is that a consumer can point it at a table and get a
chart, that is too much to demand.

**Kept as a possible opt-in.** A consumer that wants enforcement can pass it;
nothing else may depend on it. If it is ever added:

- it is optional per column and per dataset, absent by default;
- validation is advisory (a warning in `AskResult.warnings`) unless the consumer
  explicitly asks for hard refusals;
- it never changes the neutral spec, and a run without it behaves exactly as today.

Free-text `description` on a dataset or column — the thing the consumer *can* pass
today, see `docs/using-chartwright.md` — is the intended low-effort substitute. It
reaches the prompt and nothing else: not validated, not stored in the spec, not
needed to replay a run.

### 19. MCP delivery

Not started. The shape was designed earlier for the ChartBrain project and still
applies: a small tool surface (`list_chart_types`, `validate_spec`, `ask_chart`),
reusable knowledge as resources, **no server-side rendering**, and structured
validation results. chartwright's existing exports map onto that surface directly.

### 20. An off switch for `preview_rows`

Present mode sends the model up to five rows of your table, verbatim. That is
deliberate and bounded — always the first rows, no offset to page with, so asking
again returns the same rows — but it is also the one path by which row *values* leave
the process in that mode, and there is no way to turn it off.

`profile: { sampleValues: 0 }` covers `describe_table` only. That is a trap for
precisely the caller who set it: the option reads like "send no values", and it does
not mean that.

**Decisions to make:** whether the switch is its own option (`preview: { rows: 0 }`) or
whether `sampleValues: 0` should mean "no row values leave, anywhere"; and whether
turning the preview off drops `preview_rows` from the tool list entirely — cleaner, the
model never sees a tool it may not use — or leaves it listed and refusing.

---

## Deferred with triggers

### 21. Vendor flint's compilation pipeline — or extract its conventions?

flint (MIT, Microsoft) already encodes the knowledge that item 4 and item 8 are
missing, at scale:

| | chartwright today | this project's flint fork | upstream flint |
|---|---|---|---|
| source | 1,783 lines / 12 files | 78,504 lines / 268 files | 77,115 lines / 253 files |
| chart types | 3 | 11 Highcharts templates | **136 templates** across 5 backends |
| tests | 70 | 56 files / 1,122 cases | — |
| runtime deps | **0** | — | — |

It also owns `getCategoryOrder`, `detectAxes`, `band-dodge`, `compute-layout`,
`color-decisions`, `filter-overflow` and `normalize-properties` — precisely the
"library convention" knowledge that produced the sorting bug.

**Costs:** the library would go from 1,783 lines to ~78k; the spec would need a
translation layer (flint consumes its own `ChartAssemblyInput`); upstream upgrades
mean re-vendoring and re-running its suite; and **publishing gets harder** — this
project's other repo had to publish a fork to escape the `file:` dependency.
Upstream has **no Highcharts backend**, so vendoring is only necessary if we want
Highcharts *and* flint's pipeline.

**Important distinction:** wanting more *backends* (ECharts, Vega-Lite, Chart.js,
Plotly) does **not** require vendoring — upstream `flint-chart` is published and
MIT, so it can be a plain dependency.

**Triggers to revisit:** a second chart library is needed; more than ~8 chart
types; theming/palette work starts; layout/geometry work starts.

**If triggered:** prefer an optional subpackage (`@chartwright/flint`) over vendoring
into the core, keeping the core dependency-free; and begin by reading flint and
listing the specific modules to reuse rather than adopting the whole pipeline.

### 22. Publishable build

`packages/chartwright/package.json` is `private: true`, `version: 0.0.0`, and
`exports` points at `./src/index.ts`. Consumers therefore need two config tweaks
(`optimizeDeps.exclude`, `allowImportingTsExtensions`) that exist only because the
source is consumed directly.

**Needed:** build to `dist`, point `exports`/`types` at it, drop `private`, set a
version, add `files`. After that, `npm install chartwright` needs no config, and
step 3 of `docs/using-chartwright.md` can be deleted.

Also missing: a README **inside the package** (npm shows the repo root's, which
describes the monorepo).

### 23. Stability policy

At 0.0.0 nothing is frozen. Source consumers track a commit with no version
anchor; at minimum, tag releases so they can pin. Worth writing down which parts
are considered stable (the `AskResult` shape, the transform DSL) and which are
explicitly in flux (chart types, emphasis vocabulary).

---

## Refused by design

Do not reopen these without an explicit decision; each was considered and rejected
for a stated reason.

| Refused | Why |
|---|---|
| **Server-side rendering** | The whole point is that the data stays in the consumer's process. The library returns specs and options, never images. |
| **Free-form hex colours / arbitrary styling in the spec** | It turns the neutral spec into library config, and makes theming impossible. Named colours (item 2) are the compromise. |
| **Cross-field predicates in emphasis** ("revenue > cost and region ≠ X") | Needs an expression grammar and evaluator: a large, security-relevant surface for a rare request. |
| **Non-contiguous rank selection by enumeration when it gets long** ("every other one" across 50 categories) | If it cannot be expressed as a rank set or a threshold, the honest answer is that it is out of scope — not a bigger condition language. |
| **Limits on by default** | The library imposes no policy; budgets are the consumer's to set. Only pathologies are bounded: one nudge before `AgentGaveUpError`, and a warning (not a stop) past 12 rounds. |
| **Letting the model compute values** | "The largest" is computed by the compiler from the full table, so the answer survives the data changing and the model never touches values. |
| **Row-level data tools the model picks the window for** | A model choosing *which* rows to read is the highest-risk privacy shape considered. `preview_rows` is the bounded exception, and it is bounded structurally rather than by a limit: always the **first** rows, at most five, no offset parameter to page with, so calling it again returns the same rows. It exists only in present mode, over a table the caller handed over to be drawn. Anything wider — any window the model gets to choose, any access to the raw table — needs an explicit decision, per tool, with k-anonymity and a whole-run result budget. |
| **chartwright advising that a table would be better than a chart** | Presentation judgement, and the consumer's to make — the library does not know what the surrounding screen is for, and a library that second-guesses the request trains callers to ignore it. It may say a *spec* is unsupported or ambiguous; it may not say the data does not deserve a chart. |
| **Mandatory structured column semantics** | See item 18: too much to require of a consumer, and every declaration it gets wrong becomes a confidently wrong chart. Optional and advisory if ever added. |

---

## Change log of decisions already implemented

Kept here because the reasoning matters more than the code.

| Done | Note |
|---|---|
| Tools: `describe_table`, `run_query`, `submit_spec` | Three tools, one of them terminal. `run_query` executes over every row; the model receives only a summary, and the table is stripped before serialisation. |
| Follow-ups without state | The plan is recovered from the transcript the caller passes back (`recoverPlanFrom`). |
| `limit` after `aggregate` without `sort` is refused | It keeps an arbitrary subset: "top 5" that looks plausible and is wrong. |
| Duplicate categories are refused | Choosing one, or summing silently, changes the numbers. The model is told to aggregate. |
| Sorting by a missing column throws | It used to be a silent no-op. |
| Horizontal bars reverse the category axis | Highcharts draws bottom-up; row 0 belongs at the top. |
| `emphasis` evaluates conditions in the compiler | `top_k` finds the maximum in the real data; tones are semantic, never colours. |
| An emphasis rule matching nothing warns | Silence would be a lie the user cannot see. |
| Compiler split into neutral model + per-backend conventions | The sorting bug was this knowledge having no home. |
| `budget.maxToolCalls` now enforced | It was declared in the type and never checked; submissions count toward it, so a model cannot loop on validation errors. |
| Consumer guide written | `docs/using-chartwright.md`, written for the source-consumption route with the publish-time changes marked. |
