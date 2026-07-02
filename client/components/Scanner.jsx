import React, { useState, useRef, useEffect } from 'react';
import SignalCard from './SignalCard.jsx';

const STAGE_WEIGHTS = { news: 0.12, pairs: 0.88 };

const FILTERS = [
  { id: 'all', label: 'All Pairs' },
  { id: 'major', label: 'Majors Only' },
  { id: 'cross', label: 'Crosses Only' }
];

const STATUS_LABEL = {
  pending: 'Pending',
  touched: 'Touched',
  triggered: 'Triggered',
  invalidated: 'Invalidated'
};

function formatEta(seconds) {
  if (seconds === null || seconds === undefined || seconds < 5) return '';
  if (seconds >= 120) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return ` ~${m}m ${s}s remaining`;
  }
  return ` ~${Math.round(seconds)}s remaining`;
}

function formatAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function progressText(progress) {
  if (!progress) return 'Starting scan…';
  if (progress.stage === 'news') {
    return `Loading news sentiment: ${progress.label} (${progress.current}/${progress.total})`;
  }
  return `Analyzing ${progress.label}… (${progress.current}/${progress.total})${formatEta(progress.etaSeconds)}`;
}

function progressPct(progress) {
  if (!progress) return 0;
  if (progress.stage === 'news') {
    return (progress.current / progress.total) * STAGE_WEIGHTS.news * 100;
  }
  return (STAGE_WEIGHTS.news + (progress.current / progress.total) * STAGE_WEIGHTS.pairs) * 100;
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

// Animated chart line for empty states — draws itself, then the tip pulses.
function ChartMotif() {
  return (
    <svg
      className="welcome-chart"
      width="220"
      height="84"
      viewBox="0 0 220 84"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="fx-chart-grad"
          x1="0"
          y1="0"
          x2="220"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4F8EF7" />
          <stop offset="1" stopColor="#22C55E" />
        </linearGradient>
      </defs>
      <path
        className="chart-line"
        d="M2 68 L32 56 L56 63 L86 38 L112 47 L142 22 L166 33 L196 12 L216 18"
        stroke="url(#fx-chart-grad)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle className="chart-dot" cx="216" cy="18" r="4" fill="#22C55E" />
    </svg>
  );
}

export default function Scanner({ onOpenChart, onOpenChecklist, savedChecklists = {}, onScanMeta }) {
  const [loading, setLoading] = useState(false); // heavy scan running
  const [progress, setProgress] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState(null);
  const [weekData, setWeekData] = useState(null); // { exists, week, scannedAt, results }
  const [statusLoading, setStatusLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const esRef = useRef(null);

  // Tier 2 — load the persisted week scan + live status (any device, no re-scan).
  async function loadStatus(refresh = false) {
    setStatusLoading(true);
    try {
      const r = await fetch(`/api/status${refresh ? '?refresh=1' : ''}`);
      const data = await r.json();
      setWeekData(data);
      if (data.exists) {
        onScanMeta?.({
          scannedAt: data.scannedAt,
          count: data.results.length,
          // Feed the header ticker tape: pair, last price, trend direction
          ticker: data.results.map((r) => ({
            pair: r.pair,
            price: r.currentPrice,
            trend: r.trend
          }))
        });
      }
    } catch {
      setError('Could not load this week’s scan.');
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
    return () => {
      if (esRef.current) esRef.current.close();
    };
  }, []);

  // Tier 1 — heavy scan (PC). Persists server-side; we then reload the status view.
  function runFullScan(force = false) {
    setLoading(true);
    setError(null);
    setProgress(null);
    setWarnings([]);

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
          setLoading(false);
          setProgress(null);
          es.close();
          loadStatus(); // pull the persisted scan back with fresh statuses
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

  const results = weekData?.exists ? weekData.results : [];

  // Status breakdown for the summary bar.
  const statusCounts = results.reduce((acc, r) => {
    if (r.status) acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const groups = [
    { id: 'major', title: 'MAJORS', items: results.filter((r) => r.category === 'major') },
    { id: 'cross', title: 'CROSSES', items: results.filter((r) => r.category !== 'major') }
  ].filter((g) => g.items.length > 0 && (filter === 'all' || filter === g.id));

  let cardIndex = 0;

  return (
    <div className="scanner">
      <button
        className={`scan-btn ${loading ? 'scanning' : ''}`}
        onClick={() => runFullScan(false)}
        disabled={loading}
      >
        <RefreshIcon spinning={loading} />
        {loading ? 'Scanning…' : 'Run Full Scan'}
      </button>

      <div className="scan-status-row">
        {loading ? (
          <span className="cache-status refreshing">Running full scan…</span>
        ) : weekData?.exists ? (
          <span className="cache-status fresh">
            {weekData.week} · scanned {formatAgo(weekData.scannedAt)}
          </span>
        ) : (
          <span className="cache-status stale">No scan yet this week</span>
        )}
        <div className="scan-actions">
          {weekData?.exists && !loading && (
            <button
              type="button"
              className="force-refresh"
              onClick={() => loadStatus(true)}
              disabled={statusLoading}
            >
              {statusLoading ? 'Refreshing…' : 'Refresh Status'}
            </button>
          )}
          <button
            type="button"
            className="force-refresh"
            onClick={() => runFullScan(true)}
            disabled={loading}
          >
            Force Rescan
          </button>
        </div>
      </div>

      {loading && (
        <div className="scan-progress">
          <div className="progress-text">{progressText(progress)}</div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progressPct(progress)}%` }} />
          </div>
          <p className="muted">
            Heavy scan — run this from your PC at the end of the week. It fetches one pair at
            a time (free tier = 8 calls/min) and saves the result server-side for every device.
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

      {!loading && weekData?.exists && (
        <>
          <div className="one-trade-banner">One trade at a time — wait for your open trade to close before taking a new setup.</div>

          {Object.keys(statusCounts).length > 0 && (
            <div className="summary-bar">
              <span className="summary-count">Scanned {results.length} pairs</span>
              <span className="summary-sep">—</span>
              <span className="summary-tiers">
                {statusCounts.triggered > 0 && (
                  <span className="st-triggered">{statusCounts.triggered} triggered</span>
                )}
                {statusCounts.touched > 0 && (
                  <span className="st-touched">{statusCounts.touched} touched</span>
                )}
                {statusCounts.pending > 0 && (
                  <span className="st-pending">{statusCounts.pending} pending</span>
                )}
                {statusCounts.invalidated > 0 && (
                  <span className="st-invalidated">{statusCounts.invalidated} invalidated</span>
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
              <p className="empty-title">No pairs match this filter</p>
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
                    const delay = cardIndex++ * 60;
                    return (
                      <div key={r.pair} className="card-fade-in" style={{ animationDelay: `${delay}ms` }}>
                        <SignalCard
                          signal={r}
                          weekMode
                          status={r.status}
                          statusLabel={STATUS_LABEL[r.status]}
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

      {!loading && weekData && !weekData.exists && (
        <div className="empty-state">
          <ChartMotif />
          <p className="empty-title">No scan yet for {weekData.week}</p>
          <p className="empty-sub">
            Run the full scan from your PC at the end of the week. Once it's saved, this page
            loads instantly on any device and tracks each setup's live status.
          </p>
        </div>
      )}

      {!loading && !weekData && statusLoading && (
        <div className="welcome">
          <p className="welcome-title">Loading this week’s scan…</p>
        </div>
      )}
    </div>
  );
}
