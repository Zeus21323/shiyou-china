/** 官方 POI 核验工具。密钥仅由本地环境读取；不进入网页、数据或日志。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  loadEnvFile(path.join(root, '.env.local'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const key = process.env.AMAP_WEB_SERVICE_KEY;
if (!key || !key.trim())
  throw Error(
    '请先在本地 .env.local 配置 AMAP_WEB_SERVICE_KEY（高德 Web服务 Key）。',
  );
const catalog = JSON.parse(
  await fs.readFile(
    path.join(root, 'public/data/zhejiang-catalog.json'),
    'utf8',
  ),
);
const aliases = {
  'zj-0001': ['杭州西湖风景名胜区', '西湖风景名胜区'],
  'zj-0002': ['西溪国家湿地公园', '西溪国家湿地公园景区'],
  'zj-0466': ['沈园', '鲁迅故里'],
  'zj-0644': ['江郎山风景区', '廿八都古镇'],
  'zj-0202': ['刘伯温故里景区(暂停开放)'],
  'zj-0390': ['嘉兴南湖旅游区'],
  'zj-0865': ['云和梯田景区'],
  'zj-0866': ['缙云仙都景区'],
};
// 对已查看的官方返回结果作逐项消歧；联合景区明确使用代表点。
const selectedPois = {
  'zj-0215': { id: 'B024104087', name: '江心屿' },
  'zj-0468': { id: 'B023F00N0U', name: '兰亭景区' },
  'zj-0466': { id: 'B0FFFR0TIH', name: '沈氏园' },
  'zj-0644': { id: 'B023A00E21', name: '江郎山省级旅游度假区' },
  'zj-0718': { id: 'B02445IKZ7', name: '普陀山风景名胜区' },
  'zj-0756': { id: 'B02400SPSI', name: '天台山国家级风景名胜区' },
};
function clean(s, a) {
  for (const t of ['浙江省', a.city, a.district === '市辖区' ? '' : a.district])
    if (t) s = s.replaceAll(t, '');
  return s
    .replace(/国家[级]?|[45]A[级]?|[·\s—－\-（）()“”「」]/g, '')
    .replace(
      /(风景名胜区|风景旅游区|文化旅游区|旅游度假区|旅游景区|风景区|旅游区|景区)$/,
      '',
    );
}
// 高德 GCJ-02 转为 WGS84，保留原值和坐标系，绝不混用。
function offset(lon, lat) {
  const x = lon - 105,
    y = lat - 35,
    pi = Math.PI;
  let dlat =
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  let dlon =
    300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  dlat += ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3;
  dlat += ((20 * Math.sin(y * pi) + 40 * Math.sin((y / 3) * pi)) * 2) / 3;
  dlat +=
    ((160 * Math.sin((y / 12) * pi) + 320 * Math.sin((y * pi) / 30)) * 2) / 3;
  dlon += ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3;
  dlon += ((20 * Math.sin(x * pi) + 40 * Math.sin((x / 3) * pi)) * 2) / 3;
  dlon +=
    ((150 * Math.sin((x / 12) * pi) + 300 * Math.sin((x / 30) * pi)) * 2) / 3;
  const rad = (lat / 180) * pi,
    magic = 1 - 0.006693421622965943 * Math.sin(rad) ** 2,
    sqrt = Math.sqrt(magic);
  return [
    (dlon * 180) / ((6378245 / sqrt) * Math.cos(rad) * pi),
    (dlat * 180) /
      (((6378245 * (1 - 0.006693421622965943)) / (magic * sqrt)) * pi),
  ];
}
function wgs(lon, lat) {
  let x = lon,
    y = lat;
  for (let i = 0; i < 4; i++) {
    const [dx, dy] = offset(x, y);
    x = lon - dx;
    y = lat - dy;
  }
  return [x, y];
}
const points = [],
  review = [];
const used = new Set();
const cachePath = path.join(root, 'work/amap-query-cache.json');
let cache = [];
try {
  cache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const sorted = [...catalog.scenicAreas].sort(
  (a, b) => b.grade.localeCompare(a.grade) || a.id.localeCompare(b.id),
);
for (const area of sorted) {
  const query = (aliases[area.id] ?? [area.name.replace('景区名称', '')])[0];
  const url = new URL('https://restapi.amap.com/v3/place/text');
  url.search = new URLSearchParams({
    key,
    keywords: query,
    city: area.city,
    citylimit: 'true',
    offset: '20',
    page: '1',
    extensions: 'base',
  }).toString();
  let data;
  const cached = cache.find((r) => r.scenicId === area.id);
  if (cached)
    data = {
      status: '1',
      pois: cached.candidates.map((p) => ({
        ...p,
        cityname: p.city,
        adname: p.district,
      })),
    };
  else {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error('官方接口请求失败');
      data = await response.json();
    } catch {
      throw Error('高德连接失败，本次未覆盖已有点位；请检查网络后重试。');
    }
    if (data.status !== '1')
      throw Error(
        `高德未返回成功（${String(data.infocode).replace(/[^0-9]/g, '')}），未覆盖已有点位。请检查 Key、IP 白名单和额度。`,
      );
    cache.push({
      scenicId: area.id,
      candidates: (data.pois ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        city: p.cityname,
        district: p.adname,
        location: p.location,
      })),
    });
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(cache, null, 2));
    await new Promise((r) => setTimeout(r, 350));
  }
  const acceptedNames = [area.name, ...(aliases[area.id] ?? [])].map((s) =>
    clean(s, area),
  );
  const candidates = (data.pois ?? []).filter(
    (p) =>
      typeof p.location === 'string' &&
      p.cityname === area.city &&
      (area.district === '市辖区' ||
        !area.district ||
        p.adname === area.district) &&
      (selectedPois[area.id]
        ? p.id === selectedPois[area.id].id &&
          p.name === selectedPois[area.id].name
        : acceptedNames.includes(clean(p.name, area))),
  );
  const unique = [...new Map(candidates.map((p) => [p.id, p])).values()];
  if (unique.length === 1 && !used.has(unique[0].id)) {
    const p = unique[0],
      original = p.location.split(',').map(Number);
    if (original.length !== 2 || !original.every(Number.isFinite))
      throw Error('高德位置格式无效');
    const [longitude, latitude] = wgs(...original);
    if (longitude < 118 || longitude > 123 || latitude < 27 || latitude > 32)
      throw Error('点位超出浙江地理范围');
    used.add(p.id);
    points.push({
      scenicId: area.id,
      label: area.name
        .replace(/^浙江省/, '')
        .replace(area.city, '')
        .replace(area.district === '市辖区' ? '市辖区' : area.district, '')
        .replace(
          /(风景名胜区|文化旅游区|风景旅游区|旅游景区|风景区|旅游区|景区)$/,
          '',
        ),
      longitude,
      latitude,
      coordinateSystem: 'WGS84',
      originalCoordinates: original,
      originalCoordinateSystem: 'GCJ02',
      sourceUrl: `https://www.amap.com/detail/${p.id}`,
      poiId: p.id,
      sourceName: p.name,
      note: '高德 POI，名称与市、区县核对；坐标由 GCJ-02 近似转换。联合景区为代表点，非导航入口；开放状态请以景区公告为准。',
    });
  } else
    review.push({
      scenicId: area.id,
      name: area.name,
      status: unique.length ? 'ambiguous' : 'no-exact-match',
      candidates: (data.pois ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        city: p.cityname,
        district: p.adname,
        adcode: p.adcode,
        location: p.location,
      })),
    });
  console.log(
    `${points.length + review.length}/${sorted.length}：已核对 ${points.length}，待复核 ${review.length}`,
  );
}
await fs.mkdir(path.join(root, 'work'), { recursive: true });
await fs.writeFile(
  path.join(root, 'work/amap-review.json'),
  JSON.stringify(review, null, 2),
);
const output = {
  provinceCode: 330000,
  provider: 'amap',
  status: 'ready',
  reviewedAt: new Date().toISOString(),
  coordinateSystem: 'WGS84',
  totalCatalog: sorted.length,
  matched: points.length,
  pendingReview: review.length,
  points,
};
const target = path.join(root, 'public/data/scenic-points.json'),
  temp = target + '.tmp';
await fs.writeFile(temp, JSON.stringify(output, null, 2));
await fs.rename(temp, target);
console.log(
  `完成：${points.length} 个官方 POI 点位；${review.length} 个待人工消歧，未自动发布。`,
);
