import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  provinceAt,
  containsProvince,
  requiresCameraFit,
  provincePolygons,
  provinceFocusPolygons,
  fitProvinceZoom,
} from '../lib/province-view.ts';
import { placeLabels, labelDock, leaderLength } from '../lib/map-layout.ts';
const provinces = JSON.parse(
  fs.readFileSync(
    new URL('../public/data/china.geojson', import.meta.url),
    'utf8',
  ),
).features;

test('海南初次聚焦主体，完整省界及远海离岛仍保留', () => {
  const hainan = provinces.find((p) => p.properties.adcode === 460000);
  const all = provincePolygons(hainan);
  const focus = provinceFocusPolygons(hainan);
  assert.ok(all.length > focus.length);
  assert.equal(focus.length, 1);
  assert.ok(focus.flat(2).every((p) => p[1] > 18));
  assert.ok(all.flat(2).some((p) => p[1] < 10));
  assert.ok(fitProvinceZoom([hainan], 900, 650) > 100);
  const sichuan = provinces.find((p) => p.properties.adcode === 510000);
  assert.deepEqual(provinceFocusPolygons(sichuan), provincePolygons(sichuan));
});
test('取消高亮或拖动切换省份不请求重新适配镜头', () => {
  const current = { revision: 3, width: 900, height: 800 };
  assert.equal(requiresCameraFit(current, 3, 900, 800, true), false);
  assert.equal(requiresCameraFit(current, 4, 900, 800, true), true);
  assert.equal(requiresCameraFit(current, 3, 1000, 800, true), true);
});
test('视野中心命中真实省界，跨省和海面不沿用浙江', () => {
  for (const [lon, lat, code] of [
    [120.15, 30.25, 330000],
    [118.8, 32.05, 320000],
    [117.28, 31.86, 340000],
    [119.3, 26.08, 350000],
  ]) {
    assert.equal(
      Number(provinceAt(provinces, [lon, lat])?.properties.adcode),
      code,
    );
  }
  assert.equal(provinceAt(provinces, [125, 28]), null);
});
test('省界孔洞不会被误判为当前省份', () => {
  const p = {
    properties: { name: '测试', adcode: 1 },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
          [1, 1],
        ],
      ],
    },
  };
  assert.equal(containsProvince(p, [0.5, 0.5]), true);
  assert.equal(containsProvince(p, [1.5, 1.5]), false);
});
test('省名引导线最长50px，端点严格落在牌身边缘', () => {
  const anchors = Array.from({ length: 34 }, (_, i) => ({
    id: String(i),
    name: '某某省',
    x: 250 + (i % 6) * 30,
    y: 300 + Math.floor(i / 6) * 30,
    priority: 1,
    kind: 'province',
  }));
  const placed = placeLabels(anchors, 900, 900, true);
  assert.ok(placed.labels.length);
  assert.ok(placed.hidden.length);
  for (const l of placed.labels) {
    assert.ok(leaderLength(l) <= 50);
    const dock = labelDock(l);
    assert.ok(
      dock.x === 4 ||
        dock.x === l.width - 4 ||
        dock.y === 4 ||
        dock.y === l.height - 4,
    );
  }
});
