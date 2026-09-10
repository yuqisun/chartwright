/**
 * Prompt assembly.
 *
 * Kept in one place and in English on purpose: the prompt is part of the
 * product's behaviour, and it is the piece most likely to need tuning once we
 * see real model output. No few-shot examples yet — add them when a real
 * failure shows what the model actually gets wrong, rather than guessing now.
 */
import type { Column } from './types.ts';

export function buildSystemPrompt(): string {
  return [
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
    '',
    'Hard rules:',
    "- You only ever see summaries and small previews of the data. The complete table stays in the caller's process",
    '  and is bound into the chart by the compiler. Do not ask for it, and do not try to reproduce it in your reply.',
    '- Never emit chart-library options, code, SQL, or file paths.',
    '- `encodings.x` and `encodings.y` must name columns that exist in the table produced by your last run_query.',
    '- For `bar`, set `chart.orientation` to "horizontal" when category labels are long or there are many categories',
    '  (a top-N by name, for instance); otherwise leave it vertical.',
    '- If the request genuinely cannot be answered with the available columns, say so in one short sentence and stop',
    '  without calling submit_spec. Do not guess or invent columns.',
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
