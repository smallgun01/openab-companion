/**
 * expression.js — Parse [emotion] tags from assistant text, drive VRM expressions.
 *
 *   parseAndApply(text, vrm) → returns cleaned text (tags stripped)
 *
 * Supports 9 MVP emotions with lerp transitions over 300ms.
 * Handles both VRM 0.x (blendShapeProxy) and VRM 1.0 (expressionManager).
 */
import {
  setExpressionValue,
  getExpressionValue,
  getExpressionNames,
  hasExpressions,
  isVRM0x,
} from './vrm-scene.js';

/* ── Emotion → VRM preset mapping ─────────────────────── */

/**
 * VRM 1.0 preset names.
 */
const VRM1_PRESETS = {
  happy:      'happy',
  sad:        'sad',
  angry:      'angry',
  surprised:  'surprised',
  relaxed:    'relaxed',
  neutral:    'neutral',
  thinking:   'neutral',
  confused:   'sad',
  excited:    'happy',
};

/**
 * VRM 0.x blend-shape preset names.
 * Alicia Solid / standard VRM 0.x presets: joy, sorrow, angry, fun, neutral
 */
const VRM0_PRESETS = {
  happy:      'joy',
  sad:        'sorrow',
  angry:      'angry',
  surprised:  'fun',
  relaxed:    'neutral',
  neutral:    'neutral',
  thinking:   'neutral',
  confused:   'sorrow',
  excited:    'joy',
};

/**
 * Weights per emotion tag.  Keys are our internal emotion names.
 * Weights are always in VRM 1.0 preset names; they get remapped at apply-time.
 */
const EMOTION_WEIGHTS = {
  happy:      { happy: 1.0 },
  sad:        { sad: 1.0 },
  angry:      { angry: 1.0 },
  surprised:  { surprised: 1.0 },
  relaxed:    { relaxed: 1.0 },
  thinking:   { neutral: 1.0 },
  confused:   { sad: 0.3, surprised: 0.3 },
  excited:    { happy: 1.0, surprised: 0.5 },
  neutral:    { neutral: 1.0 },
};

const TAG_RE = /\[([a-zA-Z]+)\]/g;

/** Currently active expression for lerp tracking. */
let currentExpression = null;
/** Animation frame ID for lerp, so we can cancel on new expression. */
let lerpRAF = null;
/** Start time of current lerp. */
let lerpStart = 0;
/** Starting weights snapshot (in resolved VRM preset keys). */
let lerpFrom = {};
/** Target weights (in resolved VRM preset keys). */
let lerpTo = {};
/** Duration in ms. */
const LERP_MS = 300;

/* ── Public API ───────────────────────────────────────── */

/**
 * Scan text for [tag], strip tags, and apply the last found emotion to the VRM.
 *
 * @param {string} text - Assistant message text
 * @param {import('@pixiv/three-vrm').VRM} vrm - VRM instance
 * @returns {string} Cleaned text with all [tag] removed
 */
export function parseAndApply(text, vrm) {
  if (!text || !hasExpressions(vrm)) return text;

  const tags = [];
  const cleaned = text.replace(TAG_RE, (match, tag) => {
    const lower = tag.toLowerCase();
    if (EMOTION_WEIGHTS[lower]) {
      tags.push(lower);
      return '';
    }
    tags.push('neutral');
    return '';
  }).replace(/\s{2,}/g, ' ').trim();

  const emotionKey = tags.length > 0 ? tags[tags.length - 1] : 'neutral';
  applyWeightsResolved(vrm, emotionKey);
  return cleaned;
}

/* ── Internal: remap & apply ──────────────────────────── */

/**
 * Resolve internal emotion keys → concrete VRM preset names,
 * depending on VRM version (0.x vs 1.0).
 */
function resolvePresetMap() {
  return isVRM0x() ? VRM0_PRESETS : VRM1_PRESETS;
}

/**
 * Remap internal weight map keys to the current VRM version's preset names.
 * e.g. `{ happy: 1.0, surprised: 0.5 }` → `{ joy: 1.0, fun: 0.5 }` for VRM 0.x
 */
function remapWeights(weights) {
  const presets = resolvePresetMap();
  const out = {};
  for (const [key, value] of Object.entries(weights)) {
    const preset = presets[key] || presets.neutral;
    out[preset] = (out[preset] || 0) + value;
  }
  return out;
}

function applyWeightsResolved(vrm, emotionKey) {
  const rawWeights = EMOTION_WEIGHTS[emotionKey] || EMOTION_WEIGHTS.neutral;
  const targetWeights = remapWeights(rawWeights);

  if (lerpRAF) cancelAnimationFrame(lerpRAF);

  lerpFrom = snapshotWeights(vrm, targetWeights);
  lerpTo = { ...targetWeights };
  for (const key of Object.keys(lerpFrom)) {
    if (!(key in lerpTo)) lerpTo[key] = 0;
  }
  lerpStart = performance.now();
  currentExpression = targetWeights;
  tickLerp(vrm);
}

function snapshotWeights(vrm, target) {
  const snap = {};
  for (const key of Object.keys(target)) {
    snap[key] = getExpressionValue(vrm, key);
  }
  const allKeys = getExpressionNames(vrm);
  for (const key of allKeys) {
    if (!(key in snap)) {
      snap[key] = getExpressionValue(vrm, key);
    }
  }
  return snap;
}

function tickLerp(vrm) {
  if (!hasExpressions(vrm)) return;

  const elapsed = performance.now() - lerpStart;
  const t = Math.min(elapsed / LERP_MS, 1.0);
  const eased = 1 - Math.pow(1 - t, 3);

  for (const key of Object.keys(lerpTo)) {
    const from = lerpFrom[key] ?? 0;
    const to = lerpTo[key];
    const val = from + (to - from) * eased;
    setExpressionValue(vrm, key, val);
  }

  if (t < 1) {
    lerpRAF = requestAnimationFrame(() => tickLerp(vrm));
  } else {
    lerpRAF = null;
  }
}

export { EMOTION_WEIGHTS as EMOTION_MAP };
