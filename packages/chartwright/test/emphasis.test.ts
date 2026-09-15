import assert from 'node:assert/strict';
import test from 'node:test';

import { compileToHighcharts } from '../src/compile/index.ts';
import type { ChartSpec, EmphasisRule, Row } from '../src/types.ts';

const rows: Row[] = [
  { region: 'East', revenue: 100 },
  { region: 'West', revenue: 380 },
  { region: 'North', revenue: 240 },
];

const AGGREGATE = {
  op: 'aggregate' as const,
  group_by: ['region'],
  measures: [{ field: 'revenue', agg: 'sum' as const, as: 'revenue' }],
};

function spec(chart: ChartSpec['chart'], emphasis?: EmphasisRule[]): ChartSpec {
  return {
    schema_version: 1,
    chart,
    transform_plan: { steps: [AGGREGATE] },
    encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
    ...(emphasis ? { emphasis } : {}),
  };
}

/** Reads the per-point colour out of the compiled categorical series. */
function coloured(options: Record<string, unknown>): Array<{ category: string; value: number; color?: string; label?: boolean }> {
  const categories = (options.xAxis as { categories: string[] }).categories;
  const data = (options.series as Array<{ data: unknown[] }>)[0]?.data ?? [];
  return categories.map((category, index) => {
    const datum = data[index];
    if (typeof datum === 'object' && datum !== null) {
      const point = datum as { y: number; color?: string; dataLabels?: { enabled?: boolean } };
      return { category, value: point.y, ...(point.color ? { color: point.color } : {}), label: point.dataLabels?.enabled === true };
    }
    return { category, value: Number(datum) };
  });
}

test('top_k highlights the largest datum, chosen by the compiler from the real data', () => {
  const { options } = compileToHighcharts(
    spec({ type: 'bar', orientation: 'horizontal' }, [
      { when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight' } },
    ]),
    rows,
  );

  const points = coloured(options);
  const highlighted = points.filter((p) => p.color);
  assert.equal(highlighted.length, 1);
  assert.equal(highlighted[0]?.category, 'West', 'the compiler found the maximum itself');
  assert.equal(highlighted[0]?.value, 380);
});

test('the highlight is keyed by category value, not position', () => {
  // The category axis is reversed for horizontal bars, so a positional mapping
  // would style the wrong bar. Assert the colour travels with the category.
  const { options } = compileToHighcharts(
    spec({ type: 'bar', orientation: 'horizontal' }, [
      { when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight' } },
    ]),
    rows,
  );
  const horizontal = coloured(options);
  assert.equal(horizontal.find((p) => p.category === 'West')?.color !== undefined, true);

  const { options: verticalOptions } = compileToHighcharts(
    spec({ type: 'bar' }, [{ when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight' } }]),
    rows,
  );
  const vertical = coloured(verticalOptions);
  assert.equal(vertical.find((p) => p.category === 'West')?.color !== undefined, true);
});

test('ties at the k-th value are all included rather than picked arbitrarily', () => {
  const tied: Row[] = [
    { region: 'East', revenue: 100 },
    { region: 'West', revenue: 300 },
    { region: 'North', revenue: 300 },
  ];
  const { options } = compileToHighcharts(
    spec({ type: 'bar' }, [{ when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight' } }]),
    tied,
  );
  const highlighted = coloured(options).filter((p) => p.color).map((p) => p.category);
  assert.deepEqual(highlighted, ['West', 'North']);
});

test('direction "min" highlights the smallest', () => {
  const { options } = compileToHighcharts(
    spec({ type: 'bar' }, [
      { when: { op: 'top_k', k: 1, field: 'revenue', direction: 'min' }, style: { tone: 'highlight' } },
    ]),
    rows,
  );
  assert.deepEqual(coloured(options).filter((p) => p.color).map((p) => p.category), ['East']);
});

test('"mute everything, then highlight one" reads exactly as it sounds (later rule wins)', () => {
  const { options } = compileToHighcharts(
    spec({ type: 'bar' }, [
      { when: { op: 'gte', field: 'revenue', value: 0 }, style: { tone: 'muted', label: false } },
      { when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight', label: true } },
    ]),
    rows,
  );

  const points = coloured(options);
  assert.equal(points.every((p) => p.color !== undefined), true, 'every point is styled');
  const west = points.find((p) => p.category === 'West');
  const east = points.find((p) => p.category === 'East');
  assert.equal(west?.color, '#e8590c', 'the last matching rule wins');
  assert.equal(west?.label, true);
  assert.equal(east?.color, '#c9ced6');
  assert.equal(east?.label, false);
});

test('a named category can be emphasised with eq — the user named it, not the model', () => {
  const { options } = compileToHighcharts(
    spec({ type: 'bar' }, [{ when: { op: 'eq', field: 'region', value: 'North' }, style: { tone: 'highlight' } }]),
    rows,
  );
  assert.deepEqual(coloured(options).filter((p) => p.color).map((p) => p.category), ['North']);
});

test('a rule that matches nothing warns instead of silently doing nothing', () => {
  const { options, warnings } = compileToHighcharts(
    spec({ type: 'bar' }, [{ when: { op: 'gte', field: 'revenue', value: 99999 }, style: { tone: 'highlight' } }]),
    rows,
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] as string, /emphasis rule gte on 'revenue' matched no rows/);
  assert.equal(coloured(options).some((p) => p.color), false);
});

test('top_k on a field that is not a numeric column of the chart warns and styles nothing', () => {
  const { options, warnings } = compileToHighcharts(
    spec({ type: 'bar' }, [{ when: { op: 'top_k', k: 1, field: 'nope' }, style: { tone: 'highlight' } }]),
    rows,
  );
  assert.match(warnings[0] as string, /references 'nope'/);
  assert.equal(coloured(options).some((p) => p.color), false);
});

test('an emphasis-free spec compiles exactly as it did before the feature existed', () => {
  const { options, warnings } = compileToHighcharts(spec({ type: 'bar' }), rows);
  assert.deepEqual(warnings, []);
  const data = (options.series as Array<{ data: unknown[] }>)[0]?.data;
  assert.deepEqual(data, [100, 380, 240], 'plain numbers, no per-point objects');
});

test('emphasis works on a pie, keyed by slice name', () => {
  const { options } = compileToHighcharts(
    {
      schema_version: 1,
      chart: { type: 'pie' },
      transform_plan: { steps: [AGGREGATE] },
      encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
      emphasis: [{ when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'muted' } }],
    },
    rows,
  );
  const slices = (options.series as Array<{ data: Array<{ name: string; y: number; color?: string }> }>)[0]?.data ?? [];
  assert.deepEqual(
    slices.map((slice) => [slice.name, slice.color]),
    [
      ['East', undefined],
      ['West', '#c9ced6'],
      ['North', undefined],
    ],
  );
});

test('emphasis on a line chart colours the matching point, and only it', () => {
  // This used to run over a temporal x, which no longer exists: a date column goes
  // through the categorical path like everything else, so the points here are numbers
  // against categories rather than [ms, value] pairs. The emphasis behaviour is the
  // same either way, which is the point of the split between the model and the backend.
  const line: Row[] = [
    { month: '2026-01-01', revenue: 10 },
    { month: '2026-02-01', revenue: 99 },
  ];
  const { options } = compileToHighcharts(
    {
      schema_version: 1,
      chart: { type: 'line' },
      encodings: { x: { field: 'month' }, y: { field: 'revenue' } },
      emphasis: [{ when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight' } }],
    },
    line,
  );

  assert.deepEqual((options.xAxis as { categories: string[] }).categories, ['2026-01-01', '2026-02-01']);
  const data = (options.series as Array<{ data: unknown[] }>)[0]?.data ?? [];
  assert.equal(data[0], 10, 'the unstyled point stays a plain number');
  assert.deepEqual(data[1], { y: 99, color: '#e8590c' });
});

// ─────────────────────────────────────────────────────────────────────────────
// The complement of a ranked set: "highlight the top one, fade the rest".
//
// There was no way to say "the rest". The one construction that worked was an
// always-true threshold — `gte(field, 0)` — which is only ever true because the
// measure happens to be non-negative, and a value threshold over a real bound is a
// number the model must not look up. So the model reached for the nearest thing the
// schema offered: a *larger* `top_k`, read as a complement. On a twelve-row table
// `top_k(11)` muted ranks 1-11 — including the winner that the first rule had just
// highlighted — and left rank 12 as the only default-coloured bar on the chart, which
// reads as the selected one. `warnings: []`, because nothing was wrong with either
// rule on its own.
//
// `rest` says the second half of that pair explicitly: the complement of the ranked
// set, computed from one ranking so it cannot disagree with the first rule.
// ─────────────────────────────────────────────────────────────────────────────

const twelve: Row[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((region, index) => ({
  region,
  revenue: (12 - index) * 1000,
}));

test('rest marks everything the ranked set did not: the top one, and the rest faded', () => {
  const { options, warnings } = compileToHighcharts(
    spec({ type: 'bar', orientation: 'horizontal' }, [
      { when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight', label: true } },
      { when: { op: 'top_k', k: 1, field: 'revenue', rest: true }, style: { tone: 'muted' } },
    ]),
    twelve,
  );

  assert.deepEqual(warnings, [], 'the pair is unambiguous, so there is nothing to warn about');
  const points = coloured(options);
  const byTone = (tone: string) => points.filter((p) => p.color === tone).map((p) => p.category);

  assert.deepEqual(byTone('#e8590c'), ['A'], 'the largest is the one highlighted');
  assert.equal(byTone('#c9ced6').length, 11, 'and every other bar is faded');
  assert.equal(points.filter((p) => p.color === undefined).length, 0, 'nothing is left at the default colour');

  // The failure this fixes was visual: the last bar kept the default colour and so looked
  // like the chosen one. Assert the property directly, not just the counts.
  assert.equal(points[points.length - 1]?.color, '#c9ced6', 'the last bar is faded like the rest');
});

test('rest is the exact complement however the top set is bounded', () => {
  // Two pairs, one k apart, so `rest` cannot be right by accident of a table size.
  const pairs: Array<[number, number]> = [
    [1, 11],
    [3, 9],
  ];
  for (const [k, expected] of pairs) {
    const { options } = compileToHighcharts(
      spec({ type: 'bar' }, [
        { when: { op: 'top_k', k, field: 'revenue' }, style: { tone: 'highlight' } },
        { when: { op: 'top_k', k, field: 'revenue', rest: true }, style: { tone: 'muted' } },
      ]),
      twelve,
    );
    const points = coloured(options);
    assert.equal(points.filter((p) => p.color === '#e8590c').length, k, `top ${k} highlighted`);
    assert.equal(points.filter((p) => p.color === '#c9ced6').length, expected, `and ${expected} faded`);
  }
});

test('rest includes the ties that top_k includes, so the pair still covers every bar', () => {
  // `top_k` deliberately includes ties at the k-th value. The complement has to be the
  // complement of *that* set, or the tied rows fall outside both rules and keep the
  // default colour — the same "last one looks selected" bug, at a smaller k.
  //
  // The tie is placed at the k-th value on purpose. k=1 over A=5000, B=4000, C=4000, D=1000
  // selects only A, because the threshold is 5000 and nothing ties with it; k=2 makes the
  // threshold 4000 and pulls both B and C in. Both readings are `top_k` behaving as documented
  // (`ties at the k-th value are all included`), and the complement has to follow it exactly —
  // which is what a second, larger `top_k` could not do.
  const tied: Row[] = [
    { region: 'A', revenue: 5000 },
    { region: 'B', revenue: 4000 },
    { region: 'C', revenue: 4000 },
    { region: 'D', revenue: 1000 },
  ];
  const { options } = compileToHighcharts(
    spec({ type: 'bar' }, [
      { when: { op: 'top_k', k: 2, field: 'revenue' }, style: { tone: 'highlight' } },
      { when: { op: 'top_k', k: 2, field: 'revenue', rest: true }, style: { tone: 'muted' } },
    ]),
    tied,
  );

  // The threshold is 4000, so B and C are both "top 2" and D is the entire complement.
  assert.deepEqual(
    coloured(options).map((p) => [p.category, p.color]),
    [
      ['A', '#e8590c'],
      ['B', '#e8590c'],
      ['C', '#e8590c'],
      ['D', '#c9ced6'],
    ],
  );

  // And at k=1 nothing ties with the threshold, so the complement is the other three.
  const { options: atOne } = compileToHighcharts(
    spec({ type: 'bar' }, [
      { when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight' } },
      { when: { op: 'top_k', k: 1, field: 'revenue', rest: true }, style: { tone: 'muted' } },
    ]),
    tied,
  );
  assert.deepEqual(
    coloured(atOne).map((p) => [p.category, p.color]),
    [
      ['A', '#e8590c'],
      ['B', '#c9ced6'],
      ['C', '#c9ced6'],
      ['D', '#c9ced6'],
    ],
    'k=1 selects only the strict maximum, and the complement is exactly the rest',
  );
});

test('rest honours direction "min", so the faded set is the top of the other end', () => {
  const { options } = compileToHighcharts(
    spec({ type: 'bar' }, [
      { when: { op: 'top_k', k: 1, field: 'revenue', direction: 'min' }, style: { tone: 'highlight' } },
      { when: { op: 'top_k', k: 1, field: 'revenue', direction: 'min', rest: true }, style: { tone: 'muted' } },
    ]),
    twelve,
  );
  const points = coloured(options);
  assert.deepEqual(points.filter((p) => p.color === '#e8590c').map((p) => p.category), ['L']);
  assert.equal(points.filter((p) => p.color === '#c9ced6').length, 11);
});

test('rest on a field that is not a numeric column warns, like the rule it complements', () => {
  const { options, warnings } = compileToHighcharts(
    spec({ type: 'bar' }, [
      { when: { op: 'top_k', k: 1, field: 'nope', rest: true }, style: { tone: 'muted' } },
    ]),
    rows,
  );
  // The message has to say which rule it was: "top_k k=1" names the condition, so a spec with
  // two top_k rules cannot leave the model guessing which one it is being told about.
  assert.match(warnings[0] as string, /references 'nope'/);
  assert.equal(warnings.length, 1);
  assert.equal(coloured(options).some((p) => p.color), false);
});

test('a plain top_k larger than the table still does not warn, because it selects', () => {
  // Pins the exemption the empty-complement warning was carved out of. `top_k(12)` over twelve
  // rows clamps to the whole table, which is the emphasis the user asked for; `rest` is the one
  // shape of `top_k` whose empty result is emphasis that did not arrive.
  const { options, warnings } = compileToHighcharts(
    spec({ type: 'bar' }, [{ when: { op: 'top_k', k: 99, field: 'revenue' }, style: { tone: 'muted' } }]),
    twelve,
  );
  assert.deepEqual(warnings, []);
  assert.equal(coloured(options).filter((p) => p.color).length, 12, 'every row is faded, as asked');
});

test('rest that fades nothing warns rather than passing quietly', () => {
  // `rest` with a k that already covers the table is an empty set. The user asked for
  // emphasis and would get none, which is the case the existing "matched no rows" warning
  // exists for — it must not be bypassed just because the rule carries `rest`.
  const { options, warnings } = compileToHighcharts(
    spec({ type: 'bar' }, [{ when: { op: 'top_k', k: 12, field: 'revenue', rest: true }, style: { tone: 'muted' } }]),
    twelve,
  );
  assert.equal(warnings.length, 1);
  // The sentence has to say *which* set was empty. "matched no rows" is the wrong claim here —
  // the rule matched every row it could and the complement came out empty — and it sends the
  // reader looking for a wrong field name instead of at their k.
  assert.match(warnings[0] as string, /empty complement/);
  assert.match(warnings[0] as string, /tied values/);
  assert.equal(coloured(options).some((p) => p.color), false);
});

test('the empty complement a total tie produces is explained, not just reported', () => {
  // Every value equal: `top_k` with k=1 swallows the table because ties at the k-th value are all
  // included, so the complement is empty. Nothing is wrong with the spec and nothing can be
  // styled, which is exactly the case a bare "matched no rows" would mis-describe.
  const allEqual: Row[] = ['A', 'B', 'C', 'D'].map((region) => ({ region, revenue: 500 }));
  const { options, warnings } = compileToHighcharts(
    spec({ type: 'bar' }, [
      { when: { op: 'top_k', k: 1, field: 'revenue' }, style: { tone: 'highlight' } },
      { when: { op: 'top_k', k: 1, field: 'revenue', rest: true }, style: { tone: 'muted' } },
    ]),
    allEqual,
  );

  // The highlight still works — the tie is included, which is the documented `top_k` behaviour.
  assert.equal(coloured(options).filter((p) => p.color === '#e8590c').length, 4);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] as string, /empty complement/);
});
