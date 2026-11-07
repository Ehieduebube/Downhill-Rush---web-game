import { LANES, SPAWN_AHEAD } from './config';
import { clamp, lerp, mulberry32, smoothstep } from './noise';
import { OBSTACLE_SPECS, ObstacleType, PowerUpKind, runtime } from './runtime';
import { makeFrame } from './track';

/**
 * Procedural, pattern based obstacle + coin generation.
 *
 * Fairness rules:
 *  - every row leaves at least one way through: a free lane, a jumpable obstacle or a slide gap
 *  - rows are separated in *time* (spacing scales with speed) so lane changes are always possible
 *  - coins are never placed inside an obstacle's volume
 */

type Jumpable = 'cone' | 'barricade' | 'rock';
const frame = makeFrame();

export class Spawner {
  enabled = false;
  nextS = 0;
  private lastRowEnd = -1e9;
  private lane = 1; // lane the player is expected to be in when the next pattern starts
  private rng = mulberry32(runtime.seed ^ 0x5bd1e995);
  /** Distance-ish budget before the next power-up may appear (decreases per pattern). */
  private powerCooldown = 0;
  private lastKind: PowerUpKind | null = null;
  private difficulty = 0;

  reset(startS: number, playerX: number) {
    this.nextS = startS;
    this.lastRowEnd = startS - 50;
    this.lane = playerX < -1.6 ? 0 : playerX > 1.6 ? 2 : 1;
    this.powerCooldown = 300;
    this.lastKind = null;
  }

  update(playerS: number, difficulty: number, speed: number) {
    if (!this.enabled) return;
    let guard = 0;
    while (this.nextS < playerS + SPAWN_AHEAD && guard++ < 20) {
      const s0 = this.nextS;
      const len = this.pattern(s0, difficulty, Math.max(speed, 20));
      const gapTime = lerp(2.2, 1.18, difficulty) + this.rng() * lerp(0.9, 0.3, difficulty);
      this.nextS = s0 + len + Math.max(26, Math.max(speed, 20) * gapTime);
    }
  }

  // ---------------------------------------------------------------- helpers
  private r() {
    return this.rng();
  }
  private pickInt(n: number) {
    return Math.floor(this.rng() * n) % n;
  }

  private obstacle(type: ObstacleType, s: number, x: number, yaw = 0, variant = 0) {
    const o = runtime.obstacles.find((it) => !it.active);
    if (!o) return;
    const spec = OBSTACLE_SPECS[type];
    o.active = true;
    o.type = type;
    o.s = s;
    o.x = x;
    o.hs = spec.hs;
    o.hx = spec.hx;
    o.y0 = spec.y0;
    o.y1 = spec.y1;
    o.yaw = yaw;
    o.variant = variant;
    o.hit = false;
    o.kt = 0;
    runtime.track.frame(s, frame);
    o.px = frame.x + frame.rx * x;
    o.py = frame.y;
    o.pz = frame.z + frame.rz * x;
    o.heading = frame.heading;
    o.pitch = Math.atan(frame.slope);
    this.lastRowEnd = Math.max(this.lastRowEnd, s + spec.hs);
  }

  private blocked(s: number, x: number, y: number) {
    for (const o of runtime.obstacles) {
      if (!o.active) continue;
      if (Math.abs(o.s - s) < o.hs + 1.0 && Math.abs(o.x - x) < o.hx + 0.75 && y + 0.55 > o.y0 && y - 0.55 < o.y1)
        return true;
    }
    return false;
  }

  private coin(s: number, x: number, y: number) {
    if (this.blocked(s, x, y)) return;
    const c = runtime.coins.find((it) => !it.active);
    if (!c) return;
    c.active = true;
    c.magnet = false;
    c.collected = false;
    c.ct = 0;
    c.s = s;
    c.x = x;
    c.y = y;
    c.phase = s * 0.37;
    runtime.track.frame(s, frame);
    c.px = frame.x + frame.rx * x;
    c.py = frame.y + y;
    c.pz = frame.z + frame.rz * x;
  }

  /**
   * Places one power-up in a free lane. Fair spawning: a shared cooldown spaces them out,
   * only one can be waiting on the road at a time, a kind that is already active (or was
   * the last one offered) is skipped, and the speed boost isn't offered at top difficulty.
   */
  private powerUp(s: number, x: number) {
    if (this.powerCooldown > 0) return;
    if (runtime.powerups.some((it) => it.active && !it.collected)) return;
    if (this.blocked(s, x, 1.1)) return;
    const p = runtime.player;
    const weights: [PowerUpKind, number][] = [
      ['shield', p.shieldT > 0 ? 0 : 1],
      ['magnet', p.magnetT > 0 ? 0 : 1.2],
      ['boost', p.boostT > 0 || this.difficulty > 0.85 ? 0 : 0.95],
    ];
    for (const w of weights) if (w[0] === this.lastKind) w[1] *= 0.25;
    const total = weights.reduce((a, [, w]) => a + w, 0);
    if (total <= 0) return;
    let r = this.r() * total;
    let kind: PowerUpKind = 'shield';
    for (const [k, w] of weights) {
      r -= w;
      if (r <= 0) {
        kind = k;
        break;
      }
    }
    const pu = runtime.powerups.find((it) => !it.active);
    if (!pu) return;
    pu.active = true;
    pu.kind = kind;
    this.lastKind = kind;
    pu.collected = false;
    pu.ct = 0;
    pu.s = s;
    pu.x = x;
    pu.y = 1.15;
    runtime.track.frame(s, frame);
    pu.px = frame.x + frame.rx * x;
    pu.py = frame.y + pu.y;
    pu.pz = frame.z + frame.rz * x;
    this.powerCooldown = 360 + this.r() * 360;
  }

  /** Straight / curving coin trail moving from laneA to laneB. */
  private coinTrail(sA: number, sB: number, laneA: number, laneB: number, y = 1.0, spacing = 3.3) {
    const start = Math.max(sA, this.savedRowEnd + 4);
    const span = Math.max(sB - start, 1);
    for (let s = start; s <= sB + 0.01; s += spacing) {
      const t = (s - start) / span;
      const x = lerp(LANES[laneA], LANES[laneB], smoothstep(0, 0.6, t));
      this.coin(s, x, y);
    }
  }

  /** Arc of coins following a jump parabola centred on sC. */
  private coinArc(sC: number, lane: number, peak = 1.75) {
    for (let i = -4; i <= 4; i++) {
      const s = sC + i * 2.5;
      const k = i / 4.6;
      this.coin(s, LANES[lane], 1.0 + peak * (1 - k * k));
    }
  }

  /** End of the previous pattern's last row; coin trails start after it. */
  private savedRowEnd = -1e9;

  private jumpable(d: number): Jumpable {
    const r = this.r();
    if (r < 0.34) return 'cone';
    if (r < 0.72 || d < 0.1) return 'barricade';
    return 'rock';
  }

  /** Block a single lane with an obstacle of the given type. */
  private blockLane(type: ObstacleType, s: number, lane: number) {
    const x = LANES[lane];
    switch (type) {
      case 'cone':
        for (const off of [-1.1, 0, 1.1]) this.obstacle('cone', s + (this.r() - 0.5) * 0.6, x + off, this.r() * 6);
        break;
      case 'rock':
        this.obstacle('rock', s, x + (this.r() - 0.5) * 0.4, this.r() * 6, this.pickInt(3));
        break;
      default:
        this.obstacle(type, s, x, 0, this.pickInt(2));
    }
  }

  // --------------------------------------------------------------- patterns
  private pattern(s0: number, d: number, speed: number): number {
    this.savedRowEnd = this.lastRowEnd;
    if (this.powerCooldown > 0) this.powerCooldown -= 60;
    this.difficulty = d;

    const options: [number, () => number][] = [
      [1.1 - 0.6 * d, () => this.single(s0, d)],
      [d > 0.04 ? 0.5 + 0.7 * d : 0, () => this.double(s0, d)],
      [d > 0.06 ? 0.35 + 0.3 * d : 0, () => this.jumpWall(s0, d)],
      [d > 0.1 ? 0.3 + 0.3 * d : 0, () => this.slideWall(s0)],
      [d > 0.22 ? 0.55 * d : 0, () => this.slalom(s0, d, speed)],
      [d > 0.38 ? 0.65 * d : 0, () => this.combo(s0, d, speed)],
      [0.38 - 0.22 * d, () => this.coinsOnly(s0)],
    ];
    let total = 0;
    for (const [w] of options) total += Math.max(w, 0);
    let r = this.r() * total;
    for (const [w, fn] of options) {
      r -= Math.max(w, 0);
      if (r <= 0) return fn();
    }
    return this.single(s0, d);
  }

  private single(s0: number, d: number) {
    const lane = this.pickInt(3);
    const type: ObstacleType = d > 0.18 && this.r() < 0.3 ? 'roadblock' : this.jumpable(d);
    this.blockLane(type, s0, lane);
    const jumpable = type !== 'roadblock';
    if (jumpable && this.r() < 0.45) {
      this.coinArc(s0, lane);
      this.lane = lane;
    } else {
      let free = this.pickInt(3);
      if (free === lane) free = (lane + 1 + this.pickInt(2)) % 3;
      this.coinTrail(s0 - 26, s0 + 8, this.lane, free);
      this.lane = free;
      if (this.r() < 0.4) this.powerUp(s0 + 14, LANES[free]);
    }
    return 2;
  }

  private double(s0: number, d: number) {
    // Prefer free lanes the player can reach comfortably
    let free = this.pickInt(3);
    if (Math.abs(free - this.lane) === 2 && this.r() < 0.6) free = 1;
    for (let l = 0; l < 3; l++) {
      if (l === free) continue;
      const tall = d > 0.25 ? this.r() < 0.55 : this.r() < 0.2;
      this.blockLane(tall ? 'roadblock' : this.jumpable(d), s0 + (this.r() - 0.5) * 1.5, l);
    }
    this.coinTrail(s0 - 28, s0 + 10, this.lane, free);
    if (this.r() < 0.3) this.powerUp(s0 + 16, LANES[free]);
    this.lane = free;
    return 3;
  }

  private jumpWall(s0: number, d: number) {
    const r = this.r();
    if (r < 0.34 && d > 0.12) {
      this.obstacle('gap', s0, 0, 0, this.pickInt(2));
    } else if (r < 0.62) {
      this.obstacle('log', s0, 0, 0, this.pickInt(2));
    } else if (r < 0.82) {
      for (let l = 0; l < 3; l++) this.obstacle('barricade', s0, LANES[l], 0, this.pickInt(2));
    } else {
      for (let l = 0; l < 3; l++) this.blockLane('cone', s0, l);
    }
    this.coinArc(s0, this.lane, 1.85);
    return 4;
  }

  private slideWall(s0: number) {
    this.obstacle('overhead', s0, 0, 0, this.pickInt(2));
    for (let s = s0 - 9; s <= s0 + 7; s += 2.6) this.coin(s, LANES[this.lane], 0.55);
    return 2;
  }

  private slalom(s0: number, d: number, speed: number) {
    const rows = 3 + (d > 0.6 ? 1 : 0);
    const step = Math.max(17, speed * 0.78);
    let lane = this.r() < 0.5 ? 0 : 2;
    let free = this.lane;
    for (let i = 0; i < rows; i++) {
      const s = s0 + i * step;
      this.blockLane(this.r() < 0.6 ? 'cone' : 'barricade', s, lane);
      // weave coins through the lane on the opposite side of the blocker
      const target = lane === 0 ? 2 : lane === 2 ? 0 : this.r() < 0.5 ? 0 : 2;
      const prevEnd = this.savedRowEnd;
      this.savedRowEnd = i === 0 ? prevEnd : s - step + 1;
      this.coinTrail(s - step * 0.85, s + 3, free, target, 1.0, 3.0);
      free = target;
      lane = lane === 0 ? 2 : 0;
      if (i === 1 && this.r() < 0.4) lane = 1;
    }
    this.lane = free;
    return (rows - 1) * step + 2;
  }

  private combo(s0: number, d: number, speed: number) {
    let free = this.pickInt(3);
    if (Math.abs(free - this.lane) === 2) free = 1;
    for (let l = 0; l < 3; l++) if (l !== free) this.blockLane('roadblock', s0, l);
    this.coinTrail(s0 - 26, s0 + 4, this.lane, free);
    const s1 = s0 + Math.max(19, speed * clamp(lerp(0.85, 0.68, d), 0.6, 1));
    this.savedRowEnd = s0 + 1;
    if (this.r() < 0.5) {
      this.blockLane(this.jumpable(d), s1, free);
      this.coinArc(s1, free, 1.7);
    } else {
      this.obstacle('overhead', s1, 0, 0, this.pickInt(2));
      for (let s = s1 - 8; s <= s1 + 6; s += 2.6) this.coin(s, LANES[free], 0.55);
    }
    this.lane = free;
    return s1 - s0 + 2;
  }

  private coinsOnly(s0: number) {
    let target = this.pickInt(3);
    if (target === this.lane) target = (target + 1) % 3;
    this.coinTrail(s0 - 20, s0 + 24, this.lane, target, 1.0, 3.0);
    if (this.r() < 0.7) this.powerUp(s0 + 30, LANES[target]);
    this.lane = target;
    return 26;
  }
}
