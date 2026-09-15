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

// --- the emphasis scope, which is asymmetric on purpose ---
//
// A dual-axis chart gives every row *two* datum keys — one per measure (§3.4 rule 1) — so every
// rule has to say which of them it means. The answer differs by kind, and it is rule 1 that
// decides the first half: series are named after their measure field precisely so that `top_k` on
// the secondary measure cannot style the primary bar in that category. A rank is a statement about
// one measure's values, so it stays inside that measure.
//
// A predicate is a statement about the *row* — `eq: 'Globex'` is true of Globex whatever column you
// read — so it styles both, and that is C2 above. Where the two halves meet is `rest`: it reads
// like "everything else on the chart" and is scoped to its own measure like any other `top_k`.
// Documented in `docs/using-chartwright.md`; pinned here, because a scope that is only written down
// is a scope the next change is free to alter.

/** Reads `[series name, per-category tone]` out of the compiled combo options. */
function comboStyles(spec: ChartSpec, input: Row[]): Record<string, string[]> {
  const { options } = compileToHighcharts(spec, input);
  return Object.fromEntries(
    (options.series as Array<{ name: string; data: unknown[] }>).map((series) => [
      series.name,
      series.data.map((datum) => {
        if (typeof datum !== 'object' || datum === null) return 'plain';
        const color = (datum as { color?: string }).color;
        return color === '#e8590c' ? 'highlight' : color === '#c9ced6' ? 'muted' : 'styled';
      }),
    ]),
  );
}

test('A1: rest complements the measure it names, and leaves the other series alone', () => {
  const styles = comboStyles(
    {
      ...comboSpec,
      emphasis: [
        { when: { op: 'top_k', k: 1, field: 'notional_usd' }, style: { tone: 'highlight' } },
        { when: { op: 'top_k', k: 1, field: 'notional_usd', rest: true }, style: { tone: 'muted' } },
      ],
    },
    rows,
  );

  // Acme has the largest notional; its own series cell is highlighted and the other two faded.
  assert.deepEqual(styles.notional_usd, ['highlight', 'muted', 'muted']);
  // The commission series is untouched by both rules — that is rule 1 doing its job, not an
  // oversight: neither rule ranked commission, so neither may claim to know its "rest".
  assert.deepEqual(styles.avg_commission_bps, ['plain', 'plain', 'plain']);
});

test('A2: covering both series takes two rest rules, one per measure', () => {
  // The documented way to fade a dual-axis chart: say it once per measure. Two rules rather than
  // one is the cost of keeping the rank inside its own measure, and it is deliberate.
  const styles = comboStyles(
    {
      ...comboSpec,
      emphasis: [
        { when: { op: 'top_k', k: 1, field: 'notional_usd' }, style: { tone: 'highlight' } },
        { when: { op: 'top_k', k: 1, field: 'notional_usd', rest: true }, style: { tone: 'muted' } },
        { when: { op: 'top_k', k: 1, field: 'avg_commission_bps' }, style: { tone: 'highlight' } },
        { when: { op: 'top_k', k: 1, field: 'avg_commission_bps', rest: true }, style: { tone: 'muted' } },
      ],
    },
    rows,
  );

  // Each measure keeps its own ranking: notional peaks at Acme, commission at Globex.
  assert.deepEqual(styles.notional_usd, ['highlight', 'muted', 'muted']);
  assert.deepEqual(styles.avg_commission_bps, ['muted', 'highlight', 'muted']);
});

test('A3: the asymmetric half, restated — a predicate still styles both series', () => {
  // The contrast that makes A1 readable. `eq: 'Globex'` names a row, not a measure, so it reaches
  // both; this is C2's claim asserted through the same reader, so the two halves of the rule sit
  // in one place.
  const styles = comboStyles(
    {
      ...comboSpec,
      emphasis: [{ when: { op: 'eq', field: 'counterparty', value: 'Globex' }, style: { tone: 'muted' } }],
    },
    rows,
  );
  assert.deepEqual(styles.notional_usd, ['plain', 'muted', 'plain']);
  assert.deepEqual(styles.avg_commission_bps, ['plain', 'muted', 'plain']);
});

// --- combo + series encoding (C1, I1) ---

const comboSeriesRows: Row[] = [
  { counterparty: 'Acme', currency: 'USD', notional_usd: 1_000_000_000, avg_commission_bps: 3 },
  { counterparty: 'Acme', currency: 'EUR', notional_usd: 500_000_000, avg_commission_bps: 5 },
  { counterparty: 'Globex', currency: 'USD', notional_usd: 800_000_000, avg_commission_bps: 7 },
  { counterparty: 'Globex', currency: 'EUR', notional_usd: 200_000_000, avg_commission_bps: 2 },
];

const comboSeriesSpec: ChartSpec = {
  chart: { type: 'bar' },
  encodings: {
    x: { field: 'counterparty' },
    y: { field: 'notional_usd' },
    y2: { field: 'avg_commission_bps' },
    series: { field: 'currency' },
  },
};

test('combo + series produces 2N series with composite names', () => {
  const { options } = compileToHighcharts(comboSeriesSpec, comboSeriesRows);
  const names = (options.series as Array<{ name: string }>).map((s) => s.name);
  assert.deepEqual(names, [
    'notional_usd: USD',
    'notional_usd: EUR',
    'avg_commission_bps: USD',
    'avg_commission_bps: EUR',
  ]);
});

test('C1: top_k on combo+series styles only the correct measure and group', () => {
  const { options } = compileToHighcharts(
    {
      ...comboSeriesSpec,
      emphasis: [{ when: { op: 'top_k', field: 'avg_commission_bps', k: 1 }, style: { tone: 'highlight' } }],
    },
    comboSeriesRows,
  );
  const series = options.series as Array<{ name: string; data: Array<number | Record<string, unknown>> }>;

  // Primary measure series are unstyled.
  for (const s of series.filter((s) => s.name.startsWith('notional_usd'))) {
    assert.ok(s.data.every((d) => typeof d === 'number'), `${s.name} should be unstyled`);
  }

  // Secondary measure: exactly one styled point (Globex USD has commission 7, the max).
  const secondaryStyled = series
    .filter((s) => s.name.startsWith('avg_commission_bps'))
    .flatMap((s) => s.data.filter((d) => typeof d === 'object'));
  assert.equal(secondaryStyled.length, 1, 'only the top commission datum is highlighted');
});

// --- C2: non-top_k emphasis on combo (no series encoding) ---

test('C2: non-top_k emphasis on combo styles both measures for matching categories', () => {
  const { options } = compileToHighcharts(
    {
      ...comboSpec,
      emphasis: [{ when: { op: 'eq', field: 'counterparty', value: 'Globex' }, style: { tone: 'muted' } }],
    },
    rows,
  );
  const series = options.series as Array<{ name: string; data: Array<number | Record<string, unknown>> }>;

  // Globex is index 1. Both measures at index 1 should be muted.
  for (const s of series) {
    const datum = s.data[1];
    assert.equal(typeof datum, 'object', `${s.name}[1] (Globex) should be styled`);
  }

  // Non-Globex data should be plain numbers.
  for (const s of series) {
    for (let i = 0; i < s.data.length; i++) {
      if (i === 1) continue; // Globex
      assert.equal(typeof s.data[i], 'number', `${s.name}[${i}] should be unstyled`);
    }
  }
});
