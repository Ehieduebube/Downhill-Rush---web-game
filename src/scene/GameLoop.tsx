import { useFrame } from '@react-three/fiber';
import { stepGame } from '../game/sim';
import { PRIORITY } from './priorities';

/** Drives the simulation once per rendered frame, before anything visual updates. */
export function GameLoop() {
  useFrame((_, dt) => stepGame(dt), PRIORITY.sim);
  return null;
}
