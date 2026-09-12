/**
 * The page's few shared primitives.
 *
 * Kept in one file and deliberately plain: this example exists to show how chartwright is
 * wired up, and a component library would be noise around the thing being demonstrated.
 * Everything is inline style for the same reason — no CSS file to read before the example
 * makes sense.
 */
import type { ReactNode } from 'react';

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ask' | 'present' | 'good' | 'bad' }) {
  const tones: Record<string, { background: string; border: string; color: string }> = {
    neutral: { background: '#f6f8fa', border: '#d8dee4', color: '#444' },
    ask: { background: '#ddf4ff', border: '#9ecbff', color: '#0a3069' },
    present: { background: '#fff8c5', border: '#f0d68a', color: '#7a5c00' },
    good: { background: '#dafbe1', border: '#a7e0b5', color: '#0f5323' },
    bad: { background: '#ffebe9', border: '#ffc1bc', color: '#8e1519' },
  };
  const style = tones[tone] ?? tones.neutral;
  return (
    <span
      style={{
        fontSize: 11,
        padding: '2px 7px',
        borderRadius: 999,
        border: `1px solid ${style?.border}`,
        background: style?.background,
        color: style?.color,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

export function Table({ input }: { input: Array<Record<string, unknown>> }) {
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

/** A labelled block: the page reads as a set of answers rather than a wall of prose. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 14 }}>{children}</div>
    </div>
  );
}

export function Pre({ children, maxHeight = 320 }: { children: string; maxHeight?: number }) {
  return (
    <pre
      style={{
        background: '#f6f8fa',
        padding: 12,
        borderRadius: 8,
        overflow: 'auto',
        maxHeight,
        fontSize: 12,
        margin: '8px 0 0',
      }}
    >
      {children}
    </pre>
  );
}

export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>{summary}</summary>
      {children}
    </details>
  );
}

export function SectionHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 40, borderTop: '1px solid #d8dee4', paddingTop: 20 }}>
      <h2 style={{ fontSize: 19, margin: '0 0 6px' }}>{title}</h2>
      <div style={{ color: '#555', fontSize: 14, maxWidth: 800 }}>{children}</div>
    </section>
  );
}
