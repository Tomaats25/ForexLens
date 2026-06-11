import React, { useState, useMemo, useEffect, useRef } from 'react';

const SHARED_TF_ITEMS = [
  { id: 'trend', label: 'Trend', points: 10 },
  { id: 'aoi', label: 'At AOI / Rejected', points: 10 },
  { id: 'ema', label: 'Touching EMA', points: 5 },
  { id: 'psych', label: 'Round Psychological Level', points: 5 },
  { id: 'rejection_structure', label: 'Rejection from Previous Structure', points: 10 },
  { id: 'candlestick_rejection', label: 'Candlestick Rejection from AOI', points: 10 },
  { id: 'pattern', label: 'Break & Retest / Head & Shoulders Pattern', points: 10 }
];

const SECTIONS = [
  { id: 'weekly', name: 'Weekly', max: 60, items: SHARED_TF_ITEMS },
  { id: 'daily', name: 'Daily', max: 60, items: SHARED_TF_ITEMS },
  {
    id: 'h4',
    name: '4H',
    max: 45,
    items: [
      { id: 'trend', label: 'Trend', points: 5 },
      { id: 'aoi', label: 'At AOI / Rejected', points: 5 },
      { id: 'ema', label: 'Touching EMA', points: 5 },
      { id: 'psych', label: 'Round Psychological Level', points: 5 },
      { id: 'rejection_structure', label: 'Rejection from Previous Structure', points: 10 },
      { id: 'candlestick_rejection', label: 'Candlestick Rejection from AOI', points: 5 },
      { id: 'pattern', label: 'Break & Retest / Head & Shoulders Pattern', points: 10 }
    ]
  },
  {
    id: 'lower',
    name: '2H / 1H / 30m',
    max: 15,
    items: [
      { id: 'trend', label: 'Trend', points: 5 },
      { id: 'ema', label: 'Touching EMA', points: 5 },
      { id: 'pattern', label: 'Break & Retest / Head & Shoulders Pattern', points: 5 }
    ]
  },
  {
    id: 'entry',
    name: 'Entry Signal',
    max: 20,
    items: [
      { id: 'sos', label: 'SOS', points: 10 },
      { id: 'engulfing', label: 'Engulfing Candlestick on 30m/1H/2H/4H', points: 10 }
    ]
  }
];

const TOTAL_MAX = SECTIONS.reduce((sum, s) => sum + s.max, 0); // 150

const SLTP_ITEMS = [
  { id: 'sl', label: 'Stop Loss placed' },
  { id: 'tp', label: 'Take Profit placed' }
];

function makeEmptyState() {
  const state = { sltp: {} };
  for (const section of SECTIONS) {
    state[section.id] = {};
    for (const item of section.items) state[section.id][item.id] = false;
  }
  for (const item of SLTP_ITEMS) state.sltp[item.id] = false;
  return state;
}

export function autoFillFromSignal(signal) {
  const state = makeEmptyState();
  if (!signal) return state;

  const mtf = signal.mtfAlignment || {};

  // Trend per timeframe (only if not UNCLEAR)
  if (mtf.weekly && mtf.weekly !== 'UNCLEAR') state.weekly.trend = true;
  if (mtf.daily && mtf.daily !== 'UNCLEAR') state.daily.trend = true;
  if (mtf.h4 && mtf.h4 !== 'UNCLEAR') state.h4.trend = true;

  // Round psychological level — weekly + daily
  if (signal.psychConfluence) {
    state.weekly.psych = true;
    state.daily.psych = true;
  }

  // At AOI — price within 0.5% of a zone with 3+ touches
  const ns = signal.nearestSupport;
  const nr = signal.nearestResistance;
  const supportNear = ns && ns.touches >= 3 && ns.distancePct <= 0.5;
  const resistanceNear = nr && nr.touches >= 3 && nr.distancePct <= 0.5;
  if (supportNear || resistanceNear) {
    state.weekly.aoi = true;
    state.daily.aoi = true;
  }

  // Triggers from scanner → checklist items
  const trigger = signal.trigger || '';
  if (trigger.includes('Break & Retest')) {
    state.weekly.pattern = true;
    state.daily.pattern = true;
  }
  if (trigger.includes('Rejection')) {
    state.weekly.candlestick_rejection = true;
    state.daily.candlestick_rejection = true;
  }

  return state;
}

// Single source of truth: re-runnable percentage from a saved checklist state.
export function computeChecklistPercent(state) {
  if (!state) return null;
  let total = 0;
  for (const section of SECTIONS) {
    const ticks = state[section.id] || {};
    const raw = section.items.reduce(
      (sum, item) => sum + (ticks[item.id] ? item.points : 0),
      0
    );
    total += Math.min(raw, section.max);
  }
  return Math.round((total / TOTAL_MAX) * 100);
}

// Map checklist percentage → numeric RR (or null = No Trade). New tier system.
export function checklistScoreToRR(pct) {
  if (pct === null || pct === undefined || pct < 70) return null;
  if (pct >= 90) return 2.5;
  return 2;
}

function computeSectionScore(section, state) {
  const ticks = state[section.id] || {};
  const raw = section.items.reduce(
    (sum, item) => sum + (ticks[item.id] ? item.points : 0),
    0
  );
  return Math.min(raw, section.max);
}

function scoreLabel(pct) {
  if (pct >= 90) return { label: 'A Tier — Strong Setup', tier: 'a' };
  if (pct >= 80) return { label: 'B Tier — Good Setup', tier: 'b' };
  if (pct >= 70) return { label: 'C Tier — Valid Setup', tier: 'c' };
  return { label: 'No Trade', tier: 'no-trade' };
}

function scoreRR(pct) {
  if (pct < 70) return 'No Trade';
  if (pct >= 90) return 'Target RR: 1:2.5';
  return 'Target RR: 1:2';
}

// Tier descriptor — used by SignalCard / Chart to render the badge and recompute TP.
export function checklistTier(pct) {
  if (pct === null || pct === undefined) return null;
  if (pct >= 90) return { letter: 'A', label: 'A Tier — Strong Setup', tier: 'a', rr: 2.5 };
  if (pct >= 80) return { letter: 'B', label: 'B Tier — Good Setup', tier: 'b', rr: 2 };
  if (pct >= 70) return { letter: 'C', label: 'C Tier — Valid Setup', tier: 'c', rr: 2 };
  return { letter: 'NO TRADE', label: 'No Trade', tier: 'no-trade', rr: null };
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? 'toggle-on' : ''}`}
      onClick={onChange}
    >
      <span className="toggle-handle" />
    </button>
  );
}

function ChecklistSection({ section, state, onToggle }) {
  const score = computeSectionScore(section, state);

  return (
    <div className="checklist-section">
      <div className="checklist-section-head">
        <h3>{section.name}</h3>
        <div className="checklist-section-score">
          <span className="section-pct">
            {score}/{section.max}
          </span>
        </div>
      </div>
      <ul className="checklist-items">
        {section.items.map((item) => {
          const ticked = !!state[section.id]?.[item.id];
          return (
            <li key={item.id} className={ticked ? 'item-ticked' : ''}>
              <span className="item-label">{item.label}</span>
              <span className="item-points">+{item.points}</span>
              <Toggle
                checked={ticked}
                onChange={() => onToggle(section.id, item.id)}
                label={item.label}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function Checklist({ pair, signal, savedState, onClose, onSave }) {
  // savedState is a stored record: { state, scorePct, tier, updatedAt, scannedAt }
  const initial = useMemo(
    () => savedState?.state || autoFillFromSignal(signal),
    [pair, signal, savedState]
  );
  const [state, setState] = useState(initial);
  const [restoredFrom, setRestoredFrom] = useState(savedState?.updatedAt || null);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const mountedRef = useRef(false);

  // Auto-save on every change. On mount, only persist fresh auto-fills —
  // restored checklists keep their stored timestamp until a real edit.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      if (!restoredFrom) {
        onSave(state);
        setLastSavedAt(new Date());
      }
      return;
    }
    onSave(state);
    setLastSavedAt(new Date());
  }, [state]);

  const sectionScores = useMemo(
    () => SECTIONS.map((s) => ({ section: s, score: computeSectionScore(s, state) })),
    [state]
  );
  const totalScore = sectionScores.reduce((sum, s) => sum + s.score, 0);
  const totalPct = Math.round((totalScore / TOTAL_MAX) * 100);
  const verdict = scoreLabel(totalPct);
  const rr = scoreRR(totalPct);

  function toggle(sectionId, itemId) {
    setState((prev) => ({
      ...prev,
      [sectionId]: { ...prev[sectionId], [itemId]: !prev[sectionId]?.[itemId] }
    }));
  }

  function toggleSltp(itemId) {
    setState((prev) => ({
      ...prev,
      sltp: { ...prev.sltp, [itemId]: !prev.sltp?.[itemId] }
    }));
  }

  function reset() {
    setState(makeEmptyState());
    setRestoredFrom(null);
  }

  function resetToAutoFill() {
    setState(autoFillFromSignal(signal));
    setRestoredFrom(null);
  }

  return (
    <>
      <div className="checklist-backdrop" onClick={onClose} />
      <aside className="checklist-panel" aria-label={`${pair} checklist`}>
        <div className="checklist-header">
          <div>
            <div className="checklist-title">{pair}</div>
            <div className="checklist-subtitle">Perfect Trade Checklist</div>
          </div>
          <button className="checklist-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="checklist-body">
          {restoredFrom && (
            <div className="restore-banner">
              <span>
                Saved from {new Date(restoredFrom).toLocaleString()} — toggles restored
              </span>
              <button type="button" onClick={resetToAutoFill}>
                Reset to auto-fill
              </button>
            </div>
          )}
          {SECTIONS.map((section) => (
            <ChecklistSection
              key={section.id}
              section={section}
              state={state}
              onToggle={toggle}
            />
          ))}

          <div className="checklist-section sltp-section">
            <div className="checklist-section-head">
              <h3>Stop Loss & Take Profit</h3>
              <div className="checklist-section-score">
                <span className="section-pct muted">no points</span>
              </div>
            </div>
            <ul className="checklist-items">
              {SLTP_ITEMS.map((item) => {
                const ticked = !!state.sltp?.[item.id];
                return (
                  <li key={item.id} className={ticked ? 'item-ticked' : ''}>
                    <span className="item-label">{item.label}</span>
                    <span className="item-points">–</span>
                    <Toggle
                      checked={ticked}
                      onChange={() => toggleSltp(item.id)}
                      label={item.label}
                    />
                  </li>
                );
              })}
            </ul>
          </div>

          <div className={`confluence-summary tier-${verdict.tier}`}>
            <div className="confluence-head">Confluence Summary</div>
            <ul className="confluence-list">
              {sectionScores.map(({ section, score }) => (
                <li key={section.id}>
                  <span>{section.name}</span>
                  <span className="confluence-pct">
                    {score}/{section.max}
                  </span>
                </li>
              ))}
            </ul>
            <div className="confluence-total">
              <div className="total-pct">{totalPct}%</div>
              <div className="total-label">{verdict.label}</div>
              <div className="total-rr">{rr}</div>
            </div>
          </div>
        </div>

        <div className="checklist-footer">
          <button className="checklist-reset" onClick={reset}>
            Reset
          </button>
          <span className="autosave-note">
            {lastSavedAt
              ? `Auto-saved ${lastSavedAt.toLocaleTimeString()}`
              : 'Auto-saves on every change'}
          </span>
        </div>
      </aside>
    </>
  );
}
