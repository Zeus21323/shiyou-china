'use client';
import { useEffect, useState } from 'react';
import ChinaMap, { type Province } from '../components/handscroll-map';
import ScenicList from '../components/scenic-list';
import PoetryNebula from '../components/star-river';
import type { ScenicArea, Work, Catalog } from '../lib/content';
import { selectScenicAreas } from '../lib/scenic-selection';
export default function Home() {
  const [scenicCount, setScenicCount] = useState<number | null>(null);
  const [mapRevision, setMapRevision] = useState(0);
  const [provinces, setProvinces] = useState<Province[]>([]),
    [selected, setSelected] = useState<Province | null>(null),
    [error, setError] = useState('');
  const [scenic, setScenic] = useState<ScenicArea | null>(null),
    [works, setWorks] = useState<Work[]>([]),
    [reading, setReading] = useState<Work | null>(null),
    [workStatus, setWorkStatus] = useState<'loading' | 'ready' | 'error'>(
      'loading',
    );
  useEffect(() => {
    const c = new AbortController();
    fetch('/data/zhejiang-catalog.json', { signal: c.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((d) =>
        setScenicCount(selectScenicAreas((d as Catalog).scenicAreas).length),
      )
      .catch(() => setScenicCount(null));
    fetch('/data/china.geojson', { signal: c.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((d) => setProvinces((d as { features: Province[] }).features))
      .catch((e) => {
        if (e.name !== 'AbortError') setError('地图加载失败，请刷新重试。');
      });
    fetch('/data/works.json', { signal: c.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((d) => {
        setWorks(d as Work[]);
        setWorkStatus('ready');
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setWorkStatus('error');
      });
    return () => c.abort();
  }, []);
  const selectProvince = (p: Province | null) => {
    setMapRevision((n) => n + 1);
    setSelected(p);
    setScenic(null);
    setReading(null);
  };
  const zhejiang = () =>
    selectProvince(
      provinces.find((p) => p.properties.adcode === 330000) ?? null,
    );
  const openScenic = (s: ScenicArea) => {
    setScenic(s);
    setReading(null);
  };
  const currentWorks = scenic
    ? works.filter((w) => w.scenicId === scenic.id)
    : [];
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
        <span className="pilot">浙江 · 诗文初集</span>
      </header>
      <section className="explorer">
        <div className="map-stage">
          {scenic ? (
            <PoetryNebula works={currentWorks} onRead={setReading} />
          ) : (
            <ChinaMap
              resetRevision={mapRevision}
              provinces={provinces}
              selected={selected}
              onSelect={selectProvince}
              onScenic={openScenic}
            />
          )}
          <div
            className="map-heading"
            key={scenic?.id ?? selected?.properties.name ?? 'china'}
          >
            <span className="eyebrow">
              {scenic ? '山水有回声' : '山河入画 · 诗文入境'}
            </span>
            <h1>
              {scenic
                ? scenic.name.replace(/^浙江省/, '')
                : selected?.properties.name || '循山河，访诗文。'}
            </h1>
            <p>
              {scenic
                ? `${currentWorks.length} 篇已核对原文的作品 · 点击星点阅读`
                : selected
                  ? '循着地名，寻访山水。放大地图，遇见更多景点。'
                  : '选择省份，开启你的山水诗文之旅。'}
            </p>
          </div>
          {error && !scenic && (
            <p role="alert" className="map-error">
              {error}
            </p>
          )}
          {!provinces.length && !error && (
            <p role="status" className="map-error">
              正在载入山河地图…
            </p>
          )}
          <div className="map-controls">
            {scenic && (
              <button
                onClick={() => {
                  setScenic(null);
                  setReading(null);
                }}
              >
                ← 浙江景区
              </button>
            )}
            <button onClick={() => selectProvince(null)}>↖ 全国视野</button>
            <span>
              {scenic ? '拖动环视 · 滚轮缩放' : '拖动平移 · 滚轮缩放'}
            </span>
          </div>
          <p className="map-credit">
            {scenic
              ? '亮星对应作品 · 微尘为装饰，不计入收录数量'
              : '省界：DataV · 地形：Mapzen / USGS · 主要河湖：Natural Earth（概化）'}
          </p>
        </div>
        <aside className="sidebar" id="destinations" tabIndex={-1}>
          {scenic ? (
            <>
              <button
                className="back-link"
                onClick={() => {
                  setScenic(null);
                  setReading(null);
                }}
              >
                ← 返回浙江景区名录
              </button>
              <div className="scenic-summary">
                <span className="eyebrow">
                  {scenic.city} · {scenic.district} / {scenic.grade}
                </span>
                <h2>{reading ? reading.title : '山水诗文'}</h2>
              </div>
              {reading ? (
                <article className="reader">
                  <div className="work-byline">
                    {reading.dynasty} · {reading.author}{' '}
                    <span>{reading.genre}</span>
                  </div>
                  <div
                    className={
                      'work-body ' +
                      (reading.genre === '文' ? 'prose' : 'verse')
                    }
                  >
                    {reading.body
                      .split(reading.genre === '文' ? /\n\n/ : /(?<=[。！？])/)
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
                  <button
                    className="all-works"
                    onClick={() => setReading(null)}
                  >
                    查看全部 {currentWorks.length} 篇作品
                  </button>
                </article>
              ) : (
                <>
                  {workStatus === 'loading' ? (
                    <p role="status">正在加载作品…</p>
                  ) : workStatus === 'error' ? (
                    <p role="alert">作品暂时无法加载，请刷新重试。</p>
                  ) : currentWorks.length ? (
                    <div className="work-list">
                      {currentWorks.map((w) => (
                        <button key={w.id} onClick={() => setReading(w)}>
                          <span>
                            {w.genre} · {w.dynasty}
                          </span>
                          <strong>{w.title}</strong>
                          <small>{w.author} →</small>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <span className="empty-icon">山</span>
                      <h3>诗文尚待寻访</h3>
                      <p>
                        这个景区已列入官方等级名录，暂未收录经核对的相关作品。
                      </p>
                      <p>
                        你可以先探索西湖、兰亭、沈园、雁荡山、江心屿、五泄、江郎山、天台山、仙都或严子陵钓台。
                      </p>
                    </div>
                  )}
                  <div className="editor-note">
                    <span>关于这里</span>
                    <p>
                      等级按 2024
                      年底官方名录展示。古今景观与建筑可能有变化，作品关联范围见每篇说明。
                    </p>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <span className="eyebrow">山水行笺</span>
              <h2>{selected?.properties.name || '从浙江出发'}</h2>
              {!selected && (
                <p className="intro">
                  湖山有约，诗文为引。沿着真实的地理与文字，寻找山水留在文学中的回声。
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
                  <button
                    className="primary"
                    disabled={!provinces.length}
                    onClick={zhejiang}
                  >
                    探索浙江 →
                  </button>
                  <div className="intro-stats">
                    <div>
                      <b>{scenicCount ?? '—'}</b>
                      <span>山水古迹精选</span>
                    </div>
                    <div>
                      <b>{new Set(works.map((w) => w.scenicId)).size || '—'}</b>
                      <span>首批诗文目的地</span>
                    </div>
                  </div>
                  <div className="editor-note">
                    <span>收录原则</span>
                    <p>
                      精选自然山水与历史古迹，剔除现代展馆、主题乐园和商业设施。保留作品出处与景区关联。等级名录为截至
                      2024 年底的官方快照，非实时名单。
                    </p>
                  </div>
                </>
              ) : selected.properties.adcode === 330000 ? (
                <ScenicList works={works} onSelect={openScenic} />
              ) : (
                <div className="empty-state">
                  <span className="empty-icon">山</span>
                  <h3>这个省份的诗路尚待展开</h3>
                  <p>首期建设浙江省。你仍可在地图上查看其他省份。</p>
                  <button onClick={zhejiang}>前往浙江 →</button>
                </div>
              )}
            </>
          )}
        </aside>
      </section>
    </main>
  );
}
