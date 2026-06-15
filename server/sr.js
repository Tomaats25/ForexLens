// server/sr.js — Set & Forget AOI (Area of Interest) detection.
//
// An AOI is a price ZONE (<= 60 pips wide), never a single line, where candlestick
// BODIES (never wicks) have rejected 3+ times. Weekly body touches weigh double,
// daily single. Zones are labelled relative to the current price:
//   support  — price is above the zone
//   resistance — price is below the zone
//   inside   — price is inside the zone (watch for breakout / rejection)

function pipSize(pair) {
  return pair && pair.includes('JPY') ? 0.01 : 0.0001;
}

function decimalsFor(pair) {
  return pair && pair.includes('JPY') ? 3 : 5;
}

function round(n, pair) {
  return Number(n.toFixed(decimalsFor(pair)));
}

// Body top/bottom. Returns null for a doji (open === close) — not a clear rejection.
function body(candle) {
  if (candle.open === candle.close) return null;
  return {
    top: Math.max(candle.open, candle.close),
    bottom: Math.min(candle.open, candle.close)
  };
}

// A candle BODY touches the zone if its body bottom or top lands inside the zone,
// or the body fully contains the zone. Wicks (high/low) are never used.
function bodyTouches(candle, bottom, top) {
  const b = body(candle);
  if (!b) return false;
  const bottomInside = b.bottom >= bottom && b.bottom <= top;
  const topInside = b.top >= bottom && b.top <= top;
  const contains = b.bottom <= bottom && b.top >= top;
  return bottomInside || topInside || contains;
}

// Smallest round number that falls inside [bottom, top], or null if none.
function psychInZone(bottom, top, pair) {
  const step = pair && pair.includes('JPY') ? 0.5 : 0.05;
  const first = Math.ceil(bottom / step) * step;
  return first <= top + 1e-9 ? round(first, pair) : null;
}

export function detectSR(weeklyCandles = [], dailyCandles = [], pair = '') {
  const PIP = pipSize(pair);
  const CLUSTER_GAP = 30 * PIP; // group body extremes within 30 pips
  const MAX_WIDTH = 60 * PIP; // a zone can never be wider than 60 pips

  const weekly = (weeklyCandles || []).slice(-52);
  const daily = (dailyCandles || []).slice(-90);
  const empty = { zones: [], support: [], resistance: [], inside: [] };
  if (!daily.length && !weekly.length) return empty;

  // 1. Collect every body high and body low as a cluster anchor (skip dojis).
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

  // 3. Count body touches per candidate (one per candle; weekly x2, daily x1).
  const zones = [];
  for (const { bottom, top } of candidates) {
    if (top - bottom > MAX_WIDTH) continue; // safety
    let touchCount = 0;
    let weighted = 0;
    let weeklyTouched = false;
    let dailyTouched = false;

    for (const c of weekly) {
      if (bodyTouches(c, bottom, top)) {
        touchCount += 1;
        weighted += 2;
        weeklyTouched = true;
      }
    }
    for (const c of daily) {
      if (bodyTouches(c, bottom, top)) {
        touchCount += 1;
        weighted += 1;
        dailyTouched = true;
      }
    }

    if (weighted < 3) continue; // minimum weighted touch count to qualify

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

  // Weekly-heavy zones first (weighted score already favours weekly touches).
  zones.sort((a, b) => b.weighted_score - a.weighted_score);

  return {
    zones,
    support: zones.filter((z) => z.type === 'support').slice(0, 4),
    resistance: zones.filter((z) => z.type === 'resistance').slice(0, 4),
    inside: zones.filter((z) => z.type === 'inside')
  };
}
