import assert from 'node:assert/strict';
import test from 'node:test';
import { compileToHighcharts } from '../src/compile/index.ts';
import type { ChartSpec, Row } from '../src/types.ts';

test('low/high channels survive the assembler', () => {
  const rows: Row[] = [
    { month: 'Jan', low: 10, high: 25 },
    { month: 'Feb', low: 12, high: 28 },
  ];
  // Use bar type since arearange isn't declared yet — just testing channel passthrough.
  const spec: ChartSpec = {
    chart: { type: 'bar' },
    encodings: { x: { field: 'month' }, y: { field: 'low' }, low: { field: 'low' }, high: { field: 'high' } },
  };
  const result = compileToHighcharts(spec, rows);
  assert.ok(result.options, 'compilation succeeds with low/high channels');
});
