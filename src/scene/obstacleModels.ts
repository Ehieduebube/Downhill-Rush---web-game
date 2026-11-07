import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Shape,
  SRGBColorSpace,
  Texture,
} from 'three';
import { mulberry32 } from '../game/noise';
import type { ObstacleType } from '../game/runtime';
import { coneGeometry, rockGeometry } from './geometries';
import { clearanceTexture, closedSignTexture, stripeTexture } from './textures';

/** Shared geometry/material kit for obstacle models. */
export class ObstacleKit {
  private geos: BufferGeometry[] = [];
  private mats: Material[] = [];
  private texs: Texture[] = [];
  readonly lampMat: MeshStandardMaterial;
  private m: Record<string, Material> = {};
  private g: Record<string, BufferGeometry> = {};

  constructor() {
    const M = <T extends Material>(k: string, mat: T) => {
      this.mats.push(mat);
      this.m[k] = mat;
      return mat;
    };
    const G = <T extends BufferGeometry>(k: string, geo: T) => {
      this.geos.push(geo);
      this.g[k] = geo;
      return geo;
    };
    const stripes = stripeTexture().clone();
    stripes.repeat.set(3, 1);
    stripes.needsUpdate = true;
    this.texs.push(stripes);

    M('cone', new MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
    M('stripe', new MeshStandardMaterial({ map: stripes, roughness: 0.5 }));
    M('white', new MeshStandardMaterial({ color: '#f1edf3', roughness: 0.5 }));
    M('orange', new MeshStandardMaterial({ color: '#ff6418', roughness: 0.45 }));
    M('dark', new MeshStandardMaterial({ color: '#3a3344', roughness: 0.7, metalness: 0.2 }));
    M('metal', new MeshStandardMaterial({ color: '#b9b2c9', roughness: 0.35, metalness: 0.7 }));
    M('rock', new MeshStandardMaterial({ color: '#b5705c', roughness: 0.9, flatShading: true }));
    M('closed', new MeshStandardMaterial({ map: closedSignTexture(), roughness: 0.5 }));
    M('clear', new MeshStandardMaterial({ map: clearanceTexture(), roughness: 0.5, side: DoubleSide }));
    M('pit', new MeshBasicMaterial({ map: this.pitTexture(), alphaTest: 0.5, transparent: false }));
    M('rubble', new MeshStandardMaterial({ color: '#4a4152', roughness: 0.95, flatShading: true }));
    this.lampMat = M(
      'lamp',
      new MeshStandardMaterial({ color: '#ffb01f', emissive: new Color('#ff9a00'), emissiveIntensity: 1.2, roughness: 0.3 }),
    );

    G('cone', coneGeometry());
    G('board', new BoxGeometry(2.7, 0.24, 0.05));
    G('leg', new BoxGeometry(0.06, 1.1, 0.06));
    G('lamp', new CylinderGeometry(0.07, 0.07, 0.1, 10));
    G('barrierBlock', this.barrierBlock());
    G('post', new BoxGeometry(0.12, 1, 0.12));
    G('signBoard', new BoxGeometry(3.1, 0.95, 0.06));
    G('log', new CylinderGeometry(0.3, 0.36, 11.6, 9, 1));
    G('pit', new PlaneGeometry(13.8, 7.6));
    G('panel', new BoxGeometry(11.4, 1.25, 0.08));
    G('beam', new BoxGeometry(12.6, 0.16, 0.16));
    G('tallPost', new BoxGeometry(0.2, 3.1, 0.2));
    G('chain', new CylinderGeometry(0.015, 0.015, 0.55, 5));
    this.g.rock = rockGeometry(1);
    this.g.rubble = rockGeometry(2);
    // log colours (bands)
    {
      const log = this.g.log;
      const pos = log.getAttribute('position');
      const cols = new Float32Array(pos.count * 3);
      const a = new Color('#8a5a3c');
      const b = new Color('#6b452f');
      for (let i = 0; i < pos.count; i++) {
        const c = Math.floor((pos.getY(i) + 6) * 2.5) % 2 ? a : b;
        cols.set([c.r, c.g, c.b], i * 3);
      }
      log.setAttribute('color', new Float32BufferAttribute(cols, 3));
      M('log', new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }));
    }
  }

  private barrierBlock() {
    // plastic water-filled barrier profile, extruded across the lane
    const s = new Shape();
    s.moveTo(-0.3, 0);
    s.lineTo(0.3, 0);
    s.lineTo(0.22, 0.18);
    s.lineTo(0.13, 0.95);
    s.lineTo(-0.13, 0.95);
    s.lineTo(-0.22, 0.18);
    s.closePath();
    const g = new ExtrudeGeometry(s, { depth: 1.0, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
    g.rotateY(Math.PI / 2);
    g.translate(-0.5, 0, 0);
    g.computeVertexNormals();
    return g;
  }

  private pitTexture(): Texture {
    // 512 x 512 covering 13.8 m x 7.6 m. Top of the canvas = far side of the gap.
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d')!;
    const rnd = mulberry32(31);
    const hazard = (y0: number, y1: number) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y0, 512, y1 - y0);
      ctx.clip();
      ctx.fillStyle = '#ffc21f';
      ctx.fillRect(0, y0, 512, y1 - y0);
      ctx.fillStyle = '#231c2a';
      for (let x = -80; x < 600; x += 44) {
        ctx.beginPath();
        ctx.moveTo(x, y1);
        ctx.lineTo(x + 22, y1);
        ctx.lineTo(x + 22 + (y1 - y0), y0);
        ctx.lineTo(x + (y1 - y0), y0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    };
    hazard(62, 104);
    hazard(408, 450);
    // jagged opening (~4 m long)
    ctx.beginPath();
    const pts: [number, number][] = [];
    const N = 26;
    for (let i = 0; i <= N; i++) pts.push([(i / N) * 512, 116 + rnd() * 14]);
    for (let i = N; i >= 0; i--) pts.push([(i / N) * 512, 396 - rnd() * 14]);
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.closePath();
    // far wall (lit) falling into darkness
    const g = ctx.createLinearGradient(0, 116, 0, 400);
    g.addColorStop(0, '#c07a5e');
    g.addColorStop(0.16, '#8a5048');
    g.addColorStop(0.36, '#3e2438');
    g.addColorStop(0.7, '#170c1d');
    g.addColorStop(1, '#09050e');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,20,30,0.45)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      const y = 136 + i * 10 + rnd() * 4;
      ctx.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, y + (rnd() - 0.5) * 5);
      ctx.stroke();
    }
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    this.texs.push(tex);
    return tex;
  }

  private mesh(geo: string, mat: string, parent: Object3D, x = 0, y = 0, z = 0, cast = true) {
    const m = new Mesh(this.g[geo], this.m[mat]);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /** Build one pooled model. Local frame: +X right, -Z forward along the road, y=0 road surface. */
  build(type: ObstacleType): Group {
    const g = new Group();
    g.rotation.order = 'YXZ';
    switch (type) {
      case 'cone':
        this.mesh('cone', 'cone', g);
        break;
      case 'barricade': {
        this.mesh('board', 'stripe', g, 0, 0.98, 0);
        this.mesh('board', 'stripe', g, 0, 0.58, 0);
        for (const x of [-1.22, 1.22]) {
          for (const dz of [-1, 1]) {
            const leg = this.mesh('leg', 'white', g, x, 0.53, dz * 0.12);
            leg.rotation.x = dz * 0.22;
          }
        }
        this.mesh('lamp', 'lamp', g, -1.22, 1.16, 0, false);
        this.mesh('lamp', 'lamp', g, 1.22, 1.16, 0, false);
        break;
      }
      case 'roadblock': {
        for (let i = 0; i < 3; i++) this.mesh('barrierBlock', i % 2 ? 'white' : 'orange', g, -1.06 + i * 1.06, 0, 0);
        for (const x of [-1.2, 1.2]) this.mesh('post', 'dark', g, x, 1.45, 0.05).scale.set(1, 1.1, 1);
        this.mesh('signBoard', 'closed', g, 0, 1.95, 0);
        this.mesh('lamp', 'lamp', g, -1.45, 2.5, 0, false);
        this.mesh('lamp', 'lamp', g, 1.45, 2.5, 0, false);
        break;
      }
      case 'rock': {
        const r = this.mesh('rock', 'rock', g, 0, 0.42, 0);
        r.scale.set(1.25, 1.0, 0.95);
        const r2 = this.mesh('rubble', 'rock', g, 0.9, 0.12, 0.5);
        r2.scale.setScalar(0.35);
        break;
      }
      case 'log': {
        const l = this.mesh('log', 'log', g, 0, 0.32, 0);
        l.rotation.z = Math.PI / 2;
        for (const x of [-6.2, 6.2]) {
          const rr = this.mesh('rubble', 'rock', g, x, 0.2, 0.3);
          rr.scale.setScalar(0.5);
        }
        break;
      }
      case 'gap': {
        const pit = this.mesh('pit', 'pit', g, 0, 0.02, 0, false);
        pit.rotation.x = -Math.PI / 2;
        pit.receiveShadow = false;
        const rnd = mulberry32(5);
        for (let i = 0; i < 9; i++) {
          const rr = this.mesh('rubble', 'rubble', g, -6 + i * 1.5 + rnd(), 0.06, (rnd() < 0.5 ? -1 : 1) * (2.0 + rnd() * 0.2), false);
          rr.scale.set(0.25 + rnd() * 0.2, 0.12, 0.2 + rnd() * 0.15);
        }
        // warning cones at both road edges
        for (const x of [-6.1, 6.1]) {
          this.mesh('cone', 'cone', g, x, 0, 3.4);
          this.mesh('lamp', 'lamp', g, x, 0.78, 3.4, false);
        }
        break;
      }
      case 'overhead': {
        for (const x of [-6.15, 6.15]) this.mesh('tallPost', 'dark', g, x, 1.55, 0);
        this.mesh('beam', 'metal', g, 0, 3.05, 0);
        this.mesh('panel', 'clear', g, 0, 1.88, 0);
        for (const x of [-4.5, -1.5, 1.5, 4.5]) this.mesh('chain', 'metal', g, x, 2.78, 0, false);
        break;
      }
    }
    return g;
  }

  dispose() {
    this.geos.forEach((g) => g.dispose());
    this.mats.forEach((m) => m.dispose());
    this.texs.forEach((t) => t.dispose());
  }
}
