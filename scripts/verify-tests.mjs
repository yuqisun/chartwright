#!/usr/bin/env node
/**
 * Run every package's tests, one file per process.
 *
 * Two measured constraints shape this:
 *
 *   1. `node --test` spawns a child per file and the child's stdio is piped, which a
 *      restricted environment denies (`spawn EPERM`). Running each file directly avoids
 *      the runner entirely, so `npm run verify` works in a sandbox and in CI alike.
 *   2. `stdio: 'inherit'` is not a style choice: a piped child fails the same way, so the
 *      test output is passed straight through instead of captured. The exit codes are
 *      what this script reads, and it reads them per file.
 *
 * Exit code 0 only if every file passed.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every `test/*.test.ts` under `packages/*`, in a stable order. */
function testFiles() {
  const files = [];
  for (const entry of readdirSync(join(root, 'packages')).sort()) {
    const testDir = join(root, 'packages', entry, 'test');
    try {
      if (!statSync(testDir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const file of readdirSync(testDir).sort()) {
      if (file.endsWith('.test.ts')) files.push(join(testDir, file));
    }
  }
  return files;
}

const files = testFiles();
if (files.length === 0) {
  console.error('verify: no test files found — that is a broken check, not a pass');
  process.exit(1);
}

const failures = [];
for (const file of files) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', file],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) failures.push(relative(root, file));
}

if (failures.length > 0) {
  console.error(`\nverify: ${failures.length} of ${files.length} test files failed`);
  for (const file of failures) console.error(`  ${file}`);
  process.exit(1);
}

console.log(`\nverify: ${files.length} test files passed`);
