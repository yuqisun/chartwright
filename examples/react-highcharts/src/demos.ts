/**
 * The four interactive demos, and what each one is supposed to show.
 *
 * These need a key, because they run the real thing: the model investigates the table with
 * its tools and submits a spec. Everything else on the page is generated and needs nothing.
 *
 * `expects` is written per preset on purpose. A demo that only shows a query and a chart leaves
 * the reader to guess whether the result was right; saying what should come back is what makes
 * it testable by eye, and it is also how a wrong answer becomes visible instead of plausible.
 */
import { cancellationsByMonth, counterpartySummary, monthlyActivity, rows } from './data.ts';

/** A row is whatever the caller passes in: chartwright never assumes a schema. */
export type Row = Record<string, unknown>;

export type Preset = { ask: string; expects: string };

export type DemoId = 'ask' | 'present' | 'monthly' | 'gapped';

export type Demo = {
  id: DemoId;
  label: string;
  blurb: string;
  rows: Row[];
  presets: Preset[];
  present: boolean;
  /** The file the rows came from, printed on the page so the data is never anonymous. */
  dataName: string;
  /** What those rows are, in one line. */
  dataKind: string;
  /** The caller's own words about the table. Goes to the prompt, and nowhere else. */
  dataDescription?: string;
  columns?: Array<{ name: string; description?: string }>;
};

const ASK_PRESETS: Preset[] = [
  {
    ask: 'Which 10 counterparties have the largest traded notional?',
    expects:
      'Ten bars, largest first. A ranked top-10 is the case horizontal orientation exists for, so expect the labels down the side — and a plan that sorts before it limits.',
  },
  {
    ask: 'How has monthly traded notional developed, split by asset class?',
    expects:
      'One line per asset class over the months, with a legend, after a binTime plus aggregate plan. The model has to shape the table before it can chart it.',
  },
  {
    ask: 'Which venues have the most failed settlements?',
    expects:
      'One bar per venue, but only after a run_query that counts failures — the raw table is one row per execution, so a chart drawn straight from it would be nonsense.',
  },
  {
    ask: 'What share of total notional does each asset class represent?',
    expects: 'A pie. This is the one preset where the question is about shares of a whole rather than a comparison.',
  },
  {
    ask: 'Show the top counterparties and fade the rest so the big three stand out',
    expects:
      'Emphasis rather than filtering: the same bars, three highlighted and the rest muted. The spec should carry a declared condition, not a colour the model picked.',
  },
];

const PRESENT_PRESETS: Preset[] = [
  {
    ask: 'Which counterparty traded the most notional?',
    expects:
      'The table as given, with a single bar highlighted. The ranking happens inside the compiler from the declared condition — the rows are not re-sorted.',
  },
  {
    ask: 'Chart the traded notional by counterparty',
    expects: 'One bar per counterparty, in the caller\u2019s ranked order, untouched.',
  },
  {
    ask: 'Which counterparty pays the highest commission?',
    expects:
      'A different measure from the same table (avg_commission_bps). It is an average, so recomputing it from these rows would be wrong — and present mode gives the model no tool to try.',
  },
  {
    ask: 'Keep the ranking, but fade everything except the top three',
    expects: 'The caller\u2019s order preserved, three highlighted, nine muted.',
  },
];

const MONTHLY_PRESETS: Preset[] = [
  {
    ask: 'How has traded notional developed over the six months?',
    expects: 'A line with six points, left to right in the order the rows arrived. Nothing is re-sorted.',
  },
  {
    ask: 'Chart the average settlement lag by month',
    expects:
      'The same six rows against a different measure. Averaging an average is the mistake this mode exists to prevent, so expect a straight read of the column.',
  },
  {
    ask: 'Which month had the most failed settlements?',
    expects: 'Bars with one highlighted, or a line — either is honest. The emphasis is what matters.',
  },
];

const GAPPED_PRESETS: Preset[] = [
  {
    ask: 'How have cancellations developed month by month?',
    expects:
      'A line whose labels are evenly spaced although 2026-04 and 2026-06 are two months apart. That is the cost of a date column being a category (roadmap item 21), and this demo exists to make it visible.',
  },
  {
    ask: 'Chart the cancelled notional by month',
    expects: 'The same shape against a different measure, still in the caller\u2019s order.',
  },
  {
    ask: 'Which month had the most cancellations?',
    expects: 'Bars with the largest one highlighted, computed from the data rather than named by the model.',
  },
];

export const DEMOS: Demo[] = [
  {
    id: 'ask',
    label: 'Ask the data',
    blurb:
      '800 raw post-trade executions. The model investigates with tools, shapes the table with a query plan, and the compiler binds the result into the chart.',
    rows,
    presets: ASK_PRESETS,
    present: false,
    dataName: 'post-trade.json',
    dataKind: 'one row per execution — nothing aggregated yet',
  },
  {
    id: 'present',
    label: 'Present a result',
    blurb:
      'Twelve rows a query already produced: grouped by counterparty, ranked by notional, with an average and a distinct count in them. It chooses how to draw this table — and has no tool that could change it.',
    rows: counterpartySummary,
    presets: PRESENT_PRESETS,
    present: true,
    dataName: 'counterparty-summary.json',
    dataKind: 'one row per counterparty, already ranked',
    // Descriptions are optional, and this is the case they exist for: nothing in the
    // values says that one column is an average and another is a count of distinct
    // venues, and a model that assumes otherwise would recompute them.
    dataDescription: 'One row per counterparty, already aggregated and ranked by traded notional descending.',
    columns: [
      { name: 'notional_usd', description: 'Sum over that counterparty\u2019s trades. Additive.' },
      { name: 'avg_commission_bps', description: 'Average commission in basis points. NOT additive.' },
      { name: 'distinct_venues', description: 'How many different venues that counterparty used. NOT additive.' },
      { name: 'largest_trade_usd', description: 'The largest single trade. A maximum, not a sum.' },
      { name: 'settled_share_pct', description: 'Settled as a percentage of that counterparty\u2019s trades.' },
    ],
  },
  {
    id: 'monthly',
    label: 'Present a time series',
    blurb:
      'Six rows, one per month — a series rather than a set of categories. This is where "do not recompute my columns" bites hardest: the settlement lag is an average, so a second pass over it would be wrong by an amount too small to see.',
    rows: monthlyActivity,
    presets: MONTHLY_PRESETS,
    present: true,
    dataName: 'monthly-activity.json',
    dataKind: 'one row per month of 2026',
    dataDescription: 'One row per month of 2026, already aggregated from the execution feed.',
    columns: [
      { name: 'notional_usd', description: 'Sum of traded notional in that month. Additive.' },
      {
        name: 'avg_settlement_lag_days',
        description:
          'Average settlement lag in days. NOT additive: averaging these six numbers is not the half-year average.',
      },
      { name: 'failed_settlements', description: 'How many settlements failed in that month.' },
    ],
  },
  {
    id: 'gapped',
    label: 'Present gapped dates',
    blurb:
      'Five rows, one per month that had a cancellation — 2026-05 is missing because nothing was cancelled then. `month` is a date column, and date columns are drawn as categories here (a decision, see roadmap item 21): watch the labels, which are evenly spaced even though 2026-04 and 2026-06 are two months apart.',
    rows: cancellationsByMonth,
    presets: GAPPED_PRESETS,
    present: true,
    dataName: 'cancellations-by-month.json',
    dataKind: 'one row per month that had a cancellation',
    dataDescription: 'One row per month that had at least one cancellation. Months with none are absent, not zero.',
    columns: [
      { name: 'month', description: 'The month. Note that these are not consecutive.' },
      { name: 'cancellations', description: 'How many trades were cancelled in that month. Additive.' },
      { name: 'notional_usd', description: 'Sum of the cancelled notional in that month. Additive.' },
    ],
  },
];
