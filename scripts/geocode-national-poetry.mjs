/** 全国诗词景点坐标：官方POI、受限并发、断点缓存。密钥不写入输出。 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { scenicName, scenicNameScore } from '../lib/scenic-names.ts';
import { containsProvince } from '../lib/province-view.ts';
const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(root, '../work/poetry-db');
loadEnvFile(path.join(root, '.env.local'));
const key = process.env.AMAP_WEB_SERVICE_KEY;
if (!key) throw Error('缺少本地高德Web服务配置');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const places = read(path.join(source, 'attractions.index.json'));
const provinces = read(path.join(root, 'public/data/china.geojson')).features;
const folder = path.join(root, 'work/national-geocoding');
fs.mkdirSync(folder, { recursive: true });
const output = path.join(root, 'public/data/national-poetry-points.json');
const previous = fs.existsSync(output) ? read(output).points : [];
const points = new Map(previous.map((p) => [p.scenicId, p]));
const oldCatalog = read(
  path.join(root, 'public/data/zhejiang-catalog.json'),
).scenicAreas;
const oldPoints = read(
  path.join(root, 'public/data/scenic-points.json'),
).points;
const oldAddresses = read(
  path.join(root, 'public/data/scenic-addresses.json'),
).addresses;
for (const place of places.filter((a) => a.province === '浙江省')) {
  const matches = oldCatalog
    .map((a) => ({
      a,
      score: scenicNameScore(place.name, a.name, place.province, place.city),
    }))
    .filter((x) => x.score === 1);
  if (matches.length !== 1) continue;
  const p = oldPoints.find((p) => p.scenicId === matches[0].a.id);
  if (p)
    points.set(place.id, {
      ...p,
      scenicId: place.id,
      provinceCode: 330000,
      address: oldAddresses[matches[0].a.id]?.address ?? '',
      legacyId: matches[0].a.id,
    });
}
function toWgs(lon, lat) {
  const pi = Math.PI;
  const delta = (lon, lat) => {
    const x = lon - 105,
      y = lat - 35;
    let a =
      -100 +
      2 * x +
      3 * y +
      0.2 * y * y +
      0.1 * x * y +
      0.2 * Math.sqrt(Math.abs(x));
    let b =
      300 +
      x +
      2 * y +
      0.1 * x * x +
      0.1 * x * y +
      0.1 * Math.sqrt(Math.abs(x));
    a += ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3;
    a += ((20 * Math.sin(y * pi) + 40 * Math.sin((y * pi) / 3)) * 2) / 3;
    a +=
      ((160 * Math.sin((y * pi) / 12) + 320 * Math.sin((y * pi) / 30)) * 2) / 3;
    b += ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3;
    b += ((20 * Math.sin(x * pi) + 40 * Math.sin((x * pi) / 3)) * 2) / 3;
    b +=
      ((150 * Math.sin((x * pi) / 12) + 300 * Math.sin((x * pi) / 30)) * 2) / 3;
    const rad = (lat * pi) / 180,
      magic = 1 - 0.006693421622965943 * Math.sin(rad) ** 2;
    return [
      (b * 180) / ((6378245 / Math.sqrt(magic)) * Math.cos(rad) * pi),
      (a * 180) /
        (((6378245 * (1 - 0.006693421622965943)) / (magic * Math.sqrt(magic))) *
          pi),
    ];
  };
  let x = lon,
    y = lat;
  for (let i = 0; i < 4; i++) {
    const [a, b] = delta(x, y);
    x = lon - a;
    y = lat - b;
  }
  return [x, y];
}
const str = (s) => (typeof s === 'string' ? s : '');
const state = { checked: 0, requests: 0, failed: 0 };
let stopped = false,
  lastRequest = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function query(place, words, province, attempt = 0) {
  const wait = Math.max(0, lastRequest + 400 - Date.now());
  lastRequest = Date.now() + wait;
  await sleep(wait);
  const url = new URL('https://restapi.amap.com/v3/place/text');
  url.search = new URLSearchParams({
    key,
    keywords: words,
    city: String(province.properties.adcode),
    citylimit: 'true',
    offset: '20',
    page: '1',
    extensions: 'base',
  }).toString();
  try {
    state.requests++;
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw Error('network');
    const d = await r.json();
    if (d.status !== '1') {
      const code = String(d.infocode).replace(/[^0-9]/g, '');
      if (
        [
          '10003',
          '10004',
          '10044',
          '10045',
          '10001',
          '10009',
          '10010',
          '10012',
        ].includes(code)
      ) {
        stopped = true;
        console.log('官方接口需要处理，状态码：' + code);
      }
      throw Error('api');
    }
    return (d.pois ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      location: p.location,
      province: p.pname,
      city: p.cityname,
      district: p.adname,
      address: p.address,
      type: p.type,
      typecode: p.typecode,
    }));
  } catch {
    if (!stopped && attempt < 2) {
      await sleep(1500 * (attempt + 1));
      return query(place, words, province, attempt + 1);
    }
    state.failed++;
    return null;
  }
}
const review = [];
function save() {
  const byProvince = {};
  for (const p of points.values())
    byProvince[p.provinceCode] = (byProvince[p.provinceCode] ?? 0) + 1;
  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        source: '高德开放平台POI',
        coordinateSystem: 'WGS84',
        queriedAt: new Date().toISOString(),
        matched: points.size,
        total: places.length,
        byProvince,
        points: [...points.values()],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(folder, 'review.json'),
    JSON.stringify(review, null, 2),
  );
  console.log(
    JSON.stringify({
      ...state,
      matched: points.size,
      total: places.length,
      stopped,
    }),
  );
}
const pending = places
  .filter((p) => !points.has(p.id))
  .sort(
    (a, b) =>
      b.grade.localeCompare(a.grade) || a.province.localeCompare(b.province),
  );
let cursor = 0;
async function worker() {
  while (cursor < pending.length && !stopped) {
    const place = pending[cursor++],
      province = provinces.find((p) => p.properties.name === place.province);
    if (!province) throw Error('景区省份不存在：' + place.province);
    const cacheFile = path.join(folder, place.id + '.json');
    let candidates = fs.existsSync(cacheFile) ? read(cacheFile) : null;
    if (!candidates) {
      candidates = await query(place, place.name, province);
      if (
        candidates &&
        !candidates.some(
          (p) =>
            scenicNameScore(place.name, p.name, place.province, place.city) >=
            0.88,
        )
      ) {
        const shorter = scenicName(place.name, place.province, place.city);
        if (shorter.length >= 2 && shorter !== place.name) {
          const more = await query(place, shorter, province);
          if (more) candidates.push(...more);
        }
      }
      if (candidates) fs.writeFileSync(cacheFile, JSON.stringify(candidates));
    }
    if (candidates) {
      const distinct = [...new Map(candidates.map((p) => [p.id, p])).values()];
      const ranked = distinct
        .flatMap((p) => {
          if (
            str(p.province) !== place.province ||
            /停车场|售票处|游客中心|停车位|出入口|卫生间|公交|地铁|酒店|宾馆|服务中心|东北门|西北门|东南门|西南门/.test(
              p.name,
            )
          )
            return [];
          const coords = str(p.location).split(',').map(Number);
          if (coords.length !== 2 || !coords.every(Number.isFinite)) return [];
          const wgs = toWgs(...coords);
          if (!containsProvince(province, wgs)) return [];
          const score = scenicNameScore(
            place.name,
            p.name,
            place.province,
            place.city,
          );
          return score >= 0.88 ? [{ p, coords, wgs, score }] : [];
        })
        .sort((a, b) => b.score - a.score);
      if (
        ranked.length &&
        (ranked.length === 1 || ranked[0].score - ranked[1].score > 0.05)
      ) {
        const { p, coords, wgs, score } = ranked[0];
        points.set(place.id, {
          scenicId: place.id,
          label: scenicName(place.name, place.province, place.city),
          longitude: wgs[0],
          latitude: wgs[1],
          provinceCode: province.properties.adcode,
          poiId: p.id,
          poiName: p.name,
          address: [
            str(p.province),
            str(p.city),
            str(p.district),
            str(p.address),
          ]
            .filter((v, i, a) => v && a.indexOf(v) === i)
            .join(''),
          sourceUrl: 'https://www.amap.com/detail/' + p.id,
          coordinateSystem: 'WGS84',
          originalCoordinateSystem: 'GCJ02',
          originalCoordinates: coords,
          matchScore: score,
          note: '官方POI名称及省份匹配；联合景区为代表点，非边界范围。',
        });
      } else
        review.push({
          id: place.id,
          name: place.name,
          province: place.province,
          reason: ranked.length ? 'multiple-matches' : 'no-confident-match',
          candidates: ranked.map((x) => ({
            id: x.p.id,
            name: x.p.name,
            score: x.score,
          })),
        });
    }
    state.checked++;
    if (state.checked % 25 === 0) save();
  }
}
save();
await Promise.all([worker(), worker()]);
save();
if (stopped) process.exitCode = 2;
