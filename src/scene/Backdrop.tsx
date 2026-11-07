import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { hash, lerp, mulberry32, noise2, smoothstep } from '../game/noise';
import { runtime } from '../game/runtime';
import type { Quality } from '../game/store';
import { PRIORITY } from './priorities';
import { createSkyMaterial, OCEAN_DEPTH } from './sky';
import { windowTexture } from './textures';

// Backdrop coordinates are relative to the camera (the group follows it), facing -Z.
const SEA = -OCEAN_DEPTH;
const NEAR_Z = -330;
const coastZ = (x: number) => -1200 + 560 * smoothstep(-200, 1150, x);

function landHeight(x: number, v: number): number {
  const base = lerp(-64, SEA + 2, Math.pow(v, 0.8));
  const hills = (noise2(x / 230, v * 3.4, 3) - 0.42) * 46 * Math.pow(1 - v, 1.25);
  const leftMount = smoothstep(-420, -1350, x) * 170 * (1 - v * 0.45) * (0.75 + 0.5 * noise2(x / 160, v * 2, 8));
  const rightHills = smoothstep(620, 1350, x) * 75 * (1 - v * 0.8);
  let y = base + hills + leftMount + rightHills;
  y = lerp(y, SEA + 0.8, smoothstep(0.92, 1.0, v));
  return y;
}

function landPoint(x: number, v: number, out: Vector3) {
  const z = lerp(NEAR_Z, coastZ(x), v);
  return out.set(x, landHeight(x, v), z);
}

function buildLand(): BufferGeometry {
  const NX = 80;
  const NV = 30;
  const X0 = -1800;
  const X1 = 1800;
  const grid: Vector3[] = [];
  for (let k = 0; k < NV; k++) {
    for (let i = 0; i < NX; i++) {
      const x = lerp(X0, X1, i / (NX - 1)) + (k > 0 && k < NV - 1 ? (hash(i, k, 1) - 0.5) * 30 : 0);
      const v = k / (NV - 1);
      const p = landPoint(x, v, new Vector3());
      if (k < NV - 1) p.y += (hash(i, k, 2) - 0.5) * 6;
      grid.push(p);
    }
  }
  const pos: number[] = [];
  const col: number[] = [];
  const greens = ['#4b8a3a', '#56963f', '#3f7d35', '#5e9c45', '#467f3c'].map((c) => new Color(c));
  const rock = new Color('#a26a5e');
  const sand = new Color('#ecc29a');
  const e1 = new Vector3();
  const e2 = new Vector3();
  const n = new Vector3();
  for (let k = 0; k < NV - 1; k++) {
    for (let i = 0; i < NX - 1; i++) {
      const a = grid[k * NX + i];
      const b = grid[k * NX + i + 1];
      const c = grid[(k + 1) * NX + i];
      const d = grid[(k + 1) * NX + i + 1];
      for (const [p0, p1, p2] of [
        [a, c, b],
        [b, c, d],
      ] as Vector3[][]) {
        e1.subVectors(p1, p0);
        e2.subVectors(p2, p0);
        n.crossVectors(e1, e2).normalize();
        let cc: Color;
        if (k >= NV - 3) cc = sand;
        else if (n.y < 0.72) cc = rock;
        else cc = greens[Math.floor(hash(i, k, 7) * greens.length)];
        for (const p of [p0, p1, p2]) {
          pos.push(p.x, p.y, p.z);
          col.push(cc.r, cc.g, cc.b);
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

interface BackdropResources {
  group: Group;
  sky: Mesh;
  skyMat: ReturnType<typeof createSkyMaterial>;
  dispose: () => void;
}

function buildBackdrop(quality: Quality): BackdropResources {
  const group = new Group();
  const geos: BufferGeometry[] = [];
  const mats: Material[] = [];
  const rnd = mulberry32(2024);

  // sky + ocean dome
  const skyMat = createSkyMaterial(true);
  const skyGeo = new SphereGeometry(2400, 48, 28);
  const sky = new Mesh(skyGeo, skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);
  geos.push(skyGeo);
  mats.push(skyMat);

  // coastal valley
  const landGeo = buildLand();
  const landMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const land = new Mesh(landGeo, landMat);
  group.add(land);
  geos.push(landGeo);
  mats.push(landMat);

  // city skyline
  const palette = ['#a98bd6', '#c995c9', '#e9a8a2', '#8f7bc7', '#f2c4a9', '#b68ad9', '#7e6dbd', '#dba6c8', '#9fb0e0'].map(
    (c) => new Color(c),
  );
  const facade = windowTexture(false);
  const lit = windowTexture(true);
  const lowGeo = new BoxGeometry(1, 1, 1);
  lowGeo.translate(0, 0.5, 0);
  const towerGeo = new BoxGeometry(1, 1, 1);
  towerGeo.translate(0, 0.5, 0);
  {
    const uv = towerGeo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 4);
  }
  const cityMat = new MeshStandardMaterial({
    map: facade,
    emissiveMap: lit,
    emissive: new Color('#ffcf8a'),
    emissiveIntensity: 1.1,
    roughness: 0.7,
  });
  const count = quality === 'high' ? 360 : 240;
  const low = new InstancedMesh(lowGeo, cityMat, count);
  const towers = new InstancedMesh(towerGeo, cityMat, 80);
  let nl = 0;
  let nt = 0;
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  const tmp = new Vector3();
  for (let i = 0; i < 1400 && (nl < count || nt < 80); i++) {
    const x = lerp(-900, 260, Math.pow(rnd(), 0.9));
    const v = lerp(0.6, 0.955, rnd());
    landPoint(x, v, tmp);
    if (tmp.y > SEA + 26) continue; // only on the coastal plain
    const downtown = Math.abs(x + 330) < 230 && v > 0.74;
    const w = 14 + rnd() * 26;
    const d = 14 + rnd() * 24;
    const yaw = (rnd() - 0.5) * 0.25;
    q.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    const color = palette[Math.floor(rnd() * palette.length)];
    if (downtown && rnd() < 0.45 && nt < 80) {
      const h = 38 + Math.pow(rnd(), 1.3) * 48;
      p.set(tmp.x, tmp.y - 2, tmp.z);
      s.set(w * 0.9, h, d * 0.9);
      m.compose(p, q, s);
      towers.setMatrixAt(nt, m);
      towers.setColorAt(nt, color);
      nt++;
    } else if (nl < count) {
      const h = 8 + Math.pow(rnd(), 2) * 26;
      p.set(tmp.x, tmp.y - 2, tmp.z);
      s.set(w, h, d);
      m.compose(p, q, s);
      low.setMatrixAt(nl, m);
      low.setColorAt(nl, color);
      nl++;
    }
  }
  low.count = nl;
  towers.count = nt;
  for (const im of [low, towers]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  geos.push(lowGeo, towerGeo);
  mats.push(cityMat);

  // forest canopy on the valley
  const treeGeo = new IcosahedronGeometry(1, 0);
  treeGeo.translate(0, 0.6, 0);
  const treeMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true });
  const treeCount = quality === 'high' ? 650 : 350;
  const trees = new InstancedMesh(treeGeo, treeMat, treeCount);
  const treeCols = ['#3e7a35', '#4a8a3c', '#356d30', '#5b9446', '#2f6530'].map((c) => new Color(c));
  let nTree = 0;
  for (let i = 0; i < treeCount * 4 && nTree < treeCount; i++) {
    const x = lerp(-1700, 1700, rnd());
    const v = Math.pow(rnd(), 0.8) * 0.9;
    if (x > -920 && x < 280 && v > 0.58) continue; // city
    landPoint(x, v, tmp);
    const sc = 7 + rnd() * 9;
    p.set(tmp.x, tmp.y - 1, tmp.z);
    s.set(sc, sc * (1 + rnd() * 0.6), sc);
    q.setFromAxisAngle(new Vector3(0, 1, 0), rnd() * 6);
    m.compose(p, q, s);
    trees.setMatrixAt(nTree, m);
    trees.setColorAt(nTree, treeCols[Math.floor(rnd() * treeCols.length)]);
    nTree++;
  }
  trees.count = nTree;
  trees.instanceMatrix.needsUpdate = true;
  if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
  trees.computeBoundingSphere();
  group.add(trees);
  geos.push(treeGeo);
  mats.push(treeMat);

  // islands / headlands in the sea
  const isleGeo = new IcosahedronGeometry(1, 1);
  {
    const pa = isleGeo.getAttribute('position');
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i);
      pa.setY(i, y < 0 ? y * 0.2 : y);
      const k = 1 + (hash(Math.round(pa.getX(i) * 100), Math.round(pa.getZ(i) * 100), 3) - 0.5) * 0.25;
      pa.setX(i, pa.getX(i) * k);
      pa.setZ(i, pa.getZ(i) * k);
    }
    isleGeo.computeVertexNormals();
  }
  const isleMat = new MeshStandardMaterial({ color: '#5d6b8f', roughness: 1, flatShading: true });
  for (const [x, z, sx, sy, sz] of [
    [1250, -1650, 260, 70, 140],
    [1650, -1350, 180, 48, 110],
    [-300, -2050, 160, 26, 70],
    [700, -2100, 120, 22, 60],
  ]) {
    const isle = new Mesh(isleGeo, isleMat);
    isle.position.set(x, SEA - 2, z);
    isle.scale.set(sx, sy, sz);
    group.add(isle);
  }
  geos.push(isleGeo);
  mats.push(isleMat);

  return {
    group,
    sky,
    skyMat,
    dispose: () => {
      geos.forEach((g) => g.dispose());
      mats.forEach((mm) => mm.dispose());
      low.dispose();
      towers.dispose();
      trees.dispose();
    },
  };
}

/** Sky, sun, ocean, distant coast and city. Follows the camera so it never gets closer. */
export function Backdrop({ quality }: { quality: Quality }) {
  const res = useMemo(() => buildBackdrop(quality), [quality]);
  const camera = useThree((s) => s.camera);
  useEffect(() => () => res.dispose(), [res]);
  useFrame(() => {
    res.group.position.copy(camera.position);
    res.skyMat.uniforms.uTime.value = runtime.realTime;
  }, PRIORITY.followers);
  return <primitive object={res.group} />;
}
