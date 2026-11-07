import { audio } from './audio';
import {
  BASE_SPEED,
  BOOST_SPEED,
  BOOST_TIME,
  COIN_VALUE,
  CRASH_DURATION,
  DESPAWN_BEHIND,
  DISTANCE_POINTS,
  FAST_FALL_VELOCITY,
  GRAVITY,
  HOP_VELOCITY,
  JUMP_VELOCITY,
  LATERAL_ACCEL,
  LATERAL_DECEL,
  LATERAL_MAX,
  MAGNET_AHEAD,
  MAGNET_BEHIND,
  MAGNET_SIDE,
  MAGNET_TIME,
  MAX_FRAME_DT,
  MAX_SPEED,
  MENU_SPEED,
  PLAYER_HALF_S,
  PLAYER_HALF_X,
  PLAYER_HEIGHT,
  PLAYER_SLIDE_HEIGHT,
  PLAYER_X_LIMIT,
  SHIELD_TIME,
  SLIDE_TIME,
  SPEED_TIME_CONSTANT,
  SUBSTEP,
} from './config';
import { input } from './input';
import { clamp, damp, moveTowards } from './noise';
import { particles } from './particles';
import { boostFactor, POWERUP_INFO } from './powerups';
import { Coin, makePlayer, Obstacle, runtime, TrickKind } from './runtime';
import { Spawner } from './spawner';
import { saveNumber } from './storage';
import { isRiderPending, PowerState, useGame } from './store';
import { makeFrame } from './track';

export const spawner = new Spawner();

const frame = makeFrame();
const rt = runtime;
let hudTimer = 0;
let lastHudScore = -1;
let lastHudCoins = -1;
let lastHudPower = '';
let lastSeam = 0;
let announcedBest = false;
let trickNames: string[] = [];

const TRICK_POINTS: Record<Exclude<TrickKind, 'none'>, number> = { kickflip: 150, spin: 250 };
const TRICK_LABEL: Record<Exclude<TrickKind, 'none'>, string> = { kickflip: 'KICKFLIP', spin: '360 SPIN' };

function targetSpeed(): number {
  const p = rt.player;
  const phase = useGame.getState().phase;
  if (p.crashed || phase === 'gameover' || phase === 'crashed') return 0;
  if (phase === 'menu') return MENU_SPEED;
  const base = BASE_SPEED + (MAX_SPEED - BASE_SPEED) * (1 - Math.exp(-rt.runTime / SPEED_TIME_CONSTANT));
  // Steeper sections are a little faster
  const grade = rt.track.grade(p.s);
  return base * clamp(1 + (grade - 0.095) * 2.2, 0.9, 1.1) * (1 + BOOST_SPEED * boostFactor(p));
}

function remainingAir(): number {
  const p = rt.player;
  return (p.vy + Math.sqrt(p.vy * p.vy + 2 * GRAVITY * Math.max(p.y, 0))) / GRAVITY;
}

function playerWorld() {
  const p = rt.player;
  rt.track.frame(p.s, frame);
  return {
    x: frame.x + frame.rx * p.x,
    y: frame.y + p.y,
    z: frame.z + frame.rz * p.x,
    fx: frame.fx,
    fz: frame.fz,
  };
}

// ------------------------------------------------------------------ actions
function doJump(v: number) {
  const p = rt.player;
  p.vy = v;
  p.grounded = false;
  p.airTime = 0;
  p.slideT = 0;
  p.slideQueued = false;
  audio.jump();
  const w = playerWorld();
  particles.dust(w.x, w.y, w.z, 6, 1.6);
}

function startSlide() {
  const p = rt.player;
  if (p.slideT <= 0) audio.slide();
  p.slideT = SLIDE_TIME;
}

function startTrick(kind: Exclude<TrickKind, 'none'>, rem: number) {
  const p = rt.player;
  const base = kind === 'spin' ? 0.62 : 0.5;
  p.trick = kind;
  p.trickT = 0;
  p.trickDur = Math.max(0.22, Math.min(base, rem * 0.88));
  p.trickDir = input.steer !== 0 ? input.steer : p.x > 0 ? -1 : 1;
  rt.fovKick = 1;
  audio.trickStart();
}

function tryTrick() {
  const p = rt.player;
  if (p.trick !== 'none') return;
  if (p.grounded) {
    doJump(HOP_VELOCITY);
    startTrick('kickflip', remainingAir());
    return;
  }
  const rem = remainingAir();
  if (rem < 0.26) return;
  startTrick(p.airTricks % 2 === 0 && rem >= 0.42 ? 'spin' : 'kickflip', rem);
}

function completeTrick() {
  const p = rt.player;
  if (p.trick === 'none') return;
  const kind = p.trick;
  p.airTricks += 1;
  p.airBonus += TRICK_POINTS[kind] * p.airTricks;
  trickNames.push(TRICK_LABEL[kind]);
  p.trick = 'none';
  p.trickT = 0;
}

function land() {
  const p = rt.player;
  const impact = -p.vy;
  p.y = 0;
  p.vy = 0;
  p.grounded = true;
  p.landImpact = impact;
  p.sinceLand = 0;
  if (p.trick !== 'none') completeTrick();
  if (p.airBonus > 0 && !p.crashed) {
    rt.bonus += p.airBonus;
    const label = trickNames.length > 1 ? `${trickNames.join(' + ')}` : trickNames[0] ?? 'TRICK';
    useGame.getState().pushPopup(label, 'trick', `+${p.airBonus}${p.airTricks > 1 ? `  x${p.airTricks} COMBO` : ''}`);
    audio.trickLanded(p.airTricks);
    const w = playerWorld();
    particles.ring(w.x, w.y + 0.3, w.z, '#ffe08a', 18, 4);
  }
  p.airTricks = 0;
  p.airBonus = 0;
  trickNames = [];
  audio.land(impact);
  rt.landKick = Math.min(impact / 13, 1);
  const w = playerWorld();
  particles.dust(w.x, w.y, w.z, Math.round(4 + Math.min(impact, 14) * 0.6), 2.2);
  if (p.slideQueued) {
    p.slideQueued = false;
    startSlide();
  }
}

// --------------------------------------------------------------- collisions
function knock(o: Obstacle, strength: number) {
  const p = rt.player;
  o.hit = true;
  o.kt = 0;
  const side = Math.sign(o.x - p.x) || (Math.random() < 0.5 ? -1 : 1);
  o.kvx = side * (2 + Math.random() * 3) * strength;
  o.kvy = (4 + Math.random() * 3) * strength;
  o.kvz = p.speed * (0.55 + Math.random() * 0.2);
  o.kspin = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 6);
  audio.knock();
}

function crash(kind: 'tumble' | 'fall', o: Obstacle | null) {
  const p = rt.player;
  if (p.crashed) return;
  p.crashed = true;
  p.crashT = 0;
  p.crashKind = kind;
  p.crashSide = o ? Math.sign(p.x - o.x) || 1 : 1;
  p.crashSpeed = p.speed;
  p.trick = 'none';
  p.slideT = 0;
  p.slideQueued = false;
  p.shieldT = 0;
  p.magnetT = 0;
  p.boostT = 0;
  rt.shake = 1;
  const w = playerWorld();
  if (kind === 'fall') {
    audio.fall();
  } else {
    audio.crash();
    particles.crash(w.x, w.y, w.z, w.fx, w.fz, p.speed * 0.45);
  }
  input.clear();
  useGame.getState().setPhase('crashed');
  useGame.getState().pushPopup('WIPEOUT!', 'info');
}

function useShield(o: Obstacle | null) {
  const p = rt.player;
  if (p.shieldT > 0) {
    p.shieldT = 0;
    p.invulnT = 1.1;
    audio.shieldBreak();
    const w = playerWorld();
    particles.ring(w.x, w.y + 0.8, w.z, '#7ff3ff', 28, 6);
    useGame.getState().pushPopup('SHIELD SAVE!', 'shield');
  }
  if (o && o.type !== 'gap') knock(o, 1.3);
}

function checkObstacles() {
  const p = rt.player;
  const height = p.slideT > 0 && p.grounded ? PLAYER_SLIDE_HEIGHT : PLAYER_HEIGHT;
  const bottom = p.y + 0.06;
  const top = p.y + height;
  for (const o of rt.obstacles) {
    if (!o.active || o.hit) continue;
    const ds = Math.abs(o.s - p.s);
    if (ds > o.hs + PLAYER_HALF_S) continue;
    if (o.type === 'gap') {
      if (p.grounded && ds < o.hs - 0.3) {
        if (p.shieldT > 0 || p.invulnT > 0) {
          useShield(null);
          doJump(JUMP_VELOCITY * 0.95);
        } else {
          crash('fall', o);
        }
        return;
      }
      continue;
    }
    const hx = o.type === 'cone' ? o.hx : o.hx * 0.95;
    if (Math.abs(o.x - p.x) > hx + PLAYER_HALF_X) continue;
    if (top <= o.y0 || bottom >= o.y1) continue;
    if (p.shieldT > 0 || p.invulnT > 0) {
      useShield(o);
      continue;
    }
    const spec = o.type;
    if (spec === 'cone' || spec === 'barricade') knock(o, 1);
    crash('tumble', o);
    return;
  }
}

function collectCoin(c: Coin) {
  const p = rt.player;
  c.collected = true;
  c.ct = 0;
  rt.coinsRun += 1;
  rt.coinStreak = rt.time - rt.lastCoinTime < 0.6 ? rt.coinStreak + 1 : 0;
  rt.lastCoinTime = rt.time;
  audio.coin(rt.coinStreak);
  rt.track.frame(p.s, frame);
  particles.coinBurst(c.px, c.py, c.pz, frame.fx, frame.fz, p.speed);
}

function checkPickups() {
  const p = rt.player;
  const cy = p.y + (p.slideT > 0 && p.grounded ? 0.45 : 0.75);
  for (const c of rt.coins) {
    if (!c.active || c.collected) continue;
    const ds = c.s - p.s;
    if (ds > 1.25 || ds < -1.25) continue;
    if (Math.abs(c.x - p.x) > 1.0) continue;
    if (Math.abs(c.y - cy) > 1.15) continue;
    collectCoin(c);
  }
  for (const pu of rt.powerups) {
    if (!pu.active || pu.collected) continue;
    const ds = pu.s - p.s;
    if (ds > 1.4 || ds < -1.4) continue;
    if (Math.abs(pu.x - p.x) > 1.2 || Math.abs(pu.y - cy) > 1.3) continue;
    pu.collected = true;
    pu.ct = 0;
    const info = POWERUP_INFO[pu.kind];
    if (pu.kind === 'shield') {
      p.shieldT = SHIELD_TIME;
      audio.shieldUp();
      useGame.getState().pushPopup(info.label, 'shield', `${SHIELD_TIME}s protection`);
    } else if (pu.kind === 'magnet') {
      p.magnetT = MAGNET_TIME;
      audio.magnetUp();
      useGame.getState().pushPopup(info.label, 'magnet', `${MAGNET_TIME}s coin pull`);
    } else {
      p.boostT = BOOST_TIME;
      rt.fovKick = 1;
      audio.boostUp();
      useGame.getState().pushPopup(info.label, 'boost', `${BOOST_TIME}s turbo`);
    }
    rt.track.frame(p.s, frame);
    particles.ring(pu.px, pu.py, pu.pz, info.color, 24, 4.5);
    particles.coinBurst(pu.px, pu.py, pu.pz, frame.fx, frame.fz, p.speed, info.accent, info.color);
  }
}

/**
 * Magnet: coins in a zone around the rider are pulled toward them (in track space, so
 * they follow the road's curve) until the normal pickup check collects them.
 */
function attractCoins(dt: number) {
  const p = rt.player;
  const k = 1 - Math.exp(-dt * 9);
  const targetY = p.y + (p.slideT > 0 && p.grounded ? 0.45 : 0.8);
  for (const c of rt.coins) {
    if (!c.active || c.collected) continue;
    const ds = c.s - p.s;
    if (!c.magnet && (ds > MAGNET_AHEAD || ds < -MAGNET_BEHIND || Math.abs(c.x - p.x) > MAGNET_SIDE)) continue;
    c.magnet = true;
    c.s += (p.s + 0.2 - c.s) * k;
    c.x += (p.x - c.x) * k;
    c.y += (targetY - c.y) * k;
    rt.track.frame(c.s, frame);
    c.px = frame.x + frame.rx * c.x;
    c.py = frame.y + c.y;
    c.pz = frame.z + frame.rz * c.x;
  }
}

// --------------------------------------------------------------- main step
function stepPlayer(h: number, phase: string) {
  const p = rt.player;
  const controllable = phase === 'playing' && !p.crashed;

  // ---- lateral
  if (p.crashed) {
    p.vx = damp(p.vx, 0, 5, h);
  } else if (controllable) {
    const dir = input.steer;
    p.steer = dir;
    const targetV = dir * LATERAL_MAX;
    let accel = dir !== 0 ? LATERAL_ACCEL : LATERAL_DECEL;
    if (dir !== 0 && p.vx !== 0 && Math.sign(p.vx) !== dir) accel *= 2.4; // counter-steer bites immediately
    p.vx = moveTowards(p.vx, targetV, accel * h);
  } else {
    // attract mode: gentle automatic carving
    const t = rt.time;
    const tx = 2.4 * Math.sin(t * 0.21) + 0.9 * Math.sin(t * 0.57 + 1.3);
    const want = clamp((tx - p.x) * 1.4, -5, 5);
    p.vx = moveTowards(p.vx, want, 20 * h);
    p.steer = clamp(want / 5, -1, 1);
  }
  p.x += p.vx * h;
  if (p.x > PLAYER_X_LIMIT) {
    p.x = PLAYER_X_LIMIT;
    if (p.vx > 0) p.vx = 0;
  } else if (p.x < -PLAYER_X_LIMIT) {
    p.x = -PLAYER_X_LIMIT;
    if (p.vx < 0) p.vx = 0;
  }

  // ---- forward
  p.s += p.speed * h;
  if (controllable) rt.runDistance += p.speed * h;

  // ---- vertical
  if (!p.grounded) {
    p.vy -= GRAVITY * h;
    p.y += p.vy * h;
    p.airTime += h;
    if (p.y <= 0) land();
  }

  if (controllable) {
    checkObstacles();
    checkPickups();
  }
}

export function stepGame(rawDt: number) {
  const store = useGame.getState();
  const phase = store.phase;
  const dt = Math.min(rawDt, MAX_FRAME_DT);
  rt.realTime += dt;
  if (phase === 'paused') {
    audio.quiet();
    return;
  }
  rt.time += dt;
  const p = rt.player;

  // ---- one-shot inputs (buffered so presses slightly early still count)
  if (phase === 'playing' && !p.crashed) {
    if (p.grounded && input.take('jump', 140)) doJump(JUMP_VELOCITY);
    if (input.take('slide', 140)) {
      if (p.grounded) startSlide();
      else {
        p.vy = Math.min(p.vy, FAST_FALL_VELOCITY);
        p.slideQueued = true;
      }
    }
    if (input.take('trick', 120)) tryTrick();
  }

  // ---- speed
  const target = targetSpeed();
  if (p.crashed) p.speed = damp(p.speed, 0, 3.2, dt);
  else p.speed = damp(p.speed, target, phase === 'menu' ? 1.2 : 2.2, dt);

  // ---- integrate with fixed-size substeps (prevents tunnelling at high speed)
  const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    stepPlayer(h, phase);
    if (useGame.getState().phase !== phase) break; // crashed this step
  }

  // ---- timers
  p.sinceLand += dt;
  if (p.slideT > 0) p.slideT = Math.max(0, p.slideT - dt);
  if (p.shieldT > 0) p.shieldT = Math.max(0, p.shieldT - dt);
  if (p.magnetT > 0) {
    p.magnetT = Math.max(0, p.magnetT - dt);
    if (p.magnetT === 0) audio.powerDown();
  }
  if (p.boostT > 0) {
    p.boostT = Math.max(0, p.boostT - dt);
    if (p.boostT === 0) audio.powerDown();
  }
  if (p.magnetT > 0 && !p.crashed) attractCoins(dt);
  if (p.invulnT > 0) p.invulnT = Math.max(0, p.invulnT - dt);
  if (p.trick !== 'none') {
    p.trickT += dt;
    if (p.trickT >= p.trickDur) completeTrick();
  }
  const wheelDt = p.grounded ? p.speed * dt : p.speed * dt * 0.6;
  p.wheelAngle = (p.wheelAngle + wheelDt / 0.038) % (Math.PI * 2);
  rt.shake = Math.max(0, rt.shake - dt * 1.6);
  rt.landKick = Math.max(0, rt.landKick - dt * 4);
  rt.fovKick = Math.max(0, rt.fovKick - dt * 2.2);

  // seam clacks for a sense of rhythm
  const seam = Math.floor(p.s / 16);
  if (seam !== lastSeam) {
    lastSeam = seam;
    if (p.grounded && !p.crashed && p.speed > 4) audio.clack();
  }

  // ---- crash timeline
  if (p.crashed) {
    p.crashT += dt;
    if (p.crashT >= CRASH_DURATION && useGame.getState().phase === 'crashed') finishRun(true);
  }

  // ---- run stats
  const current = useGame.getState().phase;
  if (current === 'playing') {
    rt.runTime += dt;
    rt.difficulty = clamp(rt.runDistance / 5200, 0, 1);
    rt.score = Math.floor(rt.runDistance * DISTANCE_POINTS) + rt.coinsRun * COIN_VALUE + rt.bonus;
    if (!announcedBest && store.best > 500 && rt.score > store.best) {
      announcedBest = true;
      store.pushPopup('NEW BEST!', 'best');
      audio.newBest();
    }
  }

  // ---- spawn / despawn
  spawner.update(p.s, rt.difficulty, p.speed);
  for (const o of rt.obstacles) {
    if (!o.active) continue;
    if (o.hit) o.kt += dt;
    if (o.s < p.s - DESPAWN_BEHIND || o.kt > 1.6) o.active = false;
  }
  for (const c of rt.coins) {
    if (!c.active) continue;
    if (c.collected) c.ct += dt;
    if (c.s < p.s - DESPAWN_BEHIND || c.ct > 0.4) c.active = false;
  }
  for (const pu of rt.powerups) {
    if (!pu.active) continue;
    if (pu.collected) pu.ct += dt;
    if (pu.s < p.s - DESPAWN_BEHIND || pu.ct > 0.5) pu.active = false;
  }
  rt.track.trim(p.s - 300);

  // ---- effects
  particles.update(dt);
  const sliding = p.slideT > 0 && p.grounded && !p.crashed;
  audio.updateLoops(p.speed, p.grounded && !p.crashed, sliding, current !== 'gameover', boostFactor(p));

  // ---- HUD sync (throttled)
  hudTimer -= dt;
  if (hudTimer <= 0 && (current === 'playing' || current === 'crashed')) {
    hudTimer = 0.08;
    const power: PowerState = {
      shield: Math.ceil(p.shieldT * 10) / 10,
      magnet: Math.ceil(p.magnetT * 10) / 10,
      boost: Math.ceil(p.boostT * 10) / 10,
    };
    const powerKey = `${power.shield}|${power.magnet}|${power.boost}`;
    if (rt.score !== lastHudScore || rt.coinsRun !== lastHudCoins) {
      lastHudScore = rt.score;
      lastHudCoins = rt.coinsRun;
      store.setHud(rt.score, rt.coinsRun);
    }
    if (powerKey !== lastHudPower) {
      lastHudPower = powerKey;
      store.setPower(power);
    }
  }
}

// ------------------------------------------------------------ run lifecycle
/**
 * Puts the whole game back to its initial state at the start line: player, board,
 * speed, collision / trick / crash state, run statistics, obstacles, coins, power-ups,
 * particles, the road's cached geometry, camera impulses and every per-run timer.
 * Best score and coin bank are untouched. Visual systems (camera, rider animation,
 * streamed world) see `resetSerial` change and snap to the new state on the next frame.
 */
function resetToStart() {
  // pooled world objects
  for (const o of rt.obstacles) {
    o.active = false;
    o.hit = false;
    o.kt = 0;
  }
  for (const c of rt.coins) c.active = false;
  for (const pu of rt.powerups) pu.active = false;
  particles.clear();
  // road: drop cached centre-line samples (the streamed world rebuilds from the new window)
  rt.track.reset();
  // a brand-new player at the start line, rolling at the initial run speed
  Object.assign(rt.player, makePlayer());
  rt.player.speed = MENU_SPEED;
  // run statistics + clocks + camera impulses
  rt.time = 0;
  rt.runTime = 0;
  rt.runDistance = 0;
  rt.score = 0;
  rt.bonus = 0;
  rt.coinsRun = 0;
  rt.coinStreak = 0;
  rt.lastCoinTime = -10;
  rt.difficulty = 0;
  rt.shake = 0;
  rt.landKick = 0;
  rt.fovKick = 0;
  // module-level per-run state
  hudTimer = 0;
  lastHudScore = lastHudCoins = -1;
  lastHudPower = '';
  lastSeam = Math.floor(rt.player.s / 16);
  announcedBest = false;
  trickNames = [];
  // no stale key presses / buffered actions carry over
  input.clear();
  audio.quiet();
  rt.resetSerial++;
}

/** Starts a completely fresh run from the start line. */
function beginRun() {
  resetToStart();
  spawner.reset(rt.player.s + 105, rt.player.x);
  spawner.enabled = true;
  const st = useGame.getState();
  st.nextRun();
  st.setPhase('playing');
}

/** Ends the current run: persists best score + coin bank. */
function finishRun(showGameOver: boolean) {
  const st = useGame.getState();
  const score = Math.floor(rt.score);
  const prevBest = st.best;
  const newBest = score > prevBest;
  const best = Math.max(prevBest, score);
  if (newBest) {
    st.setBest(best);
    saveNumber('best', best);
  }
  const bank = st.bank + rt.coinsRun;
  st.setBank(bank);
  saveNumber('bank', bank);
  st.setLastRun({ score, coins: rt.coinsRun, best, newBest: newBest && score > 0, distance: Math.floor(rt.runDistance) });
  st.setHud(score, rt.coinsRun);
  if (showGameOver) {
    spawner.enabled = false;
    st.setPhase('gameover');
    if (newBest && score > 0) audio.newBest();
    else audio.gameOver();
  }
}

// ------------------------------------------------------------ public API
const blurActive = () => {
  const el = document.activeElement as HTMLElement | null;
  el?.blur?.();
};

export function startGame() {
  // never start a run before the rider is in the scene (slow connections take a while)
  if (isRiderPending(useGame.getState())) return;
  audio.init();
  audio.click();
  blurActive();
  beginRun();
}

export function pauseGame() {
  if (useGame.getState().phase !== 'playing') return;
  input.clear();
  audio.quiet();
  useGame.getState().setPhase('paused');
}

export function resumeGame() {
  if (useGame.getState().phase !== 'paused') return;
  audio.init();
  audio.click();
  input.clear();
  blurActive();
  useGame.getState().setPhase('playing');
}

export function togglePause() {
  const phase = useGame.getState().phase;
  if (phase === 'playing') pauseGame();
  else if (phase === 'paused') resumeGame();
}

export function restartGame() {
  const phase = useGame.getState().phase;
  audio.init();
  audio.click();
  blurActive();
  if (phase === 'paused') finishRun(false);
  beginRun();
}

export function goToMenu() {
  const st = useGame.getState();
  audio.click();
  if (st.phase === 'paused') finishRun(false);
  spawner.enabled = false;
  resetToStart();
  st.nextRun();
  st.setPhase('menu');
}

export function toggleMute() {
  const st = useGame.getState();
  const m = !st.muted;
  st.setMuted(m);
  audio.init();
  audio.setMuted(m);
  if (!m) audio.click();
}

/** Keyboard "confirm" (Enter / R): start from menu, retry from game over. */
export function confirmAction() {
  const phase = useGame.getState().phase;
  if (phase === 'menu') startGame();
  else if (phase === 'gameover') restartGame();
  else if (phase === 'paused') resumeGame();
}
