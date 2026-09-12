/**
 * The generated showcase, typed, plus the one check the page can make by itself.
 *
 * `data/showcase.json` is produced by `scripts/build-showcase.ts` from the corpus and the
 * compiler (`npm run showcase`). Nothing here is hand-maintained: the list of types on the
 * page, the queries, the data, the expectations and the compiled options all come from that
 * file, and the generator refuses to produce it if a declared chart type is missing.
 *
 * That is what makes "the page shows every supported type" a property rather than a claim.
 */
import showcaseJson from '../data/showcase.json';

export type Row = Record<string, unknown>;

export type CaseData = {
  /** The dataset's name in the corpus, e.g. `sixty-categories`. */
  name: string;
  /** What this data stresses — the reason it is in the page at all. */
  why: string;
  rows: Row[];
  /** The chart shapes it can serve, today or later. */
  shapes: string[];
};

export type ShowcaseCase = {
  id: string;
  chartType: string;
  /** What a person would type. */
  query: string;
  mode: 'ask' | 'present';
  /** Why that mode, in one line. */
  modeWhy: string;
  /** What you should see, in words. */
  expects: string;
  data: CaseData;
  /** The corpus's machine-checkable expectation, which the card compares the options against. */
  expected: { series: number; points: number };
  spec: unknown;
  options: Record<string, unknown>;
};

export type BoundaryCase = {
  id: string;
  query: string;
  mode: 'ask' | 'present';
  modeWhy: string;
  expects: string;
  data: CaseData;
  reason: { kind: 'refused' | 'no-type-yet'; detail: string };
  /** For a shape no type can express: what the nearest type costs. */
  nearlyWorks?: { loses: string; spec: unknown };
};

export type Showcase = {
  note: string;
  types: string[];
  counts: { supported: number; boundary: number; byType: Record<string, number> };
  supported: ShowcaseCase[];
  boundary: BoundaryCase[];
};

export const showcase = showcaseJson as unknown as Showcase;

/**
 * What the compiled options say they will draw.
 *
 * This is the strongest check the page can make on its own: the browser-rendered version of
 * it lives in CI (`scripts/render-matrix.ts`), and duplicating that here would mean shipping
 * Playwright to the browser. Comparing the options against the corpus is still worth doing in
 * the page, because it turns each card into a report instead of a picture.
 */
export function countInOptions(options: Record<string, unknown>): { series: number; points: number } {
  const series = (options.series as Array<{ data?: unknown[] }> | undefined) ?? [];
  return {
    series: series.length,
    points: series.reduce((total, one) => total + (one.data?.length ?? 0), 0),
  };
}

export function caseMatchesCorpus(one: ShowcaseCase): boolean {
  const counted = countInOptions(one.options);
  return counted.series === one.expected.series && counted.points === one.expected.series * one.expected.points;
}
