/**
 * The chart-type declaration, and everything derived from it.
 *
 * Why this file exists: the list of supported types used to be written out in
 * eleven places across five files — the gate, two HTTP-shaped schema spots, two
 * tool descriptions, a prompt rule, a test's pinned string and three documents.
 * Adding a type meant finding all of them, and missing one failed in a different
 * way each time (`docs/spec-extension-plan.md` §Evidence). The declaration is now
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
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CHART_TYPES, CHART_TYPE_NAMES, isChartType, listChartTypes } from '../src/compile/chart-types.ts';
import { compileToHighcharts } from '../src/compile/index.ts';
import { runAgentLoop } from '../src/loop.ts';
import { buildToolDefs, createToolHandlers, TOOL_DEFS } from '../src/tools.ts';
import { GOLDEN_CASES } from './fixtures/golden-specs.ts';
import type { ChartSpec, ChatMessage, LlmClient, LlmCompleteRequest, LlmCompleteResult, Row } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));

const rows: Row[] = [
  // `desk` exists so a matrix case has a second categorical column to be its rows: a heatmap with
  // one dimension is a coloured bar chart, and the spec is refused for it.
  // `commission_bps` exists so the dual-axis combo schema sample has a field to reference (§3.4).
  { region: 'East', desk: 'Rates', revenue: 250, commission_bps: 3 },
  { region: 'West', desk: 'FX', revenue: 80, commission_bps: 7 },
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
  // The list is the declaration's keys, so this asserts the *relationship* rather than a
  // hand-written copy of it — a copy is the thing that used to drift.
  assert.deepEqual([...CHART_TYPE_NAMES], Object.keys(CHART_TYPES));
  for (const original of ['bar', 'line', 'pie']) {
    assert.ok(CHART_TYPE_NAMES.includes(original as never), `${original} is still declared`);
  }
  assert.equal(isChartType('bar'), true);
  assert.equal(isChartType('sankey'), false, 'a type nobody declared is not supported');

  for (const name of CHART_TYPE_NAMES) {
    const declaration = CHART_TYPES[name];
    assert.ok(declaration.kind, `${name} declares which model shape builds it`);
    assert.ok(declaration.required.length > 0, `${name} declares which channels are required`);
    assert.ok(Array.isArray(declaration.modifiers), `${name} declares its modifiers, even if the list is empty`);
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
    const declaration = CHART_TYPES[name];
    assert.ok(declaration.required.length > 0, `${name} requires something`);
    // Every required channel must be a channel the type declares it reads: a type that required a
    // channel it has no role for would be asking for something it cannot use.
    for (const channel of declaration.required) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(declaration.channels, channel),
        `${name} requires '${channel}' but does not say what it means`,
      );
    }
  }

  // The one type that is not x-and-y: a matrix needs both dimensions, and the validator says so
  // per channel rather than as a pair.
  assert.deepEqual([...CHART_TYPES.heatmap.required], ['x', 'series', 'y']);

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
  {
    declared: 'area',
    why: 'a filled line: the library calls it area too',
    spec: { chart: { type: 'area' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
    want: 'area',
  },
  {
    declared: 'spline',
    why: 'a smoothed line, same name',
    spec: { chart: { type: 'spline' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
    want: 'spline',
  },
  {
    declared: 'areaspline',
    why: 'smoothed and filled, same name',
    spec: { chart: { type: 'areaspline' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
    want: 'areaspline',
  },
  {
    declared: 'heatmap',
    why: 'the first matrix, and the first type whose name Highcharts rejects without a module',
    spec: {
      chart: { type: 'heatmap' },
      encodings: { x: { field: 'region' }, y: { field: 'revenue' }, series: { field: 'desk' } },
    },
    want: 'heatmap',
  },
  {
    declared: 'scatter',
    why: 'a point cloud with linear axes: the neutral name and the library name coincide',
    spec: { chart: { type: 'scatter' }, encodings: { x: { field: 'revenue' }, y: { field: 'commission_bps' } } },
    want: 'scatter',
  },
  {
    declared: 'bubble',
    why: 'a point cloud with size: the neutral name and the library name coincide',
    spec: {
      chart: { type: 'bubble' },
      encodings: { x: { field: 'revenue' }, y: { field: 'commission_bps' }, size: { field: 'revenue' } },
    },
    want: 'bubble',
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
 * The silent-drop trap (`docs/spec-extension-plan.md` §5.3, risk R2).
 *
 * `validateSpec` assembles the spec from the fields it reads, so a property the schema offers
 * but the assembler does not read is dropped without an error: the model submits successfully
 * and the chart quietly lacks the feature.
 *
 * The samples below are the gate. They are keyed exactly like the schema, and the test asserts
 * that correspondence, so **adding a property to the schema without adding a sample fails here**.
 * That is the only version of this check that keeps working as types are added: a test that
 * submitted the properties someone remembered to list would keep passing while the trap opened.
 */
const SCHEMA_SAMPLES = {
  encodings: {
    x: { field: 'region' },
    y: { field: 'revenue' },
    // The rows are never touched by this test: it is about the assembler keeping what the schema
    // offered, and the loop accepts a spec without compiling it (only `ask()` adds that check).
    y2: { field: 'commission_bps' },
    series: { field: 'currency' },
    size: { field: 'revenue' },
    low: { field: 'low_value' },
    high: { field: 'high_value' },
  },
  emphasis: [{ when: { op: 'top_k', field: 'revenue', k: 1 }, style: { tone: 'highlight' } }],
  axes: { x: { kind: 'linear' }, y: { min: 0, max: 100 }, y2: { min: 0, max: 50 } },
} as const;

/**
 * Chart-level samples, grouped by a type that can actually mean them.
 *
 * Two groups rather than one because a modifier is declared per type: a bar honours stacking and
 * a pie honours the hole, and neither honours the other — so a single submission cannot cover
 * them all, and pretending otherwise would mean shipping a spec the validator is right to refuse.
 * The coverage assertion below still requires the union to cover the schema exactly.
 */
const CHART_SAMPLES: Array<{ type: string; chart: Record<string, unknown>; why: string }> = [
  {
    type: 'bar',
    chart: { title: 'Revenue', orientation: 'horizontal', stacking: 'percent', polar: true, compact: true, type2: 'line' },
    why: 'a categorical type honours stacking, polar, compact and type2',
  },
  {
    type: 'pie',
    chart: { hole: 0.4 },
    why: 'a part-to-whole type honours the hole — and cannot mean stacking, which the validator refuses',
  },
];

function submitPropertiesOf(mode: 'ask' | 'present' = 'ask'): Record<string, { properties?: Record<string, unknown> }> {
  const submit = buildToolDefs(mode).find((tool) => tool.name === 'submit_spec');
  return (submit?.parameters as { properties: Record<string, { properties?: Record<string, unknown> }> }).properties;
}

test('the samples cover the schema exactly, at both levels', () => {
  const properties = submitPropertiesOf();
  assert.deepEqual(
    Object.keys(properties).sort(),
    ['axes', 'chart', 'emphasis', 'encodings'],
    'every top-level schema property needs a sample added below, and no sample may outlive its property',
  );
  assert.deepEqual(
    Object.keys(properties.chart?.properties ?? {}).sort(),
    [...new Set(['type', ...CHART_SAMPLES.flatMap((sample) => Object.keys(sample.chart))])].sort(),
    'chart.* needs samples too: this is where a new modifier lands, and where it would silently vanish',
  );
  assert.deepEqual(
    Object.keys(properties.encodings?.properties ?? {}).sort(),
    Object.keys(SCHEMA_SAMPLES.encodings).sort(),
    'and the channels',
  );
});

test('every property the submit schema declares survives into the compiled spec', async () => {
  for (const sample of CHART_SAMPLES) {
    const outcome = await runSubmissions([
      {
        chart: { type: sample.type, ...sample.chart },
        encodings: SCHEMA_SAMPLES.encodings,
        emphasis: SCHEMA_SAMPLES.emphasis,
        axes: SCHEMA_SAMPLES.axes,
      },
    ]);

    const spec = outcome.spec as unknown as {
      chart: Record<string, unknown>;
      encodings: Record<string, unknown>;
      emphasis?: unknown[];
      axes?: unknown;
    };
    for (const [key, value] of Object.entries(sample.chart)) {
      assert.deepEqual(spec.chart[key], value, `chart.${key} must survive the assembler (${sample.why})`);
    }
    for (const [channel, value] of Object.entries(SCHEMA_SAMPLES.encodings)) {
      assert.deepEqual(spec.encodings[channel], value, `encodings.${channel} must survive the assembler`);
    }
    assert.equal(spec.emphasis?.length, 1);
    assert.deepEqual(spec.axes, SCHEMA_SAMPLES.axes);
  }
});

test('a modifier the declared type cannot mean is refused, not ignored', async () => {
  // Roadmap item 3: a request the pipeline can see is unsatisfiable must make a sound. A pie has
  // no axis to stack along, so accepting this would draw an unstacked pie and say nothing.
  const outcome = await runSubmissions([
    { chart: { type: 'pie', stacking: 'percent' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
    { chart: { type: 'pie' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
  ]);

  const firstToolMessage = outcome.messages.find((message) => message.role === 'tool');
  const reported = JSON.parse(firstToolMessage?.content ?? '{}') as { accepted: boolean; errors: string[] };
  assert.equal(reported.accepted, false);
  assert.match(reported.errors.join(' '), /chart\.stacking is not something a 'pie' can mean/);
  assert.equal(outcome.spec.chart.type, 'pie', 'and the model repairs it in the same run');
});

test('a property the schema does not declare is dropped, silently — which is why samples exist', async () => {
  const outcome = await runSubmissions([
    {
      chart: { type: 'bar', legend: 'off' },
      axes: { z: { min: 0 } },
      encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
    },
  ]);

  const spec = outcome.spec as unknown as { chart: Record<string, unknown>; axes?: unknown };
  assert.equal(spec.axes, undefined, 'axes.z is not declared, so not even the axes object survives');
  assert.equal(spec.chart.legend, undefined, 'and an invented chart property is dropped');
  assert.deepEqual(outcome.warnings, [], 'nothing warns about it — the reason the sample test above exists');
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

/**
 * What a consumer needs to know before it can draw a type, and what makes the `modules` field
 * worth having.
 *
 * The library never imports Highcharts, so a type whose module the consumer has not loaded fails
 * at render time **in their process** — the one place no test here can look. The best this
 * repository can do is make the instruction true and checkable: every path a declaration names
 * must exist in the installed package. A typo would otherwise be a plausible-looking instruction
 * that breaks someone else's build.
 */
test('every module a declaration names exists in the installed Highcharts', () => {
  const repoRoot = join(here, '..', '..', '..');
  let checked = 0;

  for (const entry of listChartTypes()) {
    for (const modulePath of entry.modules) {
      const file = join(repoRoot, 'node_modules', `${modulePath}.js`);
      assert.ok(existsSync(file), `'${entry.name}' names '${modulePath}', which is not a file in node_modules`);
      checked += 1;
    }
  }

  assert.ok(checked > 0, 'at least one type needs a module, or this test is not testing anything');
});

test('listChartTypes reports the declaration, not a second copy of it', () => {
  const listed = listChartTypes();
  assert.deepEqual(
    listed.map((entry) => entry.name),
    [...CHART_TYPE_NAMES],
    'same order as the declaration, so the list a consumer prints matches what the library draws',
  );

  const heatmap = listed.find((entry) => entry.name === 'heatmap');
  assert.deepEqual(heatmap?.requires, ['x', 'series', 'y'], 'a matrix needs both dimensions and a measure');
  assert.deepEqual(heatmap?.honours, ['compact']);
  assert.deepEqual(heatmap?.modules, ['highcharts/modules/heatmap', 'highcharts/modules/coloraxis']);
  assert.equal(heatmap?.kind, 'matrix');

  // Core-only types are cheap for a consumer to adopt: nothing to load. When a type gains a
  // module, this assertion is where that becomes visible.
  assert.deepEqual(
    listed.filter((entry) => entry.modules.length > 0).map((entry) => entry.name),
    ['heatmap', 'bubble'],
  );
});
