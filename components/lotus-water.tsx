'use client';
import { useState } from 'react';
import type { Work } from '../lib/content';
import { useReducedMotion } from '../lib/use-motion-preference';
import LotusScene3D from './lotus-scene-3d';
type Props = {
  works: Work[];
  matchingIds: Set<string>;
  selectedId?: string;
  reading: Work | null;
  readStatus: string;
  onRead: (w: Work) => void;
  onDeselect: () => void;
  active?: boolean;
};
export default function LotusWater({
  works,
  matchingIds,
  selectedId,
  reading,
  readStatus,
  onRead,
  onDeselect,
  active = true,
}: Props) {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [reset, setReset] = useState(0);
  const [zoomCommand, setZoomCommand] = useState<{
    id: number;
    direction: number;
  }>();
  return (
    <section
      className={
        'lotus-water lotus-real-water' + (reduced ? ' lotus-still' : '')
      }
      aria-label="三维水上莲花诗灯"
    >
      <LotusScene3D
        key={reset}
        works={works}
        selectedId={selectedId}
        onRead={onRead}
        onDeselect={onDeselect}
        paused={paused}
        reduced={reduced}
        active={active}
        zoomCommand={zoomCommand}
      />
      {reading && (
        <div className="lotus-reading" key={reading.id}>
          <header className="lotus-heart">
            <h2>{reading.title}</h2>
            <p>
              {reading.dynasty} · {reading.author}
            </p>
            <small>{reading.genre}</small>
          </header>
          <div
            className="lotus-reflection"
            role="region"
            aria-label="水中诗文倒影，滚轮上下阅读"
            tabIndex={0}
          >
            {readStatus === 'loading' ? (
              <p role="status">水中诗文正在浮现…</p>
            ) : readStatus === 'error' ? (
              <>
                <p role="alert">正文未能加载</p>
                <button onClick={() => onRead(reading)}>重试</button>
              </>
            ) : (
              <div className={reading.genre === '文' ? 'lotus-prose' : ''}>
                {reading.body
                  .split(reading.genre === '文' ? /\n\n/ : /(?<=[。！？])|\n/)
                  .filter(Boolean)
                  .map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
              </div>
            )}
          </div>
          <button className="lotus-close" onClick={onDeselect}>
            合莲 · 返回水面
          </button>
        </div>
      )}
      <div className="lotus-tools">
        <button
          aria-label="放大莲灯"
          onClick={() =>
            setZoomCommand((c) => ({ id: (c?.id ?? 0) + 1, direction: 1 }))
          }
        >
          ＋
        </button>
        <button
          aria-label="缩小莲灯"
          onClick={() =>
            setZoomCommand((c) => ({ id: (c?.id ?? 0) + 1, direction: -1 }))
          }
        >
          −
        </button>
        <button onClick={() => setPaused((p) => !p)} disabled={reduced}>
          {reduced ? '已减少动态' : paused ? '继续荷塘动画' : '暂停荷塘动画'}
        </button>
        <button
          onClick={() => {
            onDeselect();
            setZoomCommand(undefined);
            setReset((r) => r + 1);
          }}
        >
          回到池心
        </button>
      </div>
      <p className="lotus-caption">
        {works.length} 盏诗灯
        {works.length < 50 ? ` · ${50 - works.length} 盏未点亮` : ''}
        <small>
          一篇一灯 · 点击靠近开莲
          {matchingIds.size < works.length
            ? ` · 目录匹配 ${matchingIds.size} 篇`
            : ''}
        </small>
      </p>
    </section>
  );
}
