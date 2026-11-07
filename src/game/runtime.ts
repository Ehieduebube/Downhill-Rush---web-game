import { Vector3 } from 'three';
import { START_S } from './config';
import { Track } from './track';

/**
 * Mutable per-frame game state. Kept outside React so the simulation can run every
 * frame without triggering re-renders. React components read from it in useFrame.
 */

export type ObstacleType = 'cone' | 'barricade' | 'roadblock' | 'rock' | 'log' | 'gap' | 'overhead';
export const OBSTACLE_TYPES: ObstacleType[] = ['cone', 'barricade', 'roadblock', 'rock', 'log', 'gap', 'overhead'];

export interface ObstacleSpec {
  hs: number; // half length along the road
  hx: number; // half width across the road
  y0: number; // bottom of the hit box above the road
  y1: number; // top of the hit box
  knockable: boolean;
}

export const OBSTACLE_SPECS: Record<ObstacleType, ObstacleSpec> = {
  cone: { hs: 0.26, hx: 0.3, y0: 0, y1: 0.72, knockable: true },
  barricade: { hs: 0.3, hx: 1.4, y0: 0, y1: 1.1, knockable: true },
  roadblock: { hs: 0.45, hx: 1.62, y0: 0, y1: 2.5, knockable: false },
  rock: { hs: 0.8, hx: 1.15, y0: 0, y1: 1.05, knockable: false },
  log: { hs: 0.32, hx: 5.8, y0: 0, y1: 0.62, knockable: false },
  gap: { hs: 2.1, hx: 6.8, y0: -6, y1: 0, knockable: false },
  overhead: { hs: 0.3, hx: 5.8, y0: 1.22, y1: 2.7, knockable: false },
};

export interface Obstacle {
  active: boolean;
  type: ObstacleType;
  s: number;
  x: number;
  hs: number;
  hx: number;
  y0: number;
  y1: number;
  yaw: number;
  variant: number;
  // cached world transform
  px: number;
  py: number;
  pz: number;
  heading: number;
  pitch: number;
  // knocked-away animation
  hit: boolean;
  kt: number;
  kvx: number;
  kvy: number;
  kvz: number;
  kspin: number;
}

export interface Coin {
  active: boolean;
  /** Being pulled toward the rider by the magnet. */
  magnet: boolean;
  s: number;
  x: number;
  y: number;
  px: number;
  py: number;
  pz: number;
  collected: boolean;
  ct: number;
  phase: number;
}

export type PowerUpKind = 'shield' | 'magnet' | 'boost';
export const POWERUP_KINDS: PowerUpKind[] = ['shield', 'magnet', 'boost'];

export interface PowerUp {
  active: boolean;
  kind: PowerUpKind;
  s: number;
  x: number;
  y: number;
  px: number;
  py: number;
  pz: number;
  collected: boolean;
  ct: number;
}

export type TrickKind = 'none' | 'kickflip' | 'spin';

export interface PlayerState {
  s: number;
  x: number;
  vx: number;
  y: number; // height above road
  vy: number;
  speed: number;
  grounded: boolean;
  airTime: number;
  sinceLand: number;
  landImpact: number;
  slideT: number;
  slideQueued: boolean;
  trick: TrickKind;
  trickT: number;
  trickDur: number;
  trickDir: number;
  airTricks: number;
  airBonus: number;
  crashed: boolean;
  crashT: number;
  crashKind: 'tumble' | 'fall';
  crashSide: number;
  crashSpeed: number;
  shieldT: number;
  magnetT: number;
  boostT: number;
  invulnT: number;
  steer: number; // -1..1 input
  autoSteer: number;
  wheelAngle: number;
}

const makeObstacle = (): Obstacle => ({
  active: false,
  type: 'cone',
  s: 0,
  x: 0,
  hs: 0,
  hx: 0,
  y0: 0,
  y1: 0,
  yaw: 0,
  variant: 0,
  px: 0,
  py: 0,
  pz: 0,
  heading: 0,
  pitch: 0,
  hit: false,
  kt: 0,
  kvx: 0,
  kvy: 0,
  kvz: 0,
  kspin: 0,
});

const makeCoin = (): Coin => ({
  active: false,
  magnet: false,
  s: 0,
  x: 0,
  y: 0,
  px: 0,
  py: 0,
  pz: 0,
  collected: false,
  ct: 0,
  phase: 0,
});

const makePowerUp = (): PowerUp => ({
  active: false,
  kind: 'shield',
  s: 0,
  x: 0,
  y: 0,
  px: 0,
  py: 0,
  pz: 0,
  collected: false,
  ct: 0,
});

export const MAX_OBSTACLES = 72;
export const MAX_COINS = 180;
export const MAX_POWERUPS = 4;

export const makePlayer = (): PlayerState => ({
  s: START_S,
  x: 0,
  vx: 0,
  y: 0,
  vy: 0,
  speed: 0,
  grounded: true,
  airTime: 0,
  sinceLand: 10,
  landImpact: 0,
  slideT: 0,
  slideQueued: false,
  trick: 'none',
  trickT: 0,
  trickDur: 0,
  trickDir: 1,
  airTricks: 0,
  airBonus: 0,
  crashed: false,
  crashT: 0,
  crashKind: 'tumble',
  crashSide: 1,
  crashSpeed: 0,
  shieldT: 0,
  magnetT: 0,
  boostT: 0,
  invulnT: 0,
  steer: 0,
  autoSteer: 0,
  wheelAngle: 0,
});

const seed = (Math.random() * 1e9) | 0;

export const runtime = {
  seed,
  track: new Track(seed),
  player: makePlayer(),
  obstacles: Array.from({ length: MAX_OBSTACLES }, makeObstacle),
  coins: Array.from({ length: MAX_COINS }, makeCoin),
  powerups: Array.from({ length: MAX_POWERUPS }, makePowerUp),
  /** World-space origin used by streamed geometry / instanced meshes (keeps float32 data small). */
  anchor: new Vector3(),
  time: 0, // game time (stops while paused)
  realTime: 0,
  // run statistics
  runTime: 0,
  runDistance: 0,
  score: 0,
  bonus: 0,
  coinsRun: 0,
  coinStreak: 0,
  lastCoinTime: -10,
  difficulty: 0,
  // camera feedback impulses
  shake: 0,
  landKick: 0,
  fovKick: 0,
  /**
   * Incremented whenever the game is reset to the start line. Visual systems that keep
   * their own smoothing / animation state (camera, rider animator) watch it and snap.
   */
  resetSerial: 0,
};

export type Runtime = typeof runtime;
