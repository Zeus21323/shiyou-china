export type ElevationGrid = {
  bounds: number[];
  width: number;
  height: number;
  heights: number[];
};
// 统一垂直夸张用于阅读地貌；不将米单位直接当作地图坐标。
export const HEIGHT_SCALE = 0.00018;
export function elevationAt(
  grid: ElevationGrid,
  lon: number,
  lat: number,
): number {
  const [w, s, e, n] = grid.bounds;
  const x = Math.max(
    0,
    Math.min(grid.width - 1, ((lon - w) / (e - w)) * (grid.width - 1)),
  );
  const y = Math.max(
    0,
    Math.min(grid.height - 1, ((n - lat) / (n - s)) * (grid.height - 1)),
  );
  const ix = Math.min(grid.width - 2, Math.floor(x)),
    iy = Math.min(grid.height - 2, Math.floor(y));
  const dx = x - ix,
    dy = y - iy,
    i = iy * grid.width + ix;
  return (
    (grid.heights[i] * (1 - dx) + grid.heights[i + 1] * dx) * (1 - dy) +
    (grid.heights[i + grid.width] * (1 - dx) +
      grid.heights[i + grid.width + 1] * dx) *
      dy
  );
}
