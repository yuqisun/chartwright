/**
 * The corpus, checked against what the compiler actually does.
 *
 * This is a *characterisation* test: the expectations in `fixtures/corpus.ts` describe the
 * current compiler, including its gaps, so that closing a gap is a deliberate edit in one
 * place. It is the data-level half of the regression net; `scripts/render-matrix.ts` is the
 * other half, and it renders the same cases in a real browser.
 *
 * What it is for: the existing tests use three-row fixtures built for the three types that
 * exist. The failures that hurt are shape failures — two points at one x, sixty categories,
 * a null measure, a label longer than its band — and none of them appear in a tidy fixture.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { compileToHighcharts } from '../src/compile/index.ts';
import { CORPUS, datasets } from './fixtures/corpus.ts';

test('every dataset is used by at least one case', () => {
  const used = new Set(CORPUS.map((entry) => entry.dataset.name));
  for (const dataset of datasets) {
    assert.ok(used.has(dataset.name), `'${dataset.name}' is in the corpus but no case exercises it`);
  }
});

test('every dataset says why it is here, and what it can serve', () => {
  const names = datasets.map((dataset) => dataset.name);
  assert.equal(new Set(names).size, names.length, 'dataset names are unique, so a failure names one thing');

  for (const dataset of datasets) {
    assert.ok(dataset.rows.length > 0, `${dataset.name} has rows`);
    assert.ok(dataset.why.length > 20, `${dataset.name} explains what it stresses, not just what it is`);
    assert.ok(dataset.shapes.length > 0, `${dataset.name} says which chart shapes it can serve`);
  }
});

test('a case with no usable type says what it needs instead', () => {
  for (const entry of CORPUS) {
    if (entry.today.outcome !== 'no-type-yet') continue;
    assert.equal(entry.spec, undefined, `${entry.dataset.name}: no declared type fits, so there is no spec`);
    assert.ok(entry.today.needs.length > 20, `${entry.dataset.name}: says what it is waiting for`);
  }
});

test('each case compiles or is refused exactly as the corpus says', () => {
  for (const entry of CORPUS) {
    const label = `${entry.dataset.name} (${entry.spec?.chart.type ?? 'no type yet'})`;

    if (entry.today.outcome === 'refused') {
      assert.ok(entry.spec, `${label}: a refusal needs a spec to refuse`);
      assert.throws(
        () => compileToHighcharts(entry.spec as never, entry.dataset.rows),
        new RegExp(entry.today.matches.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `${label}: refused, and for the stated reason`,
      );
      continue;
    }

    if (entry.today.outcome === 'compiles') {
      assert.ok(entry.spec, `${label}: a compiled case needs a spec`);
      const { options } = compileToHighcharts(entry.spec as never, entry.dataset.rows);
      const series = options.series as Array<{ data: unknown[] }>;
      assert.equal(series.length, entry.today.series, `${label}: series count`);
      assert.equal(series[0]?.data.length, entry.today.points, `${label}: points in the first series`);
    }
  }
});

test('a shape with no type yet loses something specific when forced into the nearest one', () => {
  const withNearly = CORPUS.filter((entry) => entry.nearlyWorks);
  assert.ok(withNearly.length > 0, 'at least one gap is demonstrated rather than described');

  for (const entry of withNearly) {
    const nearly = entry.nearlyWorks;
    assert.ok(nearly);
    const { options } = compileToHighcharts(nearly.spec, entry.dataset.rows);
    const emitted = JSON.stringify(options);

    // Whatever the case says is lost must genuinely be absent from the output: not renamed,
    // not defaulted — absent. That is what makes this a demonstration and not a claim.
    const dropped = Object.keys(entry.dataset.rows[0] ?? {}).filter((column) => !emitted.includes(column));
    assert.ok(
      dropped.length > 0,
      `${entry.dataset.name}: expected the nearest type to drop a column (${nearly.loses}), but every column appears`,
    );
  }
});
