/**
 * The theme layer: a vocabulary of roles, resolved to hex values only at the edges.
 *
 * Why this exists: until now the library's only colours were the two emphasis hexes in
 * `backends/highcharts.ts`, and everything else was a Highcharts default — a brand
 * decision made by accident, in a library whose whole premise is that the consumer
 * keeps the decisions (`docs/spec-extension-plan.md` §5.6). A theme is therefore not a
 * palette of publication presets but a set of **roles** (surface, text, structure,
 * series, emphasis) that the compiler promises and the backend spends, so a consumer's
 * brand is an override of roles rather than a fork of the compiler.
 *
 * Conventions reimplemented from flint (`docs/flint-conventions.md` §2), which arrived
 * at the same split independently: role vocabulary over hex values, composition by
 * deep merge over a default, and the **never-cycle** rule for series colours. What is
 * deliberately absent, because flint declares it and never reads it and inventing our
 * own without evidence would be worse: ramp midpoint logic, contrast validation, and
 * per-datum emphasis beyond what `emphasis.ts` already resolves.
 */

/**
 * Which colour roles a chart type consumes.
 *
 * Declared per type in `chart-types.ts` rather than inferred from the kind, because the
 * question "what does this type colour?" is a fact about the type: a heatmap's measure
 * is a ramp, a bar's series are a palette, and a future diverging type will say so here
 * before any backend code exists.
 */
export type ColorRole = 'series.categorical' | 'series.sequential';

export type ThemeRoles = {
  /** What the chart sits on. `canvas` is the whole container, `plot` the drawing area. */
  surface: { canvas: string; plot: string };
  /** Ink, in three strengths: titles, axis labels, axis titles. */
  text: { primary: string; secondary: string; muted: string };
  /** The ruler: axis line and ticks, and the grid behind the marks. */
  structure: { axis: string; grid: string };
  series: {
    /** The one-series case, so a brand colour can own the common chart. */
    single: string;
    /** Series and slice colours, in order. Six, then the overflow role takes over. */
    categorical: readonly string[];
    /**
     * What series past the palette get. Grey on purpose: cycling the palette would give
     * two series one colour, which is not a shortage of paint but a lie about the data.
     */
    overflow: string;
    /** Low and high ends of the ramp a matrix draws its measure with. */
    sequential: readonly [string, string];
  };
  /** The two tones `emphasis` can resolve to; see `emphasis.ts`. */
  emphasis: { highlight: string; muted: string };
};

export type Theme = {
  id: string;
  label: string;
  roles: ThemeRoles;
};

/**
 * What a consumer may override: any depth of the roles, merged over the default.
 *
 * Partial rather than whole because a brand arrives as "our blue and our greys", not as
 * an opinion about tick colour. Omitted groups keep the default, so an override can
 * never leave a role unresolved.
 */
export type ThemeInput = {
  id?: string;
  label?: string;
  roles?: {
    surface?: Partial<ThemeRoles['surface']>;
    text?: Partial<ThemeRoles['text']>;
    structure?: Partial<ThemeRoles['structure']>;
    series?: {
      single?: string;
      categorical?: readonly string[];
      overflow?: string;
      sequential?: readonly [string, string];
    };
    emphasis?: Partial<ThemeRoles['emphasis']>;
  };
};

export const defaultTheme: Theme = {
  id: 'chartwright-default',
  label: 'Neutral greys, one house blue, and the emphasis orange the examples use.',
  roles: {
    // Transparent, as the backend has always drawn: the host page owns its background,
    // and a chart that paints its own rectangle is a chart that fights dark mode.
    surface: { canvas: 'transparent', plot: 'transparent' },
    text: { primary: '#24292f', secondary: '#57606a', muted: '#6e7781' },
    structure: { axis: '#d0d7de', grid: '#eaeef2' },
    series: {
      single: '#0072b2',
      // Hues after Okabe & Ito's colour-blind-safe set (blue, orange, green, reddish
      // purple, sky), minus vermillion — indistinguishable from the emphasis orange at
      // a border's width — and minus yellow, which vanishes on white; the sixth is a
      // brown so six series stay apart. A default to override, not a house style.
      categorical: ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#8c5a3b'],
      overflow: '#9aa4af',
      sequential: ['#e8eef6', '#0072b2'],
    },
    // The two colours this file has always used, so theming is additive: an unthemed
    // chart emphasises exactly as it did before the theme layer existed.
    emphasis: { highlight: '#e8590c', muted: '#c9ced6' },
  },
};

/**
 * The consumer's override merged over the default, group by group.
 *
 * Refuses an empty palette rather than accepting a theme that cannot colour anything:
 * every series falling through to overflow is not a theme, it is a mistake with a
 * plausible shape.
 */
export function resolveTheme(input?: ThemeInput): Theme {
  if (input === undefined) return defaultTheme;

  const roles = input.roles ?? {};
  const categorical = roles.series?.categorical ?? defaultTheme.roles.series.categorical;
  if (categorical.length === 0) {
    throw new Error('a theme with an empty series.categorical palette cannot colour any series; omit it or give it colours');
  }

  return {
    id: input.id ?? defaultTheme.id,
    label: input.label ?? defaultTheme.label,
    roles: {
      surface: { ...defaultTheme.roles.surface, ...roles.surface },
      text: { ...defaultTheme.roles.text, ...roles.text },
      structure: { ...defaultTheme.roles.structure, ...roles.structure },
      series: { ...defaultTheme.roles.series, ...roles.series, categorical },
      emphasis: { ...defaultTheme.roles.emphasis, ...roles.emphasis },
    },
  };
}

/**
 * The colours one chart's series get, in series order.
 *
 * One series gets `single`; two or more walk the palette and then the overflow role,
 * never cycling (see the role's comment). The count is the caller's — series for a
 * categorical chart, slices for a pie — because both are "the things this palette
 * colours" and neither is the other.
 */
export function seriesColors(theme: Theme, count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return [theme.roles.series.single];
  const { categorical, overflow } = theme.roles.series;
  return Array.from({ length: count }, (_, index) => (index < categorical.length ? categorical[index] : overflow));
}

/** The colours a declared role resolves to, for the backend and for the tests that keep the declaration honest. */
export function roleColors(theme: Theme, role: ColorRole): readonly string[] {
  switch (role) {
    case 'series.categorical':
      return theme.roles.series.categorical;
    case 'series.sequential':
      return theme.roles.series.sequential;
  }
}
