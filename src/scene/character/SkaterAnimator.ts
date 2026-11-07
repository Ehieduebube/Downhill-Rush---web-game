import { AnimationAction, AnimationClip, AnimationMixer, LoopOnce, LoopRepeat, Quaternion, Vector3 } from 'three';
import type { BoardRig } from '../skater/boardRig';
import { LEG_BONES } from './humanoid';
import type { SkaterCharacter } from './loadSkater';
import { stanceFrame } from './loadSkater';
import { CHARACTER_YAW, plantFeet, StanceFrame } from './skatePoses';

/** Read-only view of the game state that drives the rider's animation. */
export interface RiderInput {
  grounded: boolean;
  airTime: number;
  sinceLand: number;
  landImpact: number;
  sliding: boolean;
  trick: 'none' | 'kickflip' | 'spin';
  trickProgress: number; // 0..1
  lean: number; // -1 (toeside / right) .. 1 (heelside / left)
  speedK: number; // 0..1
  crashed: boolean;
  crashT: number;
  crashKind: 'tumble' | 'fall';
  crashSide: number;
  /** 1 while crashed, 0 otherwise. */
  crashWeight: number;
}

type BaseKey = 'ride' | 'air' | 'slide' | 'ollie' | 'kickflip' | 'spin';
const BASE_KEYS: BaseKey[] = ['ride', 'air', 'slide', 'ollie', 'kickflip', 'spin'];
const SCRUBBED = new Set<BaseKey>(['ollie', 'kickflip', 'spin']);
const OLLIE_TIME = 0.24;
/** The library fall is played faster so it completes inside the game's crash window. */
const WIPEOUT_SPEED = 1.6;

class Spring {
  v = 0;
  constructor(public x = 0) {}
  update(target: number, k: number, d: number, dt: number) {
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (k * (target - this.x) - d * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const _saved = new Map<string, Quaternion>(LEG_BONES.map((n) => [n, new Quaternion()]));

/**
 * Character animation state machine. Keeps its own state (springs, blend weights) and
 * reads the game state each frame; it never writes game state.
 *
 * Layers (AnimationMixer):
 *   base      ride / air / slide / ollie / kickflip / 360  (normal blending, cross-faded)
 *   wipeout   retargeted "Death01" clip, weight = crash weight
 *   additive  lean toeside / lean heelside / landing crouch
 * Then a procedural pass plants both feet on the deck with two-bone IK.
 */
export class SkaterAnimator {
  private mixer: AnimationMixer;
  private base: Record<BaseKey, AnimationAction>;
  private weights: Record<BaseKey, number> = { ride: 1, air: 0, slide: 0, ollie: 0, kickflip: 0, spin: 0 };
  private wipe: AnimationAction;
  private toe: AnimationAction;
  private heel: AnimationAction;
  private crouch: AnimationAction;
  private leanS = new Spring();
  private absorb = new Spring();
  private lastSinceLand = 0;
  private frame: Omit<StanceFrame, 'space'> = { cx: new Vector3(), cy: new Vector3(), cz: new Vector3() };

  constructor(
    private ch: SkaterCharacter,
    private rig: BoardRig,
  ) {
    this.mixer = new AnimationMixer(ch.model);
    const play = (clip: AnimationClip, loop: boolean, weight: number) => {
      const a = this.mixer.clipAction(clip);
      a.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
      a.clampWhenFinished = true;
      a.enabled = true;
      a.setEffectiveWeight(weight);
      a.play();
      return a;
    };
    const c = ch.clips;
    this.base = {
      ride: play(c.ride, true, 1),
      air: play(c.air, true, 0),
      slide: play(c.slide, true, 0),
      ollie: play(c.ollie, false, 0),
      kickflip: play(c.kickflip, false, 0),
      spin: play(c.spin, false, 0),
    };
    for (const k of SCRUBBED) this.base[k].timeScale = 0;
    this.wipe = play(ch.wipeout, false, 0);
    this.wipe.timeScale = 0;
    this.toe = play(c.leanToe, true, 0);
    this.heel = play(c.leanHeel, true, 0);
    this.crouch = play(c.crouch, true, 0);
  }

  /** Advance the rider animation. Call after the rig transforms for this frame are set. */
  update(dt: number, s: RiderInput) {
    const cw = s.crashWeight;

    // ---- choose the base state
    let active: BaseKey = 'ride';
    if (!s.grounded && !s.crashed) {
      if (s.trick === 'kickflip') active = 'kickflip';
      else if (s.trick === 'spin') active = 'spin';
      else if (s.airTime < OLLIE_TIME) active = 'ollie';
      else active = 'air';
    } else if (s.sliding) active = 'slide';

    // ---- cross-fade weights (exponential, frame-rate independent)
    const fast = active === 'ollie' || active === 'kickflip' || active === 'spin';
    const rate = fast ? 28 : active === 'ride' ? 9 : 12;
    const k = 1 - Math.exp(-rate * dt);
    let sum = 0;
    for (const key of BASE_KEYS) {
      this.weights[key] += ((key === active ? 1 : 0) - this.weights[key]) * k;
      sum += this.weights[key];
    }
    for (const key of BASE_KEYS) this.base[key].setEffectiveWeight((this.weights[key] / (sum || 1)) * (1 - cw));
    this.wipe.setEffectiveWeight(cw);

    // ---- scrub one-shot clips in lockstep with the simulation
    this.base.ollie.time = Math.min(s.airTime, OLLIE_TIME);
    const trickTime = Math.min(Math.max(s.trickProgress, 0), 1);
    if (s.trick === 'kickflip') this.base.kickflip.time = trickTime * this.base.kickflip.getClip().duration;
    if (s.trick === 'spin') this.base.spin.time = trickTime * this.base.spin.getClip().duration;
    this.wipe.time = Math.min(s.crashT * WIPEOUT_SPEED, this.ch.wipeout.duration - 0.001);

    // ---- additive layers
    if (s.sinceLand < this.lastSinceLand) this.absorb.v += Math.min(s.landImpact * 0.13, 2.6);
    this.lastSinceLand = s.sinceLand;
    const crouch = Math.min(Math.max(this.absorb.update(0.12 * s.speedK, 150, 15, dt), 0), 1);
    const lean = this.leanS.update(s.crashed ? 0 : s.lean, 70, 14, dt);
    const ground = (1 - this.weights.air - this.weights.ollie * 0.6 - this.weights.kickflip - this.weights.spin) * (1 - cw);
    this.heel.setEffectiveWeight(Math.max(0, lean) * Math.max(ground, 0));
    this.toe.setEffectiveWeight(Math.max(0, -lean) * Math.max(ground, 0));
    this.crouch.setEffectiveWeight(crouch * (1 - this.weights.slide) * (1 - cw));

    // ---- evaluate the skeleton
    this.mixer.update(dt);

    // ---- crash: knocked around to face back down the hill, thrown forward / into the gap
    const slot = this.rig.slot;
    slot.position.set(0, 0, 0);
    slot.rotation.set(0, CHARACTER_YAW, 0);
    if (cw > 0) {
      const t = s.crashT;
      const turn = easeOut(Math.min(t / 0.35, 1));
      if (s.crashKind === 'tumble') {
        slot.position.set(
          s.crashSide * 0.5 * (1 - Math.exp(-2.5 * t)),
          Math.max(0, Math.sin(Math.min(t / 0.5, 1) * Math.PI) * 0.35),
          -2.4 * (1 - Math.exp(-2.4 * t)),
        );
        slot.rotation.y = CHARACTER_YAW * (1 - turn);
      } else {
        slot.position.set(0, -Math.min(0.5 * 24 * Math.max(t - 0.12, 0) ** 2, 14), -1.4 * (1 - Math.exp(-2 * t)));
        slot.rotation.y = CHARACTER_YAW * (1 - turn * 0.6);
      }
      slot.position.multiplyScalar(cw);
      slot.rotation.y = CHARACTER_YAW + (slot.rotation.y - CHARACTER_YAW) * cw;
    }
    slot.updateMatrixWorld(true);

    // ---- feet on the deck (IK), faded out while wiping out
    const ik = 1 - cw;
    if (ik > 0.001) {
      const h = this.ch.humanoid;
      if (ik < 0.999) for (const n of LEG_BONES) _saved.get(n)!.copy(h.bone(n).quaternion);
      stanceFrame(slot, this.frame);
      plantFeet(h, this.rig.board, this.rig.spin, this.ch.footRest, { ...this.frame, space: this.rig.spin });
      if (ik < 0.999) {
        for (const n of LEG_BONES) h.bone(n).quaternion.slerpQuaternions(_saved.get(n)!, h.bone(n).quaternion.clone(), ik);
        this.ch.model.updateMatrixWorld(true);
      }
    }
  }

  /**
   * Fresh-run reset: stops the wipeout and every one-shot clip, clears blend weights and
   * springs, and restarts the riding loop from its first frame in the normal stance.
   */
  reset() {
    for (const key of BASE_KEYS) this.weights[key] = key === 'ride' ? 1 : 0;
    const all = [...BASE_KEYS.map((k) => this.base[k]), this.wipe, this.toe, this.heel, this.crouch];
    for (const a of all) {
      a.reset(); // time 0, enabled, un-paused, no pending fades
      a.setEffectiveWeight(0);
    }
    this.base.ride.setEffectiveWeight(1);
    for (const k of SCRUBBED) this.base[k].timeScale = 0;
    this.wipe.timeScale = 0;
    this.leanS = new Spring();
    this.absorb = new Spring();
    this.lastSinceLand = 10;
    const slot = this.rig.slot;
    slot.position.set(0, 0, 0);
    slot.rotation.set(0, CHARACTER_YAW, 0);
    slot.updateMatrixWorld(true);
    this.mixer.update(0); // apply the riding pose immediately
  }

  /** Head position in world space (used for the camera / debugging). */
  headWorld(out: Vector3) {
    return this.ch.humanoid.worldPos('Head', out);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.ch.model);
  }
}

