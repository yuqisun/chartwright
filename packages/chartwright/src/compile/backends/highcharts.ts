/**
 * The Highcharts backend: the only place in this package that knows Highcharts.
 *
 * Everything library-shaped lives here:
 *   - `column` vs `bar` naming (and the fact that `bar` is an inverted column),
 *   - horizontal bars being drawn bottom-up, hence the reversed category axis,
 *   - the pie series data shape,
 *   - the datetime axis convention,
 *   - what a semantic emphasis tone looks like as a colour.
 *
 * Keeping it in one file is deliberate. Every one of those is a convention the
 * library chose, not a fact about charts; the bug that made "the largest 5" look
 * ascending was exactly this knowledge having nowhere to live.
 * Adding a second library means adding a sibling file, not touching the model.
 */
import type { EmphasisResolution, ResolvedTone } from '../emphasis.ts';
import type { CategoricalModel, ChartModel, PartToWholeModel, TemporalModel } from '../model.ts';
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
  return {
    chart: { backgroundColor: 'transparent' },
    title: { text: model.title ?? '', style: { fontSize: '15px' } },
    credits: { enabled: false },
    legend: { enabled: model.kind !== 'part-to-whole' && model.series.length > 1 },
  };
}

function categoricalOptions(model: CategoricalModel, emphasis: EmphasisResolution): ChartOptions {
  const vertical = model.chartType === 'bar' && model.orientation !== 'horizontal';
  const horizontal = model.chartType === 'bar' && model.orientation === 'horizontal';

  return {
    ...baseOptions(model),
    chart: { type: vertical ? 'column' : horizontal ? 'bar' : model.chartType, backgroundColor: 'transparent' },
    xAxis: { categories: model.categories, title: { text: model.xField } },
    yAxis: {
      title: { text: model.yField },
      // Highcharts draws a horizontal bar chart from the bottom up, so row 0 of
      // the table would land at the bottom and a descending sort would read as
      // ascending. Reversing the category axis puts row 0 on top, which is what
      // "top 10" means to a reader. Vertical columns run left-to-right, so they
      // need nothing.
      ...(horizontal ? { reversed: true } : {}),
    },
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

function temporalOptions(model: TemporalModel, emphasis: EmphasisResolution): ChartOptions {
  return {
    ...baseOptions(model),
    chart: { type: model.chartType, backgroundColor: 'transparent' },
    xAxis: { type: 'datetime', title: { text: model.xField } },
    yAxis: { title: { text: model.yField } },
    series: model.series.map((series) => ({
      name: series.name,
      // A per-point colour on a line colours the marker; the connecting segment
      // keeps the series colour. That is a Highcharts behaviour, not a choice.
      data: series.points.map((point) => {
        const style = emphasis.styles.get(point.key);
        return style ? withTone({ x: point.x, y: point.y }, style) : [point.x, point.y];
      }),
    })),
  };
}

function partToWholeOptions(model: PartToWholeModel, emphasis: EmphasisResolution): ChartOptions {
  return {
    ...baseOptions(model),
    chart: { type: 'pie', backgroundColor: 'transparent' },
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
    case 'temporal':
      return temporalOptions(model, emphasis);
    case 'categorical':
      return categoricalOptions(model, emphasis);
  }
}
