/**
 * The chart-selection matrix: does the model pick a chart type that suits the question?
 *
 * This page exists because nothing else could answer that. The showcase below shows all 14
 * declared types, but from specs written by hand with no model in the loop; the agent demo runs
 * a model but never says what type was expected, so a wrong pick looked exactly like a right
 * one. Here every query states the types that would be honest answers, and the page reports
 * what came back against them.
 *
 * It observes the library and changes nothing about it. The ask path is the same browser client
 * the agent demo uses, so what is being tested is the real thing rather than a parallel
 * implementation of it.
 */
import { useState } from 'react';
import { createChartwright, listChartTypes } from 'chartwright';

import { DATASETS } from '../datasets.ts';
import { createBrowserClient } from '../llm/browserClient.ts';
import { DATASET_META, PRESETS } from '../presets.ts';
import type { ChartPreset } from '../presets.ts';
import { showcaseCapabilities } from '../showcase-modules.ts';
import { Badge, SectionHeading } from '../ui.tsx';
import { ChartView } from './ChartView.tsx';

/**
 * One client for the page, not one per run.
 *
 * `capabilities` is passed rather than left out, and that is deliberate: it is the library's
 * own handshake for "these are the types my bundle can actually draw", and this app's bundle is
 * the one `showcase-modules.ts` imports modules for. Importing that file is also what loads
 * those modules here — the same generated file the main page uses, so a type that gains a module
 * needs no edit on either page.
 *
 * Leaving it out would offer the model types this bundle cannot render, and a run would then
 * fail at render time rather than at selection time, which is not what this page measures.
 */
const chartwright = createChartwright({ llm: createBrowserClient(), capabilities: showcaseCapabilities });

/**
 * One run, as a discriminated union rather than a bag of optional fields.
 *
 * `idle` and `error` must not be confusable: a query that never ran and a query whose provider
 * call failed are different facts, and rendering the second as the first would let a broken
 * proxy read as "the model picked nothing".
 */
type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | {
      status: 'done';
      picked: string;
      /**
       * `readonly string[]`, not the library's `ChartType[]`: `picked` is whatever the compiler
       * reported, and comparing it against a narrower type would need a cast that asserts the
       * very thing this page is checking. A string comparison keeps the check honest.
       */
      accepts: readonly string[];
      seconds: number;
      warnings: string[];
      options: Record<string, unknown>;
    };

const ok = (state: RunState): boolean => state.status === 'done' && state.accepts.includes(state.picked);

/** The types a query could satisfy, in the library's declaration order. */
function groupKey(preset: ChartPreset): string {
  return preset.accepts.join('|');
}

export function TypeMatrix() {
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const declared = listChartTypes();

  const setRun = (id: string, state: RunState) => setRuns((prev) => ({ ...prev, [id]: state }));

  async function run(preset: ChartPreset) {
    setRun(preset.id, { status: 'running' });
    const dataset = DATASETS[preset.dataset];
    const started = performance.now();
    try {
      const result = await chartwright.ask({
        query: preset.query,
        rows: dataset.rows,
        present: preset.mode === 'present',
        ...(dataset.description ? { dataDescription: dataset.description } : {}),
        ...(dataset.columns ? { columns: dataset.columns } : {}),
      });
      setRun(preset.id, {
        status: 'done',
        picked: String(result.spec.chart.type),
        accepts: preset.accepts,
        seconds: (performance.now() - started) / 1000,
        warnings: result.warnings,
        options: result.options as Record<string, unknown>,
      });
    } catch (error) {
      const explanation = (error as { explanation?: string }).explanation;
      setRun(preset.id, {
        status: 'error',
        message: `${(error as Error).message}${explanation ? ` — ${explanation}` : ''}`,
      });
    }
  }

  // Coverage is derived from the runs, not stored: a type is "produced" when some run picked it
  // and that was acceptable. Nothing here is a claim about the library; it is a claim about what
  // was observed in this session, which is why the strip clears with the results.
  const produced = new Set<string>();
  let runCount = 0;
  let mismatchCount = 0;
  for (const preset of PRESETS) {
    const state = runs[preset.id];
    if (state?.status !== 'done') continue;
    runCount += 1;
    // Widened to `readonly string[]` on purpose: `ChartType[]` and the string the compiler
    // reported do not overlap as far as `includes` is concerned, and narrowing with a cast would
    // assert the very thing being checked.
    const accepts: readonly string[] = preset.accepts;
    if (accepts.includes(state.picked)) produced.add(state.picked);
    else mismatchCount += 1;
  }

  const coverageOf = (type: string): 'produced' | 'not-producible' | 'untested' => {
    const mine = PRESETS.filter((preset) => (preset.accepts as readonly string[]).includes(type));
    if (mine.length === 0) return 'untested';
    if (produced.has(type)) return 'produced';
    const allRun = mine.every((preset) => (runs[preset.id] ?? { status: 'idle' }).status === 'done');
    return allRun ? 'not-producible' : 'untested';
  };

  const groups = [...new Map(PRESETS.map((preset) => [groupKey(preset), preset.accepts])).entries()];

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1040, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>Chart selection — can the model pick a type that fits?</h1>
      <p style={{ color: '#555', marginTop: 0, maxWidth: 800 }}>
        Each query below states every chart type that would be an honest answer, runs the real agent against real rows, and
        reports what came back. Run them one at a time and read the verdict — a ✗ names the types that were acceptable and
        why, so a wrong pick is a finding rather than a surprise.
      </p>
      <nav style={{ display: 'flex', gap: 16, fontSize: 14, margin: '16px 0 0' }}>
        <a href="/">← The showcase</a>
        <span style={{ color: '#666' }}>This page needs a key and calls your provider.</span>
      </nav>

      <SectionHeading title="Coverage">
        Every type the library declares, and whether this session has seen it produced. Taken from{' '}
        <code>listChartTypes()</code>, not written out here, so a newly declared type appears without an edit.
      </SectionHeading>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
        {declared.map((entry) => {
          const state = coverageOf(entry.name);
          const tone = state === 'produced' ? '#e6f4ea' : state === 'not-producible' ? '#fff4e5' : '#f6f8fa';
          const mark = state === 'produced' ? '✓' : state === 'not-producible' ? '·' : '—';
          const title =
            state === 'produced'
              ? `${entry.name}: produced by a run, and that was acceptable`
              : state === 'not-producible'
                ? `${entry.name}: every query that accepts it has run, and none produced it`
                : `${entry.name}: at least one query accepting it has not been run`;
          return (
            <span
              key={entry.name}
              title={title}
              style={{ background: tone, border: '1px solid #d8dee4', borderRadius: 4, padding: '2px 8px', fontSize: 13 }}
            >
              {mark} {entry.name}
            </span>
          );
        })}
      </div>

      <p style={{ margin: '12px 0 0', fontSize: 14, color: '#444' }}>
        <strong>
          {produced.size} of {declared.length} types produced
        </strong>{' '}
        · {runCount} of {PRESETS.length} queries run ·{' '}
        {mismatchCount === 0 ? 'no mismatches' : `${mismatchCount} mismatch${mismatchCount === 1 ? '' : 'es'}`}
        {runCount > 0 && (
          <button onClick={() => setRuns({})} style={{ marginLeft: 12, fontSize: 13 }}>
            Clear results
          </button>
        )}
      </p>

      {groups.map(([key, accepts]) => (
        <section key={key} style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>{accepts.join(' · ')}</h2>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: '#666' }}>
            {accepts.length === 1
              ? 'One type suits this question.'
              : `Any of these is an honest answer — no wording separates them.`}
          </p>
          {PRESETS.filter((preset) => groupKey(preset) === key).map((preset) => (
            <PresetRow
              key={preset.id}
              preset={preset}
              state={runs[preset.id] ?? { status: 'idle' }}
              onRun={() => void run(preset)}
            />
          ))}
        </section>
      ))}
    </main>
  );
}

function PresetRow({ preset, state, onRun }: { preset: ChartPreset; state: RunState; onRun: () => void }) {
  const meta = DATASET_META[preset.dataset];
  const running = state.status === 'running';
  const verdict = ok(state);
  const border = state.status === 'idle' ? '#e3e6ea' : verdict ? '#c3ddc3' : '#f0b7b3';
  const background = state.status === 'idle' ? '#fff' : verdict ? '#f6fbf6' : '#fff7f6';

  return (
    <article style={{ border: `1px solid ${border}`, background, borderRadius: 6, padding: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <button onClick={onRun} disabled={running} style={{ fontSize: 13, padding: '3px 10px' }}>
          {running ? 'Running…' : state.status === 'done' ? 'Run again' : 'Run'}
        </button>
        <span style={{ flex: 1, minWidth: 260 }}>{preset.query}</span>
        <Badge tone={preset.mode === 'present' ? 'present' : 'ask'}>{preset.mode}</Badge>
        <span style={{ fontSize: 12, color: '#666' }}>
          {meta.label} · {meta.rows} rows
        </span>
      </div>

      {state.status === 'idle' && <p style={{ margin: '8px 0 0', fontSize: 13, color: '#777' }}>Not run.</p>}

      {state.status === 'error' && (
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#a4302a' }}>
          <strong>Could not run:</strong> {state.message}
          <br />
          <span style={{ color: '#777' }}>A transport failure, not a wrong pick — this stays unrun.</span>
        </p>
      )}

      {state.status === 'done' && (
        <>
          <p style={{ margin: '8px 0 0', fontSize: 13 }}>
            <strong>Picked {state.picked}</strong> {verdict ? '✓' : '✗'}{' '}
            <span style={{ color: '#666' }}>
              (acceptable: {state.accepts.join(', ')}) · {state.seconds.toFixed(1)}s
            </span>
          </p>
          {!verdict && (
            <p style={{ margin: '6px 0 0', fontSize: 13, background: '#fff1f0', padding: '6px 10px', borderRadius: 4 }}>
              {preset.why}
            </p>
          )}
          {state.warnings.length > 0 && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#8a6d00' }}>
              <strong>Warnings:</strong> {state.warnings.join(' | ')}
            </p>
          )}
          <div style={{ marginTop: 8 }}>
            <ChartView options={state.options as never} height={260} />
          </div>
        </>
      )}
    </article>
  );
}
