import type { Province } from '../components/china-map';
export function requiresCameraFit(
  last: { revision: number; width: number; height: number },
  revision: number,
  width: number,
  height: number,
  initialized: boolean,
) {
  return (
    !initialized ||
    last.revision !== revision ||
    last.width !== width ||
    last.height !== height
  );
}
export function provincePolygons(p: Province): number[][][][] {
  return (
    p.geometry.type === 'Polygon'
      ? [p.geometry.coordinates]
      : p.geometry.coordinates
  ) as number[][][][];
}
// 远海离岛仍然绘制和命中；只有初次飞入范围聚焦占绝大部分陆地的主体。
export function provinceFocusPolygons(p: Province): number[][][][] {
  const polygons = provincePolygons(p);
  const area = (ring: number[][]) =>
    Math.abs(
      ring.reduce((sum, a, i) => {
        const b = ring[(i + 1) % ring.length];
        return sum + a[0] * b[1] - b[0] * a[1];
      }, 0),
    ) / 2;
  const ranked = polygons
    .map((poly) => ({ poly, area: area(poly[0]) }))
    .sort((a, b) => b.area - a.area);
  const main = ranked[0];
  if (!main || main.area < ranked.reduce((n, p) => n + p.area, 0) * 0.85)
    return polygons;
  const span = (items: number[][][][]) => {
    const points = items.flat(2),
      xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]);
    return Math.max(
      (Math.max(...xs) - Math.min(...xs)) * 0.75,
      (Math.max(...ys) - Math.min(...ys)) * 0.95,
    );
  };
  return span(polygons) > span([main.poly]) * 2 ? [main.poly] : polygons;
}
function inRing(point: number[], ring: number[][]) {
  let inside = false;
  const [x, y] = point;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
export function containsProvince(p: Province, point: number[]) {
  return provincePolygons(p).some(
    (rings) =>
      inRing(point, rings[0]) && !rings.slice(1).some((r) => inRing(point, r)),
  );
}
export function provinceAt(
  provinces: Province[],
  point: number[],
): Province | null {
  return (
    provinces.find((p) => p.properties.name && containsProvince(p, point)) ??
    null
  );
}
export function fitProvinceZoom(
  provinces: Province[],
  width: number,
  height: number,
) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of provinces)
    for (const poly of provinces.length === 1
      ? provinceFocusPolygons(p)
      : provincePolygons(p))
      for (const r of poly)
        for (const [lon, lat] of r) {
          const x = (lon - 104) * 0.75,
            y = (lat - 35) * 0.95;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
  if (!Number.isFinite(minX)) return 1;
  return (
    Math.min(
      Math.max(220, width - 96) / Math.max(maxX - minX, 1),
      Math.max(220, height - 220) / Math.max((maxY - minY) * 0.81, 1),
    ) * 0.92
  );
}
