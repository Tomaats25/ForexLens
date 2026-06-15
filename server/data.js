import { getCachedOHLC, setCachedOHLC, getOHLCFetchedAt } from './db.js';

// Yahoo Finance chart API — free, no key, no rate limit.
const YF_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Accept: 'application/json'
};

// Per-interval cache TTLs.
const TTL = {
  '1week': 12 * 60 * 60 * 1000, // 12h
  '1day': 4 * 60 * 60 * 1000, //  4h
  '4h': 1 * 60 * 60 * 1000 //  1h
};
export function ttlFor(interval) {
  return TTL[interval] ?? 4 * 60 * 60 * 1000;
}

// Internal interval → Yahoo request params. Yahoo has no native 4h, so we pull
// 1h candles and aggregate them into 4h buckets.
const YF_PARAMS = {
  '1week': { interval: '1wk', range: '1y' },
  '1day': { interval: '1d', range: '6mo' },
  '4h': { interval: '1h', range: '60d', aggregateHours: 4 }
};

function yahooSymbol(pair) {
  return `${pair}=X`;
}

function parseChart(json) {
  const chart = json && json.chart;
  if (!chart || chart.error || !Array.isArray(chart.result) || !chart.result[0]) {
    throw new Error(chart?.error?.description || 'Yahoo Finance: no data');
  }
  const result = chart.result[0];
  const timestamps = result.timestamp || [];
  const q = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  return timestamps
    .map((t, i) => ({
      time: t,
      open: q.open ? q.open[i] : null,
      high: q.high ? q.high[i] : null,
      low: q.low ? q.low[i] : null,
      close: q.close ? q.close[i] : null,
      volume: q.volume ? q.volume[i] || 0 : 0
    }))
    .filter(
      (c) =>
        c.open !== null &&
        c.high !== null &&
        c.low !== null &&
        c.close !== null &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.close)
    );
}

// Aggregate ascending candles into fixed-hour buckets (aligned to UTC boundaries).
function aggregate(candles, hours) {
  const size = hours * 3600;
  const buckets = new Map();
  for (const c of candles) {
    const key = Math.floor(c.time / size) * size;
    const b = buckets.get(key);
    if (!b) {
      buckets.set(key, {
        time: key,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0
      });
    } else {
      b.high = Math.max(b.high, c.high);
      b.low = Math.min(b.low, c.low);
      b.close = c.close; // candles are ascending, so last in bucket = close
      b.volume += c.volume || 0;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

async function fetchYahoo(pair, interval) {
  const params = YF_PARAMS[interval];
  if (!params) throw new Error(`Unsupported interval: ${interval}`);
  const url = `${YF_BASE}/${encodeURIComponent(
    yahooSymbol(pair)
  )}?interval=${params.interval}&range=${params.range}`;

  const res = await fetch(url, { headers: YF_HEADERS });
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
  const json = await res.json();
  let candles = parseChart(json);
  if (params.aggregateHours) candles = aggregate(candles, params.aggregateHours);
  return candles;
}

export function isCached(pair, interval) {
  return getCachedOHLC(pair, interval, ttlFor(interval)) !== null;
}

// Cache-aware single fetch — used by /api/pair, /api/chart, and the scan prefetch.
export async function getOHLC(pair, interval, count, { force = false } = {}) {
  if (!force) {
    const cached = getCachedOHLC(pair, interval, ttlFor(interval));
    if (cached) return count ? cached.slice(-count) : cached;
  }
  const candles = await fetchYahoo(pair, interval);
  setCachedOHLC(pair, interval, candles); // cache the full series
  return count ? candles.slice(-count) : candles;
}

// Fetch every stale symbol at one interval in parallel (no rate limit on Yahoo).
export async function prefetchInterval(pairs, interval, count, { force = false } = {}) {
  const stale = force ? pairs.slice() : pairs.filter((p) => !isCached(p, interval));
  if (!stale.length) return { ok: true, fetched: 0, failed: [] };

  const settled = await Promise.allSettled(
    stale.map((p) => getOHLC(p, interval, count, { force }))
  );
  const failed = [];
  let fetched = 0;
  settled.forEach((r, idx) => {
    if (r.status === 'fulfilled' && r.value && r.value.length) fetched += 1;
    else failed.push(stale[idx]);
  });
  return { ok: failed.length < stale.length, fetched, failed };
}

export const BATCH_PLAN = [
  { interval: '1week', count: 60 },
  { interval: '1day', count: 90 },
  { interval: '4h', count: 60 }
];

export function intervalNeedsFetch(symbols, interval, force = false) {
  return force || symbols.some((s) => !isCached(s, interval));
}

// Cache freshness across all scan intervals. fresh = a scan would be instant.
export function getCacheStatus(symbols) {
  const intervals = BATCH_PLAN.map((p) => p.interval);
  let fresh = true;
  let hasData = false;
  let oldest = null;
  for (const s of symbols) {
    for (const interval of intervals) {
      const ts = getOHLCFetchedAt(s, interval);
      const isFresh = ts !== null && Date.now() - ts <= ttlFor(interval);
      if (!isFresh) fresh = false;
      if (ts !== null) {
        hasData = true;
        if (oldest === null || ts < oldest) oldest = ts;
      }
    }
  }
  return { fresh, hasData, oldestFetchedAt: oldest };
}
