import { useMemo } from 'react';

import { ChartView } from './components/ChartView';
import { inferColumns, rows } from './data';
import { DEMO_QUERY, DEMO_SPEC, placeholderCompile } from './placeholder';

export function App() {
  const columns = useMemo(() => inferColumns(rows), []);
  const { options, dataset } = useMemo(() => placeholderCompile(rows, DEMO_SPEC), []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1040, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>chartwright — React + Highcharts example</h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        Load the data, ask a question in plain language, render the returned options. Today the question is answered by a
        placeholder; Step 2 replaces it with the real agent.
      </p>

      <section style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '20px 0' }}>
        <Stat label="rows" value={rows.length} />
        <Stat label="columns" value={columns.length} />
        <Stat label="plotted rows" value={dataset.length} />
      </section>

      <section style={{ background: '#f6f8fa', border: '1px solid #d8dee4', borderRadius: 8, padding: 16 }}>
        <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>Question</div>
        <div style={{ fontSize: 17, marginTop: 4 }}>{DEMO_QUERY}</div>
      </section>

      <ChartView options={options} />

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16 }}>The dataset that was plotted</h2>
        <p style={{ color: '#555', fontSize: 14, marginTop: 0 }}>
          chartwright returns this alongside the options. The model never sees it — it only ever sees a compact summary —
          but your app can, which is what makes tooltips and tables possible.
        </p>
        <Table rows={dataset} />
      </section>

      <details style={{ marginTop: 24 }}>
        <summary style={{ cursor: 'pointer', fontSize: 16, fontWeight: 600 }}>
          The neutral chart spec behind this chart
        </summary>
        <p style={{ color: '#555', fontSize: 14 }}>
          This is the auditable artifact: replay it against the same rows and you get the same chart, with no LLM
          involved.
        </p>
        <pre style={{ background: '#f6f8fa', padding: 12, borderRadius: 8, overflowX: 'auto', fontSize: 13 }}>
          {JSON.stringify(DEMO_SPEC, null, 2)}
        </pre>
      </details>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div style={{ fontSize: 26, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

function Table({ rows: input }: { rows: Array<Record<string, unknown>> }) {
  const headers = Object.keys(input[0] ?? {});
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #d8dee4', padding: '6px 10px' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {input.map((row, i) => (
            <tr key={i}>
              {headers.map((h) => (
                <td key={h} style={{ borderBottom: '1px solid #eaeef2', padding: '6px 10px' }}>
                  {row[h] === null || row[h] === undefined ? '—' : String(row[h])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
