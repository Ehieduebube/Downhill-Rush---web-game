import { PerformanceMonitor } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { NeutralToneMapping } from 'three';
import type { Quality } from '../game/store';
import { Coins, Obstacles, Particles, PowerUps, SpeedLines } from './Actors';
import { Backdrop } from './Backdrop';
import { BoostTrail } from './BoostTrail';
import { CameraRig } from './CameraRig';
import { GameLoop } from './GameLoop';
import { ShaderWarmup } from './ShaderWarmup';
import { Lights, SkyEnvironment } from './Lighting';
import { FOG_COLOR } from './sky';
import { Skater } from './skater/Skater';
import { StreamedWorld } from './world/StreamedWorld';

/** Dev-only: expose renderer internals for automated profiling. */
function DevHook() {
  const three = useThree();
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, Record<string, unknown> | undefined>;
    w.__dr3 = { gl: three.gl, scene: three.scene, camera: three.camera };
  }, [three.gl, three.scene, three.camera]);
  return null;
}

export function GameCanvas({ quality }: { quality: Quality }) {
  const high = quality === 'high';
  const maxDpr = Math.min(window.devicePixelRatio || 1, high ? 2 : 1);
  const minDpr = high ? 1 : 0.7;
  const [dpr, setDpr] = useState(maxDpr);

  return (
    <Canvas
      className="game-canvas"
      shadows="percentage"
      dpr={dpr}
      gl={{ antialias: high, powerPreference: 'high-performance', stencil: false, alpha: false }}
      camera={{ fov: 52, near: 0.25, far: 4200, position: [0, 3, 6] }}
      onCreated={({ gl }) => {
        gl.toneMapping = NeutralToneMapping;
        gl.toneMappingExposure = 1.02;
        gl.setClearColor('#e0849e');
      }}
    >
      <PerformanceMonitor
        flipflops={3}
        onDecline={() => setDpr((d) => Math.max(minDpr, +(d - 0.15).toFixed(2)))}
        onIncline={() => setDpr((d) => Math.min(maxDpr, +(d + 0.15).toFixed(2)))}
      />
      <fogExp2 attach="fog" args={[FOG_COLOR, 0.00062]} />
      {import.meta.env.DEV && <DevHook />}
      <GameLoop />
      {high && <SkyEnvironment />}
      <Lights quality={quality} />
      <StreamedWorld quality={quality} />
      <Obstacles />
      <Coins />
      <PowerUps />
      <Skater />
      <Particles />
      <BoostTrail />
      <CameraRig />
      <Backdrop quality={quality} />
      <SpeedLines />
      <ShaderWarmup />
    </Canvas>
  );
}
