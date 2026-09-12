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
import { buildChartModel, datumKey, rowDatumKey } from './model.ts';
import { resolveTheme } from './theme.ts';
import type { ChartOptions } from './backends/highcharts.ts';
import type { LayoutInput } from './layout.ts';
import type { ThemeInput } from './theme.ts';
import type { ChartSpec, Row } from '../types.ts';

export type CompiledChart = {
  options: ChartOptions;
  /** The complete table that was plotted. */
  dataset: Row[];
  warnings: string[];
};

/**
 * What a compile can be told, beyond the spec and the rows.
 *
 * The theme (how the chart looks) and the layout reference width (how much room the
 * compiler assumes it has). Both are fixed per consumer rather than per request —
 * which is why `createChartwright` holds them and a request cannot override them.
 */
export type CompileOptions = {
  theme?: ThemeInput;
  layout?: LayoutInput;
};

function keyOf(spec: ChartSpec) {
  const xField = spec.encodings.x?.field ?? '';
  const seriesField = spec.encodings.series?.field;
  const y2Field = spec.encodings.y2?.field;
  // The datum key must match what the model names its series after (§3.4 rule 1).
  // Combo + series: the model names series "${measure}: ${group}", so the key must too.
  // Combo alone: the measure field name IS the series component (not a column to read).
  // Neither: plain category key via rowDatumKey.
  return (row: Row, measureField?: string) => {
    if (seriesField !== undefined && y2Field !== undefined && measureField !== undefined) {
      return datumKey(String(row[xField]), `${measureField}: ${String(row[seriesField])}`);
    }
    if (seriesField !== undefined) return rowDatumKey(row, xField, seriesField);
    if (y2Field !== undefined && measureField !== undefined) {
      return datumKey(String(row[xField]), measureField);
    }
    return rowDatumKey(row, xField);
  };
}

export function compileToHighcharts(spec: ChartSpec, rows: Row[], options?: CompileOptions): CompiledChart {
  const { model } = buildChartModel(spec, rows);

  // Emphasis is evaluated over the materialised table, keyed by category value
  // rather than position, so it survives any reordering the backend does.
  // When y2 is present, non-top_k rules must style both measures for matching
  // categories, so we pass both measure field names (§3.4 rule 1).
  const yField = spec.encodings.y?.field;
  const y2Field = spec.encodings.y2?.field;
  const measureFields =
    yField !== undefined && y2Field !== undefined ? ([yField, y2Field] as const) : undefined;
  const emphasis = resolveEmphasis(spec.emphasis, model.dataset, keyOf(spec), measureFields);

  const { options: chartOptions, warnings: layoutWarnings } = toHighchartsOptions(
    model,
    emphasis,
    resolveTheme(options?.theme),
    options?.layout,
  );

  return {
    options: chartOptions,
    dataset: model.dataset,
    // An emphasis rule that matched nothing and an axis that cannot fit its labels are
    // the same kind of news: the chart drew, and something about it deserves a sentence.
    warnings: [...emphasis.warnings, ...layoutWarnings],
  };
}

export { isSupportedChartType, materialize, SUPPORTED_CHART_TYPES, findCategoryCollision } from './model.ts';
export { defaultTheme, resolveTheme, roleColors, seriesColors } from './theme.ts';
export { deriveAxisLayout, LAYOUT, overflowWarning, plotWidthOf } from './layout.ts';
export {
  CHANNEL_NAMES,
  CHART_TYPES,
  CHART_TYPE_NAMES,
  isChartType,
  listChartTypes,
  resolveAvailableTypes,
  resolveCapabilities,
} from './chart-types.ts';
export type { CategoryCollision, ChartModel, MatrixModel, SupportedChartType } from './model.ts';
export type { ColorRole, Theme, ThemeInput, ThemeRoles } from './theme.ts';
export type { AxisLayout, LayoutInput } from './layout.ts';
export type { CapabilityResolution, ChannelName, ChannelRole, ChartKind, ChartType, ChartTypeSpec, Modifier } from './chart-types.ts';
export type { ChartOptions } from './backends/highcharts.ts';
