import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash, mulberry32 } from '../game/noise';

// Procedurally built, cached geometries shared by many meshes.

const cache = new Map<string, BufferGeometry>();
function cached(key: string, make: () => BufferGeometry) {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
}

/** Ensure geometry is non-indexed and has position/normal/color (uv removed) for merging. */
function prep(g: BufferGeometry, color?: Color | ((y: number, i: number) => Color)) {
  let out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  if (color) {
    const pos = out.getAttribute('position');
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const c = typeof color === 'function' ? color(pos.getY(i), i) : color;
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    out.setAttribute('color', new BufferAttribute(cols, 3));
  }
  if (out === g) out = g.clone();
  return out;
}

function jitter(g: BufferGeometry, amount: number, seed: number) {
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = Math.round(x * 1000) * 73856093 ^ Math.round(y * 1000) * 19349663 ^ Math.round(z * 1000) * 83492791;
    const s = 1 + (hash(k, seed) - 0.5) * amount;
    pos.setXYZ(i, x * s, y * s, z * s);
  }
  pos.needsUpdate = true;
}

// --------------------------------------------------------------- palm tree
function frond(length: number, width: number, droop: number, rnd: () => number) {
  const N = 4;
  const verts: number[] = [];
  const cols: number[] = [];
  const dark = new Color('#2f6b2a');
  const light = new Color('#7fc24a');
  const pts: Vector3[][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = t * length;
    const y = Math.sin(t * Math.PI * 0.55) * length * 0.32 - t * t * droop;
    const w = width * Math.pow(Math.sin(Math.PI * Math.min(t * 1.08, 1)), 0.7) + 0.02;
    const fold = w * 0.35;
    pts.push([new Vector3(x, y - fold, -w), new Vector3(x, y + 0.03, 0), new Vector3(x, y - fold, w)]);
  }
  const push = (v: Vector3, t: number) => {
    verts.push(v.x, v.y, v.z);
    const c = dark.clone().lerp(light, Math.min(t * 1.1, 1));
    c.offsetHSL((rnd() - 0.5) * 0.02, 0, (rnd() - 0.5) * 0.04);
    cols.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < N; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const t0 = i / N;
    const t1 = (i + 1) / N;
    for (const [l, r] of [
      [0, 1],
      [1, 2],
    ]) {
      push(a[l], t0);
      push(b[l], t1);
      push(a[r], t0);
      push(a[r], t0);
      push(b[l], t1);
      push(b[r], t1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

export function palmGeometry(variant = 0): BufferGeometry {
  return cached(`palm${variant}`, () => {
    const rnd = mulberry32(42 + variant * 17);
    const H = 7.2 + variant * 0.8;
    const bend = 1.1 + variant * 0.5;
    const trunk = new CylinderGeometry(0.16, 0.3, H, 6, 9, true);
    trunk.translate(0, H / 2, 0);
    const pos = trunk.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / H;
      pos.setX(i, pos.getX(i) + bend * t * t);
    }
    const bandA = new Color('#8a5a3c');
    const bandB = new Color('#6e4630');
    const trunkG = prep(trunk, (y) => (Math.floor((y / H) * 9) % 2 === 0 ? bandA : bandB));
    trunkG.computeVertexNormals();

    const parts: BufferGeometry[] = [trunkG];
    const crown = new Vector3(bend, H, 0);
    const count = 8;
    for (let k = 0; k < count; k++) {
      const f = frond(2.8 + rnd() * 0.9, 0.42 + rnd() * 0.12, 1.6 + rnd() * 0.9, rnd);
      const m = new Matrix4()
        .makeTranslation(crown.x, crown.y - 0.1, crown.z)
        .multiply(new Matrix4().makeRotationY((k / count) * Math.PI * 2 + rnd() * 0.4))
        .multiply(new Matrix4().makeRotationZ(0.15 + rnd() * 0.25));
      f.applyMatrix4(m);
      parts.push(f);
    }
    // a few young upright fronds
    for (let k = 0; k < 2; k++) {
      const f = frond(1.8, 0.3, 0.3, rnd);
      const m = new Matrix4()
        .makeTranslation(crown.x, crown.y, crown.z)
        .multiply(new Matrix4().makeRotationY(k * 2.1 + 0.5))
        .multiply(new Matrix4().makeRotationZ(0.9));
      f.applyMatrix4(m);
      parts.push(f);
    }
    // coconuts
    const nut = new Color('#5a3a22');
    for (let k = 0; k < 3; k++) {
      const s = new SphereGeometry(0.16, 5, 4);
      const a = (k / 3) * Math.PI * 2;
      s.translate(crown.x + Math.cos(a) * 0.2, crown.y - 0.3, crown.z + Math.sin(a) * 0.2);
      parts.push(prep(s, nut));
    }
    const merged = mergeGeometries(parts.map((p) => prep(p)), false);
    if (!merged) throw new Error('palm merge failed');
    merged.computeBoundingSphere();
    return merged;
  });
}

// --------------------------------------------------------------- rocks / bushes
export function rockGeometry(variant = 0): BufferGeometry {
  return cached(`rock${variant}`, () => {
    const g = new IcosahedronGeometry(1, 1);
    jitter(g, 0.55, 7 + variant * 13);
    g.scale(1, 0.75, 1);
    g.computeVertexNormals();
    return g;
  });
}

export function bushGeometry(): BufferGeometry {
  return cached('bush', () => {
    const parts: BufferGeometry[] = [];
    const rnd = mulberry32(5);
    for (let i = 0; i < 4; i++) {
      const g = new IcosahedronGeometry(0.55 + rnd() * 0.35, 0);
      jitter(g, 0.4, i);
      g.translate((rnd() - 0.5) * 0.9, 0.35 + rnd() * 0.25, (rnd() - 0.5) * 0.9);
      parts.push(prep(g));
    }
    const merged = mergeGeometries(parts, false)!;
    merged.computeVertexNormals();
    return merged;
  });
}

// --------------------------------------------------------------- coin
function starShape(outer: number, inner: number, points = 5) {
  const s = new Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

export function coinGeometry(): BufferGeometry {
  return cached('coin', () => {
    const R = 0.42;
    const T = 0.055;
    const profile = [
      new Vector2(0, -T * 0.7),
      new Vector2(R * 0.8, -T * 0.7),
      new Vector2(R * 0.86, -T),
      new Vector2(R, -T * 0.8),
      new Vector2(R, T * 0.8),
      new Vector2(R * 0.86, T),
      new Vector2(R * 0.8, T * 0.7),
      new Vector2(0, T * 0.7),
    ];
    const lathe = new LatheGeometry(profile, 20);
    lathe.rotateX(Math.PI / 2); // axis -> Z, faces look along ±Z
    const parts: BufferGeometry[] = [prep(lathe)];
    for (const side of [1, -1]) {
      const star = new ExtrudeGeometry(starShape(R * 0.52, R * 0.23), {
        depth: 0.035,
        bevelEnabled: false,
      });
      if (side === -1) star.rotateY(Math.PI);
      star.translate(0, 0, side * T * 0.55);
      parts.push(prep(star));
    }
    const merged = mergeGeometries(parts, false)!;
    merged.computeVertexNormals();
    return merged;
  });
}

// --------------------------------------------------------------- traffic cone
export function coneGeometry(): BufferGeometry {
  return cached('cone', () => {
    const orange = new Color('#ff5f12');
    const white = new Color('#f7f3f0');
    const H = 0.72;
    const rAt = (y: number) => 0.19 - (y / H) * 0.15;
    const ys = [0.05, 0.24, 0.2401, 0.36, 0.3601, 0.46, 0.4601, 0.54, 0.5401, H - 0.02];
    const profile = [new Vector2(0, 0.05), ...ys.map((y) => new Vector2(rAt(y), y)), new Vector2(0.03, H), new Vector2(0, H)];
    const lathe = new LatheGeometry(profile, 16);
    const body = prep(lathe, (y) => ((y > 0.24 && y < 0.36) || (y > 0.46 && y < 0.54) ? white : orange));
    const base = new CylinderGeometry(0.3, 0.32, 0.05, 4, 1);
    base.rotateY(Math.PI / 4);
    base.translate(0, 0.025, 0);
    const baseG = prep(base, new Color('#2a2230'));
    const merged = mergeGeometries([body, baseG], false)!;
    merged.computeVertexNormals();
    return merged;
  });
}

// --------------------------------------------------------------- shield emblem
export function shieldGeometry(): BufferGeometry {
  return cached('shield', () => {
    const s = new Shape();
    s.moveTo(0, 0.45);
    s.quadraticCurveTo(0.22, 0.38, 0.36, 0.4);
    s.quadraticCurveTo(0.38, -0.05, 0, -0.42);
    s.quadraticCurveTo(-0.38, -0.05, -0.36, 0.4);
    s.quadraticCurveTo(-0.22, 0.38, 0, 0.45);
    const g = new ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
    g.translate(0, 0, -0.04);
    g.computeVertexNormals();
    return g;
  });
}

// --------------------------------------------------------------- magnet power-up
/** Horseshoe magnet: red U-shaped body (returned as `body`) and silver pole tips (`tips`). */
export function magnetGeometry(): { body: BufferGeometry; tips: BufferGeometry } {
  const body = cached('magnetBody', () => {
    const arc = new TorusGeometry(0.22, 0.085, 12, 22, Math.PI);
    arc.rotateZ(Math.PI); // U opens upward
    const parts: BufferGeometry[] = [prep(arc)];
    for (const x of [-0.22, 0.22]) {
      const arm = new CylinderGeometry(0.085, 0.085, 0.2, 12);
      arm.translate(x, 0.1, 0);
      parts.push(prep(arm));
    }
    const g = mergeGeometries(parts, false)!;
    g.translate(0, -0.02, 0);
    g.computeVertexNormals();
    return g;
  });
  const tips = cached('magnetTips', () => {
    const parts: BufferGeometry[] = [];
    for (const x of [-0.22, 0.22]) {
      const tip = new CylinderGeometry(0.092, 0.092, 0.11, 12);
      tip.translate(x, 0.235, 0);
      parts.push(prep(tip));
    }
    const g = mergeGeometries(parts, false)!;
    g.translate(0, -0.02, 0);
    return g;
  });
  return { body, tips };
}

// --------------------------------------------------------------- speed boost power-up
export function boltGeometry(): BufferGeometry {
  return cached('bolt', () => {
    const s = new Shape();
    s.moveTo(0.1, 0.46);
    s.lineTo(-0.21, -0.03);
    s.lineTo(-0.02, -0.03);
    s.lineTo(-0.12, -0.46);
    s.lineTo(0.23, 0.07);
    s.lineTo(0.03, 0.07);
    s.closePath();
    const g = new ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 2 });
    g.translate(0, 0, -0.05);
    g.computeVertexNormals();
    return g;
  });
}
