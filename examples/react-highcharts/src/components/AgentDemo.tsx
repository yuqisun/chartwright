/**
 * The interactive zone: the real thing, which needs a key.
 *
 * This is the half of the page that spends money and can be wrong, and it is here because the
 * generated zone above cannot show what the *agent* does — investigate a table, shape it, submit
 * a spec, repair a rejected one. Each demo says which data it hands over, in which mode, and what
 * each preset should come back with, so a wrong answer is visible rather than plausible.
 *
 * `capabilities` is set explicitly, though this app can draw every declared type, because the
 * shape of the option is the interesting part: the panel the model is offered is built from what
 * the consumer says its bundle can render, so a deployment that shipped fewer Highcharts modules
 * would list fewer types here and the model would never be offered a chart that cannot render.
 */
import { useRef, useState } from 'react';
import type { AgentEvent, AskResult } from 'chartwright';
import { createChartwright } from 'chartwright';

import { DEMOS } from '../demos.ts';
import type { Demo } from '../demos.ts';
import { showcaseCapabilities } from '../showcase-modules.ts';
import { Badge, Disclosure, Field, Pre, Stat, Table } from '../ui.tsx';
import { createBrowserClient } from '../llm/browserClient.ts';
import { ChartView } from './ChartView.tsx';

const chartwright = createChartwright({
  llm: createBrowserClient(),
  // Neutral names, never Highcharts'. This list is generated from the same declaration that decides
  // which Highcharts modules this app imports (`showcase-modules.ts`), because the two must agree:
  // offering the model a type the bundle cannot render is a chart that fails at render time.
  capabilities: showcaseCapabilities,
});

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

export function AgentDemo() {
  const [demoId, setDemoId] = useState<Demo['id']>('ask');
  const demo = DEMOS.find((candidate) => candidate.id === demoId) ?? (DEMOS[0] as Demo);
  const [query, setQuery] = useState(demo.presets[0]?.ask ?? '');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const preset = demo.presets.find((candidate) => candidate.ask === query);

  /** Switching demos starts over: a transcript from the other one would be noise. */
  function switchTo(next: Demo) {
    setDemoId(next.id);
    setQuery(next.presets[0]?.ask ?? '');
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
        // The one prop that separates the demos: is this table the caller's final numbers?
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
    <div>
      <section style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <Badge tone={demo.present ? 'present' : 'ask'}>{demo.present ? 'present: true' : 'ask mode'}</Badge>
        <code style={{ fontSize: 12, color: '#555' }}>
          {demo.dataName} · {demo.rows.length} rows
        </code>
      </div>
      <p style={{ color: '#555', marginTop: 0 }}>
        {demo.dataKind}. {demo.blurb}{' '}
        {demo.present ? <strong>Nothing the model does can change these numbers or this order.</strong> : null}
      </p>

      <section style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {demo.presets.map((one) => (
          <button
            key={one.ask}
            onClick={() => setQuery(one.ask)}
            disabled={busy}
            style={{ fontSize: 12, padding: '6px 10px', cursor: 'pointer' }}
            title={one.expects}
          >
            {one.ask.length > 46 ? `${one.ask.slice(0, 44)}…` : one.ask}
          </button>
        ))}
      </section>

      {preset ? (
        <Field label="What this preset should come back with">{preset.expects}</Field>
      ) : (
        <Field label="What this preset should come back with">
          Your own question — there is no expectation written for it, which is the honest case: the library has to
          answer something nobody anticipated.
        </Field>
      )}

      <section style={{ display: 'flex', gap: 8, marginTop: 12 }}>
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

      {progress.length > 0 && <Pre maxHeight={180}>{progress.join('\n')}</Pre>}

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
          <div style={{ marginTop: 16 }}>
            <ChartView options={result.options} />
          </div>

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
              here, and the spec&rsquo;s plan is empty — so the chart is exactly the rows that were handed over, in the
              order they arrived.
            </p>
          )}

          <Disclosure summary={`The dataset that was plotted (${result.dataset.length} rows)`}>
            <p style={{ color: '#555', fontSize: 13 }}>
              The model never received this table as a payload — at most it saw a preview of the first rows, in whichever
              mode ran. The whole table was bound into the chart here, in this tab.
            </p>
            <Table input={result.dataset} />
          </Disclosure>

          <Disclosure summary="The neutral spec (auditable artifact)">
            <p style={{ color: '#555', fontSize: 13 }}>
              Replay it with <code>compileToHighcharts(spec, rows)</code> and you get the same chart, with no model in the
              loop.
            </p>
            <Pre>{JSON.stringify(result.spec, null, 2)}</Pre>
          </Disclosure>

          <Disclosure summary="Tool trace">
            <Pre>{JSON.stringify(result.trace, null, 2)}</Pre>
          </Disclosure>

          {result.warnings.length > 0 && (
            <Disclosure summary={`Warnings (${result.warnings.length})`}>
              <ul style={{ fontSize: 13 }}>
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Disclosure>
          )}
        </>
      )}
    </div>
  );
}
