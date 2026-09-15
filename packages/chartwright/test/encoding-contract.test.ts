/**
 * The channel-role contract, and the one failure that stays invisible without it.
 *
 * A neutral spec has one vocabulary for direction and another for data: `chart.orientation`
 * says which way the bars point, while `encodings.x` names the category and `encodings.y` the
 * numeric measure. Horizontal bars change the first and nothing about the second — a
 * Highcharts `bar` is an inverted `column`, so the inversion is visual and the channel roles
 * do not move (`backends/highcharts.ts` says the same thing where it reverses the axis).
 *
 * That was written down only in prose, and a real provider run read "horizontal" as a reason to
 * swap the data channels instead: `x = notional_usd`, `y = counterparty`. The spec was
 * schema-valid, so every gate passed — and then `Number('Northgate Capital Markets')` became
 * `NaN` inside `buildChartModel`, which JSON-serialises to `null`. Highcharts accepted the
 * options and drew axes, a title and *no marks at all*, with `warnings: []` to say it was fine.
 *
 * This is the failure the corpus test refuses to model: a chart with no data and a chart with
 * the wrong data must not be the same shape of outcome (`docs/roadmap.md`, item 3). So the
 * invariant is checked where the measure values are read, and the refusal names the column and
 * the channel — which is what the model needs to swap them back while it is still in the loop.
 *
 * Run: node --experimental-strip-types test/encoding-contract.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createChartwright } from '../src/ask.ts';
import { CHART_TYPES, CHANNEL_NAMES, compileToHighcharts } from '../src/compile/index.ts';
import { buildChartModel } from '../src/compile/model.ts';
import { buildSystemPrompt } from '../src/prompt.ts';
import { createSubmitValidator } from '../src/submit.ts';
import { buildToolDefs } from '../src/tools.ts';
import type { ChartSpec, Row } from '../src/types.ts';

/** The example's own pre-aggregated table: one text column and a row of numeric measures. */
const rows: Row[] = [
  { counterparty: 'Northgate Capital Markets', notional_usd: 1_382_020_048.56, avg_commission_bps: 4.24 },
  { counterparty: 'Halloway Partners', notional_usd: 751_227_032.27, avg_commission_bps: 5.1 },
  { counterparty: 'Fairhaven Securities', notional_usd: 696_177_894.22, avg_commission_bps: 6.02 },
];

const spec = (over: Pick<ChartSpec, 'chart' | 'encodings'>): ChartSpec => ({ schema_version: 1, ...over });

const REVERSED = spec({
  chart: { type: 'bar', title: 'Traded notional by counterparty', orientation: 'horizontal' },
  encodings: { x: { field: 'notional_usd' }, y: { field: 'counterparty' } },
});

// ─────────────────────────────────────────────────────────────────────────────
// The invariant: a measure channel carries numbers.
// ─────────────────────────────────────────────────────────────────────────────

test('a text column on a measure channel is refused, naming the column and the channel', () => {
  // The exact spec a real provider produced for "draw a horizontal bar chart by counterparty".
  assert.throws(
    () => buildChartModel(REVERSED, rows),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /'counterparty'/, 'names the column that is not a measure');
      assert.match(message, /encodings\.y/, 'names the channel it was put in');
      // The repair is a swap, so the message must not merely say "no".
      assert.match(message, /category/i);
      return true;
    },
  );
});

test('the refusal is symmetric: any channel whose role is a measure is checked', () => {
  // y2 (dual-axis combo) and size (bubble) are measures too. A rule that only guarded `y`
  // would leave the same silent nulls reachable through the other three channels.
  const y2Reversed = spec({
    chart: { type: 'bar' },
    encodings: { x: { field: 'counterparty' }, y: { field: 'notional_usd' }, y2: { field: 'counterparty' } },
  });
  assert.throws(() => buildChartModel(y2Reversed, rows), /encodings\.y2/);

  const sizeReversed = spec({
    chart: { type: 'bubble' },
    encodings: { x: { field: 'notional_usd' }, y: { field: 'avg_commission_bps' }, size: { field: 'counterparty' } },
  });
  assert.throws(() => buildChartModel(sizeReversed, rows), /encodings\.size/);

  const lowReversed = spec({
    chart: { type: 'columnrange' },
    encodings: { x: { field: 'counterparty' }, low: { field: 'counterparty' }, high: { field: 'notional_usd' } },
  });
  assert.throws(() => buildChartModel(lowReversed, rows), /encodings\.low/);
});

test('a value that coerces to a finite number is still a measure', () => {
  // The compiler has always coerced with `Number()`, and callers rely on that for measures
  // that arrive as strings — JSON from a database, a `count` rendered as text. Rejecting
  // those would be a regression dressed as a fix, so the check is "can it be read as a
  // number", not "is it a JavaScript number".
  const asText: Row[] = [
    { counterparty: 'A', notional_usd: '1382020048.56' },
    { counterparty: 'B', notional_usd: '751227032.27' },
  ];
  const { options } = compileToHighcharts(
    spec({
      chart: { type: 'bar', orientation: 'horizontal' },
      encodings: { x: { field: 'counterparty' }, y: { field: 'notional_usd' } },
    }),
    asText,
  );
  assert.deepEqual((options.series as Array<{ data: unknown[] }>)[0]?.data, [1382020048.56, 751227032.27]);
});

test('null and empty are gaps, not text — a sparse measure still charts', () => {
  const sparse: Row[] = [
    { month: 'Jan', revenue: 10 },
    { month: 'Feb', revenue: null },
    { month: 'Mar', revenue: 30 },
  ];
  const { options } = compileToHighcharts(
    spec({ chart: { type: 'line' }, encodings: { x: { field: 'month' }, y: { field: 'revenue' } } }),
    sparse,
  );
  assert.deepEqual((options.series as Array<{ data: unknown[] }>)[0]?.data, [10, null, 30]);
});

test('a measure column with one unreadable value is refused rather than half-drawn', () => {
  // The mixed case: mostly numbers with a sentinel in them. `Number('n/a')` is NaN, so this
  // used to draw a chart with a hole nobody asked for — the same silence, harder to spot.
  const mixed: Row[] = [
    { month: 'Jan', revenue: 10 },
    { month: 'Feb', revenue: 'n/a' },
    { month: 'Mar', revenue: 30 },
  ];
  assert.throws(
    () =>
      compileToHighcharts(
        spec({ chart: { type: 'line' }, encodings: { x: { field: 'month' }, y: { field: 'revenue' } } }),
        mixed,
      ),
    /'revenue'.*not numeric.*"n\/a"/s,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Orientation is not a data-channel instruction.
// ─────────────────────────────────────────────────────────────────────────────

test('the category channel may be numeric — it is a band axis, not a measure', () => {
  // The reason the check cannot be "x must be text": a numeric category is legal and already
  // in the corpus (`numeric-pair-unique-x` charts `tenure_months` as categories). Direction
  // is decided by `chart.orientation` alone.
  const { options } = compileToHighcharts(
    spec({
      chart: { type: 'line' },
      encodings: { x: { field: 'notional_usd' }, y: { field: 'avg_commission_bps' } },
    }),
    rows,
  );
  assert.deepEqual(
    (options.xAxis as { categories: string[] }).categories,
    rows.map((row) => String(row.notional_usd)),
    'a numeric x is still read as categories',
  );
});

test('horizontal and vertical produce the same channels; only the drawn type differs', () => {
  const encodings = { x: { field: 'counterparty' }, y: { field: 'notional_usd' } } as const;
  const horizontal = compileToHighcharts(spec({ chart: { type: 'bar', orientation: 'horizontal' }, encodings }), rows);
  const vertical = compileToHighcharts(spec({ chart: { type: 'bar' }, encodings }), rows);

  assert.equal((horizontal.options.chart as { type: string }).type, 'bar');
  assert.equal((vertical.options.chart as { type: string }).type, 'column');
  // The same category axis and the same values, whichever way the bars point.
  assert.deepEqual(
    (horizontal.options.xAxis as { categories: string[] }).categories,
    (vertical.options.xAxis as { categories: string[] }).categories,
  );
  assert.deepEqual(
    (horizontal.options.series as Array<{ data: unknown[] }>)[0]?.data,
    (vertical.options.series as Array<{ data: unknown[] }>)[0]?.data,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// The refusal has to reach the model, or it is just a different silent failure.
// ─────────────────────────────────────────────────────────────────────────────

test('a submission with the channels reversed is refused while the model can still fix it', () => {
  const validate = createSubmitValidator({ rows, mode: 'present' });
  const problems = validate(REVERSED);

  assert.equal(problems.length, 1, 'exactly one reason, so the tool result reads as one repair');
  assert.match(problems[0] ?? '', /encodings\.y/);
  assert.match(problems[0] ?? '', /counterparty/);

  // And the corrected spec — the swap the message asks for — is accepted.
  const corrected = spec({
    chart: { type: 'bar', orientation: 'horizontal' },
    encodings: { x: { field: 'counterparty' }, y: { field: 'notional_usd' } },
  });
  assert.deepEqual(validate(corrected), []);
});

test('a point cloud checks both axes, because both of its axes are measures', () => {
  // The kind whose category channel is also a measure: `x` on a scatter is a linear axis, so a
  // text column there is the same defect as a text column on `y` — and it used to produce the
  // same silent `NaN`. The exception this pins is that `series` stays a label channel.
  const rowsWithLabel: Row[] = [
    { counterparty: 'Northgate', notional_usd: 10, commission_bps: 1 },
    { counterparty: 'Halloway', notional_usd: 20, commission_bps: 2 },
  ];
  assert.throws(
    () =>
      buildChartModel(
        spec({ chart: { type: 'scatter' }, encodings: { x: { field: 'counterparty' }, y: { field: 'notional_usd' } } }),
        rowsWithLabel,
      ),
    /encodings\.x/,
  );

  // And a scatter split by a text column still compiles: `series` is not a measure.
  const { model } = buildChartModel(
    spec({
      chart: { type: 'scatter' },
      encodings: { x: { field: 'notional_usd' }, y: { field: 'commission_bps' }, series: { field: 'counterparty' } },
    }),
    rowsWithLabel,
  );
  assert.equal(model.kind, 'point-cloud');
});

test('both prompts state the channel contract, and that orientation does not move it', () => {
  // Defence in depth, in order of authority: the compiler refuses a reversed encoding (above),
  // the submit tool says what each channel is for, and the prompt says it too — because the
  // cheapest repair is the one the model never has to be told about.
  for (const mode of ['ask', 'present'] as const) {
    const prompt = buildSystemPrompt(mode);
    assert.match(prompt, /encodings\.x` is ALWAYS the category/, `${mode}: x's role is stated`);
    assert.match(prompt, /encodings\.y` is ALWAYS the numeric measure/, `${mode}: y's role is stated`);
    assert.match(prompt, /does not swap them/, `${mode}: and that orientation is not a swap`);
  }

  // Present mode used to offer "which column is the x axis and which is the measure" as a free
  // choice, directly above a hard rule fixing x. One of those had to go.
  assert.match(buildSystemPrompt('present'), /which numeric column .* is the measure/);
  assert.match(buildSystemPrompt('present'), /x is the category column/);
  assert.doesNotMatch(
    buildSystemPrompt('present'),
    /which column is the x axis and which is the measure/,
    'the free-choice wording that contradicted the hard rule',
  );
});

test('every channel role the model reads is derived from the declaration', () => {
  // The sentence used to name `x` and `y` only, which left `y2`, `size`, `low` and `high` — all
  // measures, all checked by the compiler — described nowhere. Deriving the line from
  // `CHART_TYPES` is what keeps the text and the enforcement from drifting apart, so this
  // asserts the derivation rather than the wording: change a declaration and this follows.
  const expected = (type: string) => {
    const declaration = CHART_TYPES[type as keyof typeof CHART_TYPES];
    return `${type} declared its channels as ${JSON.stringify(declaration.channels)}`;
  };

  for (const mode of ['ask', 'present'] as const) {
    const submit = buildToolDefs(mode).find((tool) => tool.name === 'submit_spec');
    const description = submit?.description ?? '';
    const channels = (submit?.parameters as {
      properties: { encodings: { properties: Record<string, { description?: string }> } };
    }).properties.encodings.properties;

    // Every declared channel appears, with the role it is declared to have.
    for (const channel of CHANNEL_NAMES) {
      const roles = new Set(
        (Object.keys(CHART_TYPES) as Array<keyof typeof CHART_TYPES>)
          .map((name) => (CHART_TYPES[name].channels as Record<string, string>)[channel])
          .filter((role): role is string => role !== undefined),
      );
      if (roles.size === 0) continue;
      const line = `'${channel} = ${[...roles].join(' or ')}'`;
      assert.ok(
        description.includes(`${channel} = ${[...roles].join(' or ')}`),
        `${mode}: the description must derive '${channel}' from the declaration (expected ${line})`,
      );
      assert.ok(channels[channel] !== undefined, `${mode}: '${channel}' has a schema property to describe`);
    }

    // And the channels that are measures say so, because the compiler refuses them by that rule.
    for (const channel of ['y2', 'size', 'low', 'high'] as const) {
      assert.match(
        channels[channel]?.description ?? '',
        /numbers only/,
        `${mode}: '${channel}' is a measure and must say so — ${expected('bubble')}`,
      );
    }
    assert.match(channels.x?.description ?? '', /category/, `${mode}: x is a category channel`);
    assert.match(channels.y?.description ?? '', /measure column, always/, `${mode}: y is a measure channel`);
    // The one channel where labels are correct, said out loud so the rule above is not over-read.
    assert.match(channels.series?.description ?? '', /not a measure/, `${mode}: series is a label channel`);
  }
});

test('the neighbouring refusals are unmoved: an unknown measure column is still named', () => {
  // The other shape that reaches the same silent nulls — a measure naming a column the plan
  // never produced. It is already refused, and a column check that ran after the new value
  // check would have turned its clear message into a confusing one.
  assert.throws(
    () =>
      buildChartModel(
        spec({ chart: { type: 'bar' }, encodings: { x: { field: 'counterparty' }, y: { field: 'revenue' } } }),
        rows,
      ),
    /'revenue' is not in the produced table \(available: counterparty, notional_usd, avg_commission_bps\)/,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// The loop. What the user actually gets: a chart with marks in it.
// ─────────────────────────────────────────────────────────────────────────────

const submitCall = (id: string, encodings: { x: string; y: string }) => ({
  id,
  name: 'submit_spec',
  args: {
    chart: { type: 'bar', title: 'Traded notional by counterparty', orientation: 'horizontal' },
    encodings: { x: { field: encodings.x }, y: { field: encodings.y } },
  },
});

test('a reversed submission is repaired inside the loop, and the chart it was meant to be comes out', async () => {
  // The whole defect, end to end, in present mode over the example's ranked table: the model
  // reads "horizontal" as a channel swap, the compiler refuses it, the model swaps them back,
  // and the run finishes with the chart the user asked for. It used to "finish" on the first
  // submission — an empty picture with no warning at all.
  const script = [
    submitCall('s1', { x: 'notional_usd', y: 'counterparty' }),
    submitCall('s2', { x: 'counterparty', y: 'notional_usd' }),
  ];
  let round = 0;

  const chartwright = createChartwright({
    llm: {
      async complete() {
        const call = script[Math.min(round, script.length - 1)];
        round += 1;
        return { toolCalls: [call] };
      },
    },
    budget: { maxRounds: 4, maxToolCalls: 4 },
  });

  const result = await chartwright.ask({
    query: 'Draw a horizontal bar chart of traded notional by counterparty',
    rows,
    present: true,
  });

  // The chart has marks, and every one of them is a number.
  const data = (result.options.series as Array<{ data: Array<number | null> }>)[0]?.data ?? [];
  assert.equal(data.length, rows.length);
  assert.ok(
    data.every((value) => typeof value === 'number' && Number.isFinite(value)),
    `every bar is a real number, got ${JSON.stringify(data)}`,
  );
  assert.deepEqual(
    (result.options.xAxis as { categories: string[] }).categories,
    rows.map((row) => String(row.counterparty)),
    'and the categories are the counterparties, not their notionals',
  );

  // The refusal is in the transcript a human can read, and it is a warning the caller can see.
  const refusal = result.messages
    .filter((message) => message.role === 'tool')
    .map((message) => message.content ?? '')
    .find((content) => content.includes('"accepted":false'));
  assert.ok(refusal, 'the refused submission is in the transcript, not silently dropped');
  assert.match(refusal, /encodings\.y/);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? '', /encodings\.y/);
});
