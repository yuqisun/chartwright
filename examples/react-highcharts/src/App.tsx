import type { AgentEvent, AskResult, Row } from 'chartwright';
import { createChartwright } from 'chartwright';
import { useRef, useState } from 'react';

import { ChartView } from './components/ChartView';
import { counterpartySummary, monthlyActivity, rows } from './data';
import { createBrowserClient } from './llm/browserClient';

/**
 * The whole integration, in one place:
 *
 *   1. build a keyless LLM client (the key lives in the node proxy),
 *   2. hand it to chartwright once,
 *   3. `ask()` — with an optional progress callback — and render `result.options`.
 *
 * Everything else here is UI.
 */
const chartwright = createChartwright({ llm: createBrowserClient() });

const ASK_PRESETS = [
  'Which 10 counterparties have the largest traded notional?',
  'How has monthly traded notional developed, split by asset class?',
  'Which venues have the most failed settlements?',
  'What share of total notional does each asset class represent?',
  'Show the top counterparties and fade the rest so the big three stand out',
];

const PRESENT_PRESETS = [
  'Which counterparty traded the most notional?',
  'Chart the traded notional by counterparty',
  'Which counterparty pays the highest commission?',
  'Keep the ranking, but fade everything except the top three',
];

const MONTHLY_PRESETS = [
  'How has traded notional developed over the six months?',
  'Chart the average settlement lag by month',
  'Which month had the most failed settlements?',
];

/**
 * The three demos differ in what they hand over, and one of them differs in `present`.
 *
 * `ask` hands over 800 raw executions and lets the model shape them with queries.
 * The other two hand over a result the caller already produced — grouped, ranked,
 * final — where the model has no tool that can change it.
 */
type DemoId = 'ask' | 'present' | 'monthly';

type Demo = {
  id: DemoId;
  label: string;
  blurb: string;
  rows: Row[];
  presets: string[];
  present: boolean;
  /** The caller's own words about the table, and about any column that misleads. */
  dataDescription?: string;
  columns?: Array<{ name: string; description?: string }>;
};

const DEMOS: Demo[] = [
  {
    id: 'ask',
    label: 'Ask the data',
    blurb:
      '800 raw post-trade executions. The model investigates with tools, shapes the table with a query plan, ' +
      'and the compiler binds the result into the chart.',
    rows,
    presets: ASK_PRESETS,
    present: false,
  },
  {
    id: 'present',
    label: 'Present a result',
    blurb:
      'Twelve rows a query already produced: grouped by counterparty, ranked by notional, with an average and a ' +
      'distinct count in them. It chooses how to draw this table — and has no tool that could change it.',
    rows: counterpartySummary,
    presets: PRESENT_PRESETS,
    present: true,
    // Descriptions are optional, and this is the case they exist for: nothing in the
    // values says that one column is an average and another is a count of distinct
    // venues, and a model that assumes otherwise would recompute them.
    dataDescription: 'One row per counterparty, already aggregated and ranked by traded notional descending.',
    columns: [
      { name: 'notional_usd', description: 'Sum over that counterparty’s trades. Additive.' },
      { name: 'avg_commission_bps', description: 'Average commission in basis points. NOT additive.' },
      { name: 'distinct_venues', description: 'How many different venues that counterparty used. NOT additive.' },
      { name: 'largest_trade_usd', description: 'The largest single trade. A maximum, not a sum.' },
      { name: 'settled_share_pct', description: 'Settled as a percentage of that counterparty’s trades.' },
    ],
  },
  {
    id: 'monthly',
    label: 'Present a time series',
    blurb:
      'Six rows, one per month — a series rather than a set of categories. This is where "do not recompute my ' +
      'columns" bites hardest: the settlement lag is an average, so a second pass over it would be wrong by an ' +
      'amount too small to see.',
    rows: monthlyActivity,
    presets: MONTHLY_PRESETS,
    present: true,
    dataDescription: 'One row per month of 2026, already aggregated from the execution feed.',
    columns: [
      { name: 'notional_usd', description: 'Sum of traded notional in that month. Additive.' },
      {
        name: 'avg_settlement_lag_days',
        description:
          'Average settlement lag in days. NOT additive: averaging these six numbers is not the half-year average.',
      },
      { name: 'failed_settlements', description: 'How many settlements failed in that month.' },
    ],
  },
];

/** One line of human-readable progress per agent event. */
function describeEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'round_start':
      return `round ${event.round}`;
    case 'assistant_text':
      return `model: ${event.text.replace(/\s+/g, ' ').slice(0, 120)}`;
    case 'tool_call':
      return `→ ${event.name} ${JSON.stringify(event.args).slice(0, 110)}`;
    case 'tool_result':
      return `← ${event.name} (${event.ms} ms) ${JSON.stringify(event.summary).slice(0, 110)}`;
    case 'warning':
      return `! ${event.message}`;
    case 'assistant_delta':
      return `… ${event.text}`;
    default:
      return event.type;
  }
}

/**
 * What `run_query` did, read off the trace rather than asserted.
 *
 * The interesting outcome in present mode is not "the model behaved" but "it tried and
 * could not", which is only visible if the attempt is traced — so the UI reports the
 * trace it was given instead of a claim about how the library behaves.
 */
function queryToolVerdict(trace: AskResult['trace']): string {
  const attempts = trace.filter((entry) => entry.tool === 'run_query');
  if (attempts.length === 0) return 'not called';
  const refused = attempts.every((entry) => {
    const result = entry.result as { error?: unknown; summary?: unknown } | undefined;
    return result?.error !== undefined && result.summary === undefined;
  });
  return refused ? `refused ×${attempts.length}` : `ran ×${attempts.length}`;
}

export function App() {
  const [demoId, setDemoId] = useState<Demo['id']>('ask');
  const demo = DEMOS.find((candidate) => candidate.id === demoId) ?? (DEMOS[0] as Demo);
  const [query, setQuery] = useState(demo.presets[0] as string);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Switching demos starts over: a transcript from the other one would be noise. */
  function switchTo(next: Demo) {
    setDemoId(next.id);
    setQuery(next.presets[0] as string);
    setResult(null);
    setProgress([]);
    setError(null);
  }

  async function ask(followUp: boolean) {
    setBusy(true);
    setError(null);
    setProgress([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const asked = await chartwright.ask({
        query,
        rows: demo.rows,
        // The one prop that separates the two demos.
        present: demo.present,
        dataDescription: demo.dataDescription,
        columns: demo.columns,
        // Stateless follow-ups: hand the previous transcript back.
        messages: followUp && result ? result.messages : undefined,
        sessionId: result?.sessionId,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'done') return;
          setProgress((previous) => [...previous, describeEvent(event)]);
        },
      });
      setResult(asked);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const isFollowUp = result !== null;

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1040, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>chartwright — React + Highcharts</h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        The browser never holds an API key, and what leaves this tab is a profile plus the rows the model asks to
        preview — not the table.
      </p>

      <section style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {DEMOS.map((candidate) => (
          <button
            key={candidate.id}
            onClick={() => switchTo(candidate)}
            disabled={busy}
            style={{
              padding: '8px 14px',
              fontSize: 14,
              cursor: 'pointer',
              fontWeight: candidate.id === demo.id ? 600 : 400,
              border: `1px solid ${candidate.id === demo.id ? '#0969da' : '#c9d1d9'}`,
              background: candidate.id === demo.id ? '#ddf4ff' : 'transparent',
              borderRadius: 6,
            }}
          >
            {candidate.label}
          </button>
        ))}
      </section>

      <p style={{ color: '#555', marginTop: 0, marginBottom: 12 }}>
        {demo.blurb}{' '}
        {demo.present ? (
          <strong>Nothing the model does can change these numbers or this order.</strong>
        ) : null}
      </p>

      <section style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {demo.presets.map((preset) => (
          <button
            key={preset}
            onClick={() => setQuery(preset)}
            disabled={busy}
            style={{ fontSize: 12, padding: '6px 10px', cursor: 'pointer' }}
          >
            {preset.length > 46 ? `${preset.slice(0, 44)}…` : preset}
          </button>
        ))}
      </section>

      <section style={{ display: 'flex', gap: 8 }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={busy}
          placeholder="Ask for a chart…"
          style={{ flex: 1, padding: 10, fontSize: 15, borderRadius: 6, border: '1px solid #c9d1d9' }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !busy) void ask(isFollowUp);
          }}
        />
        <button onClick={() => void ask(isFollowUp)} disabled={busy || query.trim() === ''} style={{ padding: '0 18px' }}>
          {busy ? 'Working…' : isFollowUp ? 'Follow up' : 'Ask'}
        </button>
        {busy && (
          <button onClick={() => abortRef.current?.abort()} style={{ padding: '0 14px' }}>
            Cancel
          </button>
        )}
        {isFollowUp && !busy && (
          <button
            onClick={() => {
              setResult(null);
              setProgress([]);
              setError(null);
            }}
            style={{ padding: '0 14px' }}
          >
            New
          </button>
        )}
      </section>

      {progress.length > 0 && (
        <pre
          style={{
            background: '#0d1117',
            color: '#c9d1d9',
            padding: 12,
            borderRadius: 8,
            fontSize: 12,
            maxHeight: 180,
            overflow: 'auto',
            marginTop: 12,
          }}
        >
          {progress.join('\n')}
        </pre>
      )}

      {error && (
        <section style={{ marginTop: 12, padding: 12, borderRadius: 8, background: '#fff5f5', border: '1px solid #ffc9c9' }}>
          <strong>Could not build a chart.</strong>
          <div style={{ fontSize: 14, marginTop: 4 }}>{error}</div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
            Check that the proxy is running (<code>npm run dev:api</code>) and that <code>LLM_API_KEY</code> is set.
          </div>
        </section>
      )}

      {result && (
        <>
          <ChartView options={result.options} />

          <section style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '16px 0' }}>
            <Stat label="plotted rows" value={result.dataset.length} />
            <Stat label="tool calls" value={result.trace.length} />
            <Stat label="query tool" value={queryToolVerdict(result.trace)} />
            <Stat label="plan steps" value={result.spec.transform_plan?.steps.length ?? 0} />
            <Stat label="warnings" value={result.warnings.length} />
          </section>

          {demo.present && (
            <p style={{ color: '#555', fontSize: 13, marginTop: 0 }}>
              Read off <code>result.trace</code>, not asserted by the UI: no <code>run_query</code> produced a table
              here, and the spec&rsquo;s plan is empty — so the chart is exactly the rows above, in the order they
              arrived.
            </p>
          )}

          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              The dataset that was plotted ({result.dataset.length} rows)
            </summary>
            <p style={{ color: '#555', fontSize: 13 }}>
              The model never received this table as a payload — at most it saw a preview of the first rows, in
              whichever mode ran. The whole table was bound into the chart here, in this tab.
            </p>
            <Table input={result.dataset} />
          </details>

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>The neutral spec (auditable artifact)</summary>
            <p style={{ color: '#555', fontSize: 13 }}>
              Replay it with <code>compileToHighcharts(spec, rows)</code> and you get the same chart, with no model in
              the loop.
            </p>
            <pre style={{ background: '#f6f8fa', padding: 12, borderRadius: 8, overflowX: 'auto', fontSize: 12 }}>
              {JSON.stringify(result.spec, null, 2)}
            </pre>
          </details>

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Tool trace</summary>
            <pre style={{ background: '#f6f8fa', padding: 12, borderRadius: 8, overflowX: 'auto', fontSize: 12 }}>
              {JSON.stringify(result.trace, null, 2)}
            </pre>
          </details>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

function Table({ input }: { input: Array<Record<string, unknown>> }) {
  const headers = Object.keys(input[0] ?? {});
  return (
    <div style={{ overflowX: 'auto', maxHeight: 320 }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} style={{ textAlign: 'left', borderBottom: '1px solid #d8dee4', padding: '6px 10px' }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {input.map((row, index) => (
            <tr key={index}>
              {headers.map((header) => (
                <td key={header} style={{ borderBottom: '1px solid #eaeef2', padding: '6px 10px' }}>
                  {row[header] === null || row[header] === undefined ? '—' : String(row[header])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
