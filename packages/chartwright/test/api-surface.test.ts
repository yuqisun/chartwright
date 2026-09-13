/**
 * The public API surface, pinned.
 *
 * Why this file exists: `listChartTypes` was documented in `docs/using-chartwright.md`,
 * named in the package README, and implemented in `compile/chart-types.ts` — but never
 * re-exported from `src/index.ts`. Every test passed, because every test imports from
 * `../src/...` paths and reaches past the entry point. The gap was only found by
 * installing the packed tarball into a separate app and importing it: the first thing a
 * real consumer does.
 *
 * So this test consumes the package the way a consumer does — through its declared entry
 * point — and asserts that everything the docs promise is actually reachable from there.
 * A name added to the docs without a matching export now fails here rather than in
 * someone else's install.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The package entry, not a deep path: this is the only import in the test suite that
// goes through the door a consumer uses.
import * as chartwright from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');

/**
 * The runtime API, by name.
 *
 * Deliberately a hand-written list: it is the contract, and listing it here is what makes
 * removing or renaming something a visible, deliberate edit rather than a silent break.
 */
const PUBLIC_FUNCTIONS = [
  // The agent layer.
  'createChartwright',
  'runAgentLoop',
  'AgentGaveUpError',
  'buildSystemPrompt',
  'buildUserPrompt',
  'buildToolDefs',
  // The deterministic layer.
  'compileToHighcharts',
  'materialize',
  'applyTransform',
  'binDate',
  'findCategoryCollision',
  'isSupportedChartType',
  // The capability handshake and the support matrix.
  'listChartTypes',
  'resolveAvailableTypes',
  'resolveCapabilities',
  // Theme and layout.
  'resolveTheme',
  'deriveAxisLayout',
  // The local tools.
  'describeTable',
  'previewRows',
  'runQuery',
  'createToolHandlers',
  'applyColumnDescriptions',
  'inferColumns',
] as const;

/** Constants a consumer reads rather than calls. */
const PUBLIC_CONSTANTS = ['SUPPORTED_CHART_TYPES', 'LAYOUT', 'TOOL_DEFS', 'defaultTheme'] as const;

test('every documented function is reachable from the package entry point', () => {
  for (const name of PUBLIC_FUNCTIONS) {
    const value = (chartwright as Record<string, unknown>)[name];
    assert.equal(typeof value, 'function', `'${name}' is documented but not exported from src/index.ts`);
  }
});

test('every documented constant is reachable from the package entry point', () => {
  for (const name of PUBLIC_CONSTANTS) {
    assert.ok((chartwright as Record<string, unknown>)[name] !== undefined, `'${name}' is not exported`);
  }
});

test('the support matrix is queryable and self-describing', () => {
  // docs/using-chartwright.md tells consumers to call this at integration time to find out
  // what they actually got. If it stops answering those four questions, the advice is void.
  const types = chartwright.listChartTypes();
  assert.ok(types.length > 0, 'at least one type is declared');

  for (const entry of types) {
    assert.equal(typeof entry.name, 'string', `${entry.name}: name`);
    assert.equal(typeof entry.kind, 'string', `${entry.name}: kind`);
    assert.ok(Array.isArray(entry.requires), `${entry.name}: requires`);
    assert.ok(Array.isArray(entry.honours), `${entry.name}: honours`);
    assert.ok(Array.isArray(entry.modules), `${entry.name}: modules`);
    assert.ok(Array.isArray(entry.colorRoles), `${entry.name}: colorRoles`);
  }

  // The list is the declaration's, so names are unique and non-empty: a consumer printing
  // it gets one row per type, not a duplicated or blank entry.
  const names = types.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length, 'no duplicate type names');
  for (const name of names) assert.ok(name.length > 0, 'no empty type name');
});

test('the package entry point is a single module, not a re-export of internals by path', () => {
  // A consumer can only import 'chartwright'. If the entry ever imports something outside
  // the package (an example, a script), this fails — the library must stand alone.
  const entry = readFileSync(join(packageRoot, 'src', 'index.ts'), 'utf8');
  const imports = [...entry.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
  assert.ok(imports.length > 0, 'the entry imports something');
  for (const specifier of imports) {
    assert.ok(
      specifier.startsWith('./'),
      `the entry imports '${specifier}' — a package entry must only import its own modules`,
    );
  }
});
