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
import type { CategoricalModel, ChartModel, PartToWholeModel } from '../model.ts';
import { keyForCategory } from '../model.ts';

/** Plain options object; the caller renders it. Intentionally not typed against Highcharts. */
export type ChartOptions = Record<string, unknown>;

/**
 * Semantic tone → concrete colour.
 *
 * The spec says `tone: 'highlight'`, never a hex value, so this decision belongs
 * to the backend and can later come from a theme instead of a constant.
 */
const TONES: Record<ResolvedTone['tone'], string> = {
  highlight: '#e8590c',
  muted: '#c9ced6',
};

type Point = Record<string, unknown>;

function withTone(point: Point, style: ResolvedTone | undefined): Point {
  if (!style) return point;
  return {
    ...point,
    color: TONES[style.tone],
    ...(style.label ? { dataLabels: { enabled: true } } : {}),
  };
}

function baseOptions(model: ChartModel): ChartOptions {
  const compact = model.compact === true;
  return {
    chart: { backgroundColor: 'transparent' },
    // A sparkline is the same chart with nothing around it: no title, no legend. The marks and
    // the data are untouched — the chart is not simplified, it is undressed.
    title: compact ? { text: '' } : { text: model.title ?? '', style: { fontSize: '15px' } },
    credits: { enabled: false },
    legend: { enabled: !compact && model.kind !== 'part-to-whole' && model.series.length > 1 },
  };
}

function categoricalOptions(model: CategoricalModel, emphasis: EmphasisResolution): ChartOptions {
  const vertical = model.chartType === 'bar' && model.orientation !== 'horizontal';
  const horizontal = model.chartType === 'bar' && model.orientation === 'horizontal';
  const compact = model.compact === true;

  return {
    ...baseOptions(model),
    chart: {
      type: vertical ? 'column' : horizontal ? 'bar' : model.chartType,
      backgroundColor: 'transparent',
      // Wrapping the axes around a circle turns a line into a radar and bars into a rose: the
      // series are unchanged, only the axes move.
      ...(model.polar ? { polar: true } : {}),
    },
    // Stacking belongs to the series collection rather than to the axis, so it lives in
    // plotOptions. `percent` is the one that rescales, which is why it is passed through only
    // when the spec asked for it — the compiler does not decide that a comparison is a share.
    ...(model.stacking ? { plotOptions: { series: { stacking: model.stacking } } } : {}),
    // Compact drops the axes rather than shortening them: a sparkline has no ruler.
    ...(compact
      ? {}
      : {
          xAxis: { categories: model.categories, title: { text: model.xField } },
          yAxis: {
            title: { text: model.yField },
            // A fixed range is a claim about the measure, so it overrides whatever the rows say.
            ...(model.yRange?.min !== undefined ? { min: model.yRange.min } : {}),
            ...(model.yRange?.max !== undefined ? { max: model.yRange.max } : {}),
            // Highcharts draws a horizontal bar chart from the bottom up, so row 0 of
            // the table would land at the bottom and a descending sort would read as
            // ascending. Reversing the category axis puts row 0 on top, which is what
            // "top 10" means to a reader. Vertical columns run left-to-right, so they
            // need nothing.
            ...(horizontal ? { reversed: true } : {}),
          },
        }),
    series: model.series.map((series) => ({
      name: series.name,
      // Plain numbers unless a point needs styling: keeping the unstyled shape
      // unchanged means an emphasis-free spec compiles to exactly what it did
      // before, which is what makes the feature additive rather than a rewrite.
      data: series.values.map((value, index) => {
        if (value === null) return null;
        const style = emphasis.styles.get(keyForCategory(model, index, series.name));
        return style ? withTone({ y: value }, style) : value;
      }),
    })),
  };
}

function partToWholeOptions(model: PartToWholeModel, emphasis: EmphasisResolution): ChartOptions {
  return {
    ...baseOptions(model),
    chart: { type: 'pie', backgroundColor: 'transparent' },
    // The hole is what makes a donut, and it belongs to the pie rather than to a type of its
    // own: the same slices, the same data, a different middle.
    ...(model.hole !== undefined ? { plotOptions: { pie: { innerSize: `${Math.round(model.hole * 100)}%` } } } : {}),
    series: [
      {
        type: 'pie',
        name: model.yField,
        // A pie's data is objects anyway, so styling only adds keys to them.
        data: model.slices.map((slice) => ({ name: slice.name, ...withTone({ y: slice.value }, emphasis.styles.get(slice.key)) })),
      },
    ],
  };
}

export function toHighchartsOptions(model: ChartModel, emphasis: EmphasisResolution): ChartOptions {
  switch (model.kind) {
    case 'part-to-whole':
      return partToWholeOptions(model, emphasis);
    case 'categorical':
      return categoricalOptions(model, emphasis);
  }
}
