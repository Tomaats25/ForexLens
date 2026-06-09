# ForexLens

A weekly forex market scanner that detects the best trading opportunities based on support/resistance levels, trend, and news sentiment.

## Features

- Scans 7 major forex pairs: EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD, NZDUSD
- Detects support/resistance zones from weekly (52w) and daily (90d) swing points
- Computes trend via 20-week EMA
- Generates BUY/SELL signals with entry, TP, SL, and risk/reward ratio
- Scores signals 0-100 (zone strength + trend alignment + proximity + news sentiment)
- Dynamic RR: 1:4 (80+), 1:3 (60-79), 1:2 (40-59), skipped below 40
- Pulls news headlines per currency, computes keyword sentiment, adjusts signal score ±10
- Interactive candlestick charts with S/R zones, entry/TP/SL drawn

## Setup

### 1. Install dependencies

```bash
cd forexlens
npm install
```

### 2. Get free API keys

- **Twelve Data** — https://twelvedata.com/ (free tier: 800 calls/day, 8/min)
- **NewsAPI** — https://newsapi.org/ (free tier: 100 requests/day)

### 3. Create `.env`

Copy `.env.example` to `.env` and fill in your keys:

```env
TWELVE_DATA_KEY=your_twelve_data_key
NEWS_API_KEY=your_news_api_key
PORT=3000
```

### 4. Run in development

Open **two** PowerShell windows in the `forexlens` folder.

Window 1 — start the API:

```powershell
npm run dev:server
```

Window 2 — start the Vite dev server:

```powershell
npm run dev:client
```

Then open http://localhost:5173 — Vite proxies `/api/*` to the Express server on port 3000.

### 5. Build & run in production

```bash
npm run build
npm start
```

Open http://localhost:3000

## API Routes

| Method | Path              | Description                                |
|--------|-------------------|--------------------------------------------|
| GET    | `/api/scan`       | Runs a full scan, returns ranked signals   |
| GET    | `/api/pair/:sym`  | OHLC + S/R + signal for one pair           |
| GET    | `/api/news/:cur`  | Latest news + sentiment for a currency     |

## How it works

1. **Data** — Weekly + daily OHLC pulled from Twelve Data, cached in memory for 6 hours (cache resets on server restart)
2. **S/R** — Swing high/low detection (lookback 2 weekly, 3 daily) + clustering within 0.3%
3. **Trend** — 20-week EMA: price above = bullish, below = bearish
4. **Signal** — BUY when price is within 0.5% of support and trend is bullish; SELL when price is near resistance with bearish trend
5. **Score** — 0-100 derived from zone touch count, trend strength, proximity, and news sentiment
6. **Stops** — SL 1 ATR beyond the zone, TP from `SL distance × RR`

## Project structure

```
forexlens/
  server/         Express API
    index.js      routes + scan orchestration
    data.js       Twelve Data fetch + SQLite cache
    sr.js         support/resistance detection
    signals.js    EMA, ATR, scoring, TP/SL
    news.js       NewsAPI fetch + keyword sentiment
    db.js         in-memory cache helpers
  client/         React SPA (Vite + lightweight-charts CDN)
    index.html
    App.jsx
    components/
      Scanner.jsx
      Chart.jsx
      SignalCard.jsx
      NewsFeed.jsx
    styles.css
```

## Caveats

- This is an analytical tool, **not financial advice**.
- Free API tiers are rate-limited. A full scan needs ~14 Twelve Data calls (2/pair) and up to 8 NewsAPI calls. The 6-hour OHLC cache and 1-hour news cache mean repeat scans are essentially free.
- First-ever scan on a fresh DB may hit Twelve Data's 8/min limit — affected pairs are skipped gracefully; rerun to fill them in.
