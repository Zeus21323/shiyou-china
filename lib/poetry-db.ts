import type { ScenicArea, Work } from './content';
import { fetchSiteData } from './site-data.ts';
export type RelationType =
  | 'direct'
  | 'historical-alias'
  | 'name-stem'
  | 'regional-context'
  | 'subsite'
  | 'inscription'
  | 'event-person';
export interface PoetryRecord {
  id: string;
  title: string;
  author: string;
  dynasty: string;
  body: string;
  genre?: 'poem' | 'prose';
  source: {
    repository: string;
    file: string;
    row: number;
    license: string;
    url?: string;
  };
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
  uniqueTexts: number;
  poetryCount: number;
  proseCount: number;
  formalOnly?: boolean;
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
  'candidate' | 'candidate-low' | 'curated-confirmed',
  string,
  ('poem' | 'prose')?,
];
export interface AttractionSky {
  scenicId: string;
  rows: SkyRow[];
  curated: Work[];
  evidence?: Record<
    string,
    {
      reasoning: string;
      quote: string;
      confidence: string;
      batch: string;
      sources: {
        title: string;
        url: string;
        bibliographic_citation: string;
        locator: string;
        quote: string;
      }[];
    }
  >;
}
const cache = new Map<string, Promise<unknown>>();
async function getJson<T>(url: string): Promise<T> {
  const old = cache.get(url);
  if (old) {
    cache.delete(url);
    cache.set(url, old);
    return old as Promise<T>;
  }
  const task = fetchSiteData(url)
    .then(async (r) => {
      if (!r.ok) throw Error('数据暂时无法读取，请重试。');
      const bytes = await r.arrayBuffer();
      const magic = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
      // 静态 .gz 资产按需解压；若托管层已解码则直接读取 JSON。
      if (magic[0] === 0x1f && magic[1] === 0x8b) {
        const stream = new Blob([bytes])
          .stream()
          .pipeThrough(new DecompressionStream('gzip'));
        return new Response(stream).json() as Promise<T>;
      }
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
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
  getJson<PoetryManifest>('/data/poetry/manifest.json.gz');
export const loadPoetryAttractions = () =>
  getJson<PoetryAttraction[]>('/data/poetry/attractions.index.json.gz');
export const loadAttractionSky = (id: string) =>
  getJson<AttractionSky>(`/data/poetry/places/${id}.json.gz`);
export const relationNames: Record<RelationType, string> = {
  direct: '景区名称线索',
  'historical-alias': '历史别名线索',
  'name-stem': '名称线索',
  'regional-context': '同城／古地名诗词',
  subsite: '景区内古迹关联',
  inscription: '碑刻题咏关联',
  'event-person': '历史人物与事件关联',
};
export function skyWorks(sky: AttractionSky): Work[] {
  const candidate = sky.rows.map(
    ([
      id,
      title,
      author,
      dynasty,
      anchor,
      score,
      type,
      status,
      match,
      genre,
    ]) => ({
      id,
      title,
      author,
      dynasty,
      genre: genre === 'prose' ? ('文' as const) : ('诗词' as const),
      body: '',
      sourceUrl: '',
      scenicId: sky.scenicId,
      verification:
        status === 'curated-confirmed'
          ? ('verified' as const)
          : type === 'regional-context'
            ? ('regional' as const)
            : ('candidate' as const),
      relation: relationNames[type],
      evidence:
        status === 'curated-confirmed'
          ? [
              sky.evidence?.[id]?.reasoning,
              sky.evidence?.[id]?.quote &&
                `核验引文：${sky.evidence[id].quote}`,
            ]
              .filter(Boolean)
              .join('\n\n')
          : `${match === 'title' ? '题名' : '正文'}检索命中“${anchor}”。${type === 'regional-context' ? '这是同城或古地名的区域阅读线索，不表示作品题咏该景区。' : '这是数据库候选关联，仍需结合古今地名与作品背景核验。'}`,
      verificationNote:
        status === 'curated-confirmed'
          ? `正式关系 · 核验批次 ${sky.evidence?.[id]?.batch ?? ''}`
          : undefined,
      evidenceUrl: sky.evidence?.[id]?.sources.find((s) =>
        /^https?:\/\//.test(s.url),
      )?.url,
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
    `/data/poetry/poems/${shard}.json.gz`,
  );
  const poem = records.find((p) => p.id === work.id);
  if (!poem) throw Error('没有找到这首作品的正文。');
  return {
    ...work,
    body: poem.body,
    genre: poem.genre === 'prose' ? '文' : work.genre,
    sourceRepository: poem.source.repository,
    sourceLicense: poem.source.license,
    sourceFile: poem.source.file,
    sourceRow: poem.source.row,
    sourceUrl:
      poem.source.url ??
      `https://github.com/${poem.source.repository}/blob/master/${poem.source.file.split('/').map(encodeURIComponent).join('/')}`,
  };
}
