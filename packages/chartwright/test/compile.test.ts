import assert from 'node:assert/strict';
import test from 'node:test';

import { compileToHighcharts } from '../src/compile/simple.ts';
import type { ChartSpec, Row } from '../src/types.ts';

const rows: Row[] = [
  { region: 'East', month: '2026-01-05', revenue: 100, segment: 'Retail' },
  { region: 'West', month: '2026-01-20', revenue: 80, segment: 'Retail' },
  { region: 'East', month: '2026-02-05', revenue: 150, segment: 'Institutional' },
];

const spec = (over: Partial<ChartSpec> & Pick<ChartSpec, 'chart' | 'encodings'>): ChartSpec => ({
  schema_version: 1,
  ...over,
});

test('bar renders vertical columns by default and aligns data to categories', () => {
  const { options, dataset } = compileToHighcharts(
    spec({
      chart: { type: 'bar', title: 'Revenue' },
      transform_plan: {
        steps: [
          { op: 'aggregate', group_by: ['region'], measures: [{ field: 'revenue', agg: 'sum', as: 'revenue' }] },
        ],
      },
      encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
    }),
    rows,
  );

  assert.deepEqual((options.chart as { type: string }).type, 'column');
  assert.deepEqual((options.xAxis as { categories: string[] }).categories, ['East', 'West']);
  const series = options.series as Array<{ name: string; data: unknown[] }>;
  assert.equal(series.length, 1);
  assert.deepEqual(series[0]?.data, [250, 80]);
  assert.equal(dataset.length, 2);
});

test('two rows in one category are rejected rather than silently collapsed', () => {
  // Without the aggregate step, East appears twice. Choosing one value (or
  // summing them) would change the chart silently, so the compiler refuses and
  // says what to do — the loop hands that back to the model to repair.
  assert.throws(
    () =>
      compileToHighcharts(
        spec({ chart: { type: 'bar' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } }),
        rows,
      ),
    /more than one row for category 'East'.*Add an aggregate step/s,
  );
});

test('orientation horizontal switches to the library horizontal type', () => {
  const { options } = compileToHighcharts(
    spec({
      chart: { type: 'bar', orientation: 'horizontal' },
      transform_plan: {
        steps: [
          { op: 'aggregate', group_by: ['region'], measures: [{ field: 'revenue', agg: 'sum', as: 'revenue' }] },
        ],
      },
      encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
    }),
    rows,
  );
  assert.equal((options.chart as { type: string }).type, 'bar');
});

test('a series encoding produces one series per group, aligned to the shared categories', () => {
  const { options } = compileToHighcharts(
    spec({
      chart: { type: 'bar' },
      encodings: { x: { field: 'region' }, y: { field: 'revenue' }, series: { field: 'segment' } },
    }),
    rows,
  );

  const series = options.series as Array<{ name: string; data: unknown[] }>;
  assert.deepEqual(series.map((s) => s.name).sort(), ['Institutional', 'Retail']);
  // Retail exists in both regions; Institutional only in East.
  const retail = series.find((s) => s.name === 'Retail');
  const institutional = series.find((s) => s.name === 'Institutional');
  assert.deepEqual(retail?.data, [100, 80]);
  assert.deepEqual(institutional?.data, [150, null]);
  assert.deepEqual(options.legend, { enabled: true });
});

test('temporal x uses a datetime axis with sorted [ms, value] pairs', () => {
  const { options } = compileToHighcharts(
    spec({
      chart: { type: 'line' },
      encodings: { x: { field: 'month', value_type: 'temporal' }, y: { field: 'revenue' } },
    }),
    rows,
  );

  assert.deepEqual(options.xAxis, { type: 'datetime', title: { text: 'month' } });
  const data = (options.series as Array<{ data: Array<[number, number]> }>)[0]?.data ?? [];
  assert.equal(data.length, 3);
  assert.ok(data[0]![0] < data[1]![0], 'sorted ascending by time');
  assert.deepEqual(data[0], [Date.parse('2026-01-05'), 100]);
});

test('pie renders name/value pairs from the transformed table', () => {
  const { options } = compileToHighcharts(
    spec({
      chart: { type: 'pie', title: 'Share' },
      transform_plan: {
        steps: [
          { op: 'aggregate', group_by: ['region'], measures: [{ field: 'revenue', agg: 'sum', as: 'revenue' }] },
        ],
      },
      encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
    }),
    rows,
  );

  const series = options.series as Array<{ type: string; data: Array<{ name: string; y: number }> }>;
  assert.equal(series[0]?.type, 'pie');
  assert.deepEqual(series[0]?.data, [
    { name: 'East', y: 250 },
    { name: 'West', y: 80 },
  ]);
});

test('the returned dataset is exactly the table that was plotted', () => {
  const { dataset } = compileToHighcharts(
    spec({
      chart: { type: 'bar' },
      transform_plan: {
        steps: [
          { op: 'aggregate', group_by: ['region'], measures: [{ field: 'revenue', agg: 'sum', as: 'revenue' }] },
          { op: 'sort', by: 'revenue', order: 'asc' },
        ],
      },
      encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
    }),
    rows,
  );
  assert.deepEqual(dataset, [
    { region: 'West', revenue: 80 },
    { region: 'East', revenue: 250 },
  ]);
});

test('an unsupported chart type is rejected instead of half-built', () => {
  assert.throws(
    () =>
      compileToHighcharts(
        spec({ chart: { type: 'sankey' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } }),
        rows,
      ),
    /not supported by the built-in compiler/,
  );
});

test('an encoding that names a column missing from the produced table is rejected', () => {
  assert.throws(
    () =>
      compileToHighcharts(
        spec({
          chart: { type: 'bar' },
          transform_plan: {
            steps: [
              { op: 'aggregate', group_by: ['region'], measures: [{ field: 'revenue', agg: 'sum', as: 'total' }] },
            ],
          },
          encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
        }),
        rows,
      ),
    /'revenue' is not in the produced table \(available: region, total\)/,
  );
});

test('compiling never mutates the input rows', () => {
  const input: Row[] = [{ region: 'East', revenue: 10 }];
  const snapshot = structuredClone(input);
  compileToHighcharts(
    spec({ chart: { type: 'bar' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } }),
    input,
  );
  assert.deepEqual(input, snapshot);
});
