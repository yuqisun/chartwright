/**
 * Layout derivation: what the category axis does when the labels do not fit.
 *
 * The question is old and every chart library answers it: N bands of real text into a
 * fixed number of pixels. What is worth having is an answer that is *derived* rather
 * than hoped for — the same spec over the same rows must crowd the same way twice —
 * and that is what this module is. Plan §5.6 (roadmap item 8); constants and the
 * elastic budget reimplemented from flint (`docs/flint-conventions.md` §1.2–§1.4),
 * which documented its own model in `design-stretch-model.md`.
 *
 * Two deviations from flint, both because Highcharts is not Vega-Lite:
 *
 *   - **No widen-then-rotate.** flint grows the plot (`width: {step}`) before it
 *     rotates a label. Highcharts fills the container it is given, so the plot's width
 *     is the consumer's, not ours; the one width we can reason about is the reference
 *     width below, which the consumer may override with `layout.plotWidth`.
 *   - **No item dropping.** flint's overflow regime truncates the category list and
 *     prints a `...N items omitted` placeholder. Dropping rows would change the data
 *     the chart claims to show, so here overflow only warns; the marks stay complete.
 *
 * What flint's ladder contributes and this file keeps: the 0.62 character-width
 * estimate, the three-regime elastic budget (sparse / dense / overflow), the font that
 * shrinks and never grows, and the rule that a handful of short labels never rotates.
 */

/** The reference the derivation reasons against, in pixels. All of it overridable via `layout.plotWidth`. */
export const LAYOUT = {
  /** The plot width assumed when the consumer says nothing. A content column, not a dashboard. */
  plotWidth: 400,
  /** Axis label font before any shrinking. */
  baseFont: 11,
  /** Average glyph width as a fraction of the font size (flint `compute-layout.ts:73`). */
  charWidth: 0.62,
  /** Natural band size, and the density threshold (flint `defaultBandSize`). */
  naturalBand: 20,
  /** The tightest a band compresses before the overflow regime (flint `minStep`). */
  minStep: 6,
  /** The widest a band expands when the chart is sparse (flint `SPARSE_FIT_BAND_CEILING`). */
  maxBand: 100,
  /** The axis may grow to 150% of its reference length, no further (flint `maxStretch`). */
  maxStretch: 1.5,
  /** How hard pressure turns into stretch (flint `elasticity`). */
  elasticity: 0.5,
  /** "Few and short" never rotates (flint `compute-layout.ts` few/short branch). */
  fewCount: 4,
  fewChars: 8,
} as const;

export type AxisLayout = {
  /** 0, −45 or −90 degrees. Highcharts takes negative for readable bottom labels. */
  rotation: 0 | -45 | -90;
  /** The axis label font, in px. Shrinks under pressure; never grows past the ladder's ceiling. */
  fontSize: number;
  /** How far the elastic budget stretched the axis: 1 is untouched, 1.5 is the ceiling. */
  stretched: number;
  /** The third regime: even at `minStep` the bands do not fit. Nothing is dropped; the caller warns. */
  overflow: boolean;
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The layout one category axis needs for these labels.
 *
 * Order matters and is the whole argument: the elastic budget decides how much room the
 * axis gets, the room divided by the count decides the band step, and only then does the
 * text get a vote — because rotating first and asking later is how charts end up with
 * vertical labels that had room to lie down.
 */
export function deriveAxisLayout(labels: readonly string[], plotWidth: number = LAYOUT.plotWidth): AxisLayout {
  // plotWidthOf guards this for the normal path, but the function is exported and a direct
  // caller could pass anything. NaN or zero here would produce Infinity pressure and cascade
  // through every derived value, so refuse early with a clear message.
  if (!Number.isFinite(plotWidth) || plotWidth <= 0) {
    throw new Error(`deriveAxisLayout requires a positive finite plotWidth, got ${plotWidth}`);
  }

  const count = labels.length;
  if (count === 0) {
    return { rotation: 0, fontSize: clamp(LAYOUT.baseFont - 1, 6, 10), stretched: 1, overflow: false };
  }

  const longest = Math.max(...labels.map((label) => String(label).length));

  // p = demand / room; s = min(β, max(1, √p)); the axis length follows, and the band step
  // is that length shared out, clamped both ways: never tighter than minStep, never
  // wider than maxBand however sparse the chart is.
  const pressure = (count * LAYOUT.naturalBand) / plotWidth;
  const stretched = Math.min(LAYOUT.maxStretch, Math.max(1, pressure ** LAYOUT.elasticity));
  const axisLength = plotWidth * stretched;
  // `room` is the true pixels-per-band at the reference width, and it is what the label
  // fit test measures against: a 200px band in a wide container gives a long label room
  // to lie down however sparse-fit caps the drawn band. `step` is that same room clamped
  // both ways, and only the font ladder reads it — flint's maxBand is a rule about how
  // wide a band is drawn, not about how much text fits in it.
  const room = axisLength / count;
  const step = clamp(room, LAYOUT.minStep, LAYOUT.maxBand);
  const overflow = count * LAYOUT.minStep >= axisLength;

  // The flat font is the ladder's 0° rung, and the font the fit test measures with: the
  // largest the axis would ever print, so a label that fits at it fits at any rung.
  const flatFont = clamp(step - 1, 6, 10);

  if (count <= LAYOUT.fewCount && longest <= LAYOUT.fewChars) {
    return { rotation: 0, fontSize: flatFont, stretched, overflow };
  }

  const labelPx = longest * flatFont * LAYOUT.charWidth;
  // The rotate test is geometry, not a step band: a label lying down needs its own
  // width, at −45° it needs that times cos 45, and at −90° it needs only the font size —
  // which the −90° rung's clamp keeps at or below the band, so vertical always fits.
  const rotation: AxisLayout['rotation'] =
    labelPx <= room ? 0 : labelPx * Math.SQRT1_2 <= room ? -45 : -90;

  const fontSize =
    rotation === -90
      ? clamp(step, 6, LAYOUT.baseFont - 2)
      : rotation === -45
        ? clamp(step, 6, LAYOUT.baseFont - 1)
        : flatFont;

  return { rotation, fontSize, stretched, overflow };
}

/**
 * The warning the overflow regime earns.
 *
 * Separate from the derivation because the derivation is pure geometry and the warning
 * is a sentence about what a reader will see; keeping them apart keeps the geometry
 * testable without string matching.
 */
export function overflowWarning(axis: string, labelCount: number, plotWidth: number): string {
  return (
    `the ${axis} axis carries ${labelCount} labels, which do not fit even at the ${LAYOUT.minStep}px minimum ` +
    `(reference width ${plotWidth}px): every mark is still drawn and every label still shown, ` +
    `but they will crowd — aggregate, or pass a wider layout.plotWidth`
  );
}

/**
 * What a consumer may tell the layout about its canvas: the plot width in pixels.
 *
 * The compiler cannot see the container, so it reasons against a reference and says so;
 * a consumer that knows its width passes it and the derivation becomes exact instead of
 * conservative.
 */
export type LayoutInput = { plotWidth?: number };

/** The reference width to derive against, refusing a width that is not one. */
export function plotWidthOf(input?: LayoutInput): number {
  const width = input?.plotWidth;
  if (width === undefined) return LAYOUT.plotWidth;
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(`layout.plotWidth must be a positive number of pixels, got ${String(width)}`);
  }
  return width;
}
