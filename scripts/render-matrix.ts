/**
 * The render matrix: every corpus case that compiles, drawn in a real browser.
 *
 * Why this exists at all: the data-level tests compare *values*, and nothing in this
 * repository has ever rendered a chart (`docs/spec-extension-plan.md` §5.4, roadmap item 4).
 * That leaves a whole class of failure invisible — `donut` used to emit
 * `chart.type = 'donut'`, which Highcharts does not have, and no test noticed because no
 * test drew anything. This script draws it.
 *
 * What it asserts, and deliberately does not:
 *
 *   - **it asserts** that Highcharts charts the options without throwing, and that the
 *     rendered chart holds the series and point counts the corpus says it should. That is
 *     the end-to-end claim "the data we bound is the data that got drawn".
 *   - **it asserts** that the category labels do not overlap, per regime: flat labels are
 *     measured against their neighbours on the axis, and rotated labels against the
 *     geometric guarantee the derivation makes (a band wide enough for the font it chose).
 *     Plan §5.6 puts this here because it is the one layout claim only a rendered chart
 *     can settle (`docs/spec-extension-plan.md`).
 *   - **it does not compare pixels.** Screenshots are written to `render-out/` and uploaded
 *     as CI artifacts for a human to look at. Pixel diffing across machines and font stacks
 *     is flaky, and a flaky gate gets switched off — which is worse than no gate.
 *
 * Run: node --experimental-strip-types scripts/render-matrix.ts
 * Needs a browser once: npx playwright install chromium  (CI does this)
 *
 * `RENDER_CHANNEL=chrome` (or `msedge`) uses a browser that is already installed instead
 * of downloading Playwright's own build. That is the escape hatch for a restricted
 * environment, where the browser download fails: Playwright fetches it through a child
 * process with piped stdio, which a confined sandbox denies with `spawn EPERM`. It is not
 * a fallback for CI, where the bundled build is the reproducible choice.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileToHighcharts } from '../packages/chartwright/src/compile/index.ts';
import { CORPUS, caseId, isDrawnCase } from '../packages/chartwright/test/fixtures/corpus.ts';
import { highchartsModuleFile, modulesForCases } from './highcharts-modules.ts';
import type { Row } from '../packages/chartwright/src/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(root, 'render-out');

/** The cases worth drawing: those a declared type can express today. */
const cases = CORPUS.filter(isDrawnCase);

// Two cases with one name means one screenshot silently overwrites the other, and the log stops
// being able to tell them apart — which is exactly what happened when this script built its own
// label instead of asking the corpus. Checked before a browser is launched, so it fails cheaply.
const names = new Set<string>();
for (const entry of cases) {
  const name = caseId(entry);
  if (names.has(name)) throw new Error(`two render cases are called '${name}' — give one an explicit id in the corpus`);
  names.add(name);
}

type Rendered = { series: number; points: number; marks: number; labelProblems: string[]; error?: string };

/**
 * What the rendered axis says about its own labels.
 *
 * Flat labels are checked against their neighbours directly: sorted along the axis, each
 * pair must leave a non-negative gap. Rotated labels cannot be checked by bounding box —
 * a turned label's box is wider than the space it claims — so they are checked against
 * the guarantee the derivation makes instead: at −90° a label needs one band of width for
 * its font size, at −45° it needs one band per cos 45 of it. A side axis (a heatmap's
 * rows, a horizontal bar's names) stacks its labels vertically and is checked there.
 *
 * Runs in the page, where the only true pixel measurements are.
 */
const LABEL_PROBE = `
  function labelProblems(chart, container) {
    const problems = [];
    for (const axis of chart.axes ?? []) {
      const categories = axis.categories ?? [];
      if (categories.length === 0) continue;
      const nodes = Array.from(
        container.querySelectorAll(axis.horiz ? '.highcharts-xaxis-labels text' : '.highcharts-yaxis-labels text'),
      );
      if (nodes.length === 0) continue;
      const rotation = axis.options.labels?.rotation ?? 0;
      const font = parseFloat(window.getComputedStyle(nodes[0]).fontSize) || 11;
      const band = (axis.horiz ? axis.width : axis.height) / categories.length;
      const side = axis.horiz ? 'x' : 'y';
      if (rotation === 0) {
        const rects = nodes
          .map((node) => node.getBoundingClientRect())
          .sort((a, b) => (axis.horiz ? a.left - b.left : a.top - b.top));
        for (let i = 1; i < rects.length; i += 1) {
          const gap = axis.horiz ? rects[i].left - rects[i - 1].right : rects[i].top - rects[i - 1].bottom;
          if (gap < -0.5) problems.push(side + ': labels ' + (i - 1) + ' and ' + i + ' overlap by ' + (-gap).toFixed(1) + 'px');
        }
      } else if (rotation === -90) {
        if (band + 0.5 < font) problems.push(side + ': ' + categories.length + ' vertical labels at ' + band.toFixed(1) + 'px bands need ' + font + 'px');
      } else if (rotation === -45) {
        if (band * Math.SQRT2 + 0.5 < font) problems.push(side + ': ' + categories.length + ' labels at 45 degrees need ' + (font / Math.SQRT2).toFixed(1) + 'px bands, have ' + band.toFixed(1));
      }
    }
    return problems;
  }
`;

async function main(): Promise<number> {
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    console.error(`render matrix cannot run: playwright is not installed (${(error as Error).message})`);
    console.error('install it once with: npm install -D playwright && npx playwright install chromium');
    return 1;
  }

  const channel = process.env.RENDER_CHANNEL;
  const cdpEndpoint = process.env.RENDER_CDP;
  const highcharts = readFileSync(join(root, 'node_modules', 'highcharts', 'highcharts.js'), 'utf8');
  mkdirSync(outputDir, { recursive: true });

  let browser;
  try {
    // `RENDER_CDP` attaches to a browser someone else started, over a TCP debugging port.
    // That is the only shape that works in a confined sandbox: Playwright's own launch adds
    // `--remote-debugging-pipe`, and a child with piped stdio is denied there.
    browser = cdpEndpoint
      ? await chromium.connectOverCDP(cdpEndpoint)
      : await chromium.launch(channel ? { channel } : {});
  } catch (error) {
    console.error(`render matrix cannot launch a browser (${(error as Error).message})`);
    console.error('either run: npx playwright install chromium');
    console.error('or attach to one you started: chrome --headless --remote-debugging-port=9222');
    console.error('and then: RENDER_CDP=http://127.0.0.1:9222');
    return 1;
  }

  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();
  await page.setViewportSize({ width: 960, height: 540 });
  await page.setContent('<!doctype html><html><body><div id="chart"></div></body></html>');
  await page.addScriptTag({ content: highcharts });

  // The modules the declared types need, loaded the way a consumer would have to load them.
  //
  // This is the capability story with teeth: a type whose module is missing does not fail here — it
  // fails in the consumer's browser, which is the one place this repository cannot look. The list
  // comes from the declaration, and the same helper feeds the gallery and the example, so a new
  // module-dependent type is wired everywhere by declaring it once.
  for (const modulePath of modulesForCases(cases)) {
    await page.addScriptTag({ content: readFileSync(highchartsModuleFile(root, modulePath), 'utf8') });
    console.log(`loaded module ${modulePath}`);
  }

  const failures: string[] = [];
  let drawn = 0;

  for (const entry of cases) {
    const label = caseId(entry);
    const { options } = compileToHighcharts(entry.spec as never, entry.dataset.rows as Row[]);

    // Rendered in the page, with the container cleared first: without that, a second chart
    // would stack onto the first and every count after the first would be wrong.
    const rendered: Rendered = await page.evaluate(({ chartOptions, probe }) => {
      const container = document.getElementById('chart');
      if (!container) return { series: 0, points: 0, marks: 0, labelProblems: [], error: 'no container' };
      container.innerHTML = '';
      try {
        // eslint-disable-next-line no-new-func
        new Function(probe)();
        const labelProblemsFn = (window as unknown as { labelProblems?: (c: unknown, d: HTMLElement) => string[] }).labelProblems;
        const chart = window.Highcharts.chart(container, chartOptions);
        const series = chart.series ?? [];
        // "Something was actually drawn" has to be an assertion, not an eyeball: nobody looks
        // at the screenshots in CI either. Counting the marks is the cheapest honest version of
        // it — a chart that threw silently, or a series with no renderable data, leaves this at
        // zero while still producing a valid SVG skeleton.
        //
        // Both groups, because a series does not always draw inside its own. Highcharts' own
        // tracker configuration says which do: a `scatter` declares
        // `trackerGroups: ['group', 'markerGroup', 'dataLabelsGroup']`, and the series render
        // creates that group with `plotGroup('markerGroup', 'markers', …)` — which classes it
        // `highcharts-markers`, a **sibling** of the series group. So counting only
        // `.highcharts-series` reported zero marks for a scatter that was drawn correctly: a
        // false failure on the one case whose markers live in the tooltip tracker's group.
        // Types that keep no separate marker group (a bubble, a column) are unaffected — their
        // marks are already in the series group, and a group that does not exist adds nothing.
        const marks = Array.from(
          container.querySelectorAll('.highcharts-series, .highcharts-markers'),
        ).reduce((total, group) => total + group.querySelectorAll('path, rect, circle, text').length, 0);
        return {
          series: series.length,
          points: series.reduce((total: number, one: { data?: unknown[] }) => total + (one.data?.length ?? 0), 0),
          marks,
          labelProblems: typeof labelProblemsFn === 'function' ? labelProblemsFn(chart, container) : [],
        };
      } catch (error) {
        return { series: 0, points: 0, marks: 0, labelProblems: [], error: (error as Error).message };
      }
    }, { chartOptions: options, probe: LABEL_PROBE });

    const failed =
      rendered.error !== undefined ||
      rendered.marks === 0 ||
      rendered.labelProblems.length > 0 ||
      rendered.series !== entry.today.series ||
      rendered.points !== (entry.today.series ?? 1) * (entry.today.points ?? 0);

    if (failed) {
      failures.push(
        `${label}: ${
          rendered.error ??
          (rendered.labelProblems.length > 0
            ? `labels overlap: ${rendered.labelProblems.join('; ')}`
            : rendered.marks === 0
              ? 'the chart rendered no marks at all'
              : `rendered ${rendered.series} series / ${rendered.points} points, expected ${entry.today.series} x ${entry.today.points}`)
        }`,
      );
      console.error(`FAIL  ${failures[failures.length - 1]}`);
    } else {
      drawn += 1;
      console.log(`ok    ${label} — ${rendered.series} series, ${rendered.points} points, ${rendered.marks} marks`);
    }

    await page.screenshot({ path: join(outputDir, `${label}.png`) });
  }

  await browser.close();
  writeFileSync(join(outputDir, 'summary.json'), `${JSON.stringify({ drawn, failed: failures, cases: cases.length }, null, 2)}\n`);

  if (failures.length > 0) {
    console.error(`\nrender matrix: ${failures.length} of ${cases.length} cases failed to draw as expected`);
    return 1;
  }
  console.log(`\nrender matrix: ${drawn} cases drawn, screenshots in render-out/`);
  return 0;
}

process.exit(await main());
