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

function clusterLevels(levels, tolerance = 0.003) {
  if (!levels.length) return [];
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const zones = [];
  let current = { prices: [sorted[0].price], touches: 1, times: [sorted[0].time] };

  for (let i = 1; i < sorted.length; i++) {
    const last = current.prices[current.prices.length - 1];
    const ratio = Math.abs(sorted[i].price - last) / last;
    if (ratio <= tolerance) {
      current.prices.push(sorted[i].price);
      current.touches++;
      current.times.push(sorted[i].time);
    } else {
      zones.push(finalize(current));
      current = { prices: [sorted[i].price], touches: 1, times: [sorted[i].time] };
    }
  }
  zones.push(finalize(current));
  return zones;
}

function finalize(zone) {
  const min = Math.min(...zone.prices);
  const max = Math.max(...zone.prices);
  const avg = zone.prices.reduce((a, b) => a + b, 0) / zone.prices.length;
  return {
    low: min,
    high: max,
    mid: avg,
    touches: zone.touches,
    lastTouch: Math.max(...zone.times)
  };
}

export function detectSR(weeklyCandles, dailyCandles) {
  const weeklySwings = findSwings(weeklyCandles, 2);
  const dailySwings = findSwings(dailyCandles, 3);

  const allHighs = [...weeklySwings.highs, ...dailySwings.highs];
  const allLows = [...weeklySwings.lows, ...dailySwings.lows];

  const resistance = clusterLevels(allHighs)
    .sort((a, b) => b.touches - a.touches)
    .slice(0, 3);
  const support = clusterLevels(allLows)
    .sort((a, b) => b.touches - a.touches)
    .slice(0, 3);

  return { support, resistance };
}
