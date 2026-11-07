// Generates skinned garments (hoodie, trousers, sneakers) from the base body mesh.
//
// Each garment is cut from the body surface along clean hem / cuff / collar lines,
// subdivided, Taubin-smoothed (which removes muscle definition the way fabric does),
// offset by a per-region "ease", pushed clear of the skin, then given folds, ribbed
// bands and (for the hoodie) a rolled hood. Skin weights are inherited from the body,
// so garments deform with exactly the same joints as the character underneath.
//
// Coordinates are the body's bind space: metres, +Y up, character faces +Z,
// arms straight along +-X (T-pose), left side = +X.

const smooth = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};
const hash3 = (x, y, z) => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x1b873593);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function noise3(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

/** sRGB hex -> linear [r,g,b] (glTF vertex colours are linear). */
export function linear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
}

// ------------------------------------------------------------------ joint groups
const GROUP = { head: 0, torso: 1, upperarm: 2, lowerarm: 3, hand: 4, thigh: 5, calf: 6, foot: 7 };
function groupOf(name) {
  if (name === 'Head' || name === 'neck_01') return GROUP.head;
  if (name.startsWith('upperarm')) return GROUP.upperarm;
  if (name.startsWith('lowerarm')) return GROUP.lowerarm;
  if (/^(hand|index|middle|ring|pinky|thumb)/.test(name)) return GROUP.hand;
  if (name.startsWith('thigh')) return GROUP.thigh;
  if (name.startsWith('calf')) return GROUP.calf;
  if (/^(foot|ball)/.test(name)) return GROUP.foot;
  return GROUP.torso;
}

// ------------------------------------------------------------------ mesh helpers
class Mesh {
  constructor() {
    this.pos = []; // flat
    this.nor = [];
    this.inf = []; // per vertex: Map jointIndex -> weight
    this.tag = []; // per vertex constraint tag
    this.tris = [];
  }
  get count() {
    return this.pos.length / 3;
  }
}

function topInfluences(map) {
  const arr = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = arr.reduce((s, [, w]) => s + w, 0) || 1;
  return new Map(arr.map(([j, w]) => [j, w / sum]));
}

function subdivide(m) {
  const out = new Mesh();
  out.pos = m.pos.slice();
  out.nor = m.nor.slice();
  out.inf = m.inf.slice();
  out.tag = m.tag.slice();
  const edgeMid = new Map();
  const mid = (a, b) => {
    const key = a < b ? a * 1e6 + b : b * 1e6 + a;
    let id = edgeMid.get(key);
    if (id !== undefined) return id;
    id = out.count;
    for (let c = 0; c < 3; c++) {
      out.pos.push((m.pos[a * 3 + c] + m.pos[b * 3 + c]) / 2);
      out.nor.push((m.nor[a * 3 + c] + m.nor[b * 3 + c]) / 2);
    }
    const inf = new Map();
    for (const src of [m.inf[a], m.inf[b]]) for (const [j, w] of src) inf.set(j, (inf.get(j) ?? 0) + w * 0.5);
    out.inf.push(topInfluences(inf));
    out.tag.push(m.tag[a] === m.tag[b] ? m.tag[a] : 0);
    edgeMid.set(key, id);
    return id;
  };
  for (let t = 0; t < m.tris.length; t += 3) {
    const a = m.tris[t];
    const b = m.tris[t + 1];
    const c = m.tris[t + 2];
    const ab = mid(a, b);
    const bc = mid(b, c);
    const ca = mid(c, a);
    out.tris.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  return out;
}

function adjacency(m) {
  const n = m.count;
  const nb = Array.from({ length: n }, () => new Set());
  const edgeCount = new Map();
  for (let t = 0; t < m.tris.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = m.tris[t + k];
      const b = m.tris[t + ((k + 1) % 3)];
      nb[a].add(b);
      nb[b].add(a);
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  }
  const boundary = new Uint8Array(n);
  const bnb = Array.from({ length: n }, () => []);
  for (const [key, c] of edgeCount) {
    if (c !== 1) continue;
    const a = Math.floor(key / 1e6);
    const b = key % 1e6;
    boundary[a] = boundary[b] = 1;
    bnb[a].push(b);
    bnb[b].push(a);
  }
  return { nb: nb.map((s) => [...s]), boundary, bnb };
}

function computeNormals(m) {
  const n = m.count;
  const acc = new Float64Array(n * 3);
  const P = m.pos;
  for (let t = 0; t < m.tris.length; t += 3) {
    const a = m.tris[t] * 3;
    const b = m.tris[t + 1] * 3;
    const c = m.tris[t + 2] * 3;
    const e1x = P[b] - P[a];
    const e1y = P[b + 1] - P[a + 1];
    const e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a];
    const e2y = P[c + 1] - P[a + 1];
    const e2z = P[c + 2] - P[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      acc[v] += nx;
      acc[v + 1] += ny;
      acc[v + 2] += nz;
    }
  }
  const out = new Array(n * 3);
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]) || 1;
    out[i * 3] = acc[i * 3] / l;
    out[i * 3 + 1] = acc[i * 3 + 1] / l;
    out[i * 3 + 2] = acc[i * 3 + 2] / l;
  }
  return out;
}

/** Volume-preserving smoothing (Taubin). `constrain(i, pos)` re-applies cut constraints. */
function taubin(m, adj, iterations, constrain) {
  const n = m.count;
  const step = (lambda) => {
    const next = m.pos.slice();
    for (let i = 0; i < n; i++) {
      const list = adj.boundary[i] ? adj.bnb[i] : adj.nb[i];
      if (!list.length) continue;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const j of list) {
        sx += m.pos[j * 3];
        sy += m.pos[j * 3 + 1];
        sz += m.pos[j * 3 + 2];
      }
      const k = 1 / list.length;
      next[i * 3] += lambda * (sx * k - m.pos[i * 3]);
      next[i * 3 + 1] += lambda * (sy * k - m.pos[i * 3 + 1]);
      next[i * 3 + 2] += lambda * (sz * k - m.pos[i * 3 + 2]);
    }
    m.pos = next;
    for (let i = 0; i < n; i++) constrain(i, m.pos);
  };
  for (let it = 0; it < iterations; it++) {
    step(0.55);
    step(-0.58);
  }
}

// ------------------------------------------------------------------ garment builder
function extract(body, inside, project) {
  const g = new Mesh();
  const map = new Map();
  const add = (v) => {
    let id = map.get(v);
    if (id !== undefined) return id;
    id = g.count;
    const p = [body.pos[v * 3], body.pos[v * 3 + 1], body.pos[v * 3 + 2]];
    const tag = project(p, v);
    g.pos.push(...p);
    g.nor.push(body.nor[v * 3], body.nor[v * 3 + 1], body.nor[v * 3 + 2]);
    g.inf.push(new Map(body.inf[v]));
    g.tag.push(tag);
    map.set(v, id);
    return id;
  };
  for (let t = 0; t < body.tris.length; t += 3) {
    const a = body.tris[t];
    const b = body.tris[t + 1];
    const c = body.tris[t + 2];
    if (!(inside[a] || inside[b] || inside[c])) continue;
    g.tris.push(add(a), add(b), add(c));
  }
  return g;
}

function finalize(m, colorFn) {
  const n = m.count;
  const position = new Float32Array(m.pos);
  const normal = new Float32Array(computeNormals(m));
  const color = new Float32Array(n * 3);
  const joints = new Uint16Array(n * 4);
  const weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = colorFn(i, [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]]);
    color.set(c, i * 3);
    let k = 0;
    for (const [j, w] of topInfluences(m.inf[i])) {
      joints[i * 4 + k] = j;
      weights[i * 4 + k] = w;
      k++;
    }
  }
  // drop degenerate triangles produced by cut projection
  const tris = [];
  for (let t = 0; t < m.tris.length; t += 3) {
    const [a, b, c] = [m.tris[t], m.tris[t + 1], m.tris[t + 2]];
    const P = m.pos;
    const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const cr = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
    if (cr > 1e-9) tris.push(a, b, c);
  }
  return { position, normal, color, joints, weights, index: new Uint32Array(tris) };
}

/**
 * body: { pos, nor (welded), inf: Map[] per welded vertex, tris (welded), jointNames }
 * Returns garments plus a per-welded-vertex "covered" flag used to cull hidden skin.
 */
export function buildGarments(body) {
  const groups = body.jointNames.map(groupOf);
  const n = body.pos.length / 3;
  const gw = Array.from({ length: n }, (_, i) => {
    const g = new Float32Array(8);
    for (const [j, w] of body.inf[i]) g[groups[j]] += w;
    return g;
  });
  const X = (i) => body.pos[i * 3];
  const Y = (i) => body.pos[i * 3 + 1];
  const Z = (i) => body.pos[i * 3 + 2];
  const armW = (i) => gw[i][GROUP.upperarm] + gw[i][GROUP.lowerarm] + gw[i][GROUP.hand];
  const legW = (i) => gw[i][GROUP.thigh] + gw[i][GROUP.calf] + gw[i][GROUP.foot];

  // Cut lines (bind space)
  const CUFF_X = 0.668; // sleeve end, just above the wrist (wrist joint at 0.706)
  const HEM_Y = 0.955; // hoodie hem around the hips, above the seat
  // Crew-neck collar: an ellipse around the neck in the horizontal plane (above NECK_Y).
  const NECK_Y = 1.4;
  const NECK_CZ = -0.028;
  const collarE = (x, z) => (x / 0.098) ** 2 + ((z - NECK_CZ) / (z > NECK_CZ ? 0.094 : 0.088)) ** 2;
  const inNeck = (x, y, z) => y > NECK_Y && collarE(x, z) < 1;
  const WAIST_Y = 1.045; // trousers top (hidden under the hoodie)
  const PANT_CUFF_Y = 0.122; // trousers end, stacking on the shoe
  const SHOE_TOP = 0.158; // high-top collar
  const isArm = (i) => armW(i) > 0.5 && Math.abs(X(i)) > 0.16;

  // ---------------------------------------------------------------- hoodie
  const hoodieIn = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (isArm(i)) hoodieIn[i] = Math.abs(X(i)) < CUFF_X ? 1 : 0;
    else hoodieIn[i] = Y(i) >= HEM_Y && !inNeck(X(i), Y(i), Z(i)) && Y(i) < 1.56 && gw[i][GROUP.head] < 0.35 ? 1 : 0;
  }
  const TAG_NONE = 0;
  const TAG_CUFF = 1;
  const TAG_HEM = 2;
  const TAG_COLLAR = 3;
  let hoodie = extract(body, hoodieIn, (p, v) => {
    if (isArm(v) && Math.abs(p[0]) > CUFF_X) {
      p[0] = Math.sign(p[0]) * CUFF_X;
      return TAG_CUFF;
    }
    if (p[1] < HEM_Y) {
      p[1] = HEM_Y;
      return TAG_HEM;
    }
    if (inNeck(p[0], p[1], p[2])) {
      const k = 1 / Math.sqrt(collarE(p[0], p[2]) || 1e-6);
      p[0] *= k;
      p[2] = NECK_CZ + (p[2] - NECK_CZ) * k;
      return TAG_COLLAR;
    }
    return TAG_NONE;
  });
  hoodie = subdivide(hoodie);
  // Fabric below the ribs hangs from the torso: fade out thigh / glute influences so the
  // hem doesn't stretch over the seat when the hips flex.
  {
    const torsoJoints = body.jointNames.map((n) => groupOf(n) === GROUP.torso);
    const pelvisJ = body.jointNames.indexOf('pelvis');
    for (let i = 0; i < hoodie.count; i++) {
      const y = hoodie.pos[i * 3 + 1];
      const ax = Math.abs(hoodie.pos[i * 3]);
      if (ax > 0.24) continue; // arms keep their weights
      const k = smooth(1.12, 1.0, y);
      if (k <= 0) continue;
      const torso = new Map();
      let sum = 0;
      for (const [j, w] of hoodie.inf[i]) {
        if (torsoJoints[j]) {
          torso.set(j, w);
          sum += w;
        }
      }
      if (sum < 1e-4) torso.set(pelvisJ, (sum = 1));
      const mixed = new Map();
      for (const [j, w] of hoodie.inf[i]) mixed.set(j, w * (1 - k));
      for (const [j, w] of torso) mixed.set(j, (mixed.get(j) ?? 0) + (w / sum) * k);
      hoodie.inf[i] = topInfluences(mixed);
    }
  }
  const hoodieRef = hoodie.pos.slice();
  const hoodieRefN = computeNormals(hoodie);
  {
    const adj = adjacency(hoodie);
    const constrain = (i, P) => {
      const t = hoodie.tag[i];
      if (t === TAG_CUFF) P[i * 3] = Math.sign(P[i * 3]) * CUFF_X;
      else if (t === TAG_HEM) P[i * 3 + 1] = HEM_Y;
      else if (t === TAG_COLLAR) {
        const k = 1 / Math.sqrt(collarE(P[i * 3], P[i * 3 + 2]) || 1e-6);
        P[i * 3] *= k;
        P[i * 3 + 2] = NECK_CZ + (P[i * 3 + 2] - NECK_CZ) * k;
      }
    };
    // Drape: front and back panels hang straight down from the chest / shoulder-blade line,
    // filling the lumbar hollow and flattening the seat curve like real fabric.
    {
      const BIN = 0.01;
      const ref = { back: new Map(), front: new Map() };
      for (let i = 0; i < hoodie.count; i++) {
        const x = hoodie.pos[i * 3];
        const y = hoodie.pos[i * 3 + 1];
        const z = hoodie.pos[i * 3 + 2];
        if (Math.abs(x) > 0.24 || Math.abs(y - 1.3) > 0.025) continue;
        const b = Math.round(x / BIN);
        if (z < 0) ref.back.set(b, Math.min(ref.back.get(b) ?? 0, z));
        else ref.front.set(b, Math.max(ref.front.get(b) ?? 0, z));
      }
      const lookup = (m, x) => {
        const b = Math.round(x / BIN);
        for (let d = 0; d < 6; d++) {
          if (m.has(b + d)) return m.get(b + d);
          if (m.has(b - d)) return m.get(b - d);
        }
        return null;
      };
      for (let i = 0; i < hoodie.count; i++) {
        const x = hoodie.pos[i * 3];
        const y = hoodie.pos[i * 3 + 1];
        const z = hoodie.pos[i * 3 + 2];
        if (Math.abs(x) > 0.24 || y > 1.3) continue;
        const w = smooth(1.3, 1.12, y) * (1 - smooth(0.17, 0.24, Math.abs(x)));
        const r = lookup(z < 0 ? ref.back : ref.front, x);
        if (r === null || w <= 0) continue;
        const target = z < 0 ? r - 0.006 : r + 0.004;
        // only along the panel's facing direction (front/back), fading out toward the sides
        const facing = smooth(0.01, 0.06, Math.abs(z + 0.02));
        hoodie.pos[i * 3 + 2] = z + (target - z) * w * facing;
      }
    }
    taubin(hoodie, adj, 80, constrain);
    const N = computeNormals(hoodie);
    for (let i = 0; i < hoodie.count; i++) {
      const x = hoodie.pos[i * 3];
      const y = hoodie.pos[i * 3 + 1];
      const z = hoodie.pos[i * 3 + 2];
      const ax = Math.abs(x);
      const onArm = ax > 0.25 || (ax > 0.2 && Math.abs(y - 1.455) < 0.09);
      let ease;
      if (onArm) {
        const s = (ax - 0.21) / (CUFF_X - 0.21);
        ease = 0.016 + 0.01 * smooth(0.0, 0.6, s) - 0.012 * smooth(0.9, 1.0, s) + 0.003 * Math.exp(-(((s - 0.86) / 0.04) ** 2));
        ease -= 0.016 * Math.exp(-(((s - 0.2) / 0.16) ** 2)); // biceps / deltoid bulk
      } else {
        ease = 0.016 + 0.018 * smooth(1.22, 1.0, y) - 0.012 * smooth(HEM_Y + 0.05, HEM_Y, y) + 0.003 * Math.exp(-(((y - HEM_Y - 0.065) / 0.02) ** 2));
        // tone down the heroic deltoid caps and lat flare
        ease -= 0.018 * smooth(0.17, 0.24, ax) * Math.exp(-(((y - 1.44) / 0.08) ** 2));
        ease -= 0.008 * smooth(0.12, 0.2, ax) * Math.exp(-(((y - 1.25) / 0.08) ** 2));
      }
      for (let c = 0; c < 3; c++) hoodie.pos[i * 3 + c] += N[i * 3 + c] * ease;
    }
    // push out of the skin
    for (let i = 0; i < hoodie.count; i++) {
      const d =
        (hoodie.pos[i * 3] - hoodieRef[i * 3]) * hoodieRefN[i * 3] +
        (hoodie.pos[i * 3 + 1] - hoodieRef[i * 3 + 1]) * hoodieRefN[i * 3 + 1] +
        (hoodie.pos[i * 3 + 2] - hoodieRef[i * 3 + 2]) * hoodieRefN[i * 3 + 2];
      const x = hoodieRef[i * 3];
      const y = hoodieRef[i * 3 + 1];
      const z = hoodieRef[i * 3 + 2];
      const nearOpening = Math.abs(x) > CUFF_X - 0.07 || y < HEM_Y + 0.05 || (y > 1.38 && collarE(x, z) < 1.9);
      if (!nearOpening) continue;
      const minGap = hoodie.tag[i] ? 0.006 : 0.009;
      if (d < minGap) for (let c = 0; c < 3; c++) hoodie.pos[i * 3 + c] += hoodieRefN[i * 3 + c] * (minGap - d);
    }
    // folds, rolled hood, ribbed bands
    const N2 = computeNormals(hoodie);
    const neck = { y: 1.49, z: -0.035 };
    for (let i = 0; i < hoodie.count; i++) {
      const x = hoodie.pos[i * 3];
      const y = hoodie.pos[i * 3 + 1];
      const z = hoodie.pos[i * 3 + 2];
      const ax = Math.abs(x);
      let d = (noise3(x * 5, y * 5, z * 5) - 0.5) * 0.004; // soft drape
      if (ax > 0.24) {
        const s = (ax - 0.21) / (CUFF_X - 0.21);
        const th = Math.atan2(z + 0.07, y - 1.455);
        // soft rings at the elbow crease and a stack of folds above the cuff
        const elbow = Math.exp(-(((s - 0.52) / 0.1) ** 2)) * (0.6 + 0.4 * Math.cos(th));
        const stack = smooth(0.74, 0.86, s) * (1 - smooth(0.9, 0.95, s));
        d += 0.0045 * Math.sin(s * 34 + 0.9 * Math.sin(th * 2 + s * 4) + (x > 0 ? 0 : 1.7)) * (elbow + stack);
      } else {
        // two or three soft folds bunching above the hem
        const band = smooth(HEM_Y + 0.035, HEM_Y + 0.07, y) * smooth(HEM_Y + 0.17, HEM_Y + 0.1, y);
        d += 0.004 * Math.sin((y - HEM_Y) * 150 + 1.2 * Math.sin(x * 9 + z * 6)) * band;
        // diagonal tension folds under the arms
        const arm = smooth(0.12, 0.2, ax) * smooth(1.42, 1.32, y) * smooth(1.1, 1.22, y);
        d += 0.0035 * Math.sin((y + ax * 1.4) * 55) * arm;
        // rolled hood around the back of the neck + hood pouch on the upper back
        const dz = z - neck.z;
        const r = Math.hypot(x, dz);
        const phi = Math.atan2(x, -dz); // 0 = straight back
        const backness = Math.cos(phi / 2) ** 2;
        const rim = Math.exp(-(((r - 0.112) / 0.03) ** 2)) * Math.exp(-(((y - 1.5) / 0.055) ** 2));
        d += rim * (0.01 + 0.038 * backness);
        if (dz < 0) {
          // hood lying on the upper back: full pouch with a crisp lower edge and a centre seam
          const pouch = smooth(1.235, 1.27, y) * smooth(1.53, 1.43, y) * Math.exp(-((phi / 0.66) ** 4));
          const crease = 1 - 0.32 * Math.exp(-((phi / 0.1) ** 2)) * smooth(1.25, 1.34, y);
          d += 0.072 * pouch * crease;
        }
      }
      for (let c = 0; c < 3; c++) hoodie.pos[i * 3 + c] += N2[i * 3 + c] * d;
    }
  }
  const white = linear('#f4f1f6');
  const rib = linear('#ddd7e3');
  const hoodieOut = finalize(hoodie, (i, [x, y, z]) => {
    const ax = Math.abs(x);
    const dz = z + 0.035;
    if (dz < -0.05 && ax < 0.2) {
      const phi = Math.atan2(x, -dz);
      let shade = 1;
      shade -= 0.12 * Math.exp(-((phi / 0.05) ** 2)) * smooth(1.26, 1.32, y) * smooth(1.5, 1.44, y); // centre seam
      shade -= 0.14 * Math.exp(-(((y - 1.228) / 0.012) ** 2)) * Math.exp(-((phi / 0.62) ** 4)); // shadow under the hood edge
      if (shade < 1) return white.map((c) => c * shade);
    }
    if (ax > 0.25 && ax > CUFF_X - 0.045) return rib;
    if (ax < 0.25 && y < HEM_Y + 0.05) return rib;
    const v = 0.975 + (noise3(x * 20, y * 20, z * 20) - 0.5) * 0.03;
    return white.map((c) => c * v);
  });

  // ---------------------------------------------------------------- trousers
  const TAG_WAIST = 4;
  const TAG_PCUFF = 5;
  const pantsIn = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (isArm(i)) continue;
    const y = Y(i);
    pantsIn[i] = y < WAIST_Y && y > PANT_CUFF_Y && legW(i) + gw[i][GROUP.torso] > 0.5 ? 1 : 0;
  }
  let pants = extract(body, pantsIn, (p) => {
    if (p[1] > WAIST_Y) {
      p[1] = WAIST_Y;
      return TAG_WAIST;
    }
    if (p[1] < PANT_CUFF_Y) {
      p[1] = PANT_CUFF_Y;
      return TAG_PCUFF;
    }
    return TAG_NONE;
  });
  pants = subdivide(pants);
  const pantsRef = pants.pos.slice();
  const pantsRefN = computeNormals(pants);
  {
    const adj = adjacency(pants);
    taubin(pants, adj, 50, (i, P) => {
      if (pants.tag[i] === TAG_WAIST) P[i * 3 + 1] = WAIST_Y;
      else if (pants.tag[i] === TAG_PCUFF) P[i * 3 + 1] = PANT_CUFF_Y;
    });
    const N = computeNormals(pants);
    for (let i = 0; i < pants.count; i++) {
      const y = pants.pos[i * 3 + 1];
      // straight-leg cut: looser below the knee, gathered on the shoe
      const ease = 0.012 + 0.004 * smooth(0.75, 0.55, y) + 0.016 * smooth(0.5, 0.22, y) - 0.005 * smooth(0.17, PANT_CUFF_Y, y);
      for (let c = 0; c < 3; c++) pants.pos[i * 3 + c] += N[i * 3 + c] * ease;
    }
    for (let i = 0; i < pants.count; i++) {
      const d =
        (pants.pos[i * 3] - pantsRef[i * 3]) * pantsRefN[i * 3] +
        (pants.pos[i * 3 + 1] - pantsRef[i * 3 + 1]) * pantsRefN[i * 3 + 1] +
        (pants.pos[i * 3 + 2] - pantsRef[i * 3 + 2]) * pantsRefN[i * 3 + 2];
      const y = pantsRef[i * 3 + 1];
      if (y > 0.22 && y < WAIST_Y - 0.06) continue;
      if (d < 0.009) for (let c = 0; c < 3; c++) pants.pos[i * 3 + c] += pantsRefN[i * 3 + c] * (0.009 - d);
    }
    const N2 = computeNormals(pants);
    for (let i = 0; i < pants.count; i++) {
      const x = pants.pos[i * 3];
      const y = pants.pos[i * 3 + 1];
      const z = pants.pos[i * 3 + 2];
      const lx = x - Math.sign(x || 1) * 0.114;
      const th = Math.atan2(lx, z + 0.04);
      let d = (noise3(x * 6, y * 6, z * 6) - 0.5) * 0.004;
      d += 0.005 * Math.sin(y * 70 + 3 * Math.sin(th + y * 4)) * Math.exp(-(((y - 0.56) / 0.07) ** 2)); // knee
      d += 0.0075 * Math.sin(y * 92 + 1.5 * Math.sin(th * 3)) * smooth(0.34, 0.17, y); // stacking at the ankle
      d += 0.0035 * Math.sin(th * 5 + y * 4) * smooth(0.6, 0.85, y) * smooth(0.95, 0.85, y); // thigh drape
      for (let c = 0; c < 3; c++) pants.pos[i * 3 + c] += N2[i * 3 + c] * d;
    }
  }
  const pantsCol = linear('#363440');
  const pantsSeam = linear('#2c2a35');
  const pantsOut = finalize(pants, (_i, [x, y, z]) => {
    if (y < PANT_CUFF_Y + 0.025) return pantsSeam;
    const v = 0.95 + (noise3(x * 25, y * 25, z * 25) - 0.5) * 0.1;
    return pantsCol.map((c) => c * v);
  });

  // ---------------------------------------------------------------- sneakers
  const TAG_SHOETOP = 6;
  const shoeIn = new Uint8Array(n);
  for (let i = 0; i < n; i++) shoeIn[i] = Y(i) < SHOE_TOP && legW(i) > 0.5 ? 1 : 0;
  let shoes = extract(body, shoeIn, (p) => {
    if (p[1] > SHOE_TOP) {
      p[1] = SHOE_TOP;
      return TAG_SHOETOP;
    }
    return TAG_NONE;
  });
  shoes = subdivide(shoes);
  const shoeRef = shoes.pos.slice();
  const shoeRefN = computeNormals(shoes);
  {
    const adj = adjacency(shoes);
    taubin(shoes, adj, 22, (i, P) => {
      if (shoes.tag[i] === TAG_SHOETOP) P[i * 3 + 1] = SHOE_TOP;
    });
    const N = computeNormals(shoes);
    for (let i = 0; i < shoes.count; i++) {
      const y = shoes.pos[i * 3 + 1];
      const z = shoes.pos[i * 3 + 2];
      const ease = 0.012 + 0.006 * smooth(0.0, 0.1, z) + 0.006 * smooth(SHOE_TOP - 0.035, SHOE_TOP, y);
      for (let c = 0; c < 3; c++) shoes.pos[i * 3 + c] += N[i * 3 + c] * ease;
    }
    for (let i = 0; i < shoes.count; i++) {
      const d =
        (shoes.pos[i * 3] - shoeRef[i * 3]) * shoeRefN[i * 3] +
        (shoes.pos[i * 3 + 1] - shoeRef[i * 3 + 1]) * shoeRefN[i * 3 + 1] +
        (shoes.pos[i * 3 + 2] - shoeRef[i * 3 + 2]) * shoeRefN[i * 3 + 2];
      if (d < 0.008) for (let c = 0; c < 3; c++) shoes.pos[i * 3 + c] += shoeRefN[i * 3 + c] * (0.008 - d);
    }
    // flat, slightly flared sole
    for (let i = 0; i < shoes.count; i++) {
      const x = shoes.pos[i * 3];
      const y = shoes.pos[i * 3 + 1];
      const z = shoes.pos[i * 3 + 2];
      const cx = Math.sign(x || 1) * 0.114;
      const k = smooth(0.04, 0.0, y);
      shoes.pos[i * 3 + 1] = y + (-0.014 - y) * smooth(0.028, -0.005, y);
      const hx = x - cx;
      const hz = z - 0.0;
      const hl = Math.hypot(hx, hz) || 1;
      shoes.pos[i * 3] += (hx / hl) * 0.006 * k;
      shoes.pos[i * 3 + 2] += (hz / hl) * 0.006 * k;
      // laces: a subtle ridge along the top of the foot
      if (y > 0.06 && z > -0.05 && z < 0.09 && Math.abs(hx) < 0.02) shoes.pos[i * 3 + 1] += 0.003 * (1 + Math.sin(z * 140));
    }
  }
  // Clean vulcanised sole: an extruded, bevelled outline of each foot (crisp silhouette
  // instead of a colour band on the smoothed upper). Skinned like the nearest upper vertex.
  const soleColor = new Map();
  const outsole = linear('#cfcac4');
  const midsole = linear('#f4f2ee');
  for (const side of [-1, 1]) {
    const idx = [];
    for (let i = 0; i < shoes.count; i++) if (Math.sign(shoes.pos[i * 3]) === side && shoes.pos[i * 3 + 1] < 0.004) idx.push(i);
    if (idx.length < 3) continue;
    // convex hull (monotone chain) of the flattened sole in XZ
    const pts = idx.map((i) => [shoes.pos[i * 3], shoes.pos[i * 3 + 2]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let k = pts.length - 1; k >= 0; k--) {
      const p = pts[k];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    let hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    for (let it = 0; it < 3; it++) {
      const next = [];
      for (let k = 0; k < hull.length; k++) {
        const a = hull[k];
        const b = hull[(k + 1) % hull.length];
        next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      hull = next;
    }
    const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
    const cz = hull.reduce((s, p) => s + p[1], 0) / hull.length;
    const rings = [
      [-0.016, 0.0, outsole],
      [-0.009, 0.004, outsole],
      [-0.004, 0.0045, midsole],
      [0.019, 0.0035, midsole],
      [0.026, -0.002, midsole],
    ];
    const nearestInf = (x, z) => {
      let best = idx[0];
      let bd = Infinity;
      for (const i of idx) {
        const d = (shoes.pos[i * 3] - x) ** 2 + (shoes.pos[i * 3 + 2] - z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return new Map(shoes.inf[best]);
    };
    const base = shoes.count;
    const H = hull.length;
    for (const [y, off, col] of rings) {
      for (const [x, z] of hull) {
        const dx = x - cx;
        const dz = z - cz;
        const l = Math.hypot(dx, dz) || 1;
        const px = x + (dx / l) * off;
        const pz = z + (dz / l) * off;
        soleColor.set(shoes.count, col);
        shoes.pos.push(px, y, pz);
        shoes.nor.push(0, 1, 0);
        shoes.inf.push(nearestInf(px, pz));
        shoes.tag.push(0);
      }
    }
    const centre = shoes.count;
    soleColor.set(centre, outsole);
    shoes.pos.push(cx, -0.016, cz);
    shoes.nor.push(0, -1, 0);
    shoes.inf.push(nearestInf(cx, cz));
    shoes.tag.push(0);
    // winding so faces point outward / down
    const ccw = hull.reduce((s, p, k) => s + (p[0] * hull[(k + 1) % H][1] - hull[(k + 1) % H][0] * p[1]), 0) > 0;
    for (let r = 0; r < rings.length - 1; r++) {
      for (let k = 0; k < H; k++) {
        const a = base + r * H + k;
        const b = base + r * H + ((k + 1) % H);
        const c = base + (r + 1) * H + k;
        const d = base + (r + 1) * H + ((k + 1) % H);
        if (ccw) shoes.tris.push(a, c, b, b, c, d);
        else shoes.tris.push(a, b, c, b, d, c);
      }
    }
    for (let k = 0; k < H; k++) {
      const a = base + k;
      const b = base + ((k + 1) % H);
      if (ccw) shoes.tris.push(centre, a, b);
      else shoes.tris.push(centre, b, a);
    }
  }
  const black = linear('#1c1b22');
  const accent = linear('#ecE9e4'.toLowerCase());
  const shoesOut = finalize(shoes, (i, [x, y, z]) => {
    const sc = soleColor.get(i);
    if (sc) return sc;
    const hx = x - Math.sign(x || 1) * 0.114;
    if (z > 0.098 && y < 0.062) return accent; // rubber toe cap
    if (y > 0.072 && z > -0.03 && z < 0.1 && Math.abs(hx) < 0.015) return accent; // laces
    if (y > SHOE_TOP - 0.02) return linear('#2c2b33'); // padded collar
    return black;
  });

  // ---------------------------------------------------------------- hidden skin
  const covered = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = Math.abs(X(i));
    const y = Y(i);
    const z = Z(i);
    if (isArm(i)) covered[i] = x < CUFF_X - 0.035 ? 1 : 0;
    else if (y < SHOE_TOP - 0.025 && legW(i) > 0.5) covered[i] = 1;
    else if (y > PANT_CUFF_Y + 0.03 && y < WAIST_Y && legW(i) + gw[i][GROUP.torso] > 0.5) covered[i] = 1;
    else if (y >= HEM_Y + 0.02 && y < 1.58 && collarE(X(i), z) > 1.35 && gw[i][GROUP.head] < 0.5) covered[i] = 1;
  }

  return { hoodie: hoodieOut, trousers: pantsOut, shoes: shoesOut, covered };
}
