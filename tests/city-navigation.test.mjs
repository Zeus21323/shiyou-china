import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  viewportProvince,
  provinceFocusEnabled,
  focusProvince,
  settleProvinceFocus,
} from '../lib/province-view.ts';
import {
  placeLabels,
  overlap,
  cityVisible,
  capitalPosition,
} from '../lib/map-layout.ts';
import { ResourceCache } from '../lib/resource-cache.ts';
const read = (n) =>
  JSON.parse(
    fs.readFileSync(new URL('../public/data/' + n, import.meta.url), 'utf8'),
  );

test('全国隐藏普通城市，仅高亮省份显示所属城市', () => {
  assert.equal(cityVisible(330000), false);
  assert.equal(cityVisible(330000, 330000), true);
  assert.equal(cityVisible(320000, 330000), false);
  assert.equal(cityVisible(440000, '440000'), true);
});

test('北京保持真实屏幕点位，移出可用画面后显示有方向的边缘提示', () => {
  const inside = capitalPosition(450, 400, 1000, 900);
  assert.deepEqual([inside.x, inside.y, inside.offscreen], [450, 400, false]);
  const outside = capitalPosition(1450, 400, 1000, 900);
  assert.equal(outside.offscreen, true);
  assert.equal(outside.direction, 0);
  const anchors = [
    {
      id: 'beijing',
      name: '北京',
      kind: 'capital',
      priority: 1000,
      ...outside,
    },
    {
      id: 'nearby',
      name: '某省',
      kind: 'province',
      priority: 4,
      x: outside.x,
      y: outside.y,
    },
  ];
  assert.equal(placeLabels(anchors, 1000, 900).labels[0].id, 'beijing');
});
test('省会、直辖市、港澳台行政中心及北上广深去重且有坐标来源', () => {
  const data = read('city-labels.json');
  assert.equal(data.cities.length, 35);
  assert.equal(new Set(data.cities.map((c) => c.id)).size, 35);
  assert.equal(new Set(data.cities.map((c) => c.province)).size, 34);
  assert.deepEqual(
    data.cities
      .filter((c) => c.firstTier)
      .map((c) => c.name)
      .sort(),
    ['上海', '北京', '广州', '深圳'],
  );
  for (const c of data.cities) {
    assert.ok(c.sourceId && c.sourceName);
    assert.ok(
      c.coordinates[0] > 73 &&
        c.coordinates[0] < 136 &&
        c.coordinates[1] > 18 &&
        c.coordinates[1] < 54,
    );
  }
  assert.equal(data.crs, 'WGS84');
});
test('中心命中及时选择，近海视野可根据周边陆地选择省份', () => {
  const provinces = read('china.geojson').features;
  assert.equal(
    viewportProvince(provinces, [[120.15, 30.25]])?.properties.adcode,
    330000,
  );
  assert.equal(
    viewportProvince(provinces, [
      [125, 28],
      [120.15, 30.25],
      [119, 29],
    ])?.properties.adcode,
    330000,
  );
  assert.equal(
    viewportProvince(provinces, [
      [125, 28],
      [126, 28],
    ]),
    null,
  );
  const selected = provinces.find((p) => p.properties.adcode === 330000);
  assert.equal(
    viewportProvince(
      provinces,
      [
        [118.8, 32.05],
        [120.15, 30.25],
      ],
      selected,
    )?.properties.adcode,
    320000,
  );
  assert.equal(provinceFocusEnabled(5.999), false);
  assert.equal(provinceFocusEnabled(6), true);
  assert.equal(provinceFocusEnabled(6 - Number.EPSILON * 4), true);
  assert.equal(provinceFocusEnabled(6.001), true);
});

test('6倍前不选省，达到6倍使用鼠标落点且不被视野中心抢回', () => {
  const provinces = read('china.geojson').features;
  const pointer = [120.15, 30.25];
  const center = [[118.8, 32.05]];
  assert.equal(focusProvince(provinces, 5.999, pointer, center), null);
  const zhejiang = focusProvince(provinces, 6, pointer, center);
  assert.equal(zhejiang?.properties.adcode, 330000);
  for (let i = 0; i < 30; i++) {
    // 模拟鼠标静止后持续检查，视野中心即使在江苏也不能替代鼠标。
    assert.equal(
      focusProvince(provinces, 6, pointer, center, zhejiang)?.properties.adcode,
      330000,
    );
  }
  assert.equal(focusProvince(provinces, 6, [125, 28], center, zhejiang), null);
  assert.equal(
    focusProvince(provinces, 6, undefined, center)?.properties.adcode,
    320000,
  );
  assert.equal(focusProvince(provinces, 5.9, pointer, center, zhejiang), null);
});

test('候选省份必须持续稳定，边界短暂跳到邻省不提交选择', () => {
  let proposal = { code: '330000', since: 0 };
  for (const [time, code] of [
    [65, '320000'],
    [130, '330000'],
    [195, '320000'],
    [260, '330000'],
  ]) {
    const result = settleProvinceFocus(proposal, code, time);
    assert.equal(result.ready, false);
    proposal = result.proposal;
  }
  const entered = settleProvinceFocus(proposal, '320000', 400);
  assert.equal(entered.ready, false);
  assert.equal(
    settleProvinceFocus(entered.proposal, '320000', 559).ready,
    false,
  );
  assert.equal(
    settleProvinceFocus(entered.proposal, '320000', 560).ready,
    true,
  );
});
test('城市横排标签与景区牌共同避让，不改变真实锚点', () => {
  const anchors = [
    { id: 'city', name: '杭州', kind: 'city', priority: 12, x: 400, y: 300 },
    {
      id: 'lake',
      name: '杭州西湖',
      kind: 'scenic',
      priority: 10,
      x: 402,
      y: 303,
    },
  ];
  const { labels } = placeLabels(anchors, 1000, 800);
  assert.equal(labels.length, 2);
  assert.equal(overlap(...labels), false);
  assert.equal(labels.find((l) => l.kind === 'city').height, 44);
  for (const label of labels)
    assert.equal(label.x, anchors.find((a) => a.id === label.id).x);
});
test('地形预载与选中共享一次加载，已使用模型在 LRU 淘汰时受保护', async () => {
  let loads = 0;
  const disposed = [];
  const cache = new ResourceCache(
    2,
    async (key) => {
      loads++;
      return key;
    },
    (key) => disposed.push(key),
  );
  cache.prefetch('a');
  const a = cache.acquire('a');
  assert.equal(await a.promise, 'a');
  assert.equal(loads, 1);
  const b = cache.acquire('b');
  await b.promise;
  b.release();
  const c = cache.acquire('c');
  await c.promise;
  c.release();
  assert.ok(!disposed.includes('a'));
  assert.ok(disposed.includes('b'));
  a.release();
  a.release();
  const again = cache.acquire('a');
  await again.promise;
  assert.equal(loads, 3);
  again.release();
});
test('加载失败可以重试，不把失败缓存为已完成', async () => {
  let attempt = 0;
  const cache = new ResourceCache(
    2,
    async () => {
      if (attempt++ === 0) throw Error('network');
      return 'ready';
    },
    () => {},
  );
  const first = cache.acquire('a');
  await assert.rejects(first.promise);
  first.release();
  const next = cache.acquire('a');
  assert.equal(await next.promise, 'ready');
  next.release();
});
