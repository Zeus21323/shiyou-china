/** 仅按已核验POI ID取得公开地址，不猜测街道或入口；密钥不进入输出。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { selectScenicAreas } from '../lib/scenic-selection.ts';
const root = path.resolve(import.meta.dirname, '..');
loadEnvFile(path.join(root, '.env.local'));
const key = process.env.AMAP_WEB_SERVICE_KEY;
if (!key) throw Error('缺少本地高德Web服务密钥');
const read = async (p) =>
  JSON.parse(await fs.readFile(path.join(root, p), 'utf8'));
const catalog = selectScenicAreas(
  (await read('public/data/zhejiang-catalog.json')).scenicAreas,
);
const points = (await read('public/data/scenic-points.json')).points.filter(
  (p) => catalog.some((a) => a.id === p.scenicId),
);
const file = path.join(root, 'public/data/scenic-addresses.json');
let saved = { addresses: {} };
try {
  saved = JSON.parse(await fs.readFile(file, 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
let done = 0,
  cursor = 0,
  failed = 0;
const reasons = {};
const plain = (v) => (typeof v === 'string' ? v.trim() : '');
async function worker() {
  while (cursor < points.length) {
    const p = points[cursor++];
    if (saved.addresses[p.scenicId]?.poiId === p.poiId) {
      done++;
      continue;
    }
    const url = new URL('https://restapi.amap.com/v3/place/detail');
    url.search = new URLSearchParams({
      key,
      id: p.poiId,
      extensions: 'base',
    }).toString();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (result.status !== '1')
        throw Error(String(result.infocode).replace(/[^0-9]/g, ''));
      const poi = result.pois?.find((x) => x.id === p.poiId);
      if (!poi || !plain(poi.address)) throw Error('address-unavailable');
      const parts = [poi.pname, poi.cityname, poi.adname, poi.address]
        .map(plain)
        .filter(Boolean);
      let address = '';
      for (const part of parts) if (!address.includes(part)) address += part;
      saved.addresses[p.scenicId] = {
        poiId: p.poiId,
        address,
        sourceName: poi.name,
        sourceUrl: p.sourceUrl,
        checkedAt: new Date().toISOString(),
        note: '高德POI登记地址；联合景区为代表点地址，不等同于唯一入口。',
      };
      done++;
    } catch (e) {
      failed++;
      const code = /^\d+$|^address-unavailable$/.test(e.message)
        ? e.message
        : 'connection';
      reasons[code] = (reasons[code] ?? 0) + 1;
    }
    if ((done + failed) % 20 === 0)
      console.log(`已核对 ${done}，待核验 ${failed}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
await worker();
await fs.writeFile(
  file,
  JSON.stringify(
    { ...saved, provider: 'amap', updatedAt: new Date().toISOString() },
    null,
    2,
  ),
);
console.log({
  verified: done,
  pending: catalog.length - done,
  failedQueries: failed,
  reasons,
});
