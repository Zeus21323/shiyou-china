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
): { labels: PlacedLabel[]; hidden: MapAnchor[] } {
  const labels: PlacedLabel[] = [],
    hidden: MapAnchor[] = [];
  const top = 155,
    bottom = height - 180;
  for (const a of [...anchors].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  )) {
    const w = provinceMode ? 28 : 34,
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
    if (provinceMode)
      for (let r = 110; r <= 360; r += 45)
        for (let n = 0; n < 12; n++)
          offsets.push([
            Math.cos((n * Math.PI) / 6) * r,
            Math.sin((n * Math.PI) / 6) * r - h / 2,
          ]);
    for (const [dx, dy] of offsets) {
      const c = {
        ...a,
        left: Math.round(a.x + dx - w / 2),
        top: Math.round(a.y + dy),
        width: w,
        height: h,
      };
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
