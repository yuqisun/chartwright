/**
 * End-to-end run over the example's real 800-row post-trade dataset.
 *
 * The LLM is scripted, so this is deterministic and needs no credentials — but
 * everything else is the real pipeline: profile → tool calls → spec → compiler →
 * options with the data bound.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createChartwright } from '../src/ask.ts';
import type { LlmCompleteRequest, LlmCompleteResult, Row, ToolCall } from '../src/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', '..', '..', 'examples', 'react-highcharts', 'data', 'post-trade.json');
const rows = JSON.parse(readFileSync(DATA, 'utf8')) as Row[];

const TOP_COUNTERPARTIES: ToolCall = {
  id: 'q1',
  name: 'run_query',
  args: {
    steps: [
      {
        op: 'aggregate',
        group_by: ['counterparty'],
        measures: [{ field: 'notional_usd', agg: 'sum', as: 'notional_usd' }],
      },
      { op: 'sort', by: 'notional_usd', order: 'desc' },
      { op: 'limit', n: 10 },
    ],
  },
};

const SUBMIT: ToolCall = {
  id: 's1',
  name: 'submit_spec',
  args: {
    chart: { type: 'bar', title: 'Top 10 counterparties by traded notional', orientation: 'horizontal' },
    encodings: { x: { field: 'counterparty' }, y: { field: 'notional_usd' } },
  },
};

test('end to end: 800 real rows → tool calls → spec → Highcharts options', async () => {
  const calls: LlmCompleteRequest[] = [];
  const script: LlmCompleteResult[] = [
    { toolCalls: [{ id: 'd1', name: 'describe_table', args: {} }] },
    { toolCalls: [TOP_COUNTERPARTIES] },
    { content: 'A horizontal bar chart suits long names.', toolCalls: [SUBMIT] },
  ];
  let index = 0;

  const chartwright = createChartwright({
    llm: {
      async complete(req) {
        calls.push(req);
        const reply = script[Math.min(index, script.length - 1)];
        index += 1;
        return reply ?? {};
      },
    },
  });

  const result = await chartwright.ask({
    query: 'Which 10 counterparties have the largest traded notional?',
    rows,
  });

  // The chart: horizontal bars, ten categories, descending values.
  assert.equal((result.options.chart as { type: string }).type, 'bar');
  const series = result.options.series as Array<{ data: number[] }>;
  assert.equal(series.length, 1);
  assert.equal(series[0]?.data.length, 10);
  const values = series[0]?.data ?? [];
  assert.ok(
    values.every((v, i) => i === 0 || (values[i - 1] as number) >= v),
    'values arrive sorted descending',
  );

  // The dataset is the complete aggregate, not a preview.
  assert.equal(result.dataset.length, 10);
  assert.equal(result.trace.length, 3);

  // What the model saw: a profile, a small summary, and nothing else.
  const toolResults = result.messages.filter((m) => m.role === 'tool').map((m) => m.content ?? '');
  assert.equal(toolResults.length, 3);
  assert.ok((toolResults[0] as string).includes('"rowCount":800'));
  assert.ok((toolResults[1] as string).includes('"rowCount":10'));
  assert.ok(!(toolResults[1] as string).includes('"table"'));

  const promptTokens = calls[0]?.messages.map((m) => m.content ?? '').join('').length ?? 0;
  console.log(
    `\n  rows=${rows.length}  rounds=${calls.length}  trace=${result.trace.length}\n` +
      `  first prompt=${promptTokens} chars  profile result=${(toolResults[0] as string).length} chars  ` +
      `query summary=${(toolResults[1] as string).length} chars\n` +
      `  chart data points=${values.length}  top=${Math.round(values[0] as number)}`,
  );
});
