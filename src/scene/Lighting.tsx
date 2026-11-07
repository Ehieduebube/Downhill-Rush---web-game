import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { DirectionalLight, Mesh, Object3D, PMREMGenerator, Scene, SphereGeometry, Vector3 } from 'three';
import { runtime } from '../game/runtime';
import type { Quality } from '../game/store';
import { PRIORITY } from './priorities';
import { createSkyMaterial } from './sky';

// Key light comes from high above, slightly right and behind the player so the rider's back,
// the road-facing cliff faces and the coins catch warm light (matching the reference art).
const KEY_DIR = new Vector3(0.42, 1.0, 0.3).normalize();
const tmp = new Vector3();

/** Image based lighting generated from the sunset sky shader (no network assets). */
export function SkyEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const envScene = new Scene();
    const mat = createSkyMaterial(false);
    const geo = new SphereGeometry(100, 48, 24);
    envScene.add(new Mesh(geo, mat));
    const target = pmrem.fromScene(envScene, 0.035, 0.1, 1000);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.55;
    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
      geo.dispose();
      mat.dispose();
    };
  }, [gl, scene]);
  return null;
}

export function Lights({ quality }: { quality: Quality }) {
  const key = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const mapSize = quality === 'high' ? 2048 : 1024;

  useEffect(() => {
    key.current?.shadow.camera.updateProjectionMatrix();
  }, []);

  useFrame(() => {
    const light = key.current;
    if (!light) return;
    const p = runtime.player;
    runtime.track.point(p.s + 10, p.x * 0.5, 0, tmp);
    target.position.copy(tmp);
    target.updateMatrixWorld();
    light.position.copy(tmp).addScaledVector(KEY_DIR, 70);
  }, PRIORITY.followers);

  return (
    <>
      <hemisphereLight args={['#ffc6c9', '#5f4a8c', quality === 'high' ? 1.05 : 1.55]} />
      <directionalLight
        ref={key}
        color="#ffe1c2"
        intensity={2.35}
        castShadow
        shadow-mapSize={[mapSize, mapSize]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.035}
        shadow-radius={quality === 'high' ? 3 : 2}
        shadow-camera-left={-26}
        shadow-camera-right={26}
        shadow-camera-top={26}
        shadow-camera-bottom={-26}
        shadow-camera-near={1}
        shadow-camera-far={160}
        target={target}
      />
      <primitive object={target} />
      {/* warm rim light from the setting sun ahead */}
      <directionalLight color="#ff9a62" intensity={1.0} position={[0.3, 0.25, -1]} />
      {/* cool lavender fill from behind the camera */}
      <directionalLight color="#c9b2ff" intensity={0.45} position={[-0.6, 0.5, 1]} />
    </>
  );
}
