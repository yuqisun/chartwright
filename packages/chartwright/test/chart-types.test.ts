/**
 * The chart-type declaration, and everything derived from it.
 *
 * Why this file exists: the list of supported types used to be written out in
 * eleven places across five files — the gate, two HTTP-shaped schema spots, two
 * tool descriptions, a prompt rule, a test's pinned string and three documents.
 * Adding a type meant finding all of them, and missing one failed in a different
 * way each time (`docs/spec-extension-plan.md` 搂Evidence). The declaration is now
 * the source, and these tests are what keep it the source.
 *
 * The last two tests are the interesting ones:
 *
 *   - a *mapping decision* test, so a declared type without a decided Highcharts
 *     type fails here rather than rendering something bogus (`donut` used to emit
 *     `chart.type = 'donut'`, which Highcharts does not have, and nothing noticed);
 *   - a *golden* test against output captured before the declaration existed, which
 *     is the acceptance criterion for P0a: byte-identical options.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CHART_TYPES, CHART_TYPE_NAMES, isChartType } from '../src/compile/chart-types.ts';
import { compileToHighcharts } from '../src/compile/index.ts';
import { runAgentLoop } from '../src/loop.ts';
import { buildToolDefs, createToolHandlers, TOOL_DEFS } from '../src/tools.ts';
import { GOLDEN_CASES } from './fixtures/golden-specs.ts';
import type { ChartSpec, ChatMessage, LlmClient, LlmCompleteRequest, LlmCompleteResult, Row } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));

const rows: Row[] = [
  { region: 'East', revenue: 250 },
  { region: 'West', revenue: 80 },
];

/** A client that replays scripted replies, repeating the last one when exhausted. */
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

/**
 * Runs a scripted sequence of submissions.
 *
 * A run needs a submission that is *accepted* to finish: the loop imposes no round
 * limit unless the caller sets `budget.maxRounds` (only a warning past 12 rounds, by
 * design — see the roadmap's "limits on by default" refusal), so a scripted model that
 * only ever repeats an invalid submission never terminates. Tests here either script a
 * repair after the refusal, as the loop's own tests do, or submit something valid.
 */
const VALID_TREE = { chart: { type: 'bar' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } };

async function runSubmissions(submissions: unknown[]) {
  const handlers = createToolHandlers({ rows });
  return runAgentLoop({
    llm: scriptedLlm(
      submissions.map((args, index) => ({ toolCalls: [{ id: `c${index + 1}`, name: 'submit_spec', args }] })),
    ),
    messages: [{ role: 'user', content: 'chart it' }] as ChatMessage[],
    tools: TOOL_DEFS,
    runTool: (name: string, args: unknown) => {
      const handler = handlers[name];
      if (!handler) throw new Error(`unknown tool '${name}'`);
      return handler(args);
    },
  });
}

test('the declaration is the source of the supported set', () => {
  assert.deepEqual([...CHART_TYPE_NAMES], ['bar', 'line', 'pie']);
  assert.equal(isChartType('bar'), true);
  assert.equal(isChartType('sankey'), false, 'a type nobody declared is not supported');

  for (const name of CHART_TYPE_NAMES) {
    const declaration = CHART_TYPES[name];
    assert.ok(declaration.kind, `${name} declares which model shape builds it`);
    assert.ok(declaration.required.length > 0, `${name} declares which channels are required`);
    assert.equal(typeof declaration.allowsDuplicateCategories, 'boolean', `${name} declares its collision policy`);
  }
});

test('the submit schema offers exactly the declared types, in declaration order', () => {
  const submit = buildToolDefs('ask').find((tool) => tool.name === 'submit_spec');
  const chartProperties = (submit?.parameters as { properties: { chart: { properties: { type: { enum: string[] } } } } })
    .properties.chart.properties;
  assert.deepEqual(chartProperties.type.enum, [...CHART_TYPE_NAMES]);
});

test('both tool descriptions list the declared types', () => {
  const expected = CHART_TYPE_NAMES.join(' | ');
  for (const mode of ['ask', 'present'] as const) {
    const submit = buildToolDefs(mode).find((tool) => tool.name === 'submit_spec');
    assert.ok(
      submit?.description.includes(expected),
      `the ${mode} description must name the types it accepts (expected "${expected}")`,
    );
  }
});

test('required channels are declared per type, and the validator enforces the declaration', async () => {
  for (const name of CHART_TYPE_NAMES) {
    assert.deepEqual([...CHART_TYPES[name].required], ['x', 'y'], `${name} requires x and y today`);
  }

  const outcome = await runSubmissions([{ chart: { type: 'bar' }, encodings: { x: { field: 'region' } } }, VALID_TREE]);
  const toolMessage = outcome.messages.find((message) => message.role === 'tool');
  assert.deepEqual(JSON.parse(toolMessage?.content ?? '{}'), {
    accepted: false,
    errors: ['encodings.y.field is required'],
  });
  assert.equal(outcome.spec.chart.type, 'bar', 'and the model can repair it in the same run');
});

test('a refusal names the declared types, in both the loop and the compiler', async () => {
  const expected = CHART_TYPE_NAMES.join(', ');

  const outcome = await runSubmissions([
    { chart: { type: 'sankey' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
    VALID_TREE,
  ]);
  const toolMessage = outcome.messages.find((message) => message.role === 'tool');
  assert.deepEqual(JSON.parse(toolMessage?.content ?? '{}'), {
    accepted: false,
    errors: [`chart.type 'sankey' is not supported yet; supported types are ${expected}`],
  });

  assert.throws(
    () => compileToHighcharts({ chart: { type: 'sankey' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } }, rows),
    new RegExp(`Supported: ${expected}`),
    'the compiler names the same set, from the same declaration',
  );
});

/**
 * The mapping decision.
 *
 * The neutral name is passed straight through to Highcharts unless a backend maps
 * it, so a declared type whose name Highcharts does not have would emit a `chart.type`
 * that silently fails to render. This test is the gate: every declared type needs an
 * entry here, and a new type fails until someone decides what it draws as.
 */
const MAPPING: Array<{ declared: string; why: string; spec: ChartSpec; want: string }> = [
  {
    declared: 'bar',
    why: 'a vertical bar is a Highcharts column',
    spec: { chart: { type: 'bar' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
    want: 'column',
  },
  {
    declared: 'bar',
    why: 'a horizontal bar keeps the name and reverses the category axis',
    spec: { chart: { type: 'bar', orientation: 'horizontal' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
    want: 'bar',
  },
  {
    declared: 'line',
    why: 'the neutral name and the library name coincide',
    spec: { chart: { type: 'line' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
    want: 'line',
  },
  {
    declared: 'pie',
    why: 'the neutral name and the library name coincide',
    spec: { chart: { type: 'pie' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
    want: 'pie',
  },
];

test('every declared type has a decided Highcharts type', () => {
  for (const name of CHART_TYPE_NAMES) {
    assert.ok(
      MAPPING.some((entry) => entry.declared === name),
      `'${name}' is declared but has no mapping decision — add one to MAPPING in this test`,
    );
  }
});

test('each mapping decision is what the compiler actually emits', () => {
  for (const entry of MAPPING) {
    const { options } = compileToHighcharts(entry.spec, rows);
    assert.equal((options.chart as { type: string }).type, entry.want, `${entry.declared}: ${entry.why}`);
  }
});

/**
 * The silent-drop trap (`docs/spec-extension-plan.md` 搂5.3, risk R2).
 *
 * `validateSpec` assembles the spec from the fields it reads, so a property the
 * schema offers but the assembler does not read is dropped without an error: the
 * model submits successfully and the chart quietly lacks the feature. The first
 * assertion is the guard; the second documents the whitelist so that a change to it
 * is a deliberate change.
 */
test('every property the submit schema declares survives into the compiled spec', async () => {
  const outcome = await runSubmissions([{
    chart: { type: 'bar', title: 'Revenue', orientation: 'horizontal' },
    encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
    emphasis: [{ when: { op: 'top_k', field: 'revenue', k: 1 }, style: { tone: 'highlight' } }],
  }]);

  assert.equal(outcome.spec.chart.title, 'Revenue');
  assert.equal(outcome.spec.chart.orientation, 'horizontal');
  assert.deepEqual(outcome.spec.encodings.y, { field: 'revenue' });
  assert.equal(outcome.spec.emphasis?.length, 1);
});

test('a property the schema does not declare does not survive — and does not warn either', async () => {
  const outcome = await runSubmissions([{
    chart: { type: 'bar', stacking: 'percent' },
    axes: { x: { kind: 'linear' } },
    encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
  }]);

  const spec = outcome.spec as unknown as Record<string, unknown>;
  assert.equal(spec.axes, undefined, 'an undeclared property is dropped, not carried');
  assert.equal((outcome.spec.chart as unknown as Record<string, unknown>).stacking, undefined);
  assert.deepEqual(outcome.warnings, [], 'and nothing warns about it — which is why this needs a test');
});

/**
 * The acceptance criterion for this refactor.
 *
 * `options-golden.json` was captured from the compiler *before* the declaration
 * existed, by `spike/capture-golden.ts`. Any byte of difference is a behaviour change
 * hiding inside a refactor, and the case's own `why` line says what the case covers.
 */
test('the existing types compile byte-identically to the pre-refactor capture', () => {
  const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'options-golden.json'), 'utf8')) as Record<
    string,
    unknown
  >;

  for (const testCase of GOLDEN_CASES) {
    const { options, dataset, warnings } = compileToHighcharts(testCase.spec, testCase.rows);
    assert.deepEqual({ options, dataset, warnings }, fixture[testCase.name], `${testCase.name}: ${testCase.why}`);
  }
});

test('the golden set covers every declared type', () => {
  const covered = new Set(GOLDEN_CASES.map((testCase) => testCase.spec.chart.type));
  for (const name of CHART_TYPE_NAMES) {
    assert.ok(covered.has(name), `'${name}' is declared but no golden case covers it — add one, then recapture`);
  }
});
