/**
 * Public types for chartwright.
 *
 * Two vocabularies live here, deliberately kept apart:
 *
 *   1. the **neutral chart spec** — what to draw, never how a library draws it.
 *      This is the auditable, replayable artifact.
 *   2. the **LLM transport** — messages, tools, and client. chartwright never
 *      owns credentials; the caller injects a client.
 */

/**
 * Which chart types the consumer's bundle can actually draw.
 *
 * Offered because 63 of Highcharts' 71 series types live in modules: emitting options
 * for a module the consumer never loaded fails in *their* process, where no test of this
 * library can observe it. The consumer answers in this library's neutral vocabulary —
 * never Highcharts' — and the backend owns the translation.
 *
 * A *function* is accepted, and called on every request, because a real application
 * code-splits its chart modules: what is loaded can change between routes, and the
 * registry behind it is a global mutable singleton. An async function is accepted for
 * the server, where the modules cannot be imported at all and the answer has to come
 * from somewhere else.
 *
 * Names the library does not declare are *warned about*, not silently dropped: a
 * capability mismatch whose only symptom is "the model never picks heatmaps" is the
 * worst bug report there is. A source that resolves to nothing is refused outright,
 * because such a run could never finish.
 */
export type CapabilitySource = readonly string[] | (() => readonly string[] | Promise<readonly string[]>);

/** A row is opaque to chartwright: no schema is assumed, no field is required. */
export type Row = Record<string, unknown>;

export type ColumnType = 'string' | 'number' | 'date' | 'boolean';

export type Column = {
  name: string;
  type: ColumnType;
};

/**
 * What the caller says about one column.
 *
 * Both fields are optional and independent: declare a `type` to correct inference,
 * a `description` to say what the column means, or both. Neither is required — a
 * request with no declarations behaves exactly as it did before this existed.
 */
export type ColumnDescription = {
  name: string;
  /** Wins over inference when present. Only the caller knows an all-digit code is an id. */
  type?: ColumnType;
  /** What the column means. For the model's benefit, never validated. */
  description?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Transform DSL
//
// The six operators are a closed set on purpose: a closed verb list is what
// keeps an LLM's output checkable (see the "controlled verb set" idea in the
// project notes, borrowed from glyph via the ChartBrain research). Adding an
// operator is a deliberate act, not something a model can improvise.
// ─────────────────────────────────────────────────────────────────────────────

export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'in' | 'contains';

export type FilterStep = {
  op: 'filter';
  field: string;
  operator: FilterOperator;
  value?: unknown;
  values?: unknown[];
};

export type AggregationFn = 'sum' | 'avg' | 'count' | 'countDistinct' | 'min' | 'max';

export type Measure = {
  /** Omit for `count`, which counts rows. */
  field?: string;
  agg: AggregationFn;
  /** Name of the produced column. */
  as: string;
};

export type AggregateStep = {
  op: 'aggregate';
  group_by: string[];
  measures: Measure[];
};

export type SortStep = { op: 'sort'; by: string; order?: 'asc' | 'desc' };

export type LimitStep = { op: 'limit'; n: number };

export type Operand = { field: string } | { value: number };

export type DeriveStep = {
  op: 'derive';
  as: string;
  left: Operand;
  operator: 'add' | 'subtract' | 'multiply' | 'divide';
  right: Operand;
};

export type BinTimeStep = {
  op: 'binTime';
  field: string;
  granularity: 'month' | 'quarter' | 'year';
  as: string;
};

export type TransformStep = FilterStep | AggregateStep | SortStep | LimitStep | DeriveStep | BinTimeStep;

// ─────────────────────────────────────────────────────────────────────────────
// Neutral chart spec
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A column reference.
 *
 * One field, and deliberately no `value_type`. That field existed, was read by a
 * datetime-axis branch in the compiler, and was set by nothing but two tests — so the
 * branch never ran and the field only served to let a model that guessed the name get a
 * different axis from everyone else. A date column is a category; see `docs/roadmap.md`.
 */
export type Encoding = {
  field: string;
};

export type ChartSpec = {
  schema_version?: 1;
  chart: {
    /**
     * A neutral name such as 'bar' | 'line' | 'pie' | 'groupedBar' | ...
     * The set that is actually supported today is declared in `compile/chart-types.ts`,
     * and every list the model or the caller sees is derived from it.
     */
    type: string;
    title?: string;
    /**
     * For bar charts. A neutral way to say "which way do the bars point",
     * instead of naming a library's `column` vs `bar` types.
     *
     * Default is 'vertical'. 'horizontal' is the right choice when category
     * labels are long or numerous (a top-N-by-name chart, for instance).
     */
    orientation?: 'vertical' | 'horizontal';
    /**
     * Stack the series on top of each other rather than side by side. `'normal'` keeps absolute
     * values, `'percent'` makes every category total 100 — which is a claim about the data, so
     * the compiler passes it through rather than deciding it.
     */
    stacking?: 'normal' | 'percent';
    /** Wrap the axes around a circle: a radar, or a rose when combined with vertical bars. */
    polar?: boolean;
    /** The hole in a pie, 0 to 1: 0.5 is a donut. Ignored by types that are not pies. */
    hole?: number;
    /**
     * Drop the chrome — title, axes, legend — and keep the marks. A sparkline is not a chart
     * type; it is the same chart with nothing around it.
     */
    compact?: boolean;
    /**
     * How the secondary measure (`encodings.y2`) is drawn. Defaults to `'line'` when `y2`
     * is present and this is omitted. Ignored when there is no `y2`.
     */
    type2?: string;
  };
  /** Omit to chart the raw rows. */
  transform_plan?: { steps: TransformStep[] };
  encodings: {
    x?: Encoding;
    y?: Encoding;
    /**
     * A second measure, drawn on a second (right) axis. Only meaningful when the two
     * measures have different units — putting both on one axis would flatten the smaller
     * one. Series from this channel are named after the field (§3.4 rule 1), and both
     * axes carry their field name as a title (§3.4 rule 2).
     */
    y2?: Encoding;
    /** Optional channel that splits the data into multiple series. */
    series?: Encoding;
    /** Optional size channel for bubble charts — maps a measure to mark size. */
    size?: Encoding;
    /** Low value for range types (columnrange, arearange, errorbar, dumbbell). */
    low?: Encoding;
    /** High value for range types. */
    high?: Encoding;
  };
  /**
   * Axis overrides. Omitted, every axis is inferred: a category channel wants a band axis and a
   * measure wants a linear one. `y.range` exists because some measures have a scale the data
   * does not reveal — a percentage that should start at 0 and end at 100 whatever the rows say.
   */
  axes?: {
    x?: { kind?: 'band' | 'linear' | 'log'; min?: number; max?: number };
    y?: { kind?: 'band' | 'linear' | 'log'; min?: number; max?: number };
    /** Fixed range for the secondary (right) axis. Same semantics as `y`. */
    y2?: { kind?: 'band' | 'linear' | 'log'; min?: number; max?: number };
  };
  /**
   * Condition-based emphasis: "highlight the largest bar", "grey out everything
   * except the best".
   *
   * The *condition* is declared, not evaluated by the model. `top_k` is the
   * important case: the model says "the top 1 by this measure" and the compiler
   * finds it in the real data. That keeps the result correct when the data
   * changes, and keeps the model away from data values entirely.
   */
  emphasis?: EmphasisRule[];
};

/** Which rows an emphasis rule applies to. */
export type EmphasisWhen =
  | {
      op: 'top_k';
      field: string;
      k: number;
      direction?: 'max' | 'min';
      /**
       * Mark the rows the ranked set **excludes** — "and fade the rest", with no second
       * guess about which rows those are.
       *
       * This exists because the complement of a ranked set was otherwise not expressible
       * without looking a value up. The one construction that worked was an always-true
       * threshold (`gte: 0`), which is a fact about a measure's sign rather than about the
       * ranking, and a threshold at a real bound is a number the model must not go and fetch.
       * So a model asked to fade the rest reached for the nearest thing the schema offered —
       * a *larger* `top_k` — read as a complement. On a twelve-row table `top_k(11)` muted
       * ranks 1-11, including the winner an earlier rule had just highlighted, and left rank 12
       * as the only default-coloured bar: a picture of the opposite of what was asked, with no
       * warning, because neither rule was wrong on its own.
       *
       * The complement is taken over the same ranking as the rule it mirrors, ties at the k-th
       * value included (§ ties), so the pair always partitions the rows the ranking can see.
       */
      rest?: boolean;
    }
  | { op: 'eq' | 'neq'; field: string; value: number | string }
  | { op: 'gt' | 'gte' | 'lt' | 'lte'; field: string; value: number }
  | { op: 'between'; field: string; values: [number, number] };

export type EmphasisStyle = {
  /**
   * Semantic, not a colour. The compilers of each backend decide what
   * "highlight" looks like, so the spec stays library-independent.
   */
  tone: 'highlight' | 'muted';
  /** Also show a data label on the emphasised marks. */
  label?: boolean;
};

export type EmphasisRule = {
  when: EmphasisWhen;
  style: EmphasisStyle;
};

// ─────────────────────────────────────────────────────────────────────────────
// LLM transport
//
// chartwright does not ship a provider. The caller implements `LlmClient`
// however it likes — typically by calling its own backend, which is where the
// API key lives. That keeps provider policy (browser keys, CORS) and cost
// control with the party that owns the key.
// ─────────────────────────────────────────────────────────────────────────────

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type ChatMessage = {
  role: ChatRole;
  /** Assistant/user text. Absent on tool result messages. */
  content?: string;
  /** Present on assistant messages that request tools. */
  toolCalls?: ToolCall[];
  /** Present on tool result messages. */
  toolCallId?: string;
  /** Present on tool result messages: which tool produced this. */
  name?: string;
};

export type ToolCall = {
  id: string;
  name: string;
  args: unknown;
};

export type JsonSchema = Record<string, unknown>;

export type ToolDef = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

/**
 * How much the model may do to the caller's rows.
 *
 * `'ask'` is the natural-language mode: the model investigates the table with
 * `run_query` and shapes it into the table the chart needs.
 *
 * `'present'` is for a table the caller has already produced — grouped, ranked,
 * final. The model decides how to draw it and nothing else, so its tool list
 * simply has no way to change the data.
 *
 * The guarantee is the tool list, not the prompt: a mode cannot be talked out of
 * a capability it was never given.
 */
export type ToolMode = 'ask' | 'present';

export type LlmCompleteRequest = {
  messages: ChatMessage[];
  /** Absent when the caller only wants a final answer (no tool loop). */
  tools?: ToolDef[];
  /** Ask for a JSON object as the final answer. */
  json?: boolean;
  signal?: AbortSignal;
};

export type LlmCompleteResult = {
  content?: string;
  toolCalls?: ToolCall[];
};

export type LlmClient = {
  complete(req: LlmCompleteRequest): Promise<LlmCompleteResult>;
  /**
   * Optional. When implemented, chartwright forwards assistant text deltas as
   * they arrive. Progress at the *tool* level works without this — those events
   * come from the loop itself.
   */
  completeStream?(req: LlmCompleteRequest, onDelta: (text: string) => void): Promise<LlmCompleteResult>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Progress events
//
// Loop-level events do not depend on provider streaming, which is the point:
// a non-streaming client still gives the UI something to show at every hop.
// These double as the audit trail (`AskResult.trace`).
// ─────────────────────────────────────────────────────────────────────────────

export type AgentEvent =
  | { type: 'round_start'; round: number }
  | { type: 'assistant_delta'; text: string }
  | { type: 'assistant_text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; name: string; summary: unknown; ms: number }
  | { type: 'warning'; message: string }
  | { type: 'done'; result: AskResult }
  | { type: 'error'; message: string };

export type TraceEntry = {
  round: number;
  toolCallId?: string;
  tool?: string;
  args?: unknown;
  result?: unknown;
  ms?: number;
};

/**
 * Optional guard rails. Every field is optional and **unset by default**: the
 * library imposes no policy of its own. Callers that want limits set them here.
 */
export type Budget = {
  maxRounds?: number;
  maxToolCalls?: number;
};

export type AskRequest = {
  query: string;
  rows: Row[];
  /**
   * `true` when the rows are a result the caller has already produced — its own
   * `GROUP BY`, its own `ORDER BY`. The model still chooses the chart type, the
   * axes, the orientation, the title and any emphasis, but it has no tool that can
   * aggregate, filter, reorder, limit or derive, so the numbers it charts are the
   * numbers it was given, in the order it was given them.
   *
   * Leave unset for the natural-language mode, where the model investigates the
   * table itself.
   */
  present?: boolean;
  /**
   * What the caller knows about the table as a whole, in its own words: "one row
   * per booking country, already aggregated from the execution feed".
   *
   * Advisory, and deliberately so. It goes into the prompt and nowhere else — never
   * validated, never stored in the spec, not needed to replay a run — because the
   * pipeline must not start depending on a human sentence being accurate.
   */
  dataDescription?: string;
  /**
   * Per-column notes: a `type` that corrects inference (an all-digit identifier is
   * not a number, and only the caller knows that) and a `description` of what the
   * column means.
   *
   * A name that is not in the rows is ignored rather than added — descriptions
   * describe this table, they do not extend it.
   */
  columns?: ColumnDescription[];
  /**
   * The caller's LLM client. chartwright never sees an API key.
   * Optional when the client was already supplied to `createChartwright()`.
   */
  llm?: LlmClient;
  /** Target library. Only 'highcharts' is supported today. */
  library?: 'highcharts';
  /**
   * What this consumer's bundle can draw. Omit to accept every declared type — which is
   * what every caller did before this existed. Overrides whatever `createChartwright`
   * was given, because capability is a property of the screen being rendered.
   */
  capabilities?: CapabilitySource;
  /** Pass the previous result's messages back to continue the conversation. */
  messages?: ChatMessage[];
  /** Correlation id; opaque to chartwright. */
  sessionId?: string;
  budget?: Budget;
  /** Progress callback. Optional — without it, `ask()` simply resolves once. */
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
};

export type AskResult = {
  /** Chart-library options with the data already bound. */
  options: Record<string, unknown>;
  /** The auditable artifact. Replay it without the LLM. */
  spec: ChartSpec;
  /** The table that was actually plotted. The model never sees this. */
  dataset: Row[];
  sessionId: string;
  /** Pass back verbatim on a follow-up request. */
  messages: ChatMessage[];
  warnings: string[];
  trace: TraceEntry[];
};
