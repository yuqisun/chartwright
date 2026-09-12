/**
 * The theme layer: roles, resolution, and what the backend spends them on.
 *
 * Three things are worth guarding here, and each has failed in a library somewhere:
 *
 *   - an override must not be able to leave a role unresolved (a half-applied brand is
 *     two house styles in one chart), so merging is tested group by group;
 *   - the palette must never cycle, because two series in one colour is a lie about the
 *     data rather than a shortage of paint;
 *   - the colours a chart draws with must come from the type's declaration, not from a
 *     second branch on the kind — so a heatmap gets a ramp and no palette, and a bar
 *     gets a palette and no ramp, and a test says so.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CHART_TYPES, CHART_TYPE_NAMES } from '../src/compile/chart-types.ts';
import { compileToHighcharts } from '../src/compile/index.ts';
import { defaultTheme, resolveTheme, roleColors, seriesColors } from '../src/compile/theme.ts';
import type { ChartOptions } from '../src/compile/index.ts';
import type { ChartSpec, Row } from '../src/types.ts';

const rows: Row[] = [
  { region: 'East', desk: 'Rates', revenue: 250 },
  { region: 'West', desk: 'FX', revenue: 80 },
  { region: 'North', desk: 'Equities', revenue: 120 },
];

const barSpec: ChartSpec = { chart: { type: 'bar' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } };
const twoSeriesSpec: ChartSpec = {
  chart: { type: 'bar' },
  encodings: { x: { field: 'region' }, y: { field: 'revenue' }, series: { field: 'desk' } },
};
const pieSpec: ChartSpec = { chart: { type: 'pie' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } };
const heatmapSpec: ChartSpec = {
  chart: { type: 'heatmap' },
  encodings: { x: { field: 'region' }, y: { field: 'revenue' }, series: { field: 'desk' } },
};

test('no theme means the default theme, exactly', () => {
  assert.deepEqual(resolveTheme(undefined), defaultTheme);
  assert.deepEqual(resolveTheme({}), defaultTheme, 'an empty override is not a theme of its own');
});

test('an override merges group by group and leaves the rest of the house standing', () => {
  const theme = resolveTheme({
    id: 'acme',
    roles: {
      text: { primary: '#101828' },
      series: { categorical: ['#111111', '#222222'] },
    },
  });

  assert.equal(theme.id, 'acme');
  assert.equal(theme.label, defaultTheme.label, 'an unnamed override keeps the default label');
  assert.equal(theme.roles.text.primary, '#101828', 'the overridden role moves');
  assert.equal(theme.roles.text.secondary, defaultTheme.roles.text.secondary, 'the sibling role does not');
  assert.deepEqual(theme.roles.series.categorical, ['#111111', '#222222']);
  assert.equal(theme.roles.series.overflow, defaultTheme.roles.series.overflow, 'another group is untouched');
  assert.deepEqual(theme.roles.emphasis, defaultTheme.roles.emphasis);
});

test('a theme that cannot colour anything is refused, not defaulted away', () => {
  assert.throws(() => resolveTheme({ roles: { series: { categorical: [] } } }), /empty series\.categorical/);
});

test('the palette never cycles: past its end, series get the overflow role', () => {
  const palette = defaultTheme.roles.series.categorical;

  assert.deepEqual(seriesColors(defaultTheme, 0), []);
  assert.deepEqual(seriesColors(defaultTheme, 1), [defaultTheme.roles.series.single], 'one series is the single role');
  assert.deepEqual(seriesColors(defaultTheme, 2), [palette[0], palette[1]]);

  const many = seriesColors(defaultTheme, palette.length + 2);
  assert.deepEqual(many.slice(0, palette.length), [...palette], 'the palette in order, once');
  assert.deepEqual(many.slice(palette.length), [
    defaultTheme.roles.series.overflow,
    defaultTheme.roles.series.overflow,
  ]);
  assert.equal(new Set(many.slice(0, palette.length)).size, palette.length, 'no colour twice inside the palette');
});

test('every declared type names colour roles the default theme can resolve', () => {
  for (const name of CHART_TYPE_NAMES) {
    const roles = CHART_TYPES[name].colorRoles;
    assert.ok(roles.length > 0, `'${name}' declares no colour roles: it would draw in whatever the library defaults to`);
    for (const role of roles) {
      assert.ok(roleColors(defaultTheme, role).length > 0, `'${name}' needs '${role}', which resolves to nothing`);
    }
  }
});

test('a categorical chart draws its series in palette order, and its ruler in the text and structure roles', () => {
  const { options } = compileToHighcharts(twoSeriesSpec, rows);
  const roles = defaultTheme.roles;

  // Three desks in the fixture, so three series: the palette is walked in series order.
  assert.deepEqual(options.colors, seriesColors(defaultTheme, 3));
  assert.equal((options.chart as ChartOptions).backgroundColor, roles.surface.canvas);
  assert.equal(((options.title as ChartOptions).style as ChartOptions).color, roles.text.primary);
  assert.equal(((options.legend as ChartOptions).itemStyle as ChartOptions).color, roles.text.secondary);

  const xAxis = options.xAxis as ChartOptions;
  const yAxis = options.yAxis as ChartOptions;
  assert.equal((xAxis.labels as ChartOptions).style && ((xAxis.labels as ChartOptions).style as ChartOptions).color, roles.text.secondary);
  assert.equal(xAxis.lineColor, roles.structure.axis);
  assert.equal(xAxis.tickColor, roles.structure.axis);
  assert.equal((xAxis.title as ChartOptions).style && ((xAxis.title as ChartOptions).style as ChartOptions).color, roles.text.muted);
  assert.equal(yAxis.gridLineColor, roles.structure.grid, 'the value axis is the one Highcharts draws a grid on');
  assert.equal(xAxis.gridLineColor, undefined, 'and the category axis is not restyled into having one');
});

test('a pie colours its slices, and a heatmap gets a ramp and no palette', () => {
  const pie = compileToHighcharts(pieSpec, rows).options;
  assert.deepEqual(pie.colors, seriesColors(defaultTheme, 3), 'three slices are three things the palette colours');

  const heatmap = compileToHighcharts(heatmapSpec, rows).options;
  assert.equal(heatmap.colors, undefined, 'a palette on a heatmap would turn an ordered measure into unrelated hues');
  assert.deepEqual(heatmap.colorAxis, {
    minColor: defaultTheme.roles.series.sequential[0],
    maxColor: defaultTheme.roles.series.sequential[1],
  });
});

test('a consumer theme moves the emphasis and the surface, and nothing else', () => {
  const theme = {
    roles: {
      surface: { canvas: '#0d1117' },
      emphasis: { highlight: '#3fb950' },
    },
  };

  const spec: ChartSpec = {
    ...barSpec,
    emphasis: [{ when: { op: 'top_k', field: 'revenue', k: 1 }, style: { tone: 'highlight' } }],
  };

  const plain = compileToHighcharts(spec, rows).options;
  const themed = compileToHighcharts(spec, rows, { theme }).options;

  const styledPlain = (plain.series as Array<{ data: Array<Record<string, unknown>> }>)[0].data.find(
    (point) => typeof point === 'object' && point !== null,
  );
  const styledThemed = (themed.series as Array<{ data: Array<Record<string, unknown>> }>)[0].data.find(
    (point) => typeof point === 'object' && point !== null,
  );

  assert.equal(styledPlain?.color, defaultTheme.roles.emphasis.highlight, 'unthemed emphasis keeps the old orange');
  assert.equal(styledThemed?.color, '#3fb950', 'the theme owns the tone now');
  assert.equal((themed.chart as ChartOptions).backgroundColor, '#0d1117');
  assert.deepEqual(themed.colors, plain.colors, 'a surface and an emphasis override do not restyle the series');
});

test('compact still undresses the chart: no axes, no title, theme or not', () => {
  const { options } = compileToHighcharts({ ...barSpec, chart: { type: 'bar', compact: true } }, rows);
  assert.equal(options.xAxis, undefined);
  assert.equal(options.yAxis, undefined);
  assert.deepEqual(options.title, { text: '' });
});
