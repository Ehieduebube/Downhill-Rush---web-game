import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import { PerspectiveCamera, Vector3 } from 'three';
import { clamp, damp, noise1 } from '../game/noise';
import { boostFactor } from '../game/powerups';
import { runtime } from '../game/runtime';
import { useGame } from '../game/store';
import { makeFrame } from '../game/track';
import { PRIORITY } from './priorities';

const fA = makeFrame();
const fB = makeFrame();
const pos = new Vector3();
const look = new Vector3();

/**
 * Third-person chase camera. Distance along the road is never smoothed (so it can't lag at
 * high speed); lateral offset, height, framing and roll are damped for smooth motion.
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const st = useRef({ lat: 0, h: 2.5, back: 3.6, lookH: 0.4, roll: 0, menu: 1, fov: 52, init: false, crash: 0, serial: -1 });

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = st.current;
    const p = runtime.player;
    const phase = useGame.getState().phase;
    const paused = phase === 'paused';
    const k = paused ? 0 : 1;
    // fresh run at the start line: snap all smoothed framing instead of easing in from the crash
    if (s.serial !== runtime.resetSerial) {
      s.serial = runtime.resetSerial;
      s.init = false;
    }

    const menuT = phase === 'menu' ? 1 : 0;
    s.menu = s.init ? damp(s.menu, menuT, 2.2 * k, dt) : menuT;
    const crashT = p.crashed ? 1 : 0;
    s.crash = s.init ? damp(s.crash, crashT, 1.6 * k, dt) : crashT;

    const backT = 3.7 + s.menu * 1.3 + s.crash * 2.2;
    const heightT = 2.4 + s.menu * 0.45 + s.crash * 1.2 + Math.max(p.y, 0) * 0.42;
    // Lateral follow: ONE lightly smoothed value drives both the camera position and its look
    // target. (Separate, slow lags made the camera keep drifting the old way when the rider
    // reversed, so the rider whipped across the screen and then slid back - the "bounce".)
    if (!s.init) {
      s.lat = p.x;
      s.h = heightT;
      s.back = backT;
      s.lookH = 0.45 + Math.max(p.y, 0) * 0.3 + s.menu * 0.5;
      s.roll = 0;
    }
    s.lat = damp(s.lat, p.x, 18 * k, dt);
    const follow = 0.9 - s.menu * 0.3;
    const camX = s.lat * follow;
    const lookX = s.lat * (follow - 0.1);
    s.h = damp(s.h, heightT, 6 * k, dt);
    s.back = damp(s.back, backT, 4 * k, dt);
    const lookHT = 0.45 + Math.max(p.y, 0) * 0.3 + s.menu * 0.5;
    s.lookH = damp(s.lookH, lookHT, 6 * k, dt);

    runtime.track.frame(p.s - s.back, fA);
    pos.set(fA.x + fA.rx * camX, fA.y + s.h - runtime.landKick * 0.14, fA.z + fA.rz * camX);
    const ahead = 11 + s.menu * 3;
    runtime.track.frame(p.s + ahead, fB);
    look.set(fB.x + fB.rx * lookX, fB.y + s.lookH, fB.z + fB.rz * lookX);

    // shake on impacts (noise based, decays)
    const shake = runtime.shake * runtime.shake * 0.28;
    if (shake > 0.0001) {
      const tt = runtime.realTime * 30;
      pos.x += (noise1(tt, 1) - 0.5) * shake;
      pos.y += (noise1(tt, 2) - 0.5) * shake;
      pos.z += (noise1(tt, 3) - 0.5) * shake;
    }
    camera.position.copy(pos);
    camera.lookAt(look);
    const rollT = -clamp(p.vx / 10.5, -1, 1) * 0.035 * (1 - s.menu);
    s.roll = damp(s.roll, rollT, 5 * k, dt);
    camera.rotateZ(s.roll);

    // field of view: wider with speed, punch on tricks, and widened on portrait screens
    const speedK = clamp((p.speed - 18) / 25, 0, 1);
    let fovT = 52 + speedK * 7 + runtime.fovKick * 2.5 + boostFactor(p) * 6;
    const aspect = size.width / Math.max(size.height, 1);
    const minHFov = 64;
    const needed = (2 * Math.atan(Math.tan((minHFov * Math.PI) / 360) / aspect) * 180) / Math.PI;
    fovT = Math.max(fovT, Math.min(needed, 92));
    s.fov = s.init ? damp(s.fov, fovT, 3 * k, dt) : fovT;
    if (Math.abs(camera.fov - s.fov) > 0.01) {
      camera.fov = s.fov;
      camera.updateProjectionMatrix();
    }
    s.init = true;
  }, PRIORITY.camera);

  return null;
}
