// 屏幕像素布局：点位保持地理位置，标签避让；放不下的景点交给聚合入口。
export interface MapAnchor {
  id: string;
  x: number;
  y: number;
  name: string;
  priority: number;
  kind: 'province' | 'scenic';
}
export interface PlacedLabel extends MapAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}
export function labelDock(label: {
  width: number;
  height: number;
  x?: number;
  y?: number;
  left?: number;
  top?: number;
}) {
  if (
    label.x === undefined ||
    label.y === undefined ||
    label.left === undefined ||
    label.top === undefined
  )
    return { x: label.width / 2, y: label.height - 4 };
  const ax = label.x - label.left,
    ay = label.y - label.top;
  let x = Math.max(4, Math.min(label.width - 4, ax)),
    y = Math.max(4, Math.min(label.height - 4, ay));
  if (ax > 4 && ax < label.width - 4 && ay > 4 && ay < label.height - 4) {
    const sides = [
      { distance: ax - 4, x: 4, y },
      { distance: label.width - 4 - ax, x: label.width - 4, y },
      { distance: ay - 4, x, y: 4 },
      { distance: label.height - 4 - ay, x, y: label.height - 4 },
    ];
    const nearest = sides.sort((a, b) => a.distance - b.distance)[0];
    x = nearest.x;
    y = nearest.y;
  }
  return { x, y };
}
export function leaderLength(label: PlacedLabel) {
  const dock = labelDock(label);
  return Math.hypot(
    label.x - label.left - dock.x,
    label.y - label.top - dock.y,
  );
}
export function overlap(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
  gap = 6,
) {
  return (
    a.left < b.left + b.width + gap &&
    a.left + a.width + gap > b.left &&
    a.top < b.top + b.height + gap &&
    a.top + a.height + gap > b.top
  );
}
export function placeLabels(
  anchors: MapAnchor[],
  width: number,
  height: number,
  provinceMode = false,
  previous: PlacedLabel[] = [],
): { labels: PlacedLabel[]; hidden: MapAnchor[] } {
  const labels: PlacedLabel[] = [],
    hidden: MapAnchor[] = [];
  const top = 155,
    bottom = height - 180;
  for (const a of [...anchors].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  )) {
    const w = 44,
      h = provinceMode
        ? 24 + Array.from(a.name).length * 15
        : 36 + Math.min(6, Array.from(a.name).length) * 16;
    let found: PlacedLabel | undefined;
    const offsets = [
      [0, -h - 12],
      [w + 12, -h / 2],
      [-w - 12, -h / 2],
      [0, 15],
      [0, -h - 50],
      [62, -h - 18],
      [-62, -h - 18],
      [80, 15],
      [-80, 15],
    ];
    // 优先保留相对锚点的摆放位置，避免轻微缩放触发布局翻转。
    const old = previous.find((p) => p.id === a.id);
    if (old)
      offsets.unshift([old.left + old.width / 2 - old.x, old.top - old.y]);
    if (provinceMode)
      offsets.push([20, -h - 8], [-20, -h - 8], [35, -h - 8], [-35, -h - 8]);
    for (const [dx, dy] of offsets) {
      const c = {
        ...a,
        left: a.x + dx - w / 2,
        top: a.y + dy,
        width: w,
        height: h,
      };
      if (leaderLength(c) > (provinceMode ? 50 : 100)) continue;
      if (
        c.left < 10 ||
        c.left + w > width - 10 ||
        c.top < top ||
        c.top + h > bottom
      )
        continue;
      if (labels.some((b) => overlap(c, b))) continue;
      found = c;
      break;
    }
    if (found) labels.push(found);
    else hidden.push(a);
  }
  return { labels, hidden };
}
export function clusterAnchors(anchors: MapAnchor[], radius = 22) {
  const groups: { anchor: MapAnchor; members: MapAnchor[] }[] = [];
  for (const a of [...anchors].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  )) {
    const near = groups.find(
      (g) => Math.hypot(g.anchor.x - a.x, g.anchor.y - a.y) < radius,
    );
    if (near) near.members.push(a);
    else groups.push({ anchor: a, members: [a] });
  }
  return groups;
}
