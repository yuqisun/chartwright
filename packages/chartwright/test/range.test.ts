import assert from 'node:assert/strict';
import test from 'node:test';
import { compileToHighcharts } from '../src/compile/index.ts';
import type { Row } from '../src/types.ts';

test('arearange compiles with correct data format', () => {
  const rows: Row[] = [
    { month: 'Jan', low: 10, high: 25 },
    { month: 'Feb', low: 12, high: 28 },
    { month: 'Mar', low: 15, high: 30 },
  ];
  const { options } = compileToHighcharts(
    { chart: { type: 'arearange' }, encodings: { x: { field: 'month' }, low: { field: 'low' }, high: { field: 'high' } } },
    rows,
  );
  assert.equal((options.chart as Record<string, string>).type, 'arearange');
  const series = options.series as Array<{ data: Array<[number, number, number] | null> }>;
  assert.equal(series.length, 1);
  assert.deepEqual(series[0].data[0], [0, 10, 25]);
  assert.deepEqual(series[0].data[1], [1, 12, 28]);
  assert.deepEqual(series[0].data[2], [2, 15, 30]);
});

test('columnrange, errorbar, dumbbell, areasplinerange all compile', () => {
  const rows: Row[] = [{ x: 'A', low: 1, high: 5 }, { x: 'B', low: 2, high: 6 }];
  for (const type of ['columnrange', 'errorbar', 'dumbbell', 'areasplinerange'] as const) {
    const { options } = compileToHighcharts(
      { chart: { type }, encodings: { x: { field: 'x' }, low: { field: 'low' }, high: { field: 'high' } } },
      rows,
    );
    assert.equal((options.chart as Record<string, string>).type, type);
    const series = options.series as Array<{ data: unknown[] }>;
    assert.equal(series[0].data.length, 2);
  }
});

test('range type refuses duplicate categories', () => {
  const rows: Row[] = [
    { month: 'Jan', low: 10, high: 25 },
    { month: 'Jan', low: 12, high: 28 },
  ];
  assert.throws(
    () => compileToHighcharts(
      { chart: { type: 'arearange' }, encodings: { x: { field: 'month' }, low: { field: 'low' }, high: { field: 'high' } } },
      rows,
    ),
    /more than one row for category/,
  );
});

test('range type with series encoding', () => {
  const rows: Row[] = [
    { month: 'Jan', region: 'East', low: 10, high: 25 },
    { month: 'Feb', region: 'East', low: 12, high: 28 },
    { month: 'Jan', region: 'West', low: 8, high: 20 },
    { month: 'Feb', region: 'West', low: 9, high: 22 },
  ];
  const { options } = compileToHighcharts(
    {
      chart: { type: 'arearange' },
      encodings: { x: { field: 'month' }, low: { field: 'low' }, high: { field: 'high' }, series: { field: 'region' } },
    },
    rows,
  );
  const series = options.series as Array<{ name: string; data: Array<[number, number, number] | null> }>;
  assert.equal(series.length, 2);
  // First series (East) should have data for Jan and Feb
  assert.deepEqual(series[0].data[0], [0, 10, 25]);
  assert.deepEqual(series[0].data[1], [1, 12, 28]);
});

test('range type handles null values', () => {
  const rows: Row[] = [
    { month: 'Jan', low: 10, high: 25 },
    { month: 'Feb', low: null, high: null },
    { month: 'Mar', low: 15, high: 30 },
  ];
  const { options } = compileToHighcharts(
    { chart: { type: 'arearange' }, encodings: { x: { field: 'month' }, low: { field: 'low' }, high: { field: 'high' } } },
    rows,
  );
  const series = options.series as Array<{ data: Array<[number, number, number] | null> }>;
  assert.equal(series[0].data[0]?.[0], 0);
  assert.equal(series[0].data[1], null);
  assert.equal(series[0].data[2]?.[0], 2);
});
