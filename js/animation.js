/**
 * animation.js — Skeletal keyframe animation playback engine.
 *
 * Ported from catsmice/AniCompanion (MIT).
 * Plays JSON keyframe clips (retargeted from Adobe Mixamo) on VRM skeletons.
 *
 *   loadClips()               → preload all JSON clips from animations/
 *   playClip(vrm, name)       → start a clip with blend-in
 *   stopClip(vrm, restPose)   → stop and restore rest pose
 *   sampleClip(now, vrm, rp)  → per-frame sampler (call in render loop)
 *   isPlaying()               → query playback state
 *
 * Clip format: { name, fps, duration, loop, frames: [{time, bones: {name: [x,y,z,w]}}] }
 */
import * as THREE from 'three';
import { VRMHumanBoneName } from '@pixiv/three-vrm/lib/three-vrm.module.js';

/* ── Bone name mapping: JSON string keys → three-vrm enum ── */
export const BONE_NAME_MAP = {
  'hips':                    VRMHumanBoneName.Hips,
  'spine':                   VRMHumanBoneName.Spine,
  'chest':                   VRMHumanBoneName.Chest,
  'upperChest':              VRMHumanBoneName.UpperChest,
  'neck':                    VRMHumanBoneName.Neck,
  'head':                    VRMHumanBoneName.Head,
  'leftShoulder':            VRMHumanBoneName.LeftShoulder,
  'leftUpperArm':            VRMHumanBoneName.LeftUpperArm,
  'leftLowerArm':            VRMHumanBoneName.LeftLowerArm,
  'leftHand':                VRMHumanBoneName.LeftHand,
  'rightShoulder':           VRMHumanBoneName.RightShoulder,
  'rightUpperArm':           VRMHumanBoneName.RightUpperArm,
  'rightLowerArm':           VRMHumanBoneName.RightLowerArm,
  'rightHand':               VRMHumanBoneName.RightHand,
  'leftUpperLeg':            VRMHumanBoneName.LeftUpperLeg,
  'leftLowerLeg':            VRMHumanBoneName.LeftLowerLeg,
  'leftFoot':                VRMHumanBoneName.LeftFoot,
  'leftToes':                VRMHumanBoneName.LeftToes,
  'rightUpperLeg':           VRMHumanBoneName.RightUpperLeg,
  'rightLowerLeg':           VRMHumanBoneName.RightLowerLeg,
  'rightFoot':               VRMHumanBoneName.RightFoot,
  'rightToes':               VRMHumanBoneName.RightToes,
  'leftEye':                 VRMHumanBoneName.LeftEye,
  'rightEye':                VRMHumanBoneName.RightEye,
  'jaw':                     VRMHumanBoneName.Jaw,
  'leftThumbMetacarpal':     VRMHumanBoneName.LeftThumbMetacarpal,
  'leftThumbProximal':        VRMHumanBoneName.LeftThumbProximal,
  'leftIndexProximal':       VRMHumanBoneName.LeftIndexProximal,
  'leftIndexIntermediate':   VRMHumanBoneName.LeftIndexIntermediate,
  'leftIndexDistal':         VRMHumanBoneName.LeftIndexDistal,
  'leftMiddleProximal':      VRMHumanBoneName.LeftMiddleProximal,
  'leftMiddleIntermediate':  VRMHumanBoneName.LeftMiddleIntermediate,
  'leftMiddleDistal':        VRMHumanBoneName.LeftMiddleDistal,
  'leftRingProximal':        VRMHumanBoneName.LeftRingProximal,
  'leftRingIntermediate':    VRMHumanBoneName.LeftRingIntermediate,
  'leftRingDistal':          VRMHumanBoneName.LeftRingDistal,
  'leftLittleProximal':      VRMHumanBoneName.LeftLittleProximal,
  'leftLittleIntermediate':  VRMHumanBoneName.LeftLittleIntermediate,
  'leftLittleDistal':        VRMHumanBoneName.LeftLittleDistal,
  'rightThumbMetacarpal':    VRMHumanBoneName.RightThumbMetacarpal,
  'rightThumbProximal':       VRMHumanBoneName.RightThumbProximal,
  'rightIndexProximal':      VRMHumanBoneName.RightIndexProximal,
  'rightIndexIntermediate':  VRMHumanBoneName.RightIndexIntermediate,
  'rightIndexDistal':        VRMHumanBoneName.RightIndexDistal,
  'rightMiddleProximal':     VRMHumanBoneName.RightMiddleProximal,
  'rightMiddleIntermediate': VRMHumanBoneName.RightMiddleIntermediate,
  'rightMiddleDistal':       VRMHumanBoneName.RightMiddleDistal,
  'rightRingProximal':       VRMHumanBoneName.RightRingProximal,
  'rightRingIntermediate':   VRMHumanBoneName.RightRingIntermediate,
  'rightRingDistal':         VRMHumanBoneName.RightRingDistal,
  'rightLittleProximal':     VRMHumanBoneName.RightLittleProximal,
  'rightLittleIntermediate': VRMHumanBoneName.RightLittleIntermediate,
  'rightLittleDistal':       VRMHumanBoneName.RightLittleDistal,
};

/* ── Module state ─────────────────────────────────────── */
const clips = new Map();       // name → parsed clip

let animClip = null;
let animStartTime = 0;
let animIsPlaying = false;
let animBlendFromPose = {};    // boneName → Quaternion (captured at play start)
let animBoneNames = new Set(); // all bone names in current clip
const ANIM_BLEND_IN = 0.25;

/* ── Clip loading ─────────────────────────────────────── */

/**
 * Preload all animation clips from animations/ directory.
 * Call once during init.
 */
export async function loadClips() {
  const names = ['idle', 'nod', 'wave', 'talk_gesture', 'think'];
  let loaded = 0;

  for (const name of names) {
    try {
      const resp = await fetch(`animations/${name}.json`);
      if (!resp.ok) {
        console.warn(`[animation] ${name}.json HTTP ${resp.status}`);
        continue;
      }
      const clip = await resp.json();
      clips.set(clip.name, clip);
      loaded++;
      console.log(`[animation] loaded: ${clip.name} (${clip.duration.toFixed(1)}s, ${clip.frames.length}f, loop=${clip.loop})`);
    } catch (err) {
      console.warn(`[animation] failed to load ${name}:`, err.message);
    }
  }

  console.log(`[animation] ${loaded}/${names.length} clips ready`);
  return loaded;
}

/**
 * Get a loaded clip by name.
 */
export function getClip(name) {
  return clips.get(name);
}

/* ── Playback control ─────────────────────────────────── */

/**
 * Start playing a clip. Captures current bone poses for blend-in.
 *
 * @param {object} vrm   — current VRM instance
 * @param {string} name  — clip name (must be preloaded)
 * @returns {boolean}    — true if started
 */
export function playClip(vrm, name) {
  const clip = clips.get(name);
  if (!clip || !vrm) return false;

  animClip = clip;
  animStartTime = performance.now() / 1000;
  animIsPlaying = true;

  // Capture current bone poses for blend-in
  animBlendFromPose = {};
  animBoneNames = new Set();
  for (const frame of clip.frames) {
    for (const boneName of Object.keys(frame.bones)) {
      animBoneNames.add(boneName);
    }
  }
  for (const boneName of animBoneNames) {
    const vrmBoneName = BONE_NAME_MAP[boneName];
    if (!vrmBoneName) continue;
    const node = vrm.humanoid?.getNormalizedBoneNode?.(vrmBoneName);
    if (node) {
      animBlendFromPose[boneName] = node.quaternion.clone();
    }
  }

  console.log(`[animation] play: ${name} (${clip.duration.toFixed(1)}s, loop=${clip.loop})`);
  return true;
}

/**
 * Stop the current clip and restore all animated bones to rest pose.
 *
 * @param {object} vrm              — current VRM instance
 * @param {object} restPoseRotations — { VRMHumanBoneName → Quaternion }
 */
export function stopClip(vrm, restPoseRotations) {
  if (!vrm || !animIsPlaying) return;

  for (const boneName of animBoneNames) {
    const vrmBoneName = BONE_NAME_MAP[boneName];
    if (!vrmBoneName) continue;
    const node = vrm.humanoid?.getNormalizedBoneNode?.(vrmBoneName);
    if (!node) continue;
    const rest = restPoseRotations?.[vrmBoneName];
    if (rest) node.quaternion.copy(rest);
    else node.quaternion.identity();
  }

  console.log(`[animation] stop: ${animClip?.name}`);
  animClip = null;
  animIsPlaying = false;
  animBoneNames = new Set();
}

export function isPlaying() {
  return animIsPlaying;
}

export function currentClipName() {
  return animClip?.name ?? null;
}

/* ── Per-frame sampler ────────────────────────────────── */

/**
 * Sample the current animation clip at the given time.
 * Call every frame in the render loop. Returns the set of bone names
 * being driven by the animation (so idle can skip them).
 *
 * @param {number} now   — performance.now() / 1000
 * @param {object} vrm   — current VRM instance
 * @param {object} restPoseRotations — { VRMHumanBoneName → Quaternion }
 * @returns {Set<string>|null} — animated bone names, or null if no animation
 */
export function sampleClip(now, vrm, restPoseRotations) {
  if (!animClip || !animIsPlaying || !vrm) return null;

  let elapsed = now - animStartTime;

  // Handle end of animation
  if (elapsed >= animClip.duration) {
    if (animClip.loop) {
      // Reset timer for seamless loop
      elapsed = elapsed % animClip.duration;
      animStartTime = now - elapsed;
    } else {
      // One-shot finished — restore rest pose
      for (const boneName of animBoneNames) {
        const vrmBoneName = BONE_NAME_MAP[boneName];
        if (!vrmBoneName) continue;
        const node = vrm.humanoid?.getNormalizedBoneNode?.(vrmBoneName);
        if (!node) continue;
        const rest = restPoseRotations?.[vrmBoneName];
        if (rest) node.quaternion.copy(rest);
        else node.quaternion.identity();
      }
      const clipName = animClip.name;
      animClip = null;
      animIsPlaying = false;
      animBoneNames = new Set();
      console.log(`[animation] ended: ${clipName}`);
      return null;
    }
  }

  const frames = animClip.frames;
  if (frames.length === 0) return null;

  // Binary search for keyframe at or before elapsed
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].time <= elapsed) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  const frameA = frames[lo];
  const frameB = (lo + 1 < frames.length) ? frames[lo + 1] : frameA;

  // Interpolation factor between frameA and frameB
  let t = 0;
  if (frameA.time < frameB.time) {
    t = (elapsed - frameA.time) / (frameB.time - frameA.time);
  }

  // Blend-in factor (first 0.25s)
  const blendFactor = Math.min((now - animStartTime) / ANIM_BLEND_IN, 1.0);

  // Collect all bone names from both frames
  const boneNames = new Set([...Object.keys(frameA.bones), ...Object.keys(frameB.bones)]);

  const quatA = new THREE.Quaternion();
  const quatB = new THREE.Quaternion();
  const quatResult = new THREE.Quaternion();
  const quatFrom = new THREE.Quaternion();

  for (const boneName of boneNames) {
    const vrmBoneName = BONE_NAME_MAP[boneName];
    if (!vrmBoneName) continue;

    const node = vrm.humanoid?.getNormalizedBoneNode?.(vrmBoneName);
    if (!node) continue;

    // Get keyframe quaternions [x, y, z, w]
    const aArr = frameA.bones[boneName] || [0, 0, 0, 1];
    const bArr = frameB.bones[boneName] || [0, 0, 0, 1];

    quatA.set(aArr[0], aArr[1], aArr[2], aArr[3]);
    quatB.set(bArr[0], bArr[1], bArr[2], bArr[3]);

    // Slerp between keyframes
    quatResult.slerpQuaternions(quatA, quatB, t);

    // Blend from pre-animation pose during first ANIM_BLEND_IN seconds
    if (blendFactor < 1.0 && animBlendFromPose[boneName]) {
      quatFrom.copy(animBlendFromPose[boneName]);
      quatResult.slerpQuaternions(quatFrom, quatResult, blendFactor);
    }

    node.quaternion.copy(quatResult);
  }

  return boneNames;
}
