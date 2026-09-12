/**
 * Loads the example's datasets.
 *
 * The difference between them is the point of the example:
 *
 *   rows                 — 800 raw executions. The natural-language demo: the
 *                          model investigates the table itself with tools.
 *   counterpartySummary  — a `GROUP BY counterparty` result, already grouped and
 *                          already ranked. What a consumer hands over and says
 *                          "chart this" — under `present: true`.
 *   monthlyActivity      — the same idea, `GROUP BY month`: a time series.
 *   cancellationsByMonth — also `GROUP BY month`, but sparse: only the months in
 *                          which something was cancelled. A date column whose values
 *                          are not consecutive, which is the one case where "the order
 *                          you pass is the order shown" and "a date gets a time axis"
 *                          would visibly disagree (docs/roadmap.md item 21).
 *
 * The present-mode tables are a consumer's *final numbers*. Being able to say that
 * nothing downstream may re-derive them — no aggregate, no filter, no sort — is exactly
 * what present mode buys, and they carry columns that re-aggregating would corrupt (see
 * the notes printed by `scripts/generate-data.mjs`).
 *
 * Everything else — column metadata, profiling, transformation — comes from
 * chartwright, so the example demonstrates the library's real surface instead of
 * a parallel implementation of it.
 */
import cancellationsJson from '../data/cancellations-by-month.json';
import counterpartySummaryJson from '../data/counterparty-summary.json';
import monthlyActivityJson from '../data/monthly-activity.json';
import postTrade from '../data/post-trade.json';

/** A row is whatever the caller passes in: chartwright never assumes a schema. */
export type Row = Record<string, unknown>;

export const rows = postTrade as Row[];

/** `GROUP BY counterparty`, ordered by notional descending — the caller's `ORDER BY`. */
export const counterpartySummary = counterpartySummaryJson as Row[];

/** `GROUP BY month`, ascending — pre-sorted for the same reason. */
export const monthlyActivity = monthlyActivityJson as Row[];

/** `GROUP BY month` again, but only the months that had a cancellation. */
export const cancellationsByMonth = cancellationsJson as Row[];
