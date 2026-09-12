import assert from 'node:assert/strict';
import test from 'node:test';

import { createChartwright } from '../src/ask.ts';
import { applyColumnDescriptions, buildSystemPrompt, buildUserPrompt } from '../src/prompt.ts';
import { buildToolDefs, inferColumns, TOOL_DEFS } from '../src/tools.ts';
import type { LlmCompleteRequest, Row, ToolDef } from '../src/types.ts';

const names = (tools: ToolDef[]) => tools.map((tool) => tool.name);

/**
 * The vocabulary of the transform DSL.
 *
 * If any of it appears in a present-mode tool definition, the mode's guarantee
 * has a hole in it: the model has been told about a way to change the caller's
 * table. Quoted, because these strings appear in schemas as JSON keys and enum
 * values — `describe_table`'s "Returns aggregates only" is prose about a summary,
 * not an operation, and must not trip this.
 *
 * `"limit"` is deliberately absent: a preview tool bounds its own preview with a
 * `limit`, and that cannot change the charted data.
 */
const DSL_VOCABULARY = [
  '"run_query"',
  '"steps"',
  '"group_by"',
  '"measures"',
  '"aggregate"',
  '"filter"',
  '"sort"',
  '"derive"',
  '"binTime"',
];

test('ask mode offers exactly the tools that can change the table', () => {
  assert.deepEqual(names(buildToolDefs('ask')), ['describe_table', 'run_query', 'submit_spec']);
});

test('present mode offers exactly the tools that cannot', () => {
  assert.deepEqual(names(buildToolDefs('present')), ['describe_table', 'preview_rows', 'submit_spec']);
});

test('TOOL_DEFS stays the ask-mode list, for callers who import it directly', () => {
  assert.deepEqual(names(TOOL_DEFS), names(buildToolDefs('ask')));
});

test('no present-mode tool definition mentions the transform DSL', () => {
  const serialized = JSON.stringify(buildToolDefs('present'));
  for (const word of DSL_VOCABULARY) {
    assert.ok(!serialized.includes(word), `a present-mode tool definition mentions ${word}`);
  }
});

test('the ask-mode prompt sends the model to run_query, and the tool is there', () => {
  const prompt = buildSystemPrompt('ask');
  assert.match(prompt, /run_query/);
  assert.ok(names(buildToolDefs('ask')).includes('run_query'));
});

test('the present-mode prompt never names a capability the model does not have', () => {
  const prompt = buildSystemPrompt('present');
  // Identifiers, not verbs. The prompt deliberately *names* the operations it
  // forbids ("do not aggregate, filter, ..."), because that is what tells the
  // model what "final" means. What it must never do is point at a tool or a plan
  // schema it was not given.
  for (const identifier of ['run_query', 'group_by', 'measures', 'transform_plan', 'steps']) {
    assert.ok(!prompt.includes(identifier), `the present-mode prompt refers to ${identifier}`);
  }
  assert.match(prompt, /no tool that could/i, 'and it says why those operations are out of reach');
});

test('the present-mode prompt states the contract: these rows, this order', () => {
  const prompt = buildSystemPrompt('present');
  assert.match(prompt, /rows are final/i);
  assert.match(prompt, /order/i);
  assert.match(prompt, /submit_spec/);
  // It still asks for the things the model is allowed to decide.
  assert.match(prompt, /describe_table/);
  assert.match(prompt, /emphasis/);
});

test('omitting the mode means ask — the default does not change behaviour', () => {
  assert.equal(buildSystemPrompt(), buildSystemPrompt('ask'));
});

test('neither prompt claims the model never sees the data — because it can preview rows', () => {
  // Pinned deliberately. "The model never saw these rows" was true enough to be
  // written down for a while and stopped being true when `preview_rows` arrived, and
  // it will stop being true again the moment anyone widens the preview. The honest
  // claim is about the table as a payload, not about any row ever reaching the model.
  for (const mode of ['ask', 'present'] as const) {
    const prompt = buildSystemPrompt(mode);
    assert.ok(!/never (receives|sees) (your )?rows/i.test(prompt), `${mode}: claims rows never reach the model`);
    assert.ok(!/complete table stays/i.test(prompt), `${mode}: claims the model is shown nothing of the table`);
    assert.match(prompt, /first rows of a table when you ask to preview them/, `${mode}: states what it does get`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Optional descriptions. The caller may know something about a column that the
// values cannot show — that `fill_rate` is a ratio, that an all-digit `trade_id`
// is an identifier. It is *optional* in the strict sense: a caller that says
// nothing must get the prompt it got before this existed, byte for byte.
// ─────────────────────────────────────────────────────────────────────────────

const descriptionRows: Row[] = [
  { booking_country: 'GB', fill_rate: 0.62 },
  { booking_country: 'HK', fill_rate: 0.58 },
];

test('without descriptions the user prompt is byte-identical to what it has always been', () => {
  const prompt = buildUserPrompt('How much revenue per region?', {
    rowCount: 2,
    columns: [
      { name: 'region', type: 'string' },
      { name: 'revenue', type: 'number' },
    ],
  });

  assert.equal(
    prompt,
    [
      'Request:',
      'How much revenue per region?',
      '',
      'Dataset:',
      '{"rowCount":2,"columns":[{"name":"region","type":"string"},{"name":"revenue","type":"number"}]}',
    ].join('\n'),
    'a pinned literal on purpose: adding descriptions must not move this by a byte',
  );
});

test('the dataset description and each column description reach the prompt where they belong', () => {
  const prompt = buildUserPrompt('Fill rate by booking country', {
    rowCount: 2,
    dataDescription: 'One row per booking country, already aggregated from the execution feed.',
    columns: [
      { name: 'booking_country', type: 'string', description: 'ISO country code of the booking entity.' },
      { name: 'fill_rate', type: 'number', description: 'Filled / ordered quantity. A ratio, not additive.' },
    ],
  });

  // The payload is one line of its own; the sentence about provenance follows it.
  const jsonLine = prompt.split('\n').find((line) => line.startsWith('{"rowCount"')) ?? '{}';
  const payload = JSON.parse(jsonLine) as {
    description?: string;
    columns: Array<{ name: string; description?: string }>;
  };

  assert.equal(payload.description, 'One row per booking country, already aggregated from the execution feed.');
  assert.equal(payload.columns[0]?.description, 'ISO country code of the booking entity.');
  assert.equal(payload.columns[1]?.description, 'Filled / ordered quantity. A ratio, not additive.');
  // And it says where they came from, so the model trusts them over a guess.
  assert.match(prompt, /written by the caller/i);
  assert.match(prompt, /authoritative/i);
});

test('declared descriptions are merged onto inferred columns by name', () => {
  const merged = applyColumnDescriptions(inferColumns(descriptionRows), [
    { name: 'fill_rate', type: 'string', description: 'Actually a ratio the caller stores as text.' },
    { name: 'booking_country', description: 'ISO country code.' },
  ]);

  assert.deepEqual(merged, [
    { name: 'booking_country', type: 'string', description: 'ISO country code.' },
    { name: 'fill_rate', type: 'string', description: 'Actually a ratio the caller stores as text.' },
  ]);
});

test('a declaration for a column that does not exist is ignored, not invented', () => {
  const inferred = inferColumns(descriptionRows);
  const merged = applyColumnDescriptions(inferred, [
    { name: 'ghost_column', type: 'string', description: 'This column is not in the rows.' },
  ]);

  assert.deepEqual(merged, inferred, 'the declared column is not added to the table');
  assert.equal(merged.length, 2);
});

test('no declarations at all leaves the columns exactly as inferred', () => {
  const inferred = inferColumns(descriptionRows);
  assert.deepEqual(applyColumnDescriptions(inferred), inferred);
  assert.deepEqual(applyColumnDescriptions(inferred, []), inferred);
});

test('ask() puts the caller declarations into the prompt the model receives', async () => {
  const calls: LlmCompleteRequest[] = [];
  const chartwright = createChartwright({
    llm: {
      async complete(request: LlmCompleteRequest) {
        calls.push(request);
        return {
          toolCalls: [
            {
              id: 's1',
              name: 'submit_spec',
              args: {
                chart: { type: 'bar' },
                encodings: { x: { field: 'booking_country' }, y: { field: 'fill_rate' } },
              },
            },
          ],
        };
      },
    },
  });

  await chartwright.ask({
    query: 'fill rate by booking country',
    rows: descriptionRows,
    dataDescription: 'Already aggregated by our own query.',
    columns: [
      { name: 'fill_rate', description: 'A ratio, not additive.' },
      { name: 'ghost_column', description: 'Ignored: not in the rows.' },
    ],
  });

  const userPrompt = calls[0]?.messages.find((m) => m.role === 'user')?.content ?? '';
  assert.match(userPrompt, /Already aggregated by our own query\./);
  assert.match(userPrompt, /A ratio, not additive\./);
  assert.ok(!userPrompt.includes('ghost_column'), 'a column that is not in the rows is not described to the model');
});
