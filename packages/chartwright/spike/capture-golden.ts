/**
 * Capture the current compiled output as the golden fixture.
 *
 * Run ONCE, before the chart-type declaration refactor, and commit the result:
 *
 *   node --experimental-strip-types packages/chartwright/spike/capture-golden.ts
 *
 * The fixture it writes is the acceptance evidence for "the refactor changed no
 * behaviour": `test/chart-types.test.ts` recompiles the same specs and compares.
 *
 * It also verifies the fixture is a faithful representation of what it captured —
 * a value that survives `JSON.stringify` -> `JSON.parse` unchanged. Without that
 * check a key whose value is `undefined` would silently vanish from the fixture and
 * the comparison would become weaker than it looks.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileToHighcharts } from '../src/compile/index.ts';
import { GOLDEN_CASES } from '../test/fixtures/golden-specs.ts';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'test', 'fixtures', 'options-golden.json');

const captured: Record<string, unknown> = {};
let unstable = 0;

for (const testCase of GOLDEN_CASES) {
  const { options, dataset, warnings } = compileToHighcharts(testCase.spec, testCase.rows);
  const value = { options, dataset, warnings };

  const roundTripped: unknown = JSON.parse(JSON.stringify(value));
  const before = JSON.stringify(value);
  const after = JSON.stringify(roundTripped);
  if (before !== after) {
    unstable += 1;
    console.log(`UNSTABLE  ${testCase.name} — a value did not survive the JSON round trip`);
  }

  captured[testCase.name] = value;
}

writeFileSync(target, `${JSON.stringify(captured, null, 2)}\n`, 'utf8');

console.log(`captured ${GOLDEN_CASES.length} cases -> ${target}`);
console.log(unstable === 0 ? 'round-trip stable: every captured value is representable in JSON' : `${unstable} unstable case(s) — fix before trusting the fixture`);
