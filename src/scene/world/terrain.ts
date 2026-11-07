import { ROAD_HALF } from '../../game/config';
import { hash, noise1, smoothstep } from '../../game/noise';

/**
 * Cross-section of the roadside terrain. Columns are lateral distances from the road centre.
 * Heights are relative to the road surface at the same s.
 *
 * Left side (-1): mountain side with tall faceted cliffs topped with grass.
 * Right side (+1): sea side; alternates between rocky banks and open sections that fall away
 * toward the coast so the city / ocean stay visible.
 */
export const COLS = [ROAD_HALF, 7.9, 9.6, 12.2, 15.2, 19, 24, 31, 40, 52, 68, 90, 120, 160];

export interface SideParams {
  cliff: number; // cliff height
  open: number; // 0..1, how much the far terrain falls away (sea side)
}

export function sideParams(s: number, side: number, out: SideParams): SideParams {
  const k = side < 0 ? 0 : 1;
  const big = noise1(s / 210 + k * 37.1, 11);
  const mid = noise1(s / 64 + k * 13.7, 12);
  if (side < 0) {
    out.cliff = 5 + 10 * big + 4 * mid;
    out.open = 0;
  } else {
    const rocky = smoothstep(0.38, 0.78, big);
    out.cliff = 2 + 9 * rocky + 3 * mid * rocky;
    out.open = 1 - rocky * 0.7;
  }
  return out;
}

/** Height of column j (no jitter). */
export function columnHeight(s: number, side: number, j: number, p: SideParams): number {
  const c = p.cliff;
  const k = side < 0 ? 0 : 1;
  const wob = (noise1(s / 23 + j * 3.1 + k * 50, 21) - 0.5) * 2;
  switch (j) {
    case 0:
      return -0.04;
    case 1:
      return 0.05 + 0.08 * wob;
    case 2:
      return 0.3 + 0.25 * wob;
    case 3:
      return 0.12 * c + 0.4 * wob;
    case 4:
      return 0.55 * c + 0.6 * wob;
    case 5:
      return 0.9 * c + 0.6 * wob;
    case 6:
      return c + 1.2 + 0.8 * wob;
    default: {
      const far = j - 6; // 1..7
      const rise = c + 1.5 + far * far * 0.55 + far * 2.2 + wob * 2.5;
      if (side < 0) return rise + far * 1.5;
      const fall = c + 0.5 - far * far * 1.25 - far * 3 + wob * 1.5;
      return rise * (1 - p.open) + fall * p.open;
    }
  }
}

const tmpP: SideParams = { cliff: 0, open: 0 };

/** Smooth terrain height at an arbitrary lateral distance (|lateral| >= ROAD_HALF). */
export function terrainHeight(s: number, lateral: number): number {
  const side = lateral < 0 ? -1 : 1;
  const a = Math.abs(lateral);
  sideParams(s, side, tmpP);
  if (a <= COLS[0]) return 0;
  for (let j = 0; j < COLS.length - 1; j++) {
    if (a <= COLS[j + 1]) {
      const t = (a - COLS[j]) / (COLS[j + 1] - COLS[j]);
      return columnHeight(s, side, j, tmpP) * (1 - t) + columnHeight(s, side, j + 1, tmpP) * t;
    }
  }
  return columnHeight(s, side, COLS.length - 1, tmpP);
}

/** Deterministic per-vertex jitter for the low-poly look. */
export function vertexJitter(row: number, j: number, side: number, axis: number): number {
  return hash(row, j * 7 + (side < 0 ? 0 : 3), axis) - 0.5;
}
