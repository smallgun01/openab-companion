/**
 * expression.js — Parse [emotion] tags from assistant text, drive VRM expressions.
 *
 *   parseAndApply(text, vrm) → returns cleaned text (tags stripped)
 *
 * Supports 9 MVP emotions with lerp transitions over 300ms.
 */

/* Tag → VRM expression preset + weights */
const EMOTION_MAP = {
  happy:      { preset: 'happy',      weights: { happy: 1.0 } },
  sad:        { preset: 'sad',        weights: { sad: 1.0 } },
  angry:      { preset: 'angry',      weights: { angry: 1.0 } },
  surprised:  { preset: 'surprised',  weights: { surprised: 1.0 } },
  relaxed:    { preset: 'relaxed',    weights: { relaxed: 1.0 } },
  thinking:   { preset: 'neutral',    weights: { neutral: 1.0 } },
  confused:   { preset: 'sad',        weights: { sad: 0.3, surprised: 0.3 } },
  excited:    { preset: 'happy',      weights: { happy: 1.0, surprised: 0.5 } },
  neutral:    { preset: 'neutral',    weights: { neutral: 1.0 } },
};

const TAG_RE = /\[([a-zA-Z]+)\]/g;

/** Currently active expression for lerp tracking. null = not yet set. */
let currentExpression = null;
/** Animation frame ID for lerp, so we can cancel on new expression. */
let lerpRAF = null;
/** Start time of current lerp. */
let lerpStart = 0;
/** Starting weights snapshot. */
let lerpFrom = {};
/** Target weights. */
let lerpTo = {};
/** Duration in ms. */
const LERP_MS = 300;

/**
 * Scan text for [tag], strip tags, and apply the last found emotion to the VRM.
 * Tags in the middle of text apply progressively; the last tag wins.
 *
 * @param {string} text - Assistant message text
 * @param {import('@pixiv/three-vrm').VRM} vrm - VRM instance
 * @returns {string} Cleaned text with all [tag] removed
 */
export function parseAndApply(text, vrm) {
  if (!text) return text;

  const tags = [];
  const cleaned = text.replace(TAG_RE, (match, tag) => {
    const lower = tag.toLowerCase();
    if (EMOTION_MAP[lower]) {
      tags.push(lower);
      return ''; // strip tag
    }
    // unknown tag → fallback neutral
    tags.push('neutral');
    return '';
  }).replace(/\s{2,}/g, ' ').trim();

  // apply the last tag found (or neutral if none)
  const emotionKey = tags.length > 0 ? tags[tags.length - 1] : 'neutral';
  const mapping = EMOTION_MAP[emotionKey] || EMOTION_MAP.neutral;

  applyWeights(vrm, mapping.weights);
  return cleaned;
}

/** Apply expression weights to VRM with lerp transition. */
function applyWeights(vrm, targetWeights) {
  if (!vrm || !vrm.expressionManager) return;

  // Cancel any in-progress lerp
  if (lerpRAF) cancelAnimationFrame(lerpRAF);

  lerpFrom = snapshotWeights(vrm, targetWeights);
  // Reset keys present in lerpFrom but absent in target → lerp to 0
  lerpTo = { ...targetWeights };
  for (const key of Object.keys(lerpFrom)) {
    if (!(key in lerpTo)) lerpTo[key] = 0;
  }
  lerpStart = performance.now();
  currentExpression = targetWeights;
  tickLerp(vrm);
}

/** Take a snapshot of current expression weights for lerp start. */
function snapshotWeights(vrm, target) {
  const snap = {};
  for (const key of Object.keys(target)) {
    try {
      snap[key] = vrm.expressionManager.getValue(key) ?? 0;
    } catch {
      snap[key] = 0;
    }
  }
  // Also capture keys we may need to reset that aren't in target
  const allKeys = vrm.expressionManager.getExpressionNames?.() ?? [];
  for (const key of allKeys) {
    if (!(key in snap)) {
      snap[key] = vrm.expressionManager.getValue(key) ?? 0;
    }
  }
  return snap;
}

/** One frame of the lerp. */
function tickLerp(vrm) {
  if (!vrm || !vrm.expressionManager) return;

  const elapsed = performance.now() - lerpStart;
  const t = Math.min(elapsed / LERP_MS, 1.0);
  // ease-out
  const eased = 1 - Math.pow(1 - t, 3);

  // Set expression weights for target keys
  for (const key of Object.keys(lerpTo)) {
    const from = lerpFrom[key] ?? 0;
    const to = lerpTo[key];
    const val = from + (to - from) * eased;
    try {
      vrm.expressionManager.setValue(key, val);
    } catch { /* ignore unsupported expression keys */ }
  }

  if (t < 1) {
    lerpRAF = requestAnimationFrame(() => tickLerp(vrm));
  } else {
    lerpRAF = null;
  }
}

export { EMOTION_MAP };
