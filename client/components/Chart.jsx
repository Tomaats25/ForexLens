import React, { useEffect, useRef, useState } from 'react';
import NewsFeed from './NewsFeed.jsx';

export default function Chart({ pair, onClose }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [timeframe, setTimeframe] = useState('daily');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/pair/${pair}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [pair]);

  useEffect(() => {
    if (!data || !containerRef.current || !window.LightweightCharts) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = window.LightweightCharts.createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 480,
      layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      timeScale: { timeVisible: true, borderColor: '#2d333b' },
      rightPriceScale: { borderColor: '#2d333b' },
      crosshair: { mode: window.LightweightCharts.CrosshairMode.Normal }
    });

    const series = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350'
    });

    const ohlc = timeframe === 'weekly' ? data.ohlc.weekly : data.ohlc.daily;
    series.setData(ohlc);

    for (const z of data.sr.support) {
      series.createPriceLine({
        price: z.mid,
        color: '#26a69a',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `S ${z.touches}x`
      });
    }
    for (const z of data.sr.resistance) {
      series.createPriceLine({
        price: z.mid,
        color: '#ef5350',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `R ${z.touches}x`
      });
    }

    if (data.signal?.actionable) {
      series.createPriceLine({
        price: data.signal.entry,
        color: '#fbbf24',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: 'Entry'
      });
      series.createPriceLine({
        price: data.signal.tp,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: 'TP'
      });
      series.createPriceLine({
        price: data.signal.sl,
        color: '#dc2626',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: 'SL'
      });
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [data, timeframe]);

  const base = pair.slice(0, 3);
  const quote = pair.slice(3);

  return (
    <div className="chart-view">
      <div className="chart-toolbar">
        <button className="back-btn" onClick={onClose}>
          ← Back
        </button>
        <h2>{pair}</h2>
        <div className="timeframe-toggle">
          <button
            className={timeframe === 'daily' ? 'active' : ''}
            onClick={() => setTimeframe('daily')}
          >
            Daily
          </button>
          <button
            className={timeframe === 'weekly' ? 'active' : ''}
            onClick={() => setTimeframe('weekly')}
          >
            Weekly
          </button>
        </div>
      </div>

      {error && <div className="error">⚠ {error}</div>}
      {loading && (
        <div className="loading">
          <div className="spinner" />
          <p>Loading {pair}…</p>
        </div>
      )}

      <div className="chart-container" ref={containerRef} />

      {data?.signal?.actionable && (
        <div className="signal-summary">
          <div className={`big-direction ${data.signal.direction.toLowerCase()}`}>
            {data.signal.direction} · Score {data.signal.score} · 1:{data.signal.rr}
          </div>
          <div className="signal-row">
            <span>
              Entry: <strong>{data.signal.entry}</strong>
            </span>
            <span>
              TP: <strong className="tp">{data.signal.tp}</strong> ({data.signal.tpPips}p)
            </span>
            <span>
              SL: <strong className="sl">{data.signal.sl}</strong> ({data.signal.slPips}p)
            </span>
            <span>
              Trigger: <strong>{data.signal.trigger || '—'}</strong>
            </span>
            <span>
              Psych:{' '}
              <strong>
                {data.signal.psychConfluence ? `YES (${data.signal.psychLevel})` : 'NO'}
              </strong>
            </span>
            <span>
              MTF: <strong>
                W {data.signal.mtfAlignment.weekly} · D {data.signal.mtfAlignment.daily} · 4H{' '}
                {data.signal.mtfAlignment.h4}
                {data.signal.mtfAlignment.allAligned ? ' · Aligned' : ''}
              </strong>
            </span>
            {data.signal.tpCappedBy && (
              <span>
                TP capped near <strong>{data.signal.tpCappedBy.mid}</strong>
              </span>
            )}
          </div>
        </div>
      )}

      {data?.signal && !data.signal.actionable && data.signal.direction === 'WATCH' && (
        <div className="signal-summary watch">
          <div className="big-direction watch">
            WATCH · Score {data.signal.score} · Strong zone at {data.signal.entry}
          </div>
          <div className="signal-row">
            <span>
              Price: <strong>{data.signal.currentPrice}</strong>
            </span>
            <span>
              Level: <strong>{data.signal.entry}</strong> ({data.signal.zone.touches}x touches)
            </span>
            <span>
              Distance: <strong>{data.signal.watchDistance}%</strong>
            </span>
            <span>
              Reason: <strong>{data.signal.reason || 'Strong zone near price'}</strong>
            </span>
          </div>
        </div>
      )}

      {data?.signal && !data.signal.actionable && data.signal.direction !== 'WATCH' && (
        <div className="signal-summary muted">
          <div className="big-direction none">
            {data.signal.direction === 'NONE'
              ? `No setup · Score ${data.signal.score}`
              : `${data.signal.direction} · low confidence · Score ${data.signal.score}`}
          </div>
          <div className="signal-row">
            <span>
              Price: <strong>{data.signal.currentPrice}</strong>
            </span>
            <span>
              Trend: <strong>{data.signal.trend}</strong>
            </span>
            {data.signal.reason && (
              <span>
                Reason: <strong>{data.signal.reason}</strong>
              </span>
            )}
            {data.signal.nearestSupport && (
              <span>
                Support: <strong>{data.signal.nearestSupport.mid}</strong> (
                {data.signal.nearestSupport.distancePct}% away)
              </span>
            )}
            {data.signal.nearestResistance && (
              <span>
                Resistance: <strong>{data.signal.nearestResistance.mid}</strong> (
                {data.signal.nearestResistance.distancePct}% away)
              </span>
            )}
          </div>
        </div>
      )}

      {data && !data.signal && (
        <div className="signal-summary muted">
          Insufficient data to analyze this pair.
        </div>
      )}

      <div className="news-section">
        <div className="news-column">
          <h3>{base} News</h3>
          <NewsFeed currency={base} />
        </div>
        <div className="news-column">
          <h3>{quote} News</h3>
          <NewsFeed currency={quote} />
        </div>
      </div>
    </div>
  );
}
