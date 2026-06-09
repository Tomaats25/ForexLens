import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB } from './db.js';
import { getOHLC } from './data.js';
import { detectSR } from './sr.js';
import { computeSignal } from './signals.js';
import { getNews, getCurrencySentiment, summarizeArticles } from './news.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

const PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD'];

app.use(cors());
app.use(express.json());

initDB();

app.get('/api/scan', async (_req, res) => {
  // Server-Sent Events: stream progress while the scan runs.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

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
        label: pair
      });

      try {
        const weekly = await getOHLC(pair, '1week', 52);
        const daily = await getOHLC(pair, '1day', 90);
        let h4 = [];
        try {
          h4 = await getOHLC(pair, '4h', 60);
        } catch (e) {
          console.warn(`4H fetch failed for ${pair}: ${e.message}`);
        }
        if (!weekly.length || !daily.length) continue;

        const sr = detectSR(weekly, daily);
        const base = pair.slice(0, 3);
        const quote = pair.slice(3);
        const signal = computeSignal(pair, weekly, daily, h4, sr);
        if (!signal) continue;

        results.push({
          pair,
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
    send({ type: 'done', scannedAt: new Date().toISOString(), results });
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
    const sr = detectSR(weekly, daily);

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
