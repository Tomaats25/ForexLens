import React, { useState, useMemo } from 'react';

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

function autoFillFromSignal(signal) {
  const state = makeEmptyState();
  if (!signal) return state;

  const mtf = signal.mtfAlignment || {};
  if (mtf.weekly && mtf.weekly !== 'UNCLEAR') state.weekly.trend = true;
  if (mtf.daily && mtf.daily !== 'UNCLEAR') state.daily.trend = true;
  if (mtf.h4 && mtf.h4 !== 'UNCLEAR') state.h4.trend = true;

  if (signal.psychConfluence) {
    state.weekly.psych = true;
    state.daily.psych = true;
    state.h4.psych = true;
  }

  const supportDist = signal.nearestSupport?.distancePct ?? Infinity;
  const resistanceDist = signal.nearestResistance?.distancePct ?? Infinity;
  const nearZone = supportDist <= 0.3 || resistanceDist <= 0.3;
  if (nearZone) {
    state.weekly.aoi = true;
    state.daily.aoi = true;
  }

  return state;
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
  if (pct >= 86) return { label: 'Perfect Setup', tier: 'perfect' };
  if (pct >= 71) return { label: 'Strong Setup', tier: 'strong' };
  if (pct >= 51) return { label: 'Good Setup', tier: 'good' };
  if (pct >= 31) return { label: 'Possible Setup', tier: 'possible' };
  return { label: 'Weak Setup', tier: 'weak' };
}

function scoreRR(pct) {
  if (pct <= 50) return 'No Trade';
  if (pct <= 65) return '1:2 RR';
  if (pct <= 80) return '1:3 RR';
  return '1:4 RR';
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
  const initial = useMemo(
    () => savedState || autoFillFromSignal(signal),
    [pair, signal, savedState]
  );
  const [state, setState] = useState(initial);
  const [savedFlash, setSavedFlash] = useState(false);

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
  }

  function save() {
    onSave(state);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
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
          <button className="checklist-save" onClick={save}>
            {savedFlash ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </aside>
    </>
  );
}
