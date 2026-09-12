/**
 * Dual-axis combo (§3.4): two measures of different units on one chart.
 *
 * Three rules, each preventing a silent wrong answer:
 *   1. Series are named after their measure field — datum keys stay unique.
 *   2. Both axes carry their field name as a title — two units need two labels.
 *   3. The library never volunteers combo — only when the spec says y2.
 *
 * These tests pin those rules so they cannot drift.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { compileToHighcharts } from '../src/compile/index.ts';
import type { ChartOptions } from '../src/compile/index.ts';
import type { ChartSpec, Row } from '../src/types.ts';

const rows: Row[] = [
  { counterparty: 'Acme', notional_usd: 1_000_000_000, avg_commission_bps: 3 },
  { counterparty: 'Globex', notional_usd: 500_000_000, avg_commission_bps: 7 },
  { counterparty: 'Initech', notional_usd: 250_000_000, avg_commission_bps: 5 },
];

const comboSpec: ChartSpec = {
  chart: { type: 'bar' },
  encodings: {
    x: { field: 'counterparty' },
    y: { field: 'notional_usd' },
    y2: { field: 'avg_commission_bps' },
  },
};

test('rule 1: series are named after their measure field', () => {
  const { options } = compileToHighcharts(comboSpec, rows);
  const names = (options.series as Array<{ name: string }>).map((s) => s.name);
  assert.deepEqual(names, ['notional_usd', 'avg_commission_bps']);
});

test('rule 1: top_k on the secondary measure styles only its own datum', () => {
  const { options } = compileToHighcharts(
    {
      ...comboSpec,
      emphasis: [{ when: { op: 'top_k', field: 'avg_commission_bps', k: 1 }, style: { tone: 'highlight' } }],
    },
    rows,
  );
  const series = options.series as Array<{ name: string; data: Array<number | Record<string, unknown>> }>;
  const primary = series.find((s) => s.name === 'notional_usd');
  const secondary = series.find((s) => s.name === 'avg_commission_bps');

  // The primary series has no styled points — emphasis on commission does not touch notional.
  assert.ok(primary?.data.every((d) => typeof d === 'number'), 'primary series is unstyled');
  // The secondary series has exactly one styled point (the top-1 by commission).
  const styled = secondary?.data.filter((d) => typeof d === 'object');
  assert.equal(styled?.length, 1, 'only the top commission datum is highlighted');
});

test('rule 2: both axes carry their field name as a title', () => {
  const { options } = compileToHighcharts(comboSpec, rows);
  const yAxis = options.yAxis as Array<ChartOptions>;
  assert.ok(Array.isArray(yAxis), 'two measures produce two axes');
  assert.equal(yAxis.length, 2);
  assert.equal((yAxis[0].title as ChartOptions).text, 'notional_usd');
  assert.equal((yAxis[1].title as ChartOptions).text, 'avg_commission_bps');
  assert.equal((yAxis[1] as { opposite?: boolean }).opposite, true, 'the secondary axis sits on the right');
});

test('type2 defaults to line when omitted', () => {
  const { options } = compileToHighcharts(comboSpec, rows);
  const series = options.series as Array<{ name: string; type?: string }>;
  const secondary = series.find((s) => s.name === 'avg_commission_bps');
  assert.equal(secondary?.type, 'line');
});

test('type2 is honoured when set', () => {
  const { options } = compileToHighcharts({ ...comboSpec, chart: { type: 'bar', type2: 'spline' } }, rows);
  const series = options.series as Array<{ name: string; type?: string }>;
  const secondary = series.find((s) => s.name === 'avg_commission_bps');
  assert.equal(secondary?.type, 'spline');
});

test('the secondary series lives on axis index 1', () => {
  const { options } = compileToHighcharts(comboSpec, rows);
  const series = options.series as Array<{ name: string; yAxis?: number }>;
  const primary = series.find((s) => s.name === 'notional_usd');
  const secondary = series.find((s) => s.name === 'avg_commission_bps');
  assert.equal(primary?.yAxis, undefined, 'primary stays on the default axis');
  assert.equal(secondary?.yAxis, 1);
});

test('without y2, there is one axis and no type2', () => {
  const { options } = compileToHighcharts(
    { chart: { type: 'bar' }, encodings: { x: { field: 'counterparty' }, y: { field: 'notional_usd' } } },
    rows,
  );
  assert.ok(!Array.isArray(options.yAxis), 'single measure, single axis object');
  const series = options.series as Array<{ name: string; yAxis?: number; type?: string }>;
  assert.equal(series.length, 1);
  assert.equal(series[0].yAxis, undefined);
  assert.equal(series[0].type, undefined);
});
