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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileToHighcharts } from '../packages/chartwright/src/compile/index.ts';
import { CORPUS } from '../packages/chartwright/test/fixtures/corpus.ts';
import type { Row } from '../packages/chartwright/src/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(root, 'render-out');

/** The cases worth drawing: those a declared type can express today. */
const cases = CORPUS.filter((entry) => entry.spec !== undefined && entry.today.outcome === 'compiles');

type Rendered = { series: number; points: number; marks: number; error?: string };

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

  const failures: string[] = [];
  let drawn = 0;

  for (const entry of cases) {
    const label = `${entry.dataset.name}-${entry.spec?.chart.type ?? 'none'}`;
    const { options } = compileToHighcharts(entry.spec as never, entry.dataset.rows as Row[]);

    // Rendered in the page, with the container cleared first: without that, a second chart
    // would stack onto the first and every count after the first would be wrong.
    const rendered: Rendered = await page.evaluate((chartOptions) => {
      const container = document.getElementById('chart');
      if (!container) return { series: 0, points: 0, marks: 0, error: 'no container' };
      container.innerHTML = '';
      try {
        const chart = window.Highcharts.chart(container, chartOptions);
        const series = chart.series ?? [];
        // "Something was actually drawn" has to be an assertion, not an eyeball: nobody looks
        // at the screenshots in CI either. Counting the marks inside the series groups is the
        // cheapest honest version of it — a chart that threw silently, or a series with no
        // renderable data, leaves this at zero while still producing a valid SVG skeleton.
        const marks = Array.from(container.querySelectorAll('.highcharts-series')).reduce(
          (total, group) => total + group.querySelectorAll('path, rect, circle, text').length,
          0,
        );
        return {
          series: series.length,
          points: series.reduce((total: number, one: { data?: unknown[] }) => total + (one.data?.length ?? 0), 0),
          marks,
        };
      } catch (error) {
        return { series: 0, points: 0, marks: 0, error: (error as Error).message };
      }
    }, options);

    const failed =
      rendered.error !== undefined ||
      rendered.marks === 0 ||
      rendered.series !== entry.today.series ||
      rendered.points !== (entry.today.series ?? 1) * (entry.today.points ?? 0);

    if (failed) {
      failures.push(
        `${label}: ${
          rendered.error ??
          (rendered.marks === 0
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
