/**
 * Prompt assembly.
 *
 * Kept in one place and in English on purpose: the prompt is part of the
 * product's behaviour, and it is the piece most likely to need tuning once we
 * see real model output. No few-shot examples yet — add them when a real
 * failure shows what the model actually gets wrong, rather than guessing now.
 *
 * Two modes, and the difference is not decoration. In `present` mode the model
 * has no tool that can change the caller's rows, so the prompt must not suggest
 * one — not even obliquely, by explaining how to shape a table. What it does say
 * is what the model is still free to decide, because a prompt that only forbids
 * things produces timid charts.
 */
import type { Column, ToolMode } from './types.ts';

/** True in both modes: the invariants of the protocol, not of the mode. */
const SHARED_RULES = [
  "- You only ever see summaries and small previews of the data. The complete table stays in the caller's process",
  '  and is bound into the chart by the compiler. Do not ask for it, and do not try to reproduce it in your reply.',
  '- Never emit chart-library options, code, SQL, or file paths.',
  '- For `bar`, set `chart.orientation` to "horizontal" when category labels are long or there are many categories',
  '  (a top-N by name, for instance); otherwise leave it vertical.',
  '- If the user asks to highlight, emphasise, mark or grey out specific items (the largest, the worst, the top 3),',
  '  express it with `emphasis` and DECLARE THE CONDITION — `{ "when": { "op": "top_k", "k": 1, "field": "<measure>" },',
  '  "style": { "tone": "highlight" } }`. The compiler finds the matching rows in the full data, so never look a value',
  '  up and never hard-code a category you happened to see in a preview. Use tone "muted" to fade everything else.',
  '- If the request genuinely cannot be answered with the available columns, say so in one short sentence and stop',
  '  without calling submit_spec. Do not guess or invent columns.',
];

/** Where the columns to chart come from — the one rule that differs in kind. */
const MODE_RULES: Record<ToolMode, string[]> = {
  ask: ['- `encodings.x` and `encodings.y` must name columns that exist in the table produced by your last run_query.'],
  present: ['- `encodings.x` and `encodings.y` must name columns of the table you were given.'],
};

const ASK_INTRO = [
  'You turn a natural-language request into a chart spec. You do this by investigating the data with tools,',
  'then submitting a spec. You never write chart-library configuration, and you never compute values yourself.',
  '',
  'How to work:',
  '1. You are given the column names and types. Call describe_table when you need the full profile — null rates,',
  '   distinct-value counts, numeric ranges, time spans, and a few sample values per column.',
  '2. Use run_query to shape the data into exactly the table the chart needs (aggregate, filter, sort, limit, derive, binTime).',
  '   For anything about the largest, smallest, best or worst items, put a sort BEFORE the limit: a limit that',
  '   follows an aggregate without a sort keeps an arbitrary subset, and such a plan is rejected.',
  '3. Call submit_spec once, when the table is right.',
];

const PRESENT_INTRO = [
  'You turn a natural-language request into a chart spec for a table the caller has already prepared. You do this',
  'by looking at the data with tools, then submitting a spec. You never write chart-library configuration, and you',
  'never compute values yourself.',
  '',
  'How to work:',
  '1. You are given the column names and types. Call describe_table when you need the full profile — null rates,',
  '   distinct-value counts, numeric ranges, time spans, and a few sample values per column.',
  '2. Call submit_spec once, when you know which columns to chart.',
  '',
  'The rows are final. Do not aggregate, filter, limit, reorder or derive anything — you have no tool that could,',
  'and the order they are in is the order to show. Do not ask for different rows, and do not recompute a column:',
  'every figure you need is already there, and several of them are averages, ratios, distinct counts or maxima,',
  'which is exactly why they are not yours to redo.',
  '',
  'What you decide: the chart type, which column is the x axis and which is the measure, the orientation, the',
  'title, and any emphasis. If the request is about the biggest, the worst or the top three, that is emphasis —',
  'express it as a condition and let the compiler find the rows.',
];

export function buildSystemPrompt(mode: ToolMode = 'ask'): string {
  return [
    ...(mode === 'present' ? PRESENT_INTRO : ASK_INTRO),
    '',
    'Hard rules:',
    ...MODE_RULES[mode],
    ...SHARED_RULES,
  ].join('\n');
}

/**
 * The user prompt carries only the shape of the data — names and types.
 *
 * The full profile is deliberately *not* included: it is available as the
 * `describe_table` tool, so a request that never needs it (most of them) does
 * not pay for it in tokens, while a request that does need it can ask.
 */
export function buildUserPrompt(query: string, dataset: { rowCount: number; columns: Column[] }): string {
  return [
    'Request:',
    query,
    '',
    'Dataset:',
    JSON.stringify({ rowCount: dataset.rowCount, columns: dataset.columns }),
  ].join('\n');
}
