import assert from 'node:assert/strict';
import test from 'node:test';

import { validateChartPlan } from '../src/plans.ts';
import { runQuery } from '../src/tools.ts';
import type { Row, TransformStep } from '../src/types.ts';

const AGGREGATE: TransformStep = {
  op: 'aggregate',
  group_by: ['region'],
  measures: [{ field: 'revenue', agg: 'sum', as: 'revenue' }],
};
const SORT: TransformStep = { op: 'sort', by: 'revenue', order: 'desc' };
const LIMIT: TransformStep = { op: 'limit', n: 5 };

test('a limit straight after an aggregate is rejected', () => {
  assert.throws(() => validateChartPlan([AGGREGATE, LIMIT]), /which rows survive is arbitrary/);
});

test('a sort between the aggregate and the limit is accepted', () => {
  validateChartPlan([AGGREGATE, SORT, LIMIT]);
});

test('a sort before the aggregate does not count — the aggregate discards that order', () => {
  assert.throws(() => validateChartPlan([SORT, AGGREGATE, LIMIT]), /which rows survive is arbitrary/);
});

test('limiting a raw table is a plain slice and stays allowed', () => {
  validateChartPlan([LIMIT]);
  validateChartPlan([{ op: 'filter', field: 'status', operator: 'eq', value: 'Failed' }, LIMIT]);
});

test('the error message tells the model what to add', () => {
  try {
    validateChartPlan([AGGREGATE, LIMIT]);
    assert.fail('expected a throw');
  } catch (error) {
    const message = (error as Error).message;
    assert.match(message, /"limit: 5" follows an aggregate/);
    assert.match(message, /"op": "sort"/);
  }
});

test('runQuery surfaces the problem instead of charting arbitrary rows', () => {
  const rows: Row[] = [
    { region: 'East', revenue: 100 },
    { region: 'West', revenue: 80 },
    { region: 'North', revenue: 300 },
  ];
  assert.throws(() => runQuery(rows, [AGGREGATE, LIMIT]), /which rows survive is arbitrary/);
  // The corrected plan runs and keeps the right rows.
  const { table } = runQuery(rows, [AGGREGATE, SORT, LIMIT]);
  assert.deepEqual(table.map((r) => r.region), ['North', 'East', 'West']);
});
