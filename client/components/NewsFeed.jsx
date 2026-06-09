import React, { useEffect, useState } from 'react';

export default function NewsFeed({ currency }) {
  const [articles, setArticles] = useState(null);
  const [sentiment, setSentiment] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/news/${currency}`)
      .then((r) => r.json())
      .then((d) => {
        setArticles(d.articles || []);
        setSentiment(d.sentiment || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [currency]);

  if (loading) return <div className="news-loading">Loading…</div>;
  if (!articles || !articles.length) return <div className="news-empty">No recent news.</div>;

  const tone = sentiment > 0.2 ? 'bullish' : sentiment < -0.2 ? 'bearish' : 'neutral';

  return (
    <div className="news-feed">
      <div className={`news-sentiment ${tone}`}>
        Sentiment: <strong>{tone}</strong> ({sentiment.toFixed(2)})
      </div>
      {articles.map((a, i) => (
        <a
          key={i}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="news-item"
        >
          <div className="news-title">{a.title}</div>
          <div className="news-meta">
            {a.source} · {new Date(a.publishedAt).toLocaleDateString()}
          </div>
        </a>
      ))}
    </div>
  );
}
