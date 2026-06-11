import React, { useState, useRef, useEffect } from 'react';
import SignalCard from './SignalCard.jsx';

const STAGE_WEIGHTS = { news: 0.1, pairs: 0.9 };

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

function progressText(progress) {
  if (!progress) return 'Starting scan…';
  if (progress.stage === 'news') {
    return `Loading news sentiment: ${progress.label} (${progress.current}/${progress.total})${formatEta(progress.etaSeconds)}`;
  }
  return `Scanning ${progress.label}… (${progress.current}/${progress.total})${formatEta(progress.etaSeconds)}`;
}

function progressPct(progress) {
  if (!progress) return 0;
  if (progress.stage === 'news') {
    return (progress.current / progress.total) * STAGE_WEIGHTS.news * 100;
  }
  const newsPart = STAGE_WEIGHTS.news;
  const pairsPart = (progress.current / progress.total) * STAGE_WEIGHTS.pairs;
  return (newsPart + pairsPart) * 100;
}

export default function Scanner({ onOpenChart, onOpenChecklist, savedChecklists = {} }) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [filter, setFilter] = useState('all');
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
          setResults({
            scannedAt: event.scannedAt,
            // Tag each result with the scan date so checklist records can store it
            results: event.results.map((r) => ({ ...r, scannedAt: event.scannedAt }))
          });
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

  // "This Week" summary from saved checklist records
  const checklistRecords = Object.values(savedChecklists || {}).filter(Boolean);
  const tierCounts = checklistRecords.reduce((acc, rec) => {
    if (rec?.tier) acc[rec.tier] = (acc[rec.tier] || 0) + 1;
    return acc;
  }, {});
  const summaryParts = [
    tierCounts.A ? `${tierCounts.A} A tier` : null,
    tierCounts.B ? `${tierCounts.B} B tier` : null,
    tierCounts.C ? `${tierCounts.C} C tier` : null,
    tierCounts['NO TRADE'] ? `${tierCounts['NO TRADE']} No Trade` : null
  ]
    .filter(Boolean)
    .join(', ');

  const groups = results
    ? [
        {
          id: 'major',
          title: 'MAJORS',
          items: results.results.filter((r) => r.category === 'major')
        },
        {
          id: 'cross',
          title: 'CROSSES',
          items: results.results.filter((r) => r.category !== 'major')
        }
      ].filter((g) => g.items.length > 0 && (filter === 'all' || filter === g.id))
    : [];

  return (
    <div className="scanner">
      <div className="scanner-header">
        <button className="scan-btn" onClick={scan} disabled={loading}>
          {loading ? 'Scanning…' : 'Scan This Week'}
        </button>
        {results && (
          <span className="scan-meta">
            Scanned {new Date(results.scannedAt).toLocaleString()} ·{' '}
            {results.results.length} pair{results.results.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {checklistRecords.length > 0 && (
        <div className="week-summary">
          <strong>{checklistRecords.length} reviewed</strong>
          {summaryParts ? ` — ${summaryParts}` : ''}
        </div>
      )}

      {error && <div className="error">⚠ {error}</div>}

      {loading && (
        <div className="scanning">
          <div className="progress-text">{progressText(progress)}</div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progressPct(progress)}%` }} />
          </div>
          <p className="muted">
            Rate-limited to one API call per 8s (Twelve Data free tier). Cold scans take a
            few minutes; cached re-scans finish in seconds.
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
        <>
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
            <div className="empty">
              <p>No pairs to show.</p>
              <p className="muted">
                {results.results.length === 0
                  ? 'The scan returned no data — check the server logs.'
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
                  {g.items.map((r) => (
                    <SignalCard
                      key={r.pair}
                      signal={r}
                      onClick={() => onOpenChart?.(r.pair, r)}
                      onOpenChart={() => onOpenChart?.(r.pair, r)}
                      onOpenChecklist={() => onOpenChecklist?.(r.pair, r)}
                      savedChecklist={savedChecklists[r.pair]}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}

      {!results && !loading && !error && (
        <div className="welcome">
          <p>Click "Scan This Week" to find the best forex opportunities.</p>
          <p className="muted">
            16 pairs (7 majors + 9 crosses) · S/R detection · MTF trend · Checklist scoring
          </p>
        </div>
      )}
    </div>
  );
}
