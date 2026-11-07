import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { clamp, smoothstep } from '../game/noise';
import { MAX_PARTICLES, particles } from '../game/particles';
import { MAX_COINS, MAX_POWERUPS, OBSTACLE_TYPES, ObstacleType, POWERUP_KINDS, PowerUpKind, runtime } from '../game/runtime';
import { boostFactor, POWERUP_INFO } from '../game/powerups';
import { useGame } from '../game/store';
import { boltGeometry, coinGeometry, magnetGeometry, shieldGeometry } from './geometries';
import { ObstacleKit } from './obstacleModels';
import { PRIORITY } from './priorities';
import { glowTexture } from './textures';

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

const POOL: Record<ObstacleType, number> = { cone: 34, barricade: 12, roadblock: 10, rock: 8, log: 4, gap: 4, overhead: 4 };

// ------------------------------------------------------------------ obstacles
export function Obstacles() {
  const { kit, root, pools } = useMemo(() => {
    const kit = new ObstacleKit();
    const root = new Group();
    const pools = {} as Record<ObstacleType, Group[]>;
    for (const type of OBSTACLE_TYPES) {
      pools[type] = [];
      for (let i = 0; i < POOL[type]; i++) {
        const g = kit.build(type);
        g.visible = false;
        root.add(g);
        pools[type].push(g);
      }
    }
    return { kit, root, pools };
  }, []);
  useEffect(() => () => kit.dispose(), [kit]);

  const used = useMemo(() => ({}) as Record<ObstacleType, number>, []);
  useFrame(() => {
    for (const t of OBSTACLE_TYPES) used[t] = 0;
    for (const o of runtime.obstacles) {
      if (!o.active) continue;
      const pool = pools[o.type];
      const g = pool[used[o.type]++];
      if (!g) continue;
      // tall overhead gates are hidden once passed so the camera never clips them
      g.visible = !(o.type === 'overhead' && o.s < runtime.player.s - 1.2);
      g.position.set(o.px, o.py, o.pz);
      g.rotation.set(o.pitch, -o.heading + o.yaw, 0);
      if (o.hit) {
        const t = o.kt;
        const fx = Math.sin(o.heading);
        const fz = -Math.cos(o.heading);
        const rx = Math.cos(o.heading);
        const rz = Math.sin(o.heading);
        const fwd = o.kvz * t;
        const side = o.kvx * t;
        g.position.x += fx * fwd + rx * side;
        g.position.z += fz * fwd + rz * side;
        g.position.y += Math.max(o.kvy * t - 9 * t * t, -0.2);
        g.rotation.x += o.kspin * t;
        g.rotation.z += o.kspin * 0.6 * t;
      }
    }
    for (const t of OBSTACLE_TYPES) {
      const pool = pools[t];
      for (let i = used[t]; i < pool.length; i++) pool[i].visible = false;
    }
    kit.lampMat.emissiveIntensity = 0.6 + 0.9 * (Math.sin(runtime.realTime * 7) > 0 ? 1 : 0.2);
  }, PRIORITY.actors);

  return <primitive object={root} />;
}

// ------------------------------------------------------------------ coins
export function Coins() {
  const camera = useThree((s) => s.camera);
  const res = useMemo(() => {
    const mat = new MeshStandardMaterial({
      color: '#ffd23a',
      metalness: 0.45,
      roughness: 0.3,
      emissive: new Color('#ffa600'),
      emissiveIntensity: 0.6,
    });
    const coins = new InstancedMesh(coinGeometry(), mat, MAX_COINS);
    coins.instanceMatrix.setUsage(DynamicDrawUsage);
    coins.castShadow = true;
    coins.frustumCulled = false;
    coins.count = 0;
    const haloGeo = new PlaneGeometry(1.7, 1.7);
    const haloMat = new MeshBasicMaterial({
      map: glowTexture(),
      color: '#ffcf55',
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const halos = new InstancedMesh(haloGeo, haloMat, MAX_COINS);
    halos.instanceMatrix.setUsage(DynamicDrawUsage);
    halos.frustumCulled = false;
    halos.count = 0;
    halos.renderOrder = 2;
    const group = new Group();
    group.add(coins, halos);
    return { group, coins, halos, mat, haloGeo, haloMat };
  }, []);
  useEffect(
    () => () => {
      res.mat.dispose();
      res.haloGeo.dispose();
      res.haloMat.dispose();
      res.coins.dispose();
      res.halos.dispose();
    },
    [res],
  );

  useFrame(() => {
    const a = runtime.anchor;
    res.group.position.copy(a);
    const t = runtime.time;
    const ps = runtime.player.s;
    const crashed = runtime.player.crashed;
    let n = 0;
    for (const c of runtime.coins) {
      if (!c.active) continue;
      let scale = 1;
      // coins the rider has passed shrink away so they never clutter the chase camera
      const behind = ps - c.s + (crashed ? 3 : 0);
      if (behind > 0.6 && !c.collected) scale = clamp(1 - (behind - 0.6) / 1.6, 0, 1);
      let lift = Math.sin(t * 3 + c.phase) * 0.06;
      let spin = t * 3.4 + c.phase;
      if (c.collected) {
        const k = clamp(c.ct / 0.22, 0, 1);
        scale = (1 - k) * (1 + k * 0.6);
        lift += c.ct * 5;
        spin += c.ct * 30;
      }
      if (scale <= 0.001) continue;
      _p.set(c.px - a.x, c.py - a.y + lift, c.pz - a.z);
      _e.set(0, spin, 0);
      _q.setFromEuler(_e);
      _s.setScalar(scale);
      _m.compose(_p, _q, _s);
      res.coins.setMatrixAt(n, _m);
      _m.compose(_p, camera.quaternion, _s);
      res.halos.setMatrixAt(n, _m);
      n++;
    }
    res.coins.count = n;
    res.halos.count = n;
    res.coins.instanceMatrix.needsUpdate = true;
    res.halos.instanceMatrix.needsUpdate = true;
  }, PRIORITY.followers);

  return <primitive object={res.group} />;
}

// ------------------------------------------------------------------ power-ups
/**
 * Pooled power-up pickups. Each slot holds all three models and shows the one matching the
 * pickup's kind: shield (cyan shield), magnet (red horseshoe with silver poles) and speed
 * boost (amber lightning bolt), each inside a tinted bubble with a camera-facing glow.
 */
export function PowerUps() {
  const camera = useThree((s) => s.camera);
  const res = useMemo(() => {
    const std = (color: string, emissive: string, intensity: number, metal = 0.3, rough = 0.25) =>
      new MeshStandardMaterial({ color, emissive: new Color(emissive), emissiveIntensity: intensity, metalness: metal, roughness: rough });
    const mats = {
      shield: std('#59e6ff', '#1fb8ff', 0.9),
      magnet: std('#ff3b55', '#ff1f4a', 0.75, 0.35, 0.3),
      magnetTips: std('#eef0f6', '#9aa0b8', 0.35, 0.85, 0.2),
      bolt: std('#ffd23a', '#ff9a00', 1.1, 0.25, 0.3),
    };
    const bubbleGeo = new SphereGeometry(0.75, 22, 16);
    const haloGeo = new PlaneGeometry(2.1, 2.1);
    const bubbleMat = {} as Record<PowerUpKind, MeshBasicMaterial>;
    const haloMat = {} as Record<PowerUpKind, MeshBasicMaterial>;
    for (const kind of POWERUP_KINDS) {
      const c = POWERUP_INFO[kind];
      bubbleMat[kind] = new MeshBasicMaterial({ color: c.accent, transparent: true, opacity: 0.16, depthWrite: false, blending: AdditiveBlending });
      haloMat[kind] = new MeshBasicMaterial({
        map: glowTexture(),
        color: c.color,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: AdditiveBlending,
      });
    }
    const mg = magnetGeometry();
    const items: {
      group: Group;
      spin: Group;
      models: Record<PowerUpKind, Object3D>;
      bubble: Mesh;
      halo: Mesh;
    }[] = [];
    const root = new Group();
    for (let i = 0; i < MAX_POWERUPS; i++) {
      const group = new Group();
      const spin = new Group();
      const shield = new Mesh(shieldGeometry(), mats.shield);
      const magnet = new Group();
      magnet.add(new Mesh(mg.body, mats.magnet), new Mesh(mg.tips, mats.magnetTips));
      magnet.scale.setScalar(1.15);
      const bolt = new Mesh(boltGeometry(), mats.bolt);
      bolt.scale.setScalar(1.35);
      for (const m of [shield, magnet, bolt]) {
        m.traverse((o) => (o.castShadow = true));
        spin.add(m);
      }
      const bubble = new Mesh(bubbleGeo, bubbleMat.shield);
      const halo = new Mesh(haloGeo, haloMat.shield);
      halo.renderOrder = 2;
      group.add(spin, bubble, halo);
      group.visible = false;
      root.add(group);
      items.push({ group, spin, models: { shield, magnet, boost: bolt }, bubble, halo });
    }
    const dispose = () => {
      Object.values(mats).forEach((m) => m.dispose());
      Object.values(bubbleMat).forEach((m) => m.dispose());
      Object.values(haloMat).forEach((m) => m.dispose());
      bubbleGeo.dispose();
      haloGeo.dispose();
    };
    return { root, items, bubbleMat, haloMat, dispose };
  }, []);
  useEffect(() => () => res.dispose(), [res]);
  useFrame(() => {
    const t = runtime.time;
    let n = 0;
    for (const pu of runtime.powerups) {
      if (!pu.active) continue;
      const it = res.items[n++];
      if (!it) break;
      const k = pu.collected ? clamp(pu.ct / 0.3, 0, 1) : 0;
      it.group.visible = k < 1;
      it.group.position.set(pu.px, pu.py + Math.sin(t * 2.5 + n) * 0.12 + k * 1.5, pu.pz);
      it.group.scale.setScalar(1 + k * 1.2);
      for (const kind of POWERUP_KINDS) it.models[kind].visible = kind === pu.kind;
      it.bubble.material = res.bubbleMat[pu.kind];
      it.halo.material = res.haloMat[pu.kind];
      it.halo.quaternion.copy(camera.quaternion);
      it.halo.scale.setScalar(1 + 0.08 * Math.sin(t * 6));
      it.spin.rotation.set(pu.kind === 'magnet' ? 0.25 * Math.sin(t * 1.7) : 0, t * (pu.kind === 'boost' ? 3.2 : 2.2), 0);
    }
    for (let i = n; i < res.items.length; i++) res.items[i].group.visible = false;
  }, PRIORITY.followers);
  return <primitive object={res.root} />;
}

// ------------------------------------------------------------------ particles
export function Particles() {
  const res = useMemo(() => {
    const geo = new OctahedronGeometry(1, 0);
    const mat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false });
    const mesh = new InstancedMesh(geo, mat, MAX_PARTICLES);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    for (let i = 0; i < MAX_PARTICLES; i++) mesh.setColorAt(i, _c.set('#ffffff'));
    mesh.count = 0;
    mesh.renderOrder = 3;
    return { mesh, geo, mat };
  }, []);
  useEffect(
    () => () => {
      res.geo.dispose();
      res.mat.dispose();
      res.mesh.dispose();
    },
    [res],
  );
  useFrame(() => {
    const a = runtime.anchor;
    res.mesh.position.copy(a);
    let n = 0;
    for (const p of particles.items) {
      if (!p.alive) continue;
      const life = p.life / p.max;
      const sz = p.size * (0.35 + 0.65 * smoothstep(0, 0.4, life));
      _p.set(p.px - a.x, p.py - a.y, p.pz - a.z);
      _e.set(p.rot, p.rot * 0.7, 0);
      _q.setFromEuler(_e);
      _s.setScalar(sz);
      _m.compose(_p, _q, _s);
      res.mesh.setMatrixAt(n, _m);
      res.mesh.setColorAt(n, _c.setRGB(p.r, p.g, p.b));
      n++;
    }
    res.mesh.count = n;
    res.mesh.instanceMatrix.needsUpdate = true;
    if (res.mesh.instanceColor) res.mesh.instanceColor.needsUpdate = true;
  }, PRIORITY.actors);
  return <primitive object={res.mesh} />;
}

// ------------------------------------------------------------------ speed lines
const LINES = 36;
export function SpeedLines() {
  const camera = useThree((s) => s.camera);
  const res = useMemo(() => {
    const geo = new BoxGeometry(0.012, 0.012, 1);
    const mat = new MeshBasicMaterial({
      color: '#fff4ea',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const mesh = new InstancedMesh(geo, mat, LINES);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    const lines = Array.from({ length: LINES }, () => ({ x: 0, y: 0, z: -Math.random() * 30 }));
    const seed = (l: { x: number; y: number; z: number }) => {
      const a = Math.random() * Math.PI * 2;
      const r = 1.6 + Math.random() * 2.8;
      l.x = Math.cos(a) * r * 1.5;
      l.y = Math.abs(Math.sin(a)) * r * 0.9 - 0.2; // mostly upper half / sides, away from the rider
      l.z = -28 - Math.random() * 10;
    };
    lines.forEach(seed);
    return { mesh, geo, mat, lines, seed };
  }, []);
  useEffect(
    () => () => {
      res.geo.dispose();
      res.mat.dispose();
      res.mesh.dispose();
    },
    [res],
  );
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const p = runtime.player;
    const phase = useGame.getState().phase;
    const k = Math.max(smoothstep(27, 40, p.speed), boostFactor(p) * 1.25) * (phase === 'playing' ? 1 : 0);
    res.mat.opacity = Math.min(k, 1.2) * 0.32;
    res.mesh.visible = k > 0.01;
    if (!res.mesh.visible) return;
    res.mesh.position.copy(camera.position);
    res.mesh.quaternion.copy(camera.quaternion);
    const len = 1.5 + k * 3;
    for (let i = 0; i < LINES; i++) {
      const l = res.lines[i];
      l.z += p.speed * 1.3 * dt;
      if (l.z > 1) res.seed(l);
      _p.set(l.x, l.y, l.z);
      _s.set(1, 1, len);
      _m.compose(_p, _q.identity(), _s);
      res.mesh.setMatrixAt(i, _m);
    }
    res.mesh.instanceMatrix.needsUpdate = true;
  }, PRIORITY.followers);
  return <primitive object={res.mesh} />;
}
