'use client';
import { useMemo, useState } from 'react';
import type { PoetryAttraction } from '../lib/poetry-db';
export default function NationalScenicList({
  areas,
  province,
  onSelect,
}: {
  areas: PoetryAttraction[];
  province: string;
  onSelect: (a: PoetryAttraction) => void;
}) {
  const [grade, setGrade] = useState('全部'),
    [query, setQuery] = useState(''),
    [onlyLocated, setOnlyLocated] = useState(false),
    [page, setPage] = useState(0);
  const results = useMemo(
    () =>
      areas
        .filter(
          (a) =>
            (grade === '全部' || a.grade === grade) &&
            (!onlyLocated || a.point) &&
            `${a.name}${a.city}`.includes(query.trim()),
        )
        .sort(
          (a, b) =>
            b.grade.localeCompare(a.grade) ||
            b.directCount - a.directCount ||
            a.name.localeCompare(b.name),
        ),
    [areas, grade, query, onlyLocated],
  );
  const size = 30,
    pages = Math.max(1, Math.ceil(results.length / size)),
    current = Math.min(page, pages - 1);
  return (
    <div className="scenic-list">
      <div className="catalog-meta">
        <b>{areas.length} 处诗词景点</b>
        <p>
          4A / 5A 筛选名录 · {areas.filter((a) => a.point).length}{' '}
          处有官方地图点位
        </p>
        <p>收录来自指定数据库，等级与保留范围以各景点来源为准。</p>
      </div>
      <div className="grade-tabs" aria-label="景区等级">
        {['全部', '5A', '4A'].map((g) => (
          <button
            key={g}
            aria-pressed={g === grade}
            onClick={() => {
              setGrade(g);
              setPage(0);
            }}
          >
            {g}
          </button>
        ))}
      </div>
      <button
        aria-pressed={onlyLocated}
        onClick={() => {
          setOnlyLocated(!onlyLocated);
          setPage(0);
        }}
      >
        只看已定位景点
      </button>
      <label className="field-label" htmlFor="scenic-query">
        搜索{province}景点
      </label>
      <input
        id="scenic-query"
        type="search"
        value={query}
        placeholder="景点名称或城市…"
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(0);
        }}
      />
      <p className="result-count" aria-live="polite">
        {results.length} 个结果 · 5A 优先
      </p>
      <div className="scenic-scroll">
        {results.slice(current * size, (current + 1) * size).map((a) => (
          <button
            className="scenic-card"
            key={a.id}
            onClick={() => onSelect(a)}
          >
            <span className="scenic-card-top">
              <span>{a.city === '—' ? province : a.city}</span>
              <b>{a.grade}</b>
            </span>
            <strong>{a.name}</strong>
            <span className="scenic-enter">
              {a.poemCount.toLocaleString()} 篇诗文 · 正式关联
            </span>
            {a.curatedCount > 0 && (
              <small>另有 {a.curatedCount} 篇已核对作品</small>
            )}
            {!a.point && <small>地点待核验 · 可直接点灯读诗</small>}
          </button>
        ))}
      </div>
      {!results.length && <p>没有符合条件的景点，请调整筛选。</p>}
      {pages > 1 && (
        <nav className="collection-pager" aria-label="景点列表翻页">
          <button disabled={current === 0} onClick={() => setPage(current - 1)}>
            上一页
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
          >
            下一页
          </button>
        </nav>
      )}
    </div>
  );
}
