/**
 * vrm-scene.js — THREE.js scene with VRM character rendering.
 *
 *   initScene(canvas)      → set up renderer
 *   loadVRM(buffer, name)  → load .vrm from ArrayBuffer
 *   getVRM()               → current VRM instance
 *   dispose()              → clean up
 *
 * Supports VRM 0.x and 1.0.  Rest-pose approach adapted from AniCompanion.
 * Uses CDN imports: three.js + @pixiv/three-vrm
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  VRMLoaderPlugin,
  VRMUtils,
  VRMHumanBoneName,
  VRMExpressionPresetName,
} from '@pixiv/three-vrm/lib/three-vrm.module.js';
import { sampleClip } from './animation.js';

let renderer, scene, camera, clock;
let currentVRM = null;
let animationFrameId = null;

/* Rest-pose rotations (applied once after load; vrm.update() won't reset them) */
export const restPoseRotations = {};

/* Idle state */
let idleStartTime = 0;
const _idleVec3X = new THREE.Vector3(1, 0, 0);
const _idleVec3Y = new THREE.Vector3(0, 1, 0);
const _idleQuatX = new THREE.Quaternion();
const _idleQuatY = new THREE.Quaternion();
let lastBlinkTime = 0;
let nextBlinkInterval = randomBlinkInterval();
let blinkPhase = 'idle';
let blinkStart = 0;

/* ── Init ─────────────────────────────────────────────── */

export function initScene(canvas, bgColor = '#1a1a2e') {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.6;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(bgColor);

  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 1.2, 5.0);
  camera.lookAt(0, 0.9, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(0, 2, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xe0e0e0, 0.35);
  rim.position.set(0, 1.5, -2);
  scene.add(rim);

  clock = new THREE.Clock();
  resize();
  window.addEventListener('resize', resize);
  animate();

  return { scene, camera, renderer };
}

/* ── VRM Loading ──────────────────────────────────────── */

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

    const specVersion = vrm.meta?.specVersion || '0.0';

    // ── Critical: rotate VRM 0.x to standard orientation + set up bone mapping ──
    if (specVersion === '0.0') {
      VRMUtils.rotateVRM0(vrm);
    }

    // VRMUtils optimizations (safe for VRM 1.0)
    if (specVersion === '1.0') {
      try {
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);
      } catch { /* non-critical */ }
    }

    scene.add(vrm.scene);
    currentVRM = vrm;

    // ── Apply rest pose: arms down from T-pose ──
    applyRestPose(vrm, specVersion);

    idleStartTime = performance.now() / 1000;
    lastBlinkTime = idleStartTime;
    nextBlinkInterval = randomBlinkInterval();
    blinkPhase = 'idle';

    return vrm;
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Apply A-pose from T-pose. Called once after load.
 * Rotations are NOT reset by vrm.update() — they stick for the lifetime of the model.
 */
function applyRestPose(vrm, specVersion) {
  const isVRM1 = specVersion === '1.0';
  // VRM 0.x (after rotateVRM0): Z-axis lowers arms from T-pose
  // VRM 1.0 (normalized bones): X-axis lowers arms from T-pose
  const axis = isVRM1
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 0, 1);
  const armAngle = 60.0 * Math.PI / 180.0;
  const forearmAngle = 5.0 * Math.PI / 180.0;

  // VRM 1.0: negate angle on left arm (X-axis rotation direction differs)
  const leftSign = isVRM1 ? -1 : 1;
  const rightSign = isVRM1 ? 1 : -1;

  const poses = [
    [VRMHumanBoneName.LeftUpperArm,  new THREE.Quaternion().setFromAxisAngle(axis, leftSign * armAngle)],
    [VRMHumanBoneName.RightUpperArm, new THREE.Quaternion().setFromAxisAngle(axis, rightSign * armAngle)],
    [VRMHumanBoneName.LeftLowerArm,  new THREE.Quaternion().setFromAxisAngle(axis, forearmAngle)],
    [VRMHumanBoneName.RightLowerArm, new THREE.Quaternion().setFromAxisAngle(axis, -forearmAngle)],
  ];

  for (const [boneName, quat] of poses) {
    const node = vrm.humanoid?.getNormalizedBoneNode?.(boneName);
    if (node) {
      node.quaternion.copy(quat);
      console.log("[vrm-scene] rest pose:", boneName, "→ OK");
      restPoseRotations[boneName] = quat.clone();
    } else {
      console.warn("[vrm-scene] rest pose:", boneName, "→ bone NOT found");
    }
  }

  console.log('[vrm-scene] VRM loaded:', vrm.meta?.name || '?',
    '| specVersion:', specVersion,
    '| rest pose applied:', Object.keys(restPoseRotations).length > 0);

  // Debug: only expose on localhost
  if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
    window.__vrm = vrm;
  }
}

export function getVRM() {
  return currentVRM;
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

  const delta = Math.min(clock.getDelta(), 0.1);
  const now = performance.now() / 1000;

  if (currentVRM) {
    // Sample skeletal animation (if playing) — returns Set of bone names being driven
    const animatedBones = sampleClip(now, currentVRM, restPoseRotations);

    // Idle animations (skip bones controlled by the active clip)
    updateIdle(now, animatedBones);

    currentVRM.update(delta);
  }

  renderer.render(scene, camera);
}

/* ── Idle Animations ──────────────────────────────────── */

/**
 * @param {number} now           — performance.now() / 1000
 * @param {Set<string>|null} animatedBones — bones being driven by animation clip
 */
function updateIdle(now, animatedBones) {
  if (!currentVRM) return;

  // Breathing — skip if spine is being animated
  if (!animatedBones || !animatedBones.has('spine')) {
    const breathPeriod = 3.5;
    const breathPhase = ((now - idleStartTime) / breathPeriod) * 2.0 * Math.PI;
    const breathValue = (Math.sin(breathPhase) + 1.0) / 2.0;
    const spineNode = currentVRM.humanoid?.getNormalizedBoneNode?.(VRMHumanBoneName.Spine);
    if (spineNode) {
      spineNode.quaternion.setFromAxisAngle(
        _idleVec3X, breathValue * 0.012
      );
    }
  }

  // Head sway — skip if head is being animated
  if (!animatedBones || !animatedBones.has('head')) {
    const swayX = Math.sin((now - idleStartTime) / 8.0 * 2.0 * Math.PI) * 0.03;
    const swayY = Math.cos((now - idleStartTime) / 10.0 * 2.0 * Math.PI) * 0.02;
    const headNode = currentVRM.humanoid?.getNormalizedBoneNode?.(VRMHumanBoneName.Head);
    if (headNode) {
      const qy = _idleQuatX.setFromAxisAngle(_idleVec3Y, swayX);
      const qx = _idleQuatY.setFromAxisAngle(_idleVec3X, swayY);
      headNode.quaternion.multiplyQuaternions(qx, qy);
    }
  }

  // Blink — always runs (expression, never in conflict with skeletal anim)
  applyBlink(now);
}

function applyBlink(now) {
  if (!currentVRM?.expressionManager) return;

  const BLINK_DURATION = 0.15;

  if (blinkPhase === 'idle') {
    if (now - lastBlinkTime > nextBlinkInterval) {
      blinkPhase = 'closing';
      blinkStart = now;
    }
  } else {
    const elapsed = now - blinkStart;
    if (elapsed >= BLINK_DURATION) {
      currentVRM.expressionManager.setValue(VRMExpressionPresetName.Blink, 0);
      blinkPhase = 'idle';
      lastBlinkTime = now;
      nextBlinkInterval = randomBlinkInterval();
    } else {
      const half = BLINK_DURATION / 2;
      const w = elapsed < half ? elapsed / half : 1.0 - (elapsed - half) / half;
      currentVRM.expressionManager.setValue(VRMExpressionPresetName.Blink, w);
    }
  }
}

function randomBlinkInterval() {
  return 3.0 + Math.random() * 2.0; // 3–5 seconds
}

/* ── Expression helpers for expression.js ─────────────── */

export function setExpressionValue(vrm, key, value) {
  if (!vrm?.expressionManager) return;
  vrm.expressionManager.setValue(key, value);
}

export function getExpressionValue(vrm, key) {
  return vrm?.expressionManager?.getValue(key) ?? 0;
}

export function getExpressionNames(vrm) {
  return vrm?.expressionManager?.getExpressionNames?.() ?? [];
}

export function hasExpressions(vrm) {
  return !!vrm?.expressionManager;
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

export function setBackgroundColor(color) {
  if (scene) scene.background = new THREE.Color(color);
}
