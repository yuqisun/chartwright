/**
 * One supported case: the input, the data, the mode, what to expect, and the chart.
 *
 * The card exists because a chart on its own teaches nothing about the library. Seeing the
 * query that produced it, the table it ran on, whether the model was allowed to reshape that
 * table, and what the result was *supposed* to look like, is what makes the difference between
 * "here is a picture" and "here is what this library does".
 *
 * The badge in the corner is a check the page makes on itself: the compiled options are
 * compared against the count the corpus states, so a card that silently drew the wrong shape
 * says so instead of looking fine. The browser-rendered version of that check runs in CI.
 */
import { Badge, Disclosure, Field, Pre, Table } from '../ui.tsx';
import { caseMatchesCorpus } from '../showcase.ts';
import type { ShowcaseCase } from '../showcase.ts';
import { ChartView } from './ChartView.tsx';

export function ShowcaseCard({ one, onRendered }: { one: ShowcaseCase; onRendered?: (ok: boolean) => void }) {
  const matches = caseMatchesCorpus(one);
  const rows = one.data.rows.length;

  return (
    <article
      style={{
        border: '1px solid #d8dee4',
        borderRadius: 10,
        padding: '14px 18px 18px',
        marginBottom: 20,
        background: '#fff',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Badge>{one.chartType}</Badge>
        <Badge tone={one.mode}>{one.mode === 'present' ? 'present' : 'ask'}</Badge>
        <code style={{ fontSize: 12, color: '#555' }}>
          {one.data.name} · {rows} {rows === 1 ? 'row' : 'rows'}
        </code>
        <span style={{ marginLeft: 'auto' }}>
          {matches ? (
            <Badge tone="good">
              options ✓ {one.expected.series} × {one.expected.points}
            </Badge>
          ) : (
            <Badge tone="bad">options ✗ did not match the corpus</Badge>
          )}
        </span>
      </header>

      <Field label="Input">{one.query}</Field>
      <Field label={`Mode: ${one.mode}`}>{one.modeWhy}</Field>
      <Field label="Expected">{one.expects}</Field>
      <Field label="What the data stresses">{one.data.why}</Field>

      <div style={{ marginTop: 12 }}>
        <ChartView options={one.options as never} height={300} onRendered={onRendered} />
      </div>

      <Disclosure summary={`The ${rows} ${rows === 1 ? 'row' : 'rows'} it ran on`}>
        <Table input={one.data.rows} />
      </Disclosure>

      <Disclosure summary="The neutral spec — replay it with no model in the loop">
        <Pre>{JSON.stringify(one.spec, null, 2)}</Pre>
      </Disclosure>

      <Disclosure summary="The compiled Highcharts options, data already bound">
        <Pre>{JSON.stringify(one.options, null, 2)}</Pre>
      </Disclosure>
    </article>
  );
}
