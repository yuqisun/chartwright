/**
 * Present mode's promises, from the outside: what the model is told, and what it can
 * get away with.
 *
 * The mode's guarantee is the tool list, so most of these are about the two ways a
 * model finds the edge of it — reaching for a tool that is not there, and submitting a
 * spec that cannot be drawn — and about the edge being explained rather than silent.
 *
 * Every run here carries a budget. A scripted client repeats its last reply when the
 * script runs out, so a submission that is refused every time would otherwise be an
 * endless loop: nothing bounds rejections except the caller's own limits.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createChartwright } from '../src/ask.ts';
import { AgentGaveUpError } from '../src/loop.ts';
import type { ChartSpec, ChatMessage, LlmCompleteResult, Row } from '../src/types.ts';

/** A caller's result at a finer grain than the chart the model picks. */
const rows: Row[] = [
  { booking_country: 'GB', asset_class: 'Equity', trade_volume: 51_000_000 },
  { booking_country: 'GB', asset_class: 'Fixed Income', trade_volume: 31_842_348 },
  { booking_country: 'HK', asset_class: 'Equity', trade_volume: 26_610_809 },
  { booking_country: 'SG', asset_class: 'Equity', trade_volume: 11_420_317 },
];

/** The same table, one row per x value: nothing collides. */
const cleanRows: Row[] = [
  { booking_country: 'GB', trade_volume: 82_842_348 },
  { booking_country: 'HK', trade_volume: 26_610_809 },
  { booking_country: 'SG', trade_volume: 11_420_317 },
];

let callId = 0;
const submit = (encodings: ChartSpec['encodings'], extra: Partial<ChartSpec> = {}): LlmCompleteResult => ({
  toolCalls: [
    {
      id: `s${(callId += 1)}`,
      name: 'submit_spec',
      args: { chart: { type: 'bar' }, encodings, ...extra } as ChartSpec,
    },
  ],
});

function chartwrightFor(replies: LlmCompleteResult[]) {
  let index = 0;
  return createChartwright({
    llm: {
      async complete() {
        const reply = replies[Math.min(index, replies.length - 1)];
        index += 1;
        return reply ?? {};
      },
    },
    budget: { maxRounds: 8, maxToolCalls: 8 },
  });
}

const toolResults = (messages: ChatMessage[]): string[] =>
  messages.filter((m) => m.role === 'tool').map((m) => m.content ?? '');

test('a model reaching for run_query is told why it cannot have one', async () => {
  const chartwright = chartwrightFor([
    { toolCalls: [{ id: 'r1', name: 'run_query', args: { steps: [{ op: 'limit', n: 1 }] } }] },
    submit({ x: { field: 'booking_country' }, y: { field: 'trade_volume' }, series: { field: 'asset_class' } }),
  ]);

  const result = await chartwright.ask({ query: 'volume by country', rows, present: true });

  const refusal = result.messages.find((m) => m.role === 'tool' && m.toolCallId === 'r1')?.content ?? '';
  assert.match(refusal, /nothing here can change the data/);
  assert.match(refusal, /rows you were given are final/);
  // It names the tools this run really has, and not the one it does not.
  assert.match(refusal, /describe_table/);
  assert.match(refusal, /preview_rows/);
  assert.ok(!refusal.includes("'run_query'"), 'the refusal does not offer run_query');
  // Three categories over four rows, because the series column splits them.
  assert.deepEqual((result.options.xAxis as { categories: string[] }).categories, ['GB', 'HK', 'SG']);
  assert.equal((result.options.series as unknown[]).length, 2, 'and the run still finished');
});

test('a submission that cannot be drawn is handed back, not thrown at the caller', async () => {
  const chartwright = chartwrightFor([
    submit({ x: { field: 'booking_country' }, y: { field: 'trade_volume' } }),
    submit({ x: { field: 'booking_country' }, y: { field: 'trade_volume' }, series: { field: 'asset_class' } }),
  ]);

  const result = await chartwright.ask({ query: 'volume by country', rows, present: true });

  const rejected = JSON.parse(toolResults(result.messages)[0] ?? '{}') as { accepted?: boolean; errors?: string[] };
  assert.equal(rejected.accepted, false, 'the first submission was refused');
  const [reason] = rejected.errors ?? [];
  // The advice names the column that actually tells the two rows apart, so the model
  // can act on it without going back to the data.
  assert.match(reason ?? '', /booking_country = 'GB'/);
  assert.match(reason ?? '', /'asset_class'/);
  assert.match(reason ?? '', /encodings\.series/);
  assert.match(reason ?? '', /cannot aggregate/);
  assert.ok(!/group_by/.test(reason ?? ''), 'and never offers an aggregate this run cannot do');

  assert.equal(result.dataset.length, 4, 'the repaired submission is charted over the caller rows');
  assert.deepEqual((result.options.xAxis as { categories: string[] }).categories, ['GB', 'HK', 'SG']);
  assert.equal((result.options.series as unknown[]).length, 2, 'split by the column the advice named');
  assert.ok(
    result.warnings.some((warning) => warning.includes('booking_country')),
    'the caller is told the model was refused once',
  );
});

test('when nothing distinguishes the rows, the advice says so instead of implying a fix', async () => {
  const duplicated: Row[] = [
    { country: 'GB', volume: 10 },
    { country: 'GB', volume: 20 },
  ];
  // The model cannot repair this one, so it gives up — and the reason it was given is
  // in the transcript.
  const chartwright = chartwrightFor([
    submit({ x: { field: 'country' }, y: { field: 'volume' } }),
    { content: 'I cannot chart that.' },
    { content: 'I really cannot.' },
  ]);

  await assert.rejects(
    () => chartwright.ask({ query: 'volume by country', rows: duplicated, present: true }),
    (error: unknown) => {
      assert.ok(error instanceof AgentGaveUpError);
      const refusal = toolResults(error.messages)[0] ?? '';
      assert.match(refusal, /No other column tells those rows apart/);
      assert.match(refusal, /unique for every row/);
      return true;
    },
  );
});

test('an encoding over a column the table does not have is refused at submit time, in either mode', async () => {
  for (const present of [true, false]) {
    const chartwright = chartwrightFor([
      submit({ x: { field: 'booking_country' }, y: { field: 'revenue_typo' } }),
      submit({ x: { field: 'booking_country' }, y: { field: 'trade_volume' } }),
    ]);

    const result = await chartwright.ask({ query: 'volume by country', rows: cleanRows, present });

    const rejected = JSON.parse(toolResults(result.messages)[0] ?? '{}') as { accepted?: boolean; errors?: string[] };
    assert.equal(rejected.accepted, false, `present=${present}: refused rather than thrown`);
    // The compiler's message passes through as-is: it names the field and lists what
    // the plan did produce.
    assert.match(rejected.errors?.[0] ?? '', /revenue_typo.*is not in the produced table/);
    assert.equal(result.dataset.length, 3, `present=${present}: the repair is charted`);
  }
});

test('present mode never adopts a plan, whatever the model puts in the submission', async () => {
  const chartwright = chartwrightFor([
    submit(
      { x: { field: 'booking_country' }, y: { field: 'trade_volume' }, series: { field: 'asset_class' } },
      // The model is not supposed to send this; if it does, it is still not the plan.
      { transform_plan: { steps: [{ op: 'sort', by: 'trade_volume', order: 'desc' }] } },
    ),
  ]);

  const result = await chartwright.ask({ query: 'volume by country', rows, present: true });

  assert.deepEqual(result.spec.transform_plan?.steps, [], 'the plan comes from run_query, and there is none');
  assert.deepEqual(result.dataset, rows, 'so the chart is the caller rows, untouched');
});

test('a follow-up in present mode cannot inherit a plan from an earlier ask-mode turn', async () => {
  const askTurn = chartwrightFor([
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
    submit({ x: { field: 'booking_country' }, y: { field: 'trade_volume' } }),
  ]);
  const first = await askTurn.ask({ query: 'volume by country', rows });
  assert.equal(first.spec.transform_plan?.steps?.length, 1, 'the ask-mode turn has a plan');

  const presentTurn = chartwrightFor([
    submit({ x: { field: 'booking_country' }, y: { field: 'trade_volume' }, series: { field: 'asset_class' } }),
  ]);
  const second = await presentTurn.ask({
    query: 'now by asset class',
    rows,
    present: true,
    messages: first.messages,
  });

  assert.deepEqual(second.spec.transform_plan?.steps, [], 'the earlier plan does not come back');
  assert.deepEqual(second.dataset, rows, 'and the chart is the caller rows, in the caller order');
});

test('an unaggregated table in ask mode is repaired by the model, not thrown at the caller', async () => {
  const chartwright = chartwrightFor([
    submit({ x: { field: 'booking_country' }, y: { field: 'trade_volume' } }),
    {
      toolCalls: [
        {
          id: 'q2',
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
    submit({ x: { field: 'booking_country' }, y: { field: 'trade_volume' } }),
  ]);

  const result = await chartwright.ask({ query: 'volume by country', rows });

  const refusal = JSON.parse(toolResults(result.messages)[0] ?? '{}') as { errors?: string[] };
  assert.match(refusal.errors?.[0] ?? '', /Add an aggregate step/, 'ask mode is told the remedy it has');
  assert.deepEqual(
    result.dataset.map((r) => r.trade_volume),
    [82_842_348, 26_610_809, 11_420_317],
    'and the aggregated table is what got charted',
  );
});
