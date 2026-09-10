import assert from 'node:assert/strict';
import test from 'node:test';

import { applyTransform, binDate } from '../src/transform.ts';
import type { Row } from '../src/types.ts';

const rows: Row[] = [
  { region: 'East', month: '2026-01-05', revenue: 100, cost: 60 },
  { region: 'East', month: '2026-02-05', revenue: 150, cost: 90 },
  { region: 'West', month: '2026-01-20', revenue: 80, cost: 50 },
  { region: 'West', month: '2026-04-02', revenue: 200, cost: 120 },
];

test('aggregate sums and groups', () => {
  const out = applyTransform(rows, [
    { op: 'aggregate', group_by: ['region'], measures: [{ field: 'revenue', agg: 'sum', as: 'revenue' }] },
    { op: 'sort', by: 'region', order: 'asc' },
  ]);
  assert.deepEqual(out, [
    { region: 'East', revenue: 250 },
    { region: 'West', revenue: 280 },
  ]);
});

test('aggregate supports count, countDistinct, avg, min, max and keeps only group_by + measures', () => {
  const out = applyTransform(rows, [
    {
      op: 'aggregate',
      group_by: ['region'],
      measures: [
        { agg: 'count', as: 'n' },
        { field: 'month', agg: 'countDistinct', as: 'months' },
        { field: 'revenue', agg: 'avg', as: 'avg_rev' },
        { field: 'revenue', agg: 'min', as: 'min_rev' },
        { field: 'revenue', agg: 'max', as: 'max_rev' },
      ],
    },
    { op: 'sort', by: 'region', order: 'asc' },
  ]);
  assert.deepEqual(out[0], { region: 'East', n: 2, months: 2, avg_rev: 125, min_rev: 100, max_rev: 150 });
  assert.deepEqual(out[1], { region: 'West', n: 2, months: 2, avg_rev: 140, min_rev: 80, max_rev: 200 });
});

test('aggregate with an empty group_by collapses to a single row', () => {
  const out = applyTransform(rows, [
    { op: 'aggregate', group_by: [], measures: [{ field: 'revenue', agg: 'sum', as: 'total' }] },
  ]);
  assert.deepEqual(out, [{ total: 530 }]);
});

test('an unknown aggregation throws instead of silently dropping the column', () => {
  assert.throws(
    () =>
      applyTransform(rows, [
        { op: 'aggregate', group_by: [], measures: [{ field: 'revenue', agg: 'median' as 'sum', as: 'm' }] },
      ]),
    /unknown aggregation 'median'/,
  );
});

test('an unknown transform op throws', () => {
  assert.throws(
    () => applyTransform(rows, [{ op: 'pivot' } as never]),
    /unknown transform op 'pivot'/,
  );
});

test('filter supports eq, in, between and contains', () => {
  assert.equal(applyTransform(rows, [{ op: 'filter', field: 'region', operator: 'eq', value: 'East' }]).length, 2);
  assert.equal(
    applyTransform(rows, [{ op: 'filter', field: 'region', operator: 'in', values: ['West'] }]).length,
    2,
  );
  assert.equal(
    applyTransform(rows, [{ op: 'filter', field: 'revenue', operator: 'between', values: [100, 200] }]).length,
    3,
  );
  assert.equal(applyTransform(rows, [{ op: 'filter', field: 'month', operator: 'contains', value: '-01' }]).length, 2);
});

test('filter between with fewer than two values is rejected', () => {
  assert.throws(
    () => applyTransform(rows, [{ op: 'filter', field: 'revenue', operator: 'between', values: [1] }]),
    /needs two values/,
  );
});

test('sort defaults to ascending and supports descend', () => {
  const asc = applyTransform(rows, [{ op: 'sort', by: 'revenue' }]).map((r) => r.revenue);
  const desc = applyTransform(rows, [{ op: 'sort', by: 'revenue', order: 'desc' }]).map((r) => r.revenue);
  assert.deepEqual(asc, [80, 100, 150, 200]);
  assert.deepEqual(desc, [200, 150, 100, 80]);
});

test('sorting by a column that is not there is rejected rather than silently ignored', () => {
  assert.throws(
    () => applyTransform(rows, [{ op: 'sort', by: 'nope', order: 'desc' }]),
    /sort field 'nope' is not in the table \(available: region, month, revenue, cost\)/,
  );
});

test('limit slices and rejects nonsense', () => {
  assert.equal(applyTransform(rows, [{ op: 'limit', n: 2 }]).length, 2);
  assert.throws(() => applyTransform(rows, [{ op: 'limit', n: -1 }]), /non-negative integer/);
  assert.throws(() => applyTransform(rows, [{ op: 'limit', n: 1.5 }]), /non-negative integer/);
});

test('derive chains two steps and nulls division by zero', () => {
  const out = applyTransform(rows, [
    { op: 'derive', as: 'margin', left: { field: 'revenue' }, operator: 'subtract', right: { field: 'cost' } },
    { op: 'derive', as: 'margin_pct', left: { field: 'margin' }, operator: 'divide', right: { field: 'revenue' } },
  ]);
  assert.equal(out[0]?.margin, 40);
  assert.equal(out[0]?.margin_pct, 0.4);

  const zero = applyTransform([{ a: 5, b: 0 }], [
    { op: 'derive', as: 'q', left: { field: 'a' }, operator: 'divide', right: { field: 'b' } },
  ]);
  assert.deepEqual(zero, [{ a: 5, b: 0, q: null }]);
});

test('binTime produces month, quarter and year labels and nulls bad dates', () => {
  assert.equal(binDate('2026-01-05', 'month'), '2026-01');
  assert.equal(binDate('2026-04-02', 'quarter'), '2026-Q2');
  assert.equal(binDate('2026-04-02', 'year'), '2026');
  assert.equal(binDate('not-a-date', 'month'), null);
  assert.equal(binDate(null, 'month'), null);

  const out = applyTransform([{ d: '2026-01-05' }, { d: '2026-04-02' }], [
    { op: 'binTime', field: 'd', granularity: 'quarter', as: 'q' },
  ]);
  assert.deepEqual(out, [{ d: '2026-01-05', q: '2026-Q1' }, { d: '2026-04-02', q: '2026-Q2' }]);
});

test('transform never mutates the input rows', () => {
  const input: Row[] = [{ region: 'East', revenue: 10 }];
  const snapshot = structuredClone(input);
  applyTransform(input, [
    { op: 'aggregate', group_by: ['region'], measures: [{ field: 'revenue', agg: 'sum', as: 'revenue' }] },
  ]);
  assert.deepEqual(input, snapshot);
});

test('an empty plan is a no-op', () => {
  assert.deepEqual(applyTransform(rows, []), rows);
});
