import React from 'react';
import { computeChecklistPercent, checklistTier } from './Checklist.jsx';

function sentimentArrow(v) {
  if (v > 0.2) return '↑';
  if (v < -0.2) return '↓';
  return '→';
}

function sentimentLabel(v) {
  if (v > 0.2) return 'bullish';
  if (v < -0.2) return 'bearish';
  return 'neutral';
}

function baseDirectionClass(dir) {
  if (dir === 'BUY') return 'buy';
  if (dir === 'SELL') return 'sell';
  if (dir === 'WATCH') return 'watch';
  return 'none';
}

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

function strengthBadgeClass(strength) {
  if (strength === 'STRONG') return 'aligned-badge';
  if (strength === 'WEAK') return 'weak-badge';
  if (strength === 'CONFLICT') return 'conflict-badge';
  return 'none-badge';
}

function pipSize(pair) {
  return pair.includes('JPY') ? 0.01 : 0.0001;
}

function formatPrice(price, pair) {
  const decimals = pair.includes('JPY') ? 3 : 5;
  return Number(price.toFixed(decimals));
}

export default function SignalCard({ signal, onClick, onOpenChecklist, savedChecklist }) {
  const base = signal.pair.slice(0, 3);
  const quote = signal.pair.slice(3);
  const isWatch = signal.direction === 'WATCH';
  const mtf = signal.mtfAlignment || {};

  // Checklist drives tier + RR + visibility
  const checklistPct = computeChecklistPercent(savedChecklist);
  const tier = checklistTier(checklistPct); // null when no checklist
  const hasChecklist = checklistPct !== null;
  const isNoTrade = hasChecklist && checklistPct < 70;
  const isScored = hasChecklist && checklistPct >= 70;

  // Direction text + class
  let directionText;
  let directionClassName;
  if (isNoTrade && signal.actionable) {
    directionText = 'NO TRADE';
    directionClassName = 'no-trade';
  } else if (signal.direction === 'WATCH') {
    directionText = 'WATCH';
    directionClassName = 'watch';
  } else if (signal.direction === 'NONE') {
    directionText = 'NO SETUP';
    directionClassName = 'none';
  } else if (signal.actionable) {
    directionText = signal.direction;
    directionClassName = baseDirectionClass(signal.direction);
  } else {
    directionText = `${signal.direction} · low`;
    directionClassName = baseDirectionClass(signal.direction);
  }

  // Recalculate TP using checklist tier RR when scored
  let displayTP = signal.tp;
  let displayTpPips = signal.tpPips;
  if (isScored && tier && tier.rr && signal.entry !== null && signal.sl !== null) {
    const slDist = Math.abs(signal.entry - signal.sl);
    const newTP =
      signal.direction === 'BUY'
        ? signal.entry + slDist * tier.rr
        : signal.entry - slDist * tier.rr;
    displayTP = formatPrice(newTP, signal.pair);
    displayTpPips = Math.round(Math.abs(displayTP - signal.entry) / pipSize(signal.pair));
  }

  // Card-level class (tier border + glow)
  let cardClass = 'signal-card';
  if (signal.actionable && tier) cardClass += ` tier-${tier.tier}`;
  if (isWatch) cardClass += ' watch-card';
  if (!signal.actionable && !isWatch) cardClass += ' muted-card';

  // Whether to render the entry/TP/SL/tier grid
  const showActionableGrid = signal.actionable && !isNoTrade;
  const showStrategyDetails = signal.actionable; // shown for actionable in any tier
  const showNoTradeContext = signal.actionable && isNoTrade;

  return (
    <div
      className={cardClass}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="card-top">
        <div className="pair-name">{signal.pair}</div>
        <div className={`direction ${directionClassName}`}>{directionText}</div>
      </div>

      {showActionableGrid && (
        <div className="card-grid">
          <div className="metric">
            <div className="metric-label">Entry</div>
            <div className="metric-value">{signal.entry}</div>
          </div>
          <div className="metric">
            <div className="metric-label">TP · {displayTpPips}p</div>
            <div className="metric-value tp">{displayTP}</div>
          </div>
          <div className="metric">
            <div className="metric-label">SL · {signal.slPips}p</div>
            <div className="metric-value sl">{signal.sl}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Tier</div>
            <div className="metric-value">
              {hasChecklist ? (
                <span className={`tier-badge tier-badge-${tier.tier}`}>{tier.letter}</span>
              ) : (
                <span className="rr-placeholder">Open Checklist to score</span>
              )}
            </div>
          </div>
        </div>
      )}

      {showStrategyDetails && (
        <div className="strategy-details">
          <div className="strategy-row">
            <span className="strategy-label">Trigger</span>
            <span className="strategy-value">{signal.trigger || '—'}</span>
          </div>
          <div className="strategy-row">
            <span className="strategy-label">Psych</span>
            <span className="strategy-value">
              {signal.psychConfluence ? (
                <>
                  <span className="badge-yes">YES</span>{' '}
                  <span className="info-aux">at {signal.psychLevel}</span>
                </>
              ) : (
                <span className="badge-no">NO</span>
              )}
            </span>
          </div>
          <div className="strategy-row">
            <span className="strategy-label">MTF</span>
            <span className="strategy-value">
              <span className={mtfClass(mtf.weekly)}>W {mtfBadge(mtf.weekly)}</span>
              <span className="mtf-sep">·</span>
              <span className={mtfClass(mtf.daily)}>D {mtfBadge(mtf.daily)}</span>
              <span className="mtf-sep">·</span>
              <span className={mtfClass(mtf.h4)}>4H {mtfBadge(mtf.h4)}</span>
              {mtf.strength && (
                <span className={strengthBadgeClass(mtf.strength)}> · {mtf.strength}</span>
              )}
            </span>
          </div>
          {showActionableGrid && signal.tpCappedBy && (
            <div className="strategy-row">
              <span className="strategy-label">TP capped</span>
              <span className="strategy-value info-aux">
                near opposing zone {signal.tpCappedBy.mid} ({signal.tpCappedBy.touches}x)
              </span>
            </div>
          )}
          {showNoTradeContext && (
            <div className="strategy-row">
              <span className="strategy-label">Score</span>
              <span className="strategy-value">
                <span className="tier-badge tier-badge-no-trade">{checklistPct}%</span>
                <span className="info-aux"> · below 70% — no trade</span>
              </span>
            </div>
          )}
        </div>
      )}

      {!signal.actionable && isWatch && (
        <>
          <div className="watch-message">Monitor this level — wait for trigger</div>
          <div className="card-grid watch-grid">
            <div className="metric">
              <div className="metric-label">Level</div>
              <div className="metric-value">{signal.entry}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Touches</div>
              <div className="metric-value">{signal.zone.touches}x</div>
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
          <div className="strategy-details">
            <div className="strategy-row">
              <span className="strategy-label">Why watch</span>
              <span className="strategy-value">{signal.reason || 'Strong zone near price'}</span>
            </div>
            <div className="strategy-row">
              <span className="strategy-label">Psych</span>
              <span className="strategy-value">
                {signal.psychConfluence ? (
                  <>
                    <span className="badge-yes">YES</span>{' '}
                    <span className="info-aux">at {signal.psychLevel}</span>
                  </>
                ) : (
                  <span className="badge-no">NO</span>
                )}
              </span>
            </div>
            <div className="strategy-row">
              <span className="strategy-label">MTF</span>
              <span className="strategy-value">
                <span className={mtfClass(mtf.weekly)}>W {mtfBadge(mtf.weekly)}</span>
                <span className="mtf-sep">·</span>
                <span className={mtfClass(mtf.daily)}>D {mtfBadge(mtf.daily)}</span>
                <span className="mtf-sep">·</span>
                <span className={mtfClass(mtf.h4)}>4H {mtfBadge(mtf.h4)}</span>
                {mtf.strength && (
                  <span className={strengthBadgeClass(mtf.strength)}> · {mtf.strength}</span>
                )}
              </span>
            </div>
          </div>
        </>
      )}

      {!signal.actionable && !isWatch && (
        <div className="card-info-grid">
          <div className="info-row">
            <span className="info-label">Price</span>
            <span className="info-value">{signal.currentPrice}</span>
          </div>
          <div className="info-row">
            <span className="info-label">MTF</span>
            <span className="info-value">
              <span className={mtfClass(mtf.weekly)}>W {mtfBadge(mtf.weekly)}</span>
              <span className="mtf-sep">·</span>
              <span className={mtfClass(mtf.daily)}>D {mtfBadge(mtf.daily)}</span>
              <span className="mtf-sep">·</span>
              <span className={mtfClass(mtf.h4)}>4H {mtfBadge(mtf.h4)}</span>
              {mtf.strength && (
                <span className={strengthBadgeClass(mtf.strength)}> · {mtf.strength}</span>
              )}
            </span>
          </div>
          {signal.reason && (
            <div className="info-row">
              <span className="info-label">Reason</span>
              <span className="info-value info-aux">{signal.reason}</span>
            </div>
          )}
          {signal.nearestSupport && (
            <div className="info-row">
              <span className="info-label">Support</span>
              <span className="info-value">
                {signal.nearestSupport.mid}
                <span className="info-aux">
                  · {signal.nearestSupport.distancePct}% away · {signal.nearestSupport.touches}x
                </span>
              </span>
            </div>
          )}
          {signal.nearestResistance && (
            <div className="info-row">
              <span className="info-label">Resistance</span>
              <span className="info-value">
                {signal.nearestResistance.mid}
                <span className="info-aux">
                  · {signal.nearestResistance.distancePct}% away ·{' '}
                  {signal.nearestResistance.touches}x
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      <div className="card-meta">
        <span className="meta-pill">{signal.trend}</span>
        {signal.zone && (
          <span className="meta-pill">{signal.zone.touches}x touches</span>
        )}
        <span className="sentiment" title="News (display only, not scored)">
          {base} {sentimentArrow(signal.sentiment.base)} {sentimentLabel(signal.sentiment.base)} ·{' '}
          {quote} {sentimentArrow(signal.sentiment.quote)} {sentimentLabel(signal.sentiment.quote)}
        </span>
      </div>

      {onOpenChecklist && (
        <div className="card-actions">
          <button
            type="button"
            className="checklist-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpenChecklist();
            }}
          >
            Open Checklist →
          </button>
        </div>
      )}
    </div>
  );
}
