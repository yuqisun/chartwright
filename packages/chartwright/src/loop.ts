/**
 * The agent loop.
 *
 * Shape borrowed from deepseek-harness (MIT): a provider-agnostic `complete`
 * call, a tool runtime, and a hard separation between what the model sees and
 * what stays in the process. What is *not* borrowed is the plugin container —
 * this is a few hundred lines of plain functions, because a chart agent needs a
 * loop and four tools, not an extensible runtime.
 *
 * Two protocol decisions worth knowing:
 *
 *   1. **A terminal tool call finishes the run.** The model calls `submit_spec`
 *      rather than replying with JSON, so the loop knows unambiguously when it
 *      is done and can validate (and reject) the spec while the model is still
 *      around to fix it.
 *   2. **The full table never enters the conversation.** `run_query` returns the
 *      complete table to us and a small summary to the model; the loop strips
 *      the table before the tool result is serialised.
 */
import {
  CHANNEL_NAMES,
  CHART_TYPES,
  CHART_TYPE_NAMES,
  DEFAULT_REQUIRED_CHANNELS,
  isChartType,
} from './compile/index.ts';
import type { ChannelName } from './compile/index.ts';
import type {
  AgentEvent,
  AskResult,
  Budget,
  ChartSpec,
  ChatMessage,
  EmphasisRule,
  LlmClient,
  ToolCall,
  ToolDef,
  TraceEntry,
  TransformStep,
} from './types.ts';

/** Emitted internally when a round reaches the model with no way to finish. */
export class AgentGaveUpError extends Error {
  readonly explanation: string;
  /** The transcript so far — useful when a model misbehaves and you need to see why. */
  readonly messages: ChatMessage[];

  constructor(explanation: string, messages: ChatMessage[]) {
    super(`the model did not produce a chart: ${explanation}`);
    this.name = 'AgentGaveUpError';
    this.explanation = explanation;
    this.messages = messages;
  }
}

export type ToolRunResult = unknown;

export type AgentLoopOptions = {
  llm: LlmClient;
  messages: ChatMessage[];
  tools: ToolDef[];
  /** Executes one tool call. May throw; the message is fed back to the model. */
  runTool: (name: string, args: unknown) => ToolRunResult;
  /**
   * Last say on a submission: return the reasons to reject it, or nothing to accept.
   *
   * This exists so that "the submission looked right" and "a chart comes out of it"
   * can be the same thing. Without it, everything the compiler refuses — two rows on
   * one category, an encoding over a column the plan never produced — surfaces after
   * the loop has ended, when the model is gone and the caller is left holding an
   * exception instead of a chart.
   */
  validateSubmit?: (spec: ChartSpec) => string[];
  onEvent?: (event: AgentEvent) => void;
  budget?: Budget;
  signal?: AbortSignal;
};

export type AgentLoopOutcome = {
  spec: ChartSpec;
  /** The plan adopted from the last successful run_query. */
  steps: TransformStep[];
  messages: ChatMessage[];
  warnings: string[];
  trace: TraceEntry[];
  /** Messages produced by the final round, for the assembled result. */
  rounds: number;
};

const SOFT_ROUND_WARNING = 12;

function parseSpecCandidate(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * Validates emphasis rules at submit time.
 *
 * Only shape is checked here — whether a rule *matches* anything depends on the
 * table the plan produces, so that is resolved at compile time and reported as a
 * warning. A rule that silently matches nothing would be a lie the user cannot
 * see, which is why it warns rather than passing quietly.
 */
const EMPHASIS_OPS = ['top_k', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'] as const;

function validateEmphasis(raw: unknown): { rules: EmphasisRule[]; errors: string[] } {
  if (raw === undefined) return { rules: [], errors: [] };
  if (!Array.isArray(raw)) return { rules: [], errors: ['emphasis must be an array'] };

  const rules: EmphasisRule[] = [];
  const errors: string[] = [];

  raw.forEach((entry, index) => {
    const where = `emphasis[${index}]`;
    const before = errors.length;

    if (typeof entry !== 'object' || entry === null) {
      errors.push(`${where} must be an object`);
      return;
    }
    const { when, style } = entry as { when?: Record<string, unknown>; style?: Record<string, unknown> };

    if (!when || typeof when !== 'object') errors.push(`${where}.when is required`);
    else {
      if (typeof when.op !== 'string' || !EMPHASIS_OPS.includes(when.op as (typeof EMPHASIS_OPS)[number])) {
        errors.push(`${where}.when.op must be one of ${EMPHASIS_OPS.join(', ')}`);
      }
      if (typeof when.field !== 'string' || when.field === '') {
        errors.push(`${where}.when.field must name a column of the charted table`);
      }
      if (when.op === 'top_k' && (typeof when.k !== 'number' || !Number.isInteger(when.k) || when.k < 1)) {
        errors.push(`${where}.when.k must be an integer >= 1`);
      }
      if (['gt', 'gte', 'lt', 'lte'].includes(String(when.op)) && typeof when.value !== 'number') {
        errors.push(`${where}.when.value must be a number for '${String(when.op)}'`);
      }
      if (when.op === 'between' && (!Array.isArray(when.values) || when.values.length !== 2)) {
        errors.push(`${where}.when.values must be a [low, high] pair`);
      }
    }

    if (!style || typeof style !== 'object') errors.push(`${where}.style is required`);
    else if (style.tone !== 'highlight' && style.tone !== 'muted') {
      errors.push(`${where}.style.tone must be "highlight" or "muted"`);
    }

    if (errors.length === before && when && style) {
      rules.push({
        when: when as unknown as EmphasisRule['when'],
        style: { tone: style.tone as 'highlight' | 'muted', ...(style.label === true ? { label: true } : {}) },
      });
    }
  });

  return { rules, errors };
}

/**
 * Validates a submitted spec and attaches the adopted plan.
 *
 * Unlike the tool *handlers*, this one **ignores** keys it does not recognise instead
 * of refusing them. That is safe by construction rather than by care: the spec is
 * assembled from the fields read here, so an unrecognised key cannot reach the plan or
 * the compiler — a `transform_plan` in a submission, for instance, is simply not the
 * plan's source. It is also the deliberate exception to the strictness elsewhere: a
 * refusal at submit time costs a whole extra round for something harmless, and this is
 * the run's only way to end.
 */
function validateSpec(raw: unknown, steps: TransformStep[]): { spec?: ChartSpec; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return { errors: ['spec must be a JSON object'] };
  const candidate = raw as Partial<ChartSpec>;

  const type = candidate.chart?.type;
  // The declaration, when the type is one: it decides both the refusal below and which
  // channels are required further down, so a type that needs something else (or nothing)
  // says so where it is declared instead of here.
  const declaration = typeof type === 'string' && isChartType(type) ? CHART_TYPES[type] : undefined;
  if (typeof type !== 'string') errors.push('chart.type is required');
  else if (!declaration) {
    errors.push(`chart.type '${type}' is not supported yet; supported types are ${CHART_TYPE_NAMES.join(', ')}`);
  }

  const provided: Record<ChannelName, unknown> = {
    x: candidate.encodings?.x?.field,
    y: candidate.encodings?.y?.field,
    series: candidate.encodings?.series?.field,
  };
  // An unrecognised type has no declaration to read, so it is held to the channels every
  // declared type asks for — today, x and y, which is what this checked before the
  // declaration existed.
  const required = declaration?.required ?? DEFAULT_REQUIRED_CHANNELS;
  for (const channel of required) {
    const value = provided[channel];
    if (typeof value !== 'string' || value === '') errors.push(`encodings.${channel}.field is required`);
  }

  const { rules: emphasis, errors: emphasisErrors } = validateEmphasis(candidate.emphasis);
  errors.push(...emphasisErrors);

  // `errors` being empty already means every required channel is a non-empty string; the
  // explicit check is what lets the compiler see that when the spec is assembled below.
  if (errors.length > 0) return { errors };
  if (typeof provided.x !== 'string' || typeof provided.y !== 'string') return { errors };

  const encodings: ChartSpec['encodings'] = {};
  // Assembled from the channels that were actually given, one field each. A key the schema
  // does not declare — an invented `value_type`, say — used to travel through into the spec
  // and change the axis for that one caller.
  for (const channel of CHANNEL_NAMES) {
    const value = provided[channel];
    if (typeof value === 'string' && value !== '') encodings[channel] = { field: value };
  }

  return {
    spec: {
      schema_version: 1,
      chart: {
        type: type as string,
        ...(candidate.chart?.title ? { title: candidate.chart.title } : {}),
        ...(candidate.chart?.orientation ? { orientation: candidate.chart.orientation } : {}),
      },
      // The plan comes from the tool call, never from the model's prose.
      transform_plan: { steps },
      encodings,
      ...(emphasis.length > 0 ? { emphasis } : {}),
    },
    errors: [],
  };
}

/**
 * Recovers the last successful `run_query` plan from a transcript.
 *
 * This is what makes follow-ups work without state: the previous turn's tool
 * call is still in the messages the caller passes back, so a model that submits
 * a spec directly on the second question keeps the plan it established on the
 * first. Failed attempts are skipped by checking the matching tool result.
 */
export function recoverPlanFrom(messages: ChatMessage[]): TransformStep[] | undefined {
  const resultsById = new Map<string, string>();
  for (const message of messages) {
    if (message.role === 'tool' && message.toolCallId) resultsById.set(message.toolCallId, message.content ?? '');
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== 'assistant' || !message.toolCalls) continue;
    for (let j = message.toolCalls.length - 1; j >= 0; j -= 1) {
      const call = message.toolCalls[j];
      if (!call || call.name !== 'run_query') continue;
      const content = resultsById.get(call.id);
      if (content !== undefined && content.includes('"error"')) continue;
      const steps = (call.args as { steps?: TransformStep[] } | undefined)?.steps;
      if (Array.isArray(steps)) return steps;
    }
  }
  return undefined;
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopOutcome> {
  const { llm, tools, runTool, onEvent, budget, signal } = options;
  const messages = [...options.messages];
  const trace: TraceEntry[] = [];
  const warnings: string[] = [];

  // The declared tool list is a contract, not a hint. A model can emit a call for
  // anything — including a tool it was never offered, or one from an earlier turn
  // in the transcript — so the list is enforced here rather than trusted.
  const reachable = new Set(tools.map((tool) => tool.name));
  // `submit_spec` is the only way a run finishes, so it is not optional: a list
  // without it is a caller's mistake, and the loop would otherwise spin until the
  // model runs out of patience and the failure looked like the model's fault.
  if (!reachable.has('submit_spec')) {
    throw new Error(
      "the tool list must include 'submit_spec' — it is the only way a run finishes. Got: " +
        ([...reachable].join(', ') || '(an empty list)'),
    );
  }
  // A plan can only come from run_query. If this run has no run_query, it has no
  // plan, whatever an earlier turn left in the transcript: present mode must not
  // inherit a transform from a natural-language turn.
  const mayPlan = reachable.has('run_query');

  let round = 0;
  let toolCallsUsed = 0;
  // A follow-up may already contain the plan from an earlier turn.
  let lastRunQuerySteps: TransformStep[] | undefined = mayPlan ? recoverPlanFrom(messages) : undefined;
  let textOnlyRounds = 0;

  for (;;) {
    round += 1;
    if (budget?.maxRounds !== undefined && round > budget.maxRounds) {
      throw new Error(`agent loop stopped: maxRounds (${budget.maxRounds}) exceeded`);
    }
    if (budget?.maxRounds === undefined && round === SOFT_ROUND_WARNING) {
      const message = `agent loop has run ${round} rounds; consider setting budget.maxRounds`;
      warnings.push(message);
      onEvent?.({ type: 'warning', message });
    }

    onEvent?.({ type: 'round_start', round });

    const request = { messages: [...messages], tools, signal };
    const reply = llm.completeStream
      ? await llm.completeStream(request, (text) => onEvent?.({ type: 'assistant_delta', text }))
      : await llm.complete(request);

    if (reply.content && reply.content.trim() !== '') {
      onEvent?.({ type: 'assistant_text', text: reply.content });
    }

    const toolCalls: ToolCall[] = reply.toolCalls ?? [];

    if (toolCalls.length === 0) {
      // No tool call. Accept a bare spec if the model replied with one, otherwise
      // treat the text as the model's explanation. One retry is allowed before
      // giving up, so a model that narrates instead of acting still gets a nudge.
      const candidate = reply.content ? parseSpecCandidate(reply.content) : undefined;
      if (candidate !== undefined) {
        const { spec, errors } = validateSpec(candidate, lastRunQuerySteps ?? []);
        if (spec && errors.length === 0) {
          return { spec, steps: lastRunQuerySteps ?? [], messages, warnings, trace, rounds: round };
        }
      }

      textOnlyRounds += 1;
      const explanation = (reply.content ?? '').trim();
      if (textOnlyRounds >= 2) {
        // Bounded on purpose: a model that never calls submit_spec must not spin
        // forever. Its own words become the explanation handed to the caller.
        throw new AgentGaveUpError(explanation || 'the model returned no content and no tool call', messages);
      }
      messages.push({ role: 'assistant', ...(reply.content ? { content: reply.content } : {}) });
      messages.push({
        role: 'user',
        content:
          'Finish with a tool call: call submit_spec if a chart is possible. If it is genuinely not, reply with the ' +
          'same one-sentence explanation and no tool call.',
      });
      continue;
    }

    messages.push({
      role: 'assistant',
      ...(reply.content ? { content: reply.content } : {}),
      toolCalls,
    });

    for (const call of toolCalls) {
      toolCallsUsed += 1;
      if (budget?.maxToolCalls !== undefined && toolCallsUsed > budget.maxToolCalls) {
        throw new Error(`agent loop stopped: maxToolCalls (${budget.maxToolCalls}) exceeded`);
      }

      onEvent?.({ type: 'tool_call', id: call.id, name: call.name, args: call.args });

      const started = Date.now();
      let payload: unknown;
      let problem: string | undefined;

      if (call.name === 'submit_spec') {
        const { spec, errors } = validateSpec(call.args, lastRunQuerySteps ?? []);
        // A shape that passes validation is not yet a chart. Ask the checked-out
        // compiler while the model is still here to fix what it says.
        const problems = spec && errors.length === 0 ? (options.validateSubmit?.(spec) ?? []) : [];
        const rejected = [...errors, ...problems];
        if (rejected.length > 0) {
          problem = rejected.join('; ');
          payload = { accepted: false, errors: rejected };
        } else {
          payload = { accepted: true };
          // Read the clock once: the event and the trace entry describe the same
          // hop, so they must not disagree by a millisecond.
          const elapsed = Date.now() - started;
          // The acceptance is recorded too: a trace where refusals carry a result
          // and the successful finish does not reads as if nothing happened. `ms` is
          // the same figure as everywhere else — the time spent handling this call —
          // and so does not include the compile that happens after the loop returns.
          trace.push({ round, toolCallId: call.id, tool: call.name, args: call.args, result: payload, ms: elapsed });
          onEvent?.({ type: 'tool_result', id: call.id, name: call.name, summary: payload, ms: elapsed });
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(payload) });
          return { spec: spec as ChartSpec, steps: lastRunQuerySteps ?? [], messages, warnings, trace, rounds: round };
        }
      } else if (!reachable.has(call.name)) {
        // Refused before any handler is consulted, so the capability is absent rather
        // than merely discouraged. This is the ONLY place a tool call is stopped:
        // moving it after `runTool` above turns present mode's guarantee back into a
        // promise, and test/loop.test.ts asserts that a call the run never declared
        // reaches no handler at all.
        const readers = tools.filter((tool) => tool.name !== 'submit_spec').map((tool) => tool.name);
        // A model that reaches for the tool which changes data is asking a question
        // about *why*, not about the tool list, so answer that — and name only the
        // tools this run actually has.
        problem =
          call.name === 'run_query'
            ? 'run_query is not available in this run: nothing here can change the data, so the rows you were ' +
              'given are final. ' +
              (readers.length > 0
                ? `Look at the table with ${readers.join(' or ')}, then choose encodings that present it.`
                : 'Choose encodings that present the table as it is.')
            : `tool '${call.name}' is not available in this run; available tools: ${[...reachable].join(', ')}`;
        payload = { error: problem };
      } else {
        try {
          const result = runTool(call.name, call.args);
          // Capture the plan and strip the full table: the model gets the
          // summary, the process keeps the rows.
          if (call.name === 'run_query') {
            const steps = (call.args as { steps?: TransformStep[] }).steps;
            if (Array.isArray(steps)) lastRunQuerySteps = steps;
            payload = (result as { summary?: unknown }).summary ?? result;
          } else {
            payload = result;
          }
        } catch (error) {
          problem = error instanceof Error ? error.message : String(error);
          payload = { error: problem };
        }
      }

      trace.push({ round, toolCallId: call.id, tool: call.name, args: call.args, result: payload, ms: Date.now() - started });
      onEvent?.({ type: 'tool_result', id: call.id, name: call.name, summary: payload, ms: Date.now() - started });
      messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(payload) });
      // A handler's message may name its own tool (useful when someone calls the
      // handler directly), so do not stutter when it already has.
      if (problem) warnings.push(problem.startsWith(call.name) ? problem : `${call.name}: ${problem}`);
    }
  }
}

/** Convenience: build the pieces an `AskResult` needs from a loop outcome. */
export function toAskResultBase(outcome: AgentLoopOutcome): Pick<AskResult, 'spec' | 'messages' | 'warnings' | 'trace'> {
  return {
    spec: outcome.spec,
    messages: outcome.messages,
    warnings: outcome.warnings,
    trace: outcome.trace,
  };
}
