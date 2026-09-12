import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChartModel } from '../src/compile/model.ts';
import type { PointCloudModel } from '../src/compile/model.ts';
import type { ChartSpec, Row } from '../src/types.ts';

test('scatter compiles with two numeric columns', () => {
  const rows: Row[] = [
    { tenure_months: 3, nps: 12 },
    { tenure_months: 9, nps: 47 },
    { tenure_months: 14, nps: 31 },
    { tenure_months: 21, nps: 38 },
  ];
  const spec: ChartSpec = {
    chart: { type: 'scatter' },
    encodings: { x: { field: 'tenure_months' }, y: { field: 'nps' } },
  };
  const { model } = buildChartModel(spec, rows);
  assert.equal(model.kind, 'point-cloud');
  const pc = model as PointCloudModel;
  assert.equal(pc.points.length, 4);
  // Data is [x, y] pairs in table order.
  assert.deepEqual(pc.points[0].values, [3, 12]);
  assert.deepEqual(pc.points[1].values, [9, 47]);
  assert.deepEqual(pc.points[2].values, [14, 31]);
  assert.deepEqual(pc.points[3].values, [21, 38]);
  assert.deepEqual(pc.valueFields, ['tenure_months', 'nps']);
});

test('scatter allows duplicate x values without collision error', () => {
  const rows: Row[] = [
    { x: 5, y: 10 },
    { x: 5, y: 20 },
    { x: 5, y: 30 },
  ];
  const spec: ChartSpec = {
    chart: { type: 'scatter' },
    encodings: { x: { field: 'x' }, y: { field: 'y' } },
  };
  // Must not throw — duplicate x values are normal for a point cloud.
  const { model } = buildChartModel(spec, rows);
  assert.equal(model.kind, 'point-cloud');
  const pc = model as PointCloudModel;
  assert.equal(pc.points.length, 3);
});

test('bubble includes size in valueFields and points', () => {
  const rows: Row[] = [
    { gdp: 1000, life_exp: 72, pop: 50 },
    { gdp: 2000, life_exp: 80, pop: 100 },
  ];
  const spec: ChartSpec = {
    chart: { type: 'bubble' },
    encodings: { x: { field: 'gdp' }, y: { field: 'life_exp' }, size: { field: 'pop' } },
  };
  const { model } = buildChartModel(spec, rows);
  assert.equal(model.kind, 'point-cloud');
  const pc = model as PointCloudModel;
  assert.deepEqual(pc.valueFields, ['gdp', 'life_exp', 'pop']);
  assert.deepEqual(pc.points[0].values, [1000, 72, 50]);
  assert.deepEqual(pc.points[1].values, [2000, 80, 100]);
});

test('scatter with series encoding produces seriesName on points', () => {
  const rows: Row[] = [
    { x: 1, y: 10, group: 'A' },
    { x: 2, y: 20, group: 'B' },
    { x: 3, y: 30, group: 'A' },
  ];
  const spec: ChartSpec = {
    chart: { type: 'scatter' },
    encodings: { x: { field: 'x' }, y: { field: 'y' }, series: { field: 'group' } },
  };
  const { model } = buildChartModel(spec, rows);
  const pc = model as PointCloudModel;
  assert.equal(pc.points[0].seriesName, 'A');
  assert.equal(pc.points[1].seriesName, 'B');
  assert.equal(pc.points[2].seriesName, 'A');
});
