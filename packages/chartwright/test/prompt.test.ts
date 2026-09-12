import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSystemPrompt } from '../src/prompt.ts';
import { buildToolDefs, TOOL_DEFS } from '../src/tools.ts';
import type { ToolDef } from '../src/types.ts';

const names = (tools: ToolDef[]) => tools.map((tool) => tool.name);

/**
 * The vocabulary of the transform DSL.
 *
 * If any of it appears in a present-mode tool definition, the mode's guarantee
 * has a hole in it: the model has been told about a way to change the caller's
 * table. Quoted, because these strings appear in schemas as JSON keys and enum
 * values — `describe_table`'s "Returns aggregates only" is prose about a summary,
 * not an operation, and must not trip this.
 *
 * `"limit"` is deliberately absent: a preview tool bounds its own preview with a
 * `limit`, and that cannot change the charted data.
 */
const DSL_VOCABULARY = [
  '"run_query"',
  '"steps"',
  '"group_by"',
  '"measures"',
  '"aggregate"',
  '"filter"',
  '"sort"',
  '"derive"',
  '"binTime"',
];

test('ask mode offers exactly the tools that can change the table', () => {
  assert.deepEqual(names(buildToolDefs('ask')), ['describe_table', 'run_query', 'submit_spec']);
});

test('present mode offers exactly the tools that cannot', () => {
  assert.deepEqual(names(buildToolDefs('present')), ['describe_table', 'submit_spec']);
});

test('TOOL_DEFS stays the ask-mode list, for callers who import it directly', () => {
  assert.deepEqual(names(TOOL_DEFS), names(buildToolDefs('ask')));
});

test('no present-mode tool definition mentions the transform DSL', () => {
  const serialized = JSON.stringify(buildToolDefs('present'));
  for (const word of DSL_VOCABULARY) {
    assert.ok(!serialized.includes(word), `a present-mode tool definition mentions ${word}`);
  }
});

test('the ask-mode prompt sends the model to run_query, and the tool is there', () => {
  const prompt = buildSystemPrompt('ask');
  assert.match(prompt, /run_query/);
  assert.ok(names(buildToolDefs('ask')).includes('run_query'));
});

test('the present-mode prompt never names a capability the model does not have', () => {
  const prompt = buildSystemPrompt('present');
  // Identifiers, not verbs. The prompt deliberately *names* the operations it
  // forbids ("do not aggregate, filter, ..."), because that is what tells the
  // model what "final" means. What it must never do is point at a tool or a plan
  // schema it was not given.
  for (const identifier of ['run_query', 'group_by', 'measures', 'transform_plan', 'steps']) {
    assert.ok(!prompt.includes(identifier), `the present-mode prompt refers to ${identifier}`);
  }
  assert.match(prompt, /no tool that could/i, 'and it says why those operations are out of reach');
});

test('the present-mode prompt states the contract: these rows, this order', () => {
  const prompt = buildSystemPrompt('present');
  assert.match(prompt, /rows are final/i);
  assert.match(prompt, /order/i);
  assert.match(prompt, /submit_spec/);
  // It still asks for the things the model is allowed to decide.
  assert.match(prompt, /describe_table/);
  assert.match(prompt, /emphasis/);
});

test('omitting the mode means ask — the default does not change behaviour', () => {
  assert.equal(buildSystemPrompt(), buildSystemPrompt('ask'));
});
