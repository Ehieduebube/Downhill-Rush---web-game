import { BOOST_TIME, MAGNET_TIME, SHIELD_TIME } from './config';
import type { PlayerState, PowerUpKind } from './runtime';

export interface PowerUpInfo {
  label: string;
  duration: number;
  /** Main colour (UI, glow, collection burst). */
  color: string;
  /** Lighter accent used for sparkles. */
  accent: string;
}

export const POWERUP_INFO: Record<PowerUpKind, PowerUpInfo> = {
  shield: { label: 'SHIELD', duration: SHIELD_TIME, color: '#4fd8ff', accent: '#b8fbff' },
  magnet: { label: 'MAGNET', duration: MAGNET_TIME, color: '#ff4f7b', accent: '#ffc2d2' },
  boost: { label: 'SPEED BOOST', duration: BOOST_TIME, color: '#ffb02e', accent: '#fff0a8' },
};

/** Remaining time of a power-up on the player. */
export function powerTime(p: PlayerState, kind: PowerUpKind): number {
  return kind === 'shield' ? p.shieldT : kind === 'magnet' ? p.magnetT : p.boostT;
}

/** 0..1 strength of the speed boost: ramps in over 0.4 s and eases out over the last second. */
export function boostFactor(p: PlayerState): number {
  if (p.boostT <= 0 || p.crashed) return 0;
  const rampIn = Math.min(1, (BOOST_TIME - p.boostT) / 0.4);
  const rampOut = Math.min(1, p.boostT / 1.0);
  return Math.max(0, Math.min(rampIn, rampOut));
}
