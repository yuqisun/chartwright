import assert from 'node:assert/strict';
import test from 'node:test';

import { createChartwright } from '../src/ask.ts';
import { AgentGaveUpError, runAgentLoop } from '../src/loop.ts';
import { buildToolDefs, createToolHandlers, TOOL_DEFS } from '../src/tools.ts';
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
  assert.deepEqual(outcome.trace[1]?.result, { accepted: true }, 'the submission records its own outcome');
  assert.equal(typeof outcome.trace[1]?.ms, 'number', 'and how long it took, like every other entry');
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

test('budget.maxToolCalls also stops a runaway loop', async () => {
  // The model keeps asking for queries and never submits.
  const llm = scriptedLlm([{ toolCalls: [RUN_QUERY] }]);
  await assert.rejects(
    () => runAgentLoop({ ...loopOptions(llm), budget: { maxToolCalls: 2 } }),
    /maxToolCalls \(2\) exceeded/,
  );
});

test('maxToolCalls counts submissions too, so a model cannot loop on validation errors forever', async () => {
  const llm = scriptedLlm([
    { toolCalls: [{ id: 'b1', name: 'submit_spec', args: { chart: { type: 'nope' }, encodings: { x: { field: 'a' }, y: { field: 'b' } } } }] },
  ]);
  await assert.rejects(
    () => runAgentLoop({ ...loopOptions(llm), budget: { maxToolCalls: 3 } }),
    /maxToolCalls \(3\) exceeded/,
  );
});

test('progress events describe every hop', async () => {
  const events: AgentEvent[] = [];
  const llm = scriptedLlm([{ toolCalls: [RUN_QUERY] }, { content: 'done', toolCalls: [SUBMIT] }]);

  const outcome = await runAgentLoop(loopOptions(llm, (e) => events.push(e)));

  assert.deepEqual(
    events.map((e) => e.type),
    ['round_start', 'tool_call', 'tool_result', 'round_start', 'assistant_text', 'tool_call', 'tool_result'],
  );

  // The event and the trace entry describe the same hop, so they must not disagree:
  // the loop reads the clock once per call precisely so the two agree.
  const lastEvent = events[events.length - 1];
  assert.equal(lastEvent?.type, 'tool_result');
  assert.equal(
    (lastEvent as { ms?: number }).ms,
    outcome.trace[1]?.ms,
    'the reported duration is the one the trace records',
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

test('a refused argument is reported once, without stuttering the tool name', async () => {
  const llm = scriptedLlm([
    { toolCalls: [{ id: 'd1', name: 'describe_table', args: { sampleValues: 999 } }] },
    { toolCalls: [SUBMIT] },
  ]);

  const outcome = await runAgentLoop(loopOptions(llm));

  assert.equal(outcome.warnings.length, 1);
  const warning = outcome.warnings[0] ?? '';
  assert.match(warning, /describe_table: '/);
  assert.ok(!/describe_table: describe_table/.test(warning), `the name is not repeated: ${warning}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// The tool list is not a suggestion: a call the run never declared cannot reach
// a handler. Present mode's guarantee is structural rather than advisory, so a
// model that hallucinates `run_query` must not get one.
// ─────────────────────────────────────────────────────────────────────────────

/** Rows with distinct regions, so a chart of them is legal. */
const distinctRows: Row[] = [
  { region: 'East', revenue: 100 },
  { region: 'West', revenue: 80 },
  { region: 'North', revenue: 300 },
];

test('a tool call the run did not declare is refused, not executed', async () => {
  const llm = scriptedLlm([{ toolCalls: [RUN_QUERY] }, { toolCalls: [SUBMIT] }]);
  const executed: string[] = [];
  const handlers = createToolHandlers({ rows });

  const outcome = await runAgentLoop({
    llm,
    messages: [{ role: 'user', content: 'chart this table' }] as ChatMessage[],
    tools: buildToolDefs('present'),
    runTool: (name: string, args: unknown) => {
      executed.push(name);
      const handler = handlers[name];
      if (!handler) throw new Error(`unknown tool '${name}'`);
      return handler(args);
    },
  });

  assert.deepEqual(executed, [], 'no handler was reached');
  assert.deepEqual(outcome.steps, [], 'nothing was adopted as the plan');
  const refusal = outcome.messages.find((m) => m.role === 'tool' && m.toolCallId === RUN_QUERY.id);
  assert.match(refusal?.content ?? '', /run_query.*not available/s);
  assert.match(refusal?.content ?? '', /describe_table/, 'the refusal says what is available');
  assert.ok(
    outcome.warnings.some((w) => w.includes('run_query')),
    'the caller is told the model tried',
  );
  assert.equal(outcome.spec.chart.type, 'bar', 'the run still finished');
});

test('an undeclared call is traced as refused, not as having run', async () => {
  const llm = scriptedLlm([{ toolCalls: [RUN_QUERY] }, { toolCalls: [SUBMIT] }]);

  const outcome = await runAgentLoop({
    llm,
    messages: [{ role: 'user', content: 'chart this table' }] as ChatMessage[],
    tools: buildToolDefs('present'),
    runTool: () => {
      throw new Error('this handler must never run');
    },
  });

  // The attempt belongs in the trace — the caller should be able to see what the
  // model tried. What it must not do is look like a successful query.
  assert.deepEqual(
    outcome.trace.map((entry) => entry.tool),
    ['run_query', 'submit_spec'],
  );
  assert.match((outcome.trace[0]?.result as { error?: string }).error ?? '', /not available/);
  // The accepted submission records its outcome as well, so a reader of the trace
  // can tell the run finished rather than inferring it from a missing field.
  assert.deepEqual(outcome.trace[1]?.result, { accepted: true });
  assert.equal(typeof outcome.trace[1]?.ms, 'number');
  assert.equal(outcome.spec.chart.type, 'bar', 'and the run still finished');
});

test('a tool list without submit_spec is refused at the door, not left to spin', async () => {
  const llm = scriptedLlm([{ toolCalls: [RUN_QUERY] }]);

  await assert.rejects(
    () =>
      runAgentLoop({
        llm,
        messages: [{ role: 'user', content: 'chart this' }] as ChatMessage[],
        tools: TOOL_DEFS.filter((tool) => tool.name !== 'submit_spec'),
        runTool: () => ({}),
      }),
    /must include 'submit_spec'/,
    'submit_spec is how a run ends; without it the loop cannot finish by design',
  );
});

test('a plan in the transcript is not adopted when the run has no run_query', async () => {
  // A transcript from an earlier ask-mode turn, handed back to a present-mode run.
  const priorTurns: ChatMessage[] = [
    { role: 'user', content: 'revenue per region' },
    { role: 'assistant', toolCalls: [RUN_QUERY] },
    { role: 'tool', toolCallId: RUN_QUERY.id, name: 'run_query', content: '{"rowCount":2}' },
  ];
  const llm = scriptedLlm([{ toolCalls: [SUBMIT] }]);

  const outcome = await runAgentLoop({
    llm,
    messages: priorTurns,
    tools: buildToolDefs('present'),
    runTool: () => {
      throw new Error('this handler must never run');
    },
  });

  assert.deepEqual(outcome.steps, [], 'the old plan must not come back through the transcript');
  assert.deepEqual(outcome.spec.transform_plan?.steps, []);
});

test('ask({ present: true }) charts the caller rows, in the caller order, unchanged', async () => {
  const llm = scriptedLlm([{ toolCalls: [RUN_QUERY] }, { toolCalls: [SUBMIT] }]);
  const chartwright = createChartwright({ llm });

  const result = await chartwright.ask({ query: 'revenue by region', rows: distinctRows, present: true });

  assert.deepEqual(
    (llm.calls[0]?.tools ?? []).map((t) => t.name),
    ['describe_table', 'preview_rows', 'submit_spec'],
    'the model was offered no way to change the table',
  );
  assert.deepEqual(result.spec.transform_plan?.steps, []);
  assert.deepEqual(result.dataset, distinctRows, 'the dataset is the caller rows, untouched');
  assert.deepEqual(
    (result.options.xAxis as { categories: string[] }).categories,
    ['East', 'West', 'North'],
    'categories keep the order they arrived in',
  );
});

