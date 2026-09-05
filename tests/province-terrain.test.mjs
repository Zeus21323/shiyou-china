import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { elevationAt, HEIGHT_SCALE } from '../lib/terrain-height.ts';
const asset = (name) => new URL('../public/data/' + name, import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(asset(name), 'utf8'));
const manifest = read('terrain/manifest.json');

test('34个省级区域都有独立配准的精细资源，离岛也在数据范围内', () => {
  const features = read('china.geojson').features.filter(
    (f) => f.properties.name,
  );
  assert.equal(features.length, 34);
  assert.equal(Object.keys(manifest.provinces).length, 34);
  const textures = new Set();
  for (const f of features) {
    const r = manifest.provinces[String(f.properties.adcode)];
    assert.equal(r.name, f.properties.name);
    textures.add(r.texture);
    for (const file of [r.texture, r.elevation, r.water, r.mesh])
      assert.ok(fs.existsSync(asset('terrain/' + file)), file);
    const [w, s, e, n] = r.bounds;
    const points = f.geometry.coordinates.flat(
      f.geometry.type === 'Polygon' ? 1 : 2,
    );
    for (const [x, y] of points)
      assert.ok(x >= w && x <= e && y >= s && y <= n, `${r.name} 地理范围`);
    assert.ok(r.width <= 2049 && r.height <= 2049);
    assert.ok(
      r.approximateSampleMetres < manifest.china.approximateSampleMetres,
    );
    assert.ok(r.meshBytes < 12 * 1024 * 1024, '每次只加载有限大小的省级网格');
  }
  assert.equal(textures.size, 34, '不重复套用同一张纹理');
  assert.ok(
    fs.statSync(asset('terrain/relief.bin')).size < 6 * 1024 * 1024,
    '全国概览不打包全部精细模型',
  );
});

test('每个省的精细网格与其自己的 DEM 高程、经纬度 UV 一致', () => {
  for (const [code, r] of Object.entries(manifest.provinces)) {
    const grid = read('terrain/' + r.elevation);
    const raw = fs.readFileSync(asset('terrain/' + r.mesh));
    assert.equal(raw.length, r.vertexCount * 32 + r.indexCount * 4);
    const floats = new Float32Array(
      raw.buffer,
      raw.byteOffset,
      r.vertexCount * 8,
    );
    const indices = new Uint32Array(
      raw.buffer,
      raw.byteOffset + r.vertexCount * 32,
    );
    const [w, s, e, n] = r.bounds;
    for (let i = 0; i < indices.length; i += 97) {
      assert.ok(indices[i] < r.vertexCount);
      const v = indices[i] * 8,
        lon = floats[v] / 0.75 + 104,
        lat = floats[v + 1] / 0.95 + 35;
      const expected =
        Math.max(0, elevationAt(grid, lon, lat)) * HEIGHT_SCALE + 0.025;
      assert.ok(Math.abs(floats[v + 2] - expected) < 0.0004, `${code} DEM`);
      assert.ok(
        Math.abs(floats[v + 6] - (lon - w) / (e - w)) < 0.0001,
        `${code} 经度纹理配准`,
      );
      assert.ok(
        Math.abs(floats[v + 7] - (lat - s) / (n - s)) < 0.0001,
        `${code} 纬度纹理配准`,
      );
      const length = Math.hypot(floats[v + 3], floats[v + 4], floats[v + 5]);
      assert.ok(length > 0.99 && length < 1.01, `${code} 法线`);
    }
  }
});

test('山地、盆地、平原和海岛保留不同的实际地势', () => {
  const height = (code, lon, lat) =>
    elevationAt(
      read('terrain/' + manifest.provinces[code].elevation),
      lon,
      lat,
    );
  assert.ok(height('510000', 104.06, 30.67) < 800, '成都平原');
  assert.ok(height('510000', 100.3, 30.0) > 3000, '川西高山');
  assert.ok(height('320000', 119.4, 33.5) < 50, '苏北平原');
  assert.ok(height('410000', 114.3, 34.8) < 120, '豫东平原');
  assert.ok(height('540000', 91.1, 29.65) > 3000, '青藏高原');
  assert.ok(height('710000', 121.0, 23.5) > 1800, '台湾中央山脉');
  assert.ok(height('460000', 109.7, 18.9) > 500, '海南中部山地');
});

test('同等地理范围的平原、丘陵、山区具有不同网格起伏，而非仅纹理差别', () => {
  const grid = read('terrain/zhejiang-elevation.json');
  const relief = (x, y) => {
    const heights = [];
    for (let i = -4; i <= 4; i++)
      for (let j = -4; j <= 4; j++)
        heights.push(elevationAt(grid, x + i * 0.015, y + j * 0.015));
    return Math.max(...heights) - Math.min(...heights);
  };
  const plain = relief(120.8, 30.75),
    hill = relief(119.95, 29.95),
    mountain = relief(119.1, 30.35);
  assert.ok(plain < 20, '杭嘉湖平原保持低平');
  assert.ok(hill > 150 && hill < 600, '富阳丘陵保持缓起伏');
  assert.ok(mountain > 800, '临安山区保留显著峰谷');
  assert.ok(hill * HEIGHT_SCALE > plain * HEIGHT_SCALE * 10);
  assert.ok(mountain * HEIGHT_SCALE > hill * HEIGHT_SCALE * 2);
  assert.equal(read('terrain/relief.json').heightScale, HEIGHT_SCALE);
  for (const code of Object.keys(manifest.provinces))
    assert.equal(read(`terrain/${code}-relief.json`).heightScale, HEIGHT_SCALE);
});
