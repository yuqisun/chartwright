import assert from 'node:assert/strict';
import test from 'node:test';

import { buildToolDefs, createToolHandlers, describeTable, inferColumns, previewRows, runQuery } from '../src/tools.ts';
import type { Row } from '../src/types.ts';

const rows: Row[] = [
  { region: 'East', month: '2026-01-01', revenue: 100 },
  { region: 'East', month: '2026-02-01', revenue: 150 },
  { region: 'West', month: '2026-01-01', revenue: 80 },
  { region: null, month: '2026-03-01', revenue: 40 },
];

test('inferColumns reports name and type', () => {
  assert.deepEqual(inferColumns(rows), [
    { name: 'region', type: 'string' },
    { name: 'month', type: 'date' },
    { name: 'revenue', type: 'number' },
  ]);
});

test('describeTable profiles the whole table with aggregates only', () => {
  const profile = describeTable(rows);
  assert.equal(profile.rowCount, 4);

  const region = profile.columns.find((c) => c.name === 'region');
  assert.equal(region?.type, 'string');
  assert.equal(region?.nullRate, 0.25);
  assert.equal(region?.distinctCount, 2);

  const revenue = profile.columns.find((c) => c.name === 'revenue');
  assert.equal(revenue?.min, 40);
  assert.equal(revenue?.max, 150);
  assert.equal(revenue?.p50, 90, 'median of [40, 80, 100, 150]');
});

test('describeTable detects a monthly date column', () => {
  const month = describeTable(rows).columns.find((c) => c.name === 'month');
  assert.deepEqual(month?.timeSpan, {
    min: '2026-01-01',
    max: '2026-03-01',
    distinctMonths: 3,
    looksMonthly: true,
  });
});

test('sample values are included for low-cardinality columns and can be switched off', () => {
  const withValues = describeTable(rows).columns.find((c) => c.name === 'region');
  assert.deepEqual(withValues?.sampleValues, ['East', 'West']);

  const without = describeTable(rows, { sampleValues: 0 }).columns.find((c) => c.name === 'region');
  assert.equal(without?.sampleValues, undefined);
});

test('sample values are omitted above the cardinality ceiling', () => {
  const wide: Row[] = Array.from({ length: 30 }, (_, i) => ({ id: `id-${i}` }));
  const id = describeTable(wide).columns.find((c) => c.name === 'id');
  assert.equal(id?.distinctCount, 30);
  assert.equal(id?.sampleValues, undefined);
});

test('sample values preserve their original type', () => {
  const lag: Row[] = [{ lag: 2 }, { lag: 1 }, { lag: 2 }];
  const column = describeTable(lag).columns.find((c) => c.name === 'lag');
  assert.equal(column?.distinctCount, 2, '2 and 2 are one category');
  assert.deepEqual(column?.sampleValues, [2, 1], 'numbers stay numbers');
});

test('describeTable handles an empty table', () => {
  assert.deepEqual(describeTable([]), { rowCount: 0, columns: [] });
});

test('runQuery returns the complete table and a small preview', () => {
  const { table, summary } = runQuery(rows, [
    { op: 'aggregate', group_by: ['region'], measures: [{ field: 'revenue', agg: 'sum', as: 'revenue' }] },
    { op: 'sort', by: 'revenue', order: 'desc' },
  ]);

  assert.equal(table.length, 3);
  assert.deepEqual(table[0], { region: 'East', revenue: 250 });
  assert.equal(summary.rowCount, 3);
  assert.deepEqual(summary.columns, ['region', 'revenue']);
  assert.equal(summary.truncated, false, 'three rows fit in the preview');
});

test('the model-facing summary never carries the whole table', () => {
  const big: Row[] = Array.from({ length: 500 }, (_, i) => ({ i, value: i * 2 }));
  const { table, summary } = runQuery(big, [{ op: 'aggregate', group_by: ['i'], measures: [] }]);

  assert.equal(table.length, 500, 'the caller still receives every row');
  assert.equal(summary.rowCount, 500, 'and the true size is disclosed to the model');
  assert.equal(summary.truncated, true);
  assert.ok(summary.previewRows.length <= 3, 'preview is capped');

  // The summary is the only thing the loop hands to the model, so this
  // assertion is the architectural invariant: no full dataset leaks into it.
  const serialized = JSON.stringify(summary);
  assert.ok(serialized.length < 1000, `summary stayed small (${serialized.length} chars)`);
});

test('runQuery surfaces transform errors so the loop can repair them', () => {
  assert.throws(
    () => runQuery(rows, [{ op: 'aggregate', group_by: [], measures: [{ field: 'revenue', agg: 'nope' as 'sum', as: 'x' }] }]),
    /unknown aggregation 'nope'/,
  );
});

test('createToolHandlers binds both tools to one dataset', () => {
  const handlers = createToolHandlers({ rows });

  const profile = handlers.describe_table?.({}) as { rowCount: number };
  assert.equal(profile.rowCount, 4);

  const result = handlers.run_query?.({
    steps: [{ op: 'aggregate', group_by: [], measures: [{ field: 'revenue', agg: 'sum', as: 'total' }] }],
  }) as { summary: { rowCount: number }; table: Row[] };
  assert.equal(result.summary.rowCount, 1);
  assert.deepEqual(result.table, [{ total: 370 }]);
});

test('run_query rejects a missing steps array', () => {
  const handlers = createToolHandlers({ rows });
  assert.throws(() => handlers.run_query?.({}), /needs a "steps" array/);
});

// ─────────────────────────────────────────────────────────────────────────────
// preview_rows: a bounded, read-only look at the table.
//
// The bound is the point. It always returns the FIRST rows, and there is no way
// to ask for a different window — so a model cannot page through a table by
// calling it repeatedly, however many rounds it is given. What it bounds is a
// count, not a proportion: a table of twenty rows or fewer can be seen whole,
// which is a deliberate, documented decision rather than an oversight.
// ─────────────────────────────────────────────────────────────────────────────

const manyRows: Row[] = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, value: (index + 1) * 10 }));

test('preview_rows returns three rows by default', () => {
  const preview = previewRows(manyRows, {});
  assert.equal(preview.rows.length, 3);
  assert.deepEqual(preview.rows.map((r) => r.id), [1, 2, 3]);
});

test('the model may ask for up to twenty rows, and no more', () => {
  assert.equal(previewRows(manyRows, { limit: 20 }).rows.length, 20);
  assert.equal(previewRows(manyRows, { limit: 5 }).rows.length, 5);
  assert.equal(previewRows(manyRows, { limit: 1 }).rows.length, 1);
  assert.throws(
    () => previewRows(manyRows, { limit: 21 }),
    /between 1 and 20/,
    'the ceiling belongs to the tool, not to the model',
  );
  assert.throws(() => previewRows(manyRows, { limit: 500 }), /between 1 and 20/);
});

test('the ceiling the model is told is the ceiling that is enforced', () => {
  // The one way this feature can go wrong: a schema that advertises a larger number
  // than the handler allows, so the model asks for something legal-looking, is
  // refused, and burns a round. Read the number out of the tool definition and push
  // it through the handler rather than trusting that the two were edited together.
  const tool = buildToolDefs('present').find((definition) => definition.name === 'preview_rows');
  const properties = tool?.parameters.properties as { limit?: { maximum?: number } } | undefined;
  const advertised = properties?.limit?.maximum;
  assert.equal(typeof advertised, 'number');

  const handlers = createToolHandlers({ rows: manyRows });
  const atCeiling = handlers.preview_rows?.({ limit: advertised }) as { rows: Row[] };
  assert.equal(atCeiling.rows.length, advertised, 'the advertised maximum is allowed');
  assert.throws(
    () => handlers.preview_rows?.({ limit: (advertised as number) + 1 }),
    /between 1 and 20/,
    'one more than advertised is refused',
  );
});

test('an unusable limit is refused with a message that says what is allowed', () => {
  for (const limit of [0, -3, 2.5]) {
    assert.throws(() => previewRows(manyRows, { limit }), /integer between 1 and 20/);
  }
});

test('an explicit null limit is refused, not quietly swapped for the default', () => {
  // `options.limit ?? DEFAULT` turned null into the default and returned three rows
  // as though three had been asked for.
  assert.throws(
    () => previewRows(manyRows, { limit: null as unknown as number }),
    /integer between 1 and 20/,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// The model's arguments versus the caller's policy.
//
// A tool call's arguments used to be spread over the profiling options, so a model
// could set `sampleValues` itself — over the top of `profile: { sampleValues: 0 }`.
// The arguments and the caller's settings are not the same kind of thing.
// ─────────────────────────────────────────────────────────────────────────────

test('describe_table takes no arguments, so the model cannot set the caller policy', () => {
  const handlers = createToolHandlers({ rows, profile: { sampleValues: 0 } });

  const profile = handlers.describe_table?.({}) as { columns: Array<{ sampleValues?: unknown }> };
  assert.equal(profile.columns.every((column) => column.sampleValues === undefined), true, 'sampleValues: 0 honoured');

  assert.throws(
    () => handlers.describe_table?.({ sampleValues: 999 }),
    /'sampleValues' is not a parameter/,
    'and it cannot be raised back up from the model side',
  );
});

test('describe_table reports the type the caller declared, not the one inference guessed', () => {
  // Without this, the prompt says one thing about a column and the tool says another.
  const rowsWithId: Row[] = [
    { trade_id: 1001, revenue: 10 },
    { trade_id: 1002, revenue: 20 },
  ];
  const inferred = describeTable(rowsWithId);
  assert.equal(inferred.columns.find((c) => c.name === 'trade_id')?.type, 'number');

  const declared = describeTable(rowsWithId, {}, [
    { name: 'trade_id', type: 'string' },
    { name: 'revenue', type: 'number' },
  ]);
  const tradeId = declared.columns.find((c) => c.name === 'trade_id');
  assert.equal(tradeId?.type, 'string', 'the declaration wins');
  assert.equal(tradeId?.min, '1001', 'and the profile follows the declared type');
  assert.equal(tradeId?.p50, undefined, 'a string column has no numeric median');
  assert.equal(declared.columns.find((c) => c.name === 'revenue')?.p50, 15, 'undeclared columns are unaffected');

  // A declaration for a column that does not exist cannot change anything.
  const ghost = describeTable(rowsWithId, {}, [{ name: 'ghost', type: 'string' }]);
  assert.deepEqual(ghost.columns, inferred.columns);
});

test('a declaration that contradicts the values costs a thinner profile, not a wrong one', () => {
  const rowsWithText: Row[] = [{ code: 'AB', amount: 5 }];
  const declared = describeTable(rowsWithText, {}, [{ name: 'code', type: 'number' }]);
  const code = declared.columns.find((c) => c.name === 'code');
  assert.equal(code?.type, 'number');
  assert.equal(code?.min, undefined, 'no numeric range, rather than a bogus one');
});

test('run_query also refuses arguments it did not declare', () => {
  const handlers = createToolHandlers({ rows });
  assert.throws(() => handlers.run_query?.({ steps: [], limit: 3 }), /'limit' is not a parameter/);
});

// ─────────────────────────────────────────────────────────────────────────────
// The exported tool definitions are copies, not the library's own objects.
// ─────────────────────────────────────────────────────────────────────────────

test('editing a tool definition you were handed does not edit the library', () => {
  const mine = buildToolDefs('present');
  const submit = mine.find((definition) => definition.name === 'submit_spec');
  (submit?.parameters.properties as Record<string, unknown>).sneaky = { type: 'string' };

  const fresh = buildToolDefs('present').find((definition) => definition.name === 'submit_spec');
  assert.equal(
    (fresh?.parameters.properties as Record<string, unknown>).sneaky,
    undefined,
    'the next caller gets a clean definition',
  );

  // The two submit_spec variants used to share one `properties` object.
  const ask = buildToolDefs('ask').find((definition) => definition.name === 'submit_spec');
  assert.equal((ask?.parameters.properties as Record<string, unknown>).sneaky, undefined);
});

test('the preview always starts at the first row — there is no offset to page with', () => {
  const handlers = createToolHandlers({ rows: manyRows });
  assert.throws(
    () => handlers.preview_rows?.({ offset: 10, limit: 5 }),
    /'offset' is not a parameter/,
    'silently ignoring it would let the model believe it had read rows 10-14',
  );
  assert.throws(() => handlers.preview_rows?.({ startAt: 10 }), /not a parameter/);
});

test('the preview reports the size of the whole table, so the model knows what it is not seeing', () => {
  const preview = previewRows(manyRows, {});
  assert.equal(preview.rowCount, 40);
  assert.equal(preview.truncated, true);

  const whole = previewRows(manyRows.slice(0, 2), {});
  assert.deepEqual(whole.rows.map((r) => r.id), [1, 2]);
  assert.equal(whole.rowCount, 2);
  assert.equal(whole.truncated, false, 'nothing is being withheld');
});

test('a short or empty table returns what there is rather than throwing', () => {
  assert.equal(previewRows([], {}).rows.length, 0);
  assert.equal(previewRows([], {}).rowCount, 0);
  assert.equal(previewRows([], {}).truncated, false);
  assert.equal(previewRows([{ only: 'row' }], { limit: 5 }).rows.length, 1);
});

test('the preview returns the rows as they are, keys and values untouched', () => {
  const preview = previewRows(rows, {});
  assert.deepEqual(preview.rows[0], rows[0], 'no reshaping, no coercion, no added columns');
  assert.equal(preview.rows[0] === rows[0], true, 'and not a copy that could drift');
});

test('a column reference declares exactly one field', () => {
  // `encodings.x` used to accept extra keys, which is how a model that guessed
  // `value_type` got a different axis from every other caller. One field, and the
  // schema says so.
  const submit = buildToolDefs('ask').find((definition) => definition.name === 'submit_spec');
  const encodings = (submit?.parameters.properties as {
    encodings: { properties: Record<string, { additionalProperties?: boolean; properties?: Record<string, unknown> }> };
  }).encodings;

  for (const channel of ['x', 'y', 'series']) {
    const schema = encodings.properties[channel];
    assert.equal(schema?.additionalProperties, false, `${channel} refuses keys it does not declare`);
    assert.deepEqual(Object.keys(schema?.properties ?? {}), ['field'], `${channel} declares only 'field'`);
  }
});

test('createToolHandlers exposes preview_rows alongside the rest', () => {
  const handlers = createToolHandlers({ rows: manyRows });
  const preview = handlers.preview_rows?.({ limit: 2 }) as { rows: Row[] };
  assert.deepEqual(preview.rows.map((r) => r.id), [1, 2]);
});
