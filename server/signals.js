// ForexLens scoring — relaxed MTF + score floors.
//
// Trend detection: avg of last 2 closes vs avg of prior 2 closes on each timeframe.
// Alignment: STRONG (W==D), WEAK (one unclear), MIXED (W vs D opposite), NONE (both no data).
// Score floors: strong zones near price always reach a SIGNAL band even without triggers.
// Bands: 80+ elite (1:4) · 60-79 strong (1:3) · 40-59 signal (1:2) · 25-39 watch · <25 no setup.

function pipSize(pair) {
  return pair.includes('JPY') ? 0.01 : 0.0001;
}

function round(num, pair) {
  const decimals = pair.includes('JPY') ? 3 : 5;
  return Number(num.toFixed(decimals));
}

function atr(candles, period = 14) {
  if (candles.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    trs.push(
      Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close))
    );
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// SIMPLE structure detection: average of last 2 closes vs average of prior 2 closes.
// Only returns UNCLEAR when fewer than 5 candles are available.
function getStructure(candles) {
  if (!candles || candles.length < 5) return 'UNCLEAR';
  const window = candles.slice(-10);
  const closes = window.map((c) => c.close);
  const n = closes.length;
  if (n < 4) return 'UNCLEAR';
  const last2 = (closes[n - 1] + closes[n - 2]) / 2;
  const prior2 = (closes[n - 3] + closes[n - 4]) / 2;
  if (last2 > prior2) return 'BULLISH';
  if (last2 < prior2) return 'BEARISH';
  return 'UNCLEAR';
}

function computeAlignment(weeklyStructure, dailyStructure) {
  const w = weeklyStructure;
  const d = dailyStructure;
  if (w === 'UNCLEAR' && d === 'UNCLEAR') return { strength: 'NONE', direction: null };
  if (w === 'UNCLEAR') return { strength: 'WEAK', direction: d };
  if (d === 'UNCLEAR') return { strength: 'WEAK', direction: w };
  if (w === d) return { strength: 'STRONG', direction: w };
  return { strength: 'MIXED', direction: null };
}

function zoneDistance(price, zone) {
  if (price >= zone.low && price <= zone.high) return 0;
  if (price > zone.high) return (price - zone.high) / price;
  return (zone.low - price) / price;
}

function nearestZone(price, zones) {
  let best = null;
  let bestDist = Infinity;
  for (const z of zones) {
    const d = zoneDistance(price, z);
    if (d < bestDist) {
      bestDist = d;
      best = z;
    }
  }
  return best ? { zone: best, distance: bestDist } : null;
}

function describeZone(zone, distance, pair) {
  return {
    mid: round(zone.mid, pair),
    low: round(zone.low, pair),
    high: round(zone.high, pair),
    touches: zone.touches,
    distancePct: Number((distance * 100).toFixed(2))
  };
}

function nearestPsychLevel(price, pair) {
  const step = pair.includes('JPY') ? 0.5 : 0.05;
  return Math.round(price / step) * step;
}

function checkPsychConfluence(zoneMid, pair, tolerance = 0.0015) {
  const psych = nearestPsychLevel(zoneMid, pair);
  return {
    level: psych,
    confluent: psych > 0 && Math.abs(zoneMid - psych) / zoneMid <= tolerance
  };
}

function isBreakRetest(daily, zone, direction) {
  if (daily.length < 10) return false;
  const history = daily.slice(-40, -3);
  if (history.length === 0) return false;
  const lastClose = daily[daily.length - 1].close;
  if (direction === 'BUY') {
    const wasBelow = history.some((c) => c.close < zone.low);
    return wasBelow && lastClose >= zone.low;
  }
  const wasAbove = history.some((c) => c.close > zone.high);
  return wasAbove && lastClose <= zone.high;
}

function rejectionDirection(candle) {
  if (!candle) return null;
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const range = candle.high - candle.low;
  if (range <= 0) return null;
  if (body === 0) {
    if (lowerWick > 2 * upperWick && lowerWick > range * 0.5) return 'BULLISH';
    if (upperWick > 2 * lowerWick && upperWick > range * 0.5) return 'BEARISH';
    return null;
  }
  if (lowerWick >= 2 * body) return 'BULLISH';
  if (upperWick >= 2 * body) return 'BEARISH';
  return null;
}

function findSwingLowsBelow(daily, threshold, lookback = 2, window = 40) {
  const recent = daily.slice(-window);
  const lows = [];
  for (let i = lookback; i < recent.length - lookback; i++) {
    const c = recent[i];
    if (c.low >= threshold) continue;
    let isSwing = true;
    for (let j = 1; j <= lookback; j++) {
      if (recent[i - j].low <= c.low || recent[i + j].low <= c.low) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) lows.push(c.low);
  }
  return lows;
}

function findSwingHighsAbove(daily, threshold, lookback = 2, window = 40) {
  const recent = daily.slice(-window);
  const highs = [];
  for (let i = lookback; i < recent.length - lookback; i++) {
    const c = recent[i];
    if (c.high <= threshold) continue;
    let isSwing = true;
    for (let j = 1; j <= lookback; j++) {
      if (recent[i - j].high >= c.high || recent[i + j].high >= c.high) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) highs.push(c.high);
  }
  return highs;
}

function placeStopLoss(direction, zone, daily, pair) {
  const pip = pipSize(pair);
  const buffer = pair.includes('JPY') ? 10 * pip : 5 * pip;
  if (direction === 'BUY') {
    const defaultSL = zone.low - buffer;
    const swings = findSwingLowsBelow(daily, zone.low);
    if (swings.length > 0) {
      const highest = Math.max(...swings);
      const swingSL = highest - pip;
      if (swingSL < zone.low && swingSL > defaultSL) return swingSL;
    }
    return defaultSL;
  }
  const defaultSL = zone.high + buffer;
  const swings = findSwingHighsAbove(daily, zone.high);
  if (swings.length > 0) {
    const lowest = Math.min(...swings);
    const swingSL = lowest + pip;
    if (swingSL > zone.high && swingSL < defaultSL) return swingSL;
  }
  return defaultSL;
}

function placeTakeProfit(direction, entry, sl, rr, sr, pair) {
  const pip = pipSize(pair);
  const slDist = Math.abs(entry - sl);
  let tp = direction === 'BUY' ? entry + slDist * rr : entry - slDist * rr;
  let cappedBy = null;
  const opposing = (direction === 'BUY' ? sr.resistance : sr.support).filter(
    (z) => z.touches >= 3
  );
  for (const z of opposing) {
    if (direction === 'BUY' && z.low > entry && z.low < tp) {
      const capped = z.low - pip;
      if (capped > entry) {
        tp = capped;
        cappedBy = z;
      }
    } else if (direction === 'SELL' && z.high < entry && z.high > tp) {
      const capped = z.high + pip;
      if (capped < entry) {
        tp = capped;
        cappedBy = z;
      }
    }
  }
  return { tp, cappedBy };
}

function triggerLabel(breakRetest, rejection) {
  if (breakRetest && rejection) return 'Break & Retest + Rejection';
  if (breakRetest) return 'Break & Retest';
  if (rejection) return 'Rejection';
  return null;
}

// Score floors: strong zones near price always reach actionable, regardless of triggers/trend.
function applyScoreFloors(score, zone, distance) {
  let floor = 0;
  if (zone.touches >= 3 && distance <= 0.001) floor = Math.max(floor, 40);
  if (zone.touches >= 5 && distance <= 0.002) floor = Math.max(floor, 45);
  if (zone.touches >= 8 && distance <= 0.005) floor = Math.max(floor, 55);
  return Math.max(score, floor);
}

const MAX_ZONE_DIST = 0.005; // 0.5% — relaxed from prior 0.3%
const PSYCH_TOLERANCE = 0.0015;

function determineReason(score, hasZone, hasBR, hasRejection, alignmentStrength) {
  if (!hasZone) return 'no_zone';
  if (score >= 80) return 'elite';
  if (score >= 60) return 'strong';
  if (score >= 40) return 'signal';
  if (score >= 25) return 'watch';
  if (!hasBR && !hasRejection) return 'no_trigger';
  if (alignmentStrength === 'MIXED') return 'mixed_trend';
  if (alignmentStrength === 'WEAK') return 'weak_trend';
  if (alignmentStrength === 'NONE') return 'no_trend';
  return 'low_score';
}

function buildBaseInfo(pair, daily, sr, weeklyStructure, dailyStructure, h4Structure, alignment) {
  const currentPrice = daily[daily.length - 1].close;
  const sNear = nearestZone(currentPrice, sr.support);
  const rNear = nearestZone(currentPrice, sr.resistance);
  return {
    currentPrice: round(currentPrice, pair),
    trend: alignment.direction || 'MIXED',
    atr: round(atr(daily, 14), pair),
    mtfAlignment: {
      weekly: weeklyStructure,
      daily: dailyStructure,
      h4: h4Structure,
      strength: alignment.strength,
      allAligned:
        alignment.strength === 'STRONG' && h4Structure === weeklyStructure
    },
    nearestSupport: sNear ? describeZone(sNear.zone, sNear.distance, pair) : null,
    nearestResistance: rNear ? describeZone(rNear.zone, rNear.distance, pair) : null
  };
}

function logSummary(pair, weeklyStructure, dailyStructure, h4Structure, score, reason) {
  console.log(
    `${pair}: weekly=${weeklyStructure.toLowerCase()} daily=${dailyStructure.toLowerCase()} 4H=${h4Structure.toLowerCase()} score=${score} reason=${reason}`
  );
}

export function computeSignal(pair, weekly, daily, h4, sr) {
  if (!weekly?.length || !daily?.length) {
    console.log(`${pair}: weekly=no_data daily=no_data 4H=no_data score=0 reason=no_data`);
    return null;
  }

  const weeklyStructure = getStructure(weekly);
  const dailyStructure = getStructure(daily);
  const h4Structure = h4?.length ? getStructure(h4) : 'UNCLEAR';

  const alignment = computeAlignment(weeklyStructure, dailyStructure);
  const baseInfo = buildBaseInfo(
    pair,
    daily,
    sr,
    weeklyStructure,
    dailyStructure,
    h4Structure,
    alignment
  );

  const currentPrice = daily[daily.length - 1].close;

  // Find nearest qualifying zone (3+ touches within 0.5%)
  const allZones = [...sr.support, ...sr.resistance].filter((z) => z.touches >= 3);
  let zone = null;
  let distance = Infinity;
  for (const z of allZones) {
    const d = zoneDistance(currentPrice, z);
    if (d > MAX_ZONE_DIST) continue;
    if (d < distance) {
      distance = d;
      zone = z;
    }
  }

  if (!zone) {
    logSummary(pair, weeklyStructure, dailyStructure, h4Structure, 0, 'no_zone');
    return {
      ...baseInfo,
      direction: 'NONE',
      score: 0,
      actionable: false,
      entry: null,
      sl: null,
      tp: null,
      rr: null,
      slPips: null,
      tpPips: null,
      zone: null,
      trigger: null,
      psychLevel: null,
      psychConfluence: false,
      tpCappedBy: null,
      reason: 'no_zone'
    };
  }

  // Direction from zone position (with fallback to trend if zone is centered on price)
  let direction;
  if (currentPrice >= zone.low) {
    direction = 'BUY'; // price at/above zone → zone acts as support
  } else {
    direction = 'SELL'; // price below zone → zone acts as resistance
  }

  // Triggers
  const breakRetest = isBreakRetest(daily, zone, direction);
  const lastH4 = h4?.length ? h4[h4.length - 1] : daily[daily.length - 1];
  const rej = rejectionDirection(lastH4);
  const rejectionMatches =
    (direction === 'BUY' && rej === 'BULLISH') ||
    (direction === 'SELL' && rej === 'BEARISH');

  const psych = checkPsychConfluence(zone.mid, pair, PSYCH_TOLERANCE);

  // Score
  let score = 0;
  if (zone.touches >= 6) score += 40;
  else if (zone.touches >= 4) score += 30;
  else score += 20;
  if (psych.confluent) score += 25;
  // Alignment bonus
  if (alignment.strength === 'STRONG' && alignment.direction === direction) score += 20;
  else if (alignment.strength === 'WEAK' && alignment.direction === direction) score += 10;
  // 4H confirms
  if (h4Structure === (direction === 'BUY' ? 'BULLISH' : 'BEARISH')) score += 10;
  if (breakRetest) score += 15;
  if (rejectionMatches) score += 15;
  if (distance <= 0.001) score += 10;
  else if (distance <= 0.003) score += 5;

  // Apply floors — strong zones near price always reach actionable
  score = applyScoreFloors(score, zone, distance);
  score = Math.min(100, Math.round(score));

  const reason = determineReason(score, true, breakRetest, rejectionMatches, alignment.strength);
  logSummary(pair, weeklyStructure, dailyStructure, h4Structure, score, reason);

  const trigger = triggerLabel(breakRetest, rejectionMatches);
  const zoneDescribed = {
    low: round(zone.low, pair),
    high: round(zone.high, pair),
    mid: round(zone.mid, pair),
    touches: zone.touches
  };

  // Band → display
  if (score < 25) {
    return {
      ...baseInfo,
      direction: 'NONE',
      score,
      actionable: false,
      entry: null,
      sl: null,
      tp: null,
      rr: null,
      slPips: null,
      tpPips: null,
      zone: zoneDescribed,
      trigger,
      psychLevel: psych.confluent ? round(psych.level, pair) : null,
      psychConfluence: psych.confluent,
      tpCappedBy: null,
      reason
    };
  }

  if (score < 40) {
    // WATCH band
    return {
      ...baseInfo,
      direction: 'WATCH',
      score,
      actionable: false,
      entry: round(zone.mid, pair),
      sl: null,
      tp: null,
      rr: null,
      slPips: null,
      tpPips: null,
      zone: zoneDescribed,
      trigger,
      psychLevel: psych.confluent ? round(psych.level, pair) : null,
      psychConfluence: psych.confluent,
      tpCappedBy: null,
      watchDistance: Number((distance * 100).toFixed(2)),
      reason
    };
  }

  // Actionable: 40-59 → 1:2, 60-79 → 1:3, 80+ → 1:4
  const rr = score >= 80 ? 4 : score >= 60 ? 3 : 2;
  const tier = score >= 80 ? 'ELITE' : score >= 60 ? 'STRONG' : 'SIGNAL';
  const entry = zone.mid;
  const sl = placeStopLoss(direction, zone, daily, pair);
  const { tp, cappedBy } = placeTakeProfit(direction, entry, sl, rr, sr, pair);
  const pip = pipSize(pair);
  const slPips = Math.round(Math.abs(entry - sl) / pip);
  const tpPips = Math.round(Math.abs(tp - entry) / pip);

  return {
    ...baseInfo,
    direction,
    score,
    actionable: true,
    tier,
    entry: round(entry, pair),
    sl: round(sl, pair),
    tp: round(tp, pair),
    rr,
    slPips,
    tpPips,
    zone: zoneDescribed,
    trigger,
    psychLevel: psych.confluent ? round(psych.level, pair) : null,
    psychConfluence: psych.confluent,
    tpCappedBy: cappedBy
      ? { mid: round(cappedBy.mid, pair), touches: cappedBy.touches }
      : null,
    alignmentStrength: alignment.strength,
    reason
  };
}

// EMA series aligned to candle times — used by the chart route.
export function computeEMASeries(candles, period = 20) {
  if (!candles || candles.length < period) return [];
  const k = 2 / (period + 1);
  let prev = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  const out = [{ time: candles[period - 1].time, value: prev }];
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: prev });
  }
  return out;
}
