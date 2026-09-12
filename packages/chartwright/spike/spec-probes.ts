/**
 * DESIGN PROBE — throwaway. Not part of the library, not exported, not
 * typechecked (tsconfig includes only `src` and `test`), not shipped.
 *
 * It exists to answer four questions with evidence rather than assertion:
 *
 *   1. `scatter`   — can a point cloud be asked for without library words, and
 *                    what breaks in today's compiler when it is?
 *   2. `arearange` / `boxplot` — does the *existing* transform DSL already
 *                    produce the table each one needs?
 *   3. `heatmap`   — does it need a new "value → colour" channel, or do the
 *                    three channels that already exist suffice?
 *   4. `sankey`    — what is the smallest honest way to say "this table is
 *                    edges, not points"?
 *
 * Run: node --experimental-strip-types packages/chartwright/spike/spec-probes.ts
 */
import { compileToHighcharts } from '../src/compile/index.ts';
import { resolveEmphasis } from '../src/compile/emphasis.ts';
import { rowDatumKey } from '../src/compile/model.ts';
import { applyTransform } from '../src/transform.ts';
import type { EmphasisRule, Row, TransformStep } from '../src/types.ts';

const line = (title: string) => console.log(`\n${'─'.repeat(72)}\n${title}\n${'─'.repeat(72)}`);
const show = (label: string, value: unknown) => console.log(`  ${label.padEnd(34)} ${JSON.stringify(value)}`);

function attempt(label: string, fn: () => unknown): void {
  try {
    const value = fn();
    console.log(`  ${label.padEnd(34)} OK   ${JSON.stringify(value)}`);
  } catch (error) {
    console.log(`  ${label.padEnd(34)} THROWS ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe 1 — scatter: the type that violates an invariant instead of just
// being absent from a list.
// ─────────────────────────────────────────────────────────────────────────────

line('PROBE 1 — scatter (point cloud, linear axis)');

const trades: Row[] = [
  { tenure_months: 3, nps: 12, segment: 'SME' },
  { tenure_months: 9, nps: 47, segment: 'SME' },
  { tenure_months: 9, nps: 55, segment: 'SME' }, // same x, same series: normal for a cloud
  { tenure_months: 14, nps: 31, segment: 'SME' },
  { tenure_months: 5, nps: 22, segment: 'Enterprise' },
  { tenure_months: 11, nps: 38, segment: 'Enterprise' },
];

const scatterAsToday = {
  chart: { type: 'line' }, // no scatter in SUPPORTED_CHART_TYPES, so: nearest supported
  encodings: { x: { field: 'tenure_months' }, y: { field: 'nps' }, series: { field: 'segment' } },
};
console.log('  Today, the same intent expressed with the nearest supported type:');
attempt('compile (line + numeric x)', () => compileToHighcharts(scatterAsToday, trades).options.xAxis);

console.log('\n  With one x value dropped so it compiles, what the axis becomes:');
const noDup = trades.filter((row) => !(row.tenure_months === 9 && row.nps === 55));
show('xAxis.categories (evenly spaced)', (compileToHighcharts(scatterAsToday, noDup).options.xAxis as { categories: string[] }).categories);
show('xAxis.type', (compileToHighcharts(scatterAsToday, noDup).options.xAxis as { type?: string }).type);

console.log('\n  And the emphasis key: today it is the x VALUE, so two points sharing an x');
console.log('  are one datum. "Highlight the highest NPS" then highlights both of them:');
const duplicateX = trades.filter((row) => row.segment === 'SME');
const keyOf = (row: Row) => rowDatumKey(row, 'tenure_months', 'segment');
const emphasis: EmphasisRule[] = [{ when: { op: 'top_k', field: 'nps', k: 1 }, style: { tone: 'highlight', label: true } }];
const resolved = resolveEmphasis(emphasis, duplicateX, keyOf);
show('rows in the SME series', duplicateX.map((row) => `${row.tenure_months}/${row.nps}`));
show('distinct datum keys', [...new Set(duplicateX.map(keyOf))]);
show('points marked highlighted', [...resolved.styles.keys()]);
console.log(`  ${'VERDICT'.padEnd(34)} the requested k=1 marks ${resolved.styles.size} data keys = ${duplicateX.filter((row) => resolved.styles.has(keyOf(row))).length} points`);

console.log('\n  Proposed neutral surface:');
show('axes.x.kind', 'linear  (new: axis kind, band|linear|time|log)');
show('chart.collisionPolicy', 'rows-are-points  (new: exempts the one-row-per-category rule)');
show('datum key for point types', 'row index in the materialised table, not the x value');
show('Highcharts data emitted', '[[x, y], ...] per series — verified pointArrayMap y in highcharts.src.js:26290');

// ─────────────────────────────────────────────────────────────────────────────
// Probe 2 — arearange and boxplot: does the existing DSL produce the table?
// ─────────────────────────────────────────────────────────────────────────────

line('PROBE 2 — arearange / boxplot (two-value and five-value points)');

const latency: Row[] = [
  { day: 'Mon', ms: 120 },
  { day: 'Mon', ms: 380 },
  { day: 'Tue', ms: 90 },
  { day: 'Tue', ms: 410 },
  { day: 'Wed', ms: 150 },
  { day: 'Wed', ms: 500 },
];

const rangePlan: TransformStep[] = [
  {
    op: 'aggregate',
    group_by: ['day'],
    measures: [
      { field: 'ms', agg: 'min', as: 'low' },
      { field: 'ms', agg: 'max', as: 'high' },
    ],
  },
];
const rangeTable = applyTransform(latency, rangePlan);
console.log('  arearange — plan built from aggregations that already exist (min, max):');
show('plan output', rangeTable);
show('Highcharts data', rangeTable.map((row) => [row.low, row.high]));
show('verified pointArrayMap', "['low','high']  (highcharts-more.src.js:2941)");

console.log('\n  boxplot — the five numbers a box needs:');
const statsPlan: TransformStep[] = [
  {
    op: 'aggregate',
    group_by: ['day'],
    measures: [
      { field: 'ms', agg: 'min', as: 'low' },
      { field: 'ms', agg: 'max', as: 'high' },
    ],
  },
];
console.log(`  AggregationFn today = sum | avg | count | countDistinct | min | max  (src/types.ts:56)`);
attempt("agg 'median' (as q1/median/q3 need)", () =>
  applyTransform(latency, [
    { op: 'aggregate', group_by: ['day'], measures: [{ field: 'ms', agg: 'median' as never, as: 'median' }] },
  ]),
);
show('boxplot pointArrayMap', "['low','q1','median','q3','high'] (highcharts-more.src.js:3807)");
console.log('  VERDICT                            spec side is cheap (5 channels); ASK mode is not — the');
console.log('                                     transform DSL has no percentile, so a boxplot would have to');
console.log('                                     arrive pre-aggregated (present mode), exactly like today\'s');
console.log('                                     "final numbers" demos. statsPlan kept for the type signature:');
show('statsPlan steps', statsPlan.length);

// ─────────────────────────────────────────────────────────────────────────────
// Probe 3 — heatmap: does "value → colour" need a channel of its own?
// ─────────────────────────────────────────────────────────────────────────────

line('PROBE 3 — heatmap (matrix + value-as-colour)');

const bookings: Row[] = [
  { month: '2026-01', region: 'EMEA', notional: 250 },
  { month: '2026-02', region: 'EMEA', notional: 310 },
  { month: '2026-01', region: 'AMER', notional: 180 },
  { month: '2026-02', region: 'AMER', notional: 205 },
];
const heatPlan: TransformStep[] = [
  {
    op: 'aggregate',
    group_by: ['month', 'region'],
    measures: [{ field: 'notional', agg: 'sum', as: 'notional' }],
  },
];
const heatTable = applyTransform(bookings, heatPlan);
console.log('  The table a heatmap needs is one row per (x, series) — which is EXACTLY the shape');
console.log('  the existing collision rule already enforces for bar and line:');
show('plan output', heatTable);
attempt('today: is this table even accepted?', () =>
  compileToHighcharts(
    { chart: { type: 'bar' }, encodings: { x: { field: 'month' }, y: { field: 'notional' }, series: { field: 'region' } } },
    heatTable,
  ).options.series,
);
console.log('\n  Proposed: no new channel at all. The three existing channels are given the roles a');
console.log('  heatmap needs — x = column, series = row, y = the measure drawn as colour:');
show('chart.type', 'heatmap');
show('encoding roles', 'x -> xAxis categories, series -> yAxis categories, y -> point value (colour)');
show('needed from the compiler', 'pivot long -> [xIndex, yIndex, value] + colorAxis: {}');
show('verified pointArrayMap', "['y','value'] (modules/heatmap.src.js:4291)");

// ─────────────────────────────────────────────────────────────────────────────
// Probe 4 — sankey: the one shape that is genuinely not x/y/series.
// ─────────────────────────────────────────────────────────────────────────────

line('PROBE 4 — sankey (edges, not points)');

const flows: Row[] = [
  { from_venue: 'LSE', to_venue: 'XETRA', notional: 420 },
  { from_venue: 'LSE', to_venue: 'XNYS', notional: 180 },
  { from_venue: 'XETRA', to_venue: 'XNYS', notional: 95 },
];
const linkPlan: TransformStep[] = [
  {
    op: 'aggregate',
    group_by: ['from_venue', 'to_venue'],
    measures: [{ field: 'notional', agg: 'sum', as: 'notional' }],
  },
];
const linkTable = applyTransform(flows, linkPlan);
show('plan output', linkTable);
console.log('\n  Proposed neutral surface — an explicit shape, because reusing x/y here would be a lie:');
show('data.shape', 'links');
show('data.from / data.to / data.value', "{ field: 'from_venue' } / { field: 'to_venue' } / { field: 'notional' }");
show('Highcharts data', linkTable.map((row) => [row.from_venue, row.to_venue, row.notional]));
show('verified pointArrayMap', "['from','to','weight'] (modules/sankey.src.js:3599)");
console.log('  Nodes are derived from the edges by the backend: the spec never names one.');
console.log('  The existing collision rule still applies, generalised: one row per (from, to).');

// ─────────────────────────────────────────────────────────────────────────────

line('SUMMARY — what each probe asks of the spec');
console.log(`
  probe       new spec surface                                  invariants            verdict
  ─────────── ────────────────────────────────────────────────  ────────────────────  ───────
  scatter     axes.x.kind: linear                                 BREAKS collision      medium
              + per-type datum key (index, not x value)           rule -> needs an
              + collision exemption for point types               explicit exemption
  arearange   low/high channels OR reuse of y-as-range            keeps                 cheap
  boxplot     spec cheap, but needs percentile aggregation        keeps                 medium
              (or present-mode only, as today)                                          ask-mode
  heatmap     NOTHING new: x + series + y with per-type roles     keeps (rule is a     very
                                                                  perfect fit)          cheap
  sankey      data.shape: 'links' + from/to/value                 keeps, generalised    medium
`);
