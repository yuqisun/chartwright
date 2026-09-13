/**
 * The chart-type declaration: the one place a type is declared.
 *
 * Everything that used to be written out separately is derived from here — the gate
 * the compiler applies, the JSON-schema enum the model submits against, the list the
 * two tool descriptions quote, the list both refusal messages name, and the channels
 * the validator requires. `docs/spec-extension-plan.md` §Evidence counts eleven such
 * sites across five files; deriving them is what makes type #4 cheap instead of a
 * scavenger hunt, and what makes forgetting one impossible rather than silent.
 *
 * What a declaration is *not*: a mapper. The backend still decides what each type
 * draws as, because that knowledge is library-specific and belongs in `backends/`.
 * The declaration says what the type *is*; the mapping decision is guarded by
 * `test/chart-types.test.ts` until P1 moves it into this table as a `libraryType`.
 *
 * Deliberately absent for now, because nothing reads them yet and a field no test can
 * reach is the mistake this project already deleted once (`value_type`, see
 * `compile/model.ts`): `key` (how emphasis addresses a mark — `datumKey` still derives
 * it), `forbidden` (channels a type must not carry) and `module` (which Highcharts
 * module a consumer must load, which the support matrix will surface when the first
 * module-dependent type lands). P1 adds each when a type needs it.
 */
import type { CapabilitySource } from '../types.ts';
import type { ColorRole } from './theme.ts';

/** A channel a spec can carry. Every one is a `{ field }` reference into the one table. */
export type ChannelName = 'x' | 'y' | 'y2' | 'series' | 'size' | 'low' | 'high';

/**
 * Every channel, as a runtime list.
 *
 * Keyed by the union so that adding a `ChannelName` without adding it here is a
 * compile error rather than a channel the validator silently never looks at.
 */
const CHANNEL_SET: Record<ChannelName, true> = { x: true, y: true, y2: true, series: true, size: true, low: true, high: true };
export const CHANNEL_NAMES = Object.keys(CHANNEL_SET) as readonly ChannelName[];

/** What a channel *means* for one type — the same `y` is a height for a bar and a colour for a heatmap. */
export type ChannelRole = 'category' | 'measure' | 'series';

/**
 * A chart-level property a type may or may not honour.
 *
 * Declared per type because "stacked" is a fact about a bar or an area, not about a pie: a spec
 * that asks a pie to stack is asking for something the type cannot mean, and the validator says
 * so rather than quietly drawing an unstacked pie.
 */
export type Modifier = 'stacking' | 'polar' | 'hole' | 'compact' | 'type2';

/** The neutral model shape that builds a type. A new kind is a project; a new type inside one is not. */
export type ChartKind = 'categorical' | 'part-to-whole' | 'matrix' | 'point-cloud';

export type ChartTypeSpec = {
  kind: ChartKind;
  channels: Partial<Record<ChannelName, ChannelRole>>;
  /** Channels the spec must carry. The validator reads this, and the message it emits names the channel. */
  required: readonly ChannelName[];
  /** Chart-level properties this type honours, and refuses when asked for one it does not. */
  modifiers: readonly Modifier[];
  /** Two rows competing for one category is an error for most types and the point of others. */
  allowsDuplicateCategories: boolean;
  /**
   * Highcharts modules a consumer must load for this type, as import paths.
   *
   * Documentation, surfaced by `listChartTypes()` — the library never imports them, because it
   * never imports Highcharts. It matters because the failure without them happens in the
   * consumer's process (Highcharts error 17), where no test of ours can see it. A test checks
   * that every path listed here exists in the installed package, so this cannot rot into a
   * plausible-looking wrong instruction.
   */
  modules?: readonly string[];
  /**
   * Which theme roles this type colours itself from.
   *
   * A fact about the type, not about its kind: a heatmap's measure is a ramp while a
   * bar's series are a palette, and the same `y` channel means the two. The backend
   * reads this instead of branching on the kind a second time, and a test asserts every
   * declared type names roles the default theme can resolve — so a type cannot declare
   * a colour need nobody satisfies.
   */
  colorRoles: readonly ColorRole[];
};

/** Every type so far is banded on x and measured on y, split optionally by a third column. */
const categorical = {
  kind: 'categorical',
  channels: { x: 'category', y: 'measure', y2: 'measure', series: 'series' },
  required: ['x', 'y'],
  modifiers: ['stacking', 'polar', 'compact', 'type2'],
  allowsDuplicateCategories: false,
  colorRoles: ['series.categorical'],
} as const;

export const CHART_TYPES = {
  bar: categorical,
  line: categorical,
  spline: categorical,
  area: categorical,
  areaspline: categorical,
  pie: {
    kind: 'part-to-whole',
    channels: { x: 'category', y: 'measure' },
    required: ['x', 'y'],
    // A pie has no axis to stack along and nothing to wrap around a circle; `hole` is the
    // modifier that makes it a donut, and a small pie is a legitimate sparkline.
    modifiers: ['hole', 'compact'],
    allowsDuplicateCategories: false,
    colorRoles: ['series.categorical'],
  },
  heatmap: {
    kind: 'matrix',
    // The same three channels as a bar, read differently: x is the column, series the row, and
    // the measure is drawn as colour rather than as length. That is why a heatmap needed no new
    // channel — only a type that says what the channels mean here.
    channels: { x: 'category', series: 'category', y: 'measure' },
    // `series` is required: one dimension makes this a badly drawn bar chart, and the point of a
    // matrix is that a cell is a pair.
    required: ['x', 'series', 'y'],
    modifiers: ['compact'],
    // Duplicate (x, series) pairs are still an error: a cell holds one value, which is exactly
    // what the collision rule already enforces for bars.
    allowsDuplicateCategories: false,
    modules: ['highcharts/modules/heatmap', 'highcharts/modules/coloraxis'],
    // The measure is the colour here, so the role is the ramp and not the palette: a
    // categorical palette on a heatmap would turn an ordered measure into unrelated hues.
    colorRoles: ['series.sequential'],
  },
  scatter: {
    kind: 'point-cloud',
    channels: { x: 'measure', y: 'measure', series: 'series' },
    required: ['x', 'y'],
    modifiers: ['compact'],
    // Two points can share an x value — that is normal for a cloud, not a collision.
    allowsDuplicateCategories: true,
    colorRoles: ['series.categorical'],
  },
  bubble: {
    kind: 'point-cloud',
    channels: { x: 'measure', y: 'measure', size: 'measure', series: 'series' },
    required: ['x', 'y', 'size'],
    modifiers: ['compact'],
    allowsDuplicateCategories: true,
    modules: ['highcharts/highcharts-more'],
    colorRoles: ['series.categorical'],
  },
  columnrange: {
    kind: 'categorical',
    channels: { x: 'category', low: 'measure', high: 'measure', series: 'series' },
    required: ['x', 'low', 'high'],
    modifiers: ['compact'],
    allowsDuplicateCategories: false,
    colorRoles: ['series.categorical'],
    modules: ['highcharts/highcharts-more'],
  },
  arearange: {
    kind: 'categorical',
    channels: { x: 'category', low: 'measure', high: 'measure', series: 'series' },
    required: ['x', 'low', 'high'],
    modifiers: ['compact'],
    allowsDuplicateCategories: false,
    colorRoles: ['series.categorical'],
    modules: ['highcharts/highcharts-more'],
  },
  areasplinerange: {
    kind: 'categorical',
    channels: { x: 'category', low: 'measure', high: 'measure', series: 'series' },
    required: ['x', 'low', 'high'],
    modifiers: ['compact'],
    allowsDuplicateCategories: false,
    colorRoles: ['series.categorical'],
    modules: ['highcharts/highcharts-more'],
  },
  errorbar: {
    kind: 'categorical',
    channels: { x: 'category', low: 'measure', high: 'measure', series: 'series' },
    required: ['x', 'low', 'high'],
    modifiers: ['compact'],
    allowsDuplicateCategories: false,
    colorRoles: ['series.categorical'],
    modules: ['highcharts/highcharts-more'],
  },
  dumbbell: {
    kind: 'categorical',
    channels: { x: 'category', low: 'measure', high: 'measure', series: 'series' },
    required: ['x', 'low', 'high'],
    modifiers: ['compact'],
    allowsDuplicateCategories: false,
    colorRoles: ['series.categorical'],
    modules: ['highcharts/highcharts-more'],
  },
} as const satisfies Record<string, ChartTypeSpec>;

/**
 * What this version can draw, for a consumer deciding whether it is enough.
 *
 * `modules` is what makes the list actionable rather than merely informative: a type whose module
 * a consumer has not loaded fails at render time in their process, not in ours.
 */
export function listChartTypes(): Array<{
  name: ChartType;
  kind: ChartKind;
  requires: readonly ChannelName[];
  honours: readonly Modifier[];
  modules: readonly string[];
  colorRoles: readonly ColorRole[];
}> {
  return CHART_TYPE_NAMES.map((name) => {
    // Typed as the general shape rather than the literal one, so an optional field like `modules`
    // is visible here whether or not every declaration has it.
    const declaration: ChartTypeSpec = CHART_TYPES[name];
    return {
      name,
      kind: declaration.kind,
      requires: declaration.required,
      honours: declaration.modifiers,
      modules: declaration.modules ?? [],
      colorRoles: declaration.colorRoles,
    };
  });
}

export type ChartType = keyof typeof CHART_TYPES;

/** The declared types, in declaration order — the order every list derived from them appears in. */
export const CHART_TYPE_NAMES = Object.keys(CHART_TYPES) as readonly ChartType[];

/**
 * Own-property check rather than `in`: a submitted `type: 'toString'` must not be
 * treated as declared just because `Object.prototype` has an opinion.
 */
export function isChartType(type: string): type is ChartType {
  return Object.prototype.hasOwnProperty.call(CHART_TYPES, type);
}

/**
 * Narrows a list of names to the declared types, in declaration order.
 *
 * Declaration order rather than the caller's, so the panel the model sees is the same
 * shape whatever order the consumer listed its bundle in. Unknown names are returned
 * separately rather than dropped: the caller decides whether to warn (a partial list) or
 * refuse (a list that resolves to nothing).
 */
export function resolveAvailableTypes(names: readonly string[]): { available: ChartType[]; unknown: string[] } {
  const wanted = new Set(names);
  const available = CHART_TYPE_NAMES.filter((name) => wanted.has(name));
  const unknown = [...new Set(names.filter((name) => !isChartType(name)))];

  if (available.length === 0) {
    throw new Error(
      names.length === 0
        ? `no chart types are available: capabilities resolved to an empty list, and a run could never finish without one. Omit capabilities to accept the declared types (${CHART_TYPE_NAMES.join(', ')}).`
        : `no chart types are available: capabilities named ${unknown.join(', ')}, which this version does not declare. The declared types are ${CHART_TYPE_NAMES.join(', ')}.`,
    );
  }

  return { available, unknown };
}

export type CapabilityResolution = {
  available: readonly ChartType[];
  warnings: string[];
};

/**
 * Resolves the consumer's answer about what its bundle can draw.
 *
 * Called per request, so a lazy source can follow the route the user is on. No source at
 * all means every declared type, which is what this library did before capabilities
 * existed — the option is additive.
 */
export async function resolveCapabilities(source?: CapabilitySource): Promise<CapabilityResolution> {
  if (source === undefined) return { available: CHART_TYPE_NAMES, warnings: [] };

  const names = typeof source === 'function' ? await source() : source;
  const { available, unknown } = resolveAvailableTypes(names);

  return {
    available,
    warnings: unknown.map(
      (name) =>
        `capabilities named '${name}', which this version does not declare; it will not be offered to the model`,
    ),
  };
}
