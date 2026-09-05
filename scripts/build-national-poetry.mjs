/** 从用户指定数据库生成网页索引；只重组读取方式，不制造或删改诗词关联。 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { scenicNameScore, scenicName } from '../lib/scenic-names.ts';
const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(
  process.argv[2] ?? path.join(root, '../work/poetry-db'),
);
const target = path.join(root, 'public/data/poetry');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, v) => fs.writeFileSync(p, JSON.stringify(v));
fs.mkdirSync(path.join(target, 'places'), { recursive: true });
fs.mkdirSync(path.join(target, 'poems'), { recursive: true });
const manifest = read(path.join(source, 'manifest.json'));
const attractions = read(path.join(source, 'attractions.index.json'));
const regions = read(
  path.join(root, 'public/data/china.geojson'),
).features.filter((p) => p.properties.name);
const catalogText = fs.readFileSync(
  path.join(root, '../全国5A和4A景区_按省份_筛选名录.md'),
  'utf8',
);
const sourceUrls = Object.fromEntries(
  [...catalogText.matchAll(/^\[(S\d+)\]:\s*(https?:\/\/\S+)/gm)].map((m) => [
    m[1],
    m[2],
  ]),
);
const sourceInfo = read(
  path.join(root, '../work/scenic-research/filtered.json'),
).meta;
const pointsPath = path.join(root, 'public/data/national-poetry-points.json');
const points = fs.existsSync(pointsPath) ? read(pointsPath).points : [];
const pointIndex = new Map(points.map((p) => [p.scenicId, p]));
const oldCatalog = read(
  path.join(root, 'public/data/zhejiang-catalog.json'),
).scenicAreas;
const verified = read(path.join(root, 'public/data/works.json'));
const poems = new Map();
const sourceHashes = {};
for (const file of fs
  .readdirSync(path.join(source, 'poems'))
  .filter((x) => x.endsWith('.json'))
  .sort()) {
  const bytes = fs.readFileSync(path.join(source, 'poems', file));
  sourceHashes[file] = createHash('sha256').update(bytes).digest('hex');
  for (const poem of JSON.parse(bytes)) {
    if (poems.has(poem.id)) throw Error('重复诗词ID：' + poem.id);
    poems.set(poem.id, poem);
  }
  fs.writeFileSync(path.join(target, 'poems', file), bytes);
}
const national = [];
let relationCount = 0,
  curatedCount = 0;
for (const attraction of attractions) {
  const province = regions.find(
    (p) => p.properties.name === attraction.province,
  );
  if (!province) throw Error('未知省份：' + attraction.province);
  const raw = read(path.join(source, attraction.relationFile));
  if (raw.length !== attraction.poemCount)
    throw Error('景点关联数不一致：' + attraction.id);
  const rows = raw.map(([id, anchor, score, type, status, match]) => {
    const poem = poems.get(id);
    if (!poem) throw Error('缺失正文：' + id);
    return [
      id,
      poem.title,
      poem.author,
      poem.dynasty,
      anchor,
      score,
      type,
      status,
      match,
    ];
  });
  relationCount += rows.length;
  const matches =
    attraction.province === '浙江省'
      ? oldCatalog.filter(
          (a) =>
            scenicNameScore(
              attraction.name,
              a.name,
              attraction.province,
              attraction.city,
            ) === 1,
        )
      : [];
  const legacyId = matches.length === 1 ? matches[0].id : undefined;
  const curated = verified
    .filter((w) => w.scenicId === legacyId)
    .map((w) => ({ ...w, scenicId: attraction.id, verification: 'verified' }));
  curatedCount += curated.length;
  write(path.join(target, 'places', attraction.id + '.json'), {
    scenicId: attraction.id,
    rows,
    curated,
  });
  const url = sourceUrls[attraction.catalogSource.replace(/[\[\]]/g, '')];
  if (!url) throw Error('缺失名录出处：' + attraction.id);
  const short = attraction.province.replace(
    /维吾尔自治区|壮族自治区|回族自治区|自治区|省|市/g,
    '',
  );
  const info = sourceInfo[short]?.sources?.find((s) => s.url === url);
  national.push({
    ...attraction,
    provinceCode: province.properties.adcode,
    district: '',
    gradeAsOf: info?.date ?? '见名录来源',
    sourceId: attraction.catalogSource,
    sourceUrl: url,
    sourceKind: info?.kind ?? '分省筛选汇编',
    label: scenicName(attraction.name, attraction.province, attraction.city),
    legacyId,
    point: pointIndex.get(attraction.id),
    curatedCount: curated.length,
    directCount: rows.filter((r) => r[6] !== 'regional-context').length,
    regionalCount: rows.filter((r) => r[6] === 'regional-context').length,
  });
}
if (
  poems.size !== manifest.candidatePoems ||
  relationCount !== manifest.relations ||
  national.length !== manifest.linkedAttractions
)
  throw Error('数据库规模与清单不一致');
if (curatedCount !== verified.length)
  throw Error(
    '未能保留全部既有核对作品：' + curatedCount + '/' + verified.length,
  );
const coverage = regions.map((p) => {
  const rows = national.filter((a) => a.provinceCode === p.properties.adcode);
  return {
    code: p.properties.adcode,
    name: p.properties.name,
    attractions: rows.length,
    located: rows.filter((a) => a.point).length,
    relations: rows.reduce((n, a) => n + a.poemCount, 0),
  };
});
write(path.join(target, 'attractions.index.json'), national);
write(path.join(target, 'manifest.json'), {
  ...manifest,
  webVersion: 2,
  curatedWorks: curatedCount,
  coverage,
  sourceHashes,
  relationshipNotice:
    '数据库关联均为检索候选；名称/历史别名线索与同城诗词分层展示，未自动认定为景点题咏。',
});
const license = path.join(root, '../work/corpus/Werneror-Poetry/LICENSE');
if (fs.existsSync(license))
  fs.copyFileSync(license, path.join(target, 'LICENSE.txt'));
fs.copyFileSync(
  path.join(source, 'README.md'),
  path.join(target, 'DATABASE.md'),
);
fs.copyFileSync(
  path.join(root, '../全国5A和4A景区_按省份_筛选名录.md'),
  path.join(target, 'CATALOG.md'),
);
console.log(
  JSON.stringify(
    {
      attractions: national.length,
      poems: poems.size,
      relations: relationCount,
      curated: curatedCount,
      located: national.filter((a) => a.point).length,
      coverage,
    },
    null,
    2,
  ),
);
