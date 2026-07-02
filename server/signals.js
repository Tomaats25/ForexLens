// ForexLens scoring — AOI-based (Set & Forget).
//
// Zones come from server/sr.js as Areas of Interest (body-rejection price zones).
// A directional setup needs price AT an AOI (within 10 pips of an edge):
//   support AOI (price above) → BUY · resistance AOI (price below) → SELL.
// Price INSIDE an AOI → WATCH (breakout / rejection).
// Entry = zone midpoint. SL = 5 pips beyond the far/near edge. TP = SL distance × RR.

const AT_AOI_PIPS = 10; // price is "at AOI" within 10 pips of an edge
const WATCH_NEAR_PIPS = 30; // strong zone this close (but not at) → WATCH
const SL_BUFFER_PIPS = 5;

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

// Pip distance from price to the nearest edge of an AOI zone (0 if inside).
function edgePips(price, zone, pip) {
  if (price >= zone.bottom && price <= zone.top) return 0;
  if (price > zone.top) return (price - zone.top) / pip;
  return (zone.bottom - price) / pip;
}

function nearestZoneOf(price, zones, pip) {
  let best = null;
  let bestPips = Infinity;
  for (const z of zones || []) {
    const p = edgePips(price, z, pip);
    if (p < bestPips) {
      bestPips = p;
      best = z;
    }
  }
  return best ? { zone: best, pips: bestPips } : null;
}

function describeNearest(near, pair, pip) {
  if (!near) return null;
  const z = near.zone;
  return {
    type: z.type,
    top: z.top,
    bottom: z.bottom,
    midpoint: z.midpoint,
    pips_wide: z.pips_wide,
    weighted_score: z.weighted_score,
    touch_count: z.touch_count,
    timeframe: z.timeframe,
    is_psychological: z.is_psychological,
    // legacy aliases (autofill + ChartPanel read these)
    mid: z.midpoint,
    low: z.bottom,
    high: z.top,
    touches: z.weighted_score,
    distancePips: Math.round(near.pips),
    distancePct: Number((((near.pips * pip) / (z.midpoint || 1)) * 100).toFixed(2))
  };
}

// Curated AOI zone for the signal output (new fields + legacy aliases).
function describeZone(z, pair) {
  return {
    type: z.type,
    top: round(z.top, pair),
    bottom: round(z.bottom, pair),
    midpoint: round(z.midpoint, pair),
    pips_wide: z.pips_wide,
    touch_count: z.touch_count,
    weighted_score: z.weighted_score,
    timeframe: z.timeframe,
    is_psychological: z.is_psychological,
    psychLevel: z.psych_level ?? null,
    low: round(z.bottom, pair),
    high: round(z.top, pair),
    mid: round(z.midpoint, pair),
    touches: z.weighted_score
  };
}

function isBreakRetest(daily, zone, direction) {
  if (daily.length < 10) return false;
  const history = daily.slice(-40, -3);
  if (history.length === 0) return false;
  const lastClose = daily[daily.length - 1].close;
  if (direction === 'BUY') {
    const wasBelow = history.some((c) => c.close < zone.bottom);
    return wasBelow && lastClose >= zone.bottom;
  }
  const wasAbove = history.some((c) => c.close > zone.top);
  return wasAbove && lastClose <= zone.top;
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

// TP = SL distance × RR, capped just short of the next opposing AOI in the path.
function placeTakeProfit(direction, entry, sl, rr, sr, pair) {
  const pip = pipSize(pair);
  const slDist = Math.abs(entry - sl);
  let tp = direction === 'BUY' ? entry + slDist * rr : entry - slDist * rr;
  let cappedBy = null;
  const opposing = (direction === 'BUY' ? sr.resistance : sr.support) || [];
  for (const z of opposing) {
    if (direction === 'BUY' && z.bottom > entry && z.bottom < tp) {
      const capped = z.bottom - pip;
      if (capped > entry) {
        tp = capped;
        cappedBy = z;
      }
    } else if (direction === 'SELL' && z.top < entry && z.top > tp) {
      const capped = z.top + pip;
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

// Direction for the best-entry suggestion. Support AOI (price above) → BUY,
// resistance → SELL. Inside a zone, fall back to the trend.
function suggestionDirection(zone, alignment, dailyStructure) {
  if (zone.type === 'support') return 'BUY';
  if (zone.type === 'resistance') return 'SELL';
  const trend =
    alignment.direction || (dailyStructure !== 'UNCLEAR' ? dailyStructure : null);
  if (trend === 'BULLISH') return 'BUY';
  if (trend === 'BEARISH') return 'SELL';
  return null;
}

// Best-entry suggestion (the "RR box") — attached to any result with a zone so the
// UI can always answer: where is the best entry, which way, and at what RR.
function buildEntrySuggestion(pair, zone, direction, sr, opts = {}) {
  if (!zone || !direction) return null;
  const pip = pipSize(pair);
  const entry = zone.midpoint;
  const sl =
    direction === 'BUY'
      ? zone.bottom - SL_BUFFER_PIPS * pip
      : zone.top + SL_BUFFER_PIPS * pip;
  const rr = opts.rr ?? (zone.weighted_score >= 6 ? 3 : 2);
  const { tp, cappedBy } = placeTakeProfit(direction, entry, sl, rr, sr, pair);
  const riskPips = Math.round(Math.abs(entry - sl) / pip);
  const rewardPips = Math.round(Math.abs(tp - entry) / pip);
  return {
    direction,
    entry: round(entry, pair),
    // Best-entry range: from the zone edge price approaches first to the midpoint.
    entryZone: {
      from: round(direction === 'BUY' ? zone.top : zone.bottom, pair),
      to: round(entry, pair)
    },
    sl: round(sl, pair),
    tp: round(tp, pair),
    rr,
    riskPips,
    rewardPips,
    actualRR: riskPips > 0 ? Number((rewardPips / riskPips).toFixed(2)) : null,
    tpCapped: !!cappedBy,
    confidence: opts.confidence || 'low',
    note: opts.note || null
  };
}

function determineReason(score, hasBR, hasRejection, alignmentStrength) {
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

function buildBaseInfo(pair, currentPrice, daily, sr, w, d, h4, alignment) {
  const pip = pipSize(pair);
  const sNear = nearestZoneOf(currentPrice, sr.support, pip);
  const rNear = nearestZoneOf(currentPrice, sr.resistance, pip);
  return {
    currentPrice: round(currentPrice, pair),
    trend: alignment.direction || 'MIXED',
    atr: round(atr(daily, 14), pair),
    mtfAlignment: {
      weekly: w,
      daily: d,
      h4: h4,
      strength: alignment.strength,
      allAligned: alignment.strength === 'STRONG' && h4 === w
    },
    nearestSupport: describeNearest(sNear, pair, pip),
    nearestResistance: describeNearest(rNear, pair, pip)
  };
}

function logSummary(pair, w, d, h4, score, reason) {
  console.log(
    `${pair}: weekly=${w.toLowerCase()} daily=${d.toLowerCase()} 4H=${h4.toLowerCase()} score=${score} reason=${reason}`
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

  const currentPrice = daily[daily.length - 1].close;
  const pip = pipSize(pair);
  const baseInfo = buildBaseInfo(
    pair,
    currentPrice,
    daily,
    sr,
    weeklyStructure,
    dailyStructure,
    h4Structure,
    alignment
  );

  const zones =
    sr.zones && sr.zones.length
      ? sr.zones
      : [...(sr.support || []), ...(sr.resistance || []), ...(sr.inside || [])];

  // Active AOI = nearest by edge distance (ties → higher weighted score).
  let active = null;
  let activePips = Infinity;
  for (const z of zones) {
    const p = edgePips(currentPrice, z, pip);
    if (p < activePips - 1e-9 || (Math.abs(p - activePips) < 1e-9 && active && z.weighted_score > active.weighted_score)) {
      activePips = p;
      active = z;
    }
  }

  const emptySignal = (reason) => ({
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
    zone: active ? describeZone(active, pair) : null,
    trigger: null,
    psychLevel: null,
    psychConfluence: false,
    tpCappedBy: null,
    insideAOI: false,
    atAOI: false,
    aoiPips: active ? Math.round(activePips) : null,
    entrySuggestion: active
      ? buildEntrySuggestion(
          pair,
          active,
          suggestionDirection(active, alignment, dailyStructure),
          sr,
          {
            note:
              activePips <= AT_AOI_PIPS
                ? 'At the AOI — waiting for a valid trigger'
                : `Price is ${Math.round(activePips)}p from the AOI — set a limit order at the zone`,
            confidence: 'low'
          }
        )
      : null,
    reason
  });

  if (!active) {
    logSummary(pair, weeklyStructure, dailyStructure, h4Structure, 0, 'no_zone');
    return emptySignal('no_zone');
  }

  const inside = currentPrice >= active.bottom && currentPrice <= active.top;
  const atAOI = !inside && activePips <= AT_AOI_PIPS;
  const zoneOut = describeZone(active, pair);

  // INSIDE an AOI → WATCH for breakout / rejection.
  if (inside) {
    logSummary(pair, weeklyStructure, dailyStructure, h4Structure, 0, 'inside_aoi');
    return {
      ...baseInfo,
      direction: 'WATCH',
      score: 0,
      actionable: false,
      entry: round(active.midpoint, pair),
      sl: null,
      tp: null,
      rr: null,
      slPips: null,
      tpPips: null,
      zone: zoneOut,
      trigger: null,
      psychLevel: active.psych_level ?? null,
      psychConfluence: active.is_psychological,
      tpCappedBy: null,
      insideAOI: true,
      atAOI: false,
      aoiPips: 0,
      watchDistance: 0,
      entrySuggestion: buildEntrySuggestion(
        pair,
        active,
        suggestionDirection(active, alignment, dailyStructure),
        sr,
        {
          note: 'Price is inside the AOI — enter on a rejection in the trend direction',
          confidence: 'medium'
        }
      ),
      reason: 'inside_aoi'
    };
  }

  // Not inside, and not within 10 pips of an edge.
  if (!atAOI) {
    if (active.weighted_score >= 6 && activePips <= WATCH_NEAR_PIPS) {
      logSummary(pair, weeklyStructure, dailyStructure, h4Structure, 0, 'near_strong_aoi');
      return {
        ...baseInfo,
        direction: 'WATCH',
        score: 0,
        actionable: false,
        entry: round(active.midpoint, pair),
        sl: null,
        tp: null,
        rr: null,
        slPips: null,
        tpPips: null,
        zone: zoneOut,
        trigger: null,
        psychLevel: active.psych_level ?? null,
        psychConfluence: active.is_psychological,
        tpCappedBy: null,
        insideAOI: false,
        atAOI: false,
        aoiPips: Math.round(activePips),
        watchDistance: Math.round(activePips),
        entrySuggestion: buildEntrySuggestion(
          pair,
          active,
          suggestionDirection(active, alignment, dailyStructure),
          sr,
          {
            note: `Strong AOI ${Math.round(activePips)}p away — set a limit order at the midpoint`,
            confidence: 'medium'
          }
        ),
        reason: 'near_strong_aoi'
      };
    }
    logSummary(pair, weeklyStructure, dailyStructure, h4Structure, 0, 'not_at_aoi');
    return emptySignal('not_at_aoi');
  }

  // At an AOI → directional. type encodes the side (support = price above → BUY).
  const direction = active.type === 'support' ? 'BUY' : 'SELL';

  const breakRetest = isBreakRetest(daily, active, direction);
  const lastH4 = h4?.length ? h4[h4.length - 1] : daily[daily.length - 1];
  const rej = rejectionDirection(lastH4);
  const rejectionMatches =
    (direction === 'BUY' && rej === 'BULLISH') ||
    (direction === 'SELL' && rej === 'BEARISH');

  // Score
  let score = 0;
  const ws = active.weighted_score;
  if (ws >= 6) score += 40;
  else if (ws >= 4) score += 30;
  else score += 20;
  if (active.is_psychological) score += 25;
  if (alignment.strength === 'STRONG' && alignment.direction === direction) score += 20;
  else if (alignment.strength === 'WEAK' && alignment.direction === direction) score += 10;
  if (h4Structure === (direction === 'BUY' ? 'BULLISH' : 'BEARISH')) score += 10;
  if (breakRetest) score += 15;
  if (rejectionMatches) score += 15;
  if (activePips <= 2) score += 10;
  else if (activePips <= AT_AOI_PIPS) score += 5;

  // Floors — a strong AOI right at price always reaches actionable.
  let floor = 0;
  if (ws >= 3 && activePips <= 2) floor = Math.max(floor, 40);
  if (ws >= 5 && activePips <= 5) floor = Math.max(floor, 45);
  if (ws >= 8 && activePips <= AT_AOI_PIPS) floor = Math.max(floor, 55);
  score = Math.max(score, floor);
  score = Math.min(100, Math.round(score));

  const reason = determineReason(score, breakRetest, rejectionMatches, alignment.strength);
  logSummary(pair, weeklyStructure, dailyStructure, h4Structure, score, reason);

  const trigger = triggerLabel(breakRetest, rejectionMatches);
  const psychLevel = active.psych_level ?? null;

  if (score < 25) {
    return {
      ...emptySignal(reason),
      zone: zoneOut,
      psychLevel,
      psychConfluence: active.is_psychological,
      aoiPips: Math.round(activePips)
    };
  }

  if (score < 40) {
    return {
      ...baseInfo,
      direction: 'WATCH',
      score,
      actionable: false,
      entry: round(active.midpoint, pair),
      sl: null,
      tp: null,
      rr: null,
      slPips: null,
      tpPips: null,
      zone: zoneOut,
      trigger,
      psychLevel,
      psychConfluence: active.is_psychological,
      tpCappedBy: null,
      insideAOI: false,
      atAOI: true,
      aoiPips: Math.round(activePips),
      watchDistance: Math.round(activePips),
      entrySuggestion: buildEntrySuggestion(pair, active, direction, sr, {
        note: 'At the AOI — trigger forming; place a limit order at the midpoint',
        confidence: 'medium'
      }),
      reason
    };
  }

  // Actionable: 40-59 → 1:2, 60-79 → 1:3, 80+ → 1:4
  const rr = score >= 80 ? 4 : score >= 60 ? 3 : 2;
  const tier = score >= 80 ? 'ELITE' : score >= 60 ? 'STRONG' : 'SIGNAL';
  const entry = active.midpoint;
  const sl =
    direction === 'BUY'
      ? active.bottom - SL_BUFFER_PIPS * pip
      : active.top + SL_BUFFER_PIPS * pip;
  const { tp, cappedBy } = placeTakeProfit(direction, entry, sl, rr, sr, pair);
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
    zone: zoneOut,
    trigger,
    psychLevel,
    psychConfluence: active.is_psychological,
    tpCappedBy: cappedBy
      ? { mid: round(cappedBy.midpoint, pair), touches: cappedBy.weighted_score }
      : null,
    alignmentStrength: alignment.strength,
    insideAOI: false,
    atAOI: true,
    aoiPips: Math.round(activePips),
    entrySuggestion: buildEntrySuggestion(pair, active, direction, sr, {
      rr,
      note: trigger ? `Trigger fired: ${trigger}` : 'At the AOI',
      confidence: 'high'
    }),
    reason
  };
}

// EMA series aligned to candle times — used by the chart route.
export function computeEMASeries(candles, period = 50) {
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
