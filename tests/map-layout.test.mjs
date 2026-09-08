import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  placeLabels,
  overlap,
  clusterAnchors,
  scenicInteractionAt,
} from '../lib/map-layout.ts';

test('边界景点保护覆盖标签、引导线和落点，离开后恢复省份命中', () => {
  const label = {
    id: 'lushan',
    kind: 'scenic',
    name: '庐山',
    priority: 5,
    x: 516,
    y: 375,
    left: 475,
    top: 308,
    width: 82,
    height: 36,
  };
  for (const point of [
    { x: 516, y: 326 },
    { x: 516, y: 360 },
    { x: 516, y: 375 },
    { x: 516, y: 292 },
    { x: 460, y: 326 },
  ])
    assert.equal(scenicInteractionAt(point, [label]), 'lushan');
  assert.equal(scenicInteractionAt({ x: 440, y: 326 }, [label]), null);
  assert.equal(scenicInteractionAt({ x: 560, y: 385 }, [label]), null);
  assert.equal(scenicInteractionAt({ x: 516, y: 326 }, []), null);
  assert.equal(
    scenicInteractionAt({ x: 516, y: 326 }, [{ ...label, kind: 'province' }]),
    null,
  );
  const moved = { ...label, left: 675, x: 716 };
  assert.equal(scenicInteractionAt({ x: 516, y: 326 }, [moved]), null);
  assert.equal(scenicInteractionAt({ x: 716, y: 326 }, [moved]), 'lushan');
});

test('官方坐标有唯一来源、合法坐标系，覆盖全部5A和诗文目的地', () => {
  const read = (name) =>
    JSON.parse(
      readFileSync(new URL('../public/data/' + name, import.meta.url), 'utf8'),
    );
  const data = read('scenic-points.json');
  const areas = read('zhejiang-catalog.json').scenicAreas;
  const works = read('works.json');
  const ids = new Set(data.points.map((p) => p.scenicId));
  assert.equal(ids.size, data.points.length);
  assert.equal(
    new Set(data.points.map((p) => p.poiId)).size,
    data.points.length,
  );
  assert.equal(data.matched + data.pendingReview, areas.length);
  for (const p of data.points) {
    assert.ok(areas.some((a) => a.id === p.scenicId));
    assert.equal(p.coordinateSystem, 'WGS84');
    assert.equal(p.originalCoordinateSystem, 'GCJ02');
    assert.ok(
      p.longitude > 118 &&
        p.longitude < 123 &&
        p.latitude > 27 &&
        p.latitude < 32,
    );
    assert.match(p.sourceUrl, /^https:\/\/www\.amap\.com\/detail\/B[A-Z0-9]+$/);
    assert.ok(p.originalCoordinates.every(Number.isFinite));
  }
  for (const a of areas.filter((a) => a.grade === '5A'))
    assert.ok(ids.has(a.id), a.name);
  for (const w of works) assert.ok(ids.has(w.scenicId), w.title);
});
test('密集点位标签不重叠，且不越过标题和操作区', () => {
  const anchors = Array.from({ length: 245 }, (_, i) => ({
    id: String(i),
    name: '景区' + i,
    x: 100 + (i % 15) * 11,
    y: 250 + Math.floor(i / 15) * 9,
    priority: i < 22 ? 10 : 1,
    kind: 'scenic',
  }));
  for (const [w, h] of [
    [390, 660],
    [900, 800],
    [1440, 900],
  ]) {
    const { labels, hidden } = placeLabels(anchors, w, h);
    assert.equal(labels.length + hidden.length, 245);
    for (const a of labels) {
      assert.ok(a.top >= 155 && a.top + a.height <= h - 180);
      assert.ok(a.left >= 10 && a.left + a.width <= w - 10);
      for (const b of labels)
        if (a.id !== b.id) assert.equal(overlap(a, b), false);
    }
  }
});
test('同一位置先展示5A代表点，聚合完整保留成员', () => {
  const a = [
    { id: 'four', name: '4A', x: 300, y: 300, priority: 1, kind: 'scenic' },
    { id: 'five', name: '5A', x: 300, y: 300, priority: 10, kind: 'scenic' },
  ];
  const groups = clusterAnchors(a);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].anchor.id, 'five');
  assert.equal(groups[0].members.length, 2);
});
test('同一视野放大后相邻点自然展开，不移动原坐标', () => {
  const a = [
    { id: 'a', name: '甲', x: 300, y: 300, priority: 10, kind: 'scenic' },
    { id: 'b', name: '乙', x: 312, y: 300, priority: 10, kind: 'scenic' },
  ];
  assert.equal(clusterAnchors(a).length, 1);
  const zoomed = a.map((p) => ({ ...p, x: 300 + (p.x - 300) * 4 }));
  assert.equal(clusterAnchors(zoomed).length, 2);
  assert.equal(a[1].x, 312);
});
test('屏幕无法容纳时留在隐藏列表，不强制相互覆盖', () => {
  const a = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    name: '同名景区',
    x: 190,
    y: 280,
    priority: 1,
    kind: 'scenic',
  }));
  const result = placeLabels(a, 390, 660);
  assert.ok(result.hidden.length > 0);
  assert.ok(result.labels.length > 0);
});

test('景点横向名称始终在真实点位正上方，移动后仍保持竖直引线', () => {
  const anchors = [
    {
      id: 'a',
      name: '杭州西湖风景名胜区',
      x: 300,
      y: 380,
      priority: 10,
      kind: 'scenic',
    },
    { id: 'b', name: '相邻景区', x: 320, y: 390, priority: 1, kind: 'scenic' },
    { id: 'c', name: '另一景区', x: 550, y: 420, priority: 1, kind: 'scenic' },
  ];
  const first = placeLabels(anchors, 1000, 800, true);
  assert.ok(first.labels.length >= 2);
  const moved = placeLabels(
    anchors.map((a) => ({ ...a, x: a.x + 15, y: a.y + 8 })),
    1000,
    800,
    true,
    first.labels,
  );
  for (const l of [...first.labels, ...moved.labels]) {
    assert.equal(l.left + l.width / 2, l.x);
    assert.ok(l.top + l.height <= l.y - 24);
    assert.ok(l.width > l.height);
  }
  for (const a of moved.labels)
    for (const b of moved.labels) {
      if (a.id === b.id) continue;
      const stem = {
        left: a.x - 3,
        top: a.top + a.height,
        width: 6,
        height: a.y - a.top - a.height,
      };
      assert.equal(overlap(stem, b, 3), false);
    }
});
