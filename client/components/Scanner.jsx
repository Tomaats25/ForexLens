import React, { useState, useRef, useEffect } from 'react';
import SignalCard from './SignalCard.jsx';

const STAGE_WEIGHTS = { news: 0.3, pairs: 0.7 };

function progressText(progress) {
  if (!progress) return 'Starting scan…';
  if (progress.stage === 'news') {
    return `Loading news sentiment: ${progress.label} (${progress.current}/${progress.total})`;
  }
  return `Scanning ${progress.label}… (${progress.current}/${progress.total})`;
}

function progressPct(progress) {
  if (!progress) return 0;
  if (progress.stage === 'news') {
    return (progress.current / progress.total) * STAGE_WEIGHTS.news * 100;
  }
  // After news stage completes, pairs stage starts at 30%
  const newsPart = STAGE_WEIGHTS.news;
  const pairsPart = (progress.current / progress.total) * STAGE_WEIGHTS.pairs;
  return (newsPart + pairsPart) * 100;
}

export default function Scanner({ onSelectPair }) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const esRef = useRef(null);

  useEffect(() => {
    return () => {
      if (esRef.current) esRef.current.close();
    };
  }, []);

  function scan() {
    setLoading(true);
    setError(null);
    setProgress(null);
    setResults(null);
    setWarnings([]);

    if (esRef.current) esRef.current.close();

    const es = new EventSource('/api/scan');
    esRef.current = es;
    let finished = false;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'progress') {
          setProgress(event);
        } else if (event.type === 'warning') {
          setWarnings((w) => [...w, `${event.pair}: ${event.message}`]);
        } else if (event.type === 'done') {
          finished = true;
          setResults({ scannedAt: event.scannedAt, results: event.results });
          setLoading(false);
          setProgress(null);
          es.close();
        } else if (event.type === 'error') {
          finished = true;
          setError(event.message);
          setLoading(false);
          setProgress(null);
          es.close();
        }
      } catch (err) {
        console.error('Failed to parse progress event:', err);
      }
    };

    es.onerror = () => {
      if (!finished) {
        setError('Connection to scanner lost.');
        setLoading(false);
        setProgress(null);
      }
      es.close();
    };
  }

  return (
    <div className="scanner">
      <div className="scanner-header">
        <button className="scan-btn" onClick={scan} disabled={loading}>
          {loading ? 'Scanning…' : 'Scan This Week'}
        </button>
        {results && (
          <span className="scan-meta">
            Scanned {new Date(results.scannedAt).toLocaleString()} ·{' '}
            {results.results.length} signal{results.results.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {error && <div className="error">⚠ {error}</div>}

      {loading && (
        <div className="scanning">
          <div className="progress-text">{progressText(progress)}</div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${progressPct(progress)}%` }}
            />
          </div>
          <p className="muted">
            Sequential fetch with 500ms throttle to respect free-tier limits.
          </p>
          {warnings.length > 0 && (
            <div className="progress-warnings">
              {warnings.map((w, i) => (
                <div key={i} className="warning-line">⚠ {w}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {results && !loading && (
        <div className="results">
          {results.results.length === 0 ? (
            <div className="empty">
              <p>No high-confidence signals this week.</p>
              <p className="muted">All pairs scored below 40 — wait for cleaner setups.</p>
            </div>
          ) : (
            results.results.map((r) => (
              <SignalCard key={r.pair} signal={r} onClick={() => onSelectPair(r.pair)} />
            ))
          )}
        </div>
      )}

      {!results && !loading && !error && (
        <div className="welcome">
          <p>Click "Scan This Week" to find the best forex opportunities.</p>
          <p className="muted">
            7 major pairs · S/R detection · 20-week EMA trend · News sentiment
          </p>
        </div>
      )}
    </div>
  );
}
