import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVINCE_LIFT,
  nextProvinceLift,
  provinceWallBand,
} from '../lib/province-lift.ts';

test('选中省份连续上升、取消后落回零，不改变DEM局部高差', () => {
  let lift = 0;
  for (let i = 0; i < 120; i++) {
    const next = nextProvinceLift(lift, true, 1 / 60);
    assert.ok(next >= lift && next <= PROVINCE_LIFT);
    assert.ok(Math.abs(0.9 + next - (0.2 + next) - 0.7) < 1e-9);
    lift = next;
  }
  assert.equal(lift, PROVINCE_LIFT);
  for (let i = 0; i < 120; i++) {
    const next = nextProvinceLift(lift, false, 1 / 60);
    assert.ok(next <= lift && next >= 0);
    lift = next;
  }
  assert.equal(lift, 0);
  assert.equal(nextProvinceLift(0, true, 1, true), PROVINCE_LIFT);
});

test('省际侧壁只由较高一侧填充落差，交接时不重叠或悬空', () => {
  for (const [a, b] of [
    [0, 0],
    [0.34, 0],
    [0.2, 0.14],
    [0, 0.34],
  ]) {
    const first = provinceWallBand(0.5, a, [0.5 + b]);
    const second = provinceWallBand(0.5, b, [0.5 + a]);
    assert.ok(
      Math.abs(
        first.top - first.bottom + second.top - second.bottom - Math.abs(a - b),
      ) < 1e-9,
    );
    assert.equal(Math.min(first.bottom, second.bottom), 0.5 + Math.min(a, b));
  }
  const coast = provinceWallBand(0.5, 0.34, []);
  assert.ok(Math.abs(coast.top - 0.84) < 1e-9);
  assert.equal(coast.bottom, -0.1);
  assert.equal(
    provinceWallBand(0.8, 0.34, [0.2]).bottom,
    0.2,
    '高分辨率山区侧壁落到邻省实际DEM地面',
  );
});
