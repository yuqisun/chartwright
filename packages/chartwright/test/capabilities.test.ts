/**
 * Capabilities: what the consumer's bundle can actually draw.
 *
 * 63 of Highcharts' 71 series types live in modules, so emitting options for a module
 * the consumer never loaded fails in *their* process, where no test of ours can see it
 * (`docs/spec-extension-plan.md` §5.2). The answer is a handshake: the consumer says
 * which types it can render, in this library's neutral vocabulary, and the model is only
 * ever offered what will actually work.
 *
 * Three properties matter more than the plumbing, and each has a test here:
 *
 *   - no capabilities means today's behaviour, unchanged;
 *   - the answer may be lazy and is asked for on every `ask`, because a real app
 *     code-splits its chart modules and the registry is a global mutable singleton;
 *   - an unknown name warns instead of shrinking the panel in silence, because a
 *     capability mismatch whose only symptom is "the model never picks heatmaps" is the
 *     worst bug report there is.
 *
 * Deliberately *not* here: a version range. §5.2 asks for one, but comparing a declared
 * Highcharts range needs per-type `since` data, which P1 adds with the rest of the
 * declaration. Accepting a `highcharts: '>=12'` option now and ignoring it would be the
 * same shape as `schema_version`, which this project already deleted for being a field
 * nothing reads.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createChartwright } from '../src/ask.ts';
import { CHART_TYPE_NAMES, resolveCapabilities } from '../src/compile/index.ts';
import { compileToHighcharts } from '../src/compile/index.ts';
import { buildToolDefs } from '../src/tools.ts';
import type { LlmClient, LlmCompleteRequest, LlmCompleteResult, Row, ToolDef } from '../src/types.ts';

const rows: Row[] = [
  { region: 'East', revenue: 250 },
  { region: 'West', revenue: 80 },
  { region: 'North', revenue: 120 },
];

const submit = (type: string) => ({ id: `c-${type}`, name: 'submit_spec', args: { chart: { type }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } } });

/** Records the tool panel it was offered on each call, and replays scripted submissions. */
function capturingLlm(types: string[]): LlmClient & { panels: ToolDef[][] } {
  const panels: ToolDef[][] = [];
  let index = 0;
  return {
    panels,
    async complete(req: LlmCompleteRequest): Promise<LlmCompleteResult> {
      if (req.tools) panels.push(req.tools);
      const type = types[Math.min(index, types.length - 1)] ?? 'bar';
      index += 1;
      return { toolCalls: [submit(type)] };
    },
  };
}

function submitSchema(tools: ToolDef[]): { enum: string[] } {
  const tool = tools.find((candidate) => candidate.name === 'submit_spec');
  const properties = (tool?.parameters as { properties: { chart: { properties: { type: { enum: string[] } } } } }).properties;
  return properties.chart.properties.type;
}

function submitDescription(tools: ToolDef[]): string {
  return tools.find((candidate) => candidate.name === 'submit_spec')?.description ?? '';
}

test('no capabilities offers every declared type, as before', () => {
  assert.deepEqual(submitSchema(buildToolDefs('ask')).enum, [...CHART_TYPE_NAMES]);
  assert.deepEqual(submitSchema(buildToolDefs('ask', undefined)).enum, [...CHART_TYPE_NAMES]);
});

test('a capable subset narrows the panel and its description', () => {
  const tools = buildToolDefs('ask', ['bar', 'line']);
  assert.deepEqual(submitSchema(tools).enum, ['bar', 'line']);
  const description = submitDescription(tools);
  assert.ok(description.includes('bar | line'), 'the description names the available types');
  assert.ok(!description.includes('pie'), 'and does not name the ones this app cannot draw');
});

test('an available type in a non-declaration order keeps the declared order', () => {
  assert.deepEqual(submitSchema(buildToolDefs('ask', ['line', 'bar'])).enum, ['bar', 'line']);
});

test('a type outside the available set is refused, and the refusal names the set', async () => {
  const llm = capturingLlm(['pie', 'bar']);
  const chartwright = createChartwright({ llm, capabilities: ['bar', 'line'] });

  const result = await chartwright.ask({ query: 'share by region', rows });

  const firstToolMessage = result.messages.find((message) => message.role === 'tool');
  assert.deepEqual(JSON.parse(firstToolMessage?.content ?? '{}'), {
    accepted: false,
    errors: ["chart.type 'pie' is not available in this app; available types are bar, line"],
  });
  assert.equal(result.spec.chart.type, 'bar', 'and the model repairs it in the same run');
});

test('a type the library does not declare is refused as unsupported, not as unavailable', async () => {
  const llm = capturingLlm(['sankey', 'bar']);
  const chartwright = createChartwright({ llm, capabilities: ['bar', 'line'] });

  const result = await chartwright.ask({ query: 'flows between venues', rows });

  const firstToolMessage = result.messages.find((message) => message.role === 'tool');
  assert.deepEqual(JSON.parse(firstToolMessage?.content ?? '{}'), {
    accepted: false,
    errors: [`chart.type 'sankey' is not supported yet; supported types are ${CHART_TYPE_NAMES.join(', ')}`],
  });
});

test('capabilities may be lazy, and are asked again on every request', async () => {
  const llm = capturingLlm(['bar']);
  let asked = 0;
  const chartwright = createChartwright({
    llm,
    capabilities: () => {
      asked += 1;
      return asked === 1 ? ['bar'] : ['bar', 'pie'];
    },
  });

  await chartwright.ask({ query: 'revenue', rows });
  await chartwright.ask({ query: 'revenue again', rows });

  assert.equal(asked, 2, 'a function is called per request, not once at construction');
  assert.deepEqual(submitSchema(llm.panels[0] ?? []).enum, ['bar']);
  assert.deepEqual(submitSchema(llm.panels[1] ?? []).enum, ['bar', 'pie'], 'the second ask sees the new route');
});

test('an async capability source is awaited', async () => {
  const llm = capturingLlm(['bar']);
  const chartwright = createChartwright({ llm, capabilities: async () => ['bar', 'line'] });
  await chartwright.ask({ query: 'revenue', rows });
  assert.deepEqual(submitSchema(llm.panels[0] ?? []).enum, ['bar', 'line']);
});

test('an unknown capability name warns and keeps what it can draw', async () => {
  const llm = capturingLlm(['bar']);
  const chartwright = createChartwright({ llm, capabilities: ['bar', 'heatmap'] });

  const result = await chartwright.ask({ query: 'revenue', rows });

  assert.deepEqual(submitSchema(llm.panels[0] ?? []).enum, ['bar'], 'the known name survives');
  assert.ok(
    result.warnings.some((warning) => warning.includes('heatmap')),
    `the unknown name is reported, not swallowed: ${JSON.stringify(result.warnings)}`,
  );
});

test('capabilities that resolve to nothing are refused up front', async () => {
  // A run whose panel is empty can never finish, so this is refused at the door rather
  // than discovered as an unwinnable loop. `resolveCapabilities` is async — a lazy source
  // may be too — so the refusal arrives as a rejection; `buildToolDefs` throws directly.
  await assert.rejects(resolveCapabilities([]), /no chart types are available/);
  await assert.rejects(
    resolveCapabilities(['heatmap']),
    /heatmap/,
    'and the message names what could not be resolved, so it is fixable',
  );
  assert.throws(() => buildToolDefs('ask', []), /no chart types are available/);
});

test('a per-request capability beats the configured default', async () => {
  const llm = capturingLlm(['pie']);
  const chartwright = createChartwright({ llm, capabilities: ['bar'] });

  const result = await chartwright.ask({ query: 'share', rows, capabilities: ['bar', 'pie'] });

  assert.deepEqual(submitSchema(llm.panels[0] ?? []).enum, ['bar', 'pie']);
  assert.equal(result.spec.chart.type, 'pie');
});

test('the compiler itself is not capability-gated', () => {
  // Gating belongs at the submit boundary, where a model is choosing. `compileToHighcharts`
  // is a pure function with no consumer context: a caller that writes specs by hand — or
  // replays an audited spec — must not be second-guessed by a panel it never saw.
  const { options } = compileToHighcharts(
    { chart: { type: 'pie' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
    rows,
  );
  assert.equal((options.chart as { type: string }).type, 'pie');
});
