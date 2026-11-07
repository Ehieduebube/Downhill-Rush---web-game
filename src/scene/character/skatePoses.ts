import { AnimationClip, AnimationUtils, Group, Object3D, Quaternion, Vector3 } from 'three';
import { B, bakeTracks, Humanoid } from './humanoid';

/**
 * Skateboard stance definition and authored skating clips.
 *
 * Poses are described anatomically (pelvis drop / shift, hip tilt, spine flex & twist,
 * neck, per-arm raise / swing / elbow) in the rider's own frame, applied to the real
 * skeleton with world-space rotations, legs solved with IK onto the deck, then baked
 * into keyframe tracks so they play through THREE.AnimationMixer.
 */

// ---------------------------------------------------------------- stance (board space: forward -Z, up +Y)
export const DECK_TOP = 0.128;
export const CHARACTER_SCALE = 0.93;
/** Hips face 65 degrees right of the travel direction (regular stance: left foot forward). */
export const STANCE_OPEN = (65 * Math.PI) / 180;
export const CHARACTER_YAW = Math.PI - STANCE_OPEN;
/** Deck spots under the centre of each sneaker. */
export const FOOT_SPOT = { l: new Vector3(0.0, DECK_TOP, -0.2), r: new Vector3(0.012, DECK_TOP, 0.225) };
/** Extra foot yaw relative to the hips (+ turns toward the nose). */
export const FOOT_YAW = { l: 0.32, r: -0.28 };

export interface ArmPose {
  raise: number; // radians above horizontal (negative lowers the arm)
  fwd: number; // horizontal swing toward the chest side
  flex?: number; // forward flexion about the shoulder axis (for hanging arms)
  elbow: number;
  wrist?: number;
  shrug?: number;
}

export interface Pose {
  drop: number; // pelvis drop below standing height (m)
  shiftX?: number; // pelvis shift toward the rider's left (m)
  shiftZ?: number; // pelvis shift toward the rider's chest (m)
  hipPitch: number;
  hipYaw?: number;
  hipRoll?: number;
  flex: number; // total spine flexion (forward +)
  twist: number; // total spine twist toward the rider's left = toward the nose (+)
  side?: number;
  neckFlex: number;
  neckTwist: number;
  armL: ArmPose;
  armR: ArmPose;
  fingers: number;
  feetLift?: number; // lift both feet off the deck (tricks)
}

export const RIDE: Pose = {
  drop: 0.17,
  shiftZ: 0.02,
  hipPitch: 0.22,
  flex: 0.18,
  twist: 0.68,
  side: 0.02,
  neckFlex: -0.32,
  neckTwist: 0.36,
  armL: { raise: -0.36, fwd: 0.1, elbow: 0.4, wrist: 0.1 },
  armR: { raise: -0.56, fwd: -0.04, elbow: 0.32, wrist: 0.1 },
  fingers: 0.32,
};

const mix = (a: Pose, b: Pose, t: number): Pose => {
  const l = (x = 0, y = 0) => x + (y - x) * t;
  const arm = (p: ArmPose, q: ArmPose): ArmPose => ({
    raise: l(p.raise, q.raise),
    fwd: l(p.fwd, q.fwd),
    flex: l(p.flex, q.flex),
    elbow: l(p.elbow, q.elbow),
    wrist: l(p.wrist, q.wrist),
    shrug: l(p.shrug, q.shrug),
  });
  return {
    drop: l(a.drop, b.drop),
    shiftX: l(a.shiftX, b.shiftX),
    shiftZ: l(a.shiftZ, b.shiftZ),
    hipPitch: l(a.hipPitch, b.hipPitch),
    hipYaw: l(a.hipYaw, b.hipYaw),
    hipRoll: l(a.hipRoll, b.hipRoll),
    flex: l(a.flex, b.flex),
    twist: l(a.twist, b.twist),
    side: l(a.side, b.side),
    neckFlex: l(a.neckFlex, b.neckFlex),
    neckTwist: l(a.neckTwist, b.neckTwist),
    armL: arm(a.armL, b.armL),
    armR: arm(a.armR, b.armR),
    fingers: l(a.fingers, b.fingers),
    feetLift: l(a.feetLift, b.feetLift),
  };
};
type PoseDelta = Omit<Partial<Pose>, 'armL' | 'armR'> & { armL?: Partial<ArmPose>; armR?: Partial<ArmPose> };
const tweak = (base: Pose, d: PoseDelta): Pose => ({
  ...base,
  ...d,
  armL: { ...base.armL, ...(d.armL ?? {}) },
  armR: { ...base.armR, ...(d.armR ?? {}) },
});

// Turning: right = toeside (lean over the toes, toward the chest), left = heelside.
const LEAN_TOE = tweak(RIDE, {
  drop: 0.21,
  shiftZ: 0.085,
  hipPitch: 0.32,
  flex: 0.32,
  twist: 0.6,
  side: 0.0,
  neckFlex: -0.42,
  armL: { raise: -0.2, fwd: 0.35, elbow: 0.5 },
  armR: { raise: -0.75, fwd: 0.15, elbow: 0.5 },
});
const LEAN_HEEL = tweak(RIDE, {
  drop: 0.2,
  shiftZ: -0.07,
  hipPitch: 0.06,
  flex: 0.02,
  twist: 0.76,
  side: 0.04,
  neckFlex: -0.2,
  armL: { raise: -0.15, fwd: 0.75, elbow: 0.6 },
  armR: { raise: -0.35, fwd: 0.45, elbow: 0.6 },
});
const CROUCH = tweak(RIDE, { drop: 0.33, hipPitch: 0.36, flex: 0.36, neckFlex: -0.5, armL: { raise: -0.6 }, armR: { raise: -0.8 } });
const AIR = tweak(RIDE, {
  drop: 0.31,
  hipPitch: 0.26,
  flex: 0.3,
  neckFlex: -0.42,
  armL: { raise: 0.05, fwd: 0.38, elbow: 0.55, wrist: 0.2 },
  armR: { raise: -0.1, fwd: -0.18, elbow: 0.45, wrist: 0.2 },
  fingers: 0.45,
});
const POP = tweak(RIDE, {
  drop: 0.06,
  hipPitch: 0.12,
  flex: 0.12,
  neckFlex: -0.25,
  armL: { raise: 0.2, fwd: 0.3, elbow: 0.35 },
  armR: { raise: 0.05, fwd: -0.25, elbow: 0.3 },
});
const SLIDE = tweak(RIDE, {
  drop: 0.43,
  shiftZ: -0.04,
  hipPitch: 0.42,
  flex: 0.55,
  twist: 0.6,
  side: -0.08,
  neckFlex: -0.62,
  neckTwist: 0.42,
  armL: { raise: -0.12, fwd: 0.5, elbow: 0.6 },
  armR: { raise: -1.05, fwd: 0.35, flex: 0.35, elbow: 0.15, wrist: -0.4 },
  fingers: 0.2,
});
const FLIP_MID = tweak(AIR, {
  drop: 0.36,
  flex: 0.42,
  neckFlex: -0.05,
  armL: { raise: 0.3, fwd: 0.2, elbow: 0.4 },
  armR: { raise: 0.2, fwd: -0.35, elbow: 0.4 },
  feetLift: 0.17,
});
const SPIN_TUCK = tweak(AIR, {
  drop: 0.34,
  twist: 0.2,
  armL: { raise: -0.7, fwd: 1.1, elbow: 1.7, wrist: 0.2 },
  armR: { raise: -0.75, fwd: 1.25, elbow: 1.6, wrist: 0.2 },
  fingers: 0.9,
});
const SPIN_WIND = tweak(AIR, { twist: -0.05, armL: { raise: -0.1, fwd: -0.3 }, armR: { raise: -0.2, fwd: -0.5 } });

// ---------------------------------------------------------------- posing
const _p = new Vector3();
const _u = new Vector3();
const _axis = new Vector3();

export interface StanceFrame {
  /** World axes of the rider's own frame (faces +z, left +x). */
  cx: Vector3;
  cy: Vector3;
  cz: Vector3;
  /** Spin-space -> world transform carrier (the object both board and rider hang from). */
  space: Object3D;
}

/** Applies a pose to the skeleton (no legs). The skeleton must have been reset. */
export function applyUpperPose(h: Humanoid, pose: Pose, f: StanceFrame, restPelvisY: number) {
  // fingers first (in the rest frame) so later rotations carry them along
  h.curlFingers('l', pose.fingers, _axis.copy(f.cz).negate());
  h.curlFingers('r', pose.fingers, _axis.copy(f.cz));

  // pelvis position: centred over the board between the feet, in spin space
  const s = CHARACTER_SCALE;
  _p.set(0, DECK_TOP + restPelvisY * s - pose.drop, (FOOT_SPOT.l.z + FOOT_SPOT.r.z) / 2);
  f.space.localToWorld(_p);
  _p.addScaledVector(f.cx, pose.shiftX ?? 0).addScaledVector(f.cz, pose.shiftZ ?? 0);
  h.setPelvisWorld(_p);
  h.rotateWorld(B.pelvis, f.cy, pose.hipYaw ?? 0);
  h.rotateWorld(B.pelvis, f.cx, pose.hipPitch);
  h.rotateWorld(B.pelvis, f.cz, pose.hipRoll ?? 0);

  const spine = [B.spine1, B.spine2, B.spine3];
  const w = [0.3, 0.33, 0.37];
  spine.forEach((n, i) => {
    h.rotateWorld(n, f.cy, pose.twist * w[i]);
    h.rotateWorld(n, f.cx, pose.flex * w[i]);
    h.rotateWorld(n, f.cz, (pose.side ?? 0) * w[i]);
  });
  h.rotateWorld(B.neck, f.cy, pose.neckTwist * 0.45);
  h.rotateWorld(B.neck, f.cx, pose.neckFlex * 0.5);
  h.rotateWorld(B.head, f.cy, pose.neckTwist * 0.55);
  h.rotateWorld(B.head, f.cx, pose.neckFlex * 0.5);

  for (const side of ['l', 'r'] as const) {
    const a = side === 'l' ? pose.armL : pose.armR;
    const sg = side === 'l' ? 1 : -1;
    const clav = side === 'l' ? B.clavL : B.clavR;
    const arm = side === 'l' ? B.armL : B.armR;
    const fore = side === 'l' ? B.foreL : B.foreR;
    const hand = side === 'l' ? B.handL : B.handR;
    h.rotateWorld(clav, f.cz, sg * (a.shrug ?? 0));
    h.rotateWorld(arm, f.cz, sg * a.raise);
    h.rotateWorld(arm, f.cy, -sg * a.fwd);
    h.rotateWorld(arm, f.cx, -(a.flex ?? 0));
    // elbow: bend the forearm toward the chest side
    h.worldPos(fore, _p);
    h.worldPos(hand, _u).sub(_p).normalize();
    _axis.crossVectors(_u, f.cz);
    if (_axis.lengthSq() < 1e-6) _axis.copy(f.cx);
    _axis.normalize();
    h.rotateWorld(fore, _axis, a.elbow);
    h.rotateWorld(hand, _axis, a.wrist ?? 0);
  }
}

// ---------------------------------------------------------------- legs on the board
const _target = new Vector3();
const _fwd = new Vector3();
const _pole = new Vector3();
const _qYaw = new Quaternion();
const _qBoard = new Quaternion();
const _qFoot = new Quaternion();
const UP = new Vector3(0, 1, 0);

export interface FootRest {
  l: Quaternion;
  r: Quaternion;
}

/** Foot orientations in the rest pose, expressed in spin space. */
export function captureFootRest(h: Humanoid, space: Object3D): FootRest {
  const inv = space.getWorldQuaternion(new Quaternion()).invert();
  return {
    l: h.bone(B.footL).getWorldQuaternion(new Quaternion()).premultiply(inv),
    r: h.bone(B.footR).getWorldQuaternion(new Quaternion()).premultiply(inv),
  };
}

/**
 * Plant both sneakers on the deck. `board` is the board group (its world transform defines
 * the deck); `space` is the shared parent of board and rider; `lift` raises the feet.
 * Returns the world targets used (for debugging).
 */
export function plantFeet(h: Humanoid, board: Object3D, space: Object3D, footRest: FootRest, f: StanceFrame, lift = 0) {
  board.getWorldQuaternion(_qBoard);
  for (const side of ['l', 'r'] as const) {
    // foot direction in board plane
    _qYaw.setFromAxisAngle(UP, FOOT_YAW[side]);
    _fwd.copy(f.cz).applyQuaternion(space.getWorldQuaternion(_qFoot).invert()); // facing in spin space
    _fwd.y = 0;
    _fwd.normalize().applyQuaternion(_qYaw).applyQuaternion(_qBoard);
    // ankle sits ~8 cm behind the centre of the sole and ankleHeight above the deck
    _target.copy(FOOT_SPOT[side]);
    board.localToWorld(_target);
    _p.set(0, 1, 0).applyQuaternion(_qBoard);
    _target
      .addScaledVector(_p, h.ankleHeight * CHARACTER_SCALE + lift)
      .addScaledVector(_fwd, -0.075 * CHARACTER_SCALE);
    // knees point over the toes, the front knee slightly toward the nose
    _pole.copy(f.cz).multiplyScalar(1);
    _u.set(0, 0, -1).applyQuaternion(space.getWorldQuaternion(_qFoot));
    _pole.addScaledVector(_u, side === 'l' ? 0.45 : -0.1).normalize();
    h.solveLeg(side, _target, _pole);
    // flat on the deck, yawed
    _qFoot.copy(_qBoard).multiply(_qYaw).multiply(side === 'l' ? footRest.l : footRest.r);
    h.setWorldQuaternion(side === 'l' ? B.footL : B.footR, _qFoot);
  }
}

// ---------------------------------------------------------------- clip authoring
export interface SkateClips {
  ride: AnimationClip;
  air: AnimationClip;
  slide: AnimationClip;
  ollie: AnimationClip;
  kickflip: AnimationClip;
  spin: AnimationClip;
  leanToe: AnimationClip;
  leanHeel: AnimationClip;
  crouch: AnimationClip;
}

/**
 * Builds the authored skate clips for a humanoid placed in a stance frame. The rider
 * must be parented exactly as at runtime: space -> character group (yaw, scale) -> model.
 */
export function authorSkateClips(h: Humanoid, f: StanceFrame, board: Group): { clips: SkateClips; footRest: FootRest } {
  h.resetPose();
  const footRest = captureFootRest(h, f.space);
  const restPelvisY = h.pelvisHeight;

  const bake = (name: string, keys: { t: number; pose: Pose }[]) => {
    const frames = keys.map(({ pose }) => {
      h.resetPose();
      applyUpperPose(h, pose, f, restPelvisY);
      plantFeet(h, board, f.space, footRest, f, pose.feetLift ?? 0);
      return h.snapshot();
    });
    return new AnimationClip(name, keys[keys.length - 1].t, bakeTracks(keys.map((k) => k.t), frames, h));
  };

  // riding loop: breathing, balance sway, arms drifting
  const rideKeys = [];
  const T = 2.4;
  for (let i = 0; i <= 8; i++) {
    const t = (i / 8) * T;
    const ph = (i / 8) * Math.PI * 2;
    rideKeys.push({
      t,
      pose: tweak(RIDE, {
        drop: RIDE.drop + 0.008 * Math.sin(ph * 2),
        side: (RIDE.side ?? 0) + 0.025 * Math.sin(ph + 0.6),
        twist: RIDE.twist + 0.03 * Math.sin(ph),
        neckTwist: RIDE.neckTwist - 0.025 * Math.sin(ph),
        armL: { raise: RIDE.armL.raise + 0.05 * Math.sin(ph + 0.4), fwd: RIDE.armL.fwd + 0.04 * Math.sin(ph * 2), elbow: RIDE.armL.elbow + 0.05 * Math.sin(ph) },
        armR: { raise: RIDE.armR.raise + 0.06 * Math.sin(ph + 2.1), fwd: RIDE.armR.fwd + 0.04 * Math.sin(ph + 1), elbow: RIDE.armR.elbow + 0.05 * Math.sin(ph + 1.3) },
      }),
    });
  }
  const ride = bake('Ride', rideKeys);
  const air = bake('Air', [
    { t: 0, pose: AIR },
    { t: 0.5, pose: tweak(AIR, { armL: { raise: AIR.armL.raise + 0.06 }, armR: { raise: AIR.armR.raise + 0.05 } }) },
    { t: 1, pose: AIR },
  ]);
  const slide = bake('Slide', [
    { t: 0, pose: SLIDE },
    { t: 0.4, pose: tweak(SLIDE, { drop: SLIDE.drop + 0.01, armL: { raise: SLIDE.armL.raise + 0.08 } }) },
    { t: 0.8, pose: SLIDE },
  ]);
  // ollie: crouch (load) -> pop (extend) -> tuck
  const ollie = bake('Ollie', [
    { t: 0, pose: CROUCH },
    { t: 0.07, pose: POP },
    { t: 0.24, pose: AIR },
  ]);
  const kickflip = bake('Kickflip', [
    { t: 0, pose: AIR },
    { t: 0.25, pose: FLIP_MID },
    { t: 0.5, pose: FLIP_MID },
    { t: 0.75, pose: mix(FLIP_MID, AIR, 0.6) },
    { t: 1, pose: AIR },
  ]);
  const spin = bake('Spin360', [
    { t: 0, pose: SPIN_WIND },
    { t: 0.22, pose: SPIN_TUCK },
    { t: 0.7, pose: SPIN_TUCK },
    { t: 1, pose: AIR },
  ]);
  // additive layers, relative to the first frame of the riding loop
  const additive = (name: string, pose: Pose) => {
    const c = bake(name, [
      { t: 0, pose },
      { t: 1, pose },
    ]);
    return AnimationUtils.makeClipAdditive(c, 0, ride, 30);
  };
  const leanToe = additive('LeanToe', LEAN_TOE);
  const leanHeel = additive('LeanHeel', LEAN_HEEL);
  const crouch = additive('Crouch', CROUCH);
  h.resetPose();
  return { clips: { ride, air, slide, ollie, kickflip, spin, leanToe, leanHeel, crouch }, footRest };
}

