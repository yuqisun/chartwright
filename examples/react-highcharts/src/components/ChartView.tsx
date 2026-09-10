import Highcharts from 'highcharts';
import { useEffect, useRef } from 'react';

/**
 * Thin React wrapper around Highcharts.
 *
 * We deliberately create the chart imperatively instead of using
 * `highcharts-react-official`: chartwright returns a plain options object, and
 * this shows exactly that — one object in, one chart out, no adapter layer.
 */
export function ChartView({ options }: { options: Highcharts.Options }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Recreate on every options change. For an interactive app you would call
    // chart.update(options) instead; recreating keeps this example obvious.
    const chart = Highcharts.chart(el, options);
    return () => chart.destroy();
  }, [options]);

  return <div ref={containerRef} style={{ width: '100%', height: 460 }} />;
}
