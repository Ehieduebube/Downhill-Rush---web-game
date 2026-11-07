import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import { LATERAL_MAX } from '../../game/config';
import { clamp, smoothstep } from '../../game/noise';
import { particles } from '../../game/particles';
import { boostFactor } from '../../game/powerups';
import { runtime } from '../../game/runtime';
import { useGame } from '../../game/store';
import { makeFrame } from '../../game/track';
import { createSkaterCharacter } from '../character/loadSkater';
import { RiderInput, SkaterAnimator } from '../character/SkaterAnimator';
import { PRIORITY } from '../priorities';
import { BoardRig, buildBoardRig } from './boardRig';

const frame = makeFrame();
const _v = new Vector3();
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Small springs for the board / rig motion (separate from the rider's animation state). */
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

interface RigState {
  lean: Spring;
  slide: Spring;
  pitch: Spring;
  sparkTimer: number;
  input: RiderInput;
  /** Last `runtime.resetSerial` seen; a change means a fresh run started at the start line. */
  serial: number;
}

function updateRig(rig: BoardRig, st: RigState, animator: SkaterAnimator | null, rawDt: number) {
  const p = runtime.player;
  const phase = useGame.getState().phase;

  // place on the road (also while paused)
  runtime.track.frame(p.s, frame);
  rig.root.position.set(frame.x + frame.rx * p.x, frame.y, frame.z + frame.rz * p.x);
  rig.root.rotation.set(Math.atan(frame.slope), -frame.heading, 0);
  if (phase === 'paused') return;

  // fresh run: drop all board / rider animation state so nothing from the last run carries over
  if (st.serial !== runtime.resetSerial) {
    st.serial = runtime.resetSerial;
    st.lean = new Spring();
    st.slide = new Spring();
    st.pitch = new Spring();
    st.sparkTimer = 0;
    rig.carrier.position.set(0, 0, 0);
    rig.carrier.rotation.set(0, 0, 0);
    rig.spin.rotation.set(0, 0, 0);
    rig.board.position.set(0, 0, 0);
    rig.board.rotation.set(0, 0, 0);
    rig.flip.rotation.set(0, 0, 0);
    animator?.reset();
  }

  const dt = Math.min(rawDt, 0.05);
  const t = runtime.time;
  const speedK = clamp(p.speed / 43, 0, 1);
  const sliding = p.slideT > 0 && p.grounded && !p.crashed;
  const airborne = !p.grounded && !p.crashed;
  const leanTarget = p.crashed ? 0 : clamp(-(p.vx / LATERAL_MAX) * 0.85 - p.steer * 0.2, -1, 1);
  const ln = st.lean.update(leanTarget, 80, 15, dt);
  const sl = st.slide.update(sliding ? 1 : 0, 120, 20, dt);
  const ollie = airborne && p.airTime < 0.17 && p.trick === 'none' ? 0.3 : 0;
  const bp = st.pitch.update(ollie, 260, 20, dt);

  // tricks
  let flipA = 0;
  let spinA = 0;
  let boardLift = 0;
  let trickProgress = 0;
  if (p.trick !== 'none' && !p.crashed) {
    trickProgress = clamp(p.trickT / p.trickDur, 0, 1);
    const e = easeInOut(trickProgress);
    if (p.trick === 'kickflip') {
      flipA = e * Math.PI * 2 * p.trickDir;
      boardLift = Math.sin(trickProgress * Math.PI) * 0.16;
    } else {
      spinA = e * Math.PI * 2 * p.trickDir;
    }
  }

  // crash weight: the wipeout layer is fully on while crashed (a fresh run resets it to 0)
  const cw = p.crashed ? 1 : 0;
  const ct = p.crashT;
  const side = p.crashSide;

  // carrier: jump height, steering yaw, lean roll; slide turns the whole board sideways
  rig.carrier.position.y = p.crashed && p.crashKind === 'fall' ? 0 : p.y;
  rig.carrier.rotation.set(0, ln * 0.14 - sl * 0.95, ln * 0.17 * (1 - cw));
  rig.spin.rotation.y = -spinA;

  // board: ollie pitch, kickflip lift/roll, crash tumble
  const vib = p.grounded && !p.crashed ? (Math.sin(t * 41) + Math.sin(t * 27.3)) * 0.0035 * speedK : 0;
  let bx = 0;
  let by = boardLift;
  let bz = 0;
  let rx = bp;
  let ry = 0;
  let rz = vib;
  if (cw > 0) {
    if (p.crashKind === 'tumble') {
      const kb = clamp(ct / 0.45, 0, 1);
      bx += -side * 1.7 * (1 - Math.exp(-2 * ct)) * cw;
      by += Math.max(0, Math.sin(kb * Math.PI) * 0.45) * cw;
      bz += -5.5 * (1 - Math.exp(-1.6 * ct)) * cw;
      rx += 0.4 * Math.sin(kb * Math.PI) * cw;
      ry += 7 * (1 - Math.exp(-1.3 * ct)) * cw;
      rz += Math.PI * smoothstep(0, 0.5, ct) * side * cw;
    } else {
      const fall = Math.min(0.5 * 24 * Math.max(ct - 0.12, 0) ** 2, 14);
      by -= fall * 1.05 * cw;
      bz += -2.2 * (1 - Math.exp(-2 * ct)) * cw;
      rx += Math.min(ct, 1.4) * 2 * cw;
    }
  }
  rig.board.position.set(bx, by, bz);
  rig.board.rotation.set(rx, ry, rz);
  rig.flip.rotation.z = flipA;
  for (const w of rig.wheels) w.rotation.x = -p.wheelAngle;
  rig.root.updateMatrixWorld(true);

  // rider
  if (animator) {
    const s = st.input;
    s.grounded = p.grounded;
    s.airTime = p.airTime;
    s.sinceLand = p.sinceLand;
    s.landImpact = p.landImpact;
    s.sliding = sliding;
    s.trick = p.crashed ? 'none' : p.trick;
    s.trickProgress = trickProgress;
    s.lean = ln;
    s.speedK = speedK;
    s.crashed = p.crashed;
    s.crashT = ct;
    s.crashKind = p.crashKind;
    s.crashSide = side;
    s.crashWeight = cw;
    animator.update(dt, s);
  }

  // shield + contact shadow
  const shielded = p.shieldT > 0 || p.invulnT > 0;
  rig.shield.visible = shielded && !p.crashed;
  if (rig.shield.visible) {
    rig.shieldMat.uniforms.uTime.value = t;
    const blink = p.shieldT > 0 && p.shieldT < 2 ? 0.5 + 0.5 * Math.sign(Math.sin(t * 22)) : 1;
    rig.shieldMat.uniforms.uAlpha.value = (p.shieldT > 0 ? 1 : 0.5) * blink;
  }
  // magnet aura: counter-rotating field rings, blinking in the last two seconds
  rig.magnetAura.visible = p.magnetT > 0 && !p.crashed;
  if (rig.magnetAura.visible) {
    rig.magnetRings[0].rotation.z = t * 3.1;
    rig.magnetRings[1].rotation.z = -t * 4.3;
    const blink = p.magnetT < 2 ? 0.5 + 0.5 * Math.sign(Math.sin(t * 22)) : 1;
    rig.magnetMat.opacity = (0.35 + 0.2 * Math.sin(t * 9)) * blink;
    const pulse = 1 + 0.06 * Math.sin(t * 7);
    rig.magnetAura.scale.set(pulse, 1, pulse);
  }
  // speed boost: wheels glow white-hot
  rig.wheelMat.emissiveIntensity = 0.35 + 1.6 * boostFactor(p);
  const lift = clamp(p.y / 2.2, 0, 1);
  rig.blobMat.opacity = 0.42 * (1 - lift * 0.65) * (1 - cw);
  rig.blob.scale.setScalar(1 + lift * 0.35);
  rig.blob.rotation.z = -(ln * 0.14 - sl * 0.95);

  // sparks from the tail while power-sliding
  if (sliding) {
    st.sparkTimer -= dt;
    if (st.sparkTimer <= 0) {
      st.sparkTimer = 0.016;
      rig.wheels[2].getWorldPosition(_v);
      particles.sparks(_v.x, _v.y - 0.03, _v.z, frame.fx, frame.fz, p.speed);
    }
  }
}

/** The skateboard + rigged rider. */
export function Skater() {
  const rig = useMemo(() => buildBoardRig(), []);
  const animatorRef = useRef<SkaterAnimator | null>(null);
  const st = useMemo<RigState>(
    () => ({
      lean: new Spring(),
      slide: new Spring(),
      pitch: new Spring(),
      sparkTimer: 0,
      serial: -1,
      input: {
        grounded: true,
        airTime: 0,
        sinceLand: 10,
        landImpact: 0,
        sliding: false,
        trick: 'none',
        trickProgress: 0,
        lean: 0,
        speedK: 0,
        crashed: false,
        crashT: 0,
        crashKind: 'tumble',
        crashSide: 1,
        crashWeight: 0,
      },
    }),
    [],
  );

  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let alive = true;
    let model: { removeFromParent: () => void } | null = null;
    createSkaterCharacter(rig.slot, rig.spin, rig.board)
      .then(async (ch) => {
        // compile the skinned materials in parallel (KHR_parallel_shader_compile) before
        // the rider is shown, so it doesn't stall the frame it first appears in
        ch.model.removeFromParent();
        try {
          await gl.compileAsync(ch.model, camera, scene);
        } catch {
          /* fall back to compiling on first render */
        }
        if (!alive) return;
        rig.slot.add(ch.model);
        model = ch.model;
        animatorRef.current = new SkaterAnimator(ch, rig);
        st.serial = -1; // force a clean state on the next frame
        useGame.getState().setCharacterReady(true);
      })
      .catch((err) => {
        // The game stays playable (board only) if the character asset cannot be loaded.
        console.error('Downhill Rush: failed to load the skater character model.', err);
        useGame.getState().setCharacterError(true);
      });
    return () => {
      alive = false;
      useGame.getState().setCharacterReady(false);
      animatorRef.current?.dispose();
      animatorRef.current = null;
      model?.removeFromParent();
    };
  }, [rig, st, gl, scene, camera]);

  useEffect(() => () => rig.dispose(), [rig]);
  useFrame((_, dt) => updateRig(rig, st, animatorRef.current, dt), PRIORITY.skater);
  return <primitive object={rig.root} />;
}
