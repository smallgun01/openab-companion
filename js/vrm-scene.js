/**
 * vrm-scene.js — THREE.js scene with VRM character rendering.
 *
 *   initScene(canvas)      → set up renderer
 *   loadVRM(buffer, name)  → load .vrm from ArrayBuffer
 *   getVRM()               → current VRM instance
 *   isVRM0x()              → true if loaded model is VRM 0.x
 *   dispose()              → clean up
 *
 * Supports VRM 0.x (Alicia Solid) and VRM 1.0.
 * Uses CDN imports: three.js + @pixiv/three-vrm
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm/lib/three-vrm.module.js';

let renderer, scene, camera, clock;
let currentVRM = null;
let currentVRMVersion = '1.0'; // '0.0' | '1.0'
let animationFrameId = null;

/* Bone refs for idle animation (recorded once on load, set absolutely per frame) */
let breathingBone = null;
let breathingBoneOriginalY = 0;
let breathingScene = null;
let breathingSceneOriginalY = 0;

/* Arm bones for idle pose (VRM 0.x only — arms start in T-pose) */
let leftUpperArm = null;
let rightUpperArm = null;
let leftLowerArm = null;
let rightLowerArm = null;

/* Idle state */
let lastBlinkTime = 0;
let nextBlinkInterval = randomBlinkInterval();
let blinkPhase = 'idle'; // 'idle' | 'closing' | 'closed' | 'opening'
let blinkStart = 0;

/* ── Init ─────────────────────────────────────────────── */

export function initScene(canvas, bgColor = '#1a1a2e') {
  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(bgColor);

  // Camera — half-body framing
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 1.2, 3.5);
  camera.lookAt(0, 1.0, 0);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 3.0);
  key.position.set(0, 2, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 1.5);
  rim.position.set(0, 1.5, -2);
  scene.add(rim);

  clock = new THREE.Clock();
  resize();
  window.addEventListener('resize', resize);

  // start render loop (idle animation runs inside)
  animate();

  return { scene, camera, renderer };
}

/* ── VRM Loading ──────────────────────────────────────── */

/**
 * Load a VRM model from an ArrayBuffer.
 * @param {ArrayBuffer} buffer
 * @param {string} [name] — display name
 * @returns {Promise<import('@pixiv/three-vrm').VRM>}
 */
export async function loadVRM(buffer, name = 'model') {
  disposeVRM();

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  try {
    const gltf = await loader.loadAsync(url);
    URL.revokeObjectURL(url);

    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error('No VRM data in file. Is it a valid .vrm?');

    // Detect VRM version
    currentVRMVersion = vrm.meta?.specVersion || '0.0';

    // VRMUtils optimizations — safe for VRM 1.0, skip for VRM 0.x
    if (currentVRMVersion === '1.0') {
      try {
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);
      } catch { /* non-critical */ }
    }

    scene.add(vrm.scene);
    currentVRM = vrm;

    // ── Record bone refs for idle animations ──────────

    // Breathing: find spine/chest bone
    breathingBone = null;
    breathingScene = null;
    leftUpperArm = null;
    rightUpperArm = null;
    leftLowerArm = null;
    rightLowerArm = null;

    if (currentVRMVersion === '1.0') {
      // VRM 1.0: use getNormalizedBoneNode
      for (const name of ['spine', 'chest', 'upperChest']) {
        const bone = vrm.humanoid?.getNormalizedBoneNode?.(name);
        if (bone) {
          breathingBone = bone;
          breathingBoneOriginalY = bone.position.y;
          break;
        }
      }
    } else {
      // VRM 0.x: traverse skeleton by node name
      setupVRM0xBones(vrm);
    }

    if (!breathingBone && vrm.scene) {
      breathingScene = vrm.scene;
      breathingSceneOriginalY = vrm.scene.position.y;
    }

    // ── Apply idle pose (VRM 0.x starts in T-pose) ──
    if (currentVRMVersion === '0.0') {
      applyIdlePose();
    }

    lastBlinkTime = performance.now();
    nextBlinkInterval = randomBlinkInterval();
    blinkPhase = 'idle';

    return vrm;
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Find bones by name in the VRM 0.x skeleton via scene traversal.
 * VRM 0.x does not have getNormalizedBoneNode; we search the
 * armature for matching bone names.
 */
function setupVRM0xBones(vrm) {
  if (!vrm.scene) return;

  // Collect all bone-like nodes for debug + position-based matching
  const bones = [];
  vrm.scene.traverse((node) => {
    if (!node.isBone && !node.isObject3D) return;
    if (!node.name) return;
    bones.push(node);

    const n = node.name;
    const lower = n.toLowerCase();

    // Breathing target: spine / chest
    if (!breathingBone) {
      if (lower.includes('spine') || lower.includes('chest') || lower.includes('せなか') ||
          lower.includes('上半身') || lower.includes('背骨') || lower.includes('脊椎')) {
        breathingBone = node;
        breathingBoneOriginalY = node.position.y;
      }
    }

    // ── Arm detection: try name patterns first ──
    const isUpperArm = (
      lower.includes('upperarm') || lower.includes('upper_arm') ||
      lower.includes('肩') || lower.includes('shoulder') || lower.includes('二の腕') ||
      lower.includes('arm') && (lower.includes('upper') || lower.includes('up_'))
    );
    const isLowerArm = (
      lower.includes('lowerarm') || lower.includes('lower_arm') ||
      lower.includes('forearm') || lower.includes('前腕') || lower.includes('ひじ') ||
      lower.includes('elbow') || lower.includes('腕') && !isUpperArm
    );

    if (isUpperArm) {
      if (lower.includes('left') || lower.includes('l_') || lower.includes('左')) {
        leftUpperArm = node;
      } else if (lower.includes('right') || lower.includes('r_') || lower.includes('右')) {
        rightUpperArm = node;
      }
    }
    if (isLowerArm) {
      if (lower.includes('left') || lower.includes('l_') || lower.includes('左')) {
        leftLowerArm = node;
      } else if (lower.includes('right') || lower.includes('r_') || lower.includes('右')) {
        rightLowerArm = node;
      }
    }
  });

  // ── Fallback: position-based detection ──
  // In T-pose, upper arm bones are the highest bones away from center on ±X
  if (!leftUpperArm || !rightUpperArm) {
    for (const bone of bones) {
      const wp = new THREE.Vector3();
      bone.getWorldPosition(wp);
      // Upper arms: |X| > 0.15, Y > 0.8 (shoulder height), isBone
      if (bone.isBone && Math.abs(wp.x) > 0.1 && wp.y > 0.7) {
        if (wp.x > 0 && !leftUpperArm) leftUpperArm = bone;
        if (wp.x < 0 && !rightUpperArm) rightUpperArm = bone;
      }
      // Forearms: |X| > 0.3 (further out), Y > 0.7
      if (bone.isBone && Math.abs(wp.x) > 0.25 && wp.y > 0.6 && wp.y < 1.2) {
        if (wp.x > 0 && !leftLowerArm) leftLowerArm = bone;
        if (wp.x < 0 && !rightLowerArm) rightLowerArm = bone;
      }
    }
  }

  // Debug: log found arm bones
  console.log('[vrm-scene] Arm bones detected:', {
    leftUpper: leftUpperArm?.name || 'NOT FOUND',
    rightUpper: rightUpperArm?.name || 'NOT FOUND',
    leftLower: leftLowerArm?.name || 'NOT FOUND',
    rightLower: rightLowerArm?.name || 'NOT FOUND',
    totalBones: bones.length,
    sampleNames: bones.filter(b => b.isBone).slice(0, 15).map(b => b.name),
  });
}

/**
 * Rotate arms from T-pose to natural resting pose.
 * Only needed for VRM 0.x models without built-in animations.
 */
function applyIdlePose() {
  // Rotate upper arms down ~60° from horizontal (T-pose arms = 90° from body)
  const upperArmAngle = THREE.MathUtils.degToRad(-55);
  const lowerArmAngle = THREE.MathUtils.degToRad(-15);

  if (leftUpperArm) {
    leftUpperArm.rotation.z = -upperArmAngle;
    leftUpperArm.rotation.x = THREE.MathUtils.degToRad(-10);
  }
  if (rightUpperArm) {
    rightUpperArm.rotation.z = upperArmAngle;
    rightUpperArm.rotation.x = THREE.MathUtils.degToRad(-10);
  }
  if (leftLowerArm) {
    leftLowerArm.rotation.z = lowerArmAngle;
  }
  if (rightLowerArm) {
    rightLowerArm.rotation.z = -lowerArmAngle;
  }
}

/** Get the current VRM instance (or null). */
export function getVRM() {
  return currentVRM;
}

/** Returns true if the loaded model is VRM 0.x. */
export function isVRM0x() {
  return currentVRMVersion === '0.0';
}

/** Returns the detected VRM specVersion string ('0.0' | '1.0'). */
export function getVRMVersion() {
  return currentVRMVersion;
}

/* ── Dispose ──────────────────────────────────────────── */

function disposeVRM() {
  if (currentVRM) {
    scene.remove(currentVRM.scene);
    currentVRM.scene?.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    currentVRM = null;
    breathingBone = null;
    breathingScene = null;
    leftUpperArm = rightUpperArm = leftLowerArm = rightLowerArm = null;
  }
}

export function dispose() {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  disposeVRM();
  window.removeEventListener('resize', resize);
  renderer?.dispose();
}

/* ── Render Loop ──────────────────────────────────────── */

function animate() {
  animationFrameId = requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.1); // cap to avoid spiral
  const now = performance.now();

  if (currentVRM) {
    updateIdle(delta, now);
    try { currentVRM.update(delta); } catch { /* spring bone may fail silently */ }
  }

  renderer.render(scene, camera);
}

/* ── Idle Animations ──────────────────────────────────── */

function updateIdle(delta, now) {
  applyBreathing(now);
  applyBlink(now);
}

function applyBreathing(now) {
  if (!currentVRM) return;
  const cycle = 3.5;
  const amplitude = 0.008;
  const offset = Math.sin((now * 0.001 * Math.PI * 2) / cycle) * amplitude;

  if (breathingBone) {
    breathingBone.position.y = breathingBoneOriginalY + offset;
  } else if (breathingScene) {
    breathingScene.position.y = breathingSceneOriginalY + offset * 5;
  }
}

function applyBlink(now) {
  const BLINK_CLOSE_MS = 100;
  const BLINK_HOLD_MS = 60;

  switch (blinkPhase) {
    case 'idle': {
      if (now - lastBlinkTime > nextBlinkInterval) {
        blinkPhase = 'closing';
        blinkStart = now;
      }
      break;
    }
    case 'closing': {
      const t = (now - blinkStart) / BLINK_CLOSE_MS;
      if (t >= 1) {
        setBlinkWeight(1);
        blinkPhase = 'closed';
        blinkStart = now;
      } else {
        setBlinkWeight(t);
      }
      break;
    }
    case 'closed': {
      if (now - blinkStart > BLINK_HOLD_MS) {
        blinkPhase = 'opening';
        blinkStart = now;
      }
      break;
    }
    case 'opening': {
      const t = (now - blinkStart) / BLINK_CLOSE_MS;
      if (t >= 1) {
        setBlinkWeight(0);
        blinkPhase = 'idle';
        lastBlinkTime = now;
        nextBlinkInterval = randomBlinkInterval();
      } else {
        setBlinkWeight(1 - t);
      }
      break;
    }
  }
}

function setBlinkWeight(v) {
  if (!currentVRM) return;

  // VRM 1.0: expressionManager
  if (currentVRMVersion === '1.0' && currentVRM.expressionManager) {
    const names = ['blink', 'Blink', 'blinkL', 'blinkR'];
    for (const name of names) {
      try { currentVRM.expressionManager.setValue(name, v); return; } catch { /* try next */ }
    }
    return;
  }

  // VRM 0.x: blendShapeProxy
  if (currentVRMVersion === '0.0' && currentVRM.blendShapeProxy) {
    const names = ['Blink', 'blink', 'BLINK', 'blink_L', 'Blink_L', 'blink_R', 'Blink_R'];
    for (const name of names) {
      try { currentVRM.blendShapeProxy.setValue(name, v); return; } catch { /* try next */ }
    }
  }
}

/** Blend shape API used by expression.js — set a named expression weight. */
export function setExpressionValue(vrm, key, value) {
  if (!vrm) return;
  if (vrm.expressionManager) {
    vrm.expressionManager.setValue(key, value);
  } else if (vrm.blendShapeProxy) {
    vrm.blendShapeProxy.setValue(key, value);
  }
}

/** Blend shape API used by expression.js — get current weight. */
export function getExpressionValue(vrm, key) {
  if (!vrm) return 0;
  if (vrm.expressionManager) {
    return vrm.expressionManager.getValue(key) ?? 0;
  }
  if (vrm.blendShapeProxy) {
    return vrm.blendShapeProxy.getValue(key) ?? 0;
  }
  return 0;
}

/** Get all blend shape / expression names. */
export function getExpressionNames(vrm) {
  if (!vrm) return [];
  if (vrm.expressionManager?.getExpressionNames) {
    return vrm.expressionManager.getExpressionNames();
  }
  if (vrm.blendShapeProxy?.getExpressions) {
    return vrm.blendShapeProxy.getExpressions().map(e => typeof e === 'string' ? e : e.name);
  }
  return [];
}

/** Check if the VRM has any expression/blend-shape system. */
export function hasExpressions(vrm) {
  if (!vrm) return false;
  return !!(vrm.expressionManager || vrm.blendShapeProxy);
}

function randomBlinkInterval() {
  return 3000 + Math.random() * 4000; // 3–7 seconds
}

/* ── Helpers ──────────────────────────────────────────── */

function resize() {
  if (!renderer) return;
  const parent = renderer.domElement.parentElement;
  if (!parent) return;
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  if (camera) {
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }
}

/** Update scene background color. */
export function setBackgroundColor(color) {
  if (scene) scene.background = new THREE.Color(color);
}
