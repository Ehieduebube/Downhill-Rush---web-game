import { Vector3 } from 'three';
import { mulberry32 } from './noise';

/**
 * The track is an endless procedural centre line described in "track space":
 *   s       distance travelled along the road (metres)
 *   lateral signed offset to the right of the centre line
 *   height  height above the road surface
 *
 * Heading and elevation are analytic functions of s (sums of sinusoids), so the road
 * curves gently left/right while always descending. The horizontal centre line is
 * integrated incrementally and cached in a sliding window of samples.
 */
export interface TrackFrame {
  x: number;
  y: number;
  z: number;
  heading: number; // 0 = facing -Z
  fx: number; // horizontal forward
  fz: number;
  rx: number; // horizontal right
  rz: number;
  slope: number; // dy/ds (negative = downhill)
  curvature: number; // d(heading)/ds, positive = turning right
}

export const makeFrame = (): TrackFrame => ({
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  fx: 0,
  fz: -1,
  rx: 1,
  rz: 0,
  slope: 0,
  curvature: 0,
});

const STEP = 1;

export class Track {
  private xs: number[] = [0];
  private zs: number[] = [0];
  private base = 0;
  private readonly h: [number, number, number][];
  private readonly g: [number, number, number][];
  private readonly grade0 = 0.095;
  private readonly yOffset: number;

  constructor(seed: number) {
    const rnd = mulberry32(seed);
    const p = () => rnd() * Math.PI * 2;
    // [amplitude (rad), frequency (1/m), phase]
    this.h = [
      [0.3, 1 / 250, p()],
      [0.16, 1 / 107, p()],
      [0.06, 1 / 51, p()],
    ];
    // grade variation [amplitude, frequency, phase] around grade0
    this.g = [
      [0.03, 1 / 330, p()],
      [0.014, 1 / 88, p()],
    ];
    this.yOffset = 0;
    this.yOffset = -this.elevation(0);
  }

  heading(s: number): number {
    let v = 0;
    for (const [a, f, ph] of this.h) v += a * Math.sin(s * f + ph);
    return v;
  }

  curvature(s: number): number {
    let v = 0;
    for (const [a, f, ph] of this.h) v += a * f * Math.cos(s * f + ph);
    return v;
  }

  /** Positive downhill grade at s (always > 0). */
  grade(s: number): number {
    let v = this.grade0;
    for (const [a, f, ph] of this.g) v += a * Math.sin(s * f + ph);
    return v;
  }

  elevation(s: number): number {
    // y = -integral(grade)
    let v = this.grade0 * s;
    for (const [a, f, ph] of this.g) v -= (a / f) * Math.cos(s * f + ph);
    return -v + this.yOffset;
  }

  private ensure(index: number) {
    let last = this.base + this.xs.length - 1;
    while (last < index) {
      const th = this.heading((last + 0.5) * STEP);
      const n = this.xs.length - 1;
      this.xs.push(this.xs[n] + Math.sin(th) * STEP);
      this.zs.push(this.zs[n] - Math.cos(th) * STEP);
      last++;
    }
  }

  frame(s: number, out: TrackFrame): TrackFrame {
    const fi = Math.max(s, this.base * STEP) / STEP;
    const i = Math.floor(fi);
    this.ensure(i + 1);
    const t = fi - i;
    const k = i - this.base;
    out.x = this.xs[k] + (this.xs[k + 1] - this.xs[k]) * t;
    out.z = this.zs[k] + (this.zs[k + 1] - this.zs[k]) * t;
    out.y = this.elevation(s);
    const th = this.heading(s);
    out.heading = th;
    out.fx = Math.sin(th);
    out.fz = -Math.cos(th);
    out.rx = Math.cos(th);
    out.rz = Math.sin(th);
    out.slope = -this.grade(s);
    out.curvature = this.curvature(s);
    return out;
  }

  /** World position of a track-space point. */
  point(s: number, lateral: number, height: number, out: Vector3, frame: TrackFrame = scratch): Vector3 {
    this.frame(s, frame);
    out.set(frame.x + frame.rx * lateral, frame.y + height, frame.z + frame.rz * lateral);
    return out;
  }

  /** Drop every cached sample (used when a fresh run restarts at the start line). */
  reset() {
    this.xs = [0];
    this.zs = [0];
    this.base = 0;
  }

  /** Forget samples far behind the player to keep memory bounded. */
  trim(sMin: number) {
    const idx = Math.floor(sMin / STEP) - 4;
    const drop = idx - this.base;
    if (drop > 4000) {
      this.xs.splice(0, drop);
      this.zs.splice(0, drop);
      this.base += drop;
    }
  }
}

const scratch = makeFrame();
