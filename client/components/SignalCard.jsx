import React from 'react';
import { computeChecklistPercent, checklistTier } from './Checklist.jsx';

function mtfBadge(state) {
  if (state === 'BULLISH') return '↑';
  if (state === 'BEARISH') return '↓';
  return '–';
}

function mtfClass(state) {
  if (state === 'BULLISH') return 'mtf-bull';
  if (state === 'BEARISH') return 'mtf-bear';
  return 'mtf-unclear';
}

function strengthClass(strength) {
  if (strength === 'STRONG') return 'strength-strong';
  if (strength === 'WEAK') return 'strength-weak';
  if (strength === 'MIXED' || strength === 'CONFLICT') return 'strength-mixed';
  return 'strength-none';
}

function pipSize(pair) {
  return pair.includes('JPY') ? 0.01 : 0.0001;
}

function formatPrice(price, pair) {
  const decimals = pair.includes('JPY') ? 3 : 5;
  return Number(price.toFixed(decimals));
}

export default function SignalCard({ signal, onClick, onOpenChart, onOpenChecklist, savedChecklist }) {
  const isWatch = signal.direction === 'WATCH';
  const mtf = signal.mtfAlignment || {};

  // Checklist drives tier + RR + visibility (savedChecklist is a stored record)
  const checklistPct = computeChecklistPercent(savedChecklist?.state);
  const tier = checklistTier(checklistPct); // null when no checklist
  const hasChecklist = checklistPct !== null;
  const isNoTrade = hasChecklist && checklistPct < 70;
  const isScored = hasChecklist && checklistPct >= 70;

  // Review-status dot: grey = not scored, red = No Trade, amber/blue = C/B, green = A
  let dotClass = 'dot-grey';
  let dotTitle = 'Not scored yet';
  if (hasChecklist) {
    if (checklistPct >= 90) {
      dotClass = 'dot-green';
      dotTitle = `A tier · ${checklistPct}%`;
    } else if (checklistPct >= 80) {
      dotClass = 'dot-blue';
      dotTitle = `B tier · ${checklistPct}%`;
    } else if (checklistPct >= 70) {
      dotClass = 'dot-amber';
      dotTitle = `C tier · ${checklistPct}%`;
    } else {
      dotClass = 'dot-red';
      dotTitle = `No Trade · ${checklistPct}%`;
    }
  }

  // Top-right tier badge
  let badge;
  if (signal.insideAOI) {
    badge = { label: 'Inside AOI', key: 'inside' };
  } else if (!signal.actionable) {
    badge = isWatch
      ? { label: 'Watch', key: 'watch' }
      : { label: 'No Setup', key: 'none' };
  } else if (!hasChecklist) {
    badge = { label: 'Score Setup', key: 'unscored' };
  } else if (isNoTrade) {
    badge = { label: 'No Trade', key: 'no-trade' };
  } else {
    badge = { label: `${tier.letter} Tier`, key: tier.tier };
  }

  // Recalculate TP using checklist tier RR when scored
  let displayTP = signal.tp;
  let displayTpPips = signal.tpPips;
  if (isScored && tier?.rr && signal.entry !== null && signal.sl !== null) {
    const slDist = Math.abs(signal.entry - signal.sl);
    const newTP =
      signal.direction === 'BUY'
        ? signal.entry + slDist * tier.rr
        : signal.entry - slDist * tier.rr;
    displayTP = formatPrice(newTP, signal.pair);
    displayTpPips = Math.round(Math.abs(displayTP - signal.entry) / pipSize(signal.pair));
  }

  let cardClass = 'signal-card';
  if (signal.actionable && tier && !isNoTrade) cardClass += ` tier-${tier.tier}`;
  if (isWatch) cardClass += ' watch-card';
  if (signal.insideAOI) cardClass += ' inside-aoi-card';

  const showTradeGrid = signal.actionable && !isNoTrade;

  const zone = signal.zone;
  const aoiLine = zone ? (
    <div className="card-aoi">
      <span className="aoi-label">AOI</span>
      <span className="aoi-range">
        {zone.bottom} — {zone.top}
      </span>
      <span className="aoi-meta">
        {zone.pips_wide} pips · {zone.weighted_score} touches
        {zone.timeframe === 'both' ? ' · W+D' : zone.timeframe === 'weekly' ? ' · W' : ' · D'}
      </span>
      {zone.is_psychological && <span className="aoi-psych">PSYCH</span>}
    </div>
  ) : null;

  const mtfRow = (
    <div className="card-mtf">
      <span className={mtfClass(mtf.weekly)}>W {mtfBadge(mtf.weekly)}</span>
      <span className={mtfClass(mtf.daily)}>D {mtfBadge(mtf.daily)}</span>
      <span className={mtfClass(mtf.h4)}>4H {mtfBadge(mtf.h4)}</span>
      {mtf.strength && (
        <span className={`strength-tag ${strengthClass(mtf.strength)}`}>{mtf.strength}</span>
      )}
    </div>
  );

  return (
    <div
      className={cardClass}
      onClick={() => onClick?.()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Top row: pair name + tier badge */}
      <div className="card-top">
        <div className="card-pair">
          <span className={`status-dot ${dotClass}`} title={dotTitle} />
          <span className="pair-name">{signal.pair}</span>
        </div>
        <span className={`tier-badge tier-badge-${badge.key}`}>{badge.label}</span>
      </div>

      {aoiLine}

      {showTradeGrid && (
        <>
          {/* Second row: direction pill + trigger */}
          <div className="card-signal-row">
            <span className={`pill-direction ${signal.direction === 'BUY' ? 'buy' : 'sell'}`}>
              {signal.direction}
            </span>
            <span className="trigger-text">{signal.trigger || 'No trigger yet'}</span>
          </div>

          {/* 2x2 data grid */}
          <div className="card-grid">
            <div className="metric">
              <div className="metric-label">Entry</div>
              <div className="metric-value">{signal.entry}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Take Profit</div>
              <div className="metric-value tp">
                {displayTP} <span className="metric-pips">+{displayTpPips}p</span>
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">Stop Loss</div>
              <div className="metric-value sl">
                {signal.sl} <span className="metric-pips">−{signal.slPips}p</span>
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">R : R</div>
              <div className="metric-value">
                {isScored ? `1:${tier.rr}` : <span className="metric-muted">—</span>}
              </div>
            </div>
          </div>

          {mtfRow}

          <div className="card-tags">
            {signal.zone && <span className="tag">{signal.zone.touches}× touches</span>}
            <span className={`tag psych ${signal.psychConfluence ? 'psych-yes' : 'psych-no'}`}>
              Psych {signal.psychConfluence ? 'YES' : 'NO'}
            </span>
          </div>
        </>
      )}

      {signal.actionable && isNoTrade && (
        <div className="card-notrade">
          {mtfRow}
          <p className="notrade-note">
            Scored {checklistPct}% — below the 70% threshold. No trade this week.
          </p>
        </div>
      )}

      {!signal.actionable && isWatch && (
        <>
          <div className="watch-message">Monitor this level — wait for a trigger</div>
          <div className="card-grid">
            <div className="metric">
              <div className="metric-label">Level</div>
              <div className="metric-value">{signal.entry}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Touches</div>
              <div className="metric-value">{signal.zone.touches}×</div>
            </div>
            <div className="metric">
              <div className="metric-label">Distance</div>
              <div className="metric-value">{signal.watchDistance}%</div>
            </div>
            <div className="metric">
              <div className="metric-label">Price</div>
              <div className="metric-value">{signal.currentPrice}</div>
            </div>
          </div>
          {mtfRow}
        </>
      )}

      {!signal.actionable && !isWatch && (
        <div className="card-info">
          <div className="card-info-row">
            <span className="info-label">Price</span>
            <span className="info-value">{signal.currentPrice}</span>
          </div>
          {mtfRow}
          {signal.nearestSupport && (
            <div className="card-info-row">
              <span className="info-label">Support</span>
              <span className="info-value">
                {signal.nearestSupport.mid}
                <span className="info-aux">
                  {' '}· {signal.nearestSupport.distancePct}% · {signal.nearestSupport.touches}×
                </span>
              </span>
            </div>
          )}
          {signal.nearestResistance && (
            <div className="card-info-row">
              <span className="info-label">Resistance</span>
              <span className="info-value">
                {signal.nearestResistance.mid}
                <span className="info-aux">
                  {' '}· {signal.nearestResistance.distancePct}% · {signal.nearestResistance.touches}×
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      {(onOpenChart || onOpenChecklist) && (
        <div className="card-actions">
          {onOpenChart && (
            <button
              type="button"
              className="btn-chart"
              onClick={(e) => {
                e.stopPropagation();
                onOpenChart();
              }}
            >
              View Chart →
            </button>
          )}
          {onOpenChecklist && (
            <button
              type="button"
              className="btn-checklist"
              onClick={(e) => {
                e.stopPropagation();
                onOpenChecklist();
              }}
            >
              Open Checklist →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
