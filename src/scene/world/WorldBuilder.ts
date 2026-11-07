import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import {
  CHUNK,
  RAIL_OFFSET,
  ROAD_HALF,
  ROAD_ROW,
  ROAD_TEX_PERIOD,
  TERRAIN_ROW,
  VIEW_AHEAD,
  VIEW_BEHIND,
} from '../../game/config';
import { hash, smoothstep } from '../../game/noise';
import { runtime } from '../../game/runtime';
import { makeFrame, TrackFrame } from '../../game/track';
import { bushGeometry, palmGeometry, rockGeometry } from '../geometries';
import { chevronTexture, roadTexture } from '../textures';
import { COLS, columnHeight, SideParams, sideParams, terrainHeight, vertexJitter } from './terrain';

const VIEW_TOTAL = VIEW_BEHIND + VIEW_AHEAD + CHUNK;
const ROAD_ROWS = VIEW_TOTAL / ROAD_ROW + 1;
const TERRAIN_ROWS = VIEW_TOTAL / TERRAIN_ROW + 1;
const NC = COLS.length;
const TERRAIN_QUADS = (TERRAIN_ROWS - 1) * (NC - 1);
const RAIL_PROFILE: [number, number][] = [
  [0.02, 0.48],
  [-0.05, 0.56],
  [0.0, 0.66],
  [-0.05, 0.76],
  [0.02, 0.84],
  [0.11, 0.84],
  [0.11, 0.48],
];
const RP = RAIL_PROFILE.length;
const POST_SPACING = 4;
const SLOT = 8;

const GRASS = ['#5f9d3b', '#6caa43', '#538f35', '#79b54b', '#5b963f', '#68a347'].map((c) => new Color(c));
const ROCK = ['#c7826b', '#b5725f', '#d39479', '#a8675a', '#c08070', '#cf8b70'].map((c) => new Color(c));
const VERGE = ['#6d9a3d', '#79a343', '#668f3a'].map((c) => new Color(c));
const ROCK_TINTS = ['#c47c66', '#b06b58', '#d08f74', '#a0614f', '#bd8470'].map((c) => new Color(c));
const BUSH_TINTS = ['#5d9c3a', '#4f8d33', '#6fae45', '#7cb64c', '#3f7f30'].map((c) => new Color(c));

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');
const _p = new Vector3();
const _s = new Vector3();

export class WorldBuilder {
  readonly group = new Group();
  private road: Mesh;
  private rails: Mesh;
  private terrain: Mesh;
  private posts: InstancedMesh;
  private palms: InstancedMesh[];
  private rocks: InstancedMesh;
  private bushes: InstancedMesh;
  private chevrons: InstancedMesh[];
  private signPosts: InstancedMesh;
  private frame: TrackFrame = makeFrame();
  private frame2: TrackFrame = makeFrame();
  private sp: SideParams = { cliff: 0, open: 0 };
  private lastStart = Number.NaN;
  private grid: Float32Array;
  private materials: Material[] = [];
  private geometries: BufferGeometry[] = [];

  constructor(private quality: 'high' | 'low') {
    // ---------------- road
    const roadGeo = new BufferGeometry();
    roadGeo.setAttribute('position', this.dyn(new Float32Array(ROAD_ROWS * 2 * 3), 3));
    roadGeo.setAttribute('normal', this.dyn(new Float32Array(ROAD_ROWS * 2 * 3), 3));
    roadGeo.setAttribute('uv', this.dyn(new Float32Array(ROAD_ROWS * 2 * 2), 2));
    const idx: number[] = [];
    for (let r = 0; r < ROAD_ROWS - 1; r++) {
      const a = r * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    roadGeo.setIndex(idx);
    const roadMat = new MeshStandardMaterial({ map: roadTexture(), roughness: 0.62, metalness: 0.04, color: '#fbf4ff' });
    this.road = new Mesh(roadGeo, roadMat);
    this.road.receiveShadow = true;

    // ---------------- guard rails
    const railGeo = new BufferGeometry();
    const railVerts = 2 * ROAD_ROWS * RP;
    railGeo.setAttribute('position', this.dyn(new Float32Array(railVerts * 3), 3));
    const ridx: number[] = [];
    for (let side = 0; side < 2; side++) {
      const base = side * ROAD_ROWS * RP;
      for (let r = 0; r < ROAD_ROWS - 1; r++) {
        for (let k = 0; k < RP - 1; k++) {
          const a = base + r * RP + k;
          const b = base + r * RP + k + 1;
          const c = base + (r + 1) * RP + k;
          const d = base + (r + 1) * RP + k + 1;
          if (side === 1) ridx.push(a, b, c, b, d, c);
          else ridx.push(a, c, b, b, c, d);
        }
      }
    }
    railGeo.setIndex(ridx);
    const railMat = new MeshStandardMaterial({ color: '#d2cbe0', metalness: 0.55, roughness: 0.36 });
    this.rails = new Mesh(railGeo, railMat);
    this.rails.castShadow = quality === 'high';
    this.rails.receiveShadow = true;

    // ---------------- terrain (non indexed, flat shaded, per-face colours)
    const tVerts = 2 * TERRAIN_QUADS * 6;
    const terrainGeo = new BufferGeometry();
    terrainGeo.setAttribute('position', this.dyn(new Float32Array(tVerts * 3), 3));
    terrainGeo.setAttribute('normal', this.dyn(new Float32Array(tVerts * 3), 3));
    terrainGeo.setAttribute('color', this.dyn(new Float32Array(tVerts * 3), 3));
    const terrainMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    this.terrain = new Mesh(terrainGeo, terrainMat);
    this.terrain.receiveShadow = true;
    this.terrain.castShadow = quality === 'high';
    this.grid = new Float32Array(TERRAIN_ROWS * NC * 3);

    // ---------------- instanced props
    const postGeo = new BoxGeometry(0.12, 0.92, 0.16);
    postGeo.translate(0, 0.46, 0);
    const postMat = new MeshStandardMaterial({ color: '#4f4760', roughness: 0.6, metalness: 0.35 });
    this.posts = this.instanced(postGeo, postMat, Math.ceil(VIEW_TOTAL / POST_SPACING + 2) * 2, quality === 'high');

    const palmMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: DoubleSide, flatShading: true });
    const palmCap = quality === 'high' ? 90 : 46;
    this.palms = [this.instanced(palmGeometry(0), palmMat, palmCap, true), this.instanced(palmGeometry(1), palmMat, palmCap, true)];

    const rockMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, flatShading: true });
    this.rocks = this.instanced(rockGeometry(0), rockMat, 160, quality === 'high');
    const bushMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true });
    this.bushes = this.instanced(bushGeometry(), bushMat, quality === 'high' ? 280 : 160, false);
    for (let i = 0; i < this.rocks.instanceMatrix.count; i++) this.rocks.setColorAt(i, ROCK_TINTS[i % ROCK_TINTS.length]);
    for (let i = 0; i < this.bushes.instanceMatrix.count; i++) this.bushes.setColorAt(i, BUSH_TINTS[i % BUSH_TINTS.length]);

    const signGeo = new PlaneGeometry(1.35, 0.68);
    const chevMat = (dir: 1 | -1) =>
      new MeshStandardMaterial({
        map: chevronTexture(dir),
        emissiveMap: chevronTexture(dir),
        emissive: '#ffffff',
        emissiveIntensity: 0.22,
        roughness: 0.55,
        side: DoubleSide,
      });
    this.chevrons = [this.instanced(signGeo, chevMat(1), 70, true), this.instanced(signGeo, chevMat(-1), 70, true)];
    const signPostGeo = new BoxGeometry(0.09, 1.0, 0.09);
    signPostGeo.translate(0, 0.5, 0);
    this.signPosts = this.instanced(signPostGeo, postMat, 140, true);

    this.group.add(this.road, this.rails, this.terrain, this.posts, ...this.palms, this.rocks, this.bushes, ...this.chevrons, this.signPosts);
    this.materials.push(roadMat, railMat, terrainMat, postMat, palmMat, rockMat, bushMat, ...this.chevrons.map((c) => c.material as Material));
    this.geometries.push(roadGeo, railGeo, terrainGeo, postGeo, signGeo, signPostGeo);
    for (const o of [this.road, this.rails, this.terrain]) o.frustumCulled = false;
  }

  private dyn(arr: Float32Array, size: number) {
    const a = new BufferAttribute(arr, size);
    a.setUsage(DynamicDrawUsage);
    return a;
  }

  private instanced(geo: BufferGeometry, mat: Material, count: number, cast: boolean) {
    const m = new InstancedMesh(geo, mat, count);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.count = 0;
    m.castShadow = cast && this.quality === 'high';
    m.receiveShadow = true;
    m.frustumCulled = false;
    return m;
  }

  /** Rebuild the streamed window if the player crossed into a new chunk. */
  update(playerS: number) {
    const start = Math.floor((playerS - VIEW_BEHIND) / CHUNK) * CHUNK;
    if (start === this.lastStart) return;
    this.lastStart = start;
    this.rebuild(start);
  }

  private rebuild(start: number) {
    const track = runtime.track;
    const f = this.frame;
    track.frame(start, f);
    const ax = f.x;
    const ay = f.y;
    const az = f.z;
    runtime.anchor.set(ax, ay, az);
    this.group.position.set(ax, ay, az);

    this.buildRoadAndRails(start, ax, ay, az);
    this.buildTerrain(start, ax, ay, az);
    this.buildProps(start, ax, ay, az);
  }

  private buildRoadAndRails(start: number, ax: number, ay: number, az: number) {
    const track = runtime.track;
    const f = this.frame;
    const pos = this.road.geometry.getAttribute('position') as BufferAttribute;
    const nor = this.road.geometry.getAttribute('normal') as BufferAttribute;
    const uv = this.road.geometry.getAttribute('uv') as BufferAttribute;
    const rpos = this.rails.geometry.getAttribute('position') as BufferAttribute;
    const P = pos.array as Float32Array;
    const N = nor.array as Float32Array;
    const U = uv.array as Float32Array;
    const R = rpos.array as Float32Array;
    const vBase = (((start % 1200) + 1200) % 1200) / ROAD_TEX_PERIOD;
    for (let r = 0; r < ROAD_ROWS; r++) {
      const s = start + r * ROAD_ROW;
      track.frame(s, f);
      const inv = 1 / Math.hypot(1, f.slope);
      const tx = f.fx * inv;
      const ty = f.slope * inv;
      const tz = f.fz * inv;
      const nx = -f.rz * ty;
      const ny = f.rz * tx - f.rx * tz;
      const nz = f.rx * ty;
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? -1 : 1;
        const i = (r * 2 + k) * 3;
        P[i] = f.x + f.rx * side * ROAD_HALF - ax;
        P[i + 1] = f.y - ay;
        P[i + 2] = f.z + f.rz * side * ROAD_HALF - az;
        N[i] = nx;
        N[i + 1] = ny;
        N[i + 2] = nz;
        const u = (r * 2 + k) * 2;
        U[u] = k;
        U[u + 1] = vBase + (r * ROAD_ROW) / ROAD_TEX_PERIOD;
      }
      // rails
      for (let side = 0; side < 2; side++) {
        const sg = side === 0 ? -1 : 1;
        for (let k = 0; k < RP; k++) {
          const [off, h] = RAIL_PROFILE[k];
          const lat = sg * (RAIL_OFFSET + off);
          const i = ((side * ROAD_ROWS + r) * RP + k) * 3;
          R[i] = f.x + f.rx * lat - ax;
          R[i + 1] = f.y + h - ay;
          R[i + 2] = f.z + f.rz * lat - az;
        }
      }
    }
    pos.needsUpdate = nor.needsUpdate = uv.needsUpdate = rpos.needsUpdate = true;
    this.rails.geometry.computeVertexNormals();
  }

  private buildTerrain(start: number, ax: number, ay: number, az: number) {
    const track = runtime.track;
    const f = this.frame;
    const G = this.grid;
    const geo = this.terrain.geometry;
    const pos = geo.getAttribute('position') as BufferAttribute;
    const nor = geo.getAttribute('normal') as BufferAttribute;
    const col = geo.getAttribute('color') as BufferAttribute;
    const P = pos.array as Float32Array;
    const N = nor.array as Float32Array;
    const C = col.array as Float32Array;
    let v = 0;
    for (let side = -1; side <= 1; side += 2) {
      // grid of jittered vertex positions
      for (let r = 0; r < TERRAIN_ROWS; r++) {
        const s = start + r * TERRAIN_ROW;
        const row = Math.round(s / TERRAIN_ROW);
        track.frame(s, f);
        sideParams(s, side, this.sp);
        for (let j = 0; j < NC; j++) {
          let lat = COLS[j];
          let h = columnHeight(s, side, j, this.sp);
          let js = 0;
          if (j >= 2) {
            const span = (COLS[Math.min(j + 1, NC - 1)] - COLS[j - 1]) * 0.22;
            lat += vertexJitter(row, j, side, 0) * span;
            h += vertexJitter(row, j, side, 1) * (0.5 + Math.abs(h) * 0.05);
            js = vertexJitter(row, j, side, 2) * 1.6;
          }
          lat *= side;
          const gi = (r * NC + j) * 3;
          G[gi] = f.x + f.rx * lat + f.fx * js - ax;
          G[gi + 1] = f.y + h - ay;
          G[gi + 2] = f.z + f.rz * lat + f.fz * js - az;
        }
      }
      // faces
      for (let r = 0; r < TERRAIN_ROWS - 1; r++) {
        const row = Math.round((start + r * TERRAIN_ROW) / TERRAIN_ROW);
        for (let j = 0; j < NC - 1; j++) {
          const a = (r * NC + j) * 3;
          const b = (r * NC + j + 1) * 3;
          const c = ((r + 1) * NC + j) * 3;
          const d = ((r + 1) * NC + j + 1) * 3;
          const tris = side > 0 ? [a, b, c, b, d, c] : [a, c, b, b, c, d];
          for (let t = 0; t < 2; t++) {
            const i0 = tris[t * 3];
            const i1 = tris[t * 3 + 1];
            const i2 = tris[t * 3 + 2];
            const e1x = G[i1] - G[i0];
            const e1y = G[i1 + 1] - G[i0 + 1];
            const e1z = G[i1 + 2] - G[i0 + 2];
            const e2x = G[i2] - G[i0];
            const e2y = G[i2 + 1] - G[i0 + 1];
            const e2z = G[i2 + 2] - G[i0 + 2];
            let nx = e1y * e2z - e1z * e2y;
            let ny = e1z * e2x - e1x * e2z;
            let nz = e1x * e2y - e1y * e2x;
            const l = Math.hypot(nx, ny, nz) || 1;
            nx /= l;
            ny /= l;
            nz /= l;
            // colour by steepness
            const hv = hash(row, j * 2 + t, side + 5);
            let cc: Color;
            if (j === 0) cc = VERGE[Math.floor(hv * VERGE.length)];
            else {
              const rockness = smoothstep(0.8, 0.55, ny);
              cc = hash(row, j, side + 9) < rockness ? ROCK[Math.floor(hv * ROCK.length)] : GRASS[Math.floor(hv * GRASS.length)];
            }
            const shade = j >= 9 ? 0.9 : 1;
            for (const ii of [i0, i1, i2]) {
              P[v] = G[ii];
              P[v + 1] = G[ii + 1];
              P[v + 2] = G[ii + 2];
              N[v] = nx;
              N[v + 1] = ny;
              N[v + 2] = nz;
              C[v] = cc.r * shade;
              C[v + 1] = cc.g * shade;
              C[v + 2] = cc.b * shade;
              v += 3;
            }
          }
        }
      }
    }
    pos.needsUpdate = nor.needsUpdate = col.needsUpdate = true;
  }

  private setInstance(mesh: InstancedMesh, i: number, x: number, y: number, z: number, yaw: number, scale: number, sy = scale, pitch = 0, roll = 0) {
    _e.set(pitch, yaw, roll, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(scale, sy, scale);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
  }

  private buildProps(start: number, ax: number, ay: number, az: number) {
    const track = runtime.track;
    const f = this.frame2;
    const end = start + VIEW_TOTAL;

    // guard rail posts
    let n = 0;
    for (let s = Math.ceil(start / POST_SPACING) * POST_SPACING; s <= end; s += POST_SPACING) {
      track.frame(s, f);
      for (const side of [-1, 1]) {
        const lat = side * (RAIL_OFFSET + 0.17);
        this.setInstance(this.posts, n++, f.x + f.rx * lat - ax, f.y - ay, f.z + f.rz * lat - az, -f.heading, 1);
      }
    }
    this.posts.count = n;
    this.posts.instanceMatrix.needsUpdate = true;

    // vegetation + rocks
    const palmN = [0, 0];
    let rockN = 0;
    let bushN = 0;
    const palmCap = this.palms[0].instanceMatrix.count;
    const rockCap = this.rocks.instanceMatrix.count;
    const bushCap = this.bushes.instanceMatrix.count;
    const dense = this.quality === 'high';
    const place = (s: number, lat: number) => {
      track.frame(s, f);
      _p.set(f.x + f.rx * lat - ax, f.y + terrainHeight(s, lat) - ay, f.z + f.rz * lat - az);
      return _p;
    };
    for (let k = Math.ceil(start / SLOT); k * SLOT <= end; k++) {
      for (const side of [-1, 1]) {
        const H = (salt: number) => hash(k, side + 3, salt);
        // palms right behind the guard rail
        if (H(1) < (dense ? 0.17 : 0.12)) {
          const s = k * SLOT + H(2) * 6;
          const lat = side * (8.0 + H(3) * 2.6);
          const v = H(4) < 0.5 ? 0 : 1;
          if (palmN[v] < palmCap) {
            const p = place(s, lat);
            this.setInstance(this.palms[v], palmN[v]++, p.x, p.y - 0.25, p.z, H(5) * Math.PI * 2, 0.9 + H(6) * 0.45);
          }
        }
        // palms on the cliff tops / hills
        if (H(7) < (dense ? 0.22 : 0.14)) {
          const s = k * SLOT + H(8) * 6;
          const lat = side * (21 + H(9) * 26);
          const v = H(10) < 0.5 ? 0 : 1;
          if (palmN[v] < palmCap) {
            const p = place(s, lat);
            this.setInstance(this.palms[v], palmN[v]++, p.x, p.y - 0.4, p.z, H(11) * Math.PI * 2, 1 + H(12) * 0.5);
          }
        }
        // boulders at the cliff base
        if (H(13) < 0.3 && rockN < rockCap) {
          const s = k * SLOT + H(14) * 6;
          const lat = side * (10.6 + H(15) * 2.4);
          const p = place(s, lat);
          const sc = 1.2 + H(16) * 2.0;
          this.setInstance(this.rocks, rockN++, p.x, p.y + sc * 0.15, p.z, H(17) * 6.28, sc, sc * (0.8 + H(18) * 0.6), H(19) - 0.5, H(20) - 0.5);
        }
        // big rocks up the slopes
        if (H(21) < 0.14 && rockN < rockCap) {
          const s = k * SLOT + H(22) * 6;
          const lat = side * (26 + H(23) * 50);
          const p = place(s, lat);
          const sc = 2.5 + H(24) * 4;
          this.setInstance(this.rocks, rockN++, p.x, p.y, p.z, H(25) * 6.28, sc, sc * (0.7 + H(26) * 0.5), H(27) - 0.5, 0);
        }
        // bushes on the verge
        if (H(28) < 0.5 && bushN < bushCap) {
          const s = k * SLOT + H(29) * 6;
          const lat = side * (7.6 + H(30) * 1.8);
          const p = place(s, lat);
          const sc = 0.55 + H(31) * 0.5;
          this.setInstance(this.bushes, bushN++, p.x, p.y - 0.1, p.z, H(32) * 6.28, sc, sc * 0.8);
        }
        // shrubs on the slopes
        if (H(33) < (dense ? 0.55 : 0.3) && bushN < bushCap) {
          const s = k * SLOT + H(34) * 6;
          const lat = side * (22 + H(35) * 60);
          const p = place(s, lat);
          const sc = 1.2 + H(36) * 1.4;
          this.setInstance(this.bushes, bushN++, p.x, p.y - 0.2, p.z, H(37) * 6.28, sc, sc * 0.8);
        }
      }
    }
    this.palms[0].count = palmN[0];
    this.palms[1].count = palmN[1];
    this.rocks.count = rockN;
    this.bushes.count = bushN;
    for (const m of [...this.palms, this.rocks, this.bushes]) m.instanceMatrix.needsUpdate = true;

    // chevron signs on the outside of bends
    const chevN = [0, 0];
    let postN = 0;
    for (let k = Math.ceil(start / 20); k * 20 <= end; k++) {
      const s = k * 20;
      const curv = track.curvature(s);
      if (Math.abs(curv) < 0.0019) continue;
      track.frame(s, f);
      const turnRight = curv > 0;
      const dirIdx = turnRight ? 0 : 1; // 0: ">>" texture
      const sides = [turnRight ? -1 : 1];
      if (hash(k, 77) < 0.45) sides.push(-sides[0]);
      for (const side of sides) {
        if (chevN[dirIdx] >= this.chevrons[dirIdx].instanceMatrix.count) continue;
        if (postN + 2 > this.signPosts.instanceMatrix.count) continue;
        const lat = side * 7.25;
        const x = f.x + f.rx * lat - ax;
        const z = f.z + f.rz * lat - az;
        const y = f.y - ay;
        this.setInstance(this.chevrons[dirIdx], chevN[dirIdx]++, x, y + 1.3, z, -f.heading, 1);
        for (const off of [-0.5, 0.5]) {
          this.setInstance(this.signPosts, postN++, x + f.rx * off, y, z + f.rz * off, -f.heading, 1, 1.3);
        }
      }
    }
    this.chevrons[0].count = chevN[0];
    this.chevrons[1].count = chevN[1];
    this.signPosts.count = postN;
    for (const m of [...this.chevrons, this.signPosts]) m.instanceMatrix.needsUpdate = true;
    if (this.rocks.instanceColor) this.rocks.instanceColor.needsUpdate = true;
    if (this.bushes.instanceColor) this.bushes.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const m of [this.posts, ...this.palms, this.rocks, this.bushes, ...this.chevrons, this.signPosts]) m.dispose();
  }
}
