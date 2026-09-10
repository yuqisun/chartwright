/**
 * Semantic validation of a transform plan.
 *
 * The engine (`applyTransform`) executes whatever it is given, which is what
 * makes it small and predictable. But some plans are *meaningless* rather than
 * wrong: they run cleanly and quietly produce a chart nobody asked for. Those
 * are the ones worth refusing, because the failure is invisible in the output.
 *
 * Errors thrown here are handed back to the model as the tool result, so the
 * message is the repair instruction.
 */
import type { TransformStep } from './types.ts';

/**
 * `limit` after a reshape step, with no `sort` in between, keeps an arbitrary
 * subset: the group order coming out of an aggregate is insertion order, not
 * any order the user asked for. "Top 5 by notional" without a sort is that
 * mistake, and it looks perfectly plausible on screen.
 *
 * Limiting a raw table is left alone — that is a plain "first N rows" slice.
 */
export function validateChartPlan(steps: TransformStep[]): void {
  const limitIndex = steps.findIndex((step) => step.op === 'limit');
  if (limitIndex < 0) return;

  let lastReshape = -1;
  steps.slice(0, limitIndex).forEach((step, index) => {
    if (step.op === 'aggregate') lastReshape = index;
  });
  if (lastReshape < 0) return;

  const sortedAfterReshape = steps.slice(lastReshape + 1, limitIndex).some((step) => step.op === 'sort');
  if (!sortedAfterReshape) {
    const limit = steps[limitIndex] as Extract<TransformStep, { op: 'limit' }>;
    throw new Error(
      `"limit: ${limit.n}" follows an aggregate with no "sort" in between, so which rows survive is arbitrary. ` +
        'Add a sort before the limit — for example { "op": "sort", "by": "<measure>", "order": "desc" } — ' +
        'whenever the request is about the largest, smallest, best or worst items.',
    );
  }
}
