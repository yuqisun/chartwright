# P2b: Range Family (low/high channels) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add columnrange, arearange, areasplinerange, errorbar, and dumbbell chart types by introducing `low`/`high` encoding channels and a range-aware backend mapper.

**Architecture:** Range types share the categorical model kind but need two value channels (`low` and `high`) instead of one (`y`). The data shape is `[x_index, low, high]` per point. A new `RangeModel` extends the categorical model with `lowField`/`highField` and emits paired values. The backend maps these to Highcharts' range series format. Waterfall and bullet are deferred (different data shapes).

**Tech Stack:** TypeScript, Node ≥22.6, Highcharts 12.6 (requires `highcharts-more` module for range types), TAP test runner

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/chartwright/src/types.ts` | Modify | Add `low`/`high` to encodings |
| `packages/chartwright/src/compile/chart-types.ts` | Modify | Add `low`/`high` to ChannelName; add 5 range type declarations |
| `packages/chartwright/src/compile/model.ts` | Modify | Add RangeModel type; buildRangeModel function |
| `packages/chartwright/src/compile/backends/highcharts.ts` | Modify | rangeOptions mapper |
| `packages/chartwright/src/loop.ts` | Modify | Pass low/high through assembler |
| `packages/chartwright/src/tools.ts` | Modify | Add low/high to schema |
| `packages/chartwright/test/range.test.ts` | Create | Range type tests |
| `packages/chartwright/test/fixtures/corpus.ts` | Modify | Add range corpus cases |
| `packages/chartwright/test/fixtures/golden-specs.ts` | Modify | Add range golden case |
| `scripts/build-showcase.ts` | Modify | Add range page copy |

---

### Task 1: Add `low`/`high` channels to types, schema, and assembler

**Files:**
- Modify: `packages/chartwright/src/types.ts`
- Modify: `packages/chartwright/src/compile/chart-types.ts`
- Modify: `packages/chartwright/src/tools.ts`
- Modify: `packages/chartwright/src/loop.ts`
- Create: `packages/chartwright/test/range.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { compileToHighcharts } from '../src/compile/index.ts';
import type { ChartSpec, Row } from '../src/types.ts';

test('arearange compiles with low/high channels', () => {
  const rows: Row[] = [
    { month: 'Jan', low: 10, high: 25 },
    { month: 'Feb', low: 12, high: 28 },
    { month: 'Mar', low: 15, high: 30 },
  ];
  const spec: ChartSpec = {
    chart: { type: 'arearange' },
    encodings: { x: { field: 'month' }, low: { field: 'low' }, high: { field: 'high' } },
  };
  // Must not throw during compilation.
  const result = compileToHighcharts(spec, rows);
  assert.ok(result.options, 'compilation succeeds with low/high channels');
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: TS error — `low` and `high` not in encodings type.

- [ ] **Step 3: Add low/high to types.ts encodings**

```ts
  encodings: {
    x?: Encoding;
    y?: Encoding;
    y2?: Encoding;
    /** Low value for range types (columnrange, arearange, errorbar, dumbbell). */
    low?: Encoding;
    /** High value for range types. */
    high?: Encoding;
    series?: Encoding;
    size?: Encoding;
  };
```

- [ ] **Step 4: Add low/high to ChannelName and CHANNEL_SET in chart-types.ts**

```ts
export type ChannelName = 'x' | 'y' | 'y2' | 'series' | 'size' | 'low' | 'high';
const CHANNEL_SET: Record<ChannelName, true> = { x: true, y: true, y2: true, series: true, size: true, low: true, high: true };
```

- [ ] **Step 5: Add 5 range type declarations to CHART_TYPES**

All range types use `kind: 'categorical'` (they have category x axes) but require `low` and `high` instead of `y`:

```ts
  columnrange: {
    kind: 'categorical',
    channels: { x: 'category', low: 'measure', high: 'measure', series: 'series' },
    required: ['x', 'low', 'high'],
    modifiers: ['compact'],
    allowsDuplicateCategories: false,
    colorRoles: ['series.categorical'],
    modules: ['highcharts/esm/modules/highcharts-more.js'],
  },
  arearange: {
    kind: 'categorical',
    channels: { x: 'category', low: 'measure', high: 'measure', series: 'series' },
    required: ['x', 'low', 'high'],
    modifiers: ['compact'],
    allowsDuplicateCategories: false,
    colorRoles: ['series.categorical'],
    modules: ['highcharts/esm/modules/highcharts-more.js'],
  },
  areasplinerange: {
    kind: 'categorical',
    channels: { x: 'category', low: 'measure', high: 'measure', series: 'series' },
    required: ['x', 'low', 'high'],
    modifiers: ['compact'],
    allowsDuplicateCategories: false,
    colorRoles: ['series.categorical'],
    modules: ['highcharts/esm/modules/highcharts-more.js'],
  },
  errorbar: {
    kind: 'categorical',
    channels: { x: 'category', low: 'measure', high: 'measure', series: 'series' },
    required: ['x', 'low', 'high'],
    modifiers: ['compact'],
    allowsDuplicateCategories: false,
    colorRoles: ['series.categorical'],
    modules: ['highcharts/esm/modules/highcharts-more.js'],
  },
  dumbbell: {
    kind: 'categorical',
    channels: { x: 'category', low: 'measure', high: 'measure', series: 'series' },
    required: ['x', 'low', 'high'],
    modifiers: ['compact'],
    allowsDuplicateCategories: false,
    colorRoles: ['series.categorical'],
    modules: ['highcharts/esm/modules/highcharts-more.js'],
  },
```

Note: `highcharts-more.js` may not exist as ESM. If it doesn't, omit the `modules` field for now and handle like bubble (the card will report the missing module). Check at implementation time.

- [ ] **Step 6: Add low/high to tools.ts schema**

In SUBMIT_PROPERTIES.encodings.properties:

```ts
      low: { type: 'object', required: ['field'], properties: { field: { type: 'string' } }, additionalProperties: false,
        description: 'Low value for range types (columnrange, arearange, errorbar, dumbbell).' },
      high: { type: 'object', required: ['field'], properties: { field: { type: 'string' } }, additionalProperties: false,
        description: 'High value for range types.' },
```

- [ ] **Step 7: Add low/high to loop.ts assembler**

Add to the `provided` record:

```ts
    low: candidate.encodings?.low?.field,
    high: candidate.encodings?.high?.field,
```

The existing channel loop already handles them since they're in CHANNEL_NAMES.

- [ ] **Step 8: Update SCHEMA_SAMPLES in chart-types.test.ts**

Add low/high to encodings sample so the coverage test passes.

- [ ] **Step 9: Run test, typecheck, commit**

```bash
git add ...
git commit -m "feat(types): add low/high channels for range family"
```

---

### Task 2: Range model building

**Files:**
- Modify: `packages/chartwright/src/compile/model.ts`
- Modify: `packages/chartwright/test/range.test.ts`

- [ ] **Step 1: Write failing test**

```ts
test('arearange model has low/high fields and paired data', () => {
  const rows: Row[] = [
    { month: 'Jan', low: 10, high: 25 },
    { month: 'Feb', low: 12, high: 28 },
  ];
  const spec: ChartSpec = {
    chart: { type: 'arearange' },
    encodings: { x: { field: 'month' }, low: { field: 'low' }, high: { field: 'high' } },
  };
  const { options } = compileToHighcharts(spec, rows);
  const series = options.series as Array<{ data: unknown[] }>;
  assert.equal(series.length, 1);
  // Range data is [index, low, high] for categorical x
  assert.deepEqual(series[0].data[0], [0, 10, 25]);
  assert.deepEqual(series[0].data[1], [1, 12, 28]);
});
```

- [ ] **Step 2: Implement range model building in model.ts**

Range types use `kind: 'categorical'` but don't have a `y` encoding. The existing `buildChartModel` requires `y`. Add a branch before the `if (!x || !y)` check:

```ts
  const { x, y, y2, low, high, series: seriesEnc } = spec.encodings;
  
  // Range types use low/high instead of y. They are still categorical (band x axis)
  // but their data shape is [index, low, high] rather than category-indexed values.
  const isRange = low !== undefined && high !== undefined;
  if (!x || (!y && !isRange)) throw new Error('encodings.x and encodings.y (or low+high) are required');
```

Then after the point-cloud branch and before the categorical series building, add:

```ts
  if (isRange) {
    const categories = distinctInOrder(dataset.map((row) => row[x.field]));
    const collision = findCategoryCollision(dataset, { x: x.field, series: seriesField, y: low.field });
    if (collision) {
      throw new Error(/* existing collision message */);
    }
    
    // Build series with [index, low, high] data points
    const groups = new Map<string, Row[]>();
    if (seriesField) {
      for (const row of dataset) {
        const key = String(row[seriesField]);
        const bucket = groups.get(key);
        if (bucket) bucket.push(row);
        else groups.set(key, [row]);
      }
    } else {
      groups.set(low.field, dataset);
    }
    
    const seriesValues: SeriesValues[] = [];
    for (const [name, groupRows] of groups) {
      const valueMap = new Map<string, [number, number]>();
      for (const row of groupRows) {
        valueMap.set(String(row[x.field]), [Number(row[low.field]), Number(row[high.field])]);
      }
      // Range series store [low, high] pairs instead of single values
      const values = categories.map((cat) => valueMap.get(cat) ?? null);
      seriesValues.push({ name, values: values as unknown as number[] });
    }
    
    return {
      model: {
        ...base,
        kind: 'categorical' as const,
        orientation: 'vertical' as const,
        categories,
        series: seriesValues,
        // Mark as range so the backend knows to emit [index, low, high] format
        ...(true ? { isRange: true, lowField: low.field, highField: high.field } : {}),
      },
      warnings: [],
    };
  }
```

Wait — adding `isRange` to CategoricalModel is messy. Better approach: store the range info in the base and check it in the backend. Or: create a separate RangeModel type. Let me use a simpler approach: add optional `lowField`/`highField` to Base, and the backend checks their presence.

Actually, the cleanest approach: the model stores series data as `[low, high]` tuples (using the existing SeriesValues structure with a type assertion), and the backend detects range types by checking `model.lowField !== undefined`. This avoids a new model type.

Add to Base in model.ts:

```ts
  /** Range types: the low and high field names. When present, series values are [low, high] pairs. */
  lowField?: string;
  highField?: string;
```

- [ ] **Step 3: Run test, typecheck, commit**

```bash
git commit -m "feat(compile): range model building with low/high paired data"
```

---

### Task 3: Range backend mapper

**Files:**
- Modify: `packages/chartwright/src/compile/backends/highcharts.ts`
- Modify: `packages/chartwright/test/range.test.ts`
- Modify: `packages/chartwright/test/fixtures/golden-specs.ts`

- [ ] **Step 1: Write failing tests**

```ts
test('arearange emits correct Highcharts data format', () => {
  const rows: Row[] = [
    { month: 'Jan', low: 10, high: 25 },
    { month: 'Feb', low: 12, high: 28 },
  ];
  const { options } = compileToHighcharts(
    { chart: { type: 'arearange' }, encodings: { x: { field: 'month' }, low: { field: 'low' }, high: { field: 'high' } } },
    rows,
  );
  assert.equal((options.chart as Record<string, string>).type, 'arearange');
  const series = options.series as Array<{ data: Array<[number, number, number]> }>;
  // Highcharts range format: [x_index, low, high]
  assert.deepEqual(series[0].data[0], [0, 10, 25]);
});

test('columnrange, errorbar, dumbbell all compile', () => {
  const rows: Row[] = [{ x: 'A', low: 1, high: 5 }, { x: 'B', low: 2, high: 6 }];
  for (const type of ['columnrange', 'errorbar', 'dumbbell'] as const) {
    const { options } = compileToHighcharts(
      { chart: { type }, encodings: { x: { field: 'x' }, low: { field: 'low' }, high: { field: 'high' } } },
      rows,
    );
    assert.equal((options.chart as Record<string, string>).type, type);
  }
});
```

- [ ] **Step 2: Modify categoricalOptions to handle range types**

In `categoricalOptions`, detect range types via `model.lowField !== undefined`. When range:
- Data format changes from single values to `[index, low, high]` triples
- The series data mapping uses the paired values

The key change is in the series data mapping. Currently it maps `series.values` as single numbers. For range, each value is a `[low, high]` pair that becomes `[categoryIndex, low, high]`.

- [ ] **Step 3: Add golden case, recapture, full verify, commit**

```bash
git commit -m "feat(compile): range backend mapper for columnrange/arearange/errorbar/dumbbell"
```

---

### Task 4: Corpus cases, showcase, docs

**Files:**
- Modify: `packages/chartwright/test/fixtures/corpus.ts`
- Modify: `scripts/build-showcase.ts`
- Modify: `docs/using-chartwright.md`

- [ ] **Step 1: Add range corpus cases**

Add drawn cases for arearange and columnrange using existing datasets or new ones.

- [ ] **Step 2: Add showcase COPY entries**

- [ ] **Step 3: Document range types in using-chartwright.md**

- [ ] **Step 4: Regenerate showcase, full verify, browser check, commit**

---

## Known Risks

1. **highcharts-more ESM module**: May not exist. If so, range types will fail to render in the browser (like bubble). The compiler output is correct; the rendering gap is a module availability issue.
2. **SeriesValues type mismatch**: Storing `[low, high]` pairs in a `number[]` field requires a type assertion. Consider widening SeriesValues or creating a RangeSeriesValues type.
3. **Layout derivation**: Range types have category x axes, so layout derivation applies. The low/high values don't affect label crowding.
