// Dev-only: renders the in-game skater rig (board + rigged rider) with a scripted state.
// http://localhost:5173/?lab&rig&state=ride|leanL|leanR|jump|air|slide|kickflip|spin|crash|fall&view=back|side|front|top&t=1.2
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { NeutralToneMapping, Vector3 } from 'three';
import { GRAVITY, JUMP_VELOCITY } from '../game/config';
import { runtime } from '../game/runtime';
import { PRIORITY } from '../scene/priorities';
import { Skater } from '../scene/skater/Skater';

const params = new URLSearchParams(location.search);
const STATE = params.get('state') ?? 'ride';
const FIXED_T = params.has('t') ? Number(params.get('t')) : null;

function Follow({ cam, target }: { cam: [number, number, number]; target: Vector3 }) {
  const camera = useThree((st) => st.camera);
  const scene = useThree((st) => st.scene);
  (window as unknown as Record<string, unknown>).__labScene = scene;
  useFrame(() => {
    const y = runtime.player.crashed ? 0 : runtime.player.y;
    camera.position.set(cam[0], cam[1] + y, cam[2]);
    camera.lookAt(target.x, target.y + y, target.z);
  }, PRIORITY.camera);
  return null;
}

function Driver() {
  useFrame((_, dt) => {
    const p = runtime.player;
    runtime.time += dt;
    const t = FIXED_T ?? runtime.time;
    p.s = 0;
    p.speed = 22;
    p.x = 0;
    p.vx = 0;
    p.steer = 0;
    p.grounded = true;
    p.y = 0;
    p.vy = 0;
    p.slideT = 0;
    p.trick = 'none';
    p.crashed = false;
    p.wheelAngle += dt * 22 / 0.038;
    const airFor = (tt: number) => {
      const air = (2 * JUMP_VELOCITY) / GRAVITY;
      const a = tt % (air + 0.8);
      if (a < air) {
        p.grounded = false;
        p.airTime = a;
        p.y = JUMP_VELOCITY * a - 0.5 * GRAVITY * a * a;
      } else {
        if (!p.grounded) p.sinceLand = 0;
        p.sinceLand = a - air;
        p.landImpact = JUMP_VELOCITY;
      }
      return a;
    };
    switch (STATE) {
      case 'leanL':
        p.vx = -9;
        p.steer = -1;
        break;
      case 'leanR':
        p.vx = 9;
        p.steer = 1;
        break;
      case 'air':
        p.grounded = false;
        p.airTime = 0.4;
        p.y = 1.2;
        break;
      case 'jump':
        airFor(t);
        break;
      case 'slide':
        p.slideT = 0.5;
        break;
      case 'kickflip':
      case 'spin': {
        const a = airFor(t);
        const air = (2 * JUMP_VELOCITY) / GRAVITY;
        if (a > 0.05 && a < air - 0.05) {
          p.trick = STATE;
          p.trickDur = air - 0.1;
          p.trickT = a - 0.05;
          p.trickDir = 1;
        }
        break;
      }
      case 'crash':
      case 'fall':
        p.crashed = true;
        p.crashKind = STATE === 'crash' ? 'tumble' : 'fall';
        p.crashT = t % 2.2;
        p.crashSide = 1;
        break;
    }
  }, PRIORITY.sim);
  return null;
}

export default function RigLab() {
  const view = params.get('view') ?? 'back';
  const target = new Vector3(0, 0.85, 0);
  const cam: [number, number, number] =
    view === 'feet' ? [1.25, 0.75, 0.9] : view === 'crash' ? [2.6, 1.3, -0.8] : view === 'side' ? [3.4, 1.0, 0] : view === 'front' ? [0, 1.2, -3.6] : view === 'top' ? [0.01, 4.2, 0.3] : view === 'game' ? [0, 2.5, 4.1] : [0, 1.5, 3.4];
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas
        shadows="percentage"
        camera={{ position: cam, fov: view === 'game' ? 52 : 40 }}
        onCreated={({ gl }) => {
          gl.toneMapping = NeutralToneMapping;
        }}
      >
        <color attach="background" args={['#cbbcd9']} />
        <hemisphereLight args={['#ffe6f0', '#6a5a80', 1.4]} />
        <directionalLight position={[2, 5, 3]} intensity={2.2} castShadow shadow-bias={-0.0004} shadow-normalBias={0.03} />
        <directionalLight position={[-2, 2, -3]} intensity={0.8} color="#ffd2b0" />
        <mesh rotation-x={-Math.PI / 2} receiveShadow position={[0, -0.001, 0]}>
          <circleGeometry args={[4, 48]} />
          <meshStandardMaterial color="#8f839f" />
        </mesh>
        <Driver />
        <Skater />
        <Follow cam={cam} target={view === 'game' ? new Vector3(0, 0.6, -11) : view === 'crash' ? new Vector3(0, 0.3, -2.2) : view === 'feet' ? new Vector3(0, 0.18, 0) : target} />
      </Canvas>
    </div>
  );
}
