import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  provinceBoundaries,
  boundaryOwner,
  boundaryKey,
  sharedBoundaryHeight,
} from '../lib/province-boundaries.ts';

test('相邻省份反向共边只生成一条，切换高亮时仍仅一个绘制者', () => {
  const features = [
    {
      properties: { adcode: 1 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    },
    {
      properties: { adcode: 2 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [1, 0],
            [2, 0],
            [2, 1],
            [1, 1],
            [1, 0],
          ],
        ],
      },
    },
  ];
  const data = provinceBoundaries(features);
  assert.equal(data.segments.length, 7);
  const shared = data.segments.find((s) => s.owners.length === 2);
  assert.ok(shared);
  for (const focus of [undefined, 1, 2]) {
    assert.equal(
      shared.owners.filter(
        (owner) => boundaryOwner(shared.owners, focus) === owner,
      ).length,
      1,
    );
  }
  assert.equal(boundaryOwner(shared.owners, 2), '2');
  assert.equal(data.vertices.get(boundaryKey([1, 0])).size, 2);
});

test('共边高程随地形连续变化，交接时不会叠加成双倍高度', () => {
  assert.equal(sharedBoundaryHeight(100, []), 100);
  assert.equal(sharedBoundaryHeight(100, [{ height: 500, blend: 0 }]), 100);
  assert.equal(sharedBoundaryHeight(100, [{ height: 500, blend: 0.5 }]), 300);
  assert.equal(sharedBoundaryHeight(100, [{ height: 500, blend: 1 }]), 500);
  const a = { height: 500, blend: 0.5 },
    b = { height: 900, blend: 0.5 };
  assert.equal(
    sharedBoundaryHeight(100, [a, b]),
    sharedBoundaryHeight(100, [b, a]),
  );
  assert.equal(
    sharedBoundaryHeight(100, [
      { ...a, blend: 1 },
      { ...b, blend: 1 },
    ]),
    700,
  );
});

test('全国实际边界拓扑识别跨省共边并保持唯一性', () => {
  const provinces = JSON.parse(
    fs.readFileSync(
      new URL('../public/data/china.geojson', import.meta.url),
      'utf8',
    ),
  ).features;
  const { segments } = provinceBoundaries(provinces);
  assert.ok(segments.filter((s) => s.owners.length > 1).length > 100);
  const keys = segments.map((s) =>
    [boundaryKey(s.a), boundaryKey(s.b)].sort().join('|'),
  );
  assert.equal(new Set(keys).size, keys.length);
});
