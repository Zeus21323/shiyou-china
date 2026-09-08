import test from 'node:test';
import assert from 'node:assert/strict';
import { createLotusBodies, stepLotusBodies, clearLotusSpace } from '../lib/lotus-water.ts';

test('选中灯保持原位，邻灯向外散开，减少动态时直接让出空间', () => {
  const bodies = createLotusBodies(50);
  const center = {...bodies[0]};
  const start = Math.hypot(bodies[1].x,bodies[1].y);
  clearLotusSpace(bodies,0,1/60);
  assert.ok(Math.hypot(bodies[1].x,bodies[1].y)>start);
  assert.deepEqual(bodies[0],center);
  clearLotusSpace(bodies,0,1/60,true);
  assert.ok(bodies.slice(1).every(b=>Math.hypot(b.x,b.y)>=145-1e-8));
});
test('少于50篇补足50灯，多于50篇每篇都有灯，不截断作品', () => {
  for (const n of [0, 1, 49, 50, 1187, 4589]) {
    const bodies = createLotusBodies(n);
    assert.equal(bodies.length, Math.max(50, n));
    assert.ok(
      bodies.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y)),
    );
  }
});
test('重叠的莲灯被碰撞体分离，静止步长也可处理重叠', () => {
  const b = [
    { x: 0, y: 0, radius: 23, phase: 0 },
    { x: 0, y: 0, radius: 23, phase: 1 },
  ];
  stepLotusBodies(b, 0, 0);
  assert.ok(Math.hypot(b[0].x - b[1].x, b[0].y - b[1].y) >= 46);
});
test('水流中灯体保持有限坐标并保持碰撞距离', () => {
  const b = createLotusBodies(50);
  for (let i = 0; i < 600; i++) stepLotusBodies(b, i / 60, 1 / 60);
  for (let i = 0; i < b.length; i++)
    for (let j = i + 1; j < b.length; j++)
      assert.ok(Math.hypot(b[i].x - b[j].x, b[i].y - b[j].y) > 45.5);
});
