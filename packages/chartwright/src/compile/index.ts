/**
 * The compiler entry point: neutral spec + rows → chart-library options.
 *
 * Three steps, in this order, and the order matters:
 *   1. `buildChartModel` materialises the plan over **all** rows and describes
 *      the chart in neutral terms;
 *   2. `resolveEmphasis` decides which data the emphasis rules match — the model
 *      declared the condition, this evaluates it against the real data;
 *   3. the backend turns the model into the library's own options.
 *
 * No model, no network, no randomness: replay the same spec over the same rows
 * and you get the same options.
 */
import { toHighchartsOptions } from './backends/highcharts.ts';
import { resolveEmphasis } from './emphasis.ts';
import { buildChartModel, rowDatumKey } from './model.ts';
import type { ChartOptions } from './backends/highcharts.ts';
import type { ChartSpec, Row } from '../types.ts';

export type CompiledChart = {
  options: ChartOptions;
  /** The complete table that was plotted. */
  dataset: Row[];
  warnings: string[];
};

function keyOf(spec: ChartSpec) {
  const xField = spec.encodings.x?.field ?? '';
  const seriesField = spec.encodings.series?.field;
  return (row: Row) => rowDatumKey(row, xField, seriesField);
}

export function compileToHighcharts(spec: ChartSpec, rows: Row[]): CompiledChart {
  const { model } = buildChartModel(spec, rows);

  // Emphasis is evaluated over the materialised table, keyed by category value
  // rather than position, so it survives any reordering the backend does.
  const emphasis = resolveEmphasis(spec.emphasis, model.dataset, keyOf(spec));

  return {
    options: toHighchartsOptions(model, emphasis),
    dataset: model.dataset,
    warnings: emphasis.warnings,
  };
}

export { isSupportedChartType, materialize, SUPPORTED_CHART_TYPES } from './model.ts';
export type { ChartModel, SupportedChartType } from './model.ts';
export type { ChartOptions } from './backends/highcharts.ts';
