import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { runtime } from '../../game/runtime';
import type { Quality } from '../../game/store';
import { PRIORITY } from '../priorities';
import { WorldBuilder } from './WorldBuilder';

/** Road, guard rails, terrain and roadside props streamed around the player. */
export function StreamedWorld({ quality }: { quality: Quality }) {
  const builder = useMemo(() => new WorldBuilder(quality), [quality]);
  useEffect(() => () => builder.dispose(), [builder]);
  useFrame(() => builder.update(runtime.player.s), PRIORITY.world);
  return <primitive object={builder.group} />;
}
