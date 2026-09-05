'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChinaMap, { type Province } from '../components/handscroll-map';
import NationalScenicList from '../components/national-scenic-list';
import PoetryNebula from '../components/star-river';
import type { ScenicArea, Work } from '../lib/content';
import {
  loadPoetryAttractions,
  loadPoetryManifest,
  loadAttractionSky,
  skyWorks,
  resolvePoetryWork,
  type PoetryAttraction,
  type PoetryManifest,
} from '../lib/poetry-db';
const PAGE_SIZE = 12;
const scopeLabels = {
  all: '全部',
  related: '景点线索',
  regional: '同城诗词',
  verified: '已核对',
};
type Scope = keyof typeof scopeLabels;
const verificationLabel = (w: Work) =>
  w.verification === 'verified'
    ? '已核对'
    : w.verification === 'regional'
      ? '区域线索'
      : '候选关联';
export default function Home() {
  const [provinces, setProvinces] = useState<Province[]>([]),
    [selected, setSelected] = useState<Province | null>(null),
    [mapRevision, setMapRevision] = useState(0);
  const [catalog, setCatalog] = useState<PoetryAttraction[]>([]),
    [manifest, setManifest] = useState<PoetryManifest | null>(null),
    [catalogError, setCatalogError] = useState(''),
    [retry, setRetry] = useState(0);
  const [scenic, setScenic] = useState<PoetryAttraction | null>(null),
    [lastSky, setLastSky] = useState<Work[] | null>(null);
  const [collection, setCollection] = useState<{
      id: string;
      works: Work[];
      status: 'loading' | 'ready' | 'error';
    }>({ id: '', works: [], status: 'loading' }),
    [collectionRetry, setCollectionRetry] = useState(0);
  const [query, setQuery] = useState(''),
    [scope, setScope] = useState<Scope>('all'),
    [page, setPage] = useState(0);
  const [reading, setReading] = useState<Work | null>(null),
    [readStatus, setReadStatus] = useState<'ready' | 'loading' | 'error'>(
      'ready',
    );
  const readRequest = useRef(0);
  useEffect(() => {
    let active = true;
    setCatalogError('');
    Promise.all([
      fetch('/data/china.geojson').then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      }),
      loadPoetryAttractions(),
      loadPoetryManifest(),
    ])
      .then(([geo, areas, meta]) => {
        if (active) {
          setProvinces((geo as { features: Province[] }).features);
          setCatalog(areas);
          setManifest(meta);
        }
      })
      .catch(() => {
        if (active) setCatalogError('全国景点数据暂时无法加载，请重试。');
      });
    return () => {
      active = false;
    };
  }, [retry]);
  useEffect(() => {
    if (!scenic) return;
    let active = true;
    setCollection({ id: scenic.id, works: [], status: 'loading' });
    loadAttractionSky(scenic.id)
      .then((data) => {
        if (active)
          setCollection({
            id: scenic.id,
            works: skyWorks(data),
            status: 'ready',
          });
      })
      .catch(() => {
        if (active)
          setCollection({ id: scenic.id, works: [], status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [scenic?.id, collectionRetry]);
  const closeReading = useCallback(() => {
    readRequest.current++;
    setReading(null);
    setReadStatus('ready');
  }, []);
  const selectProvince = useCallback(
    (p: Province | null) => {
      setMapRevision((n) => n + 1);
      setSelected(p);
      setScenic(null);
      closeReading();
    },
    [closeReading],
  );
  const selectInViewport = useCallback(
    (p: Province | null) => {
      setSelected(p);
      setScenic(null);
      closeReading();
    },
    [closeReading],
  );
  const openScenic = useCallback(
    (area: ScenicArea) => {
      const s = catalog.find((a) => a.id === area.id);
      if (!s) return;
      setScenic(s);
      setQuery('');
      setScope('all');
      setPage(0);
      closeReading();
    },
    [catalog, closeReading],
  );
  const readWork = useCallback(async (w: Work) => {
    const token = ++readRequest.current;
    setReading(w);
    setReadStatus(w.body ? 'ready' : 'loading');
    try {
      const full = await resolvePoetryWork(w);
      if (token === readRequest.current) {
        setReading(full);
        setReadStatus('ready');
      }
    } catch {
      if (token === readRequest.current) setReadStatus('error');
    }
  }, []);
  const provinceAreas = useMemo(
    () => catalog.filter((a) => a.provinceCode === selected?.properties.adcode),
    [catalog, selected],
  );
  const points = useMemo(
    () => provinceAreas.flatMap((a) => (a.point ? [a.point] : [])),
    [provinceAreas],
  );
  const allWorks = useMemo(
    () => (collection.id === scenic?.id ? collection.works : []),
    [collection, scenic?.id],
  );
  const filtered = useMemo(
    () =>
      allWorks.filter(
        (w) =>
          (scope === 'all' ||
            (scope === 'related' && w.verification !== 'regional') ||
            (scope === 'regional' && w.verification === 'regional') ||
            (scope === 'verified' && w.verification === 'verified')) &&
          `${w.title}${w.author}${w.dynasty}`.includes(query.trim()),
      ),
    [allWorks, scope, query],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
    currentPage = Math.min(page, pages - 1);
  const currentWorks = useMemo(
    () =>
      filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
    [filtered, currentPage],
  );
  useEffect(() => {
    if (scenic) setLastSky(currentWorks);
  }, [currentWorks, scenic]);
  const returnToProvince = () => {
    setScenic(null);
    closeReading();
  };
  const regionName = scenic?.province ?? selected?.properties.name ?? '';
  const busy = collection.id !== scenic?.id || collection.status === 'loading';
  const changePage = (n: number) => {
    setPage(n);
    closeReading();
  };
  return (
    <main className={'atlas-app ' + (scenic ? 'reading-mode' : 'map-mode')}>
      <a className="skip-link" href="#destinations">
        跳到景区与诗文
      </a>
      <header className="masthead">
        <a className="brand" href="/">
          <i className="brand-seal" aria-hidden="true">
            山<br />水
          </i>
          诗游中国<span>一卷山河 · 千载诗心</span>
        </a>
        <div className="edition">山水之间 · 字句之中</div>
        <span className="pilot">全国 · 诗词山河</span>
      </header>
      <section className="explorer">
        <div className="map-stage">
          <div
            className={'scene-layer' + (scenic ? ' scene-hidden' : '')}
            inert={!!scenic}
          >
            <ChinaMap
              provinces={provinces}
              areas={provinceAreas}
              points={points}
              selected={selected}
              onSelect={selectProvince}
              onScenic={openScenic}
              onViewportSelect={selectInViewport}
              resetRevision={mapRevision}
              visible={!scenic}
            />
          </div>
          {lastSky !== null && (
            <div
              className={'scene-layer' + (!scenic ? ' scene-hidden' : '')}
              inert={!scenic}
            >
              <PoetryNebula
                works={scenic ? currentWorks : lastSky}
                onRead={readWork}
                active={!!scenic}
              />
            </div>
          )}
          <div
            className="map-heading"
            key={scenic?.id ?? selected?.properties.adcode ?? 'china'}
          >
            <span className="eyebrow">
              {scenic ? '山水有回声' : '山河入画 · 诗文入境'}
            </span>
            <h1 title={scenic?.name}>
              {scenic
                ? scenic.point?.label || scenic.label || scenic.name
                : (selected?.properties.name ?? '循山河，访诗文。')}
            </h1>
            <p>
              {scenic
                ? busy
                  ? '正在展开此地诗词…'
                  : collection.status === 'error'
                    ? '诗词暂时未能读取，可在右侧重试'
                    : `${filtered.length.toLocaleString()} 篇${scope === 'all' ? '诗词记录' : scopeLabels[scope]} · 点击星点阅读`
                : selected
                  ? '循着地名，寻访山水。放大地图，遇见更多景点。'
                  : '选择省份，开启你的山水诗文之旅。'}
            </p>
          </div>
          {catalogError && (
            <div className="map-error" role="alert">
              {catalogError}
              <button onClick={() => setRetry((n) => n + 1)}>重试加载</button>
            </div>
          )}
          {!catalog.length && !catalogError && (
            <p className="map-error" role="status">
              正在读取全国山水与诗词索引…
            </p>
          )}
          {scenic && !busy && filtered.length > 0 && (
            <nav className="sky-pager" aria-label="诗词星河翻页">
              <button
                disabled={currentPage === 0}
                onClick={() => changePage(currentPage - 1)}
              >
                上一片星河
              </button>
              <span>
                {currentPage + 1} / {pages}
              </span>
              <button
                disabled={currentPage === pages - 1}
                onClick={() => changePage(currentPage + 1)}
              >
                下一片星河
              </button>
            </nav>
          )}
          <div className="map-controls">
            {scenic && (
              <button onClick={returnToProvince}>← {regionName}景点</button>
            )}
            <button onClick={() => selectProvince(null)}>↖ 全国视野</button>
            <span>
              {scenic ? '拖动环视 · 滚轮缩放' : '拖动平移 · 滚轮缩放'}
            </span>
          </div>
          <p className="map-credit">
            {scenic
              ? '每颗亮星对应本页一首作品 · 名称线索与同城诗词可分别浏览'
              : '省界：DataV · 地形：Mapzen / USGS · 城市与河湖：Natural Earth（概化）'}
          </p>
        </div>
        <aside className="sidebar" id="destinations" tabIndex={-1}>
          {scenic ? (
            <>
              <button className="back-link" onClick={returnToProvince}>
                ← 返回{regionName}景点名录
              </button>
              <div className="scenic-summary">
                <span className="eyebrow">
                  {scenic.city === '—' ? scenic.province : scenic.city} /{' '}
                  {scenic.grade}
                </span>
                <h2>{reading?.title ?? '山水诗词'}</h2>
              </div>
              <section className="scenic-address" aria-label="景区详细地址">
                <strong>景点地址</strong>
                <p>
                  {scenic.point?.address ||
                    `${scenic.province}${scenic.city === '—' ? '' : scenic.city} · 详细地址待核验`}
                </p>
                {scenic.point && (
                  <a
                    href={scenic.point.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看高德地点 ↗
                  </a>
                )}
                <small>
                  {scenic.point
                    ? '官方地图登记点位；联合景区为代表点，请以景区入口公告为准。'
                    : '尚无可靠坐标，保留列表和诗词入口，不在地图中猜测落点。'}
                </small>
              </section>
              {reading ? (
                <article className="reader">
                  <div className="work-byline">
                    {reading.dynasty} · {reading.author}{' '}
                    <span>{verificationLabel(reading)}</span>
                  </div>
                  {readStatus === 'loading' ? (
                    <p role="status">正在读取诗词正文…</p>
                  ) : readStatus === 'error' ? (
                    <div role="alert">
                      <p>正文加载失败。</p>
                      <button onClick={() => readWork(reading)}>
                        重试正文
                      </button>
                    </div>
                  ) : (
                    <>
                      <div
                        className={
                          'work-body ' +
                          (reading.genre === '文' ? 'prose' : 'verse')
                        }
                      >
                        {reading.body
                          .split(
                            reading.genre === '文'
                              ? /\n\n/
                              : /(?<=[。！？])|\n/,
                          )
                          .filter(Boolean)
                          .map((line, i) => (
                            <p key={i}>{line}</p>
                          ))}
                      </div>
                      <section className="evidence">
                        <h3>{reading.relation}</h3>
                        <p>{reading.evidence}</p>
                        <a
                          href={reading.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          查阅原文来源 ↗
                        </a>
                        {reading.sourceFile && (
                          <small>
                            语料：Werneror/Poetry · {reading.sourceFile} · CSV
                            记录序号 {reading.sourceRow}（含表头） · MIT
                          </small>
                        )}
                        {reading.evidenceUrl &&
                          reading.evidenceUrl !== reading.sourceUrl && (
                            <a
                              href={reading.evidenceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              查阅地理关联依据 ↗
                            </a>
                          )}
                      </section>
                    </>
                  )}
                  <button className="all-works" onClick={closeReading}>
                    返回诗词列表
                  </button>
                </article>
              ) : (
                <>
                  <p className="relation-note">
                    景点名称与历史别名是待核验线索；同城诗词用于拓展阅读，不等同于题咏此景。
                  </p>
                  <div className="poetry-scope" aria-label="诗词关联范围">
                    {(Object.keys(scopeLabels) as Scope[]).map((s) => (
                      <button
                        key={s}
                        aria-pressed={scope === s}
                        onClick={() => {
                          setScope(s);
                          setPage(0);
                        }}
                      >
                        {scopeLabels[s]}
                      </button>
                    ))}
                  </div>
                  <label className="field-label" htmlFor="poetry-query">
                    在此景点的诗词中查找
                  </label>
                  <input
                    id="poetry-query"
                    type="search"
                    placeholder="题名、作者或朝代…"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(0);
                    }}
                  />
                  {busy ? (
                    <p role="status">正在读取诗词星河…</p>
                  ) : collection.status === 'error' ? (
                    <div role="alert">
                      <p>此景点诗词加载失败。</p>
                      <button onClick={() => setCollectionRetry((n) => n + 1)}>
                        重试诗词
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="result-count" aria-live="polite">
                        {filtered.length.toLocaleString()} 条记录 · 本页{' '}
                        {currentWorks.length} 首
                      </p>
                      <div className="work-list">
                        {currentWorks.map((w) => (
                          <button key={w.id} onClick={() => readWork(w)}>
                            <span>
                              {w.dynasty} · {verificationLabel(w)}
                            </span>
                            <strong>{w.title}</strong>
                            <small>{w.author} →</small>
                          </button>
                        ))}
                      </div>
                      {!filtered.length && (
                        <p>没有符合条件的作品，请调整关键词或关联范围。</p>
                      )}
                      {pages > 1 && (
                        <nav
                          className="collection-pager"
                          aria-label="诗词列表翻页"
                        >
                          <button
                            disabled={currentPage === 0}
                            onClick={() => changePage(currentPage - 1)}
                          >
                            上一页
                          </button>
                          <span>
                            {currentPage + 1} / {pages}
                          </span>
                          <button
                            disabled={currentPage === pages - 1}
                            onClick={() => changePage(currentPage + 1)}
                          >
                            下一页
                          </button>
                        </nav>
                      )}
                    </>
                  )}
                </>
              )}
              <div className="editor-note">
                <span>名录与保留范围</span>
                <p>
                  {scenic.note === '—'
                    ? '自然山水与历史古迹筛选名录。'
                    : scenic.note}
                </p>
                <p>
                  {scenic.sourceKind} · {scenic.gradeAsOf}
                </p>
                <a href={scenic.sourceUrl} target="_blank" rel="noreferrer">
                  查看评级来源 ↗
                </a>
              </div>
            </>
          ) : (
            <>
              <span className="eyebrow">山水行笺</span>
              <h2>{selected?.properties.name ?? '山河皆可入诗'}</h2>
              {!selected && (
                <p className="intro">
                  从一处山水出发，沿着古人的字句，读遍各地诗词。
                </p>
              )}
              <label htmlFor="province">选择省份</label>
              <select
                id="province"
                value={selected?.properties.adcode ?? ''}
                onChange={(e) =>
                  selectProvince(
                    provinces.find(
                      (p) => String(p.properties.adcode) === e.target.value,
                    ) ?? null,
                  )
                }
              >
                <option value="">全国地图</option>
                {provinces
                  .filter((p) => p.properties.name)
                  .map((p) => (
                    <option
                      key={p.properties.adcode}
                      value={p.properties.adcode}
                    >
                      {p.properties.name}
                    </option>
                  ))}
              </select>
              {!selected ? (
                <>
                  <div className="intro-stats">
                    <div>
                      <b>
                        {manifest?.linkedAttractions.toLocaleString() ?? '—'}
                      </b>
                      <span>有诗词线索的景点</span>
                    </div>
                    <div>
                      <b>{manifest?.candidatePoems.toLocaleString() ?? '—'}</b>
                      <span>候选古诗词</span>
                    </div>
                  </div>
                  <div className="province-directory" aria-label="各省诗词景点">
                    {manifest?.coverage
                      .filter((p) => p.attractions > 0)
                      .map((p) => (
                        <button
                          key={p.code}
                          onClick={() =>
                            selectProvince(
                              provinces.find(
                                (x) => x.properties.adcode === p.code,
                              ) ?? null,
                            )
                          }
                        >
                          <span>{p.name}</span>
                          <small>{p.attractions} 处</small>
                        </button>
                      ))}
                  </div>
                  <div className="editor-note">
                    <span>收录原则</span>
                    <p>
                      来自既有诗词—景点数据库，按省份展示有候选关联的山水古迹。覆盖31个大陆省级地区；港澳台当前数据库无记录，不套用大陆A级景区等级。
                    </p>
                    <p>
                      包含名称、历史别名及同城古地名线索，候选不等于已考证。原有18篇已核对作品继续保留。
                    </p>
                    <a
                      href="/data/poetry/CATALOG.md"
                      target="_blank"
                      rel="noreferrer"
                    >
                      查看名录来源与筛选范围 ↗
                    </a>
                  </div>
                </>
              ) : provinceAreas.length ? (
                <NationalScenicList
                  key={selected.properties.adcode}
                  areas={provinceAreas}
                  province={selected.properties.name}
                  onSelect={openScenic}
                />
              ) : (
                <div className="empty-state">
                  <span className="empty-icon">山</span>
                  <h3>数据库暂无该地区记录</h3>
                  <p>
                    {selected.properties.name}
                    的地形仍可浏览。此地区尚无当前数据库中的景点与诗词记录，未套用大陆A级景区等级。
                  </p>
                  <button onClick={() => selectProvince(null)}>
                    查看已有省份
                  </button>
                </div>
              )}
            </>
          )}
        </aside>
      </section>
    </main>
  );
}
