import assert from 'node:assert/strict';
import test from 'node:test';

import { compileToHighcharts } from '../src/compile/index.ts';
import type { ChartSpec, EmphasisRule, Row } from '../src/types.ts';

const rows: Row[] = [
  { region: 'East', revenue: 100 },
  { region: 'West', revenue: 380 },
  { region: 'North', revenue: 240 },
];

const AGGREGATE = {
  op: 'aggregate' as const,
  group_by: ['region'],
  measures: [{ field: 'revenue', agg: 'sum' as const, as: 'revenue' }],
};

function spec(chart: ChartSpec['chart'], emphasis?: EmphasisRule[]): ChartSpec {
  return {
    schema_version: 1,
    chart,
    transform_plan: { steps: [AGGREGATE] },
    encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
    ...(emphasis ? { emphasis } : {}),
  };
}

/** Reads the per-point colour out of the compiled categorical series. */
function coloured(options: Record<string, unknown>): Array<{ category: string; value: number; color?: string; label?: boolean }> {
  const categories = (options.xAxis as { categories: string[] }).categories;
  const data = (options.series as Array<{ data: unknown[] }>)[0]?.data ?? [];
  return categories.map((category, index) => {
    const datum = data[index];
    if (typeof datum === 'object' && datum !== null) {
      const point = datum as { y: number; color?: string; dataLabels?: { enabled?: boolean } };
      return { category, value: point.y, ...(point.color ? { color: point.color } : {}), label: point.dataLabels?.enabled === true };
    }
    return { category, value: Number(datum) };
  });
}

test('top_k highlights the largest datum, chosen by the compiler from the real data', () => {
  const { options } = compileToHighcharts(
    spec({ type: 'bar', orientation: 'horizontal' }, [
      { when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight' } },
    ]),
    rows,
  );

  const points = coloured(options);
  const highlighted = points.filter((p) => p.color);
  assert.equal(highlighted.length, 1);
  assert.equal(highlighted[0]?.category, 'West', 'the compiler found the maximum itself');
  assert.equal(highlighted[0]?.value, 380);
});

test('the highlight is keyed by category value, not position', () => {
  // The category axis is reversed for horizontal bars, so a positional mapping
  // would style the wrong bar. Assert the colour travels with the category.
  const { options } = compileToHighcharts(
    spec({ type: 'bar', orientation: 'horizontal' }, [
      { when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight' } },
    ]),
    rows,
  );
  const horizontal = coloured(options);
  assert.equal(horizontal.find((p) => p.category === 'West')?.color !== undefined, true);

  const { options: verticalOptions } = compileToHighcharts(
    spec({ type: 'bar' }, [{ when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight' } }]),
    rows,
  );
  const vertical = coloured(verticalOptions);
  assert.equal(vertical.find((p) => p.category === 'West')?.color !== undefined, true);
});

test('ties at the k-th value are all included rather than picked arbitrarily', () => {
  const tied: Row[] = [
    { region: 'East', revenue: 100 },
    { region: 'West', revenue: 300 },
    { region: 'North', revenue: 300 },
  ];
  const { options } = compileToHighcharts(
    spec({ type: 'bar' }, [{ when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight' } }]),
    tied,
  );
  const highlighted = coloured(options).filter((p) => p.color).map((p) => p.category);
  assert.deepEqual(highlighted, ['West', 'North']);
});

test('direction "min" highlights the smallest', () => {
  const { options } = compileToHighcharts(
    spec({ type: 'bar' }, [
      { when: { op: 'top_k', k: 1, field: 'revenue', direction: 'min' }, style: { tone: 'highlight' } },
    ]),
    rows,
  );
  assert.deepEqual(coloured(options).filter((p) => p.color).map((p) => p.category), ['East']);
});

test('"mute everything, then highlight one" reads exactly as it sounds (later rule wins)', () => {
  const { options } = compileToHighcharts(
    spec({ type: 'bar' }, [
      { when: { op: 'gte', field: 'revenue', value: 0 }, style: { tone: 'muted', label: false } },
      { when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight', label: true } },
    ]),
    rows,
  );

  const points = coloured(options);
  assert.equal(points.every((p) => p.color !== undefined), true, 'every point is styled');
  const west = points.find((p) => p.category === 'West');
  const east = points.find((p) => p.category === 'East');
  assert.equal(west?.color, '#e8590c', 'the last matching rule wins');
  assert.equal(west?.label, true);
  assert.equal(east?.color, '#c9ced6');
  assert.equal(east?.label, false);
});

test('a named category can be emphasised with eq — the user named it, not the model', () => {
  const { options } = compileToHighcharts(
    spec({ type: 'bar' }, [{ when: { op: 'eq', field: 'region', value: 'North' }, style: { tone: 'highlight' } }]),
    rows,
  );
  assert.deepEqual(coloured(options).filter((p) => p.color).map((p) => p.category), ['North']);
});

test('a rule that matches nothing warns instead of silently doing nothing', () => {
  const { options, warnings } = compileToHighcharts(
    spec({ type: 'bar' }, [{ when: { op: 'gte', field: 'revenue', value: 99999 }, style: { tone: 'highlight' } }]),
    rows,
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] as string, /emphasis rule gte on 'revenue' matched no rows/);
  assert.equal(coloured(options).some((p) => p.color), false);
});

test('top_k on a field that is not a numeric column of the chart warns and styles nothing', () => {
  const { options, warnings } = compileToHighcharts(
    spec({ type: 'bar' }, [{ when: { op: 'top_k', k: 1, field: 'nope' }, style: { tone: 'highlight' } }]),
    rows,
  );
  assert.match(warnings[0] as string, /references 'nope'/);
  assert.equal(coloured(options).some((p) => p.color), false);
});

test('an emphasis-free spec compiles exactly as it did before the feature existed', () => {
  const { options, warnings } = compileToHighcharts(spec({ type: 'bar' }), rows);
  assert.deepEqual(warnings, []);
  const data = (options.series as Array<{ data: unknown[] }>)[0]?.data;
  assert.deepEqual(data, [100, 380, 240], 'plain numbers, no per-point objects');
});

test('emphasis works on a pie, keyed by slice name', () => {
  const { options } = compileToHighcharts(
    {
      schema_version: 1,
      chart: { type: 'pie' },
      transform_plan: { steps: [AGGREGATE] },
      encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
      emphasis: [{ when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'muted' } }],
    },
    rows,
  );
  const slices = (options.series as Array<{ data: Array<{ name: string; y: number; color?: string }> }>)[0]?.data ?? [];
  assert.deepEqual(
    slices.map((slice) => [slice.name, slice.color]),
    [
      ['East', undefined],
      ['West', '#c9ced6'],
      ['North', undefined],
    ],
  );
});

test('emphasis on a temporal line colours matching markers', () => {
  const temporal: Row[] = [
    { month: '2026-01-01', revenue: 10 },
    { month: '2026-02-01', revenue: 99 },
  ];
  const { options } = compileToHighcharts(
    {
      schema_version: 1,
      chart: { type: 'line' },
      encodings: { x: { field: 'month', value_type: 'temporal' }, y: { field: 'revenue' } },
      emphasis: [{ when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight' } }],
    },
    temporal,
  );
  const data = (options.series as Array<{ data: unknown[] }>)[0]?.data ?? [];
  assert.deepEqual(data[0], [Date.parse('2026-01-01'), 10], 'unstyled points stay pairs');
  assert.deepEqual(data[1], { x: Date.parse('2026-02-01'), y: 99, color: '#e8590c' });
});
