import { Bone, Object3D, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';

/** Bone names of the Quaternius Universal Base Characters rig (Unreal-style naming). */
export const B = {
  pelvis: 'pelvis',
  spine1: 'spine_01',
  spine2: 'spine_02',
  spine3: 'spine_03',
  neck: 'neck_01',
  head: 'Head',
  clavL: 'clavicle_l',
  armL: 'upperarm_l',
  foreL: 'lowerarm_l',
  handL: 'hand_l',
  clavR: 'clavicle_r',
  armR: 'upperarm_r',
  foreR: 'lowerarm_r',
  handR: 'hand_r',
  thighL: 'thigh_l',
  calfL: 'calf_l',
  footL: 'foot_l',
  ballL: 'ball_l',
  thighR: 'thigh_r',
  calfR: 'calf_r',
  footR: 'foot_r',
  ballR: 'ball_r',
} as const;

export const LEG_BONES: string[] = [B.thighL, B.calfL, B.footL, B.thighR, B.calfR, B.footR];

const FINGERS = ['index', 'middle', 'ring', 'pinky'];

const _q = new Quaternion();
const _q2 = new Quaternion();
const _v = new Vector3();
const _v2 = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _dir = new Vector3();
const _bend = new Vector3();
const _knee = new Vector3();
const _end = new Vector3();

/** Thin wrapper around a skinned humanoid skeleton with world-space posing helpers. */
export class Humanoid {
  readonly bones = new Map<string, Bone>();
  readonly restQ = new Map<string, Quaternion>();
  readonly restP = new Map<string, Vector3>();
  readonly thighLen: number;
  readonly calfLen: number;
  /** Ankle height above the sneaker sole in the bind pose (model units). */
  readonly ankleHeight: number;
  /** Pelvis height above the sneaker sole in the bind pose (model units). */
  readonly pelvisHeight: number;

  constructor(readonly root: Object3D) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if ((o as Bone).isBone) {
        this.bones.set(o.name, o as Bone);
        this.restQ.set(o.name, o.quaternion.clone());
        this.restP.set(o.name, o.position.clone());
      }
    });
    for (const n of Object.values(B)) if (!this.bones.has(n)) throw new Error(`Skeleton is missing bone "${n}"`);
    const p = (n: string) => this.bone(n).getWorldPosition(new Vector3());
    const s = root.getWorldScale(new Vector3()).y || 1;
    this.thighLen = p(B.thighL).distanceTo(p(B.calfL)) / s;
    this.calfLen = p(B.calfL).distanceTo(p(B.footL)) / s;
    // heights measured in the model's own (unscaled) frame, independent of the rig's tilt
    const local = (n: string) => root.worldToLocal(p(n));
    this.ankleHeight = local(B.footL).y + 0.014; // sole sits 1.4 cm below the bind-pose ground
    this.pelvisHeight = local(B.pelvis).y + 0.014;
  }

  bone(name: string): Bone {
    const b = this.bones.get(name);
    if (!b) throw new Error(`bone ${name}`);
    return b;
  }

  resetPose() {
    for (const [n, b] of this.bones) {
      b.quaternion.copy(this.restQ.get(n)!);
      b.position.copy(this.restP.get(n)!);
    }
    this.root.updateMatrixWorld(true);
  }

  /** Rotate a bone by `angle` around a world-space axis (keeps children attached). */
  rotateWorld(name: string, axis: Vector3, angle: number) {
    if (Math.abs(angle) < 1e-6) return;
    const bone = this.bone(name);
    const parent = bone.parent!;
    parent.updateWorldMatrix(true, false);
    bone.updateMatrixWorld(true);
    bone.getWorldQuaternion(_q);
    _q2.setFromAxisAngle(axis, angle).multiply(_q);
    parent.getWorldQuaternion(_q).invert();
    bone.quaternion.copy(_q.multiply(_q2));
    bone.updateMatrixWorld(true);
  }

  /** Rotate a bone so that its world-space direction `from` turns into `to`. */
  rotateFromTo(name: string, from: Vector3, to: Vector3) {
    const bone = this.bone(name);
    const parent = bone.parent!;
    bone.getWorldQuaternion(_q);
    _q2.setFromUnitVectors(_v.copy(from).normalize(), _v2.copy(to).normalize()).multiply(_q);
    parent.getWorldQuaternion(_q).invert();
    bone.quaternion.copy(_q.multiply(_q2));
    bone.updateMatrixWorld(true);
  }

  /** Set a bone's world orientation. */
  setWorldQuaternion(name: string, q: Quaternion) {
    const bone = this.bone(name);
    bone.parent!.getWorldQuaternion(_q).invert();
    bone.quaternion.copy(_q.multiply(q));
    bone.updateMatrixWorld(true);
  }

  /** Move the pelvis to a world-space position. */
  setPelvisWorld(p: Vector3) {
    const pelvis = this.bone(B.pelvis);
    pelvis.parent!.updateWorldMatrix(true, false);
    pelvis.position.copy(pelvis.parent!.worldToLocal(_v.copy(p)));
    pelvis.updateMatrixWorld(true);
  }

  worldPos(name: string, out: Vector3) {
    return this.bone(name).getWorldPosition(out);
  }

  /**
   * Analytic two-bone IK in world space: places the ankle at `target`, bending the knee
   * toward `poleDir`. Returns false when the target is out of reach (leg fully extended).
   */
  solveLeg(side: 'l' | 'r', target: Vector3, poleDir: Vector3): boolean {
    const thigh = side === 'l' ? B.thighL : B.thighR;
    const calf = side === 'l' ? B.calfL : B.calfR;
    const foot = side === 'l' ? B.footL : B.footR;
    const scale = this.root.getWorldScale(_v).y || 1;
    const l1 = this.thighLen * scale;
    const l2 = this.calfLen * scale;
    this.worldPos(thigh, _a);
    _dir.subVectors(target, _a);
    const raw = _dir.length();
    const d = Math.min(Math.max(raw, 0.05 * scale), (l1 + l2) * 0.999);
    _dir.normalize();
    const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(l1 * l1 - x * x, 0));
    _bend.copy(poleDir).addScaledVector(_dir, -poleDir.dot(_dir));
    if (_bend.lengthSq() < 1e-8) _bend.set(0, 0, 1);
    _bend.normalize();
    _knee.copy(_a).addScaledVector(_dir, x).addScaledVector(_bend, h);
    _end.copy(_a).addScaledVector(_dir, d);
    this.worldPos(calf, _b);
    this.rotateFromTo(thigh, _v2.subVectors(_b, _a), _c.subVectors(_knee, _a));
    this.worldPos(calf, _b);
    this.worldPos(foot, _c);
    this.rotateFromTo(calf, _v2.subVectors(_c, _b), _dir.subVectors(_end, _b));
    return raw <= (l1 + l2) * 0.999;
  }

  /** Curl all fingers (radians per joint) and the thumb. */
  curlFingers(side: 'l' | 'r', curl: number, axis: Vector3) {
    for (const f of FINGERS) {
      for (let k = 1; k <= 3; k++) this.rotateWorld(`${f}_0${k}_${side}`, axis, curl * (k === 1 ? 0.7 : 1));
    }
    this.rotateWorld(`thumb_02_${side}`, axis, curl * 0.4);
  }

  /** Snapshot local transforms of all bones. */
  snapshot(): Map<string, Quaternion> {
    const m = new Map<string, Quaternion>();
    for (const [n, b] of this.bones) m.set(n, b.quaternion.clone());
    m.set('__pelvisPos', new Quaternion(...this.bone(B.pelvis).position.toArray(), 0));
    return m;
  }
}

/** Bake a sequence of pose snapshots into keyframe tracks. */
export function bakeTracks(times: number[], frames: Map<string, Quaternion>[], h: Humanoid) {
  const tracks = [];
  for (const name of h.bones.keys()) {
    const values: number[] = [];
    let animated = false;
    const rest = h.restQ.get(name)!;
    for (const f of frames) {
      const q = f.get(name)!;
      values.push(q.x, q.y, q.z, q.w);
      if (Math.abs(q.dot(rest)) < 0.99999) animated = true;
    }
    if (!animated && !LEG_BONES.includes(name)) continue;
    // keep quaternion signs continuous so interpolation takes the short path
    for (let i = 4; i < values.length; i += 4) {
      const dot = values[i] * values[i - 4] + values[i + 1] * values[i - 3] + values[i + 2] * values[i - 2] + values[i + 3] * values[i - 1];
      if (dot < 0) for (let c = 0; c < 4; c++) values[i + c] *= -1;
    }
    tracks.push(new QuaternionKeyframeTrack(`${name}.quaternion`, times, values));
  }
  const pos: number[] = [];
  for (const f of frames) {
    const p = f.get('__pelvisPos')!;
    pos.push(p.x, p.y, p.z);
  }
  tracks.push(new VectorKeyframeTrack(`${B.pelvis}.position`, times, pos));
  return tracks;
}
