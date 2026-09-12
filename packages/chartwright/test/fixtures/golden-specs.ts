/**
 * The specs whose compiled output is frozen in `options-golden.json`.
 *
 * Shared by the capture script (`spike/capture-golden.ts`) and the golden test
 * (`test/chart-types.test.ts`) so the two cannot drift: the test recompiles these
 * exact specs and compares against the frozen output.
 *
 * The frozen output was captured *before* the chart-type declaration table existed
 * (`docs/spec-extension-plan.md` §6, P0a), which is what makes it evidence: the
 * refactor must not change a single byte of what these specs compile to.
 *
 * The set is deliberately small and chosen for branch coverage, not volume:
 * bar's two orientations, the multi-series legend path, the line path, the
 * part-to-whole path, and emphasis on a categorical and on a slice.
 */
import type { ChartSpec, Row } from '../../src/types.ts';

export type GoldenCase = {
  name: string;
  /** Why this case is in the set — one line, so a future reader can prune it deliberately. */
  why: string;
  spec: ChartSpec;
  rows: Row[];
};

const flat: Row[] = [
  { region: 'East', revenue: 250 },
  { region: 'West', revenue: 80 },
  { region: 'North', revenue: 120 },
];

const split: Row[] = [
  { region: 'East', currency: 'USD', revenue: 250 },
  { region: 'West', currency: 'USD', revenue: 80 },
  { region: 'North', currency: 'USD', revenue: 120 },
  { region: 'East', currency: 'EUR', revenue: 100 },
  { region: 'West', currency: 'EUR', revenue: 40 },
  { region: 'North', currency: 'EUR', revenue: 60 },
];

export const GOLDEN_CASES: GoldenCase[] = [
  {
    name: 'bar-vertical',
    why: 'the default orientation and the plain-number data shape (no per-point objects)',
    spec: { chart: { type: 'bar', title: 'Revenue' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
    rows: flat,
  },
  {
    name: 'bar-horizontal',
    why: 'the reversed category axis, which is the convention this backend exists to own',
    spec: {
      chart: { type: 'bar', orientation: 'horizontal', title: 'Revenue' },
      encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
    },
    rows: flat,
  },
  {
    name: 'bar-series',
    why: 'the legend branch (enabled only when there is more than one series)',
    spec: {
      chart: { type: 'bar' },
      encodings: { x: { field: 'region' }, y: { field: 'revenue' }, series: { field: 'currency' } },
    },
    rows: split,
  },
  {
    name: 'line-series',
    why: 'a second chart type through the categorical path, so the type name itself is frozen',
    spec: {
      chart: { type: 'line', title: 'Revenue over regions' },
      encodings: { x: { field: 'region' }, y: { field: 'revenue' }, series: { field: 'currency' } },
    },
    rows: split,
  },
  {
    name: 'pie',
    why: 'the part-to-whole path: slices, and the legend that is off by construction',
    spec: { chart: { type: 'pie', title: 'Share' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
    rows: flat,
  },
  {
    name: 'bar-emphasis-top',
    why: 'the per-point styling path: a declared condition resolved against the real data',
    spec: {
      chart: { type: 'bar' },
      encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
      emphasis: [{ when: { op: 'top_k', field: 'revenue', k: 1 }, style: { tone: 'highlight', label: true } }],
    },
    rows: flat,
  },
  {
    name: 'pie-emphasis-eq',
    why: 'the slice styling path, which adds keys to objects rather than replacing numbers',
    spec: {
      chart: { type: 'pie' },
      encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
      emphasis: [{ when: { op: 'eq', field: 'region', value: 'West' }, style: { tone: 'muted' } }],
    },
    rows: flat,
  },
  {
    name: 'bar-aggregated-and-sorted',
    why: 'the transform plan path: the frozen dataset proves the compiler still executes the plan itself',
    spec: {
      chart: { type: 'bar', orientation: 'horizontal' },
      transform_plan: {
        steps: [
          { op: 'aggregate', group_by: ['region'], measures: [{ field: 'revenue', agg: 'sum', as: 'revenue' }] },
          { op: 'sort', by: 'revenue', order: 'desc' },
        ],
      },
      encodings: { x: { field: 'region' }, y: { field: 'revenue' } },
    },
    rows: [
      { region: 'East', revenue: 100 },
      { region: 'West', revenue: 80 },
      { region: 'East', revenue: 150 },
      { region: 'North', revenue: 120 },
    ],
  },
];
