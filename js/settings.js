/**
 * settings.js — localStorage + IndexedDB persistence
 *   getSettings() / saveSettings(obj) → localStorage
 *   saveModel(file) / loadModel()         → IndexedDB
 */

const DB_NAME = 'openab-companion';
const DB_VERSION = 1;
const STORE_NAME = 'models';
const MODEL_KEY = 'current';

/** Default settings */
const DEFAULTS = {
  endpoint: 'http://localhost:8080/v1/chat/completions',
  token: '',
  bgColor: '#1a1a2e',
};

/* ── Settings (localStorage) ──────────────────────────── */

/** Get merged settings (defaults + saved). */
export function getSettings() {
  const raw = localStorage.getItem('openab-settings');
  const saved = raw ? safeParse(raw) : {};
  return { ...DEFAULTS, ...saved };
}

/** Save a partial or full settings object. */
export function saveSettings(partial) {
  const current = getSettings();
  const merged = { ...current, ...partial };
  removeUndefined(merged);
  localStorage.setItem('openab-settings', JSON.stringify(merged));
}

/* ── Model (IndexedDB) ────────────────────────────────── */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Store a .vrm File as an ArrayBuffer in IndexedDB. */
export async function saveModel(file) {
  const buf = await file.arrayBuffer();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(
      { name: file.name, data: buf, mime: 'application/octet-stream', savedAt: Date.now() },
      MODEL_KEY
    );
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Load the saved model from IndexedDB.
 * @returns {{name:string, data:ArrayBuffer}|null}
 */
export async function loadModel() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(MODEL_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = (e) => reject(e.target.error);
  });
}

/* ── Helpers ──────────────────────────────────────────── */

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

function removeUndefined(obj) {
  Object.keys(obj).forEach((k) => {
    if (obj[k] === undefined) delete obj[k];
  });
}
