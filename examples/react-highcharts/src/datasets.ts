/**
 * The rows behind the chart-selection catalog.
 *
 * Split from `presets.ts` on purpose. `data.ts` imports `.json`, and plain
 * `node --experimental-strip-types` needs an import attribute for JSON while the Vite build does
 * not — so anything that imports rows cannot be tested outside a bundler. The catalog holds
 * metadata only and stays testable; this file holds the data and only the page imports it.
 *
 * The descriptions and column notes are the ones `demos.ts` already sends for the same tables.
 * They are shared rather than copied: a present-mode table full of averages and distinct counts
 * needs that text whichever page asks, and two copies would eventually disagree.
 */
import { counterpartySummary, monthlyActivity, rows, tradeSizeBand } from './data.ts';
import { MONTHLY_TABLE, SUMMARY_TABLE } from './demos.ts';
import type { DatasetId } from './presets.ts';

/** A row is whatever the caller passes in: chartwright never assumes a schema. */
export type Row = Record<string, unknown>;

export type DatasetEntry = {
  rows: Row[];
  /** The caller's own words about the table. Goes to the prompt, and nowhere else. */
  description?: string;
  /** Per-column notes, for tables whose values cannot speak for themselves. */
  columns?: Array<{ name: string; description?: string }>;
};

export const DATASETS: Record<DatasetId, DatasetEntry> = {
  'post-trade': { rows: rows as Row[] },
  'counterparty-summary': { rows: counterpartySummary as Row[], ...SUMMARY_TABLE },
  'monthly-activity': { rows: monthlyActivity as Row[], ...MONTHLY_TABLE },
  'trade-size-band': { rows: tradeSizeBand as Row[] },
};
