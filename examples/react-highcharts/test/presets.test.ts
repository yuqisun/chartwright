/**
 * The chart-selection catalog, checked.
 *
 * The page this catalog feeds is a manual instrument — a human runs a query and reads the
 * verdict. What is worth automating is the *labels*, because a wrong label makes the instrument
 * lie: a query whose `accepts` set is too narrow reports a false failure, and a type missing
 * from every `accepts` set is a type the instrument cannot measure at all.
 *
 * These run with no provider, no network and no React. That is possible because `presets.ts`
 * holds metadata only — no rows, no JSON import — so plain node can load it. Rows live in
 * `datasets.ts`, which only the page imports.
 *
 * Run: node --experimental-strip-types test/presets.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { listChartTypes } from 'chartwright';

import { DATASET_META, PRESETS } from '../src/presets.ts';

/** The declared types, asked of the library rather than copied — a copy is what drifts. */
const DECLARED: string[] = listChartTypes().map((entry) => entry.name);

/** The four types no wording separates, so accepting one of them must accept all four. */
const INTERCHANGEABLE = ['line', 'spline', 'area', 'areaspline'];

test('the library declares the types this catalog is written against', () => {
  // A guard on the guard: if this list is empty or tiny, every check below passes vacuously.
  assert.ok(DECLARED.length >= 14, `expected at least 14 declared types, saw ${DECLARED.length}`);
  assert.ok(DECLARED.includes('scatter') && DECLARED.includes('heatmap'), 'spot-check two names');
});

test('every declared type is reachable from some query', () => {
  // The check that stops the catalog rotting. Add a chart type and this fails until someone
  // writes a query that can reach it — which is the point, because a type with no preset is a
  // type the page cannot test, and "we support it" would then be an untested claim.
  const reachable = new Set(PRESETS.flatMap((preset) => preset.accepts));
  const missing = DECLARED.filter((type) => !reachable.has(type));

  assert.deepEqual(
    missing,
    [],
    `these declared types have no query that could produce them: ${missing.join(', ')}`,
  );
});

test('no query accepts a type the library does not declare', () => {
  const undeclared = [...new Set(PRESETS.flatMap((preset) => preset.accepts))].filter(
    (type) => !DECLARED.includes(type),
  );
  assert.deepEqual(undeclared, [], `these accepted types are not declared: ${undeclared.join(', ')}`);
});

test('every query files under a type it also accepts', () => {
  // `exercises` is the group heading. A preset filed under a type it cannot accept would render
  // as a permanently failing row, and it is the copy-paste error this catches.
  for (const preset of PRESETS) {
    assert.ok(
      preset.accepts.includes(preset.exercises),
      `'${preset.id}' is filed under '${preset.exercises}', which is not in its accepts list`,
    );
  }
});

test('every query names a dataset the catalog knows about', () => {
  for (const preset of PRESETS) {
    assert.ok(
      Object.hasOwn(DATASET_META, preset.dataset),
      `'${preset.id}' names dataset '${preset.dataset}', which is not in DATASET_META`,
    );
  }
});

test('present mode is only asked of tables that are already aggregated', () => {
  // Present mode's promise is that the caller's numbers are final. Pointing it at the raw
  // execution feed would chart one point per trade and blame the model for the result.
  for (const preset of PRESETS) {
    const meta = DATASET_META[preset.dataset];
    if (preset.mode !== 'present') continue;
    assert.equal(
      meta.preAggregated,
      true,
      `'${preset.id}' is present-mode over '${preset.dataset}', which is raw rows — the model has no tool to shape it`,
    );
  }
});

test('the interchangeable types are accepted together or not at all', () => {
  // `line`, `spline`, `area` and `areaspline` differ in how a line is drawn, not in what the
  // chart says, and no wording distinguishes them. A query accepting one and rejecting another
  // would report a false failure for a correct answer — the failure mode that teaches a reader
  // to ignore the verdict.
  for (const preset of PRESETS) {
    const accepted = INTERCHANGEABLE.filter((type) => preset.accepts.includes(type));
    if (accepted.length === 0) continue;
    assert.deepEqual(
      accepted,
      INTERCHANGEABLE,
      `'${preset.id}' accepts ${accepted.join(', ')} but not all of ${INTERCHANGEABLE.join(', ')} — ` +
        'no question distinguishes those four',
    );
  }
});

test('the catalog is not empty and its ids are unique', () => {
  // A guard against a refactor that empties the array and leaves every check above passing.
  assert.ok(PRESETS.length >= 10, `expected at least 10 presets, saw ${PRESETS.length}`);
  const ids = PRESETS.map((preset) => preset.id);
  assert.equal(new Set(ids).size, ids.length, 'preset ids must be unique — the page keys state by them');
  for (const preset of PRESETS) {
    assert.ok(preset.query.trim().length > 0, `'${preset.id}' has no query`);
    assert.ok(preset.why.trim().length > 0, `'${preset.id}' has no explanation, so a wrong pick teaches nothing`);
  }
});
