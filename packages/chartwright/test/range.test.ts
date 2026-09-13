import assert from 'node:assert/strict';
import test from 'node:test';
import { compileToHighcharts } from '../src/compile/index.ts';
import { runAgentLoop } from '../src/loop.ts';
import { createToolHandlers, TOOL_DEFS } from '../src/tools.ts';
import type { ChatMessage, LlmClient, LlmCompleteRequest, LlmCompleteResult, Row } from '../src/types.ts';

test('arearange compiles with correct data format', () => {
  const rows: Row[] = [
    { month: 'Jan', low: 10, high: 25 },
    { month: 'Feb', low: 12, high: 28 },
    { month: 'Mar', low: 15, high: 30 },
  ];
  const { options } = compileToHighcharts(
    { chart: { type: 'arearange' }, encodings: { x: { field: 'month' }, low: { field: 'low' }, high: { field: 'high' } } },
    rows,
  );
  assert.equal((options.chart as Record<string, string>).type, 'arearange');
  const series = options.series as Array<{ data: Array<[number, number, number] | null> }>;
  assert.equal(series.length, 1);
  assert.deepEqual(series[0].data[0], [0, 10, 25]);
  assert.deepEqual(series[0].data[1], [1, 12, 28]);
  assert.deepEqual(series[0].data[2], [2, 15, 30]);
});

test('columnrange, errorbar, dumbbell, areasplinerange all compile', () => {
  const rows: Row[] = [{ x: 'A', low: 1, high: 5 }, { x: 'B', low: 2, high: 6 }];
  for (const type of ['columnrange', 'errorbar', 'dumbbell', 'areasplinerange'] as const) {
    const { options } = compileToHighcharts(
      { chart: { type }, encodings: { x: { field: 'x' }, low: { field: 'low' }, high: { field: 'high' } } },
      rows,
    );
    assert.equal((options.chart as Record<string, string>).type, type);
    const series = options.series as Array<{ data: unknown[] }>;
    assert.equal(series[0].data.length, 2);
  }
});

test('range type refuses duplicate categories', () => {
  const rows: Row[] = [
    { month: 'Jan', low: 10, high: 25 },
    { month: 'Jan', low: 12, high: 28 },
  ];
  assert.throws(
    () => compileToHighcharts(
      { chart: { type: 'arearange' }, encodings: { x: { field: 'month' }, low: { field: 'low' }, high: { field: 'high' } } },
      rows,
    ),
    /more than one row for category/,
  );
});

test('range type with series encoding', () => {
  const rows: Row[] = [
    { month: 'Jan', region: 'East', low: 10, high: 25 },
    { month: 'Feb', region: 'East', low: 12, high: 28 },
    { month: 'Jan', region: 'West', low: 8, high: 20 },
    { month: 'Feb', region: 'West', low: 9, high: 22 },
  ];
  const { options } = compileToHighcharts(
    {
      chart: { type: 'arearange' },
      encodings: { x: { field: 'month' }, low: { field: 'low' }, high: { field: 'high' }, series: { field: 'region' } },
    },
    rows,
  );
  const series = options.series as Array<{ name: string; data: Array<[number, number, number] | null> }>;
  assert.equal(series.length, 2);
  // First series (East) should have data for Jan and Feb
  assert.deepEqual(series[0].data[0], [0, 10, 25]);
  assert.deepEqual(series[0].data[1], [1, 12, 28]);
});

test('range type handles null values', () => {
  const rows: Row[] = [
    { month: 'Jan', low: 10, high: 25 },
    { month: 'Feb', low: null, high: null },
    { month: 'Mar', low: 15, high: 30 },
  ];
  const { options } = compileToHighcharts(
    { chart: { type: 'arearange' }, encodings: { x: { field: 'month' }, low: { field: 'low' }, high: { field: 'high' } } },
    rows,
  );
  const series = options.series as Array<{ data: Array<[number, number, number] | null> }>;
  assert.equal(series[0].data[0]?.[0], 0);
  assert.equal(series[0].data[1], null);
  assert.equal(series[0].data[2]?.[0], 2);
});

// --- Integration: range types through the agent loop (Critical bug regression) ---

function scriptedLlm(replies: LlmCompleteResult[]): LlmClient {
  let index = 0;
  return {
    async complete(_req: LlmCompleteRequest): Promise<LlmCompleteResult> {
      const reply = replies[Math.min(index, replies.length - 1)];
      index += 1;
      return reply ?? { content: '' };
    },
  };
}

test('arearange can be submitted through the agent loop', async () => {
  const rows: Row[] = [
    { month: 'Jan', low: 10, high: 25 },
    { month: 'Feb', low: 12, high: 28 },
  ];
  const handlers = createToolHandlers({ rows });
  const result = await runAgentLoop({
    llm: scriptedLlm([
      {
        toolCalls: [{
          id: 'c1',
          name: 'submit_spec',
          args: {
            chart: { type: 'arearange' },
            encodings: { x: { field: 'month' }, low: { field: 'low' }, high: { field: 'high' } },
          },
        }],
      },
    ]),
    messages: [{ role: 'user', content: 'show temperature ranges' }] as ChatMessage[],
    tools: TOOL_DEFS,
    runTool: (name: string, args: unknown) => {
      const handler = handlers[name];
      if (!handler) throw new Error(`unknown tool '${name}'`);
      return handler(args);
    },
  });

  assert.ok(result.spec, 'the agent loop accepted the range spec');
  assert.equal(result.spec.chart.type, 'arearange');
  assert.equal((result.spec.encodings as Record<string, unknown>).low !== undefined, true);
  assert.equal((result.spec.encodings as Record<string, unknown>).high !== undefined, true);
});

// --- Emphasis on range types ---

test('emphasis on arearange styles the correct datum', () => {
  const rows: Row[] = [
    { month: 'Jan', low: 10, high: 25 },
    { month: 'Feb', low: 12, high: 50 },
    { month: 'Mar', low: 15, high: 30 },
  ];
  const { options } = compileToHighcharts(
    {
      chart: { type: 'arearange' },
      encodings: { x: { field: 'month' }, low: { field: 'low' }, high: { field: 'high' } },
      emphasis: [{ when: { op: 'top_k', field: 'high', k: 1 }, style: { tone: 'highlight' } }],
    },
    rows,
  );
  const data = (options.series as Array<{ data: unknown[] }>)[0].data;
  // Feb (index 1) has the highest high value (50). It should be styled as an object.
  assert.equal(typeof data[1], 'object', 'Feb (highest high) is styled');
  assert.ok(!Array.isArray(data[1]), 'styled point is an object, not an array');
  // Jan and Mar should remain as arrays.
  assert.ok(Array.isArray(data[0]), 'Jan is unstyled array');
  assert.ok(Array.isArray(data[2]), 'Mar is unstyled array');
});
