import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Mesh, ShaderMaterial, Vector3 } from 'three';
import { boostFactor } from '../game/powerups';
import { runtime } from '../game/runtime';
import { useGame } from '../game/store';
import { makeFrame } from '../game/track';
import { PRIORITY } from './priorities';

const POINTS = 22; // history samples per ribbon
const RIBBONS = 2; // one from each rear wheel
const REAR = 0.27; // rear truck distance behind the board centre
const frame = makeFrame();
const _side = new Vector3();
const _dir = new Vector3();

/**
 * Speed-boost trail: two glowing ribbons streaming from the rear trucks. Points are
 * recorded in world space every frame, so the light "paints" the road behind the board.
 */
export function BoostTrail() {
  const res = useMemo(() => {
    const verts = RIBBONS * POINTS * 2;
    const geo = new BufferGeometry();
    const pos = new BufferAttribute(new Float32Array(verts * 3), 3);
    pos.setUsage(DynamicDrawUsage);
    const fade = new BufferAttribute(new Float32Array(verts * 2), 2);
    fade.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', pos);
    geo.setAttribute('fade', fade);
    const idx: number[] = [];
    for (let r = 0; r < RIBBONS; r++) {
      for (let i = 0; i < POINTS - 1; i++) {
        const a = (r * POINTS + i) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geo.setIndex(idx);
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uHot: { value: new Color('#fff3c4') },
        uMid: { value: new Color('#ffa21f') },
        uTail: { value: new Color('#ff3f8a') },
      },
      vertexShader: /* glsl */ `
        attribute vec2 fade; // x: 0 at the board .. 1 at the tail, y: -1..1 across the ribbon
        varying vec2 vFade;
        void main() {
          vFade = fade;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHot;
        uniform vec3 uMid;
        uniform vec3 uTail;
        varying vec2 vFade;
        void main() {
          float along = clamp(vFade.x, 0.0, 1.0);
          vec3 col = mix(uHot, uMid, smoothstep(0.0, 0.35, along));
          col = mix(col, uTail, smoothstep(0.35, 1.0, along));
          float core = 1.0 - abs(vFade.y);
          float a = pow(1.0 - along, 1.4) * (0.35 + 0.65 * core * core);
          gl_FragColor = vec4(col * a * 1.6, a);
        }`,
    });
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.visible = false;
    const history = Array.from({ length: RIBBONS }, () => Array.from({ length: POINTS }, () => new Vector3()));
    return { mesh, geo, mat, pos, fade, history, count: 0, strength: 0, serial: -1 };
  }, []);
  useEffect(
    () => () => {
      res.geo.dispose();
      res.mat.dispose();
    },
    [res],
  );

  useFrame((_, rawDt) => {
    const p = runtime.player;
    if (res.serial !== runtime.resetSerial) {
      // fresh run: no trail left over from the previous one
      res.serial = runtime.resetSerial;
      res.count = 0;
      res.strength = 0;
      res.mesh.visible = false;
    }
    if (useGame.getState().phase === 'paused') return;
    const dt = Math.min(rawDt, 0.05);
    const target = boostFactor(p);
    res.strength += (target - res.strength) * (1 - Math.exp(-dt * (target > res.strength ? 12 : 4)));
    if (res.strength < 0.01 && target === 0) {
      res.mesh.visible = false;
      res.count = 0;
      return;
    }
    // emit a new point under each rear wheel
    runtime.track.frame(p.s - REAR, frame);
    for (let r = 0; r < RIBBONS; r++) {
      const lat = p.x + (r === 0 ? -0.12 : 0.12);
      const h = res.history[r];
      for (let i = POINTS - 1; i > 0; i--) h[i].copy(h[i - 1]);
      h[0].set(frame.x + frame.rx * lat, frame.y + p.y + 0.045, frame.z + frame.rz * lat);
    }
    res.count = Math.min(res.count + 1, POINTS);
    // build the ribbons relative to the world anchor (keeps float32 precision)
    const a = runtime.anchor;
    const P = res.pos.array as Float32Array;
    const F = res.fade.array as Float32Array;
    for (let r = 0; r < RIBBONS; r++) {
      const h = res.history[r];
      for (let i = 0; i < POINTS; i++) {
        const k = Math.min(i, res.count - 1);
        const cur = h[k];
        _dir.subVectors(h[Math.max(k - 1, 0)], h[Math.min(k + 1, res.count - 1)]);
        if (_dir.lengthSq() < 1e-8) _dir.set(0, 0, -1);
        _side.set(-_dir.z, 0, _dir.x).normalize();
        const along = i / (POINTS - 1);
        const w = (0.075 - 0.05 * along) * res.strength;
        for (let sgn = 0; sgn < 2; sgn++) {
          const v = (r * POINTS + i) * 2 + sgn;
          const o = sgn === 0 ? -w : w;
          P[v * 3] = cur.x + _side.x * o - a.x;
          P[v * 3 + 1] = cur.y - a.y;
          P[v * 3 + 2] = cur.z + _side.z * o - a.z;
          F[v * 2] = i >= res.count ? 1 : along + (1 - res.strength) * 0.6;
          F[v * 2 + 1] = sgn === 0 ? -1 : 1;
        }
      }
    }
    res.pos.needsUpdate = true;
    res.fade.needsUpdate = true;
    res.mesh.position.copy(a);
    res.mesh.visible = true;
  }, PRIORITY.actors);

  return <primitive object={res.mesh} />;
}
