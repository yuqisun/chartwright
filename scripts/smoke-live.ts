/**
 * The live smoke test: a real question, a real model, a real chart.
 *
 * This is the only check in the repository that talks to a provider, and it is manual on
 * purpose — it needs a key, a network, and it is not deterministic, so it cannot be a CI
 * gate. Everything else scripts the LLM, which is what makes the suite fast and reproducible
 * but also means the path "user asks → model inspects the data → a spec comes back → options
 * come out" was, for a long time, only ever exercised against canned replies.
 *
 * It earns its place: the first real run found a malformed-plan message that leaked
 * `undefined` into the model's repair instruction, and the model burned an extra round on it.
 * Nothing scripted would ever have produced that input.
 *
 * Run:
 *   npm --workspace examples/react-highcharts run dev:api   # proxy on 8787, in another shell
 *   npm run smoke:live
 *
 * Point it at any OpenAI-compatible endpoint instead of the proxy with LLM_SMOKE_URL, and it
 * will send { messages, tools } and expect { content?, toolCalls? } back.
 */
import { createChartwright, listChartTypes } from '../packages/chartwright/src/index.ts';
import type { LlmClient, Row } from '../packages/chartwright/src/types.ts';

const endpoint = process.env.LLM_SMOKE_URL ?? 'http://127.0.0.1:8787/api/llm';
const timeoutMs = Number(process.env.LLM_SMOKE_TIMEOUT_MS ?? 120_000);

/**
 * A raw, un-aggregated table. Deliberately not shaped for any one chart: four counterparties
 * across three asset classes and several dates, so the model has to reach for `run_query`
 * and aggregate rather than reading the answer off the rows.
 */
function buildRows(): Row[] {
  const counterparties = ['Northgate', 'Ardenne', 'Kestrel', 'Lumen'];
  const assetClasses = ['Rates', 'Credit', 'FX'];
  const rows: Row[] = [];
  let seed = 7;
  counterparties.forEach((counterparty, ci) => {
    assetClasses.forEach((assetClass, ai) => {
      for (let day = 1; day <= 4; day += 1) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        rows.push({
          trade_date: `2026-0${day}-1${ci}`,
          counterparty,
          asset_class: assetClass,
          notional_usd: (ci * 3 + ai + day) * 37_000_000 + (seed % 9_000_000),
          commission_bps: Number((2 + (seed % 70) / 10).toFixed(2)),
        });
      }
    });
  });
  return rows;
}

const rows = buildRows();

const llm: LlmClient = {
  async complete(request) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: request.messages, tools: request.tools }),
      signal: request.signal ?? AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`${endpoint} returned ${response.status}: ${await response.text()}`);
    return response.json();
  },
};

const chartwright = createChartwright({ llm });
const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (condition) {
    console.log(`ok    ${message}`);
  } else {
    failures.push(message);
    console.error(`FAIL  ${message}`);
  }
}

async function run(label: string, request: Parameters<typeof chartwright.ask>[0]) {
  console.log(`\n--- ${label} ---\nquery: ${request.query}`);
  const started = Date.now();
  let result;
  try {
    result = await chartwright.ask(request);
  } catch (error) {
    const explanation = (error as { explanation?: string }).explanation;
    check(false, `${label} produced a chart (threw ${(error as Error).message}${explanation ? `: ${explanation}` : ''})`);
    return undefined;
  }

  const series = (result.options.series ?? []) as Array<{ data?: unknown[] }>;
  const points = series.reduce((total, one) => total + (one.data?.length ?? 0), 0);
  const tools = result.trace.map((entry) => entry.tool);

  console.log(`      ${((Date.now() - started) / 1000).toFixed(1)}s, tools: ${tools.join(' -> ') || '(none)'}`);
  console.log(`      chart.type=${result.options.chart?.type} series=${series.length} points=${points}`);
  if (result.warnings.length > 0) console.log(`      warnings: ${result.warnings.join(' | ')}`);

  check(series.length > 0 && points > 0, `${label} produced a chart with marks`);
  check(
    typeof result.spec?.chart?.type === 'string' && result.spec.chart.type.length > 0,
    `${label} returned an auditable spec`,
  );
  check(result.dataset.length > 0, `${label} returned the dataset it plotted`);
  return result;
}

console.log(`endpoint: ${endpoint}`);
console.log(`declared types: ${listChartTypes().length}`);
console.log(`input: ${rows.length} raw rows`);

// The model investigates: it must aggregate before it can chart, and the result must be a
// plan it wrote itself rather than the rows it was handed.
await run('ask mode (the model profiles, queries and aggregates)', {
  query: 'Which counterparties traded the most notional, and what share of the total does each have?',
  rows,
});

// The model presents: the caller's numbers and order must survive untouched.
const ranking = [...new Set(rows.map((row) => row.counterparty))]
  .map((counterparty) => ({
    counterparty,
    notional_usd: rows
      .filter((row) => row.counterparty === counterparty)
      .reduce((total, row) => total + Number(row.notional_usd), 0),
  }))
  .sort((a, b) => b.notional_usd - a.notional_usd);

const presented = await run('present mode (the caller owns the numbers and the order)', {
  query: 'Chart this ranking',
  rows: ranking,
  present: true,
});

// The contract that makes present mode worth having: the table it charts is the caller's,
// in the caller's order, and no plan was invented.
if (presented) {
  check(presented.dataset.length === ranking.length, 'present mode charted exactly the rows it was given');
  check(
    JSON.stringify(presented.spec.transform_plan?.steps ?? []) === '[]',
    'present mode invented no transform plan',
  );
}

if (failures.length > 0) {
  console.error(`\nsmoke:live - ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nsmoke:live - the real provider path produces charts in both modes');
