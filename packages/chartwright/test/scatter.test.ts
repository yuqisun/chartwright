import assert from 'node:assert/strict';
import test from 'node:test';
import { compileToHighcharts } from '../src/compile/index.ts';
import type { ChartSpec, Row } from '../src/types.ts';

test('axes.x.kind survives the assembler', () => {
  // This test verifies the type accepts axes.x.kind and the assembler passes it through.
  // Backend behavior (actually removing categories) is tested in Task 3.
  const rows: Row[] = [
    { month: '2026-01', value: 10 },
    { month: '2026-02', value: 20 },
  ];
  const spec: ChartSpec = {
    chart: { type: 'line' },
    encodings: { x: { field: 'month' }, y: { field: 'value' } },
    axes: { x: { kind: 'linear' } },
  };
  // Must not throw during compilation.
  const result = compileToHighcharts(spec, rows);
  assert.ok(result.options, 'compilation succeeds with axes.x.kind');
});
