import { getCachedOHLC, setCachedOHLC, getOHLCFetchedAt } from './db.js';

const API_BASE = 'https://api.twelvedata.com';
const RATE_LIMIT_MS = 8000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Per-interval cache TTLs — weekly barely moves, 4H moves fastest. Long TTLs
// matter here because Twelve Data's free tier bills credits per symbol.
const TTL = {
  '1week': 24 * 60 * 60 * 1000, // 24h
  '1day': 6 * 60 * 60 * 1000, //  6h
  '4h': 2 * 60 * 60 * 1000 //  2h
};
export function ttlFor(interval) {
  return TTL[interval] ?? 6 * 60 * 60 * 1000;
}

// Twelve Data free tier: 8 credits/min. Sleep 8s between any outbound call.
let lastFetchAt = 0;
async function throttle() {
  const elapsed = Date.now() - lastFetchAt;
  if (elapsed < RATE_LIMIT_MS) await sleep(RATE_LIMIT_MS - elapsed);
  lastFetchAt = Date.now();
}

function tdSymbol(pair) {
  return `${pair.slice(0, 3)}/${pair.slice(3)}`;
}

function parseValues(values) {
  if (!Array.isArray(values)) return [];
  return values
    .slice()
    .reverse() // Twelve Data returns newest-first
    .map((v) => ({
      time: Math.floor(new Date(v.datetime).getTime() / 1000),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close)
    }))
    .filter((c) => Number.isFinite(c.open) && Number.isFinite(c.close));
}

export function isCached(pair, interval) {
  return getCachedOHLC(pair, interval, ttlFor(interval)) !== null;
}

// Single-symbol fetch — used by /api/pair, /api/chart, and as the per-pair
// fallback when a batch couldn't fill a symbol.
export async function getOHLC(pair, interval, count) {
  const cached = getCachedOHLC(pair, interval, ttlFor(interval));
  if (cached) return cached;

  const apiKey = process.env.TWELVE_DATA_KEY;
  if (!apiKey) throw new Error('TWELVE_DATA_KEY not set in .env');

  const url = `${API_BASE}/time_series?symbol=${encodeURIComponent(
    tdSymbol(pair)
  )}&interval=${interval}&outputsize=${count}&apikey=${apiKey}`;

  await throttle();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  const json = await res.json();
  if (json.status === 'error' || json.code) {
    throw new Error(json.message || `Twelve Data error: ${json.code}`);
  }
  const ohlc = parseValues(json.values);
  setCachedOHLC(pair, interval, ohlc);
  return ohlc;
}

function hasSymbolKeys(json, symbols) {
  return symbols.some((s) => json[tdSymbol(s)]);
}

// Batch fetch: ONE call for every stale symbol at a given interval.
// Returns { ok, fetched, cachedAlready, error }.
export async function prefetchBatch(symbols, interval, count, { force = false } = {}) {
  const stale = force ? symbols.slice() : symbols.filter((s) => !isCached(s, interval));
  const cachedAlready = symbols.length - stale.length;
  if (!stale.length) return { ok: true, fetched: 0, cachedAlready };

  const apiKey = process.env.TWELVE_DATA_KEY;
  if (!apiKey) throw new Error('TWELVE_DATA_KEY not set in .env');

  const symbolParam = stale.map(tdSymbol).join(',');
  const url = `${API_BASE}/time_series?symbol=${encodeURIComponent(
    symbolParam
  )}&interval=${interval}&outputsize=${count}&apikey=${apiKey}`;

  await throttle();
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    return { ok: false, fetched: 0, cachedAlready, error: e.message };
  }
  if (!res.ok) {
    return { ok: false, fetched: 0, cachedAlready, error: `HTTP ${res.status}` };
  }

  const json = await res.json();

  // Top-level error (e.g. out of credits for this minute).
  if (json.status === 'error' || (json.code && !json.values && !hasSymbolKeys(json, stale))) {
    return { ok: false, fetched: 0, cachedAlready, error: json.message || 'batch error' };
  }

  // A single-symbol request returns { values: [...] } with no symbol key;
  // a multi-symbol request returns { "EUR/USD": { values, status }, ... }.
  const map = json.values ? { [tdSymbol(stale[0])]: json } : json;

  let fetched = 0;
  for (const pair of stale) {
    const entry = map[tdSymbol(pair)];
    if (entry && entry.status !== 'error' && Array.isArray(entry.values)) {
      const ohlc = parseValues(entry.values);
      if (ohlc.length) {
        setCachedOHLC(pair, interval, ohlc);
        fetched += 1;
      }
    }
  }
  return { ok: true, fetched, cachedAlready };
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
