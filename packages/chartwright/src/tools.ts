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
import { validateChartPlan } from './plans.ts';
import type { Column, ColumnType, Row, ToolDef, ToolMode, TransformStep } from './types.ts';

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

/**
 * Deterministic profile of the whole table: the model's view of "what is in here".
 *
 * `declared` is the caller's own column list, when it supplied one. It wins over
 * inference, and it is a separate parameter rather than a field of `options` on
 * purpose: `options` is reachable from the model — a tool call's arguments are spread
 * over it — whereas a declared type is the caller's statement about its own data. The
 * two channels have to agree, or the model is told one thing in the prompt and the
 * opposite as soon as it asks.
 *
 * A declaration that contradicts the values costs the caller a thinner profile, never
 * a wrong one: declaring `number` over text yields no numeric range at all, because
 * no value survives `Number()`.
 */
export function describeTable(rows: Row[], options: ProfileOptions = {}, declared?: Column[]): TableProfile {
  const { sampleValues, sampleValuesMaxCardinality } = { ...DEFAULT_PROFILE, ...options };
  const declaredTypes = new Map((declared ?? []).map((column) => [column.name, column.type]));

  const columns = inferColumns(rows).map((column): ColumnProfile => {
    // Only ever a type the caller stated, and only for a column that is really there.
    const type = declaredTypes.get(column.name) ?? column.type;
    const values = rows.map((r) => r[column.name]);
    const present = values.filter((v) => !isBlank(v));
    // Keyed by string so 2 and '2' collide (they are the same category), but the
    // sample values keep their original type: a numeric column must not hand the
    // model "2" as a string, or it will write `eq: "2"` and match nothing.
    const distinctByKey = new Map<string, unknown>();
    for (const v of present) if (!distinctByKey.has(String(v))) distinctByKey.set(String(v), v);

    const profile: ColumnProfile = {
      name: column.name,
      type,
      nullRate: values.length === 0 ? 0 : Number(((values.length - present.length) / values.length).toFixed(3)),
      distinctCount: distinctByKey.size,
    };

    if (sampleValues > 0 && distinctByKey.size > 0 && distinctByKey.size <= sampleValuesMaxCardinality) {
      profile.sampleValues = [...distinctByKey.values()].slice(0, sampleValues);
    }

    if (type === 'number') {
      const numbers = present.map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
      if (numbers.length > 0) {
        profile.min = numbers[0];
        profile.max = numbers[numbers.length - 1];
        profile.p50 = percentile(numbers, 0.5);
      }
    } else if (type === 'date') {
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

/**
 * A bounded, read-only look at the table itself.
 *
 * `rowCount` is the size of the COMPLETE table, as in `QuerySummary`, so the model
 * knows how much it is not seeing. `rows` is always the *first* rows in the order
 * the caller gave them.
 */
export type RowPreview = {
  rowCount: number;
  rows: Row[];
  /** True when `rows` is shorter than `rowCount`. */
  truncated: boolean;
};

/**
 * How many rows the model gets, and the hard ceiling on asking for more.
 *
 * The default matches `run_query`'s preview, so the model sees the same amount of
 * the table in either mode. The ceiling is the tool's, not a preference: the model
 * cannot argue for more.
 *
 * Two things worth being explicit about, because the number is not the safety
 * property it looks like:
 *
 *   - It bounds a *count*, not a proportion. A present-mode table is usually a final
 *     result of a few rows, so for any table of `PREVIEW_MAX_ROWS` rows or fewer the
 *     model can see the whole thing. That is accepted rather than overlooked: the
 *     caller handed this table over to be drawn, and a proportion rule would refuse
 *     the preview precisely where it is most useful.
 *   - Because there is no offset, calling the tool again returns the same rows, so a
 *     run's total row exposure is capped by this number rather than by the number of
 *     calls. That is what makes a separate whole-run budget unnecessary here.
 */
const PREVIEW_DEFAULT_ROWS = 3;
const PREVIEW_MAX_ROWS = 20;

/**
 * The first few rows, verbatim.
 *
 * Deliberately the *first* rows and nothing else — there is no offset parameter
 * and no way to reach a different window, so calling this repeatedly cannot walk a
 * table. That is what keeps a row-level tool from becoming a row-*reading* tool,
 * which the design refuses (see `docs/roadmap.md`). It is also why an unrecognised
 * parameter is an error rather than something quietly ignored: a model that asked
 * for rows 10–14 and got rows 0–4 without being told would go on to reason about
 * data it never saw.
 */export function previewRows(rows: Row[], options: { limit?: number } = {}): RowPreview {
  // `undefined` means "not specified"; anything else — including null — goes to the
  // check below. Using `??` here would have turned an explicit null into the default
  // and quietly returned three rows as though that was what was asked for.
  const limit = options.limit === undefined ? PREVIEW_DEFAULT_ROWS : options.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > PREVIEW_MAX_ROWS) {
    throw new Error(
      `preview_rows limit must be an integer between 1 and ${PREVIEW_MAX_ROWS}` +
        `${options.limit === undefined ? '' : ` (got ${JSON.stringify(options.limit)})`}`,
    );
  }

  const preview = rows.slice(0, limit);
  return { rowCount: rows.length, rows: preview, truncated: preview.length < rows.length };
}

/** Executes a transform plan over every row and splits the result into two views. */
export function runQuery(rows: Row[], steps: TransformStep[], options: QueryOptions = {}): QueryResult {
  const previewRowCount = options.previewRowCount ?? 3;
  // Refuse plans that would quietly chart the wrong rows; the message goes back
  // to the model as the tool result, which is how it repairs itself.
  validateChartPlan(steps);
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

const DESCRIBE_TABLE: ToolDef = {
  name: 'describe_table',
  description:
    'Profile the dataset before deciding anything: row count, and per column its type, null rate, ' +
    'distinct-value count, numeric range/median, and time span. Returns aggregates only — never rows. ' +
    'Call this first.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
};

const RUN_QUERY: ToolDef = {
  name: 'run_query',
  description:
    'Run a declarative transformation over the FULL dataset. The complete result becomes the chart dataset ' +
    'and is NOT sent to you; you receive only a summary (row count, columns, and a few preview rows). ' +
    'The steps you pass here are adopted as the chart spec transform_plan, so do not write a plan yourself. ' +
    'Steps: filter | aggregate | sort | limit | derive | binTime. aggregate replaces the table with ' +
    'group_by columns plus each measure\'s "as" column. For "largest/smallest/best/worst N" requests you MUST ' +
    'put a sort before the limit — a limit straight after an aggregate keeps an arbitrary subset and is ' +
    'rejected.',
  parameters: {
    type: 'object',
    required: ['steps'],
    properties: { steps: { type: 'array', maxItems: 20, items: STEP_SCHEMA } },
    additionalProperties: false,
  },
};

/** Shared by both modes: the model finishes in the same way either way. */
const SUBMIT_PROPERTIES = {
  chart: {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', enum: ['bar', 'line', 'pie'] },
      title: { type: 'string' },
      orientation: { type: 'string', enum: ['vertical', 'horizontal'] },
    },
    additionalProperties: false,
  },
  encodings: {
    type: 'object',
    required: ['x', 'y'],
    properties: {
      // `additionalProperties: false` on the inner objects too: a column reference is
      // one field, and a model that invents another one should be told rather than
      // quietly given something different from every other caller.
      x: { type: 'object', required: ['field'], properties: { field: { type: 'string' } }, additionalProperties: false },
      y: { type: 'object', required: ['field'], properties: { field: { type: 'string' } }, additionalProperties: false },
      series: { type: 'object', required: ['field'], properties: { field: { type: 'string' } }, additionalProperties: false },
    },
    additionalProperties: false,
  },
  emphasis: {
    type: 'array',
    description:
      'Optional. Condition-based emphasis, applied in order (later rules win). Declare the CONDITION, ' +
      'never a data value you looked up: for "highlight the largest" use top_k with k=1 and the measure ' +
      'field, and the compiler finds it in the full data.',
    items: {
      type: 'object',
      required: ['when', 'style'],
      properties: {
        when: {
          type: 'object',
          required: ['op', 'field'],
          properties: {
            op: { type: 'string', enum: ['top_k', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'] },
            field: { type: 'string' },
            k: { type: 'integer', minimum: 1 },
            direction: { type: 'string', enum: ['max', 'min'] },
            value: {},
            values: { type: 'array' },
          },
          additionalProperties: false,
        },
        style: {
          type: 'object',
          required: ['tone'],
          properties: {
            tone: {
              type: 'string',
              enum: ['highlight', 'muted'],
              description: 'Semantic: "highlight" stands out, "muted" recedes. Not a colour.',
            },
            label: { type: 'boolean', description: 'Also show a data label on the emphasised marks.' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
};

const SUBMIT_ASK: ToolDef = {
  name: 'submit_spec',
  description:
    'Finish: submit the chart spec. Call this exactly ONCE, after run_query has produced the table you want ' +
    'to chart. Do NOT include a transform_plan — the steps from your last successful run_query are adopted ' +
    'automatically. chart.type is a neutral name (bar | line | pie); encodings.x is the category column (a date ' +
    'column is treated as categories), encodings.y the measure column, and the optional encodings.series splits ' +
    'the data into series.',
  parameters: { type: 'object', required: ['chart', 'encodings'], properties: SUBMIT_PROPERTIES, additionalProperties: false },
};

/**
 * The present-mode wording differs where the ask-mode wording would be a lie: it
 * must not refer to a query the model cannot run, or to a plan it cannot write.
 */
const SUBMIT_PRESENT: ToolDef = {
  name: 'submit_spec',
  description:
    'Finish: submit the chart spec. Call this exactly ONCE. The table is already final, so chart it as it ' +
    'stands — the numbers and the order are the caller\'s. chart.type is a neutral name (bar | line | pie); ' +
    'encodings.x is the category column (a date column is treated as categories), encodings.y the measure ' +
    'column, and the optional encodings.series splits the data into series.',
  parameters: { type: 'object', required: ['chart', 'encodings'], properties: SUBMIT_PROPERTIES, additionalProperties: false },
};

const PREVIEW_ROWS: ToolDef = {
  name: 'preview_rows',
  description:
    'Look at the first few actual rows of the table — up to twenty — to see the values themselves rather than a ' +
    'summary of them. Read only: this cannot change the data. It always returns the FIRST rows, in the order ' +
    'the caller gave them, so there is no way to page through the table.',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 20, description: 'How many rows, up to twenty. Defaults to 3.' },
    },
    additionalProperties: false,
  },
};

/**
 * The tool surface of a run.
 *
 * Present mode's list is shorter for one reason: every tool that could change the
 * caller's rows is absent, so the capability is not there to be argued into. `ask`
 * is the default everywhere, so an existing caller sees no change.
 *
 * `preview_rows` is present-mode only. In `ask` mode the model already gets a
 * three-row preview from `run_query`'s summary, and keeping that list short is
 * deliberate; adding it to both modes later is a one-line change if the need shows.
 */
/**
 * The tool definitions are module-level templates, so `buildToolDefs` hands out deep
 * copies rather than the templates themselves. A caller that edits what it receives —
 * to add a field its provider wants, say — cannot then reach into the library's copy,
 * or into the other mode's tool: without this, `SUBMIT_ASK` and `SUBMIT_PRESENT` share
 * the same `parameters` object and editing one changes both.
 */
export function buildToolDefs(mode: ToolMode = 'ask'): ToolDef[] {
  const templates = mode === 'present' ? [DESCRIBE_TABLE, PREVIEW_ROWS, SUBMIT_PRESENT] : [DESCRIBE_TABLE, RUN_QUERY, SUBMIT_ASK];
  return structuredClone(templates);
}

/** The natural-language tool list, for callers who import it directly. */
export const TOOL_DEFS: ToolDef[] = buildToolDefs('ask');

export type ToolContext = {
  rows: Row[];
  /** The caller's policy knobs. Never reachable from a tool call's arguments. */
  profile?: ProfileOptions;
  query?: QueryOptions;
  /**
   * The authoritative column list, when the caller declared one. `describe_table`
   * reports these types rather than re-inferring, so the prompt and the profile
   * cannot disagree about a column.
   */
  columns?: Column[];
};

export type ToolHandler = (args: unknown) => unknown;

/**
 * Rejects any argument a tool did not declare.
 *
 * The model's arguments are its own; the caller's policy is not. `describe_table`
 * takes no arguments, and its options include `sampleValues` and
 * `sampleValuesMaxCardinality` — spreading tool arguments over them, which is what
 * this used to do, let a model raise its own sample budget above what the caller
 * allowed, or lift a `sampleValues: 0` quietly. Refusing an undeclared argument is
 * also what keeps `preview_rows` unable to ask for a window it has no parameter for.
 */
function onlyParameters(tool: string, args: unknown, allowed: string[], hint = ''): Record<string, unknown> {
  const provided = (args ?? {}) as Record<string, unknown>;
  const names = Object.keys(provided);
  const unexpected = names.find((name) => !allowed.includes(name));
  if (unexpected !== undefined) {
    const takes = allowed.length === 0 ? 'no parameters' : `only ${allowed.map((name) => `'${name}'`).join(', ')}`;
    throw new Error(`${tool}: '${unexpected}' is not a parameter. It takes ${takes}.${hint ? ` ${hint}` : ''}`);
  }
  return provided;
}

/** Maps tool names to implementations bound to one dataset. */
export function createToolHandlers(ctx: ToolContext): Record<string, ToolHandler> {
  return {
    describe_table: (args) => {
      onlyParameters('describe_table', args, []);
      // No tool arguments reach the profile: those knobs are the caller's.
      return describeTable(ctx.rows, ctx.profile, ctx.columns);
    },
    preview_rows: (args) => {
      const provided = onlyParameters('preview_rows', args, ['limit'], 'It always returns the first rows of the table.');
      // A limit that is not a usable number is passed through so previewRows can
      // refuse it out loud, rather than falling back to the default and looking like
      // it worked.
      return previewRows(ctx.rows, { limit: provided.limit as number | undefined });
    },
    run_query: (args) => {
      const steps = onlyParameters('run_query', args, ['steps']).steps as TransformStep[] | undefined;
      if (!Array.isArray(steps)) throw new Error('run_query needs a "steps" array');
      const { table, summary } = runQuery(ctx.rows, steps, ctx.query);
      // Only the summary is returned to the model; `table` is attached for the
      // loop to capture and bind into the chart.
      return { summary, table };
    },
  };
}
