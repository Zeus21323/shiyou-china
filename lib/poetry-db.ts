import type { ScenicArea, Work } from './content';
export type RelationType =
  | 'direct'
  | 'historical-alias'
  | 'name-stem'
  | 'regional-context';
export interface PoetryRecord {
  id: string;
  title: string;
  author: string;
  dynasty: string;
  body: string;
  source: { repository: string; file: string; row: number; license: string };
}
export interface ScenicPoint {
  scenicId: string;
  label: string;
  longitude: number;
  latitude: number;
  provinceCode: number;
  sourceUrl: string;
  address?: string;
  note: string;
  coordinateSystem: 'WGS84';
  poiId?: string;
}
export interface PoetryAttraction extends ScenicArea {
  province: string;
  provinceCode: number;
  note: string;
  catalogSource: string;
  poemCount: number;
  directCount: number;
  regionalCount: number;
  curatedCount: number;
  relationFile: string;
  sourceUrl: string;
  sourceKind: string;
  label: string;
  point?: ScenicPoint;
  legacyId?: string;
}
export interface PoetryManifest {
  candidatePoems: number;
  relations: number;
  linkedAttractions: number;
  curatedWorks: number;
  corpus: string;
  corpusLicense: string;
  coverage: {
    code: number;
    name: string;
    attractions: number;
    located: number;
    relations: number;
  }[];
}
export type SkyRow = [
  string,
  string,
  string,
  string,
  string,
  number,
  RelationType,
  'candidate' | 'candidate-low',
  'title' | 'body',
];
export interface AttractionSky {
  scenicId: string;
  rows: SkyRow[];
  curated: Work[];
}
const cache = new Map<string, Promise<unknown>>();
async function getJson<T>(url: string): Promise<T> {
  const old = cache.get(url);
  if (old) {
    cache.delete(url);
    cache.set(url, old);
    return old as Promise<T>;
  }
  const task = fetch(url)
    .then((r) => {
      if (!r.ok) throw Error('数据暂时无法读取，请重试。');
      return r.json() as Promise<T>;
    })
    .catch((e) => {
      if (cache.get(url) === task) cache.delete(url);
      throw e;
    });
  cache.set(url, task);
  while (cache.size > 16) cache.delete(cache.keys().next().value!);
  return task;
}
export const loadPoetryManifest = () =>
  getJson<PoetryManifest>('/data/poetry/manifest.json');
export const loadPoetryAttractions = () =>
  getJson<PoetryAttraction[]>('/data/poetry/attractions.index.json');
export const loadAttractionSky = (id: string) =>
  getJson<AttractionSky>(`/data/poetry/places/${id}.json`);
export const relationNames: Record<RelationType, string> = {
  direct: '景区名称线索',
  'historical-alias': '历史别名线索',
  'name-stem': '名称线索',
  'regional-context': '同城／古地名诗词',
};
export function skyWorks(sky: AttractionSky): Work[] {
  const candidate = sky.rows.map(
    ([id, title, author, dynasty, anchor, score, type, , match]) => ({
      id,
      title,
      author,
      dynasty,
      genre: '诗词' as const,
      body: '',
      sourceUrl: '',
      scenicId: sky.scenicId,
      verification:
        type === 'regional-context'
          ? ('regional' as const)
          : ('candidate' as const),
      relation: relationNames[type],
      evidence: `${match === 'title' ? '题名' : '正文'}检索命中“${anchor}”。${type === 'regional-context' ? '这是同城或古地名的区域阅读线索，不表示作品题咏该景区。' : '这是数据库候选关联，仍需结合古今地名与作品背景核验。'}`,
      score,
    }),
  );
  candidate.sort(
    (a, b) =>
      (a.verification === 'regional' ? 1 : 0) -
        (b.verification === 'regional' ? 1 : 0) ||
      b.score - a.score ||
      a.id.localeCompare(b.id),
  );
  return [
    ...sky.curated.map((w) => ({ ...w, verification: 'verified' as const })),
    ...candidate,
  ];
}
export async function resolvePoetryWork(work: Work): Promise<Work> {
  if (work.body) return work;
  const shard = work.id.slice(-2);
  if (!/^[a-f0-9]{2}$/.test(shard)) throw Error('作品索引格式不正确。');
  const records = await getJson<PoetryRecord[]>(
    `/data/poetry/poems/${shard}.json`,
  );
  const poem = records.find((p) => p.id === work.id);
  if (!poem) throw Error('没有找到这首作品的正文。');
  return {
    ...work,
    body: poem.body,
    sourceFile: poem.source.file,
    sourceRow: poem.source.row,
    sourceUrl: `https://github.com/${poem.source.repository}/blob/master/${poem.source.file.split('/').map(encodeURIComponent).join('/')}`,
  };
}
