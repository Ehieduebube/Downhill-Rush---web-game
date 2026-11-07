import { Color } from 'three';

// Pooled particle simulation (rendering lives in scene/Particles.tsx).

export const MAX_PARTICLES = 360;

export interface Particle {
  alive: boolean;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  r: number;
  g: number;
  b: number;
  grav: number;
  drag: number;
  rot: number;
  spin: number;
}

const tmp = new Color();

class ParticleSystem {
  items: Particle[] = Array.from({ length: MAX_PARTICLES }, () => ({
    alive: false,
    px: 0,
    py: 0,
    pz: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    max: 1,
    size: 0.1,
    r: 1,
    g: 1,
    b: 1,
    grav: 0,
    drag: 0,
    rot: 0,
    spin: 0,
  }));
  private cursor = 0;

  spawn(
    px: number,
    py: number,
    pz: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    color: string,
    grav = 9,
    drag = 1,
  ) {
    const p = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    p.alive = true;
    p.px = px;
    p.py = py;
    p.pz = pz;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = life;
    p.max = life;
    p.size = size;
    tmp.set(color);
    p.r = tmp.r;
    p.g = tmp.g;
    p.b = tmp.b;
    p.grav = grav;
    p.drag = drag;
    p.rot = Math.random() * Math.PI;
    p.spin = (Math.random() - 0.5) * 12;
  }

  update(dt: number) {
    for (const p of this.items) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vz *= d;
      p.vy = p.vy * d - p.grav * dt;
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;
      p.rot += p.spin * dt;
    }
  }

  clear() {
    for (const p of this.items) p.alive = false;
  }

  /** fx, fz: forward direction; carry: forward velocity added so bursts travel with the player. */
  coinBurst(x: number, y: number, z: number, fx: number, fz: number, carry: number, light = '#fff6c8', main = '#ffc533') {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.8 + Math.random() * 2.4;
      this.spawn(
        x,
        y,
        z,
        Math.cos(a) * sp + fx * carry,
        Math.sin(a) * sp * 0.8 + 1.5,
        Math.sin(a) * sp * 0.4 + fz * carry,
        0.22 + Math.random() * 0.16,
        0.028 + Math.random() * 0.03,
        i % 3 === 0 ? light : main,
        4,
        0,
      );
    }
  }

  dust(x: number, y: number, z: number, count: number, spread: number, color = '#d7a6b8') {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = spread * (0.4 + Math.random());
      this.spawn(
        x + Math.cos(a) * 0.2,
        y + 0.05,
        z + Math.sin(a) * 0.2,
        Math.cos(a) * sp,
        0.6 + Math.random() * 1.2,
        Math.sin(a) * sp,
        0.4 + Math.random() * 0.35,
        0.08 + Math.random() * 0.09,
        color,
        -0.5,
        3,
      );
    }
  }

  sparks(x: number, y: number, z: number, fx: number, fz: number, speed: number) {
    for (let i = 0; i < 2; i++) {
      this.spawn(
        x,
        y + 0.03,
        z,
        -fx * speed * 0.15 + (Math.random() - 0.5) * 3,
        1 + Math.random() * 2.5,
        -fz * speed * 0.15 + (Math.random() - 0.5) * 3,
        0.18 + Math.random() * 0.15,
        0.025 + Math.random() * 0.025,
        Math.random() < 0.5 ? '#ffd27a' : '#ff9a3a',
        14,
        1,
      );
    }
  }

  crash(x: number, y: number, z: number, fx: number, fz: number, carry: number) {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 6;
      const col = i % 4 === 0 ? '#ffffff' : i % 4 === 1 ? '#ff6a1f' : i % 4 === 2 ? '#d9a3b5' : '#ffb347';
      this.spawn(
        x,
        y + 0.4,
        z,
        Math.cos(a) * sp + fx * carry,
        2 + Math.random() * 6,
        Math.sin(a) * sp + fz * carry,
        0.6 + Math.random() * 0.6,
        0.06 + Math.random() * 0.1,
        col,
        16,
        1.2,
      );
    }
  }

  ring(x: number, y: number, z: number, color: string, count = 22, speed = 5) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.spawn(x, y, z, Math.cos(a) * speed, (Math.random() - 0.3) * 2, Math.sin(a) * speed, 0.45, 0.07, color, 0, 3);
    }
  }
}

export const particles = new ParticleSystem();
