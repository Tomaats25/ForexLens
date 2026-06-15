import React, { useState, useRef, useEffect } from 'react';
import SignalCard from './SignalCard.jsx';

const STAGE_WEIGHTS = { fetch: 0.6, news: 0.1, pairs: 0.3 };

const FILTERS = [
  { id: 'all', label: 'All Pairs' },
  { id: 'major', label: 'Majors Only' },
  { id: 'cross', label: 'Crosses Only' }
];

function formatEta(seconds) {
  if (seconds === null || seconds === undefined || seconds < 5) return '';
  if (seconds >= 120) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return ` ~${m}m ${s}s remaining`;
  }
  return ` ~${Math.round(seconds)}s remaining`;
}

function formatAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function progressText(progress) {
  if (!progress) return 'Starting scan…';
  if (progress.stage === 'fetch') {
    return `Fetching ${progress.label}… (${progress.current}/${progress.total})${formatEta(progress.etaSeconds)}`;
  }
  if (progress.stage === 'news') {
    return `Loading news sentiment: ${progress.label} (${progress.current}/${progress.total})`;
  }
  return `Analyzing ${progress.label}… (${progress.current}/${progress.total})`;
}

function progressPct(progress) {
  if (!progress) return 0;
  if (progress.stage === 'fetch') {
    return (progress.current / progress.total) * STAGE_WEIGHTS.fetch * 100;
  }
  if (progress.stage === 'news') {
    return (STAGE_WEIGHTS.fetch + (progress.current / progress.total) * STAGE_WEIGHTS.news) * 100;
  }
  return (
    (STAGE_WEIGHTS.fetch +
      STAGE_WEIGHTS.news +
      (progress.current / progress.total) * STAGE_WEIGHTS.pairs) *
    100
  );
}

function RefreshIcon({ spinning }) {
  return (
    <svg
      className={`refresh-icon ${spinning ? 'spinning' : ''}`}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-top">
        <div className="skeleton-line skeleton-pair" />
        <div className="skeleton-pill" />
      </div>
      <div className="skeleton-grid">
        <div className="skeleton-cell" />
        <div className="skeleton-cell" />
        <div className="skeleton-cell" />
        <div className="skeleton-cell" />
      </div>
      <div className="skeleton-line skeleton-row" />
      <div className="skeleton-actions">
        <div className="skeleton-btn" />
        <div className="skeleton-btn" />
      </div>
    </div>
  );
}

export default function Scanner({ onOpenChart, onOpenChecklist, savedChecklists = {}, onScanMeta }) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [filter, setFilter] = useState('all');
  const [cacheStatus, setCacheStatus] = useState(null);
  const [justUpdated, setJustUpdated] = useState(false);
  const esRef = useRef(null);
  const autoTriedRef = useRef(false);

  async function refreshCacheStatus() {
    try {
      const r = await fetch('/api/cache-status');
      if (r.ok) {
        const s = await r.json();
        setCacheStatus(s);
        return s;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function scan(force = false) {
    setLoading(true);
    setError(null);
    setProgress(null);
    setResults(null);
    setWarnings([]);
    setJustUpdated(false);

    if (esRef.current) esRef.current.close();

    const es = new EventSource(`/api/scan${force ? '?force=1' : ''}`);
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
          setResults({
            scannedAt: event.scannedAt,
            results: event.results.map((r) => ({ ...r, scannedAt: event.scannedAt }))
          });
          onScanMeta?.({ scannedAt: event.scannedAt, count: event.results.length });
          setLoading(false);
          setProgress(null);
          setJustUpdated(true);
          setTimeout(() => setJustUpdated(false), 4000);
          refreshCacheStatus();
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

  // On first load: check cache. Fresh → auto-scan (instant). Otherwise prompt.
  useEffect(() => {
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;
    refreshCacheStatus().then((s) => {
      if (s && s.fresh) scan(false);
    });
    return () => {
      if (esRef.current) esRef.current.close();
    };
  }, []);

  // Cache status line next to the button.
  let statusNode = null;
  if (loading) {
    statusNode = <span className="cache-status refreshing">Refreshing data…</span>;
  } else if (justUpdated) {
    statusNode = <span className="cache-status fresh">Data updated</span>;
  } else if (cacheStatus?.fresh) {
    statusNode = (
      <span className="cache-status fresh">
        Data fresh — last fetched {formatAgo(cacheStatus.oldestFetchedAt)}
      </span>
    );
  } else if (cacheStatus?.hasData) {
    statusNode = <span className="cache-status stale">Data is stale — scan to refresh</span>;
  }

  // Colored tier breakdown across the scanned pairs.
  let summary = null;
  if (results) {
    const counts = { A: 0, B: 0, C: 0, 'NO TRADE': 0, unscored: 0 };
    for (const r of results.results) {
      const tier = savedChecklists[r.pair]?.tier;
      if (tier && counts[tier] !== undefined) counts[tier] += 1;
      else counts.unscored += 1;
    }
    summary = { total: results.results.length, counts };
  }

  const groups = results
    ? [
        { id: 'major', title: 'MAJORS', items: results.results.filter((r) => r.category === 'major') },
        { id: 'cross', title: 'CROSSES', items: results.results.filter((r) => r.category !== 'major') }
      ].filter((g) => g.items.length > 0 && (filter === 'all' || filter === g.id))
    : [];

  let cardIndex = 0;

  return (
    <div className="scanner">
      <button
        className={`scan-btn ${loading ? 'scanning' : ''}`}
        onClick={() => scan(false)}
        disabled={loading}
      >
        <RefreshIcon spinning={loading} />
        {loading ? 'Scanning…' : 'Scan This Week'}
      </button>

      <div className="scan-status-row">
        {statusNode}
        <button
          type="button"
          className="force-refresh"
          onClick={() => scan(true)}
          disabled={loading}
        >
          Force Refresh
        </button>
      </div>

      {loading && (
        <div className="scan-progress">
          <div className="progress-text">{progressText(progress)}</div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progressPct(progress)}%` }} />
          </div>
          <p className="muted">
            Fetching from Yahoo Finance — all pairs in parallel, no rate limits. Cached
            timeframes are skipped, so fresh scans finish in seconds.
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

      {error && <div className="error">⚠ {error}</div>}

      {loading && (
        <div className="results skeletons">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {results && !loading && (
        <>
          {summary && (
            <div className="summary-bar">
              <span className="summary-count">Scanned {summary.total} pairs</span>
              <span className="summary-sep">—</span>
              <span className="summary-tiers">
                {summary.counts.A > 0 && <span className="sum-a">{summary.counts.A} A tier</span>}
                {summary.counts.B > 0 && <span className="sum-b">{summary.counts.B} B tier</span>}
                {summary.counts.C > 0 && <span className="sum-c">{summary.counts.C} C tier</span>}
                {summary.counts['NO TRADE'] > 0 && (
                  <span className="sum-notrade">{summary.counts['NO TRADE']} no trade</span>
                )}
                {summary.counts.unscored > 0 && (
                  <span className="sum-unscored">{summary.counts.unscored} not scored</span>
                )}
              </span>
            </div>
          )}

          <div className="pair-filter">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                className={filter === f.id ? 'active' : ''}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {groups.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon" aria-hidden="true">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.3-4.3" />
                </svg>
              </div>
              <p className="empty-title">No setups found this week</p>
              <p className="empty-sub">
                {results.results.length === 0
                  ? 'All pairs scored below 70% — check back after the weekly candle closes.'
                  : 'No pairs match this filter.'}
              </p>
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.id} className="results-group">
                <div className="results-group-header">
                  <span>{g.title}</span>
                  <span className="group-count">
                    {g.items.length} pair{g.items.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="results">
                  {g.items.map((r) => {
                    const delay = cardIndex++ * 80;
                    return (
                      <div key={r.pair} className="card-fade-in" style={{ animationDelay: `${delay}ms` }}>
                        <SignalCard
                          signal={r}
                          onClick={() => onOpenChart?.(r.pair, r)}
                          onOpenChart={() => onOpenChart?.(r.pair, r)}
                          onOpenChecklist={() => onOpenChecklist?.(r.pair, r)}
                          savedChecklist={savedChecklists[r.pair]}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </>
      )}

      {!results && !loading && !error && (
        <div className="welcome">
          <p className="welcome-title">
            {cacheStatus?.hasData
              ? 'Click Scan to refresh this week’s data'
              : 'Click Scan to load this week’s data'}
          </p>
          <p className="muted">
            16 pairs (7 majors + 9 crosses) · S/R detection · MTF trend · Checklist scoring
          </p>
        </div>
      )}
    </div>
  );
}
