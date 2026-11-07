// useFrame priorities. All negative so R3F keeps rendering automatically after them;
// lower numbers run first.
export const PRIORITY = {
  sim: -100, // game logic & physics
  world: -90, // streamed world rebuild (sets the anchor)
  actors: -80, // obstacles, coins, power-ups, particles
  skater: -70,
  camera: -60,
  followers: -50, // things that follow the camera (sky, lights, speed lines, halos)
} as const;
