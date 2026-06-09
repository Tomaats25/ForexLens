import React from 'react';

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

function directionClass(dir) {
  if (dir === 'BUY') return 'buy';
  if (dir === 'SELL') return 'sell';
  if (dir === 'WATCH') return 'watch';
  return 'none';
}

function directionLabel(signal) {
  if (signal.direction === 'WATCH') return 'WATCH';
  if (signal.direction === 'NONE') return 'NO SETUP';
  if (signal.actionable) return signal.direction;
  return `${signal.direction} · low`;
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

export default function SignalCard({ signal, onClick }) {
  const base = signal.pair.slice(0, 3);
  const quote = signal.pair.slice(3);
  const isWatch = signal.direction === 'WATCH';
  const tier = signal.tier || (isWatch ? 'WATCH' : null);
  let cardClass = 'signal-card';
  if (tier) cardClass += ` tier-${tier.toLowerCase()}`;
  if (!signal.actionable && !isWatch) cardClass += ' muted-card';
  if (isWatch) cardClass += ' watch-card';
  const mtf = signal.mtfAlignment || {};

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
        <div className={`direction ${directionClass(signal.direction)}`}>
          {directionLabel(signal)}
        </div>
        <div className="score" title="Score 0-100">
          {signal.score}
        </div>
      </div>

      {signal.actionable ? (
        <>
          <div className="card-grid">
            <div className="metric">
              <div className="metric-label">Entry</div>
              <div className="metric-value">{signal.entry}</div>
            </div>
            <div className="metric">
              <div className="metric-label">TP · {signal.tpPips}p</div>
              <div className="metric-value tp">{signal.tp}</div>
            </div>
            <div className="metric">
              <div className="metric-label">SL · {signal.slPips}p</div>
              <div className="metric-value sl">{signal.sl}</div>
            </div>
            <div className="metric">
              <div className="metric-label">R:R</div>
              <div className="metric-value">1:{signal.rr}</div>
            </div>
          </div>

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
            {signal.tpCappedBy && (
              <div className="strategy-row">
                <span className="strategy-label">TP capped</span>
                <span className="strategy-value info-aux">
                  near opposing zone {signal.tpCappedBy.mid} ({signal.tpCappedBy.touches}x)
                </span>
              </div>
            )}
          </div>
        </>
      ) : isWatch ? (
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
      ) : (
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
    </div>
  );
}
