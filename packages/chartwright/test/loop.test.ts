import assert from 'node:assert/strict';
import test from 'node:test';

import { createChartwright } from '../src/ask.ts';
import { AgentGaveUpError, runAgentLoop } from '../src/loop.ts';
import { createToolHandlers, TOOL_DEFS } from '../src/tools.ts';
import type { AgentEvent, ChatMessage, LlmClient, LlmCompleteRequest, LlmCompleteResult, Row } from '../src/types.ts';

const rows: Row[] = [
  { region: 'East', revenue: 100 },
  { region: 'West', revenue: 80 },
  { region: 'East', revenue: 150 },
];

/** A client that replays scripted replies, repeating the last one when exhausted. */
function scriptedLlm(replies: LlmCompleteResult[]): LlmClient & { calls: LlmCompleteRequest[] } {
  const calls: LlmCompleteRequest[] = [];
  let index = 0;
  return {
    calls,
    async complete(req: LlmCompleteRequest): Promise<LlmCompleteResult> {
      calls.push(req);
      const reply = replies[Math.min(index, replies.length - 1)];
      index += 1;
      return reply ?? { content: '' };
    },
  };
}

function loopOptions(llm: LlmClient, onEvent?: (e: AgentEvent) => void) {
  const handlers = createToolHandlers({ rows });
  return {
    llm,
    messages: [{ role: 'user', content: 'how much revenue per region?' }] as ChatMessage[],
    tools: TOOL_DEFS,
    runTool: (name: string, args: unknown) => {
      const handler = handlers[name];
      if (!handler) throw new Error(`unknown tool '${name}'`);
      return handler(args);
    },
    onEvent,
  };
}

const RUN_QUERY = {
  id: 'c1',
  name: 'run_query',
  args: {
    steps: [
      { op: 'aggregate', group_by: ['region'], measures: [{ field: 'revenue', agg: 'sum', as: 'revenue' }] },
      { op: 'sort', by: 'revenue', order: 'desc' },
    ],
  },
};

const SUBMIT = {
  id: 'c2',
  name: 'submit_spec',
  args: { chart: { type: 'bar', title: 'Revenue by region' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
};

test('a scripted run_query then submit_spec produces a spec with the adopted plan', async () => {
  const llm = scriptedLlm([
    { toolCalls: [RUN_QUERY] },
    { content: 'Bar chart it is.', toolCalls: [SUBMIT] },
  ]);

  const outcome = await runAgentLoop(loopOptions(llm));

  assert.equal(outcome.spec.chart.type, 'bar');
  assert.deepEqual(outcome.spec.transform_plan?.steps, RUN_QUERY.args.steps);
  assert.deepEqual(outcome.spec.encodings.x, { field: 'region' });
  assert.equal(outcome.trace.length, 2);
  assert.equal(outcome.rounds, 2);
});

test('the full table never reaches the model — only the summary does', async () => {
  const llm = scriptedLlm([{ toolCalls: [RUN_QUERY] }, { toolCalls: [SUBMIT] }]);
  const outcome = await runAgentLoop(loopOptions(llm));

  const toolMessages = outcome.messages.filter((m) => m.role === 'tool');
  const payload = JSON.parse(toolMessages[0]?.content ?? '{}') as Record<string, unknown>;

  assert.equal(payload.rowCount, 2, 'the model is told the true size');
  assert.equal(payload.truncated, false);
  assert.ok(Array.isArray(payload.previewRows));
  assert.equal(payload.table, undefined, 'the table itself is stripped before serialising');
  assert.deepEqual(
    Object.keys(payload).sort(),
    ['columns', 'previewRows', 'rowCount', 'truncated'],
    'the tool result carries the summary shape only',
  );
});

test('an invalid submission is handed back to the model, which can repair it', async () => {
  const llm = scriptedLlm([
    { toolCalls: [{ id: 'c1', name: 'submit_spec', args: { chart: { type: 'sankey' }, encodings: { x: { field: 'a' }, y: { field: 'b' } } } }] },
    { toolCalls: [SUBMIT] },
  ]);

  const outcome = await runAgentLoop(loopOptions(llm));

  assert.equal(outcome.spec.chart.type, 'bar');
  const firstToolMessage = outcome.messages.find((m) => m.role === 'tool');
  assert.deepEqual(JSON.parse(firstToolMessage?.content ?? '{}'), {
    accepted: false,
    errors: ["chart.type 'sankey' is not supported yet; supported types are bar, line, pie"],
  });
  assert.ok(outcome.warnings.some((w) => w.includes('submit_spec')));
});

test('a failing tool becomes a tool result, not a crash', async () => {
  const llm = scriptedLlm([
    {
      toolCalls: [
        {
          id: 'c0',
          name: 'run_query',
          args: { steps: [{ op: 'aggregate', group_by: [], measures: [{ field: 'revenue', agg: 'median', as: 'm' }] }] },
        },
      ],
    },
    { toolCalls: [RUN_QUERY] },
    { toolCalls: [SUBMIT] },
  ]);

  const outcome = await runAgentLoop(loopOptions(llm));

  const messages = outcome.messages.filter((m) => m.role === 'tool');
  assert.match(messages[0]?.content ?? '', /unknown aggregation 'median'/);
  assert.equal(outcome.spec.chart.type, 'bar');
});

test('a malformed emphasis rule is rejected at submit time so the model can fix it', async () => {
  const llm = scriptedLlm([
    {
      toolCalls: [
        {
          id: 'c1',
          name: 'submit_spec',
          args: {
            chart: { type: 'bar' },
            encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
            emphasis: [{ when: { op: 'top_k', field: 'revenue' }, style: { tone: 'gold' } }],
          },
        },
      ],
    },
    { toolCalls: [SUBMIT] },
  ]);

  const outcome = await runAgentLoop(loopOptions(llm));

  const first = JSON.parse(outcome.messages.find((m) => m.role === 'tool')?.content ?? '{}') as { errors?: string[] };
  assert.deepEqual(first.errors, [
    'emphasis[0].when.k must be an integer >= 1',
    'emphasis[0].style.tone must be "highlight" or "muted"',
  ]);
  assert.equal(outcome.spec.chart.type, 'bar', 'the repaired submission is accepted');
});

test('valid emphasis survives into the compiled spec', async () => {
  const llm = scriptedLlm([
    { toolCalls: [RUN_QUERY] },
    {
      toolCalls: [
        {
          id: 'c2',
          name: 'submit_spec',
          args: {
            ...SUBMIT.args,
            emphasis: [{ when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight' } }],
          },
        },
      ],
    },
  ]);

  const outcome = await runAgentLoop(loopOptions(llm));
  assert.deepEqual(outcome.spec.emphasis, [
    { when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight' } },
  ]);
});

test('a model that only talks is nudged once, then gives up with its own words', async () => {
  const llm = scriptedLlm([{ content: 'I cannot do that.' }, { content: 'I really cannot.' }]);

  await assert.rejects(
    () => runAgentLoop(loopOptions(llm)),
    (error: unknown) => {
      assert.ok(error instanceof AgentGaveUpError);
      assert.equal(error.explanation, 'I really cannot.');
      assert.equal(error.messages.filter((m) => m.role === 'tool').length, 0);
      return true;
    },
  );

  const calls = (llm as LlmClient & { calls: LlmCompleteRequest[] }).calls;
  assert.equal(calls.length, 2, 'exactly one nudge');
});

test('a bare spec in the content is accepted as a fallback', async () => {
  const llm = scriptedLlm([{ content: JSON.stringify(SUBMIT.args) }]);
  const outcome = await runAgentLoop(loopOptions(llm));
  assert.equal(outcome.spec.chart.type, 'bar');
  assert.deepEqual(outcome.spec.transform_plan?.steps, [], 'no run_query means an empty plan');
});

test('budget.maxRounds stops a runaway loop', async () => {
  const llm = scriptedLlm([{ toolCalls: [RUN_QUERY] }]);
  await assert.rejects(() => runAgentLoop({ ...loopOptions(llm), budget: { maxRounds: 3 } }), /maxRounds \(3\) exceeded/);
});

test('progress events describe every hop', async () => {
  const events: AgentEvent[] = [];
  const llm = scriptedLlm([{ toolCalls: [RUN_QUERY] }, { content: 'done', toolCalls: [SUBMIT] }]);

  await runAgentLoop(loopOptions(llm, (e) => events.push(e)));

  assert.deepEqual(
    events.map((e) => e.type),
    ['round_start', 'tool_call', 'tool_result', 'round_start', 'assistant_text', 'tool_call', 'tool_result'],
  );
});

test('createChartwright wires the loop to the compiler and returns a usable result', async () => {
  const llm = scriptedLlm([{ toolCalls: [RUN_QUERY] }, { toolCalls: [SUBMIT] }]);
  const chartwright = createChartwright({ llm });

  const result = await chartwright.ask({ query: 'revenue per region', rows });

  assert.equal(result.spec.chart.type, 'bar');
  assert.equal((result.options.chart as { type: string }).type, 'column');
  assert.equal(result.dataset.length, 2);
  assert.equal(result.sessionId.length > 0, true);
  assert.equal(result.warnings.length, 0);
  assert.ok(result.messages.length > 0, 'transcript is returned for follow-ups');
});

test('a follow-up carries prior messages into the next request', async () => {
  const llm = scriptedLlm([{ toolCalls: [RUN_QUERY] }, { toolCalls: [SUBMIT] }, { toolCalls: [SUBMIT] }]);
  const chartwright = createChartwright({ llm });

  const first = await chartwright.ask({ query: 'revenue per region', rows });
  await chartwright.ask({ query: 'now sort it the other way', rows, messages: first.messages, sessionId: first.sessionId });

  const thirdCall = (llm as LlmClient & { calls: LlmCompleteRequest[] }).calls[2];
  assert.ok(thirdCall, 'third request was made');
  assert.equal(thirdCall.messages[0]?.role, 'system');
  assert.equal(
    thirdCall.messages.filter((m) => m.role === 'system').length,
    1,
    'the system prompt is not duplicated on a follow-up',
  );
  assert.ok(
    thirdCall.messages.some((m) => m.role === 'user' && (m.content ?? '').includes('revenue per region')),
    'the previous user turn is present',
  );
  assert.ok(thirdCall.messages.some((m) => m.role === 'tool'), 'the previous tool exchange is present');
});
