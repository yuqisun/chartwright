/**
 * Turning a refusal into something the model can act on.
 *
 * The compiler refuses plenty, and it is right to: two rows competing for one category,
 * an encoding naming a column the plan did not produce. What was wrong is *when* those
 * refusals surfaced — after the loop had ended, when the model was gone and the caller
 * held an exception instead of a chart. A submission that cannot be drawn is a turn the
 * model can take again, so it is checked here, while it is still there to try.
 *
 * Two layers, in order:
 *
 *   1. **Can the compiler build it at all?** Anything it throws becomes a rejected
 *      submission, with its own message — those messages name the offending field and
 *      list what the plan actually produced, which is exactly what a model needs.
 *   2. **Does the wording fit this run?** The compiler's advice for a category collision
 *      is "add an aggregate step in run_query". A run with no aggregation to offer must
 *      not be told that, so that one case is detected as data and said differently.
 */
import { compileToHighcharts, findCategoryCollision, materialize } from './compile/index.ts';
import type { CategoryCollision } from './compile/index.ts';
import type { ChartSpec, Row, ToolMode } from './types.ts';

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What a run that cannot aggregate should say about a collision.
 *
 * Names the column that actually distinguishes the two rows, computed from the rows
 * themselves, because "choose a different x" is not always a fix: on a table grouped by
 * country *and* asset class, moving x from one to the other collides just as hard. When
 * nothing distinguishes them, it says so rather than implying a way out exists.
 */
function presentCollisionAdvice(collision: CategoryCollision): string {
  const where = `${collision.x} = '${collision.category}'${collision.series !== undefined ? ` in series '${collision.series}'` : ''}`;

  if (collision.distinguishing.length === 0) {
    return (
      `Two rows share ${where}, and this run cannot aggregate them. No other column tells those rows ` +
      'apart, so they cannot both be plotted on a categorical axis: choose an x column whose values are ' +
      'unique for every row, or a different question.'
    );
  }

  const columns = collision.distinguishing.map((field) => `'${field}'`).join(', ');
  return (
    `Two rows share ${where}, and this run cannot aggregate them. ${columns} ` +
    `${collision.distinguishing.length === 1 ? 'tells' : 'tell'} those rows apart — put ` +
    `${collision.distinguishing.length === 1 ? 'it' : 'one of them'} in encodings.series, or choose an x ` +
    'column whose values are unique for every row in this table.'
  );
}

/**
 * The check a run applies to every submission before accepting it.
 *
 * Returns the reasons to reject, or an empty array. Passing one to `runAgentLoop` is
 * what makes "accepted" mean "a chart will come out of this" rather than "the shape
 * looked right".
 *
 * An accepted submission is compiled twice — once here, once in `ask()` to build the
 * result. Deliberate: the compile is deterministic and local, and a cache would be one
 * more thing that can disagree with the rows it was built from.
 */
export function createSubmitValidator(options: { rows: Row[]; mode: ToolMode }): (spec: ChartSpec) => string[] {
  const { rows, mode } = options;

  return (spec) => {
    if (mode === 'present') {
      let table: Row[];
      try {
        // The table the chart is drawn from is the plan's output, not the input rows.
        table = materialize(spec, rows);
      } catch (error) {
        // An unusable plan: the compiler will say so below, with more context.
        return [reasonOf(error)];
      }

      const collision = findCategoryCollision(table, {
        x: spec.encodings.x?.field ?? '',
        series: spec.encodings.series?.field,
        y: spec.encodings.y?.field,
      });
      if (collision) return [presentCollisionAdvice(collision)];
    }

    try {
      compileToHighcharts(spec, rows);
      return [];
    } catch (error) {
      return [reasonOf(error)];
    }
  };
}
