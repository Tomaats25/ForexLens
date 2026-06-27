import React, { useEffect, useRef, useState } from 'react';
import { computeChecklistPercent, checklistTier } from './Checklist.jsx';

const TF_OPTIONS = [
  { key: 'W', api: 'weekly' },
  { key: 'D', api: 'daily' },
  { key: '4H', api: '4h' }
];

function pipSize(pair) {
  return pair.includes('JPY') ? 0.01 : 0.0001;
}

function fmt(price, pair) {
  if (price === null || price === undefined) return '—';
  return Number(price).toFixed(pair.includes('JPY') ? 3 : 5);
}

// Label-friendly formatting: "1.3350" / "150.00" per the round-number convention.
function fmtLabel(price, pair) {
  return Number(price).toFixed(pair.includes('JPY') ? 2 : 4);
}

function mtfArrow(s) {
  if (s === 'BULLISH') return '↑';
  if (s === 'BEARISH') return '↓';
  return '–';
}

function mtfClass(s) {
  if (s === 'BULLISH') return 'mtf-bull';
  if (s === 'BEARISH') return 'mtf-bear';
  return 'mtf-unclear';
}

export default function ChartPanel({ pair, signal, savedChecklist, onClose }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const emaRef = useRef(null);
  const [timeframe, setTimeframe] = useState('D');
  const [showEma, setShowEma] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const checklistPct = computeChecklistPercent(savedChecklist?.state);
  const tier = checklistTier(checklistPct);
  const isScored = checklistPct !== null && checklistPct >= 70;

  useEffect(() => {
    const tf = TF_OPTIONS.find((t) => t.key === timeframe);
    setLoading(true);
    setError(null);
    fetch(`/api/chart/${pair}/${tf.api}`)
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
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [pair, timeframe]);

  useEffect(() => {
    if (!data || !data.candles?.length || !containerRef.current || !window.LightweightCharts) {
      return;
    }
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      emaRef.current = null;
    }

    const LWC = window.LightweightCharts;
    const decimals = pair.includes('JPY') ? 3 : 5;
    const chart = LWC.createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 520,
      layout: { background: { color: 'transparent' }, textColor: '#c9d1d9' },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      timeScale: { timeVisible: timeframe === '4H', borderColor: '#2d333b' },
      rightPriceScale: { borderColor: '#2d333b' },
      crosshair: { mode: LWC.CrosshairMode.Normal }
    });

    const candles = data.candles;
    const times = candles.map((c) => c.time);

    // Only draw zones that overlap the visible candle range (keeps autoscale sane)
    const minP = Math.min(...candles.map((c) => c.low));
    const maxP = Math.max(...candles.map((c) => c.high));
    const pad = (maxP - minP) * 0.05;
    const zones = [
      ...data.sr.support.map((z) => ({ ...z, kind: 'S' })),
      ...data.sr.resistance.map((z) => ({ ...z, kind: 'R' }))
    ].filter((z) => z.low <= maxP + pad && z.high >= minP - pad);

    // 1. S/R bands — baseline series fills between zone.low (base) and zone.high (data)
    for (const z of zones) {
      const fill = z.kind === 'S' ? 'rgba(38, 166, 154, 0.12)' : 'rgba(239, 83, 80, 0.12)';
      const band = chart.addBaselineSeries({
        baseValue: { type: 'price', price: z.low },
        topFillColor1: fill,
        topFillColor2: fill,
        bottomFillColor1: fill,
        bottomFillColor2: fill,
        topLineColor: 'rgba(0,0,0,0)',
        bottomLineColor: 'rgba(0,0,0,0)',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      band.setData(times.map((t) => ({ time: t, value: z.high })));
    }

    // 2. Trade fills — only when checklist scored 70%+
    let trade = null;
    if (isScored && tier?.rr && signal?.actionable && signal.entry != null && signal.sl != null) {
      const slDist = Math.abs(signal.entry - signal.sl);
      const tp =
        signal.direction === 'BUY'
          ? signal.entry + slDist * tier.rr
          : signal.entry - slDist * tier.rr;
      const pip = pipSize(pair);
      trade = {
        entry: signal.entry,
        sl: signal.sl,
        tp,
        tpPips: Math.round(Math.abs(tp - signal.entry) / pip),
        slPips: Math.round(slDist / pip)
      };
      const mkFill = (target, color) => {
        const s = chart.addBaselineSeries({
          baseValue: { type: 'price', price: trade.entry },
          topFillColor1: color,
          topFillColor2: color,
          bottomFillColor1: color,
          bottomFillColor2: color,
          topLineColor: 'rgba(0,0,0,0)',
          bottomLineColor: 'rgba(0,0,0,0)',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false
        });
        s.setData(times.map((t) => ({ time: t, value: target })));
      };
      mkFill(trade.tp, 'rgba(16, 185, 129, 0.10)');
      mkFill(trade.sl, 'rgba(220, 38, 38, 0.10)');
    }

    // 3. Candles on top of the bands
    const series = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      priceFormat: {
        type: 'price',
        precision: decimals,
        minMove: decimals === 3 ? 0.001 : 0.00001
      }
    });
    series.setData(candles);

    // Zone labels: "S 1.3350 — 8x"
    for (const z of zones) {
      series.createPriceLine({
        price: z.mid,
        color: z.kind === 'S' ? '#26a69a' : '#ef5350',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `${z.kind} ${fmtLabel(z.mid, pair)} — ${z.touches}x`
      });
    }

    // Psych levels: thin dotted yellow
    for (const level of data.psychLevels || []) {
      series.createPriceLine({
        price: level,
        color: '#fbbf24',
        lineWidth: 1,
        lineStyle: 1,
        axisLabelVisible: false,
        title: `${fmtLabel(level, pair)} 🔵`
      });
    }

    // Trade lines
    if (trade) {
      series.createPriceLine({
        price: trade.entry,
        color: '#58a6ff',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: 'ENTRY'
      });
      series.createPriceLine({
        price: trade.tp,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `TP ${trade.tpPips}p`
      });
      series.createPriceLine({
        price: trade.sl,
        color: '#dc2626',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `SL ${trade.slPips}p`
      });
    }

    // Current price — dashed white
    if (data.currentPrice != null) {
      series.createPriceLine({
        price: data.currentPrice,
        color: '#e6edf3',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: ''
      });
    }

    // 4. EMA 50 on top
    if (data.ema?.length) {
      const ema = chart.addLineSeries({
        color: '#1f6feb',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      ema.setData(data.ema);
      ema.applyOptions({ visible: showEma });
      emaRef.current = ema;
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const onResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        emaRef.current = null;
      }
    };
  }, [data, checklistPct]);

  useEffect(() => {
    if (emaRef.current) emaRef.current.applyOptions({ visible: showEma });
  }, [showEma]);

  const mtf = signal?.mtfAlignment || {};
  const ns = signal?.nearestSupport;
  const nr = signal?.nearestResistance;
  let nearest = null;
  if (ns && nr) nearest = ns.distancePct <= nr.distancePct ? { ...ns, kind: 'S' } : { ...nr, kind: 'R' };
  else if (ns) nearest = { ...ns, kind: 'S' };
  else if (nr) nearest = { ...nr, kind: 'R' };

  return (
    <div className="chart-panel">
      <div className="chart-panel-header">
        <div className="chart-panel-titlerow">
          <button className="back-btn" onClick={onClose}>
            ← Back
          </button>
          <h2>{pair}</h2>
          <span className="chart-price">
            {fmt(data?.currentPrice ?? signal?.currentPrice, pair)}
          </span>
          {checklistPct !== null && tier && (
            <span className={`tier-badge tier-badge-${tier.tier}`}>{tier.letter}</span>
          )}
        </div>
        <div className="chart-panel-metarow">
          <span className="chart-mtf">
            <span className={mtfClass(mtf.weekly)}>W {mtfArrow(mtf.weekly)}</span>
            <span className="mtf-sep">·</span>
            <span className={mtfClass(mtf.daily)}>D {mtfArrow(mtf.daily)}</span>
            <span className="mtf-sep">·</span>
            <span className={mtfClass(mtf.h4)}>4H {mtfArrow(mtf.h4)}</span>
          </span>
          {nearest && (
            <span className="chart-nearest">
              Nearest zone: {nearest.kind} {fmtLabel(nearest.mid, pair)} · {nearest.touches}x ·{' '}
              {nearest.distancePct}% away
            </span>
          )}
        </div>
        <div className="chart-panel-controls">
          <div className="timeframe-toggle">
            {TF_OPTIONS.map((t) => (
              <button
                key={t.key}
                className={timeframe === t.key ? 'active' : ''}
                onClick={() => setTimeframe(t.key)}
              >
                {t.key}
              </button>
            ))}
          </div>
          <button
            className={`ema-toggle ${showEma ? 'active' : ''}`}
            onClick={() => setShowEma((v) => !v)}
          >
            EMA 50
          </button>
        </div>
      </div>

      {error && <div className="error">⚠ {error}</div>}
      {loading && (
        <div className="chart-loading">
          <div className="spinner" />
          <p>
            Loading {pair} {timeframe}…
          </p>
        </div>
      )}
      <div className="chart-canvas" ref={containerRef} />
    </div>
  );
}
