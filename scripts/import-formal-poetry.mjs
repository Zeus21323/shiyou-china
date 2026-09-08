/** Export only effective, completed, confirmed SQLite relations. Never modify the source DB. */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { scenicName } from '../lib/scenic-names.ts';

const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(
  process.argv[2] ??
    path.join(root, '../work/poetry-db/poetry-wenyan-attractions-v2.sqlite3'),
);
const target = path.join(root, 'public/data/poetry');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const db = new DatabaseSync(source, { readOnly: true });
db.exec('BEGIN');
const relations = db
  .prepare(`SELECT r.*,p.title,p.author,p.dynasty,p.genre,
  c.reasoning,c.evidence_quote,c.confidence FROM effective_relations r
  JOIN poems p ON p.id=r.poem_id
  JOIN curated_relations c ON c.poem_id=r.poem_id AND c.attraction_id=r.attraction_id
  ORDER BY r.attraction_id,r.poem_id`)
  .all();
const poems = db
  .prepare(
    'SELECT * FROM poems WHERE id IN (SELECT poem_id FROM effective_relations) ORDER BY id',
  )
  .all();
const attractions = db
  .prepare(
    'SELECT * FROM attractions WHERE id IN (SELECT attraction_id FROM effective_relations) ORDER BY id',
  )
  .all();
const sources = db
  .prepare(`SELECT cr.poem_id,cr.attraction_id,cr.evidence_role,s.title,s.publisher,s.url,s.bibliographic_citation,e.locator,e.quote
  FROM curated_relation_sources cr JOIN source_excerpts e ON e.id=cr.source_excerpt_id
  JOIN source_documents s ON s.id=e.source_id
  JOIN effective_relations r ON r.poem_id=cr.poem_id AND r.attraction_id=cr.attraction_id
  ORDER BY cr.attraction_id,cr.poem_id,e.id`)
  .all();
const count = db.prepare('SELECT count(*) n FROM effective_relations').get().n;
db.exec('COMMIT');
db.close();
const counts = {
  relations: relations.length,
  texts: poems.length,
  poems: poems.filter((p) => p.genre === 'poem').length,
  prose: poems.filter((p) => p.genre === 'prose').length,
  attractions: attractions.length,
};
const expected = {
  relations: 3100,
  texts: 3093,
  poems: 2619,
  prose: 474,
  attractions: 206,
};
if (
  JSON.stringify(counts) !== JSON.stringify(expected) ||
  count !== relations.length ||
  relations.some((r) => r.status !== 'curated-confirmed')
)
  throw Error('正式关系核验不通过：' + JSON.stringify(counts));
if (
  new Set(relations.map((r) => r.attraction_id + '/' + r.poem_id)).size !==
  relations.length
)
  throw Error('重复关系');
if (poems.some((p) => !p.body.trim() || !p.title.trim()))
  throw Error('作品正文或题名缺失');

const provinces = read(
  path.join(root, 'public/data/china.geojson'),
).features.filter((p) => p.properties.name);
const points = new Map(
  read(path.join(root, 'public/data/national-poetry-points.json')).points.map(
    (p) => [p.scenicId, p],
  ),
);
const catalogText = fs.readFileSync(
  path.join(root, '../全国5A和4A景区_按省份_筛选名录.md'),
  'utf8',
);
const urls = Object.fromEntries(
  [...catalogText.matchAll(/^\[(S\d+)\]:\s*(https?:\/\/\S+)/gm)].map((m) => [
    m[1],
    m[2],
  ]),
);
const meta = read(
  path.join(root, '../work/scenic-research/filtered.json'),
).meta;
const outputs = new Map(),
  sourceHashes = {};
const put = (name, value) =>
  outputs.set(name, Buffer.from(JSON.stringify(value)));
const grouped = new Map();
for (const r of relations) {
  if (!grouped.has(r.attraction_id)) grouped.set(r.attraction_id, []);
  grouped.get(r.attraction_id).push(r);
}
const evidenceSources = new Map();
for (const s of sources) {
  const key = s.attraction_id + '/' + s.poem_id;
  if (!evidenceSources.has(key)) evidenceSources.set(key, []);
  const { poem_id, attraction_id, ...item } = s;
  evidenceSources.get(key).push(item);
}
const buckets = new Map();
for (const p of poems) {
  let repository = 'Werneror/Poetry',
    file = p.source_file,
    upstream = file;
  if (file.startsWith('daizhige/')) {
    repository = 'garychowcmu/daizhigev20';
    upstream = file.slice(9).replace(/#\d+$/, '');
  } else if (file.startsWith('guwenguanzhi/')) {
    repository = 'niuniu-869/guwenguanzhi';
    upstream = 'data/articles/' + file.slice(13);
  }
  const ref = repository === 'Werneror/Poetry' ? 'master' : 'HEAD';
  const url = `https://github.com/${repository}/blob/${ref}/${upstream.split('/').map(encodeURIComponent).join('/')}`;
  const record = {
    id: p.id,
    title: p.title,
    author: p.author,
    dynasty: p.dynasty,
    genre: p.genre,
    body: p.body,
    source: { repository, file, row: p.source_row, license: p.license, url },
  };
  const shard = p.id.slice(-2);
  if (!/^[a-f0-9]{2}$/.test(shard)) throw Error('正文ID格式错误');
  if (!buckets.has(shard)) buckets.set(shard, []);
  buckets.get(shard).push(record);
}
for (const [shard, records] of buckets) {
  const name = shard + '.json';
  put('poems/' + name, records);
  sourceHashes[name] = createHash('sha256')
    .update(outputs.get('poems/' + name))
    .digest('hex');
}
const national = attractions.map((a) => {
  const province = provinces.find((p) => p.properties.name === a.province);
  if (!province) throw Error('未知省份 ' + a.province);
  const related = grouped.get(a.id);
  if (!related?.length) throw Error('无正式关系景区');
  const evidence = {};
  const rows = related.map((r) => {
    evidence[r.poem_id] = {
      reasoning: r.reasoning,
      quote: r.evidence_quote,
      confidence: r.confidence,
      batch: r.curation_batch,
      sources: evidenceSources.get(a.id + '/' + r.poem_id) ?? [],
    };
    return [
      r.poem_id,
      r.title,
      r.author,
      r.dynasty,
      r.anchor,
      r.score,
      r.relation_type,
      r.status,
      r.match,
      r.genre,
    ];
  });
  put('places/' + a.id + '.json', {
    scenicId: a.id,
    rows,
    curated: [],
    evidence,
  });
  const sourceUrl = urls[a.catalog_source.replace(/[\[\]]/g, '')];
  if (!sourceUrl) throw Error('缺少景区名录出处 ' + a.id);
  const short = a.province.replace(
    /维吾尔自治区|壮族自治区|回族自治区|自治区|省|市/g,
    '',
  );
  const info = meta[short]?.sources?.find((s) => s.url === sourceUrl);
  return {
    id: a.id,
    name: a.name,
    province: a.province,
    provinceCode: province.properties.adcode,
    city: a.city,
    district: '',
    grade: a.grade,
    note: a.note,
    catalogSource: a.catalog_source,
    sourceId: a.catalog_source,
    sourceUrl,
    sourceKind: info?.kind ?? '分省筛选汇编',
    gradeAsOf: info?.date ?? '见名录来源',
    label: scenicName(a.name, a.province, a.city),
    point: points.get(a.id),
    poemCount: related.length,
    directCount: related.length,
    regionalCount: 0,
    curatedCount: 0,
    relationFile: 'places/' + a.id + '.json',
    poetryCount: related.filter((r) => r.genre === 'poem').length,
    proseCount: related.filter((r) => r.genre === 'prose').length,
  };
});
const coverage = provinces.map((p) => {
  const list = national.filter((a) => a.provinceCode === p.properties.adcode);
  return {
    code: p.properties.adcode,
    name: p.properties.name,
    attractions: list.length,
    located: list.filter((a) => a.point).length,
    relations: list.reduce((n, a) => n + a.poemCount, 0),
  };
});
put('attractions.index.json', national);
put('manifest.json', {
  webVersion: 4,
  compression: 'gzip',
  sourceDatabase: path.basename(source),
  relationView: 'effective_relations',
  importedAt: new Date().toISOString(),
  candidatePoems: counts.texts,
  uniqueTexts: counts.texts,
  poetryCount: counts.poems,
  proseCount: counts.prose,
  relations: counts.relations,
  linkedAttractions: counts.attractions,
  curatedWorks: 0,
  formalOnly: true,
  corpus: 'Werneror/Poetry; garychowcmu/daizhigev20; niuniu-869/guwenguanzhi',
  corpusLicense: '逐篇保留源数据库许可字段',
  coverage,
  sourceHashes,
  relationshipNotice:
    '仅收录已完成核验批次中的正式确认关系；不附加候选、同城线索或旧版独立作品。',
});
// Validate everything before replacing generated assets; never touch SQLite.
for (const [name, bytes] of outputs) {
  const dest = path.resolve(target, name + '.gz');
  if (!dest.startsWith(target + path.sep)) throw Error('非法输出路径');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, gzipSync(bytes, { level: 9 }));
}
for (const dir of ['places', 'poems'])
  for (const name of fs.readdirSync(path.join(target, dir))) {
    if (!/^(?:sc-[a-f0-9]+|[a-f0-9]{2})\.json(?:\.gz)?$/.test(name)) continue;
    const plain = name.replace(/\.gz$/, '');
    if (!outputs.has(dir + '/' + plain) || !name.endsWith('.gz'))
      fs.unlinkSync(path.join(target, dir, name));
  }
for (const file of ['manifest.json', 'attractions.index.json'])
  if (fs.existsSync(path.join(target, file)))
    fs.unlinkSync(path.join(target, file));
fs.writeFileSync(
  path.join(target, 'DATABASE.md'),
  `# 正式诗文—景区关系\n\n来源：${path.basename(source)} 的 effective_relations 视图，仅限 curated-confirmed。\n\n正式关系 ${counts.relations} 条；去重文本 ${counts.texts} 篇（古诗 ${counts.poems} 篇、文言散文 ${counts.prose} 篇）；有正式关系景区 ${counts.attractions} 个。\n\n正文、文体、原始来源定位和许可字段按数据库保留。关系核验理由、引文、批次和证据出处随景区分片导出。无正式关系景区不进入网页索引或地图。旧版18篇独立作品不额外合并，避免绕过正式关系或重复计数。\n\n古代文本数字语料来源：Werneror/Poetry、garychowcmu/daizhigev20、niuniu-869/guwenguanzhi。\n`,
);
console.log(
  JSON.stringify(
    {
      ...counts,
      located: national.filter((a) => a.point).length,
      provinces: coverage.filter((p) => p.attractions).length,
    },
    null,
    2,
  ),
);
