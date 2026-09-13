/**
 * The chart-selection catalog: a question, and every chart type that answers it honestly.
 *
 * Why this file exists. The library declares 14 chart types, and the example could show all of
 * them — but only from specs written by hand, with no model involved. Nothing anywhere asked
 * whether the model *chooses* a type that suits a question, so a wrong pick looked exactly like
 * a right one, and eight of the fourteen types had no query that could reach them at all.
 *
 * This is that missing list: request → acceptable type(s). `docs/spec-extension-plan.md` §5.7
 * asks for exactly this shape to measure model choice quality, so it is written as data with no
 * React and no rows in it, and the page (`components/TypeMatrix.tsx`) is one consumer of it.
 *
 * **Why a set of types and not one.** `line`, `spline`, `area` and `areaspline` are stylistic
 * variants of a single answer: no wording distinguishes "show the trend as a spline" from the
 * same request as a line, and the compiler treats them identically apart from the Highcharts
 * type. The same holds for the five range types on a range question. A catalog that demanded
 * one exact type would therefore report a *false failure* on five of the fourteen types — and a
 * false failure teaches the reader to stop reading the verdict, which is worse than no test.
 * The verdict is `picked ∈ accepts`: did the model choose something that suits the question.
 *
 * Rows are deliberately **not** here. `data.ts` imports `.json`, and plain
 * `node --experimental-strip-types` needs an import attribute for JSON that the Vite build does
 * not — so a catalog that imported rows could not be tested outside a bundler. Metadata only;
 * `datasets.ts` holds the rows and only the page imports it.
 */
import type { ChartType } from 'chartwright';

/** Which rows a preset hands over. Ids, not rows: `datasets.ts` owns the data, the page owns it. */
export type DatasetId = 'post-trade' | 'counterparty-summary' | 'monthly-activity' | 'trade-size-band';

/**
 * What is known about a dataset without loading it.
 *
 * `preAggregated` is the one that carries weight: a `present`-mode presets over raw rows would
 * chart nonsense and blame the model, so the test asserts the two agree.
 */
export const DATASET_META: Record<DatasetId, { label: string; rows: number; preAggregated: boolean }> = {
  'post-trade': { label: 'post-trade.json', rows: 800, preAggregated: false },
  'counterparty-summary': { label: 'counterparty-summary.json', rows: 12, preAggregated: true },
  'monthly-activity': { label: 'monthly-activity.json', rows: 6, preAggregated: true },
  'trade-size-band': { label: 'trade-size-band.json', rows: 6, preAggregated: true },
};

export type ChartPreset = {
  id: string;
  /** The type this query is filed under — the group heading it appears beneath. */
  exercises: ChartType;
  /** Every type that would be an honest answer. The verdict is `picked ∈ accepts`. */
  accepts: ChartType[];
  query: string;
  dataset: DatasetId;
  mode: 'ask' | 'present';
  /** What a right answer looks like, and what a wrong one would look like. Shown when one is wrong. */
  why: string;
};

/** The four types no wording separates, so a query accepting one accepts all of them. */
const TIME_SERIES: ChartType[] = ['line', 'spline', 'area', 'areaspline'];

/** The band types, likewise: which of them draws a low/high pair is a presentation preference. */
const BAND: ChartType[] = ['arearange', 'areasplinerange', 'columnrange'];

export const PRESETS: ChartPreset[] = [
  {
    id: 'ranked-comparison',
    exercises: 'bar',
    accepts: ['bar'],
    query: 'Which 10 counterparties have the largest traded notional?',
    dataset: 'post-trade',
    mode: 'ask',
    why: 'A ranked top-10 of categories is the case horizontal bars exist for. The model has to aggregate first — the raw table is one row per execution, so bars drawn straight from it would be nonsense.',
  },
  {
    id: 'time-series-present',
    exercises: 'line',
    accepts: TIME_SERIES,
    query: 'How has traded notional developed over the six months?',
    dataset: 'monthly-activity',
    mode: 'present',
    why: 'One row per month already: a series, so a connecting type. Any of the four is honest — they differ in how the line is drawn, not in what the chart says.',
  },
  {
    id: 'time-series-ask',
    exercises: 'line',
    accepts: TIME_SERIES,
    query: 'How has monthly traded notional developed, split by asset class?',
    dataset: 'post-trade',
    mode: 'ask',
    why: 'The same shape as the preset above, but the model has to build it: a binTime plus an aggregate, then a series per asset class. A bar chart here would be a failure — months are a sequence, not a ranking.',
  },
  {
    id: 'share-of-whole',
    exercises: 'pie',
    accepts: ['pie'],
    query: 'What share of total notional does each asset class represent?',
    dataset: 'post-trade',
    mode: 'ask',
    why: 'The only question here about parts of a whole rather than a comparison. A bar chart would show the same numbers and lose the "share" reading the question asked for.',
  },
  {
    id: 'two-categories-and-a-measure',
    exercises: 'heatmap',
    accepts: ['heatmap'],
    query: 'Show traded notional by desk and asset class as a grid',
    dataset: 'post-trade',
    mode: 'ask',
    why: 'Two categorical columns plus a measure is exactly a matrix. Without a heatmap declared this shape had no honest answer — it needs one row per (desk, asset class) pair, which the model must aggregate to first.',
  },
  {
    id: 'two-numeric-measures',
    exercises: 'scatter',
    accepts: ['scatter'],
    query: 'Is there a relationship between trade size and commission?',
    dataset: 'post-trade',
    mode: 'ask',
    why: 'Both channels numeric, one point per trade, and the question is about a relationship rather than a comparison. A bar chart of 800 categories would be the visible failure.',
  },
  {
    id: 'three-numeric-measures',
    exercises: 'bubble',
    accepts: ['bubble'],
    query: 'Plot notional against commission, with how many trades as the bubble size',
    dataset: 'post-trade',
    mode: 'ask',
    why: 'The scatter question plus a third numeric channel. Scatter would be a defensible near-miss — it loses the size dimension the question named — which is why the verdict is worth reading rather than assuming.',
  },
  {
    id: 'band-over-time',
    exercises: 'arearange',
    accepts: [...BAND, 'errorbar'],
    query: 'Chart the range of trade sizes in each month',
    dataset: 'trade-size-band',
    mode: 'present',
    why: 'The table has a low and a high per month, which no single-measure type can draw without discarding one of them. `dumbbell` is the near-miss worth watching for: it draws the same two values as two points joined, which reads as a comparison rather than a band.',
  },
  {
    id: 'band-across-categories',
    exercises: 'dumbbell',
    accepts: ['dumbbell', ...BAND, 'errorbar'],
    query: 'Compare the low and high trade size for each month',
    dataset: 'trade-size-band',
    mode: 'present',
    why: 'The same table read as a comparison between two named values rather than as a spread. Here the model is being asked to pick a type that shows both ends distinctly, and any of the five does that.',
  },
  {
    id: 'ranking-present',
    exercises: 'bar',
    accepts: ['bar'],
    query: 'Chart the traded notional by counterparty',
    dataset: 'counterparty-summary',
    mode: 'present',
    why: 'The caller has already ranked these twelve rows. A bar chart in the given order is the answer; anything that re-sorts them has overruled the caller, and present mode gives the model no tool to do it with.',
  },
  {
    id: 'band-second-angle',
    exercises: 'arearange',
    accepts: [...BAND, 'errorbar'],
    query: 'How has the spread of trade sizes moved month by month?',
    dataset: 'trade-size-band',
    mode: 'present',
    why: 'The band question asked a second way, so one phrasing being answered well does not stand in for the type being reliable. "Spread" and "range" should land in the same place.',
  },
];
