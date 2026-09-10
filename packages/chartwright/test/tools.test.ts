import assert from 'node:assert/strict';
import test from 'node:test';

import { createToolHandlers, describeTable, inferColumns, runQuery } from '../src/tools.ts';
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
