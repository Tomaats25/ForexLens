import { getCachedOHLC, setCachedOHLC } from './db.js';

const CACHE_TTL = 6 * 60 * 60 * 1000;
const API_BASE = 'https://api.twelvedata.com';
const RATE_LIMIT_MS = 8000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Twelve Data free tier: 8 calls/min. 8s between calls = max 7.5/min,
// safely under the limit even on long scans. Cache hits skip the throttle.
let lastFetchAt = 0;
async function throttle() {
  const elapsed = Date.now() - lastFetchAt;
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }
  lastFetchAt = Date.now();
}

export async function getOHLC(pair, interval, count) {
  const cached = getCachedOHLC(pair, interval, CACHE_TTL);
  if (cached) return cached;

  const apiKey = process.env.TWELVE_DATA_KEY;
  if (!apiKey) {
    throw new Error('TWELVE_DATA_KEY not set in .env');
  }

  const symbol = `${pair.slice(0, 3)}/${pair.slice(3)}`;
  const url = `${API_BASE}/time_series?symbol=${symbol}&interval=${interval}&outputsize=${count}&apikey=${apiKey}`;

  await throttle();
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Twelve Data HTTP ${res.status}`);
  }

  const json = await res.json();
  if (json.status === 'error' || json.code) {
    throw new Error(json.message || `Twelve Data error: ${json.code}`);
  }
  if (!json.values || !Array.isArray(json.values)) return [];

  const ohlc = json.values
    .slice()
    .reverse()
    .map((v) => ({
      time: Math.floor(new Date(v.datetime).getTime() / 1000),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close)
    }))
    .filter((c) => Number.isFinite(c.open) && Number.isFinite(c.close));

  setCachedOHLC(pair, interval, ohlc);
  return ohlc;
}

// True when a fresh cached copy exists — used for scan ETA estimates.
export function isCached(pair, interval) {
  return getCachedOHLC(pair, interval, CACHE_TTL) !== null;
}
