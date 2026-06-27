import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB } from './db.js';
import { getOHLC, isCached, getCacheStatus } from './data.js';
import { detectSR } from './sr.js';
import { computeSignal, computeEMASeries } from './signals.js';
import { getNews, getCurrencySentiment, summarizeArticles } from './news.js';
import { saveScan, loadScan } from './store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

const MAJORS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD'];
const CROSSES = [
  'GBPJPY', 'EURJPY', 'GBPCHF', 'EURGBP', 'EURCAD',
  'AUDJPY', 'EURAUD', 'GBPAUD', 'CADJPY'
];
const PAIRS = [...MAJORS, ...CROSSES];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD'];

app.use(cors());
app.use(express.json());

initDB();

// ISO-8601 week key (weeks start Monday) — matches the client's getWeekKey.
function getWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function pipSize(pair) {
  return pair.includes('JPY') ? 0.01 : 0.0001;
}

// Tier-2 status of a frozen zone vs the latest candles. Frozen data never changes;
// only this status does. Order: invalidated > triggered > touched > pending.
function computeZoneStatus(result, recent, price) {
  const z = result.zone;
  if (!z) return null;
  const long =
    result.direction === 'BUY' || (result.direction === 'WATCH' && z.type === 'support');
  const short =
    result.direction === 'SELL' || (result.direction === 'WATCH' && z.type === 'resistance');

  if (long) {
    if (price < z.bottom) return 'invalidated'; // support broken — dead for the week
    const entered = recent.some((c) => c.low <= z.top);
    if (!entered && price > z.top) return 'pending';
    if (entered && price > z.top) return 'triggered'; // dipped in and closed back above
    return 'touched';
  }
  if (short) {
    if (price > z.top) return 'invalidated';
    const entered = recent.some((c) => c.high >= z.bottom);
    if (!entered && price < z.bottom) return 'pending';
    if (entered && price < z.bottom) return 'triggered';
    return 'touched';
  }
  return price >= z.bottom && price <= z.top ? 'touched' : 'pending';
}

// Short-lived shared cache for the lightweight status so repeated phone loads
// don't refetch. Derived data — fine to keep in memory.
const STATUS_TTL = 10 * 60 * 1000;
const statusCache = { week: null, computedAt: 0, data: null };

// ETA for the scan: remaining uncached Twelve Data calls × the 8s throttle.
// Self-corrects as the cache fills (cached pairs cost 0s).
function estimateRemainingSeconds(fromIndex, force) {
  let calls = 0;
  for (let j = fromIndex; j < PAIRS.length; j++) {
    const p = PAIRS[j];
    if (force || !isCached(p, '1week')) calls += 1;
    if (force || !isCached(p, '1day')) calls += 1;
    if (force || !isCached(p, '4h')) calls += 1;
  }
  return calls * 8;
}

// Cache freshness for the UI — lets the client auto-load instantly when fresh.
app.get('/api/cache-status', (_req, res) => {
  res.json(getCacheStatus(PAIRS));
});

// Tier 2: load the current week's persisted scan and overlay a lightweight live
// status per zone. Readable from any device; safe to call repeatedly on mobile.
app.get('/api/status', async (req, res) => {
  try {
    const week = getWeekKey();
    const stored = loadScan(week);
    if (!stored) return res.json({ exists: false, week });

    const refresh = req.query.refresh === '1';
    if (
      !refresh &&
      statusCache.week === week &&
      statusCache.data &&
      Date.now() - statusCache.computedAt < STATUS_TTL
    ) {
      return res.json(statusCache.data);
    }

    // Only pairs with a zone need a status; that's a small set, so this stays light.
    const results = [];
    for (const r of stored.results) {
      let status = null;
      if (r.zone) {
        try {
          const recent = await getOHLC(r.pair, '1day', 20);
          const price = recent.length ? recent[recent.length - 1].close : r.currentPrice;
          status = computeZoneStatus(r, recent, price);
        } catch (e) {
          console.warn(`Status fetch failed for ${r.pair}: ${e.message}`);
        }
      }
      results.push({ ...r, status });
    }

    const data = { exists: true, week, scannedAt: stored.scannedAt, results };
    statusCache.week = week;
    statusCache.computedAt = Date.now();
    statusCache.data = data;
    res.json(data);
  } catch (err) {
    console.error('Status error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scan', async (req, res) => {
  // Server-Sent Events: stream progress while the scan runs.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const force = req.query.force === '1' || req.query.force === 'true';

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const sentiments = {};
    const newsSummaries = {};
    for (let i = 0; i < CURRENCIES.length; i++) {
      const cur = CURRENCIES[i];
      send({
        type: 'progress',
        stage: 'news',
        current: i + 1,
        total: CURRENCIES.length,
        label: cur
      });
      sentiments[cur] = await getCurrencySentiment(cur);
      try {
        const articles = await getNews(cur);
        newsSummaries[cur] = summarizeArticles(articles);
      } catch {
        newsSummaries[cur] = 'No recent news.';
      }
    }

    const results = [];
    for (let i = 0; i < PAIRS.length; i++) {
      const pair = PAIRS[i];
      send({
        type: 'progress',
        stage: 'pairs',
        current: i + 1,
        total: PAIRS.length,
        label: pair,
        etaSeconds: estimateRemainingSeconds(i, force)
      });

      try {
        const weekly = await getOHLC(pair, '1week', 52, { force });
        const daily = await getOHLC(pair, '1day', 90, { force });
        let h4 = [];
        try {
          h4 = await getOHLC(pair, '4h', 60, { force });
        } catch (e) {
          console.warn(`4H fetch failed for ${pair}: ${e.message}`);
        }
        if (!weekly.length || !daily.length) continue;

        const sr = detectSR(weekly, daily, pair);
        const base = pair.slice(0, 3);
        const quote = pair.slice(3);
        const signal = computeSignal(pair, weekly, daily, h4, sr);
        if (!signal) continue;

        results.push({
          pair,
          category: MAJORS.includes(pair) ? 'major' : 'cross',
          ...signal,
          sentiment: {
            base: Number((sentiments[base] || 0).toFixed(2)),
            quote: Number((sentiments[quote] || 0).toFixed(2))
          },
          newsSummary: `${base}: ${newsSummaries[base]} | ${quote}: ${newsSummaries[quote]}`
        });
      } catch (err) {
        console.error(`Failed scanning ${pair}:`, err.message);
        send({ type: 'warning', pair, message: err.message });
      }
    }

    // Sort actionable BUY/SELL first, then WATCH, then NO SETUP — by score within each tier.
    const tier = (r) => (r.actionable ? 2 : r.direction === 'WATCH' ? 1 : 0);
    results.sort((a, b) => {
      if (tier(a) !== tier(b)) return tier(b) - tier(a);
      return b.score - a.score;
    });

    // Tier 1: persist the heavy scan server-side, keyed by ISO week, so any device
    // can read it instantly and overlay live status without re-scanning.
    const week = getWeekKey();
    const payload = { week, scannedAt: new Date().toISOString(), results };
    try {
      saveScan(week, payload);
      statusCache.week = null; // invalidate stale status cache
    } catch (e) {
      console.error('Failed to persist scan:', e.message);
    }
    send({ type: 'done', ...payload });
  } catch (err) {
    console.error('Scan error:', err);
    send({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
});

app.get('/api/pair/:sym', async (req, res) => {
  try {
    const sym = req.params.sym.toUpperCase();
    if (!PAIRS.includes(sym)) {
      return res.status(404).json({ error: 'Pair not supported' });
    }

    const weekly = await getOHLC(sym, '1week', 52);
    const daily = await getOHLC(sym, '1day', 90);
    let h4 = [];
    try {
      h4 = await getOHLC(sym, '4h', 60);
    } catch (e) {
      console.warn(`4H fetch failed for ${sym}: ${e.message}`);
    }
    const sr = detectSR(weekly, daily, sym);

    const base = sym.slice(0, 3);
    const quote = sym.slice(3);
    const baseSent = await getCurrencySentiment(base);
    const quoteSent = await getCurrencySentiment(quote);
    const signal = computeSignal(sym, weekly, daily, h4, sr);

    res.json({
      pair: sym,
      ohlc: { weekly, daily },
      sr,
      signal,
      sentiment: {
        base: Number(baseSent.toFixed(2)),
        quote: Number(quoteSent.toFixed(2))
      }
    });
  } catch (err) {
    console.error('Pair error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/news/:cur', async (req, res) => {
  try {
    const cur = req.params.cur.toUpperCase();
    if (!CURRENCIES.includes(cur)) {
      return res.status(404).json({ error: 'Currency not supported' });
    }
    const articles = await getNews(cur);
    const sentiment = await getCurrencySentiment(cur);
    res.json({ currency: cur, articles, sentiment: Number(sentiment.toFixed(2)) });
  } catch (err) {
    console.error('News error:', err);
    res.status(500).json({ error: err.message });
  }
});

const CHART_TIMEFRAMES = {
  w: { interval: '1week', count: 52 },
  weekly: { interval: '1week', count: 52 },
  d: { interval: '1day', count: 90 },
  daily: { interval: '1day', count: 90 },
  '4h': { interval: '4h', count: 90 }
};

function stepLevels(min, max, step) {
  const out = [];
  for (let n = Math.ceil(min / step); n * step <= max + 1e-9; n++) {
    out.push(Number((n * step).toFixed(5)));
  }
  return out;
}

// Round-number levels inside the candle range, doubling the step until <= 10 lines.
function psychLevelsInRange(min, max, pair) {
  let step = pair.includes('JPY') ? 0.5 : 0.05;
  let levels = stepLevels(min, max, step);
  while (levels.length > 10) {
    step *= 2;
    levels = stepLevels(min, max, step);
  }
  return levels;
}

app.get('/api/chart/:sym/:tf', async (req, res) => {
  try {
    const sym = req.params.sym.toUpperCase();
    if (!PAIRS.includes(sym)) {
      return res.status(404).json({ error: 'Pair not supported' });
    }
    const tfKey = req.params.tf.toLowerCase();
    const tf = CHART_TIMEFRAMES[tfKey];
    if (!tf) {
      return res.status(400).json({ error: 'Timeframe must be weekly, daily, or 4h' });
    }

    const candlesFull = await getOHLC(sym, tf.interval, tf.count);
    const candles = candlesFull.slice(-90);

    // Zones always come from weekly+daily (cache hits after any scan)
    const weekly = tf.interval === '1week' ? candlesFull : await getOHLC(sym, '1week', 52);
    const daily = tf.interval === '1day' ? candlesFull : await getOHLC(sym, '1day', 90);
    const srAll = detectSR(weekly, daily, sym);
    const sr = {
      support: srAll.support.filter((z) => z.touches >= 3),
      resistance: srAll.resistance.filter((z) => z.touches >= 3)
    };

    const ema = computeEMASeries(candles, 50);
    const currentPrice = candles.length ? candles[candles.length - 1].close : null;
    let psychLevels = [];
    if (candles.length) {
      const min = Math.min(...candles.map((c) => c.low));
      const max = Math.max(...candles.map((c) => c.high));
      psychLevels = psychLevelsInRange(min, max, sym);
    }

    res.json({ pair: sym, timeframe: tfKey, candles, sr, ema, psychLevels, currentPrice });
  } catch (err) {
    console.error('Chart error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve built client in production
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) next();
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ForexLens API running on port ${PORT}`);
});
