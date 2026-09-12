/**
 * Layout derivation: the geometry that decides how a crowded axis reads.
 *
 * The values pinned here are not arbitrary: they are flint's elastic budget and label
 * ladder (`docs/flint-conventions.md` §1.2–§1.4) run against this repository's own
 * corpus shapes, so the dense case and the long-label case in the corpus and the
 * derivation cannot drift apart. Where we deviate from flint — no widen-then-rotate,
 * no item dropping — the tests pin the deviation too, because a silent difference from
 * the source we cite is exactly how a reimplemented convention rots.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { compileToHighcharts } from '../src/compile/index.ts';
import { deriveAxisLayout, LAYOUT, plotWidthOf } from '../src/compile/layout.ts';
import type { ChartOptions } from '../src/compile/index.ts';
import type { ChartSpec, Row } from '../src/types.ts';

const labels = (count: number, length: number): string[] =>
  Array.from({ length: count }, (_, index) => `${'x'.repeat(Math.max(0, length - 2))}${String(index).padStart(2, '0')}`);

test('a handful of short labels never rotates, however much room it has', () => {
  const layout = deriveAxisLayout(['East', 'West', 'North']);
  assert.equal(layout.rotation, 0);
  assert.equal(layout.stretched, 1, 'three bands do not press on a 400px axis');
  assert.equal(layout.overflow, false);
  assert.equal(layout.fontSize, 10, 'the flat rung: one below base, ceilinged at 10');
});

test('months lie down: five seven-character labels fit their bands', () => {
  const layout = deriveAxisLayout(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']);
  assert.equal(layout.rotation, 0);
  assert.equal(layout.fontSize, 10);
});

test('the dense regime: sixty bands stretch the axis to its ceiling and turn the labels', () => {
  const layout = deriveAxisLayout(labels(60, 5));
  assert.equal(layout.stretched, LAYOUT.maxStretch, 'pressure 3, elasticity 0.5, ceiling 1.5');
  assert.equal(layout.rotation, -90, 'five-character labels at a 10px band fit neither flat nor at 45');
  assert.equal(layout.fontSize, 9, 'the -90 rung shrinks the font two below base');
  assert.equal(layout.overflow, false, 'sixty bands at the 6px minimum still fit a 600px axis');
});

test('four long labels: vertical at the reference width, flat when the consumer says wider', () => {
  const desks = [
    'European Investment Grade Credit',
    'US High Yield Distressed',
    'Asia-Pacific Rates & FX',
    'Emerging Market Local Debt',
  ];

  const narrow = deriveAxisLayout(desks);
  assert.equal(narrow.rotation, -90, 'a 32-character label has no business in a 100px band');

  const wide = deriveAxisLayout(desks, 800);
  assert.equal(wide.rotation, 0, 'and in a 200px band it lies down: the reference width is the whole argument');
  assert.equal(wide.fontSize, 10);
});

test('the ladder is monotone: more bands never means less rotation', () => {
  const severity = (rotation: 0 | -45 | -90): number => (rotation === 0 ? 0 : rotation === -45 ? 1 : 2);
  let previous = 0;
  for (const count of [4, 8, 12, 16, 32, 64, 128]) {
    const layout = deriveAxisLayout(labels(count, 6));
    assert.ok(
      severity(layout.rotation) >= previous,
      `${count} bands rotated ${layout.rotation} after a denser case rotated less`,
    );
    previous = severity(layout.rotation);
  }
});

test('the middle rung exists: twelve six-character bands sit at -45', () => {
  const layout = deriveAxisLayout(labels(12, 6));
  assert.equal(layout.rotation, -45);
  assert.equal(layout.fontSize, 10, 'the -45 rung is one below base');
});

test('overflow warns instead of dropping: the third regime keeps every mark', () => {
  const layout = deriveAxisLayout(labels(120, 5));
  assert.equal(layout.overflow, true, '120 bands at the 6px minimum do not fit a 600px axis');
  assert.equal(layout.rotation, -90);
  assert.equal(layout.fontSize, 6, 'and the font bottoms out rather than the categories disappearing');
});

test('a width that is not one is refused', () => {
  assert.equal(plotWidthOf(undefined), LAYOUT.plotWidth);
  assert.equal(plotWidthOf({ plotWidth: 800 }), 800);
  assert.throws(() => plotWidthOf({ plotWidth: 0 }), /positive number/);
  assert.throws(() => plotWidthOf({ plotWidth: -400 }), /positive number/);
  assert.throws(() => plotWidthOf({ plotWidth: Number.NaN }), /positive number/);
});

test('the backend puts the sizing on the axis that carries the categories', () => {
  const rows: Row[] = labels(60, 5).map((counterparty, index) => ({
    counterparty,
    notional: 1000 + ((index * 137) % 900),
  }));
  const spec: ChartSpec = { chart: { type: 'bar' }, encodings: { x: { field: 'counterparty' }, y: { field: 'notional' } } };

  const vertical = compileToHighcharts(spec, rows).options;
  const xAxis = vertical.xAxis as ChartOptions;
  assert.equal((xAxis.labels as ChartOptions).rotation, -90);
  assert.equal(((xAxis.labels as ChartOptions).style as ChartOptions).fontSize, '9px');
  const yAxis = vertical.yAxis as ChartOptions;
  assert.equal((yAxis.labels as ChartOptions).rotation, undefined, 'the value axis prints numbers, not names');

  const horizontal = compileToHighcharts(
    { ...spec, chart: { type: 'bar', orientation: 'horizontal' } },
    rows,
  ).options;
  // A `bar` keeps its categories on `xAxis` — the inversion is visual — so the side axis
  // that shrinks without turning is still the x axis, and it carries the reversal.
  const hX = horizontal.xAxis as ChartOptions;
  assert.equal(((hX.labels as ChartOptions).style as ChartOptions).fontSize, '9px');
  assert.equal((hX.labels as ChartOptions).rotation, undefined, 'a side axis shrinks; it does not turn sideways');
  assert.equal((hX as { reversed?: boolean }).reversed, true);
});

test('overflow reaches the caller as a warning, and a consumer width can retire it', () => {
  const rows: Row[] = labels(120, 5).map((counterparty, index) => ({ counterparty, notional: index }));
  const spec: ChartSpec = { chart: { type: 'bar' }, encodings: { x: { field: 'counterparty' }, y: { field: 'notional' } } };

  const crowded = compileToHighcharts(spec, rows);
  assert.equal(crowded.warnings.length, 1);
  assert.match(crowded.warnings[0], /120 labels/);
  assert.match(crowded.warnings[0], /aggregate/);

  const roomy = compileToHighcharts(spec, rows, { layout: { plotWidth: 1200 } });
  assert.deepEqual(roomy.warnings, [], 'at 1200px the same 120 bands fit, and silence is the honest report');
});

test('a heatmap sizes both of its category axes, each in its own direction', () => {
  const rows: Row[] = [
    { region: 'AMER', product: 'Rates', notional: 40 },
    { region: 'EMEA', product: 'Credit', notional: 25 },
  ];
  const { options } = compileToHighcharts(
    {
      chart: { type: 'heatmap' },
      encodings: { x: { field: 'region' }, y: { field: 'notional' }, series: { field: 'product' } },
    },
    rows,
  );

  const xAxis = options.xAxis as ChartOptions;
  const yAxis = options.yAxis as ChartOptions;
  assert.equal(((xAxis.labels as ChartOptions).style as ChartOptions).fontSize, '10px');
  assert.equal(((yAxis.labels as ChartOptions).style as ChartOptions).fontSize, '10px');
  assert.equal((xAxis.labels as ChartOptions).rotation, undefined, 'two short labels a side: nothing to dodge');
});
