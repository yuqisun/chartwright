/**
 * Generate the showcase the example page renders: `examples/react-highcharts/data/showcase.json`.
 *
 * The page has three jobs, and this script is what keeps all three honest:
 *
 *   1. **Show every supported chart type**, with the query a person would type, the data it
 *      runs on, the mode it runs in, and what the result should look like. Written by hand
 *      in `App.tsx`, that list would be a second source of truth about which types exist —
 *      the thing this repository keeps deleting. It is generated from the corpus and the
 *      compiler instead, and the generator *fails* if a declared type is not represented.
 *   2. **Draw it**, which the page does from the compiled options in this file, so the
 *      showcase needs no API key, no network and no model: open the page and the charts are
 *      there. The agent demo is the other zone of the page and is the only part that calls
 *      out.
 *   3. **Show the boundary** — the shapes a declared type cannot express, or that the
 *      compiler refuses today — with what each one is waiting for. "Can I adopt this?"
 *      deserves an answer on the page, not only in `docs/`.
 *
 * `--check` regenerates in memory and fails if the committed file differs, so `npm run
 * verify` catches a corpus or compiler change that the page has not been rebuilt for.
 *
 * Run: npm run showcase          (writes the file)
 *      npm run showcase -- --check
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHART_TYPE_NAMES } from '../packages/chartwright/src/compile/index.ts';
import { compileToHighcharts } from '../packages/chartwright/src/compile/index.ts';
import { CORPUS, caseId, isDrawnCase } from '../packages/chartwright/test/fixtures/corpus.ts';
import { ESM_CORE, esmSpecifier, highchartsEsmFile, modulesForCases } from './highcharts-modules.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'examples', 'react-highcharts', 'data', 'showcase.json');
const modulesOutput = join(root, 'examples', 'react-highcharts', 'src', 'showcase-modules.ts');

/**
 * The words a person needs, per corpus case.
 *
 * Prose lives here rather than in the corpus because the corpus is a test fixture: what it
 * carries is the *shape* and the machine-checkable expectation, and this file adds the
 * sentence you would say out loud. Keyed by case id, and the generator refuses to run if any
 * case is missing an entry, so a new corpus case cannot quietly appear on the page without
 * someone writing down what it is for.
 */
type Copy = { query: string; mode: 'ask' | 'present'; expects: string; modeWhy: string };

const COPY: Record<string, Copy> = {
  'categories-one-measure-bar': {
    query: 'Chart revenue by region',
    mode: 'ask',
    modeWhy: 'the raw table is two columns of numbers; the model shapes it itself',
    expects: 'Three columns, East tallest at 250, then North 120 and West 80.',
  },
  'categories-one-measure-pie': {
    query: 'What share of revenue does each region contribute?',
    mode: 'ask',
    modeWhy: 'a part-to-whole question, so the same table is read as slices',
    expects: 'Three slices named after the regions, sized by revenue. No legend: a pie labels its own slices.',
  },
  'categories-split-by-series-bar': {
    query: 'Break revenue down by region and currency',
    mode: 'ask',
    modeWhy: 'one categorical column and a second column to split by',
    expects: 'Two grouped columns per region — one USD, one EUR — and a legend, because there is more than one series.',
  },
  'months-in-order-line': {
    query: 'How has traded notional developed over the five months?',
    mode: 'present',
    modeWhy: 'one row per month, already aggregated: the numbers are the caller\'s and must not be re-derived',
    expects: 'One line, five points, left to right in the order the rows were given.',
  },
  'months-with-a-gap-line': {
    query: 'Chart the monthly notional',
    mode: 'present',
    modeWhy: 'the same shape as above, and the caller still owns the order',
    expects: 'Four points, spaced evenly — and that is the honest cost: 2026-03 is absent from the data, and a category axis draws the gap as though it were not there (roadmap item 21).',
  },
  'numeric-pair-unique-x-line': {
    query: 'Plot NPS against tenure',
    mode: 'ask',
    modeWhy: 'two numeric columns, so this is the shape a scatter would want',
    expects: 'It compiles — but as four evenly spaced categories, not as a cloud. The axis has no numeric type yet, so the spacing is a lie that looks plausible. Compare the refused case below.',
  },
  'matrix-two-categories-bar': {
    query: 'Traded notional by month and region',
    mode: 'ask',
    modeWhy: 'two categorical columns and a measure',
    expects: 'Two series of three points. This is exactly the table a heatmap needs — one value per cell — which is why a heatmap would need no new channel.',
  },
  'sixty-categories-bar': {
    query: 'Rank all 60 counterparties by traded notional',
    mode: 'ask',
    modeWhy: 'one row per counterparty, no aggregation needed',
    expects: 'Sixty columns. Dense but not yet crowded: the axis stretches to about 1.5x before labels have to rotate.',
  },
  'long-category-labels-bar': {
    query: 'Revenue by desk',
    mode: 'ask',
    modeWhy: 'four rows, one per desk',
    expects: 'Four columns whose labels are far wider than their bands. This is the case layout work has to survive, and the one `chart.orientation` alone cannot fix.',
  },
  'signed-values-bar': {
    query: 'Show profit and loss by desk',
    mode: 'ask',
    modeWhy: 'a measure that can be negative',
    expects: 'Four columns around a zero baseline, two of them below it.',
  },
  'nulls-and-zeros-line': {
    query: 'How many trades per month?',
    mode: 'ask',
    modeWhy: 'the table has a null and a real zero, and they are different things',
    expects: 'Four points where 2026-02 is a real zero and 2026-03 is a gap: a null is missing data, and drawing it as zero would be a claim the data does not make.',
  },
  'degenerate-bar': {
    query: 'Chart this single row',
    mode: 'ask',
    modeWhy: 'the smallest table that can still be charted',
    expects: 'One column. The degenerate case, kept because axis arithmetic breaks here first.',
  },

  // P1's additions: three more marks for the same categorical model, then the modifiers.
  area: {
    query: 'How has notional developed over the months?',
    mode: 'ask',
    modeWhy: 'one row per month, a measure, and a question about a quantity over time',
    expects: 'The same five points as a line, filled down to the axis — which reads as a quantity accumulating rather than as a path.',
  },
  spline: {
    query: 'Smooth the monthly notional line',
    mode: 'ask',
    modeWhy: 'the request is about the shape of the line, not the data',
    expects: 'The same five points, drawn through curved segments. Nothing about the data changes: a spline is how the line is interpolated between them.',
  },
  areaspline: {
    query: 'Smoothed and filled',
    mode: 'ask',
    modeWhy: 'both of the above at once',
    expects: 'Curved segments and a filled region — the two modifiers of the mark, not two marks.',
  },
  'stacked-area': {
    query: 'Notional by region over the months, stacked',
    mode: 'ask',
    modeWhy: 'two categorical columns and a measure — the long shape the collision rule demands',
    expects: 'Two filled bands, one per region, stacked so each month reaches their total. Compare it with the same data as grouped bars: same numbers, different question.',
  },
  'percent-stacked-bar': {
    query: 'How does the regional split change month to month?',
    mode: 'ask',
    modeWhy: 'the question is about proportions of a whole, per month',
    expects: 'Two bars per month totalling 100%. This is the one modifier that rescales the data, so the compiler only applies it because the spec asked: the shape of the mix is the answer, not the size.',
  },
  donut: {
    query: 'Share of notional by desk, as a donut',
    mode: 'ask',
    modeWhy: 'a part-to-whole question, with a hole asked for',
    expects: 'Four arcs with a hole in the middle. The hole changes nothing about the data — it is the same pie, and it is a modifier rather than a type of its own.',
  },
  rose: {
    query: 'Notional by month, arranged around a circle',
    mode: 'ask',
    modeWhy: 'the same bars, with the axes wrapped',
    expects: 'A rose: five bars around a circle instead of along a line. Only the axes moved.',
  },
  sparkline: {
    query: 'A tiny inline trend of revenue',
    mode: 'ask',
    modeWhy: 'a chart for a table cell rather than for a page',
    expects: 'Three points as a bare line: no title, no axes, no legend. A sparkline is the same chart with nothing around it, which is why it is a modifier and not a type.',
  },
  'fixed-y-range': {
    query: 'Trades per month, on a fixed 0 to 40 scale',
    mode: 'ask',
    modeWhy: 'the scale is a fact about the measure, not about these four rows',
    expects: 'Four bars on a 0–40 axis although the largest value is 31. The spec said so; the compiler did not decide it.',
  },
  heatmap: {
    query: 'Show notional by month and region as a grid',
    mode: 'ask',
    modeWhy: 'two categorical columns and a measure: one row per cell',
    expects:
      'A grid of coloured cells — months along the bottom, regions up the side, notional as the colour. The same three channels as a bar chart, read differently. And note the emphasis: on a heatmap the fill *is* the value, so highlighting a cell draws a border instead of recolouring it.',
  },

  // The boundary zone: nothing below is drawn above, and each says why.
  'two-measures-different-units': {
    query: 'Show traded notional and average commission by counterparty',
    mode: 'ask',
    modeWhy: 'two measures of different units — the request that needs a second axis',
    expects: 'Columns for notional, a line for commission, on two labelled axes.',
  },
  'numeric-pair-with-duplicate-x': {
    query: 'Plot NPS against tenure for every customer',
    mode: 'ask',
    modeWhy: 'one row per customer, two numeric columns',
    expects: 'A cloud, with two points sharing 9 months.',
  },
  'raw-observations-per-group': {
    query: 'Show the spread of latency per day',
    mode: 'ask',
    modeWhy: 'many observations per group',
    expects: 'A range band or a box per day rather than a single value.',
  },
  'five-number-summary': {
    query: 'Box plot of latency by day',
    mode: 'present',
    modeWhy: 'the caller already computed low, q1, median, q3 and high — the transform DSL has no percentile',
    expects: 'One box per day, drawn from the five numbers as given.',
  },
  'flow-edges': {
    query: 'Where does notional flow between venues?',
    mode: 'ask',
    modeWhy: 'the rows are edges, not points',
    expects: 'A flow diagram from LSE to XETRA and XNYS.',
  },
  'hierarchy-two-levels': {
    query: 'Break notional down by region, then by product',
    mode: 'ask',
    modeWhy: 'two grouping levels in one table',
    expects: 'Nested rectangles: regions containing products.',
  },
};

const supported = [];
const boundary = [];
const seen = new Set<string>();

for (const entry of CORPUS) {
  const id = caseId(entry);
  if (seen.has(id)) throw new Error(`two corpus cases share the page id '${id}' — the page would show one twice`);
  seen.add(id);

  const copy = COPY[id];
  if (!copy) throw new Error(`no page copy for corpus case '${id}' — add an entry to COPY in this script`);

  const data = { name: entry.dataset.name, why: entry.dataset.why, rows: entry.dataset.rows, shapes: entry.dataset.shapes };

  if (isDrawnCase(entry)) {
    const { options } = compileToHighcharts(entry.spec, entry.dataset.rows);
    supported.push({
      id,
      chartType: entry.spec.chart.type,
      ...copy,
      data,
      expected: { series: entry.today.series, points: entry.today.points },
      spec: entry.spec,
      options,
    });
  } else {
    boundary.push({
      id,
      ...copy,
      data,
      // Why it is not drawn above, in the compiler's own words where there are words for it.
      reason:
        entry.today.outcome === 'refused'
          ? { kind: 'refused', detail: entry.today.matches }
          : { kind: 'no-type-yet', detail: entry.today.needs },
      ...(entry.nearlyWorks ? { nearlyWorks: { loses: entry.nearlyWorks.loses, spec: entry.nearlyWorks.spec } } : {}),
    });
  }
}

// "Show every supported type" has to be a property of the data, not a hope. If a type is
// declared and no case exercises it, the page would claim support it does not demonstrate.
const shownByType = new Map<string, number>();
for (const one of supported) shownByType.set(one.chartType, (shownByType.get(one.chartType) ?? 0) + 1);
const missing = CHART_TYPE_NAMES.filter((name) => !shownByType.has(name));
if (missing.length > 0) {
  throw new Error(`the showcase does not demonstrate every declared type: ${missing.join(', ')} — add a corpus case for it`);
}

const showcase = {
  note: 'Generated by scripts/build-showcase.ts from the corpus and the compiler. Do not edit by hand.',
  types: CHART_TYPE_NAMES,
  counts: { supported: supported.length, boundary: boundary.length, byType: Object.fromEntries(shownByType) },
  supported,
  boundary,
};

const serialised = `${JSON.stringify(showcase, null, 2)}\n`;

/**
 * The example's own Highcharts imports, generated from the same declarations.
 *
 * This file exists because its absence was a real bug: adding a module-dependent type gave the page
 * a heatmap card while the app imported only `highcharts`, so the card threw Highcharts error 17
 * inside a React effect and the whole page unmounted. The module list is derived, not typed out, so
 * the next module-dependent type cannot repeat it.
 *
 * `capabilities` is generated too, and for the same reason from the other side: the panel the model
 * is offered must match what this bundle can actually draw. An app that declares a type it cannot
 * render is offering a chart that fails at render time.
 */
const modules = modulesForCases(supported.map((one) => ({ spec: one.spec } as never)));
// Checked before it is written into a generated file a consumer will read: a module path that does
// not exist is an instruction that breaks someone else's build.
for (const modulePath of modules) highchartsEsmFile(root, modulePath);

/**
 * The ESM/UMD pairing, checked rather than described.
 *
 * The generated imports above are ESM, and the comment in the generated file says the core import in
 * `ChartView` matches. That sentence was prose, and prose about a pairing this fragile goes stale:
 * the failure it describes — a UMD core with an ESM module, or the reverse — is two Highcharts
 * instances, which throws at import time before any chart is drawn. So the claim is read back off
 * the file and enforced here, where it runs in `npm run verify` like everything else.
 *
 * Only binds while a type needs a module: with all types in the core build there is nothing to pair
 * with, and the example is free to import whichever build it likes.
 */
if (modules.length > 0) {
  const chartView = readFileSync(join(root, 'examples', 'react-highcharts', 'src', 'components', 'ChartView.tsx'), 'utf8');
  const coreImport = /^import Highcharts from '([^']+)';$/m.exec(chartView)?.[1];
  if (coreImport !== ESM_CORE) {
    throw new Error(
      `the example imports Highcharts from '${coreImport}', but its generated modules are ESM — expected '${ESM_CORE}'. ` +
        'Mixing the two builds gives two instances, and the module throws before drawing anything.',
    );
  }
}
const generatedModules = `/**
 * Generated by scripts/build-showcase.ts — do not edit by hand.
 *
 * The Highcharts modules the showcase needs, and the capability declaration the agent is given.
 * Both come from the chart-type declaration, so a type that needs a module imports it here
 * automatically, and the app never claims to draw something its bundle cannot render.
 *
 * The specifiers point at the **ESM** builds (see \`scripts/highcharts-modules.ts\`): this example is
 * bundled by Vite, and the UMD module file cannot see the application's Highcharts instance — it
 * throws 'Cannot read properties of undefined (reading Axis)' at import time. The core import in
 * ChartView matches, or the two would be different instances and a heatmap would fail with error 17.
 */
${modules.map((modulePath) => `import '${esmSpecifier(modulePath)}';`).join('\n') || '// Every declared type lives in the Highcharts core build: nothing to import.'}

export const showcaseCapabilities: readonly string[] = [${CHART_TYPE_NAMES.map((name) => `'${name}'`).join(', ')}];
`;

if (process.argv.includes('--check')) {
  let committed: string;
  let committedModules: string;
  try {
    committed = readFileSync(output, 'utf8');
    committedModules = readFileSync(modulesOutput, 'utf8');
  } catch {
    console.error(`showcase: ${output} or ${modulesOutput} is missing — run: npm run showcase`);
    process.exit(1);
  }
  if (committed !== serialised || committedModules !== generatedModules) {
    console.error('showcase: a committed file differs from a fresh generation — run: npm run showcase');
    process.exit(1);
  }
  console.log(`showcase: up to date (${supported.length} drawn, ${boundary.length} at the boundary)`);
  process.exit(0);
}

writeFileSync(output, serialised, 'utf8');
writeFileSync(modulesOutput, generatedModules, 'utf8');
console.log(`showcase: ${supported.length} cases drawn, ${boundary.length} at the boundary`);
console.log(`types shown: ${[...shownByType].map(([name, count]) => `${name}×${count}`).join(', ')}`);
console.log(`modules the example must load: ${modules.join(', ') || '(none)'}`);
console.log(`written: ${output}`);
console.log(`written: ${modulesOutput}`);
