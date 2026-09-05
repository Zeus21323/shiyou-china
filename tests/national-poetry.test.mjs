import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  skyWorks,
  resolvePoetryWork,
  loadAttractionSky,
} from '../lib/poetry-db.ts';
import { containsProvince } from '../lib/province-view.ts';
import { layoutStarLabels } from '../lib/star-layout.ts';
const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(root, '../work/poetry-db');
const target = path.join(root, 'public/data/poetry');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const index = read(path.join(target, 'attractions.index.json'));

test('原有18篇核对诗文的正文、出处、关联及核对说明完整保留', () => {
  const original = read(path.join(root, 'public/data/works.json'));
  const published = index.flatMap(
    (a) => read(path.join(target, 'places', a.id + '.json')).curated,
  );
  assert.equal(published.length, original.length);
  for (const work of original) {
    const matches = published.filter((w) => w.id === work.id);
    assert.equal(matches.length, 1);
    const mapped = matches[0];
    for (const field of Object.keys(work).filter(
      (k) => !['scenicId', 'verification'].includes(k),
    ))
      assert.deepEqual(mapped[field], work[field]);
    assert.equal(mapped.verification, 'verified');
    assert.equal(mapped.verificationNote, work.verification);
    assert.equal(
      index.find((a) => a.id === mapped.scenicId)?.legacyId,
      work.scenicId,
    );
  }
});

test('全国接入覆盖指定数据库全部景点与关系，分省及出处无丢失', () => {
  const original = read(path.join(source, 'attractions.index.json'));
  const meta = read(path.join(source, 'manifest.json'));
  assert.equal(index.length, original.length);
  assert.equal(new Set(index.map((a) => a.id)).size, index.length);
  assert.equal(new Set(index.map((a) => a.provinceCode)).size, 31);
  let relations = 0,
    curated = 0;
  for (const a of original) {
    const published = index.find((b) => b.id === a.id);
    assert.ok(published, a.id);
    for (const key of [
      'name',
      'province',
      'city',
      'grade',
      'poemCount',
      'note',
      'catalogSource',
    ])
      assert.equal(published[key], a[key]);
    assert.match(published.sourceUrl, /^https?:\/\//);
    const sky = read(path.join(target, 'places', a.id + '.json'));
    assert.equal(sky.scenicId, a.id);
    const raw = read(path.join(source, a.relationFile));
    assert.deepEqual(
      sky.rows.map(([id, , , , anchor, score, type, status, match]) => [
        id,
        anchor,
        score,
        type,
        status,
        match,
      ]),
      raw,
    );
    assert.equal(
      published.directCount,
      sky.rows.filter((r) => r[6] !== 'regional-context').length,
    );
    assert.equal(
      published.regionalCount,
      sky.rows.filter((r) => r[6] === 'regional-context').length,
    );
    relations += sky.rows.length;
    curated += sky.curated.length;
  }
  assert.equal(relations, meta.relations);
  assert.equal(curated, 18);
});

test('十万首正文逐分片保持原文与来源一致，每条星河记录可解析正文', () => {
  const poems = new Map();
  for (const name of fs.readdirSync(path.join(source, 'poems'))) {
    const original = fs.readFileSync(path.join(source, 'poems', name));
    const published = fs.readFileSync(path.join(target, 'poems', name));
    assert.equal(
      createHash('sha256').update(published).digest('hex'),
      createHash('sha256').update(original).digest('hex'),
    );
    for (const p of JSON.parse(published)) {
      assert.ok(!poems.has(p.id));
      poems.set(p.id, p);
      assert.ok(p.body && p.source.file && p.source.row >= 2);
    }
  }
  assert.equal(
    poems.size,
    read(path.join(source, 'manifest.json')).candidatePoems,
  );
  for (const a of index) {
    const sky = read(path.join(target, 'places', a.id + '.json'));
    for (const [id, title, author, dynasty] of sky.rows) {
      const p = poems.get(id);
      assert.ok(p, id);
      assert.equal(title, p.title);
      assert.equal(author, p.author);
      assert.equal(dynasty, p.dynasty);
    }
  }
});

test('区域诗词不会伪装为已考证题咏，分页保留所有可访问作品', () => {
  for (const a of index) {
    const sky = read(path.join(target, 'places', a.id + '.json')),
      works = skyWorks(sky);
    assert.equal(works.length, sky.rows.length + sky.curated.length);
    assert.equal(
      works.filter((w) => w.verification === 'verified').length,
      sky.curated.length,
    );
    for (const w of works.filter((w) => w.verification === 'regional'))
      assert.match(w.evidence, /不表示作品题咏该景区/);
    const visited = [];
    for (let page = 0; page < Math.ceil(works.length / 12); page++)
      visited.push(...works.slice(page * 12, (page + 1) * 12).map((w) => w.id));
    assert.deepEqual(
      visited,
      works.map((w) => w.id),
    );
  }
});

test('星河题名布局兼顾手机与桌面，不互相遮挡或盖住操作区', () => {
  for (const [width, height] of [
    [390, 720],
    [900, 800],
    [1440, 1000],
  ]) {
    const anchors = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      x: width / 2 + Math.cos(i * 2.399) * width * 0.25,
      y: height / 2 + Math.sin(i * 2.399) * height * 0.2,
    }));
    const { labels, hidden } = layoutStarLabels(anchors, width, height);
    assert.equal(labels.length + hidden.length, 12);
    assert.ok(labels.length > 0);
    for (const a of labels) {
      assert.ok(a.top >= 190 && a.top + a.height <= height - 190);
      for (const b of labels)
        if (a.id !== b.id)
          assert.ok(
            a.left + a.width + 8 <= b.left ||
              b.left + b.width + 8 <= a.left ||
              a.top + a.height + 8 <= b.top ||
              b.top + b.height + 8 <= a.top,
          );
    }
  }
});

test('全国坐标与名录逐点对应，省份归属有依据且各省有地图入口', () => {
  const points = read(
    path.join(root, 'public/data/national-poetry-points.json'),
  ).points;
  const legacy = read(path.join(root, 'public/data/scenic-points.json')).points;
  const provinces = read(path.join(root, 'public/data/china.geojson')).features;
  const manifest = read(path.join(target, 'manifest.json'));
  assert.equal(new Set(points.map((p) => p.scenicId)).size, points.length);
  assert.equal(index.filter((a) => a.point).length, points.length);
  for (const point of points) {
    const a = index.find((a) => a.id === point.scenicId);
    assert.ok(a, point.scenicId);
    assert.deepEqual(a.point, point);
    assert.equal(point.provinceCode, a.provinceCode);
    assert.ok(
      Number.isFinite(point.longitude) && Number.isFinite(point.latitude),
    );
    assert.equal(point.coordinateSystem, 'WGS84');
    const inside = containsProvince(
      provinces.find((p) => p.properties.adcode === a.provinceCode),
      [point.longitude, point.latitude],
    );
    if (!inside) {
      // 既有离岛/湖岸POI可能落在概化省界之外，保留核验坐标，不吸附或伪造位置。
      const previous = legacy.find((p) => p.scenicId === point.legacyId);
      assert.ok(previous, a.name);
      assert.equal(point.longitude, previous.longitude);
      assert.equal(point.latitude, previous.latitude);
      assert.equal(point.sourceUrl, previous.sourceUrl);
      assert.ok(point.address.startsWith(a.province), a.name);
    }
    assert.match(point.sourceUrl, /^https:\/\/(?:www\.|lbs\.)?amap\.com\//);
  }
  for (const region of manifest.coverage) {
    const places = index.filter((a) => a.provinceCode === region.code);
    assert.equal(region.attractions, places.length);
    assert.equal(region.located, places.filter((a) => a.point).length);
    if (places.length) assert.ok(region.located > 0, region.name);
  }
});

test('正文懒加载准确解析分片，失败后可重试且已核对全文无需再次请求', async (t) => {
  const attraction = index.find((a) => a.provinceCode === 610000);
  const sky = read(path.join(target, 'places', attraction.id + '.json'));
  const work = skyWorks(sky).find((w) => !w.body);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls++;
    if (calls === 1) return new Response('', { status: 503 });
    const relative = String(url).replace('/data/poetry/', '');
    return new Response(fs.readFileSync(path.join(target, relative)), {
      status: 200,
    });
  });
  await assert.rejects(resolvePoetryWork(work));
  const full = await resolvePoetryWork(work);
  const original = read(
    path.join(source, 'poems', work.id.slice(-2) + '.json'),
  ).find((p) => p.id === work.id);
  assert.equal(full.body, original.body);
  assert.equal(full.sourceRow, original.source.row);
  assert.match(
    full.sourceUrl,
    /^https:\/\/github.com\/Werneror\/Poetry\/blob\/master\//,
  );
  assert.equal(await resolvePoetryWork(full), full);
  assert.equal(calls, 2);
  const loaded = await loadAttractionSky(attraction.id);
  assert.deepEqual(loaded, sky);
});
