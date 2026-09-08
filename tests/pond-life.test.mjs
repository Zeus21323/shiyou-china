import test from 'node:test';
import assert from 'node:assert/strict';
import {
  samplePondFish,
  applyFishWakes,
  FISH_COUNT,
} from '../lib/pond-life.ts';
import { createLotusBodies, stepLotusBodies } from '../lib/lotus-water.ts';

test('fish paths stay finite, continuous and inside the pond', () => {
  for (let i = 0; i < FISH_COUNT; i++)
    for (let t = 0; t < 600; t += 0.5) {
      const a = samplePondFish(t, i),
        b = samplePondFish(t + 0.016, i);
      assert.ok(Object.values(a).every(Number.isFinite));
      assert.ok(Math.hypot(a.x, a.z) < 40);
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.1);
    }
});
test('fish wakes move nearby lamps, spare selected lamps and respect pause', () => {
  const f = samplePondFish(0, 0);
  const b = Array.from({ length: 3 }, (_, i) => ({
    x: (f.x + 1 + i) * 25,
    y: f.z * 25,
    radius: 52,
    phase: i,
  }));
  const before = structuredClone(b);
  applyFishWakes(b, 0, 0, 0);
  assert.deepEqual(b, before);
  applyFishWakes(b, 0, 1 / 60, 0);
  assert.deepEqual(b[0], before[0]);
  assert.notEqual(b[1].x, before[1].x);
});
test('wake drift and the existing collision solver remain stable together', () => {
  const bodies = createLotusBodies(50);
  for (let frame = 0; frame < 600; frame++) {
    applyFishWakes(bodies, frame / 60, 1 / 60);
    stepLotusBodies(bodies, frame / 60, 1 / 60);
  }
  for (const b of bodies)
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++)
      assert.ok(
        Math.hypot(bodies[i].x - bodies[j].x, bodies[i].y - bodies[j].y) > 103,
      );
});
