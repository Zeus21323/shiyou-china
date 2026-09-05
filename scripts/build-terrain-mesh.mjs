import fs from 'node:fs';
import path from 'node:path';
import * as T from 'three';
import { elevationAt, HEIGHT_SCALE } from '../lib/terrain-height.ts';
const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'public/data/terrain');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const china = read(path.join(dir, 'china-elevation.json'));
const zhejiang = read(path.join(dir, 'zhejiang-elevation.json'));
const regions = read(path.join(dir, 'manifest.json'));
const provinces = read(path.join(root, 'public/data/china.geojson')).features;
const packed = [],
  indices = [],
  features = {};
for (const f of provinces) {
  const local = Number(f.properties.adcode) === 330000;
  const grid = local ? zhejiang : china,
    region = local ? regions.zhejiang : regions.china;
  const rings =
    f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates]
      : f.geometry.coordinates;
  const xy = (p) => new T.Vector2((p[0] - 104) * 0.75, (p[1] - 35) * 0.95);
  const source = new T.ShapeGeometry(
    rings
      .filter((p) => p[0].length >= 3)
      .map((p) => {
        const shape = new T.Shape(p[0].map(xy));
        for (const h of p.slice(1)) shape.holes.push(new T.Path(h.map(xy)));
        return shape;
      }),
  );
  const positions = [],
    triangles = [],
    lookup = new Map();
  function vertex(p) {
    const key = p.map((v) => v.toFixed(7)).join(',');
    if (lookup.has(key)) return lookup.get(key);
    const id = positions.length / 3;
    const z =
      Math.max(0, elevationAt(grid, p[0] / 0.75 + 104, p[1] / 0.95 + 35)) *
      HEIGHT_SCALE;
    positions.push(...p, z + 0.025);
    lookup.set(key, id);
    return id;
  }
  const limit = local ? 0.045 : 0.24;
  function split(a, b, c, depth = 0) {
    const d = [
      Math.hypot(a[0] - b[0], a[1] - b[1]),
      Math.hypot(b[0] - c[0], b[1] - c[1]),
      Math.hypot(c[0] - a[0], c[1] - a[1]),
    ];
    const longest = Math.max(...d);
    if (longest <= limit || depth >= 18) {
      triangles.push(vertex(a), vertex(b), vertex(c));
      return;
    }
    const v = [a, b, c],
      i = d.indexOf(longest),
      p = v[i],
      q = v[(i + 1) % 3],
      r = v[(i + 2) % 3];
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    split(p, mid, r, depth + 1);
    split(mid, q, r, depth + 1);
  }
  const pos = source.attributes.position,
    idx = source.index.array;
  for (let i = 0; i < idx.length; i += 3)
    split(
      ...[0, 1, 2].map((j) => [pos.getX(idx[i + j]), pos.getY(idx[i + j])]),
    );
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  const offset = packed.length / 8,
    start = indices.length,
    normal = geometry.attributes.normal;
  const [w, s, e, n] = region.bounds;
  for (let i = 0; i < positions.length / 3; i++) {
    const [x, y, z] = positions.slice(i * 3, i * 3 + 3);
    packed.push(
      x,
      y,
      z,
      normal.getX(i),
      normal.getY(i),
      normal.getZ(i),
      (x / 0.75 + 104 - w) / (e - w),
      (y / 0.95 + 35 - s) / (n - s),
    );
  }
  for (const i of triangles) indices.push(i + offset);
  features[String(f.properties.adcode)] = { start, count: triangles.length };
  source.dispose();
  geometry.dispose();
}
const floats = new Float32Array(packed),
  ints = new Uint32Array(indices);
fs.writeFileSync(
  path.join(dir, 'relief.bin'),
  Buffer.concat([Buffer.from(floats.buffer), Buffer.from(ints.buffer)]),
);
fs.writeFileSync(
  path.join(dir, 'relief.json'),
  JSON.stringify({
    vertexCount: packed.length / 8,
    features,
    heightScale: HEIGHT_SCALE,
    note: '实际DEM高程；统一垂直夸张，非等比例测绘模型。',
  }),
);
console.log({
  vertices: packed.length / 8,
  triangles: indices.length / 3,
  bytes: floats.byteLength + ints.byteLength,
});
