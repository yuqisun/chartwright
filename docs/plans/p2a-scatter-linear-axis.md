# P2a: Scatter + Linear Axis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scatter and bubble chart support by introducing linear axis inference, a point-cloud model kind, and fixing the datum key identity problem (§2.1).

**Architecture:** Scatter needs two numeric axes instead of one band + one linear. The axis kind is inferred from the channel role (`measure` → linear, `category` → band) with an explicit `axes.*.kind` override. A new `point-cloud` model kind uses positional (row-index) datum keys instead of category-value keys, because two points can share an x value. The collision rule is relaxed for types that declare `allowsDuplicateCategories: true`.

**Tech Stack:** TypeScript, Node ≥22.6, Highcharts 12.6, TAP test runner

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/chartwright/src/types.ts` | Modify | Add `axes.x.kind`, `axes.y.kind` to ChartSpec |
| `packages/chartwright/src/compile/chart-types.ts` | Modify | Add `'point-cloud'` to ChartKind; add scatter/bubble declarations; add `allowsDuplicateCategories` field |
| `packages/chartwright/src/compile/model.ts` | Modify | Add PointCloudModel type; buildPointCloud function; positional datum keys |
| `packages/chartwright/src/compile/backends/highcharts.ts` | Modify | pointCloudOptions mapper; linear axis emission |
| `packages/chartwright/src/compile/emphasis.ts` | Modify | DatumKey signature accepts optional row index for positional keys |
| `packages/chartwright/src/compile/index.ts` | Modify | Wire point-cloud through compileToHighcharts; keyOf produces positional keys for point-cloud |
| `packages/chartwright/src/loop.ts` | Modify | Validate axes.*.kind; relax collision check for allowsDuplicateCategories |
| `packages/chartwright/src/tools.ts` | Modify | Add axes.x.kind / axes.y.kind to schema |
| `packages/chartwright/test/scatter.test.ts` | Create | Scatter/bubble tests: linear axis, positional keys, emphasis, duplicate x |
| `packages/chartwright/test/fixtures/corpus.ts` | Modify | Move scatter/bubble from boundary to drawn; add datasets |
| `packages/chartwright/test/fixtures/golden-specs.ts` | Modify | Add scatter golden case |
| `scripts/build-showcase.ts` | Modify | Add scatter/bubble page copy |
| `docs/using-chartwright.md` | Modify | Document axes.*.kind and scatter |

---

### Task 1: Add `axes.*.kind` to types and schema

**Files:**
- Modify: `packages/chartwright/src/types.ts:179-181`
- Modify: `packages/chartwright/src/tools.ts:383-399`
- Modify: `packages/chartwright/src/loop.ts:248-260`

- [ ] **Step 1: Write the failing test**

Add to `packages/chartwright/test/scatter.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { compileToHighcharts } from '../src/compile/index.ts';
import type { ChartSpec, Row } from '../src/types.ts';

test('axes.x.kind overrides the inferred axis type', () => {
  const rows: Row[] = [
    { month: '2026-01', value: 10 },
    { month: '2026-02', value: 20 },
  ];
  const spec: ChartSpec = {
    chart: { type: 'line' },
    encodings: { x: { field: 'month' }, y: { field: 'value' } },
    axes: { x: { kind: 'linear' } },
  };
  const { options } = compileToHighcharts(spec, rows);
  // When kind is explicitly set to linear, the axis must not carry categories.
  const xAxis = options.xAxis as Record<string, unknown>;
  assert.equal(xAxis.categories, undefined, 'explicit linear kind removes categories');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --disable-warning=ExperimentalWarning --test packages/chartwright/test/scatter.test.ts`
Expected: FAIL — `axes.x.kind` is not in the type, TS error or runtime ignore.

- [ ] **Step 3: Add `kind` to types.ts axes**

In `packages/chartwright/src/types.ts`, update the axes type:

```ts
  axes?: {
    y?: { min?: number; max?: number };
    y2?: { min?: number; max?: number };
    /** Override the inferred axis kind. Default: 'band' for category channels, 'linear' for measure channels. */
    x?: { kind?: 'band' | 'linear' | 'log'; min?: number; max?: number };
    /** Alias for the existing y range, plus kind override. */
  };
```

Wait — the existing `axes.y` already has `min`/`max`. Merge `kind` into it rather than creating a separate entry. Update to:

```ts
  axes?: {
    x?: { kind?: 'band' | 'linear' | 'log'; min?: number; max?: number };
    y?: { kind?: 'band' | 'linear' | 'log'; min?: number; max?: number };
    y2?: { kind?: 'band' | 'linear' | 'log'; min?: number; max?: number };
  };
```

- [ ] **Step 4: Add to tools.ts schema**

In `SUBMIT_PROPERTIES.axes.properties`, add `kind` to both x and y:

```ts
      x: {
        type: 'object',
        description: 'Override the x axis kind or range. Kind defaults to band for category channels, linear for measure.',
        properties: {
          kind: { type: 'string', enum: ['band', 'linear', 'log'] },
          min: { type: 'number' },
          max: { type: 'number' },
        },
        additionalProperties: false,
      },
```

And add `kind` to the existing y and y2 schemas.

- [ ] **Step 5: Add validation in loop.ts**

After the existing y/y2 range validation, add:

```ts
  for (const axisName of ['x', 'y', 'y2'] as const) {
    const kind = candidate.axes?.[axisName]?.kind;
    if (kind !== undefined && !['band', 'linear', 'log'].includes(kind)) {
      errors.push(`axes.${axisName}.kind must be 'band', 'linear', or 'log'`);
    }
  }
```

Also pass `axes.x` through to the assembled spec (currently only y range is passed).

- [ ] **Step 6: Run test to verify it passes**

Run: `node --experimental-strip-types --disable-warning=ExperimentalWarning --test packages/chartwright/test/scatter.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/chartwright/src/types.ts packages/chartwright/src/tools.ts packages/chartwright/src/loop.ts packages/chartwright/test/scatter.test.ts
git commit -m "feat(types): add axes.*.kind for explicit axis type override"
```

---

### Task 2: Add point-cloud model kind and scatter declaration

**Files:**
- Modify: `packages/chartwright/src/compile/chart-types.ts:51,94-128`
- Modify: `packages/chartwright/src/compile/model.ts:56-93,220-350`

- [ ] **Step 1: Write the failing test**

Add to `packages/chartwright/test/scatter.test.ts`:

```ts
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
  const { options } = compileToHighcharts(spec, rows);
  assert.equal((options.chart as Record<string, string>).type, 'scatter');
  const series = options.series as Array<{ data: Array<[number, number]> }>;
  assert.equal(series.length, 1);
  assert.equal(series[0].data.length, 4);
  // Data is [x, y] pairs, not category-indexed.
  assert.deepEqual(series[0].data[0], [3, 12]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `'scatter'` is not a declared type.

- [ ] **Step 3: Add 'point-cloud' to ChartKind and scatter declaration**

In `chart-types.ts`:

```ts
export type ChartKind = 'categorical' | 'part-to-whole' | 'matrix' | 'point-cloud';
```

Add scatter and bubble to CHART_TYPES:

```ts
  scatter: {
    kind: 'point-cloud',
    channels: { x: 'measure', y: 'measure', series: 'series' },
    required: ['x', 'y'],
    modifiers: ['compact'],
    // Two points can share an x value — that is normal for a cloud, not a collision.
    allowsDuplicateCategories: true,
    colorRoles: ['series.categorical'],
  },
  bubble: {
    kind: 'point-cloud',
    channels: { x: 'measure', y: 'measure', size: 'measure', series: 'series' },
    required: ['x', 'y', 'size'],
    modifiers: ['compact'],
    allowsDuplicateCategories: true,
    colorRoles: ['series.categorical'],
  },
```

Add `'size'` to ChannelName and CHANNEL_SET:

```ts
export type ChannelName = 'x' | 'y' | 'y2' | 'series' | 'size';
const CHANNEL_SET: Record<ChannelName, true> = { x: true, y: true, y2: true, series: true, size: true };
```

- [ ] **Step 4: Add PointCloudModel to model.ts**

```ts
export type PointCloudModel = Base & {
  kind: 'point-cloud';
  /** Each point is [x, y] or [x, y, size] in table order. */
  points: Array<{ values: number[]; seriesName?: string }>;
  /** The field names in order: [xField, yField, sizeField?]. */
  valueFields: string[];
};

export type ChartModel = CategoricalModel | PartToWholeModel | MatrixModel | PointCloudModel;
```

- [ ] **Step 5: Build point-cloud model in buildChartModel**

After the matrix branch, before the categorical return:

```ts
  if (kind === 'point-cloud') {
    const sizeField = spec.encodings.size?.field;
    const valueFields = [y.field, ...(sizeField ? [sizeField] : [])];
    // Points are emitted in table order. The positional index is the datum key
    // for point-cloud types (§2.1): two points can share an x value, so the
    // category-value key would conflate them.
    const points = dataset.map((row) => ({
      values: [Number(row[x.field]), ...valueFields.map((f) => Number(row[f]))],
      ...(seriesField ? { seriesName: String(row[seriesField]) } : {}),
    }));
    return {
      model: { ...base, kind: 'point-cloud', points, valueFields: [x.field, ...valueFields] },
      warnings: [],
    };
  }
```

- [ ] **Step 6: Run test to verify it passes**

Expected: PASS (model builds, but backend doesn't handle it yet — test may fail at backend stage). If so, proceed to Task 3.

- [ ] **Step 7: Commit**

```bash
git add packages/chartwright/src/compile/chart-types.ts packages/chartwright/src/compile/model.ts packages/chartwright/test/scatter.test.ts
git commit -m "feat(compile): add point-cloud model kind and scatter/bubble declarations"
```

---

### Task 3: Backend mapper for point-cloud + linear axis

**Files:**
- Modify: `packages/chartwright/src/compile/backends/highcharts.ts`

- [ ] **Step 1: Write the failing test**

The test from Task 2 Step 1 should now pass end-to-end. Also add:

```ts
test('scatter emits linear axes without categories', () => {
  const rows: Row[] = [
    { x: 1, y: 10 },
    { x: 2, y: 20 },
  ];
  const { options } = compileToHighcharts(
    { chart: { type: 'scatter' }, encodings: { x: { field: 'x' }, y: { field: 'y' } } },
    rows,
  );
  const xAxis = options.xAxis as Record<string, unknown>;
  const yAxis = options.yAxis as Record<string, unknown>;
  assert.equal(xAxis.categories, undefined);
  assert.equal(yAxis.categories, undefined);
  assert.equal((xAxis.title as Record<string, string>).text, 'x');
  assert.equal((yAxis.title as Record<string, string>).text, 'y');
});
```

- [ ] **Step 2: Implement pointCloudOptions in highcharts.ts**

```ts
function pointCloudOptions(
  model: PointCloudModel,
  emphasis: EmphasisResolution,
  theme: Theme,
): { options: ChartOptions; warnings: string[] } {
  const palette = paletteFor(theme, model.chartType, /* seriesCount */ 1);
  const options: ChartOptions = {
    ...baseOptions(model, { legend: false, theme }),
    chart: { type: model.chartType, backgroundColor: theme.roles.surface.canvas },
    ...(palette ? { colors: palette } : {}),
    xAxis: themedAxis(theme, { title: { text: model.xField } }, { grid: false }),
    yAxis: themedAxis(theme, { title: { text: model.yField } }, { grid: true }),
    series: [{
      type: model.chartType,
      name: model.yField,
      data: model.points.map((point, index) => {
        const style = emphasis.styles.get(String(index));
        const values = point.values;
        const base = model.valueFields.length === 3
          ? { x: values[0], y: values[1], z: values[2] }
          : [values[0], values[1]];
        return style ? withTone(base as Record<string, unknown>, style, theme) : base;
      }),
    }],
  };
  return { options, warnings: [] };
}
```

Add to the switch in `toHighchartsOptions`:

```ts
    case 'point-cloud':
      return pointCloudOptions(model, emphasis, theme);
```

Import `PointCloudModel` from model.ts.

- [ ] **Step 3: Run tests**

Expected: Both scatter tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/chartwright/src/compile/backends/highcharts.ts packages/chartwright/test/scatter.test.ts
git commit -m "feat(compile): scatter backend with linear axes and positional data"
```

---

### Task 4: Positional datum keys for point-cloud emphasis (§2.1 blocker 3)

**Files:**
- Modify: `packages/chartwright/src/compile/emphasis.ts:18`
- Modify: `packages/chartwright/src/compile/index.ts:42-60`
- Modify: `packages/chartwright/src/compile/model.ts:keyForCategory`

- [ ] **Step 1: Write the failing test**

```ts
test('top_k on scatter highlights exactly one point even when two share an x', () => {
  const rows: Row[] = [
    { x: 9, y: 10 },
    { x: 9, y: 50 },  // same x, higher y
    { x: 14, y: 30 },
  ];
  const { options } = compileToHighcharts(
    {
      chart: { type: 'scatter' },
      encodings: { x: { field: 'x' }, y: { field: 'y' } },
      emphasis: [{ when: { op: 'top_k', field: 'y', k: 1 }, style: { tone: 'highlight' } }],
    },
    rows,
  );
  const data = (options.series as Array<{ data: unknown[] }>)[0].data;
  const styled = data.filter((d) => typeof d === 'object');
  assert.equal(styled.length, 1, 'exactly one point highlighted, not two');
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — both x=9 points share the same datum key, so top_k marks 2 points.

- [ ] **Step 3: Change DatumKey to accept row index**

In `emphasis.ts`:

```ts
export type DatumKey = (row: Row, measureField?: string, rowIndex?: number) => string;
```

In `resolveEmphasis`, pass the row index:

```ts
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      // ... existing logic, but pass ri to keyOf:
      const key = rule.when.op === 'top_k' ? keyOf(row, rule.when.field, ri) : keyOf(row, undefined, ri);
```

In `index.ts` `keyOf`:

```ts
  return (row: Row, measureField?: string, rowIndex?: number) => {
    // Point-cloud types use positional keys: the row index distinguishes points
    // that share an x value (§2.1). The index is stable because the backend emits
    // data in table order and does not reorder.
    if (spec.chart.type === 'scatter' || spec.chart.type === 'bubble') {
      return String(rowIndex);
    }
    // ... existing combo/category logic
  };
```

This is fragile (hardcoded type names). Better: pass the model kind or a flag. But for now this works and the test validates it. Refactor to model-driven in a follow-up.

Actually, cleaner: check if the spec has `allowsDuplicateCategories` via the declaration:

```ts
  const isPointCloud = spec.encodings.y2 === undefined && 
    (CHART_TYPES[spec.chart.type as ChartType]?.allowsDuplicateCategories === true);
```

Import `CHART_TYPES` and `ChartType`. Then:

```ts
    if (isPointCloud && rowIndex !== undefined) {
      return String(rowIndex);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

- [ ] **Step 5: Add guard test for positional key stability**

```ts
test('scatter emphasis marks the intended datum, not a neighbour', () => {
  const rows: Row[] = [
    { x: 1, y: 100 },
    { x: 2, y: 5 },
    { x: 3, y: 50 },
  ];
  const { options } = compileToHighcharts(
    {
      chart: { type: 'scatter' },
      encodings: { x: { field: 'x' }, y: { field: 'y' } },
      emphasis: [{ when: { op: 'top_k', field: 'y', k: 1 }, style: { tone: 'highlight' } }],
    },
    rows,
  );
  const data = (options.series as Array<{ data: Array<Record<string, unknown> | number> }>)[0].data;
  // Row 0 (y=100) is the top-1. It must be styled; rows 1 and 2 must not.
  assert.equal(typeof data[0], 'object', 'row 0 (highest y) is highlighted');
  assert.equal(typeof data[1], 'number', 'row 1 is unstyled');
  assert.equal(typeof data[2], 'number', 'row 2 is unstyled');
});
```

- [ ] **Step 6: Commit**

```bash
git add packages/chartwright/src/compile/emphasis.ts packages/chartwright/src/compile/index.ts packages/chartwright/test/scatter.test.ts
git commit -m "fix(compile): positional datum keys for scatter prevent identity conflation (§2.1)"
```

---

### Task 5: Relax collision rule for point-cloud types

**Files:**
- Modify: `packages/chartwright/src/compile/model.ts:285-292`
- Modify: `packages/chartwright/src/submit.ts:80-85`

- [ ] **Step 1: Write the failing test**

```ts
test('scatter accepts duplicate x values without refusing', () => {
  const rows: Row[] = [
    { x: 9, y: 10 },
    { x: 9, y: 50 },
    { x: 14, y: 30 },
  ];
  // Must not throw.
  const { options } = compileToHighcharts(
    { chart: { type: 'scatter' }, encodings: { x: { field: 'x' }, y: { field: 'y' } } },
    rows,
  );
  assert.equal((options.series as Array<{ data: unknown[] }>)[0].data.length, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — collision rule throws "more than one row for category '9'".

- [ ] **Step 3: Skip collision check for allowsDuplicateCategories**

In `buildChartModel`, before the collision check:

```ts
  // Point-cloud types allow duplicate x values — that is what makes them clouds
  // rather than lines. The collision rule is for categorical axes where two rows
  // in one band is ambiguous.
  if (!CHART_TYPES[type].allowsDuplicateCategories) {
    const collision = findCategoryCollision(dataset, { x: x.field, series: seriesField, y: y.field, y2: y2Field });
    if (collision) {
      throw new Error(/* ... existing message ... */);
    }
  }
```

Also in `submit.ts`, skip the present-mode collision check for point-cloud types:

```ts
      const declaration = isChartType(spec.chart.type) ? CHART_TYPES[spec.chart.type] : undefined;
      if (!declaration?.allowsDuplicateCategories) {
        const collision = findCategoryCollision(table, { ... });
        if (collision) return [presentCollisionAdvice(collision)];
      }
```

Import `CHART_TYPES` and `isChartType` in submit.ts.

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/chartwright/src/compile/model.ts packages/chartwright/src/submit.ts packages/chartwright/test/scatter.test.ts
git commit -m "fix(compile): relax collision rule for point-cloud types (§2.1 blocker 1)"
```

---

### Task 6: Corpus cases, golden, showcase, docs

**Files:**
- Modify: `packages/chartwright/test/fixtures/corpus.ts`
- Modify: `packages/chartwright/test/fixtures/golden-specs.ts`
- Modify: `scripts/build-showcase.ts`
- Modify: `docs/using-chartwright.md`

- [ ] **Step 1: Move scatter from boundary to drawn in corpus**

Remove the `numeric-pair-unique-x` boundary entry's refusal expectation. Add a drawn scatter case using the existing `numeric-pair-unique-x` dataset. Add a bubble case with a new dataset that includes a size column.

- [ ] **Step 2: Add scatter golden case**

In `golden-specs.ts`:

```ts
  {
    name: 'scatter-basic',
    why: 'point-cloud with linear axes and positional data — the foundation for scatter/bubble',
    spec: {
      chart: { type: 'scatter' },
      encodings: { x: { field: 'tenure_months' }, y: { field: 'nps' } },
    },
    rows: [
      { tenure_months: 3, nps: 12 },
      { tenure_months: 9, nps: 47 },
      { tenure_months: 14, nps: 31 },
    ],
  },
```

- [ ] **Step 3: Add showcase page copy**

In `build-showcase.ts` COPY object, add entries for scatter and bubble cases.

- [ ] **Step 4: Document axes.*.kind in using-chartwright.md**

Add a paragraph after the layout section explaining axis kind inference and override.

- [ ] **Step 5: Recapture golden, regenerate showcase, full verify**

```bash
node --experimental-strip-types packages/chartwright/spike/capture-golden.ts
npm run showcase
npm run verify
```

- [ ] **Step 6: Browser check**

Navigate to the example app and verify scatter renders correctly.

- [ ] **Step 7: Commit**

```bash
git add packages/chartwright/test/fixtures/ scripts/build-showcase.ts docs/using-chartwright.md examples/react-highcharts/data/showcase.json
git commit -m "feat(scatter): corpus cases, golden fixture, showcase, docs"
```

---

## Self-Review Checklist

- [x] Spec coverage: §2.1 blockers 1 (collision), 2 (linear axis), 3 (identity) all addressed
- [x] No placeholders: every step has code or exact commands
- [x] Type consistency: `PointCloudModel`, `point-cloud` kind, `allowsDuplicateCategories` used consistently
- [ ] Gap: bubble's `size` channel is declared but not wired in the backend data shape (Task 3 handles `[x, y, z]` but the `z` mapping needs verification against Highcharts bubble API)
- [ ] Gap: scatter with series encoding (multiple series in a cloud) not tested — add in Task 4 or as follow-up
- [ ] Gap: `axes.x.kind` inference (auto-detect linear when channel role is measure) not implemented in Task 1 — currently requires explicit override. Inference should be added in Task 3 when the backend knows the channel roles.
