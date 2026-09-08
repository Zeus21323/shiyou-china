export type LotusBody = { x: number; y: number; radius: number; phase: number };
export function clearLotusSpace(
  bodies: LotusBody[],
  selected: number,
  dt: number,
  immediate = false,
) {
  const center = bodies[selected];
  if (!center) return;
  for (let i = 0; i < bodies.length; i++) {
    if (i === selected) continue;
    const body = bodies[i],
      dx = body.x - center.x,
      dy = body.y - center.y;
    const distance = Math.hypot(dx, dy),
      clearance = 230;
    if (distance >= clearance) continue;
    const force =
      (clearance - distance) * (immediate ? 1 : 1 - Math.exp(-dt * 4));
    body.x += (distance > 0.001 ? dx / distance : Math.cos(i)) * force;
    body.y += (distance > 0.001 ? dy / distance : Math.sin(i)) * force;
  }
}
export function createLotusBodies(count: number): LotusBody[] {
  const total = Math.max(50, count);
  return Array.from({ length: total }, (_, i) => {
    const angle = i * 2.399963229728653;
    const distance = Math.sqrt(i) * 114;
    return {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      radius: 52,
      phase: angle,
    };
  });
}
// Spatial hashing keeps physical separation affordable for large collections.
export function stepLotusBodies(bodies: LotusBody[], time: number, dt: number) {
  const cells = new Map<string, number[]>();
  const cellSize = 108;
  for (const b of bodies) {
    b.x += Math.sin(time * 0.3 + b.phase) * dt * 2;
    b.y += Math.cos(time * 0.24 + b.phase) * dt * 2;
  }
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    const cx = Math.floor(a.x / cellSize),
      cy = Math.floor(a.y / cellSize);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const b = bodies[j];
          const x = a.x - b.x,
            y = a.y - b.y,
            d = Math.hypot(x, y);
          const minimum = a.radius + b.radius;
          if (d >= minimum) continue;
          const nx = d > 1e-6 ? x / d : 1,
            ny = d > 1e-6 ? y / d : 0;
          const push = (minimum - d) * 0.5;
          a.x += nx * push;
          a.y += ny * push;
          b.x -= nx * push;
          b.y -= ny * push;
        }
      }
    const key = `${Math.floor(a.x / cellSize)},${Math.floor(a.y / cellSize)}`;
    const bucket = cells.get(key) ?? [];
    bucket.push(i);
    cells.set(key, bucket);
  }
}
