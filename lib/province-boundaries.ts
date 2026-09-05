import type { Province } from '../components/china-map';

export const boundaryKey = (point: number[]) =>
  point
    .slice(0, 2)
    .map((v) => v.toFixed(6))
    .join(',');
export function provinceBoundaries(provinces: Province[]) {
  const segments = new Map<
    string,
    { a: number[]; b: number[]; owners: string[] }
  >();
  const vertices = new Map<string, Set<string>>();
  for (const province of provinces) {
    const code = String(province.properties.adcode);
    const polygons = (
      province.geometry.type === 'Polygon'
        ? [province.geometry.coordinates]
        : province.geometry.coordinates
    ) as number[][][][];
    for (const polygon of polygons)
      for (const ring of polygon)
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1],
            b = ring[i],
            ak = boundaryKey(a),
            bk = boundaryKey(b);
          const key = [ak, bk].sort().join('|');
          const segment = segments.get(key) ?? { a, b, owners: [] };
          if (!segment.owners.includes(code)) segment.owners.push(code);
          segments.set(key, segment);
          for (const key of [ak, bk]) {
            const owners = vertices.get(key) ?? new Set<string>();
            owners.add(code);
            vertices.set(key, owners);
          }
        }
  }
  return { segments: [...segments.values()], vertices };
}
export function boundaryOwner(owners: string[], focus?: string | number) {
  const selected = String(focus);
  return owners.includes(selected) ? selected : owners[0];
}
export function sharedBoundaryHeight(
  base: number,
  samples: { height: number; blend: number }[],
) {
  const weight = samples.reduce((sum, s) => sum + s.blend, 0);
  return (
    base +
    samples.reduce((sum, s) => sum + (s.height - base) * s.blend, 0) /
      Math.max(1, weight)
  );
}
