/**
 * Build a self-contained HTML page that draws every corpus case, and checks itself.
 *
 * Why this exists rather than "open the example app": the example app is the right place to
 * exercise the *agent*, and it needs a dev server, an LLM key and outbound network. This page
 * exercises the *charts* — compiled options, drawn by Highcharts — and needs none of that:
 * everything is inlined, so it opens from the filesystem with no server and no build step.
 *
 * It is also not merely pictures. Each chart is checked against the same expectation the
 * corpus states, and the page reports pass or fail per case, so a human opening it sees a
 * test report rather than a gallery to squint at.
 *
 * Run: npm run gallery    (writes render-out/gallery.html)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileToHighcharts } from '../packages/chartwright/src/compile/index.ts';
import { CORPUS, caseId, isDrawnCase } from '../packages/chartwright/test/fixtures/corpus.ts';
import { highchartsModuleFile, modulesForCases } from './highcharts-modules.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'render-out', 'gallery.html');

const cases = CORPUS.filter(isDrawnCase).map((entry) => {
  const { options } = compileToHighcharts(entry.spec as never, entry.dataset.rows);
  return {
    // The corpus's own name for the case, not one built here. Building it here is what let two
    // different cases share a name and one of them silently draw the other's options — the
    // self-check at the bottom of this file is what caught it.
    id: caseId(entry),
    // The case's own name rather than the dataset's: several variants share a dataset (area,
    // spline, areaspline and a rose all run on the same months), and a report where four cards
    // are titled the same is a report you have to read twice.
    title: caseId(entry),
    kind: entry.spec?.chart.type ?? '',
    why: entry.dataset.why,
    spec: JSON.stringify(entry.spec),
    expected: { series: entry.today.series ?? 0, points: entry.today.points ?? 0 },
    options,
  };
});

const highchartsModules = modulesForCases(CORPUS.filter(isDrawnCase)).map((modulePath) => ({
  path: modulePath,
  source: readFileSync(highchartsModuleFile(root, modulePath), 'utf8'),
}));
const highcharts = readFileSync(join(root, 'node_modules', 'highcharts', 'highcharts.js'), 'utf8');

// `<` escaped so that no value in the data can close the script tag early. The JSON is
// otherwise embedded exactly as compiled.
const payload = JSON.stringify(cases).replace(/</g, '\\u003c');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>chartwright render gallery</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 24px; max-width: 1100px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.intro { margin: 0 0 20px; opacity: .75; }
  section { border: 1px solid #8884; border-radius: 8px; padding: 12px 16px 4px; margin-bottom: 18px; }
  header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  code { background: #8882; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  .why { opacity: .7; font-size: 13px; margin: 4px 0 0; }
  .verdict { margin-left: auto; font-weight: 600; }
  .pass { color: #1a7f37; } .fail { color: #c0392b; }
  .chart { height: 320px; }
  pre { background: #8881; padding: 8px; border-radius: 6px; overflow: auto; font-size: 12px; }
</style>
</head>
<body>
<h1>chartwright render gallery</h1>
<p class="intro">
  Every corpus case a declared type can express, compiled by the real compiler and drawn by
  Highcharts. Each card checks the rendered chart against the series and point counts the
  corpus expects and says so — this is a report, not a gallery.${' '}
  <span id="tally"></span>
</p>

<script>${highcharts}</script>
${highchartsModules.map((module) => `<!-- ${module.path} -->\n<script>${module.source}</script>`).join('\n')}
<script id="cases" type="application/json">${payload}</script>
<script>
  const cases = JSON.parse(document.getElementById('cases').textContent);
  let passed = 0;
  const failures = [];

  for (const one of cases) {
    const section = document.createElement('section');
    const header = document.createElement('header');
    header.innerHTML =
      '<code>' + one.kind + '</code><strong>' + one.title + '</strong>' +
      '<span class="verdict" id="verdict-' + one.id + '">…</span>';
    const why = document.createElement('p');
    why.className = 'why';
    why.textContent = one.why;
    const chart = document.createElement('div');
    chart.className = 'chart';
    section.append(header, why, chart);
    document.body.append(section);

    const verdict = document.getElementById('verdict-' + one.id);
    try {
      const drawn = Highcharts.chart(chart, one.options);
      const series = drawn.series ?? [];
      const points = series.reduce((total, s) => total + (s.data?.length ?? 0), 0);
      const wantSeries = one.expected.series;
      const wantPoints = wantSeries * one.expected.points;
      if (series.length === wantSeries && points === wantPoints) {
        passed += 1;
        verdict.textContent = '✓ ' + series.length + ' x ' + one.expected.points + ' points';
        verdict.className = 'verdict pass';
      } else {
        failures.push(one.id + ': drew ' + series.length + ' series / ' + points + ' points, expected ' + wantSeries + ' x ' + wantPoints);
        verdict.textContent = '✗ wrong shape';
        verdict.className = 'verdict fail';
      }
    } catch (error) {
      failures.push(one.id + ': ' + error.message);
      verdict.textContent = '✗ threw';
      verdict.className = 'verdict fail';
      const detail = document.createElement('pre');
      detail.textContent = String(error && error.stack ? error.stack : error);
      section.append(detail);
    }
  }

  const tally = document.getElementById('tally');
  tally.textContent = failures.length === 0
    ? passed + '/' + cases.length + ' cases passed'
    : passed + '/' + cases.length + ' passed — see below';
  tally.className = failures.length === 0 ? 'pass' : 'fail';
  if (failures.length > 0) {
    const list = document.createElement('pre');
    list.className = 'fail';
    list.textContent = failures.join('\\n');
    document.body.prepend(list);
  }
</script>
</body>
</html>
`;

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, html, 'utf8');

// Self-check: the payload must round-trip through the page's own encoding, and must equal a
// fresh compile. A gallery that silently draws the wrong options would be worse than none.
// Anchored on the element's id rather than on `</script>`, because the page has more than one.
const embeddedMatch = /<script id="cases" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
if (!embeddedMatch?.[1]) throw new Error('the gallery payload could not be read back out of the page it was written into');
const embedded: Array<{ id: string; options: unknown }> = JSON.parse(embeddedMatch[1]);
let verified = 0;
for (const one of embedded) {
  const source = CORPUS.find((entry) => caseId(entry) === one.id);
  if (!source?.spec) throw new Error(`gallery case '${one.id}' does not correspond to a corpus case`);
  const { options } = compileToHighcharts(source.spec, source.dataset.rows);
  if (JSON.stringify(options) !== JSON.stringify(one.options)) throw new Error(`gallery case '${one.id}' does not match a fresh compile`);
  verified += 1;
}

console.log(`gallery: ${embedded.length} cases, ${verified} verified against a fresh compile`);
console.log(`open: ${output}`);
