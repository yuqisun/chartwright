/**
 * chartwright — natural-language charts in your own process.
 *
 * What this package owns:
 *   - the neutral chart spec and its closed transform DSL,
 *   - the deterministic engine that executes it over your rows,
 *   - the local tools an agent loop may call to inspect those rows.
 *
 * What it does not own: the LLM. You inject a client, so credentials and
 * provider policy stay with you.
 */
export { applyTransform, binDate } from './transform.ts';
export { createToolHandlers, describeTable, inferColumns, runQuery, TOOL_DEFS } from './tools.ts';
export { compileToHighcharts, isSupportedChartType, materialize, SUPPORTED_CHART_TYPES } from './compile/simple.ts';
export { AgentGaveUpError, runAgentLoop } from './loop.ts';
export { buildSystemPrompt, buildUserPrompt } from './prompt.ts';
export { createChartwright } from './ask.ts';

export type { ChartOptions, CompiledChart, SupportedChartType } from './compile/simple.ts';
export type { AgentLoopOptions, AgentLoopOutcome } from './loop.ts';
export type { Chartwright, ChartwrightOptions } from './ask.ts';

export type {
  ColumnProfile,
  ProfileOptions,
  QueryOptions,
  QueryResult,
  QuerySummary,
  TableProfile,
  ToolContext,
  ToolHandler,
} from './tools.ts';

export type {
  AgentEvent,
  AggregateStep,
  AggregationFn,
  AskRequest,
  AskResult,
  BinTimeStep,
  Budget,
  ChartSpec,
  ChatMessage,
  ChatRole,
  Column,
  ColumnType,
  DeriveStep,
  Encoding,
  FilterOperator,
  FilterStep,
  JsonSchema,
  LimitStep,
  LlmClient,
  LlmCompleteRequest,
  LlmCompleteResult,
  Measure,
  Operand,
  Row,
  SortStep,
  ToolCall,
  ToolDef,
  TraceEntry,
  TransformStep,
  ValueType,
} from './types.ts';
