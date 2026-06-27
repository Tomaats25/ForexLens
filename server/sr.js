// server/sr.js — Set & Forget AOI (Area of Interest) detection.
//
// Zone boundaries come from candle BODIES only (open/close), never wicks — so AOIs
// are tight. A "touch" is a REJECTION candle: price pushed into the zone and got
// pushed back out, leaving a wick poking in while the body closes away from it.
// Wicks are used ONLY to (a) flag a rejection and (b) confirm the touch — never to
// define the drawn zone. Weekly rejections weigh double, daily single.

// Stricter on higher timeframes (a rejection there means more); looser on lower,
// noisier ones so valid rejections aren't filtered out.
const WICK_MULTIPLIER = { weekly: 1.5, daily: 1.25, '4h': 1.0 };

function pipSize(pair) {
  return pair && pair.includes('JPY') ? 0.01 : 0.0001;
}

function decimalsFor(pair) {
  return pair && pair.includes('JPY') ? 3 : 5;
}

function round(n, pair) {
  return Number(n.toFixed(decimalsFor(pair)));
}

// Body top/bottom. Returns null for a doji (open === close) — no clear body.
function body(candle) {
  if (candle.open === candle.close) return null;
  return {
    top: Math.max(candle.open, candle.close),
    bottom: Math.min(candle.open, candle.close)
  };
}

// Is this candle a rejection at the zone [zoneBottom, zoneTop]?
// Returns { confirmed } when it is, else null. `confirmed` = close direction agrees
// with the rejection side (strength signal, not a hard filter).
function rejectionAt(candle, zoneBottom, zoneTop, wickMultiplier) {
  if (candle.open === candle.close) return null; // doji
  const bodyTop = Math.max(candle.open, candle.close);
  const bodyBottom = Math.min(candle.open, candle.close);
  const bodySize = Math.abs(candle.close - candle.open);

  // Resistance rejection (rejected from above): body below the zone, upper wick pokes in.
  if (candle.high >= zoneBottom && bodyTop < zoneBottom) {
    const wick = candle.high - bodyTop;
    if (wick >= bodySize * wickMultiplier) {
      return { confirmed: candle.close <= candle.open }; // bearish close confirms
    }
  }
  // Support rejection (rejected from below): body above the zone, lower wick pokes in.
  if (candle.low <= zoneTop && bodyBottom > zoneTop) {
    const wick = bodyBottom - candle.low;
    if (wick >= bodySize * wickMultiplier) {
      return { confirmed: candle.close >= candle.open }; // bullish close confirms
    }
  }
  return null;
}

function psychInZone(bottom, top, pair) {
  const step = pair && pair.includes('JPY') ? 0.5 : 0.05;
  const first = Math.ceil(bottom / step) * step;
  return first <= top + 1e-9 ? round(first, pair) : null;
}

export function detectSR(weeklyCandles = [], dailyCandles = [], pair = '') {
  const PIP = pipSize(pair);
  const CLUSTER_GAP = 30 * PIP; // group body extremes within 30 pips
  const MAX_WIDTH = 60 * PIP; // a zone can never be wider than 60 pips (body-based)

  const weekly = (weeklyCandles || []).slice(-52);
  const daily = (dailyCandles || []).slice(-90);
  const empty = { zones: [], support: [], resistance: [], inside: [] };
  if (!daily.length && !weekly.length) return empty;

  // 1. Cluster anchors = body highs and body lows (skip dojis). Bodies only.
  const anchors = [];
  for (const c of weekly) {
    const b = body(c);
    if (b) anchors.push(b.top, b.bottom);
  }
  for (const c of daily) {
    const b = body(c);
    if (b) anchors.push(b.top, b.bottom);
  }
  if (!anchors.length) return empty;
  anchors.sort((a, b) => a - b);

  // 2. Cluster consecutive anchors within 30 pips, each cluster capped at 60 pips wide.
  const candidates = [];
  let i = 0;
  while (i < anchors.length) {
    const start = anchors[i];
    let j = i + 1;
    while (
      j < anchors.length &&
      anchors[j] - anchors[j - 1] <= CLUSTER_GAP &&
      anchors[j] - start <= MAX_WIDTH
    ) {
      j++;
    }
    candidates.push({ bottom: anchors[i], top: anchors[j - 1] });
    i = j;
  }

  const lastCandle = daily.length ? daily[daily.length - 1] : weekly[weekly.length - 1];
  const currentPrice = lastCandle.close;

  // 3. Count REJECTION candles per zone (one per candle; weekly x2, daily x1).
  const zones = [];
  for (const { bottom, top } of candidates) {
    if (top - bottom > MAX_WIDTH) continue; // safety
    let touchCount = 0;
    let weighted = 0;
    let confirmed = 0;
    let weeklyTouched = false;
    let dailyTouched = false;

    for (const c of weekly) {
      const r = rejectionAt(c, bottom, top, WICK_MULTIPLIER.weekly);
      if (r) {
        touchCount += 1;
        weighted += 2;
        if (r.confirmed) confirmed += 2;
        weeklyTouched = true;
      }
    }
    for (const c of daily) {
      const r = rejectionAt(c, bottom, top, WICK_MULTIPLIER.daily);
      if (r) {
        touchCount += 1;
        weighted += 1;
        if (r.confirmed) confirmed += 1;
        dailyTouched = true;
      }
    }

    if (weighted < 3) continue; // minimum weighted rejection count to qualify

    const midpoint = (bottom + top) / 2;
    const pipsWide = Math.round((top - bottom) / PIP);
    let type;
    if (currentPrice > top) type = 'support';
    else if (currentPrice < bottom) type = 'resistance';
    else type = 'inside';
    const timeframe =
      weeklyTouched && dailyTouched ? 'both' : weeklyTouched ? 'weekly' : 'daily';
    const psych = psychInZone(bottom, top, pair);

    zones.push({
      type,
      top: round(top, pair),
      bottom: round(bottom, pair),
      midpoint: round(midpoint, pair),
      pips_wide: pipsWide,
      touch_count: touchCount,
      weighted_score: weighted,
      confirmed_score: confirmed,
      timeframe,
      is_psychological: psych !== null,
      psych_level: psych,
      // legacy aliases so the chart route + ChartPanel keep working unchanged
      low: round(bottom, pair),
      high: round(top, pair),
      mid: round(midpoint, pair),
      touches: weighted
    });
  }

  // Strongest first; close-direction confirmation breaks ties.
  zones.sort(
    (a, b) => b.weighted_score - a.weighted_score || b.confirmed_score - a.confirmed_score
  );

  return {
    zones,
    support: zones.filter((z) => z.type === 'support').slice(0, 4),
    resistance: zones.filter((z) => z.type === 'resistance').slice(0, 4),
    inside: zones.filter((z) => z.type === 'inside')
  };
}
