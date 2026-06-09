// Set & Forget multi-timeframe strategy — with relaxed MTF rules + WATCH override.
//
// Trend strength:
//   STRONG  — weekly AND daily structures both clear AND matching → full score
//   WEAK    — only one of weekly/daily is clear, the other is UNCLEAR → half score
//   CONFLICT— weekly and daily oppose each other → no directional signal (still WATCH)
//   NONE    — both UNCLEAR → no directional signal (still WATCH)
//
// WATCH override: any zone with 6+ touches within 0.5% of price always shows,
//                 even if trend doesn't qualify for BUY/SELL.

function isStrictlyAscending(arr) {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] <= arr[i - 1]) return false;
  }
  return true;
}

function isStrictlyDescending(arr) {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] >= arr[i - 1]) return false;
  }
  return true;
}

function findSwings(candles, lookback) {
  const highs = [];
  const lows = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].high >= c.high || candles[i + j].high >= c.high) isHigh = false;
      if (candles[i - j].low <= c.low || candles[i + j].low <= c.low) isLow = false;
    }
    if (isHigh) highs.push({ price: c.high, time: c.time });
    if (isLow) lows.push({ price: c.low, time: c.time });
  }
  return { highs, lows };
}

function getStructure(candles, lookback = 2) {
  if (!candles || candles.length < 10) return 'UNCLEAR';
  const swings = findSwings(candles, lookback);
  const lastHighs = swings.highs.slice(-3).map((h) => h.price);
  const lastLows = swings.lows.slice(-3).map((l) => l.price);
  if (lastHighs.length < 2 || lastLows.length < 2) return 'UNCLEAR';
  if (isStrictlyAscending(lastHighs) && isStrictlyAscending(lastLows)) return 'BULLISH';
  if (isStrictlyDescending(lastHighs) && isStrictlyDescending(lastLows)) return 'BEARISH';
  return 'UNCLEAR';
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

function pipSize(pair) {
  return pair.includes('JPY') ? 0.01 : 0.0001;
}

function round(num, pair) {
  const decimals = pair.includes('JPY') ? 3 : 5;
  return Number(num.toFixed(decimals));
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

function computeAlignment(weekly, daily) {
  const w = weekly;
  const d = daily;
  if (w !== 'UNCLEAR' && d !== 'UNCLEAR' && w === d) return 'STRONG';
  if (w !== 'UNCLEAR' && d === 'UNCLEAR') return 'WEAK';
  if (w === 'UNCLEAR' && d !== 'UNCLEAR') return 'WEAK';
  if (w !== 'UNCLEAR' && d !== 'UNCLEAR' && w !== d) return 'CONFLICT';
  return 'NONE';
}

const MAX_SIGNAL_DIST = 0.003; // 0.3%
const WATCH_DIST = 0.005; // 0.5%
const WATCH_MIN_TOUCHES = 6;
const PSYCH_TOLERANCE = 0.0015;
const SCORE_THRESHOLD = 20;

function buildBaseInfo(pair, weekly, daily, h4, sr, weeklyStructure, dailyStructure, h4Structure, alignmentStrength) {
  const currentPrice = daily[daily.length - 1].close;
  const sNear = nearestZone(currentPrice, sr.support);
  const rNear = nearestZone(currentPrice, sr.resistance);
  return {
    currentPrice: round(currentPrice, pair),
    trend: alignmentStrength === 'STRONG' ? weeklyStructure : weeklyStructure !== 'UNCLEAR' ? weeklyStructure : dailyStructure,
    atr: round(atr(daily, 14), pair),
    mtfAlignment: {
      weekly: weeklyStructure,
      daily: dailyStructure,
      h4: h4Structure,
      strength: alignmentStrength,
      allAligned:
        alignmentStrength === 'STRONG' &&
        h4Structure === weeklyStructure
    },
    nearestSupport: sNear ? describeZone(sNear.zone, sNear.distance, pair) : null,
    nearestResistance: rNear ? describeZone(rNear.zone, rNear.distance, pair) : null
  };
}

function findWatchZone(currentPrice, allZones) {
  let watchZone = null;
  let watchDist = Infinity;
  for (const z of allZones) {
    if (z.touches < WATCH_MIN_TOUCHES) continue;
    const d = zoneDistance(currentPrice, z);
    if (d > WATCH_DIST) continue;
    if (d < watchDist) {
      watchDist = d;
      watchZone = z;
    }
  }
  return watchZone ? { zone: watchZone, distance: watchDist } : null;
}

function buildWatch(baseInfo, zone, distance, pair, reason) {
  const psych = checkPsychConfluence(zone.mid, pair, PSYCH_TOLERANCE);
  let score = 0;
  score += Math.min(zone.touches * 8, 60);
  if (distance <= 0.001) score += 20;
  else if (distance <= 0.003) score += 10;
  else if (distance <= 0.005) score += 5;
  if (psych.confluent) score += 20;
  score = Math.min(100, Math.round(score));

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
    zone: {
      low: round(zone.low, pair),
      high: round(zone.high, pair),
      mid: round(zone.mid, pair),
      touches: zone.touches
    },
    trigger: null,
    psychLevel: psych.confluent ? round(psych.level, pair) : null,
    psychConfluence: psych.confluent,
    tpCappedBy: null,
    watchDistance: Number((distance * 100).toFixed(2)),
    reason
  };
}

function buildNonActionable(baseInfo, direction, score, zone, trigger, psych, pair, reason) {
  return {
    ...baseInfo,
    direction,
    score: Math.round(score),
    actionable: false,
    entry: null,
    sl: null,
    tp: null,
    rr: null,
    slPips: null,
    tpPips: null,
    zone: zone
      ? {
          low: round(zone.low, pair),
          high: round(zone.high, pair),
          mid: round(zone.mid, pair),
          touches: zone.touches
        }
      : null,
    trigger,
    psychLevel: psych?.confluent ? round(psych.level, pair) : null,
    psychConfluence: !!psych?.confluent,
    tpCappedBy: null,
    reason
  };
}

export function computeSignal(pair, weekly, daily, h4, sr) {
  console.log(`[${pair}] === scan ===`);

  if (!weekly?.length || !daily?.length) {
    console.log(`[${pair}] no data (weekly=${weekly?.length || 0} daily=${daily?.length || 0})`);
    return null;
  }
  if (weekly.length < 10) {
    console.log(`[${pair}] insufficient weekly data (${weekly.length} candles)`);
    return null;
  }

  console.log(
    `[${pair}] weekly closes (last 5): ${weekly
      .slice(-5)
      .map((c) => round(c.close, pair))
      .join(', ')}`
  );
  console.log(
    `[${pair}] daily closes (last 5): ${daily
      .slice(-5)
      .map((c) => round(c.close, pair))
      .join(', ')}`
  );

  const weeklyStructure = getStructure(weekly, 2);
  const dailyStructure = getStructure(daily, 3);
  const h4Structure = h4?.length ? getStructure(h4, 3) : 'NO_DATA';

  // Show the swings the structure detector saw, so we can see WHY it picked the label.
  const wSwings = findSwings(weekly, 2);
  const dSwings = findSwings(daily, 3);
  console.log(
    `[${pair}] weekly swings (last 3 highs/lows): H=${wSwings.highs
      .slice(-3)
      .map((s) => round(s.price, pair))
      .join('→')} L=${wSwings.lows
      .slice(-3)
      .map((s) => round(s.price, pair))
      .join('→')}`
  );
  console.log(
    `[${pair}] daily swings (last 3 highs/lows):  H=${dSwings.highs
      .slice(-3)
      .map((s) => round(s.price, pair))
      .join('→')} L=${dSwings.lows
      .slice(-3)
      .map((s) => round(s.price, pair))
      .join('→')}`
  );

  console.log(
    `[${pair}] structures: W=${weeklyStructure} D=${dailyStructure} 4H=${h4Structure}`
  );

  const alignmentStrength = computeAlignment(weeklyStructure, dailyStructure);
  console.log(`[${pair}] alignment: ${alignmentStrength}`);

  const baseInfo = buildBaseInfo(
    pair,
    weekly,
    daily,
    h4,
    sr,
    weeklyStructure,
    dailyStructure,
    h4Structure,
    alignmentStrength
  );

  const currentPrice = daily[daily.length - 1].close;
  console.log(`[${pair}] current price: ${round(currentPrice, pair)}`);

  // Pre-scan for a WATCH-eligible zone (used as fallback at every failure point).
  const allZones = [...sr.support, ...sr.resistance];
  const watch = findWatchZone(currentPrice, allZones);
  if (watch) {
    console.log(
      `[${pair}] WATCH-eligible zone: ${round(watch.zone.mid, pair)} (${watch.zone.touches}x, ${(
        watch.distance * 100
      ).toFixed(2)}% away)`
    );
  } else {
    console.log(`[${pair}] no WATCH-eligible zone (need ${WATCH_MIN_TOUCHES}+ touches within ${WATCH_DIST * 100}%)`);
  }

  // Decide direction from alignment
  let direction = null;
  if (alignmentStrength === 'STRONG' || alignmentStrength === 'WEAK') {
    const trendBullish =
      weeklyStructure === 'BULLISH' || (weeklyStructure === 'UNCLEAR' && dailyStructure === 'BULLISH');
    direction = trendBullish ? 'BUY' : 'SELL';
  }

  if (!direction) {
    if (watch) {
      console.log(`[${pair}] RESULT: WATCH (no trend direction, alignment=${alignmentStrength})`);
      return buildWatch(baseInfo, watch.zone, watch.distance, pair, `Trend ${alignmentStrength}`);
    }
    console.log(`[${pair}] RESULT: NO SETUP (alignment=${alignmentStrength}, no watch zone)`);
    return buildNonActionable(
      baseInfo,
      'NONE',
      0,
      null,
      null,
      null,
      pair,
      `Trend ${alignmentStrength}`
    );
  }

  // Find a qualifying directional zone (3+ touches, within 0.3%, correctly positioned).
  const qualifying = allZones.filter((z) => z.touches >= 3);
  console.log(`[${pair}] qualifying levels (3+ touches): ${qualifying.length}`);

  let zone = null;
  let distance = Infinity;
  for (const z of qualifying) {
    const d = zoneDistance(currentPrice, z);
    if (d > MAX_SIGNAL_DIST) continue;
    if (direction === 'BUY' && currentPrice < z.low) continue;
    if (direction === 'SELL' && currentPrice > z.high) continue;
    if (d < distance) {
      distance = d;
      zone = z;
    }
  }

  if (!zone) {
    console.log(
      `[${pair}] no qualifying zone in range for ${direction} (need 3+ touches within ${
        MAX_SIGNAL_DIST * 100
      }%)`
    );
    if (watch) {
      console.log(`[${pair}] RESULT: WATCH (no directional zone in range)`);
      return buildWatch(baseInfo, watch.zone, watch.distance, pair, 'No directional zone in range');
    }
    console.log(`[${pair}] RESULT: NO SETUP (${direction} but no qualifying zone, no watch)`);
    return buildNonActionable(baseInfo, direction, 0, null, null, null, pair, 'No qualifying zone in range');
  }

  console.log(
    `[${pair}] selected zone: ${round(zone.mid, pair)} (${zone.touches}x touches, ${(
      distance * 100
    ).toFixed(2)}% away)`
  );

  // Triggers
  const breakRetest = isBreakRetest(daily, zone, direction);
  const lastH4 = h4?.length ? h4[h4.length - 1] : daily[daily.length - 1];
  const rejection = rejectionDirection(lastH4);
  const rejectionMatches =
    (direction === 'BUY' && rejection === 'BULLISH') ||
    (direction === 'SELL' && rejection === 'BEARISH');
  console.log(`[${pair}] triggers: BreakRetest=${breakRetest} Rejection=${rejectionMatches}`);

  const trigger = triggerLabel(breakRetest, rejectionMatches);
  const psych = checkPsychConfluence(zone.mid, pair, PSYCH_TOLERANCE);
  console.log(
    `[${pair}] psych confluence: ${psych.confluent} (nearest psych: ${round(psych.level, pair)})`
  );

  if (!breakRetest && !rejectionMatches) {
    if (watch) {
      console.log(`[${pair}] RESULT: WATCH (no trigger fired; falling back to watch zone)`);
      return buildWatch(baseInfo, watch.zone, watch.distance, pair, 'No entry trigger');
    }
    console.log(`[${pair}] RESULT: NO SETUP (no trigger fired)`);
    return buildNonActionable(baseInfo, direction, 0, zone, null, psych, pair, 'No entry trigger');
  }

  // Score
  let score = 0;
  if (zone.touches >= 6) score += 40;
  else if (zone.touches >= 4) score += 30;
  else score += 20;
  if (psych.confluent) score += 25;
  score += 20; // alignment bonus (halved later if WEAK)
  if (h4Structure === (direction === 'BUY' ? 'BULLISH' : 'BEARISH')) score += 10;
  if (breakRetest) score += 15;
  if (rejectionMatches) score += 15;
  if (distance <= 0.001) score += 10;
  else if (distance <= 0.003) score += 5;
  const rawScore = Math.min(100, score);
  const finalScore =
    alignmentStrength === 'WEAK' ? Math.round(rawScore * 0.5) : rawScore;
  console.log(
    `[${pair}] score: raw=${rawScore} × (${alignmentStrength === 'WEAK' ? '0.5 weak' : '1.0 strong'}) = ${finalScore}`
  );

  if (finalScore < SCORE_THRESHOLD) {
    if (watch) {
      console.log(`[${pair}] RESULT: WATCH (score ${finalScore} < ${SCORE_THRESHOLD})`);
      return buildWatch(baseInfo, watch.zone, watch.distance, pair, `Score ${finalScore} too low`);
    }
    console.log(`[${pair}] RESULT: NO SETUP (score ${finalScore} < ${SCORE_THRESHOLD})`);
    return buildNonActionable(
      baseInfo,
      direction,
      finalScore,
      zone,
      trigger,
      psych,
      pair,
      `Score ${finalScore} below threshold`
    );
  }

  const rr = finalScore >= 75 ? 4 : finalScore >= 55 ? 3 : 2;
  const entry = zone.mid;
  const sl = placeStopLoss(direction, zone, daily, pair);
  const { tp, cappedBy } = placeTakeProfit(direction, entry, sl, rr, sr, pair);
  const pip = pipSize(pair);
  const slPips = Math.round(Math.abs(entry - sl) / pip);
  const tpPips = Math.round(Math.abs(tp - entry) / pip);

  console.log(`[${pair}] RESULT: ${direction} score=${finalScore} rr=1:${rr} entry=${round(entry, pair)} sl=${round(sl, pair)} tp=${round(tp, pair)}`);

  return {
    ...baseInfo,
    direction,
    score: finalScore,
    actionable: true,
    entry: round(entry, pair),
    sl: round(sl, pair),
    tp: round(tp, pair),
    rr,
    slPips,
    tpPips,
    zone: {
      low: round(zone.low, pair),
      high: round(zone.high, pair),
      mid: round(zone.mid, pair),
      touches: zone.touches
    },
    trigger,
    psychLevel: psych.confluent ? round(psych.level, pair) : null,
    psychConfluence: psych.confluent,
    tpCappedBy: cappedBy ? { mid: round(cappedBy.mid, pair), touches: cappedBy.touches } : null,
    alignmentStrength
  };
}
