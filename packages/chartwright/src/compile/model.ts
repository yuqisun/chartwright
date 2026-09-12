/**
 * The neutral chart model: what the chart *is*, with no library words in it.
 *
 * Everything library-specific — that Highcharts calls vertical bars `column`,
 * that its horizontal bars run bottom-up, what a pie's data looks like — lives
 * in `backends/`. This file only knows about categories, series, points and
 * slices, which is what makes a second backend (or a whole different pipeline)
 * a substitution rather than a rewrite.
 */
import { validateChartPlan } from '../plans.ts';
import { applyTransform } from '../transform.ts';
import { CHART_TYPES, CHART_TYPE_NAMES, isChartType } from './chart-types.ts';
import type { ChartType } from './chart-types.ts';
import type { ChartSpec, Row } from '../types.ts';

/**
 * The supported set, derived from the declaration (`./chart-types.ts`).
 *
 * Kept as a named export because it is public API — `src/index.ts` re-exports it, and
 * a caller asking "can this library draw a sankey" should not have to import a table
 * to find out. The type is the declaration's key union, so it stays in step.
 */
export const SUPPORTED_CHART_TYPES: readonly SupportedChartType[] = CHART_TYPE_NAMES;
export type SupportedChartType = ChartType;

export function isSupportedChartType(type: string): type is SupportedChartType {
  return isChartType(type);
}

export type SeriesValues = { name: string; values: (number | null)[] };
export type Slice = { key: string; name: string; value: number };

type Base = {
  chartType: SupportedChartType;
  title?: string;
  /** The complete table that was plotted. */
  dataset: Row[];
  xField: string;
  yField: string;
  seriesField?: string;
};

export type CategoricalModel = Base & {
  kind: 'categorical';
  orientation: 'vertical' | 'horizontal';
  categories: string[];
  series: SeriesValues[];
};

export type PartToWholeModel = Base & {
  kind: 'part-to-whole';
  slices: Slice[];
};

/**
 * Deliberately two shapes, not three.
 *
 * There was a third, `TemporalModel`: a `datetime` axis with points sorted by time,
 * chosen by `encodings.x.value_type === 'temporal'`. Nothing in the library ever set
 * that field — only two tests did — so the branch was unreachable, and every chart
 * including a monthly series went through the categorical path. Rather than wire it
 * (which would have changed the axis of every date chart and put the compiler's time
 * ordering in tension with present mode's "the order you pass is the order shown"), it
 * was deleted; a date column is a category, and `docs/roadmap.md` records what that
 * costs: a series with a gap is drawn as though the gap were not there.
 */
export type ChartModel = CategoricalModel | PartToWholeModel;

/**
 * Identifies a datum: its category value, plus the series it belongs to when the
 * chart splits by series.
 *
 * Deliberately keyed by **value**, not by position. Category order can differ
 * between the table and the rendered chart (Highcharts reverses horizontal bars),
 * so anything positional would style the wrong bar.
 */
export function datumKey(category: string, seriesName?: string): string {
  return seriesName === undefined ? category : `${category}\u0000${seriesName}`;
}

/** The default key of a row in the materialised table. */
export function rowDatumKey(row: Row, xField: string, seriesField?: string): string {
  return datumKey(String(row[xField]), seriesField === undefined ? undefined : String(row[seriesField]));
}

/** Executes the spec's plan over the full rows. Replayable without any model. */
export function materialize(spec: ChartSpec, rows: Row[]): Row[] {
  const steps = spec.transform_plan?.steps ?? [];
  // Validated here as well as in the query tool, so a spec from any source is
  // held to the same standard rather than only the ones a model produced.
  validateChartPlan(steps);
  return applyTransform(rows, steps);
}

function distinctInOrder(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = String(value);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/** Two rows competing for one category on a categorical axis. */
export type CategoryCollision = {
  /** The category value those rows share. */
  category: string;
  /** The series the collision happened in, when the spec splits the data into series. */
  series?: string;
  /** The x column. */
  x: string;
  /** Columns whose values differ between the colliding rows: they can tell them apart. */
  distinguishing: string[];
};

/**
 * Finds the first two rows that would land on the same category, if there are any.
 *
 * Returned as data rather than thrown, because the rule needs two different messages:
 * the compiler tells a caller to aggregate, and a run that has no aggregation to offer
 * has to say something else. Detection is shared so the rule itself cannot drift.
 *
 * The order is the one the compiler used before this was extracted — the first group,
 * then the first repeat in row order — so the message a caller sees is unchanged.
 */
export function findCategoryCollision(
  dataset: Row[],
  encodings: { x: string; series?: string; y?: string },
): CategoryCollision | undefined {
  const { x, series, y } = encodings;

  const groups = new Map<string, Row[]>();
  if (series !== undefined) {
    for (const row of dataset) {
      const key = String(row[series]);
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }
  } else {
    groups.set('', dataset);
  }

  for (const [name, groupRows] of groups) {
    const seen = new Map<string, Row>();
    for (const row of groupRows) {
      const category = String(row[x]);
      const previous = seen.get(category);
      if (previous) {
        const skip = new Set([x, series, y].filter((field): field is string => field !== undefined));
        return {
          category,
          ...(series !== undefined ? { series: name } : {}),
          x,
          distinguishing: Object.keys(row).filter(
            (field) => !skip.has(field) && String(previous[field]) !== String(row[field]),
          ),
        };
      }
      seen.set(category, row);
    }
  }

  return undefined;
}

export type BuildResult = {
  model: ChartModel;
  warnings: string[];
};

/**
 * Builds the neutral model, binding the data.
 *
 * Throws rather than guessing: an unsupported chart type, an encoding that names
 * a column the plan did not produce, or two rows competing for one category are
 * all errors the caller (or the model, through the tool result) can act on.
 *
 * That last parenthesis became true later than the sentence was written: the model
 * only sees these through a tool result now that a submission is checked against the
 * compiler while it is still in the loop (`src/submit.ts`). Before that, every one of
 * them surfaced after the loop had ended, to the caller.
 */
export function buildChartModel(spec: ChartSpec, rows: Row[]): BuildResult {
  const type = spec.chart.type;
  if (!isSupportedChartType(type)) {
    throw new Error(
      `chart type '${type}' is not supported by the built-in compiler yet. Supported: ${SUPPORTED_CHART_TYPES.join(', ')}`,
    );
  }
  // Which shape this type is built as comes from the declaration, not from its name:
  // a second part-to-whole type would otherwise take the categorical path silently.
  const { kind } = CHART_TYPES[type];

  const dataset = materialize(spec, rows);
  const { x, y, series } = spec.encodings;
  if (!x || !y) throw new Error('encodings.x and encodings.y are required');

  const seriesField = series?.field;
  if (dataset.length > 0) {
    const columns = Object.keys(dataset[0] as Row);
    for (const field of [x.field, y.field, seriesField].filter((f): f is string => typeof f === 'string')) {
      if (!columns.includes(field)) {
        throw new Error(`encoding field '${field}' is not in the produced table (available: ${columns.join(', ')})`);
      }
    }
  }

  const base = {
    chartType: type,
    ...(spec.chart.title ? { title: spec.chart.title } : {}),
    dataset,
    xField: x.field,
    yField: y.field,
    ...(seriesField ? { seriesField } : {}),
  };

  if (kind === 'part-to-whole') {
    return {
      model: {
        ...base,
        kind: 'part-to-whole',
        slices: dataset.map((row) => ({
          key: datumKey(String(row[x.field])),
          name: String(row[x.field]),
          value: Number(row[y.field]),
        })),
      },
      warnings: [],
    };
  }

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

  const categories = distinctInOrder(dataset.map((row) => row[x.field]));

  // Two rows in one category cannot both be drawn on a categorical axis. Picking one
  // (or summing them) would silently change the numbers, so say what is wrong and let
  // the model aggregate in run_query instead.
  const collision = findCategoryCollision(dataset, { x: x.field, series: seriesField, y: y.field });
  if (collision) {
    throw new Error(
      `the table has more than one row for category '${collision.category}'` +
        `${collision.series !== undefined ? ` in series '${collision.series}'` : ''}. Add an aggregate step ` +
        `(group_by '${x.field}') in run_query before charting.`,
    );
  }

  const seriesValues: SeriesValues[] = [];
  for (const [name, groupRows] of groups) {
    const values = new Map<string, number>();
    for (const row of groupRows) {
      values.set(String(row[x.field]), Number(row[y.field]));
    }
    seriesValues.push({ name, values: categories.map((category) => values.get(category) ?? null) });
  }

  return {
    model: {
      ...base,
      kind: 'categorical',
      orientation: spec.chart.orientation === 'horizontal' ? 'horizontal' : 'vertical',
      categories,
      series: seriesValues,
    },
    warnings: [],
  };
}

/** The datum key of the i-th mark of a series, in the model's own terms. */
export function keyForCategory(model: CategoricalModel, categoryIndex: number, seriesName: string): string {
  const category = model.categories[categoryIndex] as string;
  return datumKey(category, model.seriesField === undefined ? undefined : seriesName);
}
