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
 * `compile/model.ts`): `modifiers` (stacking, polar, hole), `key` (how emphasis
 * addresses a mark — `datumKey` still derives it) and `forbidden` (channels a type
 * must not carry). P1 adds each when a type needs it.
 */
import type { CapabilitySource } from '../types.ts';

/** A channel a spec can carry. Every one is a `{ field }` reference into the one table. */
export type ChannelName = 'x' | 'y' | 'series';

/**
 * Every channel, as a runtime list.
 *
 * Keyed by the union so that adding a `ChannelName` without adding it here is a
 * compile error rather than a channel the validator silently never looks at.
 */
const CHANNEL_SET: Record<ChannelName, true> = { x: true, y: true, series: true };
export const CHANNEL_NAMES = Object.keys(CHANNEL_SET) as readonly ChannelName[];

/** What a channel *means* for one type — the same `y` is a height for a bar and a colour for a heatmap. */
export type ChannelRole = 'category' | 'measure' | 'series';

/** The neutral model shape that builds a type. A new kind is a project; a new type inside one is not. */
export type ChartKind = 'categorical' | 'part-to-whole';

export type ChartTypeSpec = {
  kind: ChartKind;
  channels: Partial<Record<ChannelName, ChannelRole>>;
  /** Channels the spec must carry. The validator reads this, and the message it emits names the channel. */
  required: readonly ChannelName[];
  /** Two rows competing for one category is an error for most types and the point of others. */
  allowsDuplicateCategories: boolean;
};

export const CHART_TYPES = {
  bar: {
    kind: 'categorical',
    channels: { x: 'category', y: 'measure', series: 'series' },
    required: ['x', 'y'],
    allowsDuplicateCategories: false,
  },
  line: {
    kind: 'categorical',
    channels: { x: 'category', y: 'measure', series: 'series' },
    required: ['x', 'y'],
    allowsDuplicateCategories: false,
  },
  pie: {
    kind: 'part-to-whole',
    channels: { x: 'category', y: 'measure' },
    required: ['x', 'y'],
    allowsDuplicateCategories: false,
  },
} as const satisfies Record<string, ChartTypeSpec>;

export type ChartType = keyof typeof CHART_TYPES;

/** The declared types, in declaration order — the order every list derived from them appears in. */
export const CHART_TYPE_NAMES = Object.keys(CHART_TYPES) as readonly ChartType[];

/** The set an unrecognised type is held to, since there is no declaration to read. Derived, not written. */
export const DEFAULT_REQUIRED_CHANNELS: readonly ChannelName[] = [
  ...new Set(Object.values(CHART_TYPES).flatMap((declaration) => declaration.required as readonly ChannelName[])),
];

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
