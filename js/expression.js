/**
 * expression.js — Parse [emotion] tags from assistant text, drive VRM expressions.
 *
 *   parseAndApply(text, vrm) → returns cleaned text (tags stripped)
 *
 * After VRMUtils.rotateVRM0(), both VRM 0.x and 1.0 expose expressionManager.
 * Supports 9 MVP emotions with lerp transitions over 300ms.
 */
import { setExpressionValue, getExpressionValue, getExpressionNames, hasExpressions } from './vrm-scene.js';

/* ── Emotion → expression weight maps ─────────────────── */

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

let currentExpression = null;
let lerpRAF = null;
let lerpStart = 0;
let lerpFrom = {};
let lerpTo = {};
const LERP_MS = 300;

/* ── Public API ───────────────────────────────────────── */

export function parseAndApply(text, vrm) {
  if (!text || !hasExpressions(vrm)) return text;

  const tags = [];
  const cleaned = text.replace(TAG_RE, (match, tag) => {
    const lower = tag.toLowerCase();
    tags.push(EMOTION_WEIGHTS[lower] ? lower : 'neutral');
    return '';
  }).replace(/\s{2,}/g, ' ').trim();

  const emotionKey = tags.length > 0 ? tags[tags.length - 1] : 'neutral';
  const targetWeights = EMOTION_WEIGHTS[emotionKey] || EMOTION_WEIGHTS.neutral;

  if (lerpRAF) cancelAnimationFrame(lerpRAF);

  lerpFrom = snapshotWeights(vrm, targetWeights);
  lerpTo = { ...targetWeights };
  for (const key of Object.keys(lerpFrom)) {
    if (!(key in lerpTo)) lerpTo[key] = 0;
  }
  lerpStart = performance.now();
  currentExpression = targetWeights;
  tickLerp(vrm);

  return cleaned;
}

/* ── Internal ─────────────────────────────────────────── */

function snapshotWeights(vrm, target) {
  const snap = {};
  for (const key of Object.keys(target)) {
    snap[key] = getExpressionValue(vrm, key);
  }
  for (const key of getExpressionNames(vrm)) {
    if (!(key in snap)) snap[key] = getExpressionValue(vrm, key);
  }
  return snap;
}

function tickLerp(vrm) {
  if (!hasExpressions(vrm)) return;

  const t = Math.min((performance.now() - lerpStart) / LERP_MS, 1.0);
  const eased = 1 - Math.pow(1 - t, 3);

  for (const key of Object.keys(lerpTo)) {
    const from = lerpFrom[key] ?? 0;
    setExpressionValue(vrm, key, from + (lerpTo[key] - from) * eased);
  }

  if (t < 1) {
    lerpRAF = requestAnimationFrame(() => tickLerp(vrm));
  } else {
    lerpRAF = null;
  }
}

export { EMOTION_WEIGHTS as EMOTION_MAP };
