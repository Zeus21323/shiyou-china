import type { LotusBody } from './lotus-water';

export const FISH_COUNT = 8;
export type PondFish = { x: number; z: number; heading: number; phase: number };
export function samplePondFish(time: number, index: number): PondFish {
  const phase = index * 2.399963;
  const speed = 0.055 + (index % 3) * 0.014;
  const a = time * speed + phase;
  const radius = 7 + index * 2.6;
  const x = Math.cos(a) * radius + Math.sin(a * 2 + phase) * 2;
  const z = Math.sin(a) * radius * 0.65 + Math.cos(phase) * 5;
  const dx = -Math.sin(a) * radius + 4 * Math.cos(a * 2 + phase);
  const dz = Math.cos(a) * radius * 0.65;
  return { x, z, heading: Math.atan2(dz, dx), phase: time * 3.5 + phase };
}

// Fish wakes gently displace nearby lamps; selected reading lamps stay anchored.
// Positions here are world units; the existing collision solver uses 25 units per metre.
export function applyFishWakes(
  bodies: LotusBody[],
  time: number,
  dt: number,
  selected = -1,
) {
  if (dt <= 0) return;
  const fish = Array.from({ length: FISH_COUNT }, (_, i) =>
    samplePondFish(time, i),
  );
  for (let i = 0; i < bodies.length; i++) {
    if (i === selected) continue;
    const b = bodies[i];
    for (const f of fish) {
      const dx = b.x / 25 - f.x,
        dz = b.y / 25 - f.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.001 || d > 5) continue;
      const drift = Math.exp(-d * 0.7) * dt * 9;
      b.x += (dx / d + Math.cos(f.heading) * 0.3) * drift;
      b.y += (dz / d + Math.sin(f.heading) * 0.3) * drift;
    }
  }
}
