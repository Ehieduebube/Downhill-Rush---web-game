import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three';
import { ASPHALT_HALF, EDGE_LINE, LANE_WIDTH, ROAD_HALF, ROAD_TEX_PERIOD } from '../game/config';
import { mulberry32 } from '../game/noise';

// All textures are generated procedurally on a canvas once and cached.

const cache = new Map<string, Texture>();

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { c, ctx };
}

function finish(tex: CanvasTexture, srgb = true) {
  if (srgb) tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function cached(key: string, make: () => Texture) {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/** Road surface: asphalt, gravel shoulders, yellow edge lines and dashed lane lines. */
export function roadTexture(): Texture {
  return cached('road', () => {
    const W = 1024;
    const H = 1024;
    const { c, ctx } = canvas(W, H);
    const rnd = mulberry32(1234);
    const toU = (lat: number) => ((lat + ROAD_HALF) / (ROAD_HALF * 2)) * W;
    const pxPerM = H / ROAD_TEX_PERIOD;

    // asphalt base
    ctx.fillStyle = '#5b5266';
    ctx.fillRect(0, 0, W, H);
    // shoulders (concrete / gravel)
    const shoulderL = toU(-ASPHALT_HALF);
    const shoulderR = toU(ASPHALT_HALF);
    ctx.fillStyle = '#7d7088';
    ctx.fillRect(0, 0, shoulderL, H);
    ctx.fillRect(shoulderR, 0, W - shoulderR, H);
    // speckle noise
    for (let i = 0; i < 60000; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const v = rnd();
      const inShoulder = x < shoulderL || x > shoulderR;
      const l = inShoulder ? 124 + v * 60 : 70 + v * 36;
      ctx.fillStyle = `rgba(${l + 8},${l},${l + 14},${0.35 + rnd() * 0.4})`;
      const s = 1 + rnd() * 2.2;
      ctx.fillRect(x, y, s, s);
    }
    // tyre wear: darker bands in each lane
    for (const lane of [-LANE_WIDTH, 0, LANE_WIDTH]) {
      for (const off of [-0.85, 0.85]) {
        const u = toU(lane + off);
        const g = ctx.createLinearGradient(u - 22, 0, u + 22, 0);
        g.addColorStop(0, 'rgba(30,24,40,0)');
        g.addColorStop(0.5, 'rgba(30,24,40,0.22)');
        g.addColorStop(1, 'rgba(30,24,40,0)');
        ctx.fillStyle = g;
        ctx.fillRect(u - 22, 0, 44, H);
      }
    }
    // gutter lines at asphalt edge
    ctx.fillStyle = 'rgba(40,32,48,0.8)';
    ctx.fillRect(shoulderL - 2, 0, 4, H);
    ctx.fillRect(shoulderR - 2, 0, 4, H);

    const paint = (x: number, y: number, w: number, h: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      // worn paint
      for (let i = 0; i < (w * h) / 40; i++) {
        ctx.fillStyle = `rgba(80,72,90,${rnd() * 0.35})`;
        ctx.fillRect(x + rnd() * w, y + rnd() * h, 1.5, 1.5);
      }
    };
    // yellow edge lines (solid)
    const lineW = 0.17 * (W / (ROAD_HALF * 2));
    for (const side of [-1, 1]) paint(toU(side * EDGE_LINE) - lineW / 2, 0, lineW, H, '#f4b632');
    // white dashed lane separators: 4 m dash, 8 m gap
    const dashW = 0.15 * (W / (ROAD_HALF * 2));
    const dashLen = 4 * pxPerM;
    for (const side of [-1, 1]) {
      const u = toU((side * LANE_WIDTH) / 2);
      paint(u - dashW / 2, H * 0.1, dashW, dashLen, '#f4eff6');
    }
    const tex = new CanvasTexture(c);
    tex.wrapS = ClampToEdgeWrapping;
    tex.wrapT = RepeatWrapping;
    tex.anisotropy = 8;
    return finish(tex);
  });
}

/** Diagonal orange/white hazard stripes. */
export function stripeTexture(): Texture {
  return cached('stripe', () => {
    const { c, ctx } = canvas(256, 64);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#ff6a1a';
    for (let i = -2; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 40, 64);
      ctx.lineTo(i * 40 + 20, 64);
      ctx.lineTo(i * 40 + 20 + 32, 0);
      ctx.lineTo(i * 40 + 32, 0);
      ctx.closePath();
      ctx.fill();
    }
    // subtle grime
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(60,20,30,0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 64);
    const tex = new CanvasTexture(c);
    tex.wrapS = RepeatWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    return finish(tex);
  });
}

/** Black-and-yellow chevron sign ( >> pointing right ). */
export function chevronTexture(dir: 1 | -1): Texture {
  return cached(`chevron${dir}`, () => {
    const { c, ctx } = canvas(256, 128);
    ctx.fillStyle = '#1d1a22';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#ffc21f';
    ctx.fillRect(8, 8, 240, 112);
    ctx.fillStyle = '#1d1a22';
    for (const cx of [70, 150]) {
      ctx.beginPath();
      if (dir === 1) {
        ctx.moveTo(cx - 24, 18);
        ctx.lineTo(cx + 6, 18);
        ctx.lineTo(cx + 46, 64);
        ctx.lineTo(cx + 6, 110);
        ctx.lineTo(cx - 24, 110);
        ctx.lineTo(cx + 16, 64);
      } else {
        ctx.moveTo(cx + 46, 18);
        ctx.lineTo(cx + 16, 18);
        ctx.lineTo(cx - 24, 64);
        ctx.lineTo(cx + 16, 110);
        ctx.lineTo(cx + 46, 110);
        ctx.lineTo(cx + 6, 64);
      }
      ctx.closePath();
      ctx.fill();
    }
    return finish(new CanvasTexture(c));
  });
}

/** Building facade: light walls with window grid. `lit` variant is an emissive mask. */
export function windowTexture(lit: boolean): Texture {
  return cached(`windows${lit}`, () => {
    const { c, ctx } = canvas(64, 128);
    const rnd = mulberry32(99);
    ctx.fillStyle = lit ? '#000000' : '#ffffff';
    ctx.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 124; y += 10) {
      for (let x = 5; x < 60; x += 11) {
        const on = rnd() < 0.38;
        if (lit) {
          ctx.fillStyle = on ? (rnd() < 0.5 ? '#ffd58a' : '#ffe9b8') : '#000000';
        } else {
          ctx.fillStyle = on ? '#fff2d6' : '#8d7fa8';
        }
        ctx.fillRect(x, y, 7, 6);
      }
    }
    const tex = new CanvasTexture(c);
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    return finish(tex);
  });
}

/** Soft radial glow used for coin halos / sparkles. */
export function glowTexture(): Texture {
  return cached('glow', () => {
    const { c, ctx } = canvas(128, 128);
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return finish(new CanvasTexture(c));
  });
}

/** Soft dark blob for contact shadows. */
export function blobTexture(): Texture {
  return cached('blob', () => {
    const { c, ctx } = canvas(128, 128);
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return finish(new CanvasTexture(c), false);
  });
}

/** "ROAD CLOSED" style sign face for roadblocks. */
export function closedSignTexture(): Texture {
  return cached('closed', () => {
    const { c, ctx } = canvas(512, 160);
    // stripes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 160);
    ctx.fillStyle = '#ff5a14';
    for (let i = -3; i < 14; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 48, 160);
      ctx.lineTo(i * 48 + 24, 160);
      ctx.lineTo(i * 48 + 24 + 60, 0);
      ctx.lineTo(i * 48 + 60, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1d1a22';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(70, 40, 372, 80, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1d1a22';
    ctx.font = 'bold 54px Poppins, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ROAD CLOSED', 256, 82);
    return finish(new CanvasTexture(c));
  });
}

/** Overhead clearance sign: stripes with a "SLIDE" pictogram. */
export function clearanceTexture(): Texture {
  return cached('clearance', () => {
    const { c, ctx } = canvas(1024, 128);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1024, 128);
    ctx.fillStyle = '#ff5a14';
    for (let i = -3; i < 26; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 48, 128);
      ctx.lineTo(i * 48 + 24, 128);
      ctx.lineTo(i * 48 + 24 + 50, 0);
      ctx.lineTo(i * 48 + 50, 0);
      ctx.closePath();
      ctx.fill();
    }
    for (const cx of [256, 768]) {
      ctx.fillStyle = '#ffc21f';
      ctx.strokeStyle = '#1d1a22';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.roundRect(cx - 120, 22, 240, 84, 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1d1a22';
      ctx.font = 'bold 50px Poppins, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('▼ DUCK ▼', cx, 66);
    }
    return finish(new CanvasTexture(c));
  });
}
