import Highcharts from 'highcharts';
import { useEffect, useRef, useState } from 'react';

/**
 * Thin React wrapper around Highcharts.
 *
 * We deliberately create the chart imperatively instead of using
 * `highcharts-react-official`: chartwright returns a plain options object, and
 * this shows exactly that — one object in, one chart out, no adapter layer.
 *
 * It also survives a chart it cannot draw. A missing Highcharts module throws from inside this
 * effect (error 17), and an uncaught throw in an effect unmounts the React tree — which is how one
 * wrong card once turned the whole showcase page blank. The failure belongs to the card, so it is
 * caught here and shown where it happened.
 */
export function ChartView({ options, height = 460 }: { options: Highcharts.Options; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    try {
      // Recreate on every options change. For an interactive app you would call
      // chart.update(options) instead; recreating keeps this example obvious.
      const chart = Highcharts.chart(el, options);
      setFailure(null);
      return () => chart.destroy();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }, [options]);

  return (
    <>
      <div ref={containerRef} style={{ width: '100%', height }} />
      {failure ? (
        <p
          style={{
            margin: '8px 0 0',
            padding: '8px 12px',
            borderRadius: 6,
            background: '#ffebe9',
            border: '1px solid #ffc1bc',
            color: '#8e1519',
            fontSize: 13,
          }}
        >
          <strong>This bundle cannot draw this chart.</strong> {failure}
        </p>
      ) : null}
    </>
  );
}
