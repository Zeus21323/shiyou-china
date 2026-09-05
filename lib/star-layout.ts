export interface StarAnchor {
  id: string;
  x: number;
  y: number;
}
export interface StarLabel extends StarAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}
export function layoutStarLabels(
  anchors: StarAnchor[],
  width: number,
  height: number,
) {
  const labels: StarLabel[] = [],
    hidden: StarAnchor[] = [];
  const w = width < 500 ? 106 : 136,
    h = 64;
  for (const a of anchors) {
    let found: StarLabel | undefined;
    for (const [dx, dy] of [
      [-w / 2, -h - 12],
      [-w / 2, 12],
      [14, -h / 2],
      [-w - 14, -h / 2],
    ]) {
      const c = { ...a, left: a.x + dx, top: a.y + dy, width: w, height: h };
      if (
        c.left < 12 ||
        c.left + w > width - 12 ||
        c.top < 190 ||
        c.top + h > height - 190
      )
        continue;
      if (
        labels.some(
          (b) =>
            c.left < b.left + b.width + 8 &&
            c.left + w + 8 > b.left &&
            c.top < b.top + b.height + 8 &&
            c.top + h + 8 > b.top,
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
