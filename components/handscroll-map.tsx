'use client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Edges, OrbitControls, useTexture } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls as Controls } from 'three-stdlib';
import { useReducedMotion } from '../lib/use-motion-preference';
import terrain from '../public/data/terrain/manifest.json';
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
  muted,
  onSelect,
}: {
  feature: Province;
  active: boolean;
  muted: boolean;
  onSelect: () => void;
}) {
  const [hover, setHover] = useState(false);
  const region = active && Number(feature.properties.adcode) === 330000 ? terrain.zhejiang : terrain.china;
  const texture = useTexture(`/data/terrain/${region.texture}`);
  const { gl } = useThree();
  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
  }, [texture, gl]);
  const geometry = useMemo(() => {
    const geometry = new THREE.ExtrudeGeometry(
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
      { depth: 0.025, bevelEnabled: false },
    );
    geometry.computeBoundingBox();
    const [west, south, east, north] = region.bounds;
    const pos = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < pos.count; i++)
      uv.setXY(
        i,
        (pos.getX(i) / 0.75 + 104 - west) / (east - west),
        (pos.getY(i) / 0.95 + 35 - south) / (north - south),
      );
    return geometry;
  }, [feature, region]);
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
        attach="material-0"
        map={texture}
        transparent={muted}
        opacity={muted ? 0.2 : 1}
        depthWrite={!muted}
        color={active || hover ? '#ffffff' : '#e1e9df'}
        roughness={1}
        metalness={0}
      />
      <meshStandardMaterial attach="material-1" color="#7d998a" roughness={1} />
      <Edges
        color={active ? '#547d70' : '#9aa99a'}
        threshold={40}
        transparent
        opacity={muted ? 0.18 : 0.8}
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
  resetRevision,
}: {
  provinces: Province[];
  selected: Province | null;
  points: PointRecord[];
  areas: ScenicArea[];
  command: { id: number; factor: number };
  onScreen: (s: ScreenState) => void;
  resetRevision: number;
}) {
  const { camera, size } = useThree();
  const reduced = useReducedMotion();
  const controls = useRef<Controls>(null);
  const flight = useRef<{
    position: THREE.Vector3;
    target: THREE.Vector3;
    zoom: number;
  } | null>(null);
  const zoomTarget = useRef<number | null>(null);
  const initialized = useRef(false);
  const lastFrame = useRef('');
  const areaIndex = useMemo(
    () => new Map(areas.map((a) => [a.id, a])),
    [areas],
  );
  const initialZoom = useRef(1),
    elapsed = useRef(0);
  const cam = camera as THREE.OrthographicCamera;
  const bounds = useMemo(() => {
    const b = new THREE.Box2();
    (selected ? [selected] : provinces.filter((p) => p.properties.name))
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
    const destination = {
      position: new THREE.Vector3(center.x, center.y - 15, 42),
      target: new THREE.Vector3(center.x, center.y, 0),
      zoom: initialZoom.current,
    };
    zoomTarget.current = null;
    if (!initialized.current || reduced) {
      cam.position.copy(destination.position);
      cam.zoom = destination.zoom;
      cam.up.set(0, 0, 1);
      cam.lookAt(destination.target);
      controls.current?.target.copy(destination.target);
      cam.updateProjectionMatrix();
      initialized.current = true;
      flight.current = null;
    } else flight.current = destination;
  }, [bounds, cam, center, size.width, size.height, resetRevision, reduced]);
  useEffect(() => {
    if (command.id) {
      flight.current = null;
      const next = Math.max(
        initialZoom.current * 0.7,
        Math.min(
          initialZoom.current * 18,
          (zoomTarget.current ?? cam.zoom) * command.factor,
        ),
      );
      if (reduced) {
        cam.zoom = next;
        cam.updateProjectionMatrix();
      } else zoomTarget.current = next;
    }
  }, [command, cam, reduced]);
  useFrame((_, dt) => {
    const blend = 1 - Math.exp(-Math.min(dt, 0.05) * 7);
    if (flight.current && controls.current) {
      const f = flight.current;
      cam.position.lerp(f.position, blend);
      controls.current.target.lerp(f.target, blend);
      cam.zoom = THREE.MathUtils.lerp(cam.zoom, f.zoom, blend);
      cam.lookAt(controls.current.target);
      cam.updateProjectionMatrix();
      if (
        cam.position.distanceTo(f.position) < 0.002 &&
        Math.abs(cam.zoom - f.zoom) < 0.02
      )
        flight.current = null;
    } else if (zoomTarget.current !== null) {
      cam.zoom = THREE.MathUtils.lerp(cam.zoom, zoomTarget.current, blend);
      cam.updateProjectionMatrix();
      if (Math.abs(cam.zoom - zoomTarget.current) < 0.02)
        zoomTarget.current = null;
    }
    elapsed.current += dt;
    if (elapsed.current < 1 / 30) return;
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
        const a = areaIndex.get(p.scenicId);
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
    const next = {
      ...result,
      hidden: [...result.hidden, ...groups.slice(budget).map((g) => g.anchor)],
      groups,
      zoom,
      width: size.width,
      height: size.height,
    };
    const fingerprint = JSON.stringify(next);
    if (fingerprint !== lastFrame.current) {
      lastFrame.current = fingerprint;
      onScreen(next);
    }
  });
  return (
    <OrbitControls
      ref={controls}
      onStart={() => {
        flight.current = null;
        zoomTarget.current = null;
      }}
      dampingFactor={0.12}
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
  resetRevision,
}: {
  provinces: Province[];
  selected: Province | null;
  onSelect: (p: Province) => void;
  onScenic: (s: ScenicArea) => void;
  resetRevision: number;
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
        <ambientLight intensity={1.8} />
        <directionalLight position={[-15, -10, 30]} intensity={0.5} />
        {provinces.map((p) => (
          <ProvinceShape
            key={p.properties.adcode}
            feature={p}
            active={selected?.properties.adcode === p.properties.adcode}
            muted={
              !!selected && selected.properties.adcode !== p.properties.adcode
            }
            onSelect={() => onSelect(p)}
          />
        ))}

        <CameraAndLabels
          provinces={provinces}
          selected={selected}
          points={points}
          areas={areas}
          command={command}
          onScreen={setScreen}
          resetRevision={resetRevision}
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
                left: 0,
                top: 0,
                transform: `translate3d(${l.left}px, ${l.top}px, 0)`,
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
      {!selected && screen.hidden.length > 0 && (
        <div className="map-density">
          <small>地名较密，可从列表选择全部省份</small>
          <button onClick={() => document.getElementById('province')?.focus()}>
            选择省份
          </button>
        </div>
      )}
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
