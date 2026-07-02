/**
 * vrm-scene.js — THREE.js scene with VRM character rendering.
 *
 *   initScene(canvas)      → set up renderer
 *   loadVRM(buffer, name)  → load .vrm from ArrayBuffer
 *   getVRM()               → current VRM instance
 *   dispose()              → clean up
 *
 * Uses CDN imports: three.js + @pixiv/three-vrm
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm/lib/three-vrm.module.js';

let renderer, scene, camera, clock;
let currentVRM = null;
let animationFrameId = null;

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
  // Dispose previous
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

    // VRMUtils optimizations are optional — skip for VRM 0.x models
    // that may not have standard spring-bone/joint layouts
    try {
      if (vrm.meta?.specVersion === '1.0') {
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);
      }
    } catch { /* non-critical */ }

    scene.add(vrm.scene);
    currentVRM = vrm;
    lastBlinkTime = performance.now();
    nextBlinkInterval = randomBlinkInterval();
    blinkPhase = 'idle';

    return vrm;
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/** Get the current VRM instance (or null). */
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

  const delta = Math.min(clock.getDelta(), 0.1); // cap to avoid spiral
  const now = performance.now();

  if (currentVRM) {
    updateIdle(delta, now);
    currentVRM.update(delta);
  }

  renderer.render(scene, camera);
}

/* ── Idle Animations ──────────────────────────────────── */

function updateIdle(delta, now) {
  // Breathing — subtle Y oscillation via humanoid bone
  applyBreathing(now);

  // Blinking
  applyBlink(now);
}

function applyBreathing(now) {
  if (!currentVRM) return;
  const cycle = 3.5; // seconds per breath cycle
  const amplitude = 0.008; // ~8mm, visible but subtle
  const offset = Math.sin((now * 0.001 * Math.PI * 2) / cycle) * amplitude;

  // Try spine bone first, fall back to model root
  let moved = false;
  try {
    const bones = ['spine', 'chest', 'upperChest'];
    for (const name of bones) {
      const bone = currentVRM.humanoid?.getNormalizedBoneNode?.(name);
      if (bone) { bone.position.y += offset; moved = true; break; }
    }
  } catch { /* bone access may fail */ }

  // Fallback: oscillate entire model
  if (!moved && currentVRM.scene) {
    currentVRM.scene.position.y += offset * 5;
  }
}

function applyBlink(now) {
  if (!currentVRM?.expressionManager) return;

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
  const names = ['blink', 'Blink', 'blinkL', 'blinkR'];
  for (const name of names) {
    try { currentVRM.expressionManager.setValue(name, v); return; } catch { /* try next */ }
  }
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
