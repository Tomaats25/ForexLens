// In-memory cache. Resets on every server restart.
// For persistence across restarts, swap for a file-backed or Redis cache.

const ohlcCache = new Map();
const newsCache = new Map();

export function initDB() {
  // No-op for in-memory cache; kept so index.js can keep calling it.
}

export function getCachedOHLC(pair, interval, maxAgeMs) {
  const key = `${pair}:${interval}`;
  const entry = ohlcCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > maxAgeMs) {
    ohlcCache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCachedOHLC(pair, interval, data) {
  const key = `${pair}:${interval}`;
  ohlcCache.set(key, { data, fetchedAt: Date.now() });
}

// When a (pair, interval) was last fetched, or null if never. Used for cache status.
export function getOHLCFetchedAt(pair, interval) {
  const entry = ohlcCache.get(`${pair}:${interval}`);
  return entry ? entry.fetchedAt : null;
}

export function getCachedNews(currency, maxAgeMs) {
  const entry = newsCache.get(currency);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > maxAgeMs) {
    newsCache.delete(currency);
    return null;
  }
  return entry.data;
}

export function setCachedNews(currency, data) {
  newsCache.set(currency, { data, fetchedAt: Date.now() });
}
