'use client';
import { useEffect, useState } from 'react';
import type { Catalog, ScenicArea, Work } from '../lib/content';
import { selectScenicAreas } from '../lib/scenic-selection';
export default function ScenicList({
  onSelect,
  works,
}: {
  onSelect: (s: ScenicArea) => void;
  works: Work[];
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [error, setError] = useState(false);
  const [grade, setGrade] = useState('全部'),
    [query, setQuery] = useState(''),
    [withWorks, setWithWorks] = useState(false);
  const counts = new Map<string, number>();
  for (const w of works)
    counts.set(w.scenicId, (counts.get(w.scenicId) ?? 0) + 1);
  useEffect(() => {
    const c = new AbortController();
    fetch('/data/zhejiang-catalog.json', { signal: c.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((d) =>
        setCatalog({
          ...(d as Catalog),
          scenicAreas: selectScenicAreas((d as Catalog).scenicAreas),
        }),
      )
      .catch((e) => {
        if (e.name !== 'AbortError') setError(true);
      });
    return () => c.abort();
  }, []);
  if (error) return <p role="alert">名录加载失败，请刷新重试。</p>;
  if (!catalog) return <p role="status">正在读取官方景区名录…</p>;
  const list = catalog.scenicAreas.filter(
    (s) =>
      (!withWorks || counts.has(s.id)) &&
      (grade === '全部' || grade === s.grade) &&
      `${s.name}${s.city}${s.district}`.includes(query.trim()),
  );
  return (
    <div className="scenic-list">
      <div className="catalog-meta">
        <b>{catalog.scenicAreas.length} 家 4A / 5A 景区</b>
        <p>山水古迹精选 · 已剔除现代展馆、乐园及商业设施</p>
        <p>等级截至 {catalog.asOf} · 历史快照</p>
        <a href={catalog.sourceUrl} target="_blank" rel="noreferrer">
          浙江省文旅厅官方名录 ↗
        </a>
      </div>
      <div className="grade-tabs" aria-label="景区等级">
        {['全部', '5A', '4A'].map((g) => (
          <button
            key={g}
            aria-pressed={grade === g}
            onClick={() => setGrade(g)}
          >
            {g}
          </button>
        ))}
      </div>
      <button aria-pressed={withWorks} onClick={() => setWithWorks(!withWorks)}>
        只看已收录诗文（{counts.size}）
      </button>
      <input
        type="search"
        name="scenic-search"
        autoComplete="off"
        aria-label="搜索浙江景区"
        placeholder="搜索景区或城市，如西湖…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="result-count" aria-live="polite">
        {list.length} 个结果
      </p>
      <div className="scenic-scroll">
        {list.map((s) => (
          <button
            className="scenic-card"
            key={s.id}
            onClick={() => onSelect(s)}
          >
            <span className="scenic-card-top">
              <span>
                {s.city} · {s.district}
              </span>
              <b>{s.grade}</b>
            </span>
            <strong>{s.name}</strong>
            <span className="scenic-enter">
              {counts.has(s.id) ? `${counts.get(s.id)} 篇诗文 →` : '诗文待收录'}
            </span>
          </button>
        ))}
        {!list.length && <p>没有找到符合条件的景区。</p>}
      </div>
    </div>
  );
}
