/**
 * Which Highcharts modules a set of corpus cases needs, and where they are on disk.
 *
 * This exists because the same derivation was written three times and one of the copies was
 * missing when it mattered: the render matrix loaded the modules a declaration names, the example
 * app did not, so the page drew a heatmap without `highcharts/modules/heatmap` and died with
 * Highcharts error 17 — the exact failure the capability story is about, in the one place that had
 * not asked the declaration. Nothing here is hardcoded: it reads `modules` off the declaration, so
 * a new module-dependent type is wired everywhere by declaring it once.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { CHART_TYPES } from '../packages/chartwright/src/compile/index.ts';
import type { CorpusCase } from '../packages/chartwright/test/fixtures/corpus.ts';

type MaybeWithModules = { modules?: readonly string[] };

/** Every module path the given cases need, in first-seen order. */
export function modulesForCases(cases: readonly CorpusCase[]): string[] {
  const needed: string[] = [];
  for (const entry of cases) {
    const type = entry.spec?.chart.type;
    if (!type) continue;
    const declaration = (CHART_TYPES as Record<string, MaybeWithModules | undefined>)[type];
    for (const modulePath of declaration?.modules ?? []) {
      if (!needed.includes(modulePath)) needed.push(modulePath);
    }
  }
  return needed;
}

/**
 * The file a module path names inside the installed Highcharts.
 *
 * Throws rather than returning a path that does not exist: a missing module means the thing being
 * built cannot draw what it claims, and finding that out here is the whole point.
 */
export function highchartsModuleFile(root: string, modulePath: string): string {
  const file = join(root, 'node_modules', `${modulePath}.js`);
  if (!existsSync(file)) throw new Error(`no such Highcharts module: '${modulePath}' (looked for ${file})`);
  return file;
}
