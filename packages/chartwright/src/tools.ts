/**
 * Data-inspection tools.
 *
 * These run **in the caller's process**, over the caller's in-memory rows. Their
 * results are the only thing about the data that ever reaches the model.
 *
 * Two rules shape this file:
 *
 *   1. **The model gets a summary; the chart gets the table.** `run_query`
 *      executes over every row and returns the *complete* table to the caller
 *      (for binding into the chart) while returning only a small preview to the
 *      model. Keeping those two views separate is the central design decision —
 *      borrow the distinction from deepseek-harness (`dsh-output-retention`:
 *      "`truncated` is a budget fact, never 'incomplete'").
 *   2. **The tool set is closed and small.** A model that can call twenty
 *      arbitrary functions is harder to reason about than one with four verbs.
 */
import { applyTransform, binDate } from './transform.ts';
import type { Column, ColumnType, Row, ToolDef, TransformStep } from './types.ts';

const DATE_LIKE = /^\d{4}-\d{2}(-\d{2})?([T ].*)?$/;

export function inferColumns(rows: Row[]): Column[] {
  const sample = rows[0];
  if (!sample) return [];
  return Object.keys(sample).map((name) => {
    const firstPresent = rows.find((r) => r[name] !== null && r[name] !== undefined);
    const value = firstPresent?.[name];
    let type: ColumnType = 'string';
    if (typeof value === 'number') type = 'number';
    else if (typeof value === 'boolean') type = 'boolean';
    else if (value instanceof Date || (typeof value === 'string' && DATE_LIKE.test(value))) type = 'date';
    return { name, type };
  });
}

/**
 * Percentile with linear interpolation, `p` in [0, 1].
 *
 * Interpolating rather than taking the nearest rank means `p50` really is the
 * median (for an even count it averages the two middle values), which is what a
 * reader — model or human — expects from a column labelled "median".
 */
function percentile(sorted: number[], p: number): number {
  const rank = p * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const lowValue = sorted[low] ?? 0;
  const highValue = sorted[high] ?? lowValue;
  return lowValue + (highValue - lowValue) * (rank - low);
}

export type ColumnProfile = {
  name: string;
  type: ColumnType;
  /** Share of values that are null/undefined/empty, rounded to 3 decimals. */
  nullRate: number;
  distinctCount: number;
  /** A few real values, for spelling and filter values. See `ProfileOptions`. */
  sampleValues?: unknown[];
  min?: number | string;
  max?: number | string;
  p50?: number;
  /** Present for date columns. */
  timeSpan?: { min: string; max: string; distinctMonths: number; looksMonthly: boolean };
};

export type TableProfile = {
  rowCount: number;
  columns: ColumnProfile[];
};

export type ProfileOptions = {
  /**
   * How many sample values to include per column, and the cardinality below
   * which they are included at all.
   *
   * Values (not just shapes) reaching the model is the one place this design
   * trades a little privacy for a lot of accuracy — without them the model
   * cannot write `filter region eq 'East'` and will guess the spelling. Set
   * `sampleValues: 0` to send none.
   */
  sampleValues?: number;
  sampleValuesMaxCardinality?: number;
};

const DEFAULT_PROFILE: Required<ProfileOptions> = { sampleValues: 5, sampleValuesMaxCardinality: 20 };

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/** Deterministic profile of the whole table: the model's view of "what is in here". */
export function describeTable(rows: Row[], options: ProfileOptions = {}): TableProfile {
  const { sampleValues, sampleValuesMaxCardinality } = { ...DEFAULT_PROFILE, ...options };
  const declared = inferColumns(rows);

  const columns = declared.map((column): ColumnProfile => {
    const values = rows.map((r) => r[column.name]);
    const present = values.filter((v) => !isBlank(v));
    // Keyed by string so 2 and '2' collide (they are the same category), but the
    // sample values keep their original type: a numeric column must not hand the
    // model "2" as a string, or it will write `eq: "2"` and match nothing.
    const distinctByKey = new Map<string, unknown>();
    for (const v of present) if (!distinctByKey.has(String(v))) distinctByKey.set(String(v), v);

    const profile: ColumnProfile = {
      name: column.name,
      type: column.type,
      nullRate: values.length === 0 ? 0 : Number(((values.length - present.length) / values.length).toFixed(3)),
      distinctCount: distinctByKey.size,
    };

    if (sampleValues > 0 && distinctByKey.size > 0 && distinctByKey.size <= sampleValuesMaxCardinality) {
      profile.sampleValues = [...distinctByKey.values()].slice(0, sampleValues);
    }

    if (column.type === 'number') {
      const numbers = present.map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
      if (numbers.length > 0) {
        profile.min = numbers[0];
        profile.max = numbers[numbers.length - 1];
        profile.p50 = percentile(numbers, 0.5);
      }
    } else if (column.type === 'date') {
      const days = present.map(String).sort();
      const distinctMonths = new Set(present.map((v) => binDate(v, 'month')).filter(Boolean)).size;
      if (days.length > 0) {
        profile.min = days[0];
        profile.max = days[days.length - 1];
        // "Looks monthly" = every value sits on the first day of its month,
        // which is a cheap, honest signal about the data's granularity.
        profile.timeSpan = {
          min: days[0] as string,
          max: days[days.length - 1] as string,
          distinctMonths,
          looksMonthly: present.every((v) => String(v).slice(8, 10) === '01' || String(v).length === 7),
        };
      }
    } else if (present.length > 0) {
      const strings = present.map(String).sort();
      profile.min = strings[0];
      profile.max = strings[strings.length - 1];
    }

    return profile;
  });

  return { rowCount: rows.length, columns };
}

export type QuerySummary = {
  /** Rows in the COMPLETE result — not the size of the preview. */
  rowCount: number;
  columns: string[];
  /** First few rows, so the model can see the value shapes. */
  previewRows: Row[];
  /** True when `previewRows` is shorter than `rowCount`. */
  truncated: boolean;
};

export type QueryResult = {
  /** The complete table. Stays in the caller's process; bound into the chart. */
  table: Row[];
  /** The small view handed to the model. */
  summary: QuerySummary;
};

export type QueryOptions = {
  /** Rows included in the model-facing preview. */
  previewRowCount?: number;
};

/** Executes a transform plan over every row and splits the result into two views. */
export function runQuery(rows: Row[], steps: TransformStep[], options: QueryOptions = {}): QueryResult {
  const previewRowCount = options.previewRowCount ?? 3;
  const table = applyTransform(rows, steps);
  return {
    table,
    summary: {
      rowCount: table.length,
      columns: table[0] ? Object.keys(table[0]) : [],
      previewRows: table.slice(0, previewRowCount),
      truncated: table.length > previewRowCount,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions: what the model is allowed to call
// ─────────────────────────────────────────────────────────────────────────────

const STEP_SCHEMA = {
  type: 'object',
  required: ['op'],
  properties: {
    op: { type: 'string', enum: ['filter', 'aggregate', 'sort', 'limit', 'derive', 'binTime'] },
    field: { type: 'string' },
    operator: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'contains'] },
    value: {},
    values: { type: 'array' },
    group_by: { type: 'array', items: { type: 'string' } },
    measures: {
      type: 'array',
      items: {
        type: 'object',
        required: ['agg', 'as'],
        properties: {
          field: { type: 'string' },
          agg: { type: 'string', enum: ['sum', 'avg', 'count', 'countDistinct', 'min', 'max'] },
          as: { type: 'string' },
        },
      },
    },
    by: { type: 'string' },
    order: { type: 'string', enum: ['asc', 'desc'] },
    n: { type: 'integer' },
    as: { type: 'string' },
    granularity: { type: 'string', enum: ['month', 'quarter', 'year'] },
  },
  additionalProperties: false,
};

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'describe_table',
    description:
      'Profile the dataset before deciding anything: row count, and per column its type, null rate, ' +
      'distinct-value count, numeric range/median, and time span. Returns aggregates only — never rows. ' +
      'Call this first.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run_query',
    description:
      'Run a declarative transformation over the FULL dataset. The complete result becomes the chart dataset ' +
      'and is NOT sent to you; you receive only a summary (row count, columns, and a few preview rows). ' +
      'The steps you pass here are adopted as the chart spec transform_plan, so do not write a plan yourself. ' +
      'Steps: filter | aggregate | sort | limit | derive | binTime. aggregate replaces the table with ' +
      'group_by columns plus each measure\'s "as" column.',
    parameters: {
      type: 'object',
      required: ['steps'],
      properties: { steps: { type: 'array', maxItems: 20, items: STEP_SCHEMA } },
      additionalProperties: false,
    },
  },
  {
    name: 'submit_spec',
    description:
      'Finish: submit the chart spec. Call this exactly ONCE, after run_query has produced the table you want ' +
      'to chart. Do NOT include a transform_plan — the steps from your last successful run_query are adopted ' +
      'automatically. chart.type is a neutral name (bar | line | pie); encodings.x is the category or date ' +
      'column, encodings.y the measure column, and the optional encodings.series splits the data into series.',
    parameters: {
      type: 'object',
      required: ['chart', 'encodings'],
      properties: {
        chart: {
          type: 'object',
          required: ['type'],
          properties: {
            type: { type: 'string', enum: ['bar', 'line', 'pie'] },
            title: { type: 'string' },
          },
          additionalProperties: false,
        },
        encodings: {
          type: 'object',
          required: ['x', 'y'],
          properties: {
            x: { type: 'object', required: ['field'], properties: { field: { type: 'string' } } },
            y: { type: 'object', required: ['field'], properties: { field: { type: 'string' } } },
            series: { type: 'object', required: ['field'], properties: { field: { type: 'string' } } },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
];

export type ToolContext = {
  rows: Row[];
  profile?: ProfileOptions;
  query?: QueryOptions;
};

export type ToolHandler = (args: unknown) => unknown;

/** Maps tool names to implementations bound to one dataset. */
export function createToolHandlers(ctx: ToolContext): Record<string, ToolHandler> {
  return {
    describe_table: (args) => describeTable(ctx.rows, { ...ctx.profile, ...(args as ProfileOptions | undefined) }),
    run_query: (args) => {
      const steps = (args as { steps?: TransformStep[] }).steps;
      if (!Array.isArray(steps)) throw new Error('run_query needs a "steps" array');
      const { table, summary } = runQuery(ctx.rows, steps, ctx.query);
      // Only the summary is returned to the model; `table` is attached for the
      // loop to capture and bind into the chart.
      return { summary, table };
    },
  };
}
