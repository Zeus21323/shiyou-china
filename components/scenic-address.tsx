'use client';
import { useEffect, useState } from 'react';
import type { ScenicArea } from '../lib/content';
type Address = { address: string; sourceUrl: string; note: string };
let cached: Promise<Record<string, Address>> | undefined;
export default function ScenicAddress({ scenic }: { scenic: ScenicArea }) {
  const [data, setData] = useState<Record<string, Address> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    cached ??= fetch('/data/scenic-addresses.json')
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((d) => (d as { addresses: Record<string, Address> }).addresses)
      .catch((e) => {
        cached = undefined;
        throw e;
      });
    cached
      .then((d) => {
        if (active) setData(d);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const address = data?.[scenic.id];
  return (
    <section className="scenic-address" aria-label="景区详细地址">
      <strong>景区地址</strong>
      <p>
        {address?.address ??
          (!data && !failed
            ? '正在核对地址…'
            : `浙江省${scenic.city}${scenic.district === '市辖区' ? '' : scenic.district} · 详细地址待核验`)}
      </p>
      {address ? (
        <>
          <a href={address.sourceUrl} target="_blank" rel="noreferrer">
            查看高德地点 ↗
          </a>
          <small>
            地图登记地址；联合景区显示代表点地址，请以景区公布的入口为准。
          </small>
        </>
      ) : data || failed ? (
        <small>暂未取得可靠的街道或入口地址。</small>
      ) : null}
    </section>
  );
}
