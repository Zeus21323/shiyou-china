import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { elevationAt, HEIGHT_SCALE } from '../lib/terrain-height.ts';
import { selectScenicAreas } from '../lib/scenic-selection.ts';
import { placeLabels, overlap } from '../lib/map-layout.ts';
const read = (name) =>
  JSON.parse(
    fs.readFileSync(new URL('../public/data/' + name, import.meta.url), 'utf8'),
  );
test('地形网格的高程来自 DEM，平原与山地有真实差异', () => {
  const g = read('terrain/zhejiang-elevation.json');
  assert.ok(elevationAt(g, 120.8, 30.75) < 30);
  const meta = read('terrain/330000-relief.json');
  const raw = fs.readFileSync(
    new URL('../public/data/terrain/330000-relief.bin', import.meta.url),
  );
  const floats = new Float32Array(
    raw.buffer,
    raw.byteOffset,
    meta.vertexCount * 8,
  );
  const indices = new Uint32Array(
    raw.buffer,
    raw.byteOffset + meta.vertexCount * 32,
  );
  const range = meta.features['330000'];
  let min = Infinity,
    max = -Infinity;
  for (let i = range.start; i < range.start + range.count; i += 17) {
    const p = indices[i] * 8,
      x = floats[p],
      y = floats[p + 1],
      z = floats[p + 2];
    assert.ok(
      Math.abs(
        z -
          (Math.max(0, elevationAt(g, x / 0.75 + 104, y / 0.95 + 35)) *
            HEIGHT_SCALE +
            0.025),
      ) < 0.0002,
    );
    min = Math.min(min, z);
    max = Math.max(max, z);
  }
  assert.ok(max - min > 0.2);
});
test('湿地和森林公园从地图名录统一移除，18篇作品保留', () => {
  const a = selectScenicAreas(read('zhejiang-catalog.json').scenicAreas);
  assert.equal(a.length, 171);
  assert.equal(
    a.some((x) => /湿地|森林公园/.test(x.name)),
    false,
  );
  for (const w of read('works.json'))
    assert.ok(a.some((x) => x.id === w.scenicId));
});
test('连续平移保持标签相对偏移，逐帧避让仍有效', () => {
  let anchors = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    name: '山水',
    x: 180 + (i % 5) * 95,
    y: 220 + Math.floor(i / 5) * 90,
    priority: 1,
    kind: 'scenic',
  }));
  let old = placeLabels(anchors, 1000, 1000).labels;
  for (let step = 0; step < 30; step++) {
    anchors = anchors.map((a) => ({ ...a, x: a.x + 0.5, y: a.y + 0.25 }));
    const next = placeLabels(anchors, 1000, 1000, false, old).labels;
    for (const a of next) {
      const previous = old.find((b) => b.id === a.id);
      if (previous) assert.ok(Math.abs(a.left - previous.left - 0.5) < 0.01);
      for (const b of next)
        if (a.id !== b.id) assert.equal(overlap(a, b), false);
    }
    old = next;
  }
});
