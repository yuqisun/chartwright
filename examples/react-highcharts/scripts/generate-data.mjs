/**
 * Generates the example's synthetic datasets.
 *
 * Why synthetic: real post-trade data (executions, allocations, settlement
 * instructions, breaks) is proprietary and often carries personal or regulated
 * identifiers, so it cannot ship with an example. A generated set is also
 * *deterministic* (fixed seed), which means tests can assert exact answers.
 *
 * The shape mirrors a real post-trade / settlement feed: an execution that has
 * been allocated, enriched with venue + counterparty + clearing details, and
 * then settled (or not).
 *
 * Three files are written, from one pass over the same seeded rows:
 *
 *   post-trade.json            800 raw executions: the natural-language demo,
 *                              where the model investigates the table itself.
 *   counterparty-summary.json  a `GROUP BY counterparty` result, pre-sorted.
 *   monthly-activity.json      a `GROUP BY month` result, pre-sorted.
 *
 * The last two are what a consumer that has already run its own aggregation
 * hands to chartwright in "present" mode: final numbers, not raw material. They
 * are derived here rather than typed by hand so that every figure in them can be
 * checked against the raw rows.
 *
 * NOTE: identifiers here are synthetic. The ISIN-like codes use the "XS"
 * prefix and random characters purely for realism — they are not real
 * securities identifiers, and nothing in this file represents real trades.
 *
 * Usage: node scripts/generate-data.mjs   (writes ../data/)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', 'data');
const OUT = join(DATA_DIR, 'post-trade.json');
const COUNTERPARTY_OUT = join(DATA_DIR, 'counterparty-summary.json');
const MONTHLY_OUT = join(DATA_DIR, 'monthly-activity.json');

const ROW_COUNT = 800;
const SEED = 20260910;
const FIRST_DAY = Date.UTC(2026, 0, 1); // 2026-01-01
const DAYS = 181; // through 2026-06-30

/** mulberry32: tiny deterministic PRNG so the dataset is reproducible. */
function makeRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = makeRandom(SEED);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const round = (x, dp) => Number(x.toFixed(dp));

// Weighted pick: [[value, weight], ...]
function weighted(pairs) {
  const total = pairs.reduce((n, [, w]) => n + w, 0);
  let r = rand() * total;
  for (const [value, w] of pairs) {
    r -= w;
    if (r <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

/**
 * Counterparty flow is deliberately *not* uniform.
 *
 * Real post-trade volume is dominated by a handful of dealers with a long tail
 * behind them. It also matters to this example: if every counterparty held an
 * equal share, each group's average would be a near-restatement of the whole
 * table's, and a bad re-aggregation would be numerically invisible — the exact
 * failure the "present" mode exists to prevent. Skewed groups make the difference
 * real and measurable.
 *
 * Weights, not percentages: the top three hold about 55% of the flow, the last
 * three about 7%.
 *
 * `weighted` draws exactly one random number per row, the same as `pick` did, so
 * swapping them changes the `counterparty` column and nothing else.
 */
const COUNTERPARTIES = [
  ['Northgate Capital Markets', 22],
  ['Halloway Partners', 16],
  ['Fairhaven Securities', 12],
  ['Eastvale Markets', 9],
  ['Blue Harbour Trading', 7],
  ['Granite Row Capital', 6],
  ['Aldermere Securities', 5],
  ['Kingsmere Securities', 4],
  ['Ironbridge Trading', 3],
  ['Larkspur Markets', 3],
  ['Dunmore Financial', 2],
  ['Cedar Point Brokers', 1],
];

const VENUES = ['XETRA', 'LSE', 'Euronext Paris', 'SIX', 'Nasdaq', 'Turquoise', 'Cboe Europe', 'OTC'];

// [asset class, typical price magnitude, currency bias]
const ASSET_CLASSES = [
  { name: 'Equity', price: [8, 420], ccy: ['USD', 'EUR', 'GBP', 'CHF', 'SEK'] },
  { name: 'Fixed Income', price: [92, 108], ccy: ['USD', 'EUR', 'GBP'] },
  { name: 'FX', price: [0.85, 1.35], ccy: ['USD', 'EUR', 'GBP', 'JPY'] },
  { name: 'Listed Derivative', price: [1.2, 65], ccy: ['USD', 'EUR'] },
  { name: 'Money Market', price: [99.4, 100.1], ccy: ['USD', 'EUR'] },
];

const DESKS = ['Equities', 'Rates', 'Credit', 'FX & Commodities'];
const CLEARERS = ['LCH', 'Eurex Clearing', 'Cboe Clear', 'ICE Clear'];
const BREAK_REASONS = [
  'quantity_mismatch',
  'price_mismatch',
  'missing_ssi',
  'fx_rate_difference',
  'counterparty_not_standing',
];

// Indicative rates to USD. Static by design: the example should not depend on
// a market data feed.
const FX_TO_USD = { USD: 1, EUR: 1.08, GBP: 1.27, CHF: 1.12, JPY: 0.0064, SEK: 0.095 };

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const synthCode = (n) => Array.from({ length: n }, () => ALNUM[int(0, ALNUM.length - 1)]).join('');
const dayMs = 86_400_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

const rows = [];
for (let i = 0; i < ROW_COUNT; i++) {
  const assetClass = pick(ASSET_CLASSES);
  const [lo, hi] = assetClass.price;
  const currency = pick(assetClass.ccy);
  const side = weighted([
    ['Buy', 51],
    ['Sell', 49],
  ]);
  const quantity = assetClass.name === 'FX' ? int(50_000, 8_000_000) : int(10, 120_000);
  const price = round(lo + rand() * (hi - lo), assetClass.name === 'FX' ? 4 : 2);
  const notional = quantity * price;
  const notionalUsd = round(notional * FX_TO_USD[currency], 2);

  const tradeDay = int(0, DAYS - 1);
  // T+2 dominates, with a tail of T+0/T+1/T+3 — enough spread for a real
  // "settlement lag" question.
  const lag = weighted([
    [0, 4],
    [1, 18],
    [2, 68],
    [3, 10],
  ]);
  const tradeDate = FIRST_DAY + tradeDay * dayMs;
  const settlementDate = tradeDate + lag * dayMs;

  const status = weighted([
    ['Settled', 88],
    ['Pending', 8],
    ['Failed', 2.5],
    ['Cancelled', 1.5],
  ]);
  const breakReason = status === 'Failed' || (status === 'Pending' && rand() < 0.25) ? pick(BREAK_REASONS) : null;
  const commissionBps = round(0.5 + rand() * 7.5, 2);

  rows.push({
    trade_id: `TR-2026-${String(i + 1).padStart(6, '0')}`,
    exec_id: `EX-${synthCode(8)}`,
    isin: `XS${synthCode(9)}${int(0, 9)}`,
    symbol: `${synthCode(4)} ${pick(['SE', 'LN', 'GY', 'FP', 'SW', 'US'])}`,
    instrument_name: `${assetClass.name} ${synthCode(3)} ${2026 + int(0, 2)}`,
    asset_class: assetClass.name,
    side,
    quantity,
    price,
    currency,
    notional_usd: notionalUsd,
    trade_date: isoDay(tradeDate),
    settlement_date: isoDay(settlementDate),
    settlement_lag_days: lag,
    settlement_method: weighted([
      ['DVP', 82],
      ['FOP', 12],
      ['RFP', 6],
    ]),
    venue: pick(VENUES),
    counterparty: weighted(COUNTERPARTIES),
    desk: pick(DESKS),
    clearing_house: pick(CLEARERS),
    commission_bps: commissionBps,
    commission_usd: round((notionalUsd * commissionBps) / 10_000, 2),
    status,
    break_reason: breakReason,
  });
}

// ---------------------------------------------------------------------------
// Pre-aggregated tables for the "present" mode demo.
//
// These are what a consumer's own query would have returned. The first is, to
// the letter, this query over the rows above:
//
//   SELECT counterparty,
//          COUNT(*)                    AS trades,
//          SUM(notional_usd)           AS notional_usd,
//          AVG(commission_bps)         AS avg_commission_bps,
//          COUNT(DISTINCT venue)       AS distinct_venues,
//          MAX(notional_usd)           AS largest_trade_usd,
//          SUM(status = 'Failed')      AS failed_settlements,
//          100 * SUM(status = 'Settled') / COUNT(*) AS settled_share_pct
//   FROM   post_trade
//   GROUP  BY counterparty
//   ORDER  BY notional_usd DESC;
//
// The grouping is done here, and so is the ordering: that ORDER BY *is* the
// caller's ranking, and nothing downstream may redo it. Several columns are also
// final in a way that re-deriving them would corrupt — an average, a distinct
// count, a maximum, a ratio. That is the entire reason present mode exists.
// ---------------------------------------------------------------------------

const sum = (xs) => xs.reduce((total, x) => total + x, 0);
const mean = (xs, dp) => round(sum(xs) / xs.length, dp);
const count = (xs, predicate) => xs.filter(predicate).length;

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const k = key(item);
    const bucket = groups.get(k);
    if (bucket) bucket.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

const counterpartySummary = [...groupBy(rows, (r) => r.counterparty)]
  .map(([counterparty, group]) => ({
    counterparty,
    trades: group.length,
    notional_usd: round(sum(group.map((r) => r.notional_usd)), 2),
    /** Not additive: the average of averages is not the overall average. */
    avg_commission_bps: mean(group.map((r) => r.commission_bps), 2),
    /** Not additive: venues do not partition cleanly across counterparties. */
    distinct_venues: new Set(group.map((r) => r.venue)).size,
    /** Not additive: a maximum is not a sum, and the average of maxima is nothing. */
    largest_trade_usd: round(Math.max(...group.map((r) => r.notional_usd)), 2),
    failed_settlements: count(group, (r) => r.status === 'Failed'),
    /** Not additive: a ratio owes its meaning to its denominator. */
    settled_share_pct: round((count(group, (r) => r.status === 'Settled') / group.length) * 100, 1),
  }))
  // The caller's ORDER BY: notional descending, with a name tiebreak so the file
  // is byte-stable across runs. Same tie policy as the library's `rank` op.
  .sort((a, b) => b.notional_usd - a.notional_usd || a.counterparty.localeCompare(b.counterparty));

const monthlyActivity = [...groupBy(rows, (r) => r.trade_date.slice(0, 7))]
  .map(([month, group]) => ({
    month,
    trades: group.length,
    notional_usd: round(sum(group.map((r) => r.notional_usd)), 2),
    /** Not additive, for the same reason as the commission average above. */
    avg_settlement_lag_days: mean(group.map((r) => r.settlement_lag_days), 2),
    failed_settlements: count(group, (r) => r.status === 'Failed'),
  }))
  .sort((a, b) => a.month.localeCompare(b.month));

const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

mkdirSync(DATA_DIR, { recursive: true });
writeJson(OUT, rows);
writeJson(COUNTERPARTY_OUT, counterpartySummary);
writeJson(MONTHLY_OUT, monthlyActivity);

console.log(`wrote ${rows.length} rows to ${OUT}`);
console.log(`  settled=${count(rows, (r) => r.status === 'Settled')} failed=${count(rows, (r) => r.status === 'Failed')}`);
console.log(`wrote ${counterpartySummary.length} rows to ${COUNTERPARTY_OUT}`);
console.log(`wrote ${monthlyActivity.length} rows to ${MONTHLY_OUT}`);

// What re-aggregating each table would do to it, printed rather than asserted in
// prose. Three kinds of damage, in increasing order of danger:
//
//   by a mile — a distinct count or a maximum does not survive re-aggregation at
//               all, and the result is nonsense on its face;
//   visibly   — an average or a ratio shifts by more than the precision the file
//               stores, so a careful reader could catch it — if they still had the
//               true number to compare against, which a finished chart does not
//               give them;
//   silently  — a figure moves by less than the precision stored. Nobody can see
//               it. This is the case that argues for present mode: the caller's own
//               numbers are the only ones certainly right.
const report = (label, wrong, right, dp) => {
  const identical = wrong.toFixed(dp) === right.toFixed(dp);
  console.log(
    `    ${label.padEnd(24)} ${wrong.toFixed(dp)} vs a true ${right.toFixed(dp)}` +
      (identical ? '   <- identical at the precision stored' : ''),
  );
};

const trueVenues = new Set(rows.map((r) => r.venue)).size;
const summedVenues = sum(counterpartySummary.map((r) => r.distinct_venues));
const trueLargest = Math.max(...rows.map((r) => r.notional_usd));
const summedLargest = sum(counterpartySummary.map((r) => r.largest_trade_usd));

console.log('  re-aggregating these tables would give:');
console.log(`    ${'distinct_venues'.padEnd(24)} sum=${summedVenues} vs a true ${trueVenues}`);
console.log(
  `    ${'largest_trade_usd'.padEnd(24)} sum=${Math.round(summedLargest)} vs a true ${Math.round(trueLargest)} ` +
    `(${(summedLargest / trueLargest).toFixed(1)}x)`,
);
report('avg_commission_bps', mean(counterpartySummary.map((r) => r.avg_commission_bps), 4), mean(rows.map((r) => r.commission_bps), 4), 2);
report(
  'settled_share_pct',
  mean(counterpartySummary.map((r) => r.settled_share_pct), 4),
  (count(rows, (r) => r.status === 'Settled') / rows.length) * 100,
  1,
);
report('avg_settlement_lag_days', mean(monthlyActivity.map((r) => r.avg_settlement_lag_days), 4), mean(rows.map((r) => r.settlement_lag_days), 4), 2);
