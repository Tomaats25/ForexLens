import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Where weekly scans are persisted. On Railway, attach a Volume and set
// DATA_DIR to its mount path so scans survive redeploys/restarts. Without a
// volume this is the container's ephemeral disk: cross-DEVICE reads still work
// (same running container), but data is lost on redeploy.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

function ensureDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}
ensureDir();

function scanPath(week) {
  return path.join(DATA_DIR, `scan_${week}.json`);
}

// Persist a week's scan. Write to a temp file then rename for an atomic swap.
export function saveScan(week, payload) {
  ensureDir();
  const file = scanPath(week);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, file);
}

export function loadScan(week) {
  try {
    return JSON.parse(fs.readFileSync(scanPath(week), 'utf8'));
  } catch {
    return null;
  }
}

export function getDataDir() {
  return DATA_DIR;
}
