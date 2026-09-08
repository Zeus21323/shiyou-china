import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import {
  skyWorks,
  resolvePoetryWork,
  loadAttractionSky,
} from '../lib/poetry-db.ts';
import { containsProvince } from '../lib/province-view.ts';
import { layoutStarLabels } from '../lib/star-layout.ts';
const root = path.resolve(import.meta.dirname, '..'),
  target = path.join(root, 'public/data/poetry');
const read = (name) =>
  JSON.parse(gunzipSync(fs.readFileSync(path.join(target, name + '.gz'))));
const index = read('attractions.index.json'),
  manifest = read('manifest.json');
const db = new DatabaseSync(
  path.join(root, '../work/poetry-db/poetry-wenyan-attractions-v2.sqlite3'),
  { readOnly: true },
);
const originals = db
  .prepare(
    'SELECT p.* FROM poems p WHERE p.id IN (SELECT poem_id FROM effective_relations)',
  )
  .all();
const relations = db
  .prepare('SELECT * FROM effective_relations ORDER BY attraction_id,poem_id')
  .all();
const sourcePlaces = db
  .prepare(
    'SELECT * FROM attractions WHERE id IN (SELECT attraction_id FROM effective_relations)',
  )
  .all();
const evidence = db
  .prepare(
    'SELECT c.* FROM curated_relations c JOIN effective_relations r USING(poem_id,attraction_id)',
  )
  .all();
db.close();

test('正式库精确导入3100关系、3093篇文本与206景区，无候选或旧版附加作品', () => {
  assert.equal(manifest.formalOnly, true);
  assert.equal(index.length, 206);
  assert.equal(manifest.uniqueTexts, 3093);
  assert.equal(manifest.poetryCount, 2619);
  assert.equal(manifest.proseCount, 474);
  assert.equal(manifest.relations, 3100);
  assert.equal(manifest.curatedWorks, 0);
  assert.deepEqual(
    index.map((a) => a.id).sort(),
    sourcePlaces.map((a) => a.id).sort(),
  );
  const exported = [];
  for (const a of index) {
    const original = sourcePlaces.find((p) => p.id === a.id),
      sky = read(`places/${a.id}.json`);
    for (const key of ['name', 'province', 'city', 'grade', 'note'])
      assert.equal(a[key], original[key]);
    assert.equal(sky.curated.length, 0);
    assert.equal(sky.rows.length, a.poemCount);
    assert.ok(a.poemCount > 0);
    const works = skyWorks(sky);
    assert.equal(works.length, sky.rows.length);
    assert.ok(works.every((w) => w.verification === 'verified'));
    for (const row of sky.rows) {
      assert.equal(row[7], 'curated-confirmed');
      const r = relations.find(
        (r) => r.attraction_id === a.id && r.poem_id === row[0],
      );
      assert.ok(r);
      assert.deepEqual(
        [row[4], row[5], row[6], row[7], row[8]],
        [r.anchor, r.score, r.relation_type, r.status, r.match],
      );
      const e = evidence.find(
        (e) => e.attraction_id === a.id && e.poem_id === row[0],
      );
      assert.equal(sky.evidence[row[0]].reasoning, e.reasoning);
      assert.equal(sky.evidence[row[0]].quote, e.evidence_quote);
      assert.equal(
        works.find((w) => w.id === row[0]).genre,
        row[9] === 'prose' ? '文' : '诗词',
      );
      exported.push(a.id + '/' + row[0]);
    }
  }
  assert.equal(exported.length, 3100);
  assert.equal(new Set(exported).size, 3100);
  assert.deepEqual(
    exported.sort(),
    relations.map((r) => r.attraction_id + '/' + r.poem_id).sort(),
  );
  assert.deepEqual(
    fs.readdirSync(path.join(target, 'places')).sort(),
    index.map((a) => a.id + '.json.gz').sort(),
  );
});

test('全文、文体、题名、作者、朝代及原始出处逐篇与SQLite一致', () => {
  const published = fs
    .readdirSync(path.join(target, 'poems'))
    .flatMap((name) => read('poems/' + name.slice(0, -3)));
  assert.equal(published.length, 3093);
  assert.equal(new Set(published.map((p) => p.id)).size, 3093);
  for (const p of published) {
    const original = originals.find((o) => o.id === p.id);
    assert.ok(original);
    for (const field of ['title', 'author', 'dynasty', 'genre', 'body'])
      assert.equal(p[field], original[field]);
    assert.equal(p.source.file, original.source_file);
    assert.equal(p.source.row, original.source_row);
    assert.equal(p.source.license, original.license);
    if (p.source.file.startsWith('daizhige/'))
      assert.match(
        p.source.url,
        /github.com\/garychowcmu\/daizhigev20\/blob\/HEAD\//,
      );
    else if (p.source.file.startsWith('guwenguanzhi/'))
      assert.match(
        p.source.url,
        /github.com\/niuniu-869\/guwenguanzhi\/blob\/HEAD\/data\/articles\//,
      );
    else
      assert.match(
        p.source.url,
        /github.com\/Werneror\/Poetry\/blob\/master\//,
      );
  }
});

test('地图点位只取正式关系景区，省份统计与坐标来源一致', () => {
  const points = JSON.parse(
    fs.readFileSync(path.join(root, 'public/data/national-poetry-points.json')),
  ).points;
  const provinces = JSON.parse(
    fs.readFileSync(path.join(root, 'public/data/china.geojson')),
  ).features;
  const legacy = JSON.parse(
    fs.readFileSync(path.join(root, 'public/data/scenic-points.json')),
  ).points;
  const linked = points.filter((p) => index.some((a) => a.id === p.scenicId));
  assert.equal(index.filter((a) => a.point).length, linked.length);
  for (const p of linked) {
    const a = index.find((a) => a.id === p.scenicId);
    assert.ok(a.poemCount > 0);
    assert.deepEqual(a.point, p);
    assert.equal(p.provinceCode, a.provinceCode);
    assert.equal(p.coordinateSystem, 'WGS84');
    if (
      !containsProvince(
        provinces.find((p) => p.properties.adcode === a.provinceCode),
        [p.longitude, p.latitude],
      )
    ) {
      const old = legacy.find((o) => o.scenicId === p.legacyId);
      assert.ok(old, a.name);
      assert.equal(p.longitude, old.longitude);
      assert.equal(p.latitude, old.latitude);
    }
  }
  for (const region of manifest.coverage) {
    const rows = index.filter((a) => a.provinceCode === region.code);
    assert.equal(region.attractions, rows.length);
    assert.equal(region.located, rows.filter((a) => a.point).length);
    assert.equal(
      region.relations,
      rows.reduce((n, a) => n + a.poemCount, 0),
    );
  }
});

test('文言散文按需加载保留文体与出处，失败可重试', async (t) => {
  const a = index.find((a) =>
    read(`places/${a.id}.json`).rows.some((r) => r[9] === 'prose'),
  );
  const sky = read(`places/${a.id}.json`),
    work = skyWorks(sky).find((w) => w.genre === '文');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls++;
    if (calls === 1) return new Response('', { status: 503 });
    return new Response(
      fs.readFileSync(
        path.join(target, String(url).replace('/data/poetry/', '')),
      ),
    );
  });
  await assert.rejects(resolvePoetryWork(work));
  const full = await resolvePoetryWork(work);
  assert.equal(full.genre, '文');
  assert.equal(full.body, originals.find((p) => p.id === work.id).body);
  assert.ok(full.sourceRepository);
  assert.equal(await resolvePoetryWork(full), full);
  assert.equal(calls, 2);
  assert.deepEqual(await loadAttractionSky(a.id), sky);
});

test('题名布局兼顾手机与桌面，不互相遮挡', () => {
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
    for (const a of labels)
      for (const b of labels)
        if (a.id !== b.id)
          assert.ok(
            a.left + a.width + 8 <= b.left ||
              b.left + b.width + 8 <= a.left ||
              a.top + a.height + 8 <= b.top ||
              b.top + b.height + 8 <= a.top,
          );
  }
});
