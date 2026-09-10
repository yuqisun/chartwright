import type { AgentEvent, AskResult } from 'chartwright';
import { createChartwright } from 'chartwright';
import { useRef, useState } from 'react';

import { ChartView } from './components/ChartView';
import { rows } from './data';
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

const PRESETS = [
  'Which 10 counterparties have the largest traded notional?',
  'How has monthly traded notional developed, split by asset class?',
  'Which venues have the most failed settlements?',
  'What share of total notional does each asset class represent?',
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

export function App() {
  const [query, setQuery] = useState(PRESETS[0] as string);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function ask(followUp: boolean) {
    setBusy(true);
    setError(null);
    setProgress([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const asked = await chartwright.ask({
        query,
        rows,
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
        Ask a question about 800 synthetic post-trade records. The model investigates with local tools; the chart data
        never leaves this tab, and the browser never holds an API key.
      </p>

      <section style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {PRESETS.map((preset) => (
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
            <Stat label="warnings" value={result.warnings.length} />
            <Stat label="session" value={result.sessionId.slice(0, 8)} />
          </section>

          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              The dataset that was plotted ({result.dataset.length} rows)
            </summary>
            <p style={{ color: '#555', fontSize: 13 }}>
              The model never saw these rows — only a summary of them. The compiler bound them into the chart.
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
