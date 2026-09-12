/**
 * The example page, in three zones.
 *
 *   1. **What is supported today** — generated. Every declared chart type, drawn from options
 *      compiled into the page, each card carrying the input, the data, the mode and what to
 *      expect. No key, no network: open the page and it is all there. `npm run showcase`
 *      regenerates it from the corpus and the compiler, and fails if a declared type is missing.
 *   2. **The boundary** — the shapes with no type yet, and the ones the compiler refuses today,
 *      each with what it is waiting for. "Can I use this?" deserves an answer on the page.
 *   3. **Run the agent** — the real thing, which needs a key, and is the only part of the page
 *      that calls out to a provider.
 *
 * The split is deliberate. A demo that can only be seen by spending tokens is a demo nobody
 * looks at, so the library's actual surface is shown without a model in the loop, and the model
 * is shown separately where its behaviour is the subject.
 */
import { AgentDemo } from './components/AgentDemo.tsx';
import { BoundarySection } from './components/BoundarySection.tsx';
import { ShowcaseCard } from './components/ShowcaseCard.tsx';
import { showcase } from './showcase.ts';
import { SectionHeading } from './ui.tsx';

export function App() {
  const byType = Object.entries(showcase.counts.byType)
    .map(([type, count]) => `${type}×${count}`)
    .join(', ');

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1040, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>chartwright — React + Highcharts</h1>
      <p style={{ color: '#555', marginTop: 0, maxWidth: 800 }}>
        Ask for a chart in plain language, get chart-library options back with the data already bound. The model never
        writes Highcharts configuration, and the browser never holds an API key.
      </p>

      <nav style={{ display: 'flex', gap: 16, fontSize: 14, margin: '16px 0 0' }}>
        <a href="#supported">Supported today ({showcase.counts.supported} cases)</a>
        <a href="#boundary">The boundary ({showcase.counts.boundary})</a>
        <a href="#agent">Run the agent</a>
      </nav>

      <div id="supported">
        <SectionHeading title={`Supported today — ${showcase.types.length} chart types, ${showcase.counts.supported} cases`}>
          Every card below is generated from the corpus and the compiler (<code>npm run showcase</code>): the query, the
          data, the mode and the expectation all come from that one file, so this page cannot drift from what the library
          does. The generator refuses to run unless every declared type appears — {byType}. Nothing here needs a key: the
          options are compiled into the page, and the badge on each card is the page checking the options against the
          corpus's own expectation.
        </SectionHeading>
      </div>

      <div style={{ marginTop: 20 }}>
        {showcase.supported.map((one) => (
          <ShowcaseCard key={one.id} one={one} />
        ))}
      </div>

      <div id="boundary">
        <SectionHeading title={`The boundary — ${showcase.counts.boundary} shapes that are not drawn above`}>
          These are corpus cases too: shapes a consumer will ask for, with the data they would need. Each says whether the
          compiler refuses it today or whether no declared type can express it, and what it is waiting for. Nothing is
          hidden here on purpose — a gap found on this page is a scoping decision, and the same gap found in production is
          a broken promise.
        </SectionHeading>
      </div>

      <div style={{ marginTop: 20 }}>
        <BoundarySection />
      </div>

      <div id="agent">
        <SectionHeading title="Run the agent — needs a key, and calls your provider">
          The zones above show the compiler and the charts. This one shows the other half: a model investigating a table
          with local tools, shaping it with a query plan, submitting a spec, and repairing one the compiler rejects. Each
          demo says which data it hands over, in which mode, and what each preset should come back with — so a wrong
          answer is visible instead of plausible.
        </SectionHeading>
      </div>

      <div style={{ marginTop: 20 }}>
        <AgentDemo />
      </div>

      <footer style={{ marginTop: 48, paddingTop: 16, borderTop: '1px solid #d8dee4', fontSize: 13, color: '#666' }}>
        The library is zero-dependency; this example adds React, Vite and Highcharts. What leaves the tab is a profile of
        your columns plus the rows the model asks to preview — never the table.
      </footer>
    </main>
  );
}
