/**
 * STEP 1 PLACEHOLDER — delete this file in Step 2.
 *
 * chartwright does not exist yet, so this module stands in for it and shows the
 * seam: a **neutral chart spec** goes in, **Highcharts options + the dataset
 * that was actually plotted** come out.
 *
 * When Step 2 lands, `placeholderCompile()` is replaced by:
 *
 *   const result = await chartwright.ask({ query, rows, llm });   // result.options
 *
 * and `ChartSpec` moves into chartwright (it is the auditable artifact the
 * whole design revolves around).
 */
import type { Options } from 'highcharts';

import type { Row } from './data';

/** The library-agnostic spec: what to draw, never how the library draws it. */
export type ChartSpec = {
  chart: { type: string; title: string };
  transform_plan: {
    steps: Array<
      | { op: 'aggregate'; group_by: string[]; measures: Array<{ field: string; agg: 'sum'; as: string }> }
      | { op: 'sort'; by: string; order: 'asc' | 'desc' }
      | { op: 'limit'; n: number }
    >;
  };
  encodings: {
    x: { field: string };
    y: { field: string };
    series?: { field: string };
  };
};

export const DEMO_QUERY = 'Which 10 counterparties have the largest traded notional?';

export const DEMO_SPEC: ChartSpec = {
  chart: { type: 'bar', title: DEMO_QUERY },
  transform_plan: {
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
  encodings: { x: { field: 'counterparty' }, y: { field: 'notional_usd' } },
};

export type CompiledChart = {
  options: Options;
  /** The exact table that went into the chart — the app can show it or tooltip it. */
  dataset: Row[];
};

/**
 * A deliberately small stand-in for chartwright's deterministic pipeline.
 *
 * Two things are already faithful to the real design:
 *   1. the transform plan is executed over the **full** row set (no sampling),
 *   2. the dataset is returned alongside the options, bound by the compiler —
 *      not assembled by an LLM.
 */
export function placeholderCompile(rows: Row[], spec: ChartSpec): CompiledChart {
  let table = rows;

  for (const step of spec.transform_plan.steps) {
    switch (step.op) {
      case 'aggregate': {
        const groups = new Map<string, Row>();
        for (const row of table) {
          const key = step.group_by.map((f) => String(row[f])).join('\u0000');
          let out = groups.get(key);
          if (!out) {
            out = Object.fromEntries(step.group_by.map((f) => [f, row[f]]));
            for (const m of step.measures) out[m.as] = 0;
            groups.set(key, out);
          }
          for (const m of step.measures) {
            out[m.as] = Number(out[m.as]) + Number(row[m.field]);
          }
        }
        table = [...groups.values()];
        break;
      }
      case 'sort': {
        const dir = step.order === 'desc' ? -1 : 1;
        table = [...table].sort((a, b) => dir * (Number(a[step.by]) - Number(b[step.by])));
        break;
      }
      case 'limit':
        table = table.slice(0, step.n);
        break;
    }
  }

  const { x, y } = spec.encodings;
  const options: Options = {
    chart: { type: 'bar' },
    title: { text: spec.chart.title, style: { fontSize: '15px' } },
    xAxis: { categories: table.map((r) => String(r[x.field])) },
    yAxis: { title: { text: y.field } },
    legend: { enabled: false },
    credits: { enabled: false },
    series: [{ type: 'bar', name: y.field, data: table.map((r) => Number(r[y.field])) }],
  };

  return { options, dataset: table };
}
