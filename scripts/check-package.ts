/**
 * The packaging gate: can a stranger install this tarball and use it?
 *
 * Why this exists. Every other check in this repository imports from `../src/...` and runs
 * under `--experimental-strip-types`. That is a different world from the one a consumer
 * lives in, and the gap between them hid two real defects at once:
 *
 *   1. the entry point was TypeScript source, which node refuses to load from
 *      `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) — the package could
 *      not be imported at all; and
 *   2. `listChartTypes` was documented, implemented, and unreachable from the entry point.
 *
 * Both passed every test in the suite. Both are obvious the moment you `npm pack`, install
 * the tarball somewhere else, and run plain `node`. So that is what this script does, in
 * CI, against the artifact that would actually be published.
 *
 * What it asserts:
 *   - `npm pack` succeeds and the file list is exactly `dist/` + README + LICENSE +
 *     package.json — no `src/`, `test/` or `spike/` leaking into a release;
 *   - a fresh project can install the tarball and `import 'chartwright'` with **plain
 *     node**: no flags, no bundler, no build step;
 *   - the import actually compiles a chart, so it is not merely resolvable;
 *   - the documented API is reachable through the package entry, not just from inside the
 *     repository, because that is the only door a consumer has.
 *
 * Run: npm run pack:check   (after `npm run build:lib`)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The only files allowed at the top level of the tarball.
 *
 * Every one of these is read by a human or by a tool before install: `dist/` is the code,
 * and the rest are what npm renders on the package page. `src/`, `test/` and `spike/` are
 * deliberately absent — the first is replaced by `dist/`, and the other two are this
 * repository's business, not a consumer's.
 */
const ALLOWED_TOP_LEVEL = ['README.md', 'CHANGELOG.md', 'LICENSE', 'package.json'];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = join(root, 'packages', 'chartwright');

/** Names the docs and the README tell consumers to call. Kept in step with `api-surface.test.ts`. */
const DOCUMENTED_API = ['createChartwright', 'compileToHighcharts', 'listChartTypes', 'runAgentLoop', 'describeTable'];

/**
 * npm, invoked through node rather than through a shell.
 *
 * `npm` cannot be spawned directly on Windows: it is `npm.cmd`, and node 22+ refuses to
 * execute a batch file without `shell: true` (the CVE-2024-27980 mitigation). But
 * `shell: true` with arguments is deprecated (DEP0190), because the arguments are then
 * concatenated rather than escaped. Running npm's own CLI script with the current node
 * binary avoids both: no shell, no warning, the same npm.
 *
 * The two candidate layouts are the ones node's installers use — npm beside the binary on
 * Windows, npm under ../lib on unix. If neither exists we fall back to the shell, which
 * works everywhere even if it is noisier.
 */
function npmCommand(args: string[]): { command: string; args: string[]; shell: boolean } {
  const nodeDir = dirname(process.execPath);
  const candidates = [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const cli = candidates.find((candidate) => existsSync(candidate));
  return cli
    ? { command: process.execPath, args: [cli, ...args], shell: false }
    : { command: 'npm', args, shell: true };
}

function run(command: string, args: string[], cwd: string, shell = false): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell });
}

function runNpm(args: string[], cwd: string): string {
  const resolved = npmCommand(args);
  return run(resolved.command, resolved.args, cwd, resolved.shell);
}

type PackFile = { path: string };
type PackResult = { filename: string; files: PackFile[] };

const failures: string[] = [];
function check(condition: boolean, message: string): void {
  if (condition) {
    console.log(`ok    ${message}`);
  } else {
    failures.push(message);
    console.error(`FAIL  ${message}`);
  }
}

// --- 1. Pack, and inspect exactly what a publish would ship -------------------------------

const packJson = runNpm(['pack', '--json', '--pack-destination', packageDir], packageDir);
const [packed] = JSON.parse(packJson) as PackResult[];
if (!packed) {
  console.error('FAIL  npm pack produced no result');
  process.exit(1);
}

const shipped = packed.files.map((file) => file.path);
console.log(`packed ${packed.filename} - ${shipped.length} files`);

check(
  shipped.every((path) => path.startsWith('dist/') || ALLOWED_TOP_LEVEL.includes(path)),
  `the tarball contains only dist/ and ${ALLOWED_TOP_LEVEL.join(', ')}`,
);
check(
  !shipped.some((path) => /(^|\/)(src|test|spike)\//.test(path)),
  'no src/, test/ or spike/ files leak into the release',
);
check(shipped.includes('dist/index.js'), 'dist/index.js is present');
check(shipped.includes('dist/index.d.ts'), 'dist/index.d.ts is present (TypeScript consumers)');
check(shipped.includes('README.md'), 'README.md is present (npm renders it)');
check(shipped.includes('LICENSE'), 'LICENSE is present');

const tarball = join(packageDir, packed.filename);

// --- 2. Install it somewhere else and import it the way a consumer does --------------------

const scratch = mkdtempSync(join(tmpdir(), 'chartwright-pack-check-'));
try {
  mkdirSync(join(scratch, 'node_modules'), { recursive: true });
  writeFileSync(
    join(scratch, 'package.json'),
    `${JSON.stringify({ name: 'pack-check', private: true, type: 'module', version: '0.0.0' }, null, 2)}\n`,
  );
  writeFileSync(
    join(scratch, 'use.mjs'),
    `import * as chartwright from 'chartwright';

const missing = ${JSON.stringify(DOCUMENTED_API)}.filter((name) => typeof chartwright[name] !== 'function');
if (missing.length > 0) {
  console.error('MISSING:' + missing.join(','));
  process.exit(1);
}

const rows = [
  { region: 'East', revenue: 250 },
  { region: 'West', revenue: 80 },
];
const { options, warnings } = chartwright.compileToHighcharts(
  { chart: { type: 'bar' }, encodings: { x: { field: 'region' }, y: { field: 'revenue' } } },
  rows,
);
if (options.chart.type !== 'column') { console.error('WRONG_TYPE:' + options.chart.type); process.exit(1); }
if (options.series[0].data.length !== 2) { console.error('WRONG_DATA'); process.exit(1); }
if (warnings.length !== 0) { console.error('UNEXPECTED_WARNINGS'); process.exit(1); }
console.log('IMPORT_OK ' + chartwright.listChartTypes().length + ' types');
`,
  );

  runNpm(['install', tarball, '--silent', '--no-audit', '--no-fund'], scratch);

  // Plain `node`, deliberately: no --experimental-strip-types, no bundler, no build step.
  // This is the exact invocation that failed when the entry point was TypeScript source.
  try {
    const output = run(process.execPath, ['use.mjs'], scratch).trim();
    check(output.startsWith('IMPORT_OK'), `plain node imports the package and compiles a chart (${output})`);
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    const firstLine = stderr.split('\n').find((line) => line.trim().length > 0) ?? (error as Error).message;
    check(false, `plain node imports the installed package (${firstLine.trim()})`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(tarball, { force: true });
}

// --- 3. Verdict ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\npack:check - ${failures.length} problem(s); this tarball is not fit to publish`);
  process.exit(1);
}
console.log('\npack:check - the tarball installs, imports under plain node, and exposes the documented API');
