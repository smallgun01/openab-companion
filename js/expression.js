/**
 * expression.js — Parse [emotion] tags from assistant text, drive VRM expressions.
 *
 *   parseAndApply(text, vrm) → returns cleaned text (tags stripped)
 *
 * After VRMUtils.rotateVRM0(), both VRM 0.x and 1.0 expose expressionManager.
 * Map 19 emotions → 6 standard VRM expression presets via weighted blends.
 *
 * Base mapping adapted from catsmice/AniCompanion (MIT),
 * enhanced with compound blends for finer facial differentiation.
 */
import { setExpressionValue, getExpressionValue, getExpressionNames, hasExpressions } from './vrm-scene.js';

/* ── Emotion → expression weight maps ─────────────────── */

const EMOTION_WEIGHTS = {
  // ── 6 primitive VRM presets (direct mapping) ──
  happy:      { happy: 1.0 },
  sad:        { sad: 1.0 },
  angry:      { angry: 1.0 },
  surprised:  { surprised: 1.0 },
  relaxed:    { relaxed: 1.0 },
  neutral:    { neutral: 1.0 },

  // ── Original compound emotions (preserved) ──
  thinking:   { neutral: 1.0 },
  confused:   { sad: 0.3, surprised: 0.3 },
  excited:    { happy: 1.0, surprised: 0.5 },

  // ── AniCompanion's 10 additional emotions (enhanced compound mappings) ──
  curious:    { relaxed: 0.5, surprised: 0.2 },   // wide eyes, soft face
  shy:        { relaxed: 0.6, sad: 0.2 },         // soft + faint hesitation
  love:       { happy: 0.8, relaxed: 0.3 },        // soft smile, not full grin
  smirk:      { happy: 0.5, neutral: 0.5 },        // half-smile
  sleepy:     { relaxed: 0.5, neutral: 0.5 },       // droopy, unfocused
  proud:      { happy: 0.8, neutral: 0.2 },         // confident, not giddy
  disgusted:  { angry: 0.7, sad: 0.2 },             // scowl + nose wrinkle
  pain:       { sad: 0.8, angry: 0.2 },              // grimace
  laugh:      { happy: 1.0, surprised: 0.2 },        // wide smile + bright eyes
  bored:      { neutral: 0.7, relaxed: 0.3 },        // flat + droopy
};

const TAG_RE = /\[([a-zA-Z]+)\]/g;

let currentExpression = null;
let lerpRAF = null;
let lerpStart = 0;
let lerpFrom = {};
let lerpTo = {};
const LERP_MS = 300;

/** Track the last detected emotion key for animation triggering. */
let lastEmotionKey = 'neutral';
export function getLastEmotion() { return lastEmotionKey; }

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
  lastEmotionKey = emotionKey;
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
