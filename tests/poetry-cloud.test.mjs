import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  buildCloud,
  cloudPosition,
  pickCloudStar,
  isCloudClick,
  cloudWheelDistance,
  smoothCloudDistance,
  cloudStarDiameter,
  cloudLabelOpacity,
} from '../lib/poetry-cloud.ts';
import { skyWorks } from '../lib/poetry-db.ts';
const root = path.resolve(import.meta.dirname, '..');

test('星云总览不显示题名，放大后分批连续显现，缩回时退出', () => {
  for (let i = 0; i < 7; i++) assert.equal(cloudLabelOpacity(1, i), 0);
  assert.equal(cloudLabelOpacity(1.25, 0), 0);
  assert.ok(cloudLabelOpacity(1.4, 0) > 0 && cloudLabelOpacity(1.4, 0) < 1);
  assert.equal(cloudLabelOpacity(1.4, 3), 0);
  assert.equal(cloudLabelOpacity(1.7, 2), 1);
  assert.equal(cloudLabelOpacity(1.7, 6), 0);
  assert.equal(cloudLabelOpacity(3, 6), 1);
  assert.ok(cloudLabelOpacity(1.2501, 0) < 0.001);
});

test('少量作品采用较大星点，总览围绕真实作品收紧，不填充虚构顶点', () => {
  const counts = [1, 10, 100, 1000, 10000, 100000];
  const diameters = counts.map(cloudStarDiameter);
  for (let i = 0; i < diameters.length; i++) {
    assert.ok(diameters[i] >= 7 && diameters[i] <= 46);
    if (i) assert.ok(diameters[i] <= diameters[i - 1]);
  }
  const work = { id: 'single', author: '苏轼', dynasty: '宋' };
  const single = buildCloud([work]);
  assert.equal(single.positions.length, 3);
  assert.equal(single.sizes.length, 1);
  assert.equal(single.radius, 0);
  assert.deepEqual(single.center, [...single.positions]);
  const empty = buildCloud([]);
  assert.deepEqual(empty.center, [0, 0, 0]);
  assert.equal(empty.radius, 0);
  const works = Array.from({ length: 40 }, (_, i) => ({
    ...work,
    id: `fit-${i}`,
  }));
  const cloud = buildCloud(works);
  for (let i = 0; i < works.length; i++) {
    const d = Math.hypot(
      ...cloud.center.map((v, axis) => cloud.positions[i * 3 + axis] - v),
    );
    assert.ok(d <= cloud.radius + 1e-6);
  }
});

test('自适应星点的可点击范围随实际直径扩大，空白处仍不命中', () => {
  const points = new Float32Array([100, 100, 0, 200, 100, 0]);
  const matches = new Float32Array([1, 1]);
  const radii = new Float32Array([24, 10]);
  assert.equal(pickCloudStar(points, matches, 120, 100, radii), 0);
  assert.equal(pickCloudStar(points, matches, 220, 100, radii), -1);
  assert.equal(pickCloudStar(points, matches, 150, 100, radii), -1);
});

test('滚轮单位统一、连续输入累积且快速反向不会越过距离限制', () => {
  assert.equal(cloudWheelDistance(64, 48), cloudWheelDistance(64, 3, 1));
  assert.equal(cloudWheelDistance(64, 320), cloudWheelDistance(64, 1, 2, 320));
  const target = cloudWheelDistance(cloudWheelDistance(64, -100), -100);
  assert.ok(target < cloudWheelDistance(64, -100));
  assert.ok(Math.abs(cloudWheelDistance(target, 200) - 64) < 1e-10);
  assert.equal(cloudWheelDistance(2, -10000), 2);
  assert.equal(cloudWheelDistance(220, 10000), 220);
});

test('缩放缓动在30/60/120帧下保持一致、单调收敛并支持减少动态', () => {
  const results = [30, 60, 120].map((fps) => {
    let distance = 64;
    for (let i = 0; i < fps / 2; i++) {
      const next = smoothCloudDistance(distance, 20, 1 / fps);
      assert.ok(next < distance && next > 20);
      distance = next;
    }
    return distance;
  });
  assert.ok(Math.abs(results[0] - results[2]) < 1e-10);
  assert.equal(smoothCloudDistance(64, 20, 1 / 60, true), 20);
});
const read = (p) =>
  JSON.parse(
    gunzipSync(
      fs.readFileSync(path.join(root, 'public/data/poetry', p + '.gz')),
    ),
  );

test('当前最大景点的作品全部进入单一星云，最后一首也有真实可定位顶点', () => {
  const attraction = read('attractions.index.json').sort(
    (a, b) => b.poemCount - a.poemCount,
  )[0];
  const works = skyWorks(read(`places/${attraction.id}.json`));
  const cloud = buildCloud(works);
  assert.equal(works.length, attraction.poemCount + attraction.curatedCount);
  assert.equal(cloud.ids.size, works.length);
  assert.equal(cloud.positions.length, works.length * 3);
  assert.equal(cloud.colors.length, works.length * 3);
  assert.equal(cloud.sizes.length, works.length);
  for (const value of cloud.positions) assert.ok(Number.isFinite(value));
  const last = works.at(-1);
  assert.equal(cloud.ids.get(last.id), works.length - 1);
  assert.deepEqual(
    [...cloud.positions.slice(-3)],
    cloudPosition(last).map(Math.fround),
  );
});

test('万首规模不采样、不截断，每一首均有顶点和检索索引', () => {
  const works = Array.from({ length: 20000 }, (_, i) => ({
    id: `load-test-${i}`,
    author: `poet-${i % 900}`,
    dynasty: '唐',
  }));
  const cloud = buildCloud(works);
  assert.equal(cloud.ids.size, 20000);
  assert.equal(cloud.positions.length, 60000);
  for (let i = 0; i < works.length; i++)
    assert.equal(cloud.ids.get(works[i].id), i);
});

test('分页、排序、筛选不改变作品空间坐标，同一作者聚合不重合', () => {
  const works = Array.from({ length: 300 }, (_, i) => ({
    id: `work-${i}`,
    author: i % 2 ? '杜甫' : '李白',
    dynasty: '唐',
  }));
  const original = buildCloud(works),
    reversed = buildCloud([...works].reverse());
  for (const work of works) {
    const a = original.ids.get(work.id) * 3,
      b = reversed.ids.get(work.id) * 3;
    assert.deepEqual(
      original.positions.slice(a, a + 3),
      reversed.positions.slice(b, b + 3),
    );
  }
  const page = buildCloud(works.slice(120, 132));
  assert.deepEqual(page.positions, original.positions.slice(120 * 3, 132 * 3));
  assert.equal(
    new Set(works.map((w) => cloudPosition(w).join(','))).size,
    works.length,
  );
  const heights = works.map((w) => cloudPosition(w)[1]);
  assert.ok(Math.max(...heights) - Math.min(...heights) > 1);
});

test('星点拾取覆盖末尾记录，排除筛选外和相机背面，拖动不触发阅读', () => {
  const positions = new Float32Array([
    100,
    100,
    0.5,
    105,
    100,
    0.4,
    200,
    200,
    Infinity,
    700,
    400,
    0.7,
  ]);
  const matches = new Float32Array([1, 0, 1, 1]);
  assert.equal(pickCloudStar(positions, matches, 700, 400), 3);
  assert.equal(pickCloudStar(positions, matches, 200, 200), -1);
  assert.equal(pickCloudStar(positions, matches, 106, 100), 0);
  assert.equal(pickCloudStar(positions, matches, 0, 0), -1);
  assert.equal(isCloudClick({ x: 0, y: 0 }, { x: 1, y: 2 }), true);
  assert.equal(isCloudClick({ x: 0, y: 0 }, { x: 20, y: 2 }), false);
  assert.equal(buildCloud([]).positions.length, 0);
  assert.throws(() =>
    buildCloud([
      { id: 'a', author: '甲', dynasty: '唐' },
      { id: 'a', author: '甲', dynasty: '唐' },
    ]),
  );
});
