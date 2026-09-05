// 独立于海拔的整省展示抬升，不改变山区/平原之间的真实高差。
export const PROVINCE_LIFT = 0.34;
export function nextProvinceLift(
  current: number,
  active: boolean,
  dt: number,
  reduced = false,
) {
  const target = active ? PROVINCE_LIFT : 0;
  const next = reduced
    ? target
    : target + (current - target) * Math.exp(-12 * Math.min(dt, 0.05));
  return Math.abs(next - target) < 0.0001 ? target : next;
}
export function provinceWallBand(
  base: number,
  lift: number,
  neighborSurfaces: number[],
) {
  const top = base + lift;
  const bottom = neighborSurfaces.length
    ? Math.min(top, Math.max(...neighborSurfaces))
    : -0.1;
  return { top, bottom };
}
