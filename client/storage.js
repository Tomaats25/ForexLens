// localStorage persistence for Perfect Trade Checklists.
// Keys are per-pair, per-ISO-week: checklist_EURUSD_2026-W24
// A new week gets fresh keys automatically; old weeks stay preserved.

const PREFIX = 'checklist_';
const WEEK_MARKER = 'forexlens_current_week';

// ISO-8601 week number (weeks start Monday; W01 contains the first Thursday).
export function getWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function storageKey(pair, week = getWeekKey()) {
  return `${PREFIX}${pair}_${week}`;
}

export function saveChecklistRecord(pair, record) {
  try {
    localStorage.setItem(storageKey(pair), JSON.stringify(record));
  } catch (e) {
    console.warn('localStorage save failed:', e);
  }
}

export function loadChecklistRecord(pair) {
  try {
    const raw = localStorage.getItem(storageKey(pair));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// All records for the current week, keyed by pair.
export function loadAllChecklists() {
  const suffix = `_${getWeekKey()}`;
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PREFIX) || !key.endsWith(suffix)) continue;
      const pair = key.slice(PREFIX.length, key.length - suffix.length);
      try {
        out[pair] = JSON.parse(localStorage.getItem(key));
      } catch {
        // skip corrupted entry
      }
    }
  } catch {
    // localStorage unavailable (private mode etc.) — start empty
  }
  return out;
}

// Returns the previous week key if a new week just started, else null.
// Always advances the marker so the banner shows once per week change.
export function checkNewWeek() {
  try {
    const current = getWeekKey();
    const last = localStorage.getItem(WEEK_MARKER);
    localStorage.setItem(WEEK_MARKER, current);
    if (last && last !== current) return last;
    return null;
  } catch {
    return null;
  }
}
