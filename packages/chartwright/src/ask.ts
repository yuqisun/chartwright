/**
 * The public entry point.
 *
 * `createChartwright` fixes the things that do not change per request (the LLM
 * client, optional budgets, profile options) and returns an object with `ask`.
 * Requests are stateless: a follow-up passes the previous `messages` back, so
 * nothing is retained between calls and there is no server-side session to leak
 * (the isolation rule the ChartBrain notes call out for agent loops).
 */
import { compileToHighcharts } from './compile/index.ts';
import { runAgentLoop } from './loop.ts';
import { applyColumnDescriptions, buildSystemPrompt, buildUserPrompt } from './prompt.ts';
import { buildToolDefs, createToolHandlers, inferColumns } from './tools.ts';
import { createSubmitValidator } from './submit.ts';
import type { ProfileOptions, QueryOptions } from './tools.ts';
import type { AskRequest, AskResult, Budget, ChatMessage, LlmClient, ToolMode } from './types.ts';

export type ChartwrightOptions = {
  /** Default LLM client. A request may override it. */
  llm: LlmClient;
  /** Only 'highcharts' today. */
  library?: 'highcharts';
  /** Optional guard rails; unset means "no policy of your own". */
  budget?: Budget;
  /** Passed to the profiling tool. */
  profile?: ProfileOptions;
  /** Passed to the query tool (e.g. preview size). */
  query?: QueryOptions;
};

export type Chartwright = {
  ask(request: AskRequest): Promise<AskResult>;
};

function newSessionId(): string {
  // `crypto.randomUUID` exists in Node 19+ and in browsers over HTTPS/localhost.
  return globalThis.crypto?.randomUUID?.() ?? `cw_${Math.random().toString(36).slice(2)}`;
}

export function createChartwright(config: ChartwrightOptions): Chartwright {
  const { budget: defaultBudget, profile: profileOptions, query: queryOptions } = config;

  return {
    async ask(request: AskRequest): Promise<AskResult> {
      const llm = request.llm ?? config.llm;
      if (!llm) throw new Error('no LLM client: pass one to createChartwright() or to ask()');

      const sessionId = request.sessionId ?? newSessionId();
      // The caller's declarations are the authority on its own columns: they shape the
      // prompt *and* the profile, so the two cannot describe the same column
      // differently. They never travel any further than that.
      const columns = applyColumnDescriptions(inferColumns(request.rows), request.columns);
      // One switch, read once. Everything that differs between the two modes —
      // tools, prompt, and (through the tool list) whether a plan can exist at all
      // — is derived from it, so the modes cannot drift apart.
      const mode: ToolMode = request.present === true ? 'present' : 'ask';

      const priorTurns = request.messages ?? [];
      // A follow-up already carries the system prompt inside its transcript;
      // prefixing another one would give the model two competing instruction sets.
      const hasSystemPrompt = priorTurns.some((m) => m.role === 'system');

      const messages: ChatMessage[] = [
        ...(hasSystemPrompt ? [] : [{ role: 'system' as const, content: buildSystemPrompt(mode) }]),
        // Prior turns, when this is a follow-up.
        ...priorTurns,
        { role: 'user', content: buildUserPrompt(request.query, {
          rowCount: request.rows.length,
          columns,
          ...(request.dataDescription ? { dataDescription: request.dataDescription } : {}),
        }) },
      ];

      const handlers = createToolHandlers({
        rows: request.rows,
        profile: profileOptions,
        query: queryOptions,
        columns,
      });

      const outcome = await runAgentLoop({
        llm,
        messages,
        tools: buildToolDefs(mode),
        // A submission is accepted only once the compiler has actually built it, so a
        // refusal reaches the model as a tool result rather than the caller as an
        // exception it cannot act on.
        validateSubmit: createSubmitValidator({ rows: request.rows, mode }),
        runTool: (name, args) => {
          const handler = handlers[name];
          if (!handler) throw new Error(`unknown tool '${name}'`);
          return handler(args);
        },
        onEvent: request.onEvent,
        budget: request.budget ?? defaultBudget,
        signal: request.signal,
      });

      // Deterministic half: the compiler binds the data, not the model.
      const { options: chartOptions, dataset, warnings: compileWarnings } = compileToHighcharts(outcome.spec, request.rows);

      const result: AskResult = {
        options: chartOptions,
        spec: outcome.spec,
        dataset,
        sessionId,
        messages: outcome.messages,
        // Warnings from the loop (failed tools, rejected submissions) and from
        // the compiler (an emphasis rule that matched nothing) both matter.
        warnings: [...outcome.warnings, ...compileWarnings],
        trace: outcome.trace,
      };

      request.onEvent?.({ type: 'done', result });
      return result;
    },
  };
}
