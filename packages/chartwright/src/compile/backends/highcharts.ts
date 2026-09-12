/**
 * The Highcharts backend: the only place in this package that knows Highcharts.
 *
 * Everything library-shaped lives here:
 *   - `column` vs `bar` naming (and the fact that `bar` is an inverted column),
 *   - horizontal bars being drawn bottom-up, hence the reversed category axis,
 *   - the pie series data shape,
 *   - what a semantic emphasis tone looks like as a colour.
 *
 * Keeping it in one file is deliberate. Every one of those is a convention the
 * library chose, not a fact about charts; the bug that made "the largest 5" look
 * ascending was exactly this knowledge having nowhere to live.
 * Adding a second library means adding a sibling file, not touching the model.
 *
 * There is no datetime-axis branch: a date column is a category here, deliberately.
 * See the note on `ChartModel` in `../model.ts`.
 */
import type { EmphasisResolution, ResolvedTone } from '../emphasis.ts';
import type { CategoricalModel, ChartModel, MatrixModel, PartToWholeModel } from '../model.ts';
import { keyForCategory } from '../model.ts';
import { CHART_TYPES } from '../chart-types.ts';
import type { ChartType } from '../chart-types.ts';
import { deriveAxisLayout, overflowWarning, plotWidthOf } from '../layout.ts';
import type { AxisLayout, LayoutInput } from '../layout.ts';
import { roleColors, seriesColors } from '../theme.ts';
import type { ColorRole, Theme } from '../theme.ts';

/** Plain options object; the caller renders it. Intentionally not typed against Highcharts. */
export type ChartOptions = Record<string, unknown>;

/**
 * Semantic tone → concrete colour, from the theme.
 *
 * The spec says `tone: 'highlight'`, never a hex value, so this decision belongs to the
 * backend; the theme is where a consumer moves it. The default theme carries the two
 * colours this file always used, so theming is additive rather than a restyle.
 */
function toneColor(theme: Theme, tone: ResolvedTone['tone']): string {
  return theme.roles.emphasis[tone];
}

type Point = Record<string, unknown>;

function withTone(point: Point, style: ResolvedTone | undefined, theme: Theme): Point {
  if (!style) return point;
  return {
    ...point,
    color: toneColor(theme, style.tone),
    ...(style.label ? { dataLabels: { enabled: true } } : {}),
  };
}

/**
 * The ruler's own ink: labels in the secondary text role, the axis line and ticks in the
 * structure role, the axis title in the muted role, and — where Highcharts draws a grid
 * by default — the grid in the grid role.
 *
 * One helper for every axis on every shape, because a theme that restyles one axis and
 * not the other is a bug, and the alternative is the same four keys pasted per shape.
 * `labels` carries what the layout derivation decided (font size, rotation), so theme
 * and layout compose in one place instead of fighting over the same object.
 */
function themedAxis(
  theme: Theme,
  axis: ChartOptions,
  { grid, labels }: { grid: boolean; labels?: ChartOptions },
): ChartOptions {
  const labelStyle = (labels?.style ?? {}) as ChartOptions;
  return {
    ...axis,
    labels: { ...labels, style: { color: theme.roles.text.secondary, ...labelStyle } },
    lineColor: theme.roles.structure.axis,
    tickColor: theme.roles.structure.axis,
    ...(grid ? { gridLineColor: theme.roles.structure.grid } : {}),
    title: { ...(axis.title as ChartOptions | undefined), style: { color: theme.roles.text.muted } },
  };
}

/**
 * What the layout derivation says, in the keys Highcharts reads.
 *
 * Rotation only where `rotate` is true: a category axis running down the side of a
 * horizontal bar chart has its labels lying along the reading direction already, and
 * turning them sideways there would fight the reader for no geometric gain.
 */
function labelSizing(layout: AxisLayout, { rotate }: { rotate: boolean }): ChartOptions {
  return {
    style: { fontSize: `${layout.fontSize}px` },
    ...(rotate && layout.rotation !== 0 ? { rotation: layout.rotation } : {}),
  };
}

/**
 * Options every shape shares.
 *
 * The legend is passed in rather than derived from the model, because what "a legend" means
 * differs per shape: for a categorical chart it lists the series, a pie labels its own slices, and
 * a matrix shows the colour scale. Deriving it from the model's series count got the matrix wrong
 * — a heatmap has one series however many rows it draws, and a legend of one is not the point.
 */
function baseOptions(model: ChartModel, { legend, theme }: { legend: boolean; theme: Theme }): ChartOptions {
  const compact = model.compact === true;
  return {
    chart: { backgroundColor: theme.roles.surface.canvas },
    // A sparkline is the same chart with nothing around it: no title, no legend. The marks and
    // the data are untouched — the chart is not simplified, it is undressed.
    title: compact ? { text: '' } : { text: model.title ?? '', style: { fontSize: '15px', color: theme.roles.text.primary } },
    credits: { enabled: false },
    legend: { enabled: !compact && legend, itemStyle: { color: theme.roles.text.secondary } },
  };
}

/**
 * The palette a type's marks draw with, or nothing when the type declares no categorical role.
 *
 * Read off the declaration rather than the kind, so the question "does this chart take series
 * colours?" has one answer in the repository: `chart-types.ts`.
 */
function paletteFor(theme: Theme, type: ChartType, count: number): string[] | undefined {
  const roles: readonly ColorRole[] = CHART_TYPES[type].colorRoles;
  return roles.includes('series.categorical') ? seriesColors(theme, count) : undefined;
}

/**
 * The ramp a measure-as-colour draws with, or nothing when the type declares no sequential role.
 * `roleColors` widens the tuple to a list, and the theme type is what makes the pair safe to read back.
 */
function rampFor(theme: Theme, type: ChartType): readonly [string, string] | undefined {
  const roles: readonly ColorRole[] = CHART_TYPES[type].colorRoles;
  return roles.includes('series.sequential')
    ? (roleColors(theme, 'series.sequential') as readonly [string, string])
    : undefined;
}

function categoricalOptions(
  model: CategoricalModel,
  emphasis: EmphasisResolution,
  theme: Theme,
  layoutInput: LayoutInput | undefined,
): { options: ChartOptions; warnings: string[] } {
  const vertical = model.chartType === 'bar' && model.orientation !== 'horizontal';
  const horizontal = model.chartType === 'bar' && model.orientation === 'horizontal';
  const compact = model.compact === true;
  const palette = paletteFor(theme, model.chartType, model.series.length);

  // The category axis is the one that can crowd. In Highcharts it is `xAxis` for every
  // orientation — a `bar` is an inverted column, so the inversion is visual and the
  // option names do not move — which is also why the top-to-bottom ordering of a
  // horizontal bar is `xAxis.reversed`, not anything on the value axis. The value axis
  // prints numbers the library formats, so it gets no sizing of ours.
  const width = plotWidthOf(layoutInput);
  const layout = deriveAxisLayout(model.categories, width);
  const warnings = layout.overflow ? [overflowWarning('x', model.categories.length, width)] : [];

  const options: ChartOptions = {
    ...baseOptions(model, { legend: model.series.length > 1, theme }),
    chart: {
      type: vertical ? 'column' : horizontal ? 'bar' : model.chartType,
      backgroundColor: theme.roles.surface.canvas,
      // Wrapping the axes around a circle turns a line into a radar and bars into a rose: the
      // series are unchanged, only the axes move.
      ...(model.polar ? { polar: true } : {}),
    },
    // Series colours in series order, from the theme. Absent entirely for a type that declares
    // no categorical role, so the palette never lands on a chart that reads colour as value.
    ...(palette ? { colors: palette } : {}),
    // Stacking belongs to the series collection rather than to the axis, so it lives in
    // plotOptions. `percent` is the one that rescales, which is why it is passed through only
    // when the spec asked for it — the compiler does not decide that a comparison is a share.
    ...(model.stacking ? { plotOptions: { series: { stacking: model.stacking } } } : {}),
    // Compact drops the axes rather than shortening them: a sparkline has no ruler, and a
    // ruler is the only thing the layout derivation knows how to size.
    ...(compact
      ? {}
      : {
          xAxis: themedAxis(
            theme,
            {
              categories: model.categories,
              title: { text: model.xField },
              // Highcharts draws a horizontal bar chart from the bottom up, so row 0 of
              // the table would land at the bottom and a descending sort would read as
              // ascending. Reversing the category axis puts row 0 on top, which is what
              // "top 10" means to a reader. Vertical columns run left-to-right, so they
              // need nothing.
              ...(horizontal ? { reversed: true } : {}),
            },
            // A side axis (horizontal bars) shrinks but does not turn: its labels already
            // read in the direction they stack, and rotating them there fights the reader.
            { grid: false, labels: labelSizing(layout, { rotate: !horizontal }) },
          ),
          yAxis: themedAxis(
            theme,
            {
              title: { text: model.yField },
              // A fixed range is a claim about the measure, so it overrides whatever the rows say.
              ...(model.yRange?.min !== undefined ? { min: model.yRange.min } : {}),
              ...(model.yRange?.max !== undefined ? { max: model.yRange.max } : {}),
            },
            { grid: true },
          ),
        }),
    series: model.series.map((series) => ({
      name: series.name,
      // Plain numbers unless a point needs styling: keeping the unstyled shape
      // unchanged means an emphasis-free spec compiles to exactly what it did
      // before, which is what makes the feature additive rather than a rewrite.
      data: series.values.map((value, index) => {
        if (value === null) return null;
        const style = emphasis.styles.get(keyForCategory(model, index, series.name));
        return style ? withTone({ y: value }, style, theme) : value;
      }),
    })),
  };
  return { options, warnings };
}

function partToWholeOptions(
  model: PartToWholeModel,
  emphasis: EmphasisResolution,
  theme: Theme,
): { options: ChartOptions; warnings: string[] } {
  const palette = paletteFor(theme, model.chartType, model.slices.length);
  const options: ChartOptions = {
    // A pie labels its own slices; a legend beside it would only repeat them.
    ...baseOptions(model, { legend: false, theme }),
    chart: { type: 'pie', backgroundColor: theme.roles.surface.canvas },
    // Slices are the things the palette colours here, so they get it in slice order.
    ...(palette ? { colors: palette } : {}),
    // The hole is what makes a donut, and it belongs to the pie rather than to a type of its
    // own: the same slices, the same data, a different middle.
    ...(model.hole !== undefined ? { plotOptions: { pie: { innerSize: `${Math.round(model.hole * 100)}%` } } } : {}),
    series: [
      {
        type: 'pie',
        name: model.yField,
        // A pie's data is objects anyway, so styling only adds keys to them.
        data: model.slices.map((slice) => ({
          name: slice.name,
          ...withTone({ y: slice.value }, emphasis.styles.get(slice.key), theme),
        })),
      },
    ],
  };
  // No axis, nothing to crowd: a pie with sixty slices has other problems, and they are
  // the caller's to solve with a different question, not this module's.
  return { options, warnings: [] };
}

/**
 * A matrix: the measure drawn as colour instead of as length.
 *
 * This branch exists rather than reusing the categorical one for one reason, and it is a library
 * convention rather than a fact about charts: Highcharts wants heatmap cells as
 * `[xIndex, yIndex, value]` triples, with the two category axes supplying the labels. Same model,
 * same three channels, different data shape — which is what a backend is for.
 *
 * Emphasis needs a different rendering here too: on a heatmap the colour *is* the value, so a
 * highlight cannot be a fill without destroying the datum. A highlight is a border; muting
 * recolours the cell, which is the honest reading of "fade this one" when colour carries meaning.
 */
function matrixOptions(
  model: MatrixModel,
  emphasis: EmphasisResolution,
  theme: Theme,
  layoutInput: LayoutInput | undefined,
): { options: ChartOptions; warnings: string[] } {
  const compact = model.compact === true;
  const rows = model.series.map((series) => series.name);
  const ramp = rampFor(theme, model.chartType);

  // Two category axes, and either can crowd on its own: months along the bottom, desks up
  // the side. The bottom one rotates like any categorical axis; the side one only shrinks,
  // because its labels already read in the direction they stack.
  const width = plotWidthOf(layoutInput);
  const across = deriveAxisLayout(model.categories, width);
  const down = deriveAxisLayout(rows, width);
  const warnings = [
    ...(across.overflow ? [overflowWarning('x', model.categories.length, width)] : []),
    ...(down.overflow ? [overflowWarning('y', rows.length, width)] : []),
  ];

  const data: Array<Record<string, unknown>> = [];
  model.series.forEach((series, rowIndex) => {
    series.values.forEach((value, columnIndex) => {
      if (value === null) return;
      const cell: Record<string, unknown> = { x: columnIndex, y: rowIndex, value };
      const style = emphasis.styles.get(keyForCategory(model, columnIndex, series.name));
      if (style) {
        if (style.tone === 'highlight') {
          cell.borderColor = toneColor(theme, 'highlight');
          cell.borderWidth = 2;
        } else {
          cell.color = toneColor(theme, 'muted');
        }
        if (style.label) cell.dataLabels = { enabled: true };
      }
      data.push(cell);
    });
  });

  const options: ChartOptions = {
    // The legend here is the colour scale, which is why it is on even though there is one series.
    ...baseOptions(model, { legend: true, theme }),
    chart: { type: 'heatmap', backgroundColor: theme.roles.surface.canvas },
    // What turns the measure into a colour scale, and the two ends the theme says that scale
    // runs between. Left as an empty object only if the type declares no sequential role —
    // which no matrix type can, so in practice the ramp is always there. The module that
    // supplies the axis is named in the declaration, so a consumer knows to load it.
    colorAxis: ramp ? { minColor: ramp[0], maxColor: ramp[1] } : {},
    ...(compact
      ? {}
      : {
          xAxis: themedAxis(
            theme,
            { categories: model.categories, title: { text: model.xField } },
            { grid: false, labels: labelSizing(across, { rotate: true }) },
          ),
          yAxis: themedAxis(
            theme,
            { categories: rows, title: { text: model.seriesField ?? '' } },
            { grid: false, labels: labelSizing(down, { rotate: false }) },
          ),
        }),
    series: [{ type: 'heatmap', name: model.yField, data }],
  };
  return { options, warnings };
}

export function toHighchartsOptions(
  model: ChartModel,
  emphasis: EmphasisResolution,
  theme: Theme,
  layout?: LayoutInput,
): { options: ChartOptions; warnings: string[] } {
  switch (model.kind) {
    case 'part-to-whole':
      return partToWholeOptions(model, emphasis, theme);
    case 'matrix':
      return matrixOptions(model, emphasis, theme, layout);
    case 'categorical':
      return categoricalOptions(model, emphasis, theme, layout);
  }
}
