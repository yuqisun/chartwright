/**
 * Verification: does "declare a type, or the build fails" actually hold under this
 * repo's compiler settings (`erasableSyntaxOnly`, `strict`)?
 *
 * `gate-ok.ts` compiles. `gate-missing.ts` differs by one key and must fail.
 * Run with the package's own tsc options — no test framework, no new file in src/.
 */

type ChannelRole = 'category' | 'measure' | 'series' | 'low' | 'high' | 'size';

type ChartTypeSpec = {
  kind: 'categorical' | 'part-to-whole' | 'matrix' | 'point-cloud' | 'links';
  channels: Partial<Record<'x' | 'y' | 'series' | 'low' | 'high' | 'size', ChannelRole>>;
  modifiers: ReadonlyArray<'stacking' | 'polar' | 'hole' | '3d' | 'colorAxis'>;
  key: 'category' | 'category+series' | 'row';
  allowsDuplicateCategories: boolean;
};

export const CHART_TYPES = {
  bar: {
    kind: 'categorical',
    channels: { x: 'category', y: 'measure', series: 'series' },
    modifiers: ['stacking'],
    key: 'category+series',
    allowsDuplicateCategories: false,
  },
  pie: {
    kind: 'part-to-whole',
    channels: { x: 'category', y: 'measure' },
    modifiers: ['hole'],
    key: 'category',
    allowsDuplicateCategories: false,
  },
  scatter: {
    kind: 'point-cloud',
    channels: { x: 'measure', y: 'measure', series: 'series' },
    modifiers: [],
    key: 'row',
    allowsDuplicateCategories: true,
  },
} as const satisfies Record<string, ChartTypeSpec>;

export type ChartType = keyof typeof CHART_TYPES;

/** One mapper per declared type, or the build stops. */
type Mapper = (spec: unknown) => { options: Record<string, unknown> };

export const MAPPERS = {
  bar: ((spec: unknown) => ({ options: { spec } })) as Mapper,
  pie: ((spec: unknown) => ({ options: { spec } })) as Mapper,
} satisfies Record<ChartType, Mapper>;

/** The gate also has to be readable: the model's list, derived, never hand-written. */
export const TYPE_NAMES: readonly ChartType[] = Object.keys(CHART_TYPES) as ChartType[];
export const OPEN_GATE: Record<string, ChartTypeSpec> = CHART_TYPES;
export const MAPPED: Record<string, Mapper> = MAPPERS;
