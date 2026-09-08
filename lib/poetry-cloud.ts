import type { Work } from './content';

export type CloudWork = Pick<
  Work,
  'id' | 'author' | 'dynasty' | 'verification'
>;
const TAU = Math.PI * 2;
function hash(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  // Avalanche the suffix bits so x/y/z samples do not form artificial straight rows.
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}
const unit = (text: string) => hash(text) / 4294967296;

/** 同一作者的作品聚在四条旋臂附近；坐标只由元数据决定，与分页/筛选顺序无关。 */
export function cloudPosition(work: CloudWork): [number, number, number] {
  const author = `${work.dynasty}:${work.author}`;
  const radius = 0.65 + Math.pow(unit(author + ':radius'), 1.05) * 24;
  const angle =
    ((hash(author) % 4) * TAU) / 4 +
    radius * 0.19 +
    (unit(author + ':angle') - 0.5) * 0.5;
  const spread = 0.65 + radius * 0.065;
  return [
    Math.cos(angle) * radius + (unit(work.id + ':x') - 0.5) * spread * 2,
    (unit(author + ':height') - 0.5) * (4.8 - radius * 0.09) +
      (unit(work.id + ':y') - 0.5) * 1.8,
    Math.sin(angle) * radius + (unit(work.id + ':z') - 0.5) * spread * 2,
  ];
}

export function buildCloud(works: readonly CloudWork[]) {
  const positions = new Float32Array(works.length * 3);
  const colors = new Float32Array(works.length * 3);
  const sizes = new Float32Array(works.length);
  const ids = new Map<string, number>();
  works.forEach((work, i) => {
    if (ids.has(work.id)) throw Error('星云作品ID重复：' + work.id);
    ids.set(work.id, i);
    positions.set(cloudPosition(work), i * 3);
    const gold = work.verification === 'verified' || unit(work.dynasty) > 0.62;
    colors.set(gold ? [1, 0.78, 0.43] : [0.5, 0.86, 0.88], i * 3);
    sizes[i] = 0.88 + unit(work.id + ':size') * 0.24;
  });
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    min[axis] = Math.min(min[axis], positions[i]);
    max[axis] = Math.max(max[axis], positions[i]);
  }
  const center = works.length
    ? min.map((v, axis) => (v + max[axis]) / 2)
    : [0, 0, 0];
  let radius = 0;
  for (let i = 0; i < positions.length; i += 3)
    radius = Math.max(
      radius,
      Math.hypot(
        positions[i] - center[0],
        positions[i + 1] - center[1],
        positions[i + 2] - center[2],
      ),
    );
  return {
    positions,
    colors,
    sizes,
    ids,
    center,
    radius,
    diameter: cloudStarDiameter(works.length),
  };
}

/** Overview diameter in CSS pixels: fewer poems get larger readable stars. */
export function cloudStarDiameter(count: number) {
  return Math.max(
    7,
    Math.min(46, 28 * Math.pow(400 / Math.max(1, count), 0.28)),
  );
}

/** Reveal a few labels smoothly after zooming in; overview remains text-free. */
export function cloudLabelOpacity(zoom: number, index: number) {
  const start = 1.25 + Math.max(0, index - 2) * 0.2;
  const t = Math.max(0, Math.min(1, (zoom - start) / 0.35));
  return t * t * (3 - 2 * t);
}

/** 屏幕像素拾取，忽略背面/视野外/筛选外的星；重叠时优先最近的可见点。 */
export function pickCloudStar(
  projected: Float32Array,
  matches: Float32Array,
  x: number,
  y: number,
  radius: number | Float32Array = 12,
) {
  let result = -1,
    best = Infinity;
  for (let i = 0; i < matches.length; i++) {
    if (!matches[i]) continue;
    const z = projected[i * 3 + 2];
    if (z < -1 || z > 1) continue;
    const dx = projected[i * 3] - x,
      dy = projected[i * 3 + 1] - y;
    const distance = dx * dx + dy * dy;
    const hitRadius = typeof radius === 'number' ? radius : radius[i];
    if (distance > hitRadius * hitRadius) continue;
    const score = distance + z * 0.01;
    if (score < best) {
      best = score;
      result = i;
    }
  }
  return result;
}

export function isCloudClick(
  start: { x: number; y: number },
  end: { x: number; y: number },
  maxTravel = 6,
) {
  return Math.hypot(start.x - end.x, start.y - end.y) <= maxTravel;
}

/** Normalize pixel/line/page wheels; accumulate against the pending target. */
export function cloudWheelDistance(
  distance: number,
  delta: number,
  mode = 0,
  height = 800,
) {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? height : 1);
  return Math.max(
    2,
    Math.min(
      220,
      distance * Math.exp(Math.max(-400, Math.min(400, pixels)) * 0.0017),
    ),
  );
}

/** Log-distance easing gives the same proportional response near and far. */
export function smoothCloudDistance(
  current: number,
  target: number,
  dt: number,
  reduced = false,
) {
  if (reduced) return target;
  const blend = 1 - Math.exp(-Math.max(0, Math.min(dt, 0.05)) * 12);
  return Math.exp(Math.log(current) + Math.log(target / current) * blend);
}
