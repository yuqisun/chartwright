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

test('end to end: "highlight the biggest" without the model knowing any values', async () => {
  // The model declares the condition; the compiler finds the maximum in all 800
  // rows. Nothing about this depends on what the model saw in a preview.
  const submitWithEmphasis: ToolCall = {
    id: 's2',
    name: 'submit_spec',
    args: {
      chart: { type: 'bar', title: 'Top counterparty', orientation: 'horizontal' },
      encodings: { x: { field: 'counterparty' }, y: { field: 'notional_usd' } },
      emphasis: [
        // "Fade the rest": every row satisfies the threshold, then the next rule
        // overrides the top three. (A top_k rule here would mute only the largest.)
        { when: { op: 'gte', field: 'notional_usd', value: 0 }, style: { tone: 'muted' } },
        { when: { op: 'top_k', k: 3, field: 'notional_usd' }, style: { tone: 'highlight', label: true } },
      ],
    },
  };

  const script: LlmCompleteResult[] = [{ toolCalls: [TOP_COUNTERPARTIES] }, { toolCalls: [submitWithEmphasis] }];
  let index = 0;
  const chartwright = createChartwright({
    llm: {
      async complete() {
        const reply = script[Math.min(index, script.length - 1)];
        index += 1;
        return reply ?? {};
      },
    },
  });

  const result = await chartwright.ask({ query: 'Highlight the three biggest counterparties', rows });

  const categories = (result.options.xAxis as { categories: string[] }).categories;
  const data = (result.options.series as Array<{ data: Array<number | { y: number; color?: string }> }>)[0]?.data ?? [];
  const styled = categories.map((category, i) => ({ category, datum: data[i] }));
  const highlighted = styled.filter((s) => typeof s.datum === 'object' && s.datum.color === '#e8590c').map((s) => s.category);
  const muted = styled.filter((s) => typeof s.datum === 'object' && s.datum.color === '#c9ced6').length;

  assert.equal(highlighted.length, 3, 'the top three carry the highlight tone');
  assert.deepEqual(highlighted, categories.slice(0, 3), 'and they are the first three of the descending table');
  assert.equal(muted, 7, 'the remaining seven bars are muted');
  assert.deepEqual(result.warnings, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Present mode, end to end, on the caller's own result.
//
// The whole point is the negative: nothing the model does can change these numbers or
// this order. So the assertions are about what did *not* happen — no plan, no
// re-aggregation, no reordering — as much as about the chart that came out.
// ─────────────────────────────────────────────────────────────────────────────

/** A consumer's own `GROUP BY booking_country ORDER BY trade_volume DESC`. */
const aggregated: Row[] = [
  { booking_country: 'GB', trade_volume: 82_842_348 },
  { booking_country: 'HK', trade_volume: 26_610_809 },
  { booking_country: 'SG', trade_volume: 11_420_317 },
];

const counterpartySummary = JSON.parse(
  readFileSync(join(HERE, '..', '..', '..', 'examples', 'react-highcharts', 'data', 'counterparty-summary.json'), 'utf8'),
) as Row[];

function scriptedRun(replies: LlmCompleteResult[]) {
  const requests: LlmCompleteRequest[] = [];
  let index = 0;
  return {
    requests,
    chartwright: createChartwright({
      llm: {
        async complete(request: LlmCompleteRequest) {
          requests.push(request);
          const reply = replies[Math.min(index, replies.length - 1)];
          index += 1;
          return reply ?? {};
        },
      },
      budget: { maxRounds: 6, maxToolCalls: 6 },
    }),
  };
}

const submitBar = (chart: Record<string, unknown>, extra: Record<string, unknown> = {}): LlmCompleteResult => ({
  content: 'A horizontal bar suits long labels.',
  toolCalls: [
    {
      id: 's1',
      name: 'submit_spec',
      args: {
        chart,
        encodings: { x: { field: 'booking_country' }, y: { field: 'trade_volume' } },
        ...extra,
      },
    },
  ],
});

test('end to end: present mode charts the caller result, in the caller order, unchanged', async () => {
  const { chartwright } = scriptedRun([
    // The model reaches for the one tool that could change the data. It must not get
    // one — and the trace has to show the attempt rather than hide it.
    { toolCalls: [{ id: 'q1', name: 'run_query', args: { steps: [{ op: 'sort', by: 'trade_volume', order: 'asc' }] } }] },
    {
      toolCalls: [
        {
          id: 's1',
          name: 'submit_spec',
          args: {
            chart: { type: 'bar', title: 'Traded volume by booking country', orientation: 'horizontal' },
            encodings: { x: { field: 'booking_country' }, y: { field: 'trade_volume' } },
            emphasis: [{ when: { op: 'top_k', k: 1, field: 'trade_volume' }, style: { tone: 'highlight', label: true } }],
          },
        },
      ],
    },
  ]);

  const result = await chartwright.ask({ query: 'which booking country traded the most?', rows: aggregated, present: true });

  assert.equal((result.options.chart as { type: string }).type, 'bar');
  assert.equal((result.options.yAxis as { reversed?: boolean }).reversed, true, 'row 0 belongs at the top');
  assert.deepEqual(
    (result.options.xAxis as { categories: string[] }).categories,
    ['GB', 'HK', 'SG'],
    'the caller order, untouched',
  );

  // Nothing was planned, because nothing may be.
  assert.deepEqual(result.spec.transform_plan?.steps, []);
  // And the dataset is their table — not a re-derivation of it.
  assert.deepEqual(result.dataset, aggregated);

  const data = (result.options.series as Array<{ data: Array<number | { y: number; color?: string }> }>)[0]?.data ?? [];
  assert.equal(typeof data[0], 'object', 'the top row is emphasised');
  assert.equal((data[0] as { color?: string }).color, '#e8590c');
  assert.equal(typeof data[1], 'number', 'and the others are left alone');

  // The attempt is in the trace, refused — not absent, which would pass for the wrong
  // reason, and not successful, which would be the whole bug.
  assert.deepEqual(
    result.trace.map((entry) => entry.tool),
    ['run_query', 'submit_spec'],
  );
  const attempt = result.trace[0]?.result as { error?: string; summary?: unknown };
  assert.match(attempt.error ?? '', /not available in this run/);
  assert.equal(attempt.summary, undefined, 'no query ran, so there is no summary to show');
  assert.equal(result.warnings.length, 1, 'and the caller is told the model tried');
  assert.match(result.warnings[0] ?? '', /run_query/);
});

test('end to end: the same data in ask mode may still be aggregated — the guarantee is the mode, not the rule', async () => {
  // The same numbers before the caller's own GROUP BY: two GB rows that have to be
  // added to become the single GB row present mode is handed. In ask mode the model is
  // allowed to do exactly that, and here it does — which is the contrast that shows the
  // guarantee lives in the mode rather than in a global rule about aggregation.
  const finerGrain: Row[] = [
    { booking_country: 'GB', asset_class: 'Equity', trade_volume: 51_000_000 },
    { booking_country: 'GB', asset_class: 'Fixed Income', trade_volume: 31_842_348 },
    { booking_country: 'HK', asset_class: 'Equity', trade_volume: 26_610_809 },
    { booking_country: 'SG', asset_class: 'Equity', trade_volume: 11_420_317 },
  ];

  const { chartwright } = scriptedRun([
    {
      toolCalls: [
        {
          id: 'q1',
          name: 'run_query',
          args: {
            steps: [
              {
                op: 'aggregate',
                group_by: ['booking_country'],
                measures: [{ field: 'trade_volume', agg: 'sum', as: 'trade_volume' }],
              },
            ],
          },
        },
      ],
    },
    {
      toolCalls: [
        {
          id: 's1',
          name: 'submit_spec',
          args: {
            chart: { type: 'bar' },
            encodings: { x: { field: 'booking_country' }, y: { field: 'trade_volume' } },
          },
        },
      ],
    },
  ]);

  // No `present: true`: the model is allowed to shape the table, and does.
  const result = await chartwright.ask({ query: 'volume by booking country', rows: finerGrain });

  assert.equal(result.spec.transform_plan?.steps?.length, 1, 'ask mode may plan');
  assert.equal((result.spec.transform_plan?.steps?.[0] as { op?: string }).op, 'aggregate');
  assert.deepEqual(
    result.dataset,
    aggregated,
    'and two GB rows became the one GB row the caller would have had',
  );
});

test('end to end: the order survives whichever way the caller sorted, and is not re-sorted', async () => {
  // The negative form of the guarantee: same rows, same scripted spec, two orders in,
  // two different charts out. Add an implicit category sort anywhere and this fails.
  const ascending: Row[] = [...aggregated].sort((a, b) => (a.trade_volume as number) - (b.trade_volume as number));
  const descending: Row[] = [...aggregated].sort((a, b) => (b.trade_volume as number) - (a.trade_volume as number));

  const chartFor = async (input: Row[]) => {
    const { chartwright } = scriptedRun([
      submitBar({ type: 'bar', orientation: 'horizontal' }, {}),
    ]);
    // The spec above names booking_country/trade_volume, which this table has.
    const result = await chartwright.ask({ query: 'volume by booking country', rows: input, present: true });
    return (result.options.xAxis as { categories: string[] }).categories;
  };

  const first = await chartFor(ascending);
  const second = await chartFor(descending);

  assert.deepEqual(first, ['SG', 'HK', 'GB'], 'as delivered, ascending');
  assert.deepEqual(second, ['GB', 'HK', 'SG'], 'as delivered, descending');
  assert.notDeepEqual(first, second, 'nothing re-sorted them into a shared order');
});

test('end to end: the example pre-aggregated table charts as it ships', async () => {
  // The dataset the example demo runs on, from the file, unmodified — including the
  // columns that carry no way back (an average, a distinct count, a maximum).
  const { chartwright } = scriptedRun([
    {
      toolCalls: [
        {
          id: 's1',
          name: 'submit_spec',
          args: {
            chart: { type: 'bar', title: 'Traded notional by counterparty', orientation: 'horizontal' },
            encodings: { x: { field: 'counterparty' }, y: { field: 'notional_usd' } },
            emphasis: [{ when: { op: 'top_k', k: 3, field: 'notional_usd' }, style: { tone: 'highlight' } }],
          },
        },
      ],
    },
  ]);

  const result = await chartwright.ask({ query: 'top counterparties by notional', rows: counterpartySummary, present: true });

  assert.equal(result.dataset.length, counterpartySummary.length);
  assert.deepEqual(result.dataset, counterpartySummary, 'the whole table, row for row');
  assert.deepEqual(
    (result.options.xAxis as { categories: string[] }).categories,
    counterpartySummary.map((row) => row.counterparty),
    'and in the order the caller ranked it',
  );
  assert.deepEqual(result.spec.transform_plan?.steps, []);
  assert.deepEqual(result.warnings, []);
});
