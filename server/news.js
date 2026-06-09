import { getCachedNews, setCachedNews } from './db.js';

const CACHE_TTL = 60 * 60 * 1000;

const CURRENCY_KEYWORDS = {
  USD: ['US dollar', 'Federal Reserve', 'Fed'],
  EUR: ['euro', 'ECB', 'European Central Bank'],
  GBP: ['British pound', 'Bank of England', 'BoE'],
  JPY: ['Japanese yen', 'Bank of Japan', 'BoJ'],
  CHF: ['Swiss franc', 'SNB', 'Swiss National Bank'],
  AUD: ['Australian dollar', 'RBA', 'Reserve Bank of Australia'],
  CAD: ['Canadian dollar', 'Bank of Canada', 'BoC'],
  NZD: ['New Zealand dollar', 'RBNZ']
};

const BULLISH = [
  'rise', 'rises', 'rising', 'surge', 'surged', 'rally', 'rallied', 'rallies',
  'gain', 'gains', 'gained', 'strengthen', 'strengthened', 'climb', 'climbed',
  'soar', 'soared', 'jump', 'jumped', 'boost', 'boosted', 'strong', 'strongest',
  'bullish', 'optimistic', 'hawkish', 'growth', 'recovery', 'rebound', 'beat'
];

const BEARISH = [
  'fall', 'falls', 'fell', 'falling', 'drop', 'dropped', 'plunge', 'plunged',
  'tumble', 'tumbled', 'decline', 'declined', 'declining', 'weak', 'weakest',
  'weaken', 'weakened', 'slump', 'slumped', 'crash', 'crashed', 'sink', 'sank',
  'bearish', 'pessimistic', 'dovish', 'recession', 'concern', 'worry', 'fears',
  'miss', 'missed', 'cut', 'cuts', 'cutting'
];

export async function getNews(currency) {
  const cached = getCachedNews(currency, CACHE_TTL);
  if (cached) return cached;

  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    throw new Error('NEWS_API_KEY not set in .env');
  }

  const keywords = CURRENCY_KEYWORDS[currency] || [currency];
  const query = keywords.map((k) => `"${k}"`).join(' OR ');
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=5&apiKey=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 429) return [];
    throw new Error(`NewsAPI HTTP ${res.status}`);
  }

  const json = await res.json();
  if (json.status === 'error') {
    return [];
  }

  const articles = (json.articles || []).slice(0, 5).map((a) => ({
    title: a.title,
    description: a.description,
    url: a.url,
    source: a.source?.name,
    publishedAt: a.publishedAt
  }));

  setCachedNews(currency, articles);
  return articles;
}

function scoreText(text) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let bull = 0;
  let bear = 0;
  for (const w of BULLISH) if (lower.includes(w)) bull++;
  for (const w of BEARISH) if (lower.includes(w)) bear++;
  const total = bull + bear;
  if (total === 0) return 0;
  return (bull - bear) / total;
}

export async function getCurrencySentiment(currency) {
  try {
    const articles = await getNews(currency);
    if (!articles.length) return 0;
    let total = 0;
    for (const a of articles) {
      total += scoreText(`${a.title || ''} ${a.description || ''}`);
    }
    return total / articles.length;
  } catch (err) {
    console.error(`Sentiment error for ${currency}:`, err.message);
    return 0;
  }
}

export function summarizeArticles(articles) {
  if (!articles?.length) return 'No recent news.';
  return articles[0].title || 'No headline.';
}
