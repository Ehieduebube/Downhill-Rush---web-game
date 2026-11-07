// Dev-only character inspection page: http://localhost:5173/?lab
// Not included in production builds (imported behind import.meta.env.DEV).
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { AnimationMixer, Box3, Group, LoopRepeat, NeutralToneMapping, Vector3 } from 'three';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

function Model({ clip, onLoaded }: { clip: string; onLoaded: (names: string[]) => void }) {
  const [gltf, setGltf] = useState<GLTF | null>(null);
  useEffect(() => {
    new GLTFLoader().load('/models/skater.glb', (g) => {
      g.scene.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      setGltf(g);
      onLoaded(g.animations.map((a) => a.name));
      const box = new Box3().setFromObject(g.scene);
      (window as unknown as Record<string, unknown>).__labInfo = { size: box.getSize(new Vector3()).toArray() };
    });
  }, [onLoaded]);
  const mixer = useMemo(() => (gltf ? new AnimationMixer(gltf.scene) : null), [gltf]);
  useEffect(() => {
    if (!mixer || !gltf) return;
    mixer.stopAllAction();
    const c = gltf.animations.find((a) => a.name === clip);
    if (c) mixer.clipAction(c).setLoop(LoopRepeat, Infinity).play();
  }, [mixer, gltf, clip]);
  useFrame((_, dt) => mixer?.update(dt));
  return gltf ? <primitive object={gltf.scene as Group} /> : null;
}

export default function CharacterLab() {
  const params = new URLSearchParams(location.search);
  const [clip, setClip] = useState(params.get('clip') ?? '');
  const [clips, setClips] = useState<string[]>([]);
  const view = params.get('view') ?? 'back';
  const camPos: [number, number, number] =
    view === 'front' ? [0, 1.2, 3.2] : view === 'side' ? [3.2, 1.2, 0] : view === 'face' ? [0, 1.65, 0.9] : [0, 1.5, -3.2];
  const target: [number, number, number] = view === 'face' ? [0, 1.65, 0] : [0, 0.95, 0];
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#c9b8d8' }}>
      <Canvas
        shadows="percentage"
        camera={{ position: camPos, fov: 40 }}
        onCreated={({ gl }) => {
          gl.toneMapping = NeutralToneMapping;
        }}
      >
        <color attach="background" args={['#cbbcd9']} />
        <hemisphereLight args={['#ffe6f0', '#6a5a80', 1.4]} />
        <directionalLight position={[2, 4, -3]} intensity={2.2} castShadow shadow-bias={-0.0004} shadow-normalBias={0.03} />
        <directionalLight position={[-2, 2, 3]} intensity={0.8} color="#ffd2b0" />
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <circleGeometry args={[3, 48]} />
          <meshStandardMaterial color="#9d90b0" />
        </mesh>
        <Model clip={clip} onLoaded={setClips} />
        <OrbitControls target={target} />
      </Canvas>
      <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {['', ...clips].map((c) => (
          <button key={c} onClick={() => setClip(c)} style={{ padding: '4px 8px', background: c === clip ? '#ffc533' : '#fff' }}>
            {c || 'bind pose'}
          </button>
        ))}
      </div>
    </div>
  );
}
