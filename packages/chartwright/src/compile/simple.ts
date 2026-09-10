/**
 * Minimal Highcharts emitter.
 *
 * This is the deterministic half of the pipeline: spec + rows in, chart options
 * with the data bound, out. It has no LLM involvement and no dependency on
 * Highcharts itself — the library returns a plain object, and the caller hands
 * it to whichever version of the library it ships.
 *
 * Scope is deliberately small (bar / line / pie). Colour decisions, theming and
 * the remaining chart types are a separate, larger piece of work; the point here
 * is that the *contract* — data bound by the compiler, dataset returned
 * alongside — is already the real one.
 *
 * Borrowed concept: this mirrors the semantic-spec → library-options split from
 * flint-chart (MIT, Microsoft), which is where the "deterministic compiler"
 * framing in this project comes from. No flint code is used here yet.
 */
import { applyTransform } from '../transform.ts';
import type { ChartSpec, Row } from '../types.ts';

/** Plain options object; the caller renders it. Intentionally not typed against Highcharts. */
export type ChartOptions = Record<string, unknown>;

export type CompiledChart = {
  options: ChartOptions;
  /** The complete table that was plotted. */
  dataset: Row[];
};

export const SUPPORTED_CHART_TYPES = ['bar', 'line', 'pie'] as const;
export type SupportedChartType = (typeof SUPPORTED_CHART_TYPES)[number];

export function isSupportedChartType(type: string): type is SupportedChartType {
  return (SUPPORTED_CHART_TYPES as readonly string[]).includes(type);
}

/** Executes the spec's plan over the full rows. Replayable without any model. */
export function materialize(spec: ChartSpec, rows: Row[]): Row[] {
  return applyTransform(rows, spec.transform_plan?.steps ?? []);
}

function distinctInOrder(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = String(v);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

function baseOptions(title: string | undefined): ChartOptions {
  return {
    chart: { backgroundColor: 'transparent' },
    title: { text: title ?? '', style: { fontSize: '15px' } },
    credits: { enabled: false },
    legend: { enabled: false },
  };
}

/**
 * Compiles a spec into Highcharts options, binding the data.
 *
 * Throws on an unsupported chart type rather than emitting a half-built chart:
 * a wrong chart that renders is harder to notice than an error that says why.
 */
export function compileToHighcharts(spec: ChartSpec, rows: Row[]): CompiledChart {
  const type = spec.chart.type;
  if (!isSupportedChartType(type)) {
    throw new Error(
      `chart type '${type}' is not supported by the built-in compiler yet. Supported: ${SUPPORTED_CHART_TYPES.join(', ')}`,
    );
  }

  const dataset = materialize(spec, rows);
  const { x, y, series } = spec.encodings;
  if (!x || !y) throw new Error('encodings.x and encodings.y are required');
  if (dataset.length > 0) {
    const columns = Object.keys(dataset[0] as Row);
    for (const field of [x.field, y.field, series?.field].filter(Boolean) as string[]) {
      if (!columns.includes(field)) {
        throw new Error(`encoding field '${field}' is not in the produced table (available: ${columns.join(', ')})`);
      }
    }
  }

  const options = baseOptions(spec.chart.title);

  if (type === 'pie') {
    options.series = [
      {
        type: 'pie',
        name: y.field,
        data: dataset.map((r) => ({ name: String(r[x.field]), y: Number(r[y.field]) })),
      },
    ];
    return { options, dataset };
  }

  // bar / line
  const isTemporal = x.value_type === 'temporal';
  const seriesField = series?.field;
  const groups = new Map<string, Row[]>();
  if (seriesField) {
    for (const row of dataset) {
      const key = String(row[seriesField]);
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }
  } else {
    groups.set(y.field, dataset);
  }

  if (isTemporal) {
    options.xAxis = { type: 'datetime', title: { text: x.field } };
    options.series = [...groups.entries()].map(([name, groupRows]) => ({
      name,
      data: groupRows
        .map((r) => [Date.parse(String(r[x.field])), Number(r[y.field])] as [number, number])
        .sort((a, b) => a[0] - b[0]),
    }));
  } else {
    const categories = distinctInOrder(dataset.map((r) => r[x.field]));
    const byCategory = new Map<string, Map<string, number>>();
    for (const [name, groupRows] of groups) {
      const values = new Map<string, number>();
      for (const row of groupRows) {
        const category = String(row[x.field]);
        if (values.has(category)) {
          // Two rows in one category cannot both be drawn on a categorical axis.
          // Picking one (or summing them) would silently change the numbers, so
          // say what is wrong and let the model aggregate in run_query instead.
          throw new Error(
            `the table has more than one row for category '${category}'` +
              `${seriesField ? ` in series '${name}'` : ''}. Add an aggregate step ` +
              `(group_by '${x.field}') in run_query before charting.`,
          );
        }
        values.set(category, Number(row[y.field]));
      }
      byCategory.set(name, values);
    }
    options.xAxis = { categories, title: { text: x.field } };
    options.yAxis = { title: { text: y.field } };
    options.series = [...byCategory.entries()].map(([name, values]) => ({
      name,
      data: categories.map((c) => (values.has(c) ? values.get(c) : null)),
    }));
  }

  // Highcharts distinguishes 'column' (vertical) from 'bar' (horizontal). The
  // spec says which way the bars point; the compiler knows the library's words.
  const horizontal = spec.chart.orientation === 'horizontal';
  options.chart = { type: type === 'bar' ? (horizontal ? 'bar' : 'column') : type, backgroundColor: 'transparent' };
  options.legend = { enabled: groups.size > 1 };

  return { options, dataset };
}
