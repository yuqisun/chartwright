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

**Files:** `src/types.ts`, `src/tools.ts`, `src/prompt.ts`, `src/ask.ts`,
`test/prompt.test.ts` (new)

**Step 1 (test first).** A test asserting that the tool list for each mode is
exactly:

| mode | tools |
|---|---|
| `'ask'` (default) | `describe_table`, `run_query`, `submit_spec` |
| `'present'` | `describe_table`, `preview_rows` *(task 3)*, `submit_spec` |

and that no present-mode tool schema mentions `group_by`, `measures` or `steps`.

**Step 2.** Add `ToolMode = 'ask' | 'present'` and replace the `TOOL_DEFS` constant
with `buildToolDefs(mode: ToolMode): ToolDef[]` (keep `TOOL_DEFS` exported as the
`'ask'` list for compatibility).

**Step 3.** Make the system prompt mode-aware:
`buildSystemPrompt(mode: ToolMode = 'ask'): string`. In present mode the "how to
work" steps must not tell the model to call `run_query`; instead:

> The rows are final. Do not aggregate, filter, limit, reorder or derive anything —
> you have no tool that could, and the order they are in is the order to show. Look
> at the data, then choose the chart type, the two axes, the orientation, the title
> and any emphasis that best show what the user asked about.

**Step 4.** `ask()` passes `present ?? false` through to `buildToolDefs`,
`buildSystemPrompt` and the loop's `mode`.

**Step 5.** Verify: `node --experimental-strip-types test/prompt.test.ts`, plus the
whole suite (no behaviour change for the default mode).

**Commit:** `feat(agent): present mode — a request mode with no data-changing tools`

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

**Step 3.** Available in present mode only: in `'ask'` mode the model already gets
a three-row preview from `run_query`'s summary, and keeping that tool list short
is deliberate. Recorded as a note; adding it to both modes later is a one-line
change if the need appears.

**Step 4.** Verify: `test/tools.test.ts` plus the full suite.

**Commit:** `feat(tools): preview_rows — a bounded, read-only look at the table`

---

## Task 4 — Making an unchartable table fixable, and a helpful refusal

**Files:** `src/loop.ts`, `src/tools.ts`, `src/ask.ts`, `test/loop.test.ts`,
`test/present.test.ts` (new)

Removing `sort` leaves present mode with exactly one lever — the encodings — so this
task covers the two things left: the model being told why it has no data tool, and
the one failure that a change of encoding *can* fix.

**Step 1 (test first).**

- a present-mode call to `run_query` answers with an explanation (step 2), not the
  generic `unknown tool 'run_query'`;
- a table with two rows sharing the submitted `x` value is rejected at submit time
  with guidance the model can act on (step 3);
- the same table is **accepted** once the distinguishing column is added to
  `encodings.series`;
- in present mode the spec's `transform_plan.steps` is always `[]`, whatever the
  model submits.

**Step 2 — a helpful refusal.** A model with a `run_query` habit (or one confused by
an earlier `ask`-mode turn in the transcript) will try it. The dispatcher answers,
as the tool result:

> `run_query` is not available in present mode: the rows you were given are final,
> and no tool can change them. Look at the table with `describe_table` or
> `preview_rows`, then choose encodings that present it.

**Step 3 — the gap that needs re-encoding, not aggregation.** If the rows contain two
entries for the same category (two `GB` rows), the compiler refuses today with "add
an aggregate step" — which present mode cannot do, so the caller would just get a
dead end. Present mode therefore validates the submitted **encodings against the
actual rows** at submit time and, when they would collide, rejects with guidance:

> Two rows share `booking_country = 'GB'`, and present mode cannot aggregate them.
> Put the column that distinguishes them into `encodings.series`, or choose a
> different `encodings.x`.

This turns a dead end for the caller into a re-encoding decision for the model.

**Step 4.** Verify: `test/loop.test.ts`, `test/present.test.ts`, the full suite.

**Commit:** `feat(agent): present mode tells the model why it cannot change the data`

**Not in scope here — recorded instead.** The same class of silence in `ask` mode: a
*value* sort on a temporal chart reorders `result.dataset` but is then overwritten by
the compiler's time-sort, so the drawn points do not change. Written up in
`docs/roadmap.md` (P0 item 3, third bullet) rather than fixed in this batch.

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
- the trace contains **no** `run_query` call.

**Step 2.** A second test: the same rows in `'ask'` mode with a plan that aggregates
anyway is *still* possible — proving the guarantee is the mode's, not a global rule.

**Step 3.** A third test, the order guarantee stated negatively: feed the same rows in
ascending order and in descending order with the same scripted spec, and assert the
two `xAxis.categories` arrays differ and match their inputs exactly. This is the test
that fails if anyone later adds an implicit category sort.

**Commit:** `test: end-to-end present mode over a pre-aggregated result`

---

## Task 6 — Example and docs

**Files:** `examples/react-highcharts/src/App.tsx` (+ a small
`examples/react-highcharts/src/preAggregated.ts`), `docs/using-chartwright.md`,
`docs/roadmap.md`

**Step 1.** Add a second demo to the example: the pre-aggregated rows above, called
with `present: true`, so the difference is visible next to the existing
natural-language flow. The panel should show that no `run_query` was called.

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
6. `preview_rows` never returns more than five rows.
7. A colliding encoding is rejected with guidance the model can act on.
8. Example demonstrates both modes; docs describe them.
9. Full suite green: library tests (currently 70) plus the new ones, proxy tests (6),
   and both typechecks.

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
