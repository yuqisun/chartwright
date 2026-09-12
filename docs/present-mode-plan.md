# Present mode — implementation plan

Charting a table the caller has **already aggregated**, without the model being
able to change it.

## Why

A consumer has run its own query and holds a final result:

```
booking_country | trade_volume
GB              | 82842348
HK              | 26610809
SG              | 11420317
```

It does not want that aggregated again. It wants the library to look at the data
and the request, and choose the chart type, axes, orientation, title and emphasis
that present it best.

Today this *almost* works — an empty transform plan is legal and the incoming row
order is preserved (verified by probe) — but the model still holds `run_query`, so
it can silently re-aggregate. With unique groups and an additive measure the
output happens to be identical and nothing warns; with a finer-grain table, a
ratio, an average or a `distinct_count`, the numbers change invisibly.

## Decisions taken (and why)

| Decision | Rationale |
|---|---|
| **`present: boolean`** on the request, nothing more | The consumer should not have to enumerate what it cares about; the model judges from `query` + `rows` + optional descriptions |
| **Present mode removes `run_query`** | The strongest form of "do not change my data" is not a prompt rule, it is not giving the capability. Structural, not advisory |
| **No sort either — the order you pass is the order shown** | With `sort` gone the contract is one sentence: *present mode charts exactly your rows, in your order*. Ranking belongs in the caller's query (`ORDER BY`), which is where it already is in practice. It also removes the last ordering decision the model could get wrong, and with it any need to remember a previous turn's ordering |
| **Verification by restriction, not by policy** | `aggregate` / `filter` / `limit` / `derive` / `binTime` / `sort` stay unreachable because no tool exposes them in this mode |
| **Optional free-text descriptions** (`dataDescription`, `columns[].description`) | The pipeline cannot know that `fill_rate` is a ratio; the consumer can say so cheaply. Text only — never required, never validated |
| **No structured semantic types** | A closed enum of aggregation semantics is too much to ask of a consumer. Recorded in `docs/roadmap.md` as a possible opt-in for later, not built now |
| **The compiler is unchanged** | `compileToHighcharts(spec, rows)` already handles an empty plan; present mode only changes what the model may do |

## Constraints

1. **Nothing in present mode may alter values, drop rows or reorder them.** No
   aggregation, no filtering, no limiting, no derivation, no time binning, no sort.
2. **The spec's `transform_plan` is always empty in present mode**, so the chart is
   the caller's table, row for row and in order. The model still never writes a
   plan — there is no plan to write.
3. **Descriptions go into the prompt only.** They are not validated, not stored in
   the spec, and not needed for replay — which is what keeps `compileToHighcharts`
   signature-stable.
4. **Describing is optional.** With no descriptions the request behaves exactly as
   it does today, byte-for-byte in the prompt.
5. **Nothing here changes the natural-language mode.** `ask` mode keeps
   `run_query` and the whole transform DSL; present mode simply never reaches it.
   `submit_spec` is identical in both modes.

---

## Task 1 — Mode and tool surface

**Files:** `src/types.ts`, `src/tools.ts`, `src/prompt.ts`, `src/loop.ts`,
`src/ask.ts`, `test/prompt.test.ts` (new), `test/loop.test.ts`

**Step 1 (test first).** A test asserting that the tool list for each mode is
exactly:

| mode | tools |
|---|---|
| `'ask'` (default) | `describe_table`, `run_query`, `submit_spec` |
| `'present'` | `describe_table`, `submit_spec` — plus `preview_rows` in task 3 |

and that no present-mode tool *definition* mentions the transform DSL. Assert on the
whole serialized definition (schema and description), because a tool the model cannot
call is one thing and a tool it has been *told about* is another. Two deliberate
exceptions: check quoted strings only (`"aggregate"`, not "aggregates", which
`describe_table` says about its own summary), and leave `"limit"` out of the list,
since a preview tool bounds its own preview with one and that cannot change the
charted data.

**Step 2.** Add `ToolMode = 'ask' | 'present'` and replace the `TOOL_DEFS` constant
with `buildToolDefs(mode: ToolMode): ToolDef[]` (keep `TOOL_DEFS` exported as the
`'ask'` list for compatibility). `submit_spec` needs a second wording: the ask-mode
description says "after run_query has produced the table" and "do not include a
transform_plan", both of which are wrong here.

**Step 3.** Make the system prompt mode-aware:
`buildSystemPrompt(mode: ToolMode = 'ask'): string`. The shared rules stay shared; the
mode supplies the intro, the "how to work" steps, and the one rule that differs in
kind (`encodings` name columns produced by your last `run_query` / columns of the
table you were given). In present mode the intro must not mention `run_query` or the
transform vocabulary, and must say what the model is *still* free to decide —
otherwise the prompt reads as a list of prohibitions and the charts get timid:

> The rows are final. Do not aggregate, filter, limit, reorder or derive anything —
> you have no tool that could, and the order they are in is the order to show. Do not
> ask for different rows, and do not recompute a column: every figure you need is
> already there, and several of them are averages, ratios, distinct counts or maxima,
> which is exactly why they are not yours to redo.
>
> What you decide: the chart type, which column is the x axis and which is the
> measure, the orientation, the title, and any emphasis.

**Step 4 — the part the plan originally missed.** `runAgentLoop` dispatches a tool
call by name straight to `runTool`, whatever `tools` says. A model that emits
`run_query` anyway — or that inherits one from an earlier ask-mode turn in the
transcript — would have executed it, and the loop would even have adopted its steps
as the plan. So the loop enforces its own contract:

- a call whose name is not in `tools` is refused before any handler is consulted,
  with the available tool names in the message (a bare "no" invites a retry);
- a plan is recovered from the transcript only when `run_query` is among the tools,
  so present mode cannot inherit a transform from a previous natural-language turn.

This needs **no `mode` parameter on the loop**: everything follows from the tool list,
which is the thing actually handed to the model. Fewer knobs, and the guarantee cannot
drift away from the list that defines it.

**Step 5.** `ask()` derives `mode` once (`request.present === true ? 'present' : 'ask'`)
and passes it to `buildToolDefs` and `buildSystemPrompt`. Nothing else in `ask()`
changes.

**Step 6.** Verify: `test/prompt.test.ts`, `test/loop.test.ts` (including: an
undeclared call reaches no handler, is traced as refused rather than as having run,
and a plan in the transcript is not adopted), plus the whole suite — the default mode
must be byte-identical in behaviour.

**Commit:** `feat(agent): present mode — a request mode with no data-changing tools`

**Status: done.** `buildToolDefs`, the mode-aware prompt and the loop's tool-list
enforcement are in; 82 library tests pass. Tasks 2–6 remain.

---

## Task 2 — Optional descriptions

**Files:** `src/types.ts`, `src/prompt.ts`, `src/ask.ts`, `test/prompt.test.ts` (new)

**Step 1 (test first).**

- with `dataDescription` and `columns[].description`, both appear in the user
  prompt, attached to the dataset description and to the named column;
- with neither, the user prompt is **byte-identical** to today's (pin it with a
  stored expected string);
- a `columns` entry for a column that does not exist in the rows is ignored (not an
  error — descriptions are advisory).

**Step 2.** Types:

```ts
export type ColumnDescription = {
  name: string;
  type?: ColumnType;
  description?: string;
};
```

and on `AskRequest`: `present?: boolean; dataDescription?: string;
columns?: ColumnDescription[];`

**Step 3.** `buildUserPrompt(query, dataset)` takes
`{ rowCount, columns: Array<Column & { description?: string }>, dataDescription?: string }`
and renders descriptions inline. Say in the prompt that these come from the caller
and are authoritative.

**Step 4.** In `ask()`, merge `request.columns` onto `inferColumns(rows)` by name
(declared `type` wins, unknown names ignored).

**Step 5.** Verify the tests above plus the full suite.

**Commit:** `feat(agent): optional dataset and column descriptions for the model`

**Status: done.** 88 library tests pass. The merge lives in `prompt.ts`
(`applyColumnDescriptions`) rather than inline in `ask()`, so "unknown names are
ignored, a declared type wins" is unit-testable without going through a whole `ask()`.
One thing this task turned out to need: `docs/using-chartwright.md`'s "What the model
sees" section answers
"what leaves my process?", and descriptions change that answer — the caller's own words
now travel to the provider — so that clause landed here rather than waiting for task 6.

---

## Task 3 — `preview_rows` tool (read-only, bounded)

**Files:** `src/tools.ts`, `test/tools.test.ts`

**Step 1 (test first).**

- `preview_rows({})` returns at most 3 rows by default;
- `preview_rows({ limit: 5 })` returns at most 5; `limit: 50` is rejected with a
  clear message (the ceiling is the tool's, and it is not configurable by the model);
- the result never contains more rows than the whole table;
- an empty table returns `rows: []` rather than throwing.

**Step 2.** Implement `previewRows(rows, { limit })` in `src/tools.ts`, add the tool
definition ("Look at up to five actual rows to understand the table's shape. Read
only.") and register it in `createToolHandlers`.

**Step 2b — the bound has to be structural, or it is not a bound.** "At most five" is
only reassuring if there is no way to ask for a *different* five. So: no offset, no
sort, no filter — the tool returns the first rows, full stop, and calling it again
returns the same rows. An unrecognised parameter is therefore an **error** rather than
something ignored, because a model that asked for rows 10–14 and silently got rows 0–4
would go on to reason about data it never saw. That is the same rule as the rest of the
library: a request we cannot honour must make a sound.

**Step 3.** Available in present mode only: in `'ask'` mode the model already gets
a three-row preview from `run_query`'s summary, and keeping that tool list short
is deliberate. Recorded as a note; adding it to both modes later is a one-line
change if the need appears.

**Step 4.** Verify: `test/tools.test.ts` plus the full suite.

**Commit:** `feat(tools): preview_rows — a bounded, read-only look at the table`

**Status: done.** 96 library tests pass. Two consequences worth recording here, because
they are docs the task did not mention and both would have gone stale:

- `preview_rows` is a row-level tool, and the roadmap refuses row-level tools by
  default. It is not a contradiction — always the first rows, no window for the model
  to choose, present mode only, over a table handed over to be drawn — but the refused
  row now says exactly that, or it reads as a rule the design broke.
- it is a new way for row *values* to leave the process, so
  `docs/using-chartwright.md`'s "What the model sees" section had to say so, along with the fact that
  `profile: { sampleValues: 0 }` does **not** switch it off. That gap is recorded as
  item 20 in `docs/roadmap.md` rather than decided here.

**Later revision (after review).** Two decisions changed what this task left behind,
and both were mine to get wrong:

- the ceiling went from five rows to **twenty**. Five was a count bound being used as if
  it were a privacy bound; on the small, already-aggregated tables present mode exists
  for, five rows is most of the table anyway. Twenty is the honest version of "the model
  may preview some of it", and the consequence — a table of twenty rows or fewer can be
  read whole — is now stated in the code, the consumer guide and the roadmap instead of
  being left for a reader to notice.
- the claim that the model **never sees the caller's rows** is gone. It was already
  loose in `ask` mode (the model saw a three-row preview of the very table that got
  plotted) and became plainly false here. What replaced it, in the system prompt, the
  consumer guide and the example, is the claim that is actually true: the model receives
  summaries and the preview it asks for, and never the table *as a payload*.

The second one is the more useful lesson: the false sentence had been copied into five
places, and nothing tested it. There is now a test that fails if either prompt starts
claiming the model sees no rows.

**Review pass over tasks 1–3 (after they were committed).** Six findings, all fixed in
one batch, all of them caused by the work itself rather than by what came before:

1. A declared column `type` reached the prompt but not `describe_table`, so the model was
   told `string` up front and `number` the moment it asked. The declarations now flow into
   the profile as well — one authority for a column's type — and `ToolContext.columns`
   carries them.
2. The present-mode prohibition said "no tool that could [limit]" while `preview_rows`,
   the only data tool in that mode, takes a parameter called `limit`. Reworded to be about
   the data: nothing in this mode can change it.
3. `submit_spec` was intercepted before the reachability check, so the "the declared list
   is enforced" rule had an exception. The list is now validated on entry — a run with no
   terminal tool is a caller's mistake, and it should fail immediately rather than look
   like a model that gave up.
4. `options.limit ?? DEFAULT` turned an explicit `limit: null` into three rows, while the
   adjacent comment promised a non-numeric limit would be refused out loud.
5. The roadmap's "Current size" was stale in all three numbers within three commits of
   being written, and an acceptance criterion still said 70 tests.
6. The tool definitions were shared mutable objects, and the two `submit_spec` variants
   shared one `parameters` object outright.

Found while fixing 1, and worth its own line: a tool call's **arguments were spread over
the profiling options**, so a model could set its own `sampleValues` — including over the
top of a caller's `sampleValues: 0`. No tool argument reaches a caller's policy now, and
every undeclared argument is refused.

The re-read of the fixes themselves produced one more: refused arguments were reported
twice over, as `describe_table: describe_table: 'sampleValues' is not a parameter`,
because the handler named its tool and the loop prefixed the same name. The loop now
leaves a message alone when it already starts with the tool's name.

---

## Task 4 — Making an unchartable table fixable, and a helpful refusal

**Files:** `src/loop.ts`, `src/tools.ts`, `src/ask.ts`, `test/loop.test.ts`,
`test/present.test.ts` (new)

Removing `sort` leaves present mode with exactly one lever — the encodings — so this
task covers the two things left: the model being told why it has no data tool, and
the one failure that a change of encoding *can* fix.

**Two corrections after measuring the current behaviour** (both found while checking
what the plan claimed, before writing any code):

1. **The dead end is not present-mode-specific.** In ask mode, a model that submits a
   spec over an unaggregated table gets exactly the same treatment: `ask()` rejects
   with `the table has more than one row for category 'East'. Add an aggregate step…`,
   the model has already gone, and the caller holds an exception instead of a chart.
   So the check belongs at submit time in **both** modes, with wording that fits what
   each can do — which also means it should not be a duplicate-category check bolted on,
   but the general rule *a submission is accepted only if the compiler can build it*.
   Measured, the unchecked class is wider than duplicates: `encodings.y` naming a column
   that does not exist throws `encoding field 'nope' is not in the produced table
   (available: region, revenue)` — a genuinely helpful message, delivered to the wrong
   party, after the loop has ended.
2. **The drafted guidance was wrong.** "…or choose a different `encodings.x`" is not
   always actionable: measured on a table grouped by country and asset class, moving x
   from `booking_country` to `asset_class` collides just as hard. The advice has to name
   the property x needs — values unique for every row in *this* table — and, better, the
   column that actually distinguishes the two colliding rows. That column is computable
   from the rows, so the message should say which one it is rather than leaving the model
   to guess. Verified separately: putting it in `encodings.series` does rescue the chart
   (`categories=["GB","HK","SG"]`, two series, `null` where a series has no value).

**Step 1 (test first).**

- a present-mode call to `run_query` answers with an explanation (step 2), not the
  generic `unknown tool 'run_query'`;
- a table with two rows sharing the submitted `x` value is rejected at submit time
  with guidance the model can act on (step 3);
- the same table is **accepted** once the distinguishing column is added to
  `encodings.series`;
- an encoding that names a column the plan did not produce is rejected at submit time
  in **both** modes, with the compiler's own message, instead of escaping as an
  exception from `ask()`;
- in present mode the spec's `transform_plan.steps` is always `[]`, whatever the
  model submits.

**Step 2 — a helpful refusal.** A model with a `run_query` habit (or one confused by
an earlier `ask`-mode turn in the transcript) will try it. The dispatcher answers,
as the tool result:

> `run_query` is not available in this run: nothing here can change the data, so the
> rows you were given are final. Look at the table with `describe_table` or
> `preview_rows`, then choose encodings that present it.

Two things to get right in the implementation: the wording is derived from the **tool
list** (the loop has no `mode`, and must not gain one — the list *is* the mode), and the
tools it names are only the ones actually present, so the sentence cannot point at
something this run does not have.

**Step 3 — the gap that needs re-encoding, not aggregation.** If the rows contain two
entries for the same category (two `GB` rows), the compiler refuses today with "add
an aggregate step" — which present mode cannot do, so the caller would just get a
dead end. Two moves, in this order:

- **The general rule first:** the loop gains an optional `validateSubmit`, and `ask()`
  supplies one that runs *the compiler* over the submission. Anything the compiler
  refuses becomes a rejected submission the model can repair, in either mode, with the
  compiler's own message — which is already good. This is what removes the whole class
  of "the caller got an exception after the model left", rather than one instance of it.
- **Then the wording present mode needs:** the compiler's advice ("add an aggregate step
  in `run_query`") names a tool present mode does not have, so that case is detected as
  data and rewritten:

> Two rows share `booking_country = 'GB'`, and this run cannot aggregate them.
> `asset_class` tells them apart — put it in `encodings.series`. Otherwise choose an x
> column whose values are unique for every row in this table.

The distinguishing column is computed from the colliding rows, so the advice is a fact
about this table rather than a suggestion to experiment. When no column distinguishes
them, the message says so instead of implying a fix exists.

The detection is extracted from the compiler and shared with it, so the rule "two rows,
one category" has one implementation and two messages — the engine's and the model's.

This turns a dead end for the caller into a re-encoding decision for the model.

**Step 4.** Verify: `test/loop.test.ts`, `test/present.test.ts`, the full suite.

**Commit:** `feat(agent): present mode tells the model why it cannot change the data`

**Status: done.** 113 library tests pass. Two things went differently from the steps
above, both recorded in the corrections at the top of this task:

- the check is the *general* one — the loop takes `validateSubmit` and `ask()` hands it a
  function that compiles the submission — rather than a duplicate-category check bolted
  on beside it. A duplicate is then one case among several, and the fixes for "the caller
  got an exception" apply to all of them at once. The collision is still detected as data
  (`findCategoryCollision`, extracted from the compiler and shared with it) because present
  mode needs different wording for that one case, not different detection.
- the guidance names the column that actually distinguishes the colliding rows, computed
  from them, and says so explicitly when nothing does. The drafted "or choose a different
  `encodings.x`" was measured to be wrong advice.

Two things found while doing it, recorded in `docs/roadmap.md` P0 item 3 rather than
fixed here: a `y` encoding over a text column draws a blank chart with no warning, and a
`filter` over a missing column yields an empty table silently — where `sort` on a missing
column throws. Same class as the temporal-sort silence already listed there.

**Not in scope here — and the note that was here was wrong.** It recorded that a *value*
`sort` on a temporal chart is silently overwritten by the compiler's time-sort. Checking
that claim later: the branch exists but never runs, because nothing in the library sets
`x.value_type`, and a value sort on a monthly series comes out in value order. The whole
situation is now roadmap item 21, including the fact that a date column gets a category
axis — which is what present mode's "your order, untouched" has been resting on.

---

## Task 5 — End-to-end on the caller's exact case

**Files:** `test/e2e.test.ts`

**Step 1.** A test using the three rows from the "Why" section, `present: true`,
and a scripted model that submits a horizontal bar with emphasis on the top one.
Assert:

- `options.chart.type === 'bar'` and `options.yAxis.reversed === true`;
- `xAxis.categories` is `['GB','HK','SG']` — **the caller's order, untouched**;
- `dataset` is exactly the input rows (no aggregation happened);
- `spec.transform_plan.steps` is `[]` — nothing was planned, because nothing may be;
- the `GB` bar carries the highlight colour and the others do not;
- the trace contains **no successful** `run_query` call. Assert it the precise way:
  every `run_query` entry, if the scripted model tries one, carries an error result
  rather than a summary. "No `run_query` in the trace at all" would pass for the
  wrong reason — the loop traces refusals on purpose, so a model that tries and is
  turned away leaves an entry, and that entry is the evidence.

**Step 2.** A second test: the same rows in `'ask'` mode with a plan that aggregates
anyway is *still* possible — proving the guarantee is the mode's, not a global rule.

**Step 3.** A third test, the order guarantee stated negatively: feed the same rows in
ascending order and in descending order with the same scripted spec, and assert the
two `xAxis.categories` arrays differ and match their inputs exactly. This is the test
that fails if anyone later adds an implicit category sort.

**Commit:** `test: end-to-end present mode over a pre-aggregated result`

**Status: done.** 117 library tests pass, 4 of them added here. Two of the four went
past the steps as written, both because writing them showed the steps would have passed
for the wrong reason:

- the "ask mode may still aggregate" test originally ran on the three-row table, where
  an aggregate is a no-op — it proved a plan existed and nothing more. It now starts from
  the same numbers *before* the caller's `GROUP BY` (two GB rows) and asserts that ask
  mode adds them into the single GB row the caller had: 51,000,000 + 31,842,348 =
  82,842,348. Aggregation that changes the numbers is the actual contrast.
- the trace assertion was "no `run_query` at all", which passes if the model simply never
  tries. The scripted model now reaches for it, and the test asserts the attempt is in the
  trace, refused, with no summary — the plan's own amended wording, which had said exactly
  this and which the first draft then ignored.

Added beyond the plan: the shipped `counterparty-summary.json` is charted as it ships, in
file order, with the whole table as the dataset — the data the example demo will run on.
It deepens an acknowledged dependency on the example's paths (roadmap P0 item 5), so that
item now says so.

---

## Task 6 — Example and docs

**Files:** `examples/react-highcharts/src/App.tsx`, `docs/using-chartwright.md`,
`docs/roadmap.md`

**Already in place** (shipped ahead of this task, so the mode has real data to run
against): `data/counterparty-summary.json`, `data/monthly-activity.json` and their
loaders in `src/data.ts`. Both are derived from the existing 800 rows by
`scripts/generate-data.mjs`, so `post-trade.json` is untouched.

**Step 1.** Add a second demo to the example: pick one of the two pre-aggregated
tables and call `ask({ present: true })`, so the difference is visible next to the
existing natural-language flow. The panel should show that no `run_query` was called,
and that `result.dataset` is the input rows in the input order.

**Step 2.** `docs/using-chartwright.md`: a "Two modes" section — when to use
`present`, what it guarantees, what the model may still decide, and the optional
descriptions with a realistic example.

**Step 3.** `docs/roadmap.md` — the two *decisions* that came out of this design are
already recorded there (item 18, optional column semantics; the refused-by-design row
for presentation advice), and the temporal-sort silence is under P0 item 3. What is
left is the part that only becomes true once this mode exists:

- reframe P0 items 1–3: rank selection and named colours are still open, and "a
  request we cannot honour must make a sound" now has its pipeline-level half closed
  **by construction** rather than by instruction — say so, and say what it does not
  cover (the model-only cases, and the temporal sort in `ask` mode);
- add a change-log row for present mode, whose note is the point of the whole design:
  *the guarantee is the tool list, not the prompt* — the mode cannot change the data
  because no reachable tool changes the data.

**Commit:** `docs: present mode in the example and the consumer guide`

**Status: done, with one caveat that matters.** The example now has the two demos behind
one switch, and the present one passes `present: true`, the two optional descriptions
from task 2, and reads the `run_query` verdict off `result.trace` rather than asserting
what the library does. The guide has a "Two modes" section (before "What you get back",
which renumbered the sections after it — no prose referred to them by number, and the two
places that did now refer to the section by name, because a name does not rot).

Caveat: **the example was typechecked, not run.** No browser and no `npm` in the
environment this was written in, so the demo's runtime behaviour — the switch, the
verdict line, the request actually going out — is unverified until someone opens it. The
library side has 117 tests; the example has its 6 proxy tests and `tsc`. That gap is
roadmap P0 item 4, which is about visual behaviour being asserted nowhere, and this adds
one more thing to it rather than closing it.

---

## Acceptance criteria

1. In present mode the model can call **only** `describe_table`, `preview_rows` and
   `submit_spec`; `run_query` answers with an explanation rather than a generic
   unknown-tool error.
2. `filter`, `aggregate`, `sort`, `limit`, `derive` and `binTime` are **unreachable**
   in present mode — by construction, not by instruction; every present-mode result
   carries `transform_plan.steps === []`.
3. A caller that pre-ranked its rows gets them back in that order: `xAxis.categories`
   equals the first-seen order of the input rows, for both ascending and descending
   input.
4. `dataset` in present mode is the caller's rows, order included.
5. Descriptions are optional; without them the prompt is unchanged from today.
6. `preview_rows` never returns more than twenty rows, and never returns a window
   other than the first rows.
7. A colliding encoding is rejected with guidance the model can act on.
8. Example demonstrates both modes; docs describe them.
9. Full suite green: the whole library suite, the proxy tests (6), and both
   typechecks. Deliberately not a count — a number here was stale within a day.

## Risks and fallbacks

| Risk | Mitigation / fallback |
|---|---|
| The model keeps trying `run_query` in present mode | The tailored error tells it why; if it proves common, add one line to the system prompt restating that the rows are final |
| The model wants to rank the bars and cannot sort | It can still emphasise the top *k* — the compiler ranks internally — but the drawn order is the caller's. A caller who wants a ranked picture orders its own rows |
| Present mode cannot fix a genuinely messy table | Re-encoding is the only lever, and the error says so; a caller with messy data should use `'ask'` mode, or pre-aggregate. Documented |
| Long descriptions inflate the prompt | They are the caller's own input, inserted verbatim; the caller controls cost. No cap added by default |
| Two modes drift apart in behaviour | Both share one loop; the only differences are the tool list and the prompt. Tests assert the tool lists exactly |

## Self-review

- **Scope:** six tasks, each independently committable and revertible; the compiler
  and the deterministic layer are untouched.
- **No placeholders:** every task names files, the assertions to write first, and
  the command to run.
- **The tricky part is called out:** the duplicate-category dead end (task 4 step 5)
  and the "ranked look without a sort" gap (task 4 step 3) are the two things that
  would otherwise be found later, in use.
- **What this plan deliberately does not do:** structured semantic types, automatic
  colour ramps, consumer-supplied encodings overrides, any sorting of the caller's
  rows, and any suggestion that a table would be better than a chart.
