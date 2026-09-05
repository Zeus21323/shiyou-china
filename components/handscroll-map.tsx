'use client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Edges, OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Province } from './china-map';
import type { ScenicArea, Catalog } from '../lib/content';
import { selectScenicAreas } from '../lib/scenic-selection';
import {
  clusterAnchors,
  placeLabels,
  type MapAnchor,
  type PlacedLabel,
} from '../lib/map-layout';
export type { Province } from './china-map';
type PointRecord = {
  scenicId: string;
  label: string;
  longitude: number;
  latitude: number;
  sourceUrl: string;
  note: string;
};
type ScreenState = {
  labels: PlacedLabel[];
  hidden: MapAnchor[];
  groups: ReturnType<typeof clusterAnchors>;
  zoom: number;
  width: number;
  height: number;
};
const project = ([lon, lat]: number[]) =>
  [(lon - 104) * 0.75, (lat - 35) * 0.95] as [number, number];
const cameraSettings = {
  position: [0, -15, 42] as [number, number, number],
  zoom: 12,
  up: [0, 0, 1] as [number, number, number],
  near: 0.01,
  far: 1000,
};
const polygons = (f: Province) =>
  (f.geometry.type === 'Polygon'
    ? [f.geometry.coordinates]
    : f.geometry.coordinates) as number[][][][];
function ProvinceShape({
  feature,
  active,
  onSelect,
}: {
  feature: Province;
  active: boolean;
  onSelect: () => void;
}) {
  const [hover, setHover] = useState(false);
  const geometry = useMemo(
    () =>
      new THREE.ExtrudeGeometry(
        polygons(feature)
          .filter((p) => p[0]?.length >= 3)
          .map((p) => {
            const shape = new THREE.Shape(
              p[0].map((x) => new THREE.Vector2(...project(x))),
            );
            p.slice(1).forEach((r) =>
              shape.holes.push(
                new THREE.Path(r.map((x) => new THREE.Vector2(...project(x)))),
              ),
            );
            return shape;
          }),
        { depth: 0.12, bevelEnabled: false },
      ),
    [feature],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
      }}
      onPointerOut={() => setHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (feature.properties.name) onSelect();
      }}
    >
      <meshStandardMaterial
        color={active ? '#b9c6a0' : hover ? '#a8bba1' : '#c4c7a4'}
        roughness={1}
        metalness={0}
      />
      <Edges color={active ? '#866739' : '#92987a'} threshold={40} />
    </mesh>
  );
}
function inRing(x: number, y: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > y !== b[1] > y &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function ArtisticRelief({
  provinces,
  selected,
}: {
  provinces: Province[];
  selected: Province | null;
}) {
  const geometry = useMemo(() => {
    const shapes = (selected ? [selected] : provinces)
      .flatMap(polygons)
      .map((p) => ({
        p,
        minX: Math.min(...p[0].map((v) => v[0])),
        maxX: Math.max(...p[0].map((v) => v[0])),
        minY: Math.min(...p[0].map((v) => v[1])),
        maxY: Math.max(...p[0].map((v) => v[1])),
      }));
    const positions: number[] = [],
      colors: number[] = [];
    const hash = (x: number, y: number) => {
      const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return n - Math.floor(n);
    };
    const noise = (x: number, y: number) => {
      const ix = Math.floor(x),
        iy = Math.floor(y),
        fx = x - ix,
        fy = y - iy,
        u = fx * fx * (3 - 2 * fx),
        v = fy * fy * (3 - 2 * fy);
      return (
        (hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u) * (1 - v) +
        (hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u) * v
      );
    };
    const height = (x: number, y: number) => {
      const frequency = selected ? 8 : 1.8;
      const ridges = Math.pow(
        1 - Math.abs(noise(x * frequency, y * frequency) * 2 - 1),
        4,
      );
      const detail = noise(x * frequency * 4, y * frequency * 4) * 0.2;
      return 0.14 + (ridges + detail) * (selected ? 0.075 : x < 105 ? 1 : 0.45);
    };
    const vertex = (x: number, y: number) => {
      const z = height(x, y),
        p = project([x, y]);
      positions.push(...p, z);
      const c = new THREE.Color('#ccc9a4').lerp(
        new THREE.Color('#356d68'),
        Math.min(1, (z - 0.14) * (selected ? 11 : 1.9)),
      );
      colors.push(c.r, c.g, c.b);
    };
    const step = selected ? 0.025 : 0.26;
    for (
      let x = Math.min(...shapes.map((s) => s.minX));
      x < Math.max(...shapes.map((s) => s.maxX));
      x += step
    )
      for (
        let y = Math.min(...shapes.map((s) => s.minY));
        y < Math.max(...shapes.map((s) => s.maxY));
        y += step
      ) {
        const cx = x + step / 2,
          cy = y + step / 2;
        const valid = shapes.some(
          (s) =>
            cx >= s.minX &&
            cx <= s.maxX &&
            cy >= s.minY &&
            cy <= s.maxY &&
            inRing(cx, cy, s.p[0]) &&
            !s.p.slice(1).some((r) => inRing(cx, cy, r)),
        );
        if (!valid) continue;
        vertex(x, y);
        vertex(x + step, y);
        vertex(x, y + step);
        vertex(x + step, y);
        vertex(x + step, y + step);
        vertex(x, y + step);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const smooth = mergeVertices(g);
    smooth.computeVertexNormals();
    g.dispose();
    return smooth;
  }, [provinces, selected]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} raycast={() => null}>
      <meshStandardMaterial
        vertexColors
        roughness={1}
        transparent
        opacity={0.8}
      />
    </mesh>
  );
}
function CameraAndLabels({
  provinces,
  selected,
  points,
  areas,
  command,
  onScreen,
}: {
  provinces: Province[];
  selected: Province | null;
  points: PointRecord[];
  areas: ScenicArea[];
  command: { id: number; factor: number };
  onScreen: (s: ScreenState) => void;
}) {
  const { camera, size } = useThree();
  const initialZoom = useRef(1),
    elapsed = useRef(0);
  const cam = camera as THREE.OrthographicCamera;
  const bounds = useMemo(() => {
    const b = new THREE.Box2();
    (selected ? [selected] : provinces)
      .flatMap(polygons)
      .flat(2)
      .forEach((p) => b.expandByPoint(new THREE.Vector2(...project(p))));
    return b;
  }, [selected, provinces]);
  const center = useMemo(
    () =>
      bounds.isEmpty()
        ? new THREE.Vector2()
        : bounds.getCenter(new THREE.Vector2()),
    [bounds],
  );
  useEffect(() => {
    if (bounds.isEmpty()) return;
    const span = bounds.getSize(new THREE.Vector2());
    initialZoom.current =
      Math.min(
        size.width / Math.max(span.x, 1),
        Math.max(220, size.height - 180) / Math.max(span.y, 1),
      ) * 0.79;
    cam.zoom = initialZoom.current;
    cam.up.set(0, 0, 1);
    cam.position.set(center.x, center.y - 15, 42);
    cam.lookAt(center.x, center.y, 0);
    cam.updateProjectionMatrix();
  }, [bounds, cam, center, size.width, size.height]);
  useEffect(() => {
    if (command.id) {
      cam.zoom = Math.max(
        initialZoom.current * 0.7,
        Math.min(initialZoom.current * 18, cam.zoom * command.factor),
      );
      cam.updateProjectionMatrix();
    }
  }, [command, cam]);
  useFrame((_, dt) => {
    elapsed.current += dt;
    if (elapsed.current < 0.1) return;
    elapsed.current = 0;
    const zoom = cam.zoom / initialZoom.current;
    const anchors: MapAnchor[] = [];
    const add = (
      id: string,
      name: string,
      point: number[],
      priority: number,
      kind: 'province' | 'scenic',
    ) => {
      const p = new THREE.Vector3(...project(point), 0.65).project(cam);
      const x = ((p.x + 1) * size.width) / 2,
        y = ((1 - p.y) * size.height) / 2;
      if (
        p.z < -1 ||
        p.z > 1 ||
        x < 8 ||
        x > size.width - 8 ||
        y < 90 ||
        y > size.height - 96
      )
        return;
      anchors.push({ id, name, x, y, priority, kind });
    };
    if (!selected) {
      provinces
        .filter((p) => p.properties.name && p.properties.center)
        .forEach((p) =>
          add(
            String(p.properties.adcode),
            p.properties.name.replace(
              /特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|省|市/g,
              '',
            ),
            p.properties.center!,
            1,
            'province',
          ),
        );
    } else if (selected.properties.adcode === 330000) {
      points.forEach((p) => {
        const a = areas.find((a) => a.id === p.scenicId);
        if (!a || (a.grade === '4A' && zoom < 1.65)) return;
        add(
          p.scenicId,
          p.label,
          [p.longitude, p.latitude],
          a.grade === '5A' ? 10 : 1,
          'scenic',
        );
      });
    }
    const groups = selected
      ? clusterAnchors(anchors, 28)
      : anchors.map((a) => ({ anchor: a, members: [a] }));
    const budget = selected
      ? Math.min(80, Math.max(5, Math.floor(8 * zoom * zoom)))
      : 100;
    const eligible = groups.slice(0, budget).map((g) => g.anchor);
    const result = placeLabels(eligible, size.width, size.height, !selected);
    onScreen({
      ...result,
      hidden: [...result.hidden, ...groups.slice(budget).map((g) => g.anchor)],
      groups,
      zoom,
      width: size.width,
      height: size.height,
    });
  });
  return (
    <OrbitControls
      target={[center.x, center.y, 0]}
      enableDamping
      minZoom={0.5}
      maxZoom={1400}
      minPolarAngle={0.15}
      maxPolarAngle={1.05}
      enableRotate={false}
      zoomSpeed={0.75}
    />
  );
}
export default function HandscrollMap({
  provinces,
  selected,
  onSelect,
  onScenic,
}: {
  provinces: Province[];
  selected: Province | null;
  onSelect: (p: Province) => void;
  onScenic: (s: ScenicArea) => void;
}) {
  const [points, setPoints] = useState<PointRecord[]>([]),
    [areas, setAreas] = useState<ScenicArea[]>([]),
    [dataError, setDataError] = useState(false);
  const [screen, setScreen] = useState<ScreenState>({
    labels: [],
    hidden: [],
    groups: [],
    zoom: 1,
    width: 1,
    height: 1,
  });
  const [command, setCommand] = useState({ id: 0, factor: 1 }),
    [expanded, setExpanded] = useState<string[] | null>(null);
  useEffect(() => {
    const c = new AbortController();
    Promise.all([
      fetch('/data/scenic-points.json', { signal: c.signal }).then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      }),
      fetch('/data/zhejiang-catalog.json', { signal: c.signal }).then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      }),
    ])
      .then(([p, a]) => {
        const selectedAreas = selectScenicAreas((a as Catalog).scenicAreas);
        const selectedIds = new Set(selectedAreas.map((area) => area.id));
        setPoints(
          (p as { points: PointRecord[] }).points.filter((point) =>
            selectedIds.has(point.scenicId),
          ),
        );
        setAreas(selectedAreas);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setDataError(true);
      });
    return () => c.abort();
  }, []);
  const act = (id: string) => {
    if (!selected) {
      const p = provinces.find((p) => String(p.properties.adcode) === id);
      if (p) onSelect(p);
      return;
    }
    const group = screen.groups.find((g) => g.anchor.id === id);
    if (group && group.members.length > 1) {
      setExpanded(group.members.map((m) => m.id));
      return;
    }
    const area = areas.find((a) => a.id === id);
    if (area) onScenic(area);
  };
  const zoom = (factor: number) => {
    setExpanded(null);
    setCommand((c) => ({ id: c.id + 1, factor }));
  };
  return (
    <div className="handscroll-map">
      <Canvas
        orthographic
        camera={cameraSettings}
        dpr={[1, 1.5]}
        gl={{ alpha: true }}
        fallback={<p>三维地图不可用，请从省份及景区列表继续。</p>}
      >
        <ambientLight intensity={1.1} />
        <directionalLight position={[-15, -10, 30]} intensity={1.2} />
        {provinces.map((p) => (
          <ProvinceShape
            key={p.properties.adcode}
            feature={p}
            active={selected?.properties.adcode === p.properties.adcode}
            onSelect={() => onSelect(p)}
          />
        ))}
        <ArtisticRelief provinces={provinces} selected={selected} />
        <CameraAndLabels
          provinces={provinces}
          selected={selected}
          points={points}
          areas={areas}
          command={command}
          onScreen={setScreen}
        />
      </Canvas>
      <div
        className="map-signs"
        aria-label={selected ? '景区地图标签' : '省份地图标签'}
      >
        <svg
          className="map-leaders"
          width="100%"
          height="100%"
          aria-hidden="true"
        >
          {screen.labels.map((l) => (
            <g key={l.id}>
              <line
                x1={l.x}
                y1={l.y}
                x2={l.left + l.width / 2}
                y2={l.top + l.height}
                stroke="#937345"
                strokeWidth=".8"
                opacity=".6"
              />
              <circle
                cx={l.x}
                cy={l.y}
                r={l.kind === 'province' ? 2 : 4}
                fill="#b78a37"
                stroke="#fff5d1"
                strokeWidth="2"
              />
            </g>
          ))}
        </svg>
        {screen.labels.map((l) => {
          const count =
            screen.groups.find((g) => g.anchor.id === l.id)?.members.length ??
            1;
          return (
            <button
              key={l.id}
              className={'map-sign ' + l.kind}
              style={{
                left: l.left,
                top: l.top,
                width: l.width,
                height: l.height,
              }}
              data-map-id={l.id}
              aria-label={
                l.name + (count > 1 ? `及附近${count - 1}个景点` : '')
              }
              onClick={() => act(l.id)}
            >
              <div className="sign-solid">
                <div className="sign-side sign-left" aria-hidden="true" />
                <div className="sign-side sign-right" aria-hidden="true" />
                <div className="sign-side sign-top" aria-hidden="true" />
                <div className="sign-side sign-bottom" aria-hidden="true" />
                <div className="sign-back" aria-hidden="true" />
                <div className="sign-front">
                  <span title={l.name}>
                    {l.kind === 'scenic' && l.name.length > 6
                      ? l.name.slice(0, 5) + '…'
                      : l.name}
                  </span>
                  {l.kind === 'scenic' && (
                    <small>
                      {count > 1
                        ? `+${count - 1}`
                        : areas.find((a) => a.id === l.id)?.grade}
                    </small>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="map-zoom">
        <button aria-label="放大地图" onClick={() => zoom(1.5)}>
          ＋
        </button>
        <span>{screen.zoom.toFixed(1)}×</span>
        <button aria-label="缩小地图" onClick={() => zoom(1 / 1.5)}>
          −
        </button>
      </div>
      {selected?.properties.adcode === 330000 && (
        <div className="map-density">
          <span>5A 优先 · 已显示 {screen.labels.length} 处</span>
          <small>
            {dataError
              ? '点位加载失败，请使用景区列表'
              : points.length
                ? `高德点位 ${points.length}/${areas.length} · 其余可从名录查看`
                : '官方景点位置正在接入，可先用名录探索'}
          </small>
          {screen.hidden.length > 0 && (
            <button
              onClick={() =>
                setExpanded(
                  screen.groups.flatMap((g) => g.members.map((m) => m.id)),
                )
              }
            >
              此视野景区列表（
              {screen.groups.reduce((n, g) => n + g.members.length, 0)}）
            </button>
          )}
        </div>
      )}
      {expanded && (
        <div className="map-cluster" role="dialog" aria-label="附近景区">
          <button className="cluster-close" onClick={() => setExpanded(null)}>
            关闭 ×
          </button>
          <h3>此处山水</h3>
          <p>点位较近，以列表展开</p>
          {expanded.map((id) => {
            const a = areas.find((a) => a.id === id);
            return (
              a && (
                <button key={id} onClick={() => onScenic(a)}>
                  <b>{a.grade}</b> {a.name}
                </button>
              )
            );
          })}
        </div>
      )}
    </div>
  );
}
