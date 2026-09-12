/**
 * The data corpus: one dataset per *chart shape*, not per chart type.
 *
 * Two reasons it is organised by shape rather than by the three types that exist today:
 *
 *   1. A type is a name; a shape is what the compiler actually has to handle. `bar` and
 *      `line` share a shape; `scatter` and `heatmap` do not — one needs a positional axis
 *      and the other needs a colour channel — and each needs data the current three types
 *      never see. Preparing the data now means P1 adds types against a corpus that already
 *      stresses them, instead of inventing both at once.
 *   2. The interesting failures are shape failures. Two points at the same x, a month
 *      missing, sixty categories, a label longer than its band: none of those are about a
 *      chart type, and all of them are invisible with the tidy three-row fixtures the
 *      existing tests use.
 *
 * Each case states what compiling it does **today**, so the corpus is also a map of the
 * gaps. Cases marked `no-type-yet` have no declared type that can use them; when P1 declares
 * one, that expectation flips deliberately and the diff says so.
 *
 * `datasets` is the raw material on its own, for a future type to reach for. `CORPUS` pairs
 * each dataset with the spec that uses it today and what happens.
 */
import type { ChartSpec, Row } from '../../src/types.ts';

export type Dataset = {
  name: string;
  /** Which chart shapes this data can serve, today or in P1. */
  shapes: string[];
  /** What this data stresses — the reason it is here rather than a three-row fixture. */
  why: string;
  rows: Row[];
};

export const datasets: Dataset[] = [
  {
    name: 'categories-one-measure',
    shapes: ['categorical', 'part-to-whole'],
    why: 'the tidy case every other case is a deviation from: unique categories, one positive measure',
    rows: [
      { region: 'East', revenue: 250 },
      { region: 'West', revenue: 80 },
      { region: 'North', revenue: 120 },
    ],
  },
  {
    name: 'categories-split-by-series',
    shapes: ['categorical (grouped)', 'categorical (multi-series)'],
    why: 'long form with (category, group) unique, which is what the collision rule demands',
    rows: [
      { region: 'East', currency: 'USD', revenue: 250 },
      { region: 'West', currency: 'USD', revenue: 80 },
      { region: 'North', currency: 'USD', revenue: 120 },
      { region: 'East', currency: 'EUR', revenue: 100 },
      { region: 'West', currency: 'EUR', revenue: 40 },
      { region: 'North', currency: 'EUR', revenue: 60 },
    ],
  },
  {
    name: 'months-in-order',
    shapes: ['categorical (time)', 'line', 'area'],
    why: 'a complete series: what a date-column-as-category is supposed to look like',
    rows: [
      { month: '2026-01', notional_usd: 412 },
      { month: '2026-02', notional_usd: 508 },
      { month: '2026-03', notional_usd: 466 },
      { month: '2026-04', notional_usd: 731 },
      { month: '2026-05', notional_usd: 690 },
    ],
  },
  {
    name: 'months-with-a-gap',
    shapes: ['categorical (time)', 'line', 'area'],
    why: '2026-03 is absent, and a category axis draws that gap as though it were not there — the cost recorded as roadmap item 21',
    rows: [
      { month: '2026-01', notional_usd: 412 },
      { month: '2026-02', notional_usd: 508 },
      { month: '2026-04', notional_usd: 731 },
      { month: '2026-05', notional_usd: 690 },
    ],
  },
  {
    name: 'two-measures-different-units',
    shapes: ['dual-axis combo'],
    why: 'notional is ~1e9 and commission is single digits: a magnitude gap of 1e9, which is the textbook reason a second axis exists (§3.4)',
    rows: [
      { counterparty: 'Northgate', notional_usd: 1_382_020_048, avg_commission_bps: 4.24 },
      { counterparty: 'Ardenne', notional_usd: 903_112_500, avg_commission_bps: 6.1 },
      { counterparty: 'Kestrel', notional_usd: 512_004_220, avg_commission_bps: 3.05 },
      { counterparty: 'Lumen', notional_usd: 88_450_010, avg_commission_bps: 8.9 },
    ],
  },
  {
    name: 'numeric-pair-with-duplicate-x',
    shapes: ['point cloud', 'bubble'],
    why: 'two points share an x, which is normal for a cloud and is refused today — plus the emphasis key that cannot tell them apart (§2.1)',
    rows: [
      { tenure_months: 3, nps: 12 },
      { tenure_months: 9, nps: 47 },
      { tenure_months: 9, nps: 55 },
      { tenure_months: 14, nps: 31 },
      { tenure_months: 21, nps: 38 },
    ],
  },
  {
    name: 'numeric-pair-unique-x',
    shapes: ['point cloud'],
    why: 'the same shape without the collision, to show what the axis does instead: categories at equal spacing, no axis type',
    rows: [
      { tenure_months: 3, nps: 12 },
      { tenure_months: 9, nps: 47 },
      { tenure_months: 14, nps: 31 },
      { tenure_months: 21, nps: 38 },
    ],
  },
  {
    name: 'matrix-two-categories',
    shapes: ['matrix', 'heatmap'],
    why: 'one row per (month, region) — exactly the shape the collision rule already enforces, which is why a heatmap needs no new channel (§2.2)',
    rows: [
      { month: '2026-01', region: 'EMEA', notional_usd: 250 },
      { month: '2026-01', region: 'AMER', notional_usd: 180 },
      { month: '2026-02', region: 'EMEA', notional_usd: 310 },
      { month: '2026-02', region: 'AMER', notional_usd: 205 },
      { month: '2026-03', region: 'EMEA', notional_usd: 288 },
      { month: '2026-03', region: 'AMER', notional_usd: 240 },
    ],
  },
  {
    name: 'raw-observations-per-group',
    shapes: ['range', 'distribution', 'boxplot'],
    why: 'many rows per group, so a range needs min/max aggregation — and a boxplot needs percentiles, which the transform DSL does not have (§2.3)',
    rows: [
      { day: 'Mon', latency_ms: 120 },
      { day: 'Mon', latency_ms: 180 },
      { day: 'Mon', latency_ms: 380 },
      { day: 'Tue', latency_ms: 90 },
      { day: 'Tue', latency_ms: 240 },
      { day: 'Tue', latency_ms: 410 },
      { day: 'Wed', latency_ms: 150 },
      { day: 'Wed', latency_ms: 500 },
    ],
  },
  {
    name: 'five-number-summary',
    shapes: ['boxplot (present mode)'],
    why: 'the same data already reduced to low/q1/median/q3/high, which is the only way a boxplot can be drawn today: the caller own SQL has the percentiles',
    rows: [
      { day: 'Mon', low: 120, q1: 150, median: 190, q3: 260, high: 380 },
      { day: 'Tue', low: 90, q1: 130, median: 210, q3: 300, high: 410 },
      { day: 'Wed', low: 150, q1: 180, median: 240, q3: 330, high: 500 },
    ],
  },
  {
    name: 'flow-edges',
    shapes: ['links', 'sankey'],
    why: 'rows are edges (from, to, weight), not points — the one shape that genuinely needs a new declaration',
    rows: [
      { from_venue: 'LSE', to_venue: 'XETRA', notional_usd: 420 },
      { from_venue: 'LSE', to_venue: 'XNYS', notional_usd: 180 },
      { from_venue: 'XETRA', to_venue: 'XNYS', notional_usd: 95 },
    ],
  },
  {
    name: 'hierarchy-two-levels',
    shapes: ['hierarchy', 'treemap', 'sunburst'],
    why: 'two grouping levels in one table, which the engine emits as leaves only — the parent rows a treemap needs have to be derived',
    rows: [
      { region: 'EMEA', product: 'Rates', notional_usd: 100 },
      { region: 'EMEA', product: 'FX', notional_usd: 60 },
      { region: 'AMER', product: 'Rates', notional_usd: 40 },
      { region: 'AMER', product: 'Credit', notional_usd: 25 },
    ],
  },
  {
    name: 'sixty-categories',
    shapes: ['categorical (dense)', 'overflow'],
    why: 'the dense regime: 60 bands against a 400px axis at a 6px minimum is where the elastic budget stops stretching and starts dropping, and where labels must rotate',
    rows: Array.from({ length: 60 }, (_, index) => ({
      counterparty: `CP-${String(index + 1).padStart(2, '0')}`,
      notional_usd: 1000 + ((index * 137) % 900),
    })),
  },
  {
    name: 'long-category-labels',
    shapes: ['categorical (labels)'],
    why: 'four long labels in a narrow axis: the case that decides rotation, and the one `chart.orientation` alone cannot fix',
    rows: [
      { desk: 'European Investment Grade Credit', notional_usd: 320 },
      { desk: 'US High Yield Distressed', notional_usd: 180 },
      { desk: 'Asia-Pacific Rates & FX', notional_usd: 240 },
      { desk: 'Emerging Market Local Debt', notional_usd: 95 },
    ],
  },
  {
    name: 'signed-values',
    shapes: ['categorical (diverging)', 'waterfall'],
    why: 'profit and loss: a zero baseline, negative bars, and the only case where a diverging colour scheme is honest',
    rows: [
      { desk: 'Rates', pnl_usd: 1240 },
      { desk: 'Credit', pnl_usd: -380 },
      { desk: 'FX', pnl_usd: 610 },
      { desk: 'Equities', pnl_usd: -90 },
    ],
  },
  {
    name: 'nulls-and-zeros',
    shapes: ['categorical (nulls)', 'line (nulls)'],
    why: 'a null measure and a real zero, which must not be drawn the same way — a null is a gap, a zero is a value',
    rows: [
      { month: '2026-01', trades: 12 },
      { month: '2026-02', trades: 0 },
      { month: '2026-03', trades: null },
      { month: '2026-04', trades: 31 },
    ],
  },
  {
    name: 'degenerate',
    shapes: ['any'],
    why: 'one row: the smallest table that can still be charted, and the one that breaks axis maths first',
    rows: [{ region: 'East', revenue: 250 }],
  },
];

export const datasetByName = new Map(datasets.map((dataset) => [dataset.name, dataset]));

/** What compiling a case does today. */
export type Today =
  | { outcome: 'compiles'; series: number; points: number }
  | { outcome: 'refused'; matches: string }
  | { outcome: 'no-type-yet'; needs: string };

export type CorpusCase = {
  dataset: Dataset;
  /** A spec that uses this data with a declared type. Absent when no declared type fits. */
  spec?: ChartSpec;
  today: Today;
  /**
   * For a shape no declared type can express today: the closest spec that *does* compile,
   * and what that costs. Asserted by the test, so the gap is demonstrated rather than
   * described — "the second measure is simply gone" is a fact about the output.
   */
  nearlyWorks?: { spec: ChartSpec; loses: string };
};

const spec = (type: string, x: string, y: string, extra?: Partial<ChartSpec>): ChartSpec => ({
  chart: { type },
  encodings: { x: { field: x }, y: { field: y } },
  ...extra,
});

/**
 * The corpus, paired with what happens today.
 *
 * These expectations are a *characterisation* of the current compiler, not a wish: several
 * of them are the gaps P1 exists to close, and they are written down so that closing one is
 * a deliberate edit rather than a surprise.
 */
export const CORPUS: CorpusCase[] = [
  { dataset: byName('categories-one-measure'), spec: spec('bar', 'region', 'revenue'), today: { outcome: 'compiles', series: 1, points: 3 } },
  { dataset: byName('categories-one-measure'), spec: spec('pie', 'region', 'revenue'), today: { outcome: 'compiles', series: 1, points: 3 } },
  { dataset: byName('categories-split-by-series'), spec: spec('bar', 'region', 'revenue', { encodings: { x: { field: 'region' }, y: { field: 'revenue' }, series: { field: 'currency' } } }), today: { outcome: 'compiles', series: 2, points: 3 } },
  { dataset: byName('months-in-order'), spec: spec('line', 'month', 'notional_usd'), today: { outcome: 'compiles', series: 1, points: 5 } },
  { dataset: byName('months-with-a-gap'), spec: spec('line', 'month', 'notional_usd'), today: { outcome: 'compiles', series: 1, points: 4 } },

  // The dual-axis case: today the only way to state it is to drop one measure, which the
  // test demonstrates by asserting the second measure does not appear in the output at all.
  {
    dataset: byName('two-measures-different-units'),
    today: { outcome: 'no-type-yet', needs: 'encodings.y2 and chart.type2 (§3.4, committed for P1)' },
    nearlyWorks: {
      spec: spec('bar', 'counterparty', 'notional_usd'),
      loses: 'avg_commission_bps, and with it the comparison the request was about',
    },
  },

  // A cloud today: refused, and the refusal advises aggregating, which is the opposite of
  // what a scatter wants (§2.1). The unique-x variant compiles, on a category axis.
  { dataset: byName('numeric-pair-with-duplicate-x'), spec: spec('line', 'tenure_months', 'nps'), today: { outcome: 'refused', matches: "more than one row for category '9'" } },
  { dataset: byName('numeric-pair-unique-x'), spec: spec('line', 'tenure_months', 'nps'), today: { outcome: 'compiles', series: 1, points: 4 } },

  // A heatmap's shape is already legal: it is the shape the collision rule enforces, and
  // compiling it as a bar proves the table is accepted (§2.2).
  { dataset: byName('matrix-two-categories'), spec: spec('bar', 'month', 'notional_usd', { encodings: { x: { field: 'month' }, y: { field: 'notional_usd' }, series: { field: 'region' } } }), today: { outcome: 'compiles', series: 2, points: 3 } },

  { dataset: byName('raw-observations-per-group'), spec: spec('bar', 'day', 'latency_ms'), today: { outcome: 'refused', matches: "more than one row for category 'Mon'" } },
  { dataset: byName('five-number-summary'), today: { outcome: 'no-type-yet', needs: 'a five-value channel set (P2, present mode first)' } },
  { dataset: byName('flow-edges'), today: { outcome: 'no-type-yet', needs: "data.shape: 'links' plus a validator that does not demand x and y (P3)" } },
  { dataset: byName('hierarchy-two-levels'), today: { outcome: 'no-type-yet', needs: 'hierarchy levels and derived parent rows (P3)' } },

  // Dense and awkward, but legal: one row per category, so it compiles today and is exactly
  // what the layout work in P1 has to survive.
  { dataset: byName('sixty-categories'), spec: spec('bar', 'counterparty', 'notional_usd'), today: { outcome: 'compiles', series: 1, points: 60 } },
  { dataset: byName('long-category-labels'), spec: spec('bar', 'desk', 'notional_usd'), today: { outcome: 'compiles', series: 1, points: 4 } },
  { dataset: byName('signed-values'), spec: spec('bar', 'desk', 'pnl_usd'), today: { outcome: 'compiles', series: 1, points: 4 } },

  // A null measure is plotted as a gap, which is right; the point count still includes it.
  { dataset: byName('nulls-and-zeros'), spec: spec('line', 'month', 'trades'), today: { outcome: 'compiles', series: 1, points: 4 } },

  { dataset: byName('degenerate'), spec: spec('bar', 'region', 'revenue'), today: { outcome: 'compiles', series: 1, points: 1 } },
];

function byName(name: string): Dataset {
  const found = datasetByName.get(name);
  if (!found) throw new Error(`corpus case refers to unknown dataset '${name}'`);
  return found;
}
