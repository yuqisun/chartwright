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
import type { ChannelName, ChannelRole, ChartType } from './chart-types.ts';
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

/** A single value or a [low, high] pair for range types. */
export type SeriesValue = number | [number, number] | null;
export type SeriesValues = { name: string; values: SeriesValue[] };
export type Slice = { key: string; name: string; value: number };

type Base = {
  chartType: SupportedChartType;
  title?: string;
  /** The complete table that was plotted. */
  dataset: Row[];
  xField: string;
  yField: string;
  seriesField?: string;
  /**
   * Chart-level properties, carried through from the spec untouched.
   *
   * The model layer does not interpret them: whether they make sense is decided where the spec
   * is validated (against what the type declares it can mean) and what they look like is
   * decided in the backend. Here they are only facts about the chart.
   */
  stacking?: 'normal' | 'percent';
  polar?: boolean;
  hole?: number;
  compact?: boolean;
  /** A fixed y range, when the measure's scale is a fact about the measure. */
  yRange?: { min?: number; max?: number };
  /** The secondary measure field, when two measures share one chart (§3.4). */
  y2Field?: string;
  /** How the secondary measure is drawn. Defaults to 'line' in the backend. */
  type2?: string;
  /** A fixed range for the secondary axis. */
  y2Range?: { min?: number; max?: number };
  /** Range types: the low and high field names. When present, series values are [low, high] pairs. */
  lowField?: string;
  highField?: string;
};

export type CategoricalModel = Base & {
  kind: 'categorical';
  orientation: 'vertical' | 'horizontal';
  categories: string[];
  series: SeriesValues[];
  /** When y2 is present, the index at which y2 series begin. All before are y. */
  y2SeriesFrom?: number;
};

export type PartToWholeModel = Base & {
  kind: 'part-to-whole';
  slices: Slice[];
};

/**
 * A two-dimensional table of cells: categories along x, the series as rows, the measure as colour.
 *
 * It shares the categorical model's shape because it shares its meaning — a cell is one (column,
 * row) pair, which is what a category and a series already are. What differs is only what the
 * backend draws: lengths become a colour scale.
 */
export type MatrixModel = Base & {
  kind: 'matrix';
  categories: string[];
  series: SeriesValues[];
};

export type PointCloudModel = Base & {
  kind: 'point-cloud';
  /**
   * Each point is [x, y] or [x, y, size] in table order.
   *
   * A `null` is a gap in a measure — the same rule as everywhere else, and what the backend
   * leaves Highcharts to draw as a missing point rather than a point at zero.
   */
  points: Array<{ values: Array<number | null>; seriesName?: string }>;
  /** The field names in order: [xField, yField, sizeField?]. */
  valueFields: string[];
};

/**
 * Deliberately four shapes, not three.
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
export type ChartModel = CategoricalModel | PartToWholeModel | MatrixModel | PointCloudModel;

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

/**
 * A blank measure value: absent, null, or an empty string. A gap, never a zero.
 *
 * Deliberately not `Number`-based: `Number(null)` is `0`, which turned every missing measure
 * into a real data point claiming the value zero. That is the whole reason this is written out.
 */
function isBlankValue(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/** Trims a value to something short enough to quote inside an error message. */
function quoted(value: unknown): string {
  const text = String(value);
  return JSON.stringify(text.length > 40 ? `${text.slice(0, 37)}...` : text);
}

/**
 * Reads one measure cell, and refuses what cannot be read.
 *
 * The rule is deliberately narrow. A blank is a gap, because "no data for this category" is a
 * real thing a chart should show as a gap (`nulls-and-zeros` in the corpus exists to pin that a
 * null and a zero must not draw the same). Text that is not a number is **refused**, because
 * the alternative is what this function replaced: `Number('Northgate Capital Markets')` is
 * `NaN`, `NaN` serialises to `null`, and Highcharts then drew axes, a title and *no marks at
 * all* — a wrong chart wearing a right chart's clothes, with `warnings: []` to confirm it.
 *
 * A `Date` is refused by the same reasoning, and it is the one case `Number.isFinite` cannot see:
 * `Number(date)` is the epoch in milliseconds, so a date column on a measure channel compiled to
 * a chart of `1767225600000` against an epoch axis, silently. A date-like *string* was already
 * caught, because `Number('2026-01-01')` is `NaN`; the object walked through the same gap.
 *
 * `Number()` is still how a value is read, so a measure that arrives as a numeric string — JSON
 * from a database, a `count` rendered as text — keeps working. `partial` says whether some
 * *other* row of the same column was readable, which is what tells a column-that-is-not-a-measure
 * apart from one unreadable sentinel in an otherwise numeric column. The second is refused
 * rather than drawn as a hole, because a hole nobody asked for is invented data.
 */
function readMeasureValue(
  row: Row,
  field: string,
  channel: ChannelName,
  partial: boolean,
): number | null {
  const raw = row[field];
  if (isBlankValue(raw)) return null;

  if (raw instanceof Date) {
    throw new Error(
      `encoding field '${field}' (encodings.${channel}) is a Date, which has no numeric value to draw: got ` +
        `${quoted(raw.toISOString())}. A date is a category — put it in encodings.x, where a date column is read ` +
        'as categories.',
    );
  }

  const value = Number(raw);
  if (Number.isFinite(value)) return value;

  const why = partial
    ? 'is not numeric'
    : 'is not a numeric measure — a number, or a string holding one';
  throw new Error(
    `encoding field '${field}' (encodings.${channel}) ${why}: got ${quoted(raw)}. ` +
      `encodings.${channel} is a measure channel and needs numbers; a column of labels belongs in ` +
      'a category channel such as encodings.x, which chart.orientation does not move.',
  );
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
  encodings: { x: string; series?: string; y?: string; y2?: string },
): CategoryCollision | undefined {
  const { x, series, y, y2 } = encodings;

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
        const skip = new Set([x, series, y, y2].filter((field): field is string => field !== undefined));
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
  const { x, y, y2, low, high, series } = spec.encodings;

  // Range types use low/high instead of y. They are still categorical (band x axis)
  // but their data shape is [index, low, high] rather than single values.
  const isRange = low !== undefined && high !== undefined;
  if (!x || (!y && !isRange)) throw new Error('encodings.x and encodings.y (or low+high) are required');

  const seriesField = series?.field;
  const y2Field = y2?.field;
  const sizeField = spec.encodings.size?.field;
  const lowField = low?.field;
  const highField = high?.field;
  // Which channel each field came from, so a refusal can name the channel the model wrote
  // rather than the field alone — the repair for a reversed encoding is a channel swap.
  const channelOf: Array<{ channel: ChannelName; field: string }> = (
    [
      ['x', x.field],
      ['y', y?.field],
      ['y2', y2Field],
      ['series', seriesField],
      ['size', sizeField],
      ['low', lowField],
      ['high', highField],
    ] as Array<[ChannelName, string | undefined]>
  )
    .filter((entry): entry is [ChannelName, string] => typeof entry[1] === 'string')
    .map(([channel, field]) => ({ channel, field }));
  if (dataset.length > 0) {
    const columns = Object.keys(dataset[0] as Row);
    for (const { field } of channelOf) {
      if (!columns.includes(field)) {
        throw new Error(`encoding field '${field}' is not in the produced table (available: ${columns.join(', ')})`);
      }
    }
  }

  // The channel-role contract, checked here rather than trusted: a channel the declaration
  // calls a measure must hold numbers. Prose in the prompt asks for this; only the compiler
  // can refuse it. A point cloud is the one kind whose *category* channel is also a measure —
  // both its axes are linear — so its `x` is checked too, while `series` stays a label channel
  // there as everywhere else. Reading the roles is what keeps that from being a guess.
  const roles: Partial<Record<ChannelName, ChannelRole>> = CHART_TYPES[type].channels;
  const measureChannels = channelOf.filter(({ channel }) =>
    kind === 'point-cloud' ? channel !== 'series' : roles[channel] === 'measure',
  );
  for (const { channel, field } of measureChannels) {
    // `partial` is what separates "this column is not a measure at all" from "one unreadable
    // sentinel sits in an otherwise numeric column". Both are refused; the messages differ,
    // because the repairs differ.
    const nonBlank = dataset.map((row) => row[field]).filter((value) => !isBlankValue(value));
    const readable = nonBlank.filter((value) => Number.isFinite(Number(value))).length;
    const partial = readable > 0 && readable < nonBlank.length;
    // Reading each row is what refuses an unreadable value, so the loop *is* the check.
    for (const row of dataset) readMeasureValue(row, field, channel, partial);
  }

  const base = {
    chartType: type,
    ...(spec.chart.title ? { title: spec.chart.title } : {}),
    dataset,
    xField: x.field,
    yField: y?.field ?? lowField ?? '',
    ...(seriesField ? { seriesField } : {}),
    ...(spec.chart.stacking ? { stacking: spec.chart.stacking } : {}),
    ...(spec.chart.polar !== undefined ? { polar: spec.chart.polar } : {}),
    ...(spec.chart.hole !== undefined ? { hole: spec.chart.hole } : {}),
    ...(spec.chart.compact !== undefined ? { compact: spec.chart.compact } : {}),
    ...(spec.axes?.y ? { yRange: spec.axes.y } : {}),
    ...(y2Field ? { y2Field } : {}),
    ...(spec.chart.type2 ? { type2: spec.chart.type2 } : {}),
    ...(spec.axes?.y2 ? { y2Range: spec.axes.y2 } : {}),
    ...(lowField ? { lowField } : {}),
    ...(highField ? { highField } : {}),
  };

  if (kind === 'part-to-whole') {
    return {
      model: {
        ...base,
        kind: 'part-to-whole',
        slices: dataset.map((row) => {
          const value = readMeasureValue(row, y!.field, 'y', false);
          // A slice is a share of a whole, so a gap cannot be one: a pie has no way to show a
          // missing part, and dropping the slice would quietly answer a different question.
          // Refused rather than drawn, in the same spirit as the collision rule above.
          if (value === null) {
            throw new Error(
              `the measure '${y!.field}' is empty for category '${String(row[x.field])}'. A pie needs a value for ` +
                'every slice: fill the gap, filter that row out, or chart a type that can show a gap.',
            );
          }
          return {
            key: datumKey(String(row[x.field])),
            name: String(row[x.field]),
            value,
          };
        }),
      },
      warnings: [],
    };
  }

  if (kind === 'point-cloud') {
    // Each measure channel with the name the model wrote it under, so a refusal quotes the
    // channel it can go and change rather than the field alone.
    const pcChannelFields: Array<{ channel: ChannelName; field: string }> = [
      { channel: 'x', field: x.field },
      { channel: 'y', field: y!.field },
      ...(sizeField ? [{ channel: 'size' as const, field: sizeField }] : []),
    ];
    const pcValueFields = pcChannelFields.map((entry) => entry.field);
    // Points are emitted in table order. The positional index is the datum key
    // for point-cloud types (§2.1): two points can share an x value, so the
    // category-value key would conflate them.
    const points = dataset.map((row) => {
      const values = pcChannelFields.map(({ channel, field }) => readMeasureValue(row, field, channel, false));
      // A gap is a missing coordinate here, not a missing length — and a point cloud has no way
      // to draw one. Highcharts skips the datum, so on a scatter the reader silently loses a
      // point, and a null `z` on a bubble drops **every** mark in the series: measured, `0 of 3`
      // marks drawn, with `warnings: []`. That is the same silence as the pie's empty slice and
      // is refused the same way. A categorical series still shows a gap, because there the reader
      // sees a hole in a row rather than a point that was never there.
      const missing = values.indexOf(null);
      if (missing !== -1) {
        const { channel, field } = pcChannelFields[missing] as { channel: ChannelName; field: string };
        throw new Error(
          `encodings.${channel} names '${field}', which is empty for a row of this table. A ${type} draws one mark ` +
            'per row and needs every coordinate: fill the gap, filter those rows out in run_query, or chart a type ' +
            'that can show a gap.',
        );
      }
      return {
        values,
        ...(seriesField ? { seriesName: String(row[seriesField]) } : {}),
      };
    });
    return {
      model: { ...base, kind: 'point-cloud' as const, points, valueFields: pcValueFields },
      warnings: [],
    };
  }

  // Range types use low/high instead of y. They are still categorical (band x axis)
  // but their data shape is [index, low, high] rather than single values.
  if (isRange && kind === 'categorical') {
    const categories = distinctInOrder(dataset.map((row) => row[x.field]));

    // Collision check uses low field as the distinguishing measure
    const collision = findCategoryCollision(dataset, { x: x.field, series: seriesField, y: lowField });
    if (collision) {
      throw new Error(
        `the table has more than one row for category '${collision.category}'` +
          `${collision.series !== undefined ? ` in series '${collision.series}'` : ''}. Add an aggregate step ` +
          `(group_by '${x.field}') in run_query before charting.`,
      );
    }

    // Build series with [low, high] paired values
    const groups = new Map<string, Row[]>();
    if (seriesField) {
      for (const row of dataset) {
        const key = String(row[seriesField]);
        const bucket = groups.get(key);
        if (bucket) bucket.push(row);
        else groups.set(key, [row]);
      }
    } else {
      groups.set(lowField!, dataset);
    }

    const seriesValues: SeriesValues[] = [];
    for (const [name, groupRows] of groups) {
      const valueMap = new Map<string, [number, number] | null>();
      for (const row of groupRows) {
        // A blank in either bound means the range is unknown — store null rather than [0, 0].
        // Reading through the helper keeps that true now that a blank is a gap again.
        const lowValue = readMeasureValue(row, lowField!, 'low', false);
        const highValue = readMeasureValue(row, highField!, 'high', false);
        const pair: [number, number] | null =
          lowValue === null || highValue === null ? null : [lowValue, highValue];
        valueMap.set(String(row[x.field]), pair);
      }
      // Store [low, high] pairs. The backend detects range types via lowField/highField
      // and emits [categoryIndex, low, high] format. SeriesValue accepts both single
      // numbers and [low, high] pairs, so no cast is needed.
      const values = categories.map((cat) => {
        const pair = valueMap.get(cat);
        return pair !== undefined ? pair : null;
      });
      seriesValues.push({ name, values });
    }

    return {
      model: {
        ...base,
        kind: 'categorical' as const,
        orientation: spec.chart.orientation === 'horizontal' ? 'horizontal' as const : 'vertical' as const,
        categories,
        series: seriesValues,
        lowField,
        highField,
      },
      warnings: [],
    };
  }

  const categories = distinctInOrder(dataset.map((row) => row[x.field]));

  // Two rows in one category cannot both be drawn on a categorical axis. Picking one
  // (or summing them) would silently change the numbers, so say what is wrong and let
  // the model aggregate in run_query instead.
  const collision = findCategoryCollision(dataset, { x: x.field, series: seriesField, y: y!.field, y2: y2Field });
  if (collision) {
    throw new Error(
      `the table has more than one row for category '${collision.category}'` +
        `${collision.series !== undefined ? ` in series '${collision.series}'` : ''}. Add an aggregate step ` +
        `(group_by '${x.field}') in run_query before charting.`,
    );
  }

  // When y2 is present, each measure produces its own set of series, named after the
  // measure field (§3.4 rule 1). With a series encoding too, each measure splits by
  // group, giving 2N series named "{measure}: {group}" so datum keys stay unique.
  const seriesValues: SeriesValues[] = [];
  let y2SeriesFrom: number | undefined;
  const measures: Array<{ field: string; label: string; channel: ChannelName }> = y2Field
    ? [
        { field: y!.field, label: seriesField ? y!.field : y!.field, channel: 'y' },
        { field: y2Field, label: seriesField ? y2Field : y2Field, channel: 'y2' },
      ]
    : [{ field: y!.field, label: seriesField ?? y!.field, channel: 'y' }];

  for (let mi = 0; mi < measures.length; mi += 1) {
    const measure = measures[mi];
    if (mi === 1) y2SeriesFrom = seriesValues.length;
    const groups = new Map<string, Row[]>();
    if (seriesField) {
      for (const row of dataset) {
        const key = String(row[seriesField]);
        const bucket = groups.get(key);
        if (bucket) bucket.push(row);
        else groups.set(key, [row]);
      }
    } else {
      groups.set(measure.label, dataset);
    }

    for (const [groupName, groupRows] of groups) {
      // `number | null` rather than `number`: a blank measure is a gap, and folding it into the
      // map as anything else is what made a null and a zero draw identically.
      const values = new Map<string, number | null>();
      for (const row of groupRows) {
        values.set(String(row[x.field]), readMeasureValue(row, measure.field, measure.channel, false));
      }
      const name = y2Field && seriesField ? `${measure.label}: ${groupName}` : groupName;
      seriesValues.push({
        name,
        values: categories.map((category) => {
          const value = values.get(category);
          return value === undefined ? null : value;
        }),
      });
    }
  }

  // A matrix is the same table read as cells rather than as bars: the categories are the columns,
  // the series are the rows, and the measure becomes colour. So it is the same computation as a
  // categorical chart — which is the whole reason a heatmap needed no new channel, only a type
  // that says what the three channels mean here.
  const shared = { categories, series: seriesValues };
  if (kind === 'matrix') {
    return { model: { ...base, kind: 'matrix', ...shared }, warnings: [] };
  }

  return {
    model: {
      ...base,
      kind: 'categorical',
      orientation: spec.chart.orientation === 'horizontal' ? 'horizontal' : 'vertical',
      ...shared,
      ...(y2SeriesFrom !== undefined ? { y2SeriesFrom } : {}),
    },
    warnings: [],
  };
}

/**
 * The datum key of the i-th mark of a series, in the model's own terms.
 *
 * Takes the fields it needs rather than a whole `CategoricalModel`, because a matrix has the
 * same pair (a column and a row) and the same identity question.
 *
 * When y2 is present, the series name is the measure field and must be part of the key
 * even without an explicit series encoding — otherwise both measures share a key and
 * emphasis on one would style the other (§3.4 rule 1).
 */
export function keyForCategory(
  model: { categories: string[]; seriesField?: string; y2Field?: string },
  categoryIndex: number,
  seriesName: string,
): string {
  const category = model.categories[categoryIndex] as string;
  const includeSeries = model.seriesField !== undefined || model.y2Field !== undefined;
  return datumKey(category, includeSeries ? seriesName : undefined);
}
