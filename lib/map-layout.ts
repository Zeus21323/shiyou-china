// 屏幕像素布局：点位保持地理位置，标签避让；放不下的景点交给聚合入口。
export interface MapAnchor {
  id: string;
  x: number;
  y: number;
  name: string;
  priority: number;
  kind: 'province' | 'scenic' | 'city' | 'capital';
  offscreen?: boolean;
  direction?: number;
}
export interface PlacedLabel extends MapAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Screen-space approach area includes the raised sign, stem and actual POI.
 * Geographic picking alone would select the province underneath the sign. */
export function scenicInteractionAt(
  point: { x: number; y: number },
  labels: readonly PlacedLabel[],
  padding = 20,
) {
  for (const l of labels) {
    if (l.kind !== 'scenic') continue;
    const nearSign =
      point.x >= l.left - padding &&
      point.x <= l.left + l.width + padding &&
      point.y >= l.top - padding &&
      point.y <= l.top + l.height + padding;
    const nearStem =
      Math.abs(point.x - l.x) <= padding &&
      point.y >= Math.min(l.y, l.top + l.height) - padding &&
      point.y <= Math.max(l.y, l.top + l.height) + padding;
    if (nearSign || nearStem) return l.id;
  }
  return null;
}
export function cityVisible(province: number, selected?: string | number) {
  return province === Number(selected);
}
export function capitalPosition(
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const px = Math.max(70, Math.min(width - 70, x));
  const py = Math.max(180, Math.min(Math.max(180, height - 210), y));
  return {
    x: px,
    y: py,
    offscreen: px !== x || py !== y,
    direction: (Math.atan2(y - py, x - px) * 180) / Math.PI,
  };
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
    const w =
        a.kind === 'province'
          ? Math.max(72, Array.from(a.name).length * 27 + 12)
          : a.kind === 'capital'
            ? 110
            : a.kind === 'city'
              ? Math.max(68, Array.from(a.name).length * 20 + 20)
              : Math.min(14, Array.from(a.name).length) * 17 + 48,
      h =
        a.kind === 'city' || a.kind === 'capital'
          ? 44
          : a.kind === 'province'
            ? 44
            : 36;
    let found: PlacedLabel | undefined;
    const offsets =
      a.kind === 'capital'
        ? [[0, -h / 2]]
        : a.kind === 'city'
          ? [
              [w / 2 + 10, -h / 2],
              [-w / 2 - 10, -h / 2],
              [0, -h - 8],
              [0, 8],
            ]
          : a.kind === 'province'
            ? [
                [0, -h / 2],
                [0, -h / 2 - 8],
                [0, -h / 2 + 8],
                [8, -h / 2],
                [-8, -h / 2],
              ]
            : [
                [0, -h - 32],
                [0, -h - 60],
                [0, -h - 88],
              ];
    // 优先保留相对锚点的摆放位置，避免轻微缩放触发布局翻转。
    const old = previous.find((p) => p.id === a.id);
    if (old && a.kind === 'scenic')
      offsets.unshift([0, Math.min(-h - 24, old.top - old.y)]);
    if (provinceMode && a.kind === 'scenic') offsets.push([0, -h - 116]);
    for (const [dx, dy] of offsets) {
      const c = {
        ...a,
        left: a.x + dx - w / 2,
        top: a.y + dy,
        width: w,
        height: h,
      };
      if (leaderLength(c) > (a.kind === 'scenic' ? 122 : 50)) continue;
      if (
        c.left < 10 ||
        c.left + w > width - 10 ||
        c.top < top ||
        c.top + h > bottom
      )
        continue;
      if (labels.some((b) => overlap(c, b))) continue;
      // 竖线也参与避让，避免穿过其他名称或其真实点位。
      const stem = (p: PlacedLabel) => ({
        left: p.x - 3,
        top: p.top + p.height,
        width: 6,
        height: Math.max(0, p.y - p.top - p.height),
      });
      if (
        labels.some(
          (b) =>
            (c.kind === 'scenic' && overlap(stem(c), b, 3)) ||
            (b.kind === 'scenic' && overlap(c, stem(b), 3)) ||
            (c.kind === 'scenic' &&
              b.kind === 'scenic' &&
              overlap(stem(c), stem(b), 3)),
        )
      )
        continue;
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
