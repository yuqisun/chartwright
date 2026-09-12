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

export type ValueType = 'categorical' | 'numeric' | 'temporal';

export type Encoding = {
  field: string;
  value_type?: ValueType;
};

export type ChartSpec = {
  schema_version?: 1;
  chart: {
    /** A neutral name such as 'bar' | 'line' | 'pie' | 'groupedBar' | ... */
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
  };
  /** Omit to chart the raw rows. */
  transform_plan?: { steps: TransformStep[] };
  encodings: {
    x?: Encoding;
    y?: Encoding;
    /** Optional channel that splits the data into multiple series. */
    series?: Encoding;
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
  | { op: 'top_k'; field: string; k: number; direction?: 'max' | 'min' }
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
