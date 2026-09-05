'use client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useTexture } from '@react-three/drei';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls as Controls } from 'three-stdlib';
import { useReducedMotion } from '../lib/use-motion-preference';
import terrain from '../public/data/terrain/manifest.json';
import relief from '../public/data/terrain/relief.json';
import chinaHeights from '../public/data/terrain/china-elevation.json';
import zhejiangHeights from '../public/data/terrain/zhejiang-elevation.json';
import { elevationAt, HEIGHT_SCALE } from '../lib/terrain-height';
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
  position: [0, -26, 36] as [number, number, number],
  zoom: 12,
  up: [0, 0, 1] as [number, number, number],
  near: 0.01,
  far: 1000,
};
const polygons = (f: Province) =>
  (f.geometry.type === 'Polygon'
    ? [f.geometry.coordinates]
    : f.geometry.coordinates) as number[][][][];
const meshBuffers = new WeakMap<
  ArrayBuffer,
  { data: THREE.InterleavedBuffer; index: THREE.BufferAttribute }
>();
function sharedMeshBuffers(buffer: ArrayBuffer) {
  let shared = meshBuffers.get(buffer);
  if (!shared) {
    shared = {
      data: new THREE.InterleavedBuffer(
        new Float32Array(buffer, 0, relief.vertexCount * 8),
        8,
      ),
      index: new THREE.BufferAttribute(
        new Uint32Array(buffer, relief.vertexCount * 32),
        1,
      ),
    };
    meshBuffers.set(buffer, shared);
  }
  return shared;
}
const ProvinceShape = memo(function ProvinceShape({
  feature,
  active,
  muted,
  onSelect,
  meshData,
}: {
  feature: Province;
  active: boolean;
  muted: boolean;
  onSelect: (p: Province) => void;
  meshData: ArrayBuffer;
}) {
  const [hover, setHover] = useState(false);
  const local = Number(feature.properties.adcode) === 330000;
  const region = local ? terrain.zhejiang : terrain.china;
  const texture = useTexture(`/data/terrain/${region.texture}`);
  const { gl } = useThree();
  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
  }, [texture, gl]);
  const geometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const { data, index } = sharedMeshBuffers(meshData);
    geometry.setAttribute(
      'position',
      new THREE.InterleavedBufferAttribute(data, 3, 0),
    );
    geometry.setAttribute(
      'normal',
      new THREE.InterleavedBufferAttribute(data, 3, 3),
    );
    geometry.setAttribute(
      'uv',
      new THREE.InterleavedBufferAttribute(data, 2, 6),
    );
    geometry.setIndex(index);
    const part =
      relief.features[
        String(feature.properties.adcode) as keyof typeof relief.features
      ];
    geometry.setDrawRange(part.start, part.count);
    return geometry;
  }, [feature, meshData]);
  const outline = useMemo(() => {
    const values: number[] = [];
    const grid = local ? zhejiangHeights : chinaHeights;
    for (const polygon of polygons(feature))
      for (const ring of polygon) {
        for (let i = 1; i < ring.length; i++)
          for (const p of [ring[i - 1], ring[i]])
            values.push(
              ...project(p),
              Math.max(0, elevationAt(grid, p[0], p[1])) * HEIGHT_SCALE + 0.033,
            );
      }
    return new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(values, 3),
    );
  }, [feature, local]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => outline.dispose(), [outline]);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, dt) => {
    if (material.current)
      material.current.opacity = THREE.MathUtils.damp(
        material.current.opacity,
        muted ? 0.16 : 1,
        8,
        dt,
      );
  });
  return (
    <group>
      <mesh
        geometry={geometry}
        frustumCulled={false}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
        }}
        onPointerOut={() => setHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          if (e.delta < 5 && feature.properties.name && !active)
            onSelect(feature);
        }}
      >
        <meshStandardMaterial
          ref={material}
          map={texture}
          transparent
          depthWrite={!muted}
          color={active || hover ? '#ffffff' : '#e1e9df'}
          roughness={1}
          metalness={0}
        />
      </mesh>
      <lineSegments geometry={outline}>
        <lineBasicMaterial
          color={active ? '#547d70' : '#9aa99a'}
          transparent
          opacity={muted ? 0.15 : 0.6}
        />
      </lineSegments>
    </group>
  );
});
function CameraAndLabels({
  provinces,
  selected,
  points,
  areas,
  command,
  onScreen,
  resetRevision,
  onOverview,
  visible,
}: {
  provinces: Province[];
  selected: Province | null;
  points: PointRecord[];
  areas: ScenicArea[];
  command: { id: number; factor: number };
  onScreen: (s: ScreenState) => void;
  resetRevision: number;
  onOverview: () => void;
  visible: boolean;
}) {
  const { camera, size, gl } = useThree();
  const reduced = useReducedMotion();
  const controls = useRef<Controls>(null);
  const flight = useRef<{
    position: THREE.Vector3;
    target: THREE.Vector3;
    zoom: number;
  } | null>(null);
  const zoomTarget = useRef<number | null>(null);
  const lastCommand = useRef(0);
  const initialized = useRef(false);
  const userZoomed = useRef(false);
  const returning = useRef(false);
  const overviewWheelLock = useRef(0);
  const previousLabels = useRef<PlacedLabel[]>([]);
  const showFour = useRef(false);
  const pivot = useRef<THREE.Vector2 | null>(null);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const ground = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
    [],
  );
  const lastFrame = useRef('');
  const lastCamera = useRef('');
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
        Math.max(220, size.width - 96) / Math.max(span.x, 1),
        Math.max(220, size.height - 220) / Math.max(span.y * 0.81, 1),
      ) * 0.92;
    const destination = {
      position: new THREE.Vector3(center.x, center.y - 26, 36),
      target: new THREE.Vector3(center.x, center.y, 0),
      zoom: initialZoom.current,
    };
    zoomTarget.current = null;
    pivot.current = null;
    userZoomed.current = false;
    returning.current = false;
    previousLabels.current = [];
    showFour.current = false;
    lastCamera.current = '';
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
    const host = gl.domElement.closest('.handscroll-map');
    if (!host || !visible) return;
    const touches = new Map<number, THREE.Vector2>();
    let pinchDistance = 0;
    const touchDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        pinchDistance = a.distanceTo(b);
        if (controls.current) controls.current.enablePan = false;
        flight.current = null;
      }
    };
    const touchMove = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));
      if (touches.size !== 2) return;
      const [a, b] = [...touches.values()],
        distance = a.distanceTo(b);
      const rect = gl.domElement.getBoundingClientRect();
      pivot.current = new THREE.Vector2(
        (((a.x + b.x) / 2 - rect.left) / rect.width) * 2 - 1,
        1 - (((a.y + b.y) / 2 - rect.top) / rect.height) * 2,
      );
      if (pinchDistance > 0)
        zoomTarget.current = THREE.MathUtils.clamp(
          ((zoomTarget.current ?? cam.zoom) * distance) / pinchDistance,
          initialZoom.current * (selected?.properties ? 0.4 : 0.65),
          initialZoom.current * 18,
        );
      pinchDistance = distance;
      userZoomed.current = true;
    };
    const touchUp = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      pinchDistance = 0;
      if (controls.current) controls.current.enablePan = true;
    };
    const wheel = (event: Event) => {
      const e = event as WheelEvent;
      if ((e.target as HTMLElement).closest('.map-cluster, .map-density'))
        return;
      e.preventDefault();
      // 同一次触控板惯性滚动不能打断刚触发的全国回程。
      if (!selected && performance.now() < overviewWheelLock.current) return;
      const rect = gl.domElement.getBoundingClientRect();
      pivot.current = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((e.clientY - rect.top) / rect.height) * 2,
      );
      const pixels =
        e.deltaY *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1);
      flight.current = null;
      userZoomed.current = true;
      zoomTarget.current = THREE.MathUtils.clamp(
        (zoomTarget.current ?? cam.zoom) *
          Math.exp(-THREE.MathUtils.clamp(pixels, -240, 240) * 0.0032),
        initialZoom.current * (selected ? 0.4 : 0.65),
        initialZoom.current * 18,
      );
    };
    host.addEventListener('wheel', wheel, { passive: false });
    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', touchDown, true);
    canvas.addEventListener('pointermove', touchMove, true);
    canvas.addEventListener('pointerup', touchUp, true);
    canvas.addEventListener('pointercancel', touchUp, true);
    controls.current?.listenToKeyEvents(host as HTMLElement);
    return () => {
      host.removeEventListener('wheel', wheel);
      controls.current?.stopListenToKeyEvents();
      canvas.removeEventListener('pointerdown', touchDown, true);
      canvas.removeEventListener('pointermove', touchMove, true);
      canvas.removeEventListener('pointerup', touchUp, true);
      canvas.removeEventListener('pointercancel', touchUp, true);
    };
  }, [gl, cam, selected, visible]);
  useEffect(() => {
    if (command.id && command.id !== lastCommand.current) {
      lastCommand.current = command.id;
      flight.current = null;
      const next = Math.max(
        initialZoom.current * (selected ? 0.4 : 0.65),
        Math.min(
          initialZoom.current * 18,
          (zoomTarget.current ?? cam.zoom) * command.factor,
        ),
      );
      userZoomed.current = true;
      pivot.current = null;
      if (reduced) {
        cam.zoom = next;
        cam.updateProjectionMatrix();
      } else zoomTarget.current = next;
    }
  }, [command, cam, reduced, selected]);
  useFrame((_, dt) => {
    if (!visible) return;
    const blend = reduced ? 1 : 1 - Math.exp(-Math.min(dt, 0.05) * 10);
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
      const before = new THREE.Vector3(),
        after = new THREE.Vector3();
      if (pivot.current) {
        ray.setFromCamera(pivot.current, cam);
        ray.ray.intersectPlane(ground, before);
      }
      cam.zoom = THREE.MathUtils.lerp(cam.zoom, zoomTarget.current, blend);
      cam.updateProjectionMatrix();
      if (pivot.current && controls.current) {
        ray.setFromCamera(pivot.current, cam);
        ray.ray.intersectPlane(ground, after);
        before.sub(after);
        cam.position.add(before);
        controls.current.target.add(before);
      }
      if (Math.abs(cam.zoom - zoomTarget.current) < 0.02)
        zoomTarget.current = null;
    }
    cam.updateMatrixWorld();
    if (
      selected &&
      userZoomed.current &&
      !flight.current &&
      !returning.current &&
      cam.zoom / initialZoom.current < 0.6
    ) {
      returning.current = true;
      overviewWheelLock.current = performance.now() + 1100;
      zoomTarget.current = null;
      onOverview();
    }
    elapsed.current += dt;
    if (elapsed.current < 1 / 30) return;
    elapsed.current = 0;
    const cameraStamp = [
      cam.position.x,
      cam.position.y,
      cam.position.z,
      cam.zoom,
      size.width,
      size.height,
      selected?.properties.adcode,
      points.length,
    ].join('|');
    if (cameraStamp === lastCamera.current) return;
    lastCamera.current = cameraStamp;
    const zoom = cam.zoom / initialZoom.current;
    const anchors: MapAnchor[] = [];
    const add = (
      id: string,
      name: string,
      point: number[],
      priority: number,
      kind: 'province' | 'scenic',
    ) => {
      const grid =
        selected?.properties.adcode === 330000 ? zhejiangHeights : chinaHeights;
      const h =
        Math.max(0, elevationAt(grid, point[0], point[1])) * HEIGHT_SCALE;
      const p = new THREE.Vector3(...project(point), h + 0.07).project(cam);
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
      if (zoom > 1.7) showFour.current = true;
      if (zoom < 1.5) showFour.current = false;
      points.forEach((p) => {
        const a = areaIndex.get(p.scenicId);
        if (!a || (a.grade === '4A' && !showFour.current)) return;
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
    const result = placeLabels(
      eligible,
      size.width,
      size.height,
      !selected,
      flight.current ? [] : previousLabels.current,
    );
    previousLabels.current = result.labels;
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
      enabled={visible}
      enablePan
      screenSpacePanning={false}
      panSpeed={1.1}
      mouseButtons={{
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.PAN,
      }}
      touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }}
      enableZoom={false}
      minZoom={0.5}
      maxZoom={1400}
      minPolarAngle={0.15}
      maxPolarAngle={1.05}
      enableRotate={false}
      zoomSpeed={1.4}
    />
  );
}
export default function HandscrollMap({
  provinces,
  selected,
  onSelect,
  onScenic,
  resetRevision,
  onOverview,
  visible = true,
}: {
  provinces: Province[];
  selected: Province | null;
  onSelect: (p: Province) => void;
  onScenic: (s: ScenicArea) => void;
  resetRevision: number;
  onOverview: () => void;
  visible?: boolean;
}) {
  const [meshData, setMeshData] = useState<ArrayBuffer | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/data/terrain/relief.bin', { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.arrayBuffer();
      })
      .then(setMeshData)
      .catch((e) => {
        if (e.name !== 'AbortError') setDataError(true);
      });
    return () => controller.abort();
  }, []);
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
  const retainedLabels = useRef(new Map<string, PlacedLabel>());
  for (const label of screen.labels)
    retainedLabels.current.set(label.id, label);
  const visibleIds = new Set(screen.labels.map((l) => l.id));
  const drawnLabels = [...retainedLabels.current.values()];
  useEffect(() => {
    setExpanded(null);
  }, [selected, visible]);
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
    <div
      className="handscroll-map"
      tabIndex={0}
      aria-label="立体山水地图，可左键拖动或方向键平移，滚轮缩放"
    >
      {!meshData && (
        <p className="map-error" role="status">
          {dataError ? '地形加载失败，请刷新重试。' : '正在铺展立体山河…'}
        </p>
      )}
      <Canvas
        frameloop={visible ? 'always' : 'never'}
        orthographic
        camera={cameraSettings}
        dpr={[1, 1.5]}
        gl={{ alpha: true }}
        fallback={<p>三维地图不可用，请从省份及景区列表继续。</p>}
      >
        <ambientLight intensity={1.4} />
        <directionalLight position={[-15, -10, 30]} intensity={1.1} />
        {meshData &&
          provinces.map((p) => (
            <ProvinceShape
              key={p.properties.adcode}
              feature={p}
              active={selected?.properties.adcode === p.properties.adcode}
              muted={
                !!selected && selected.properties.adcode !== p.properties.adcode
              }
              meshData={meshData}
              onSelect={onSelect}
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
          onOverview={onOverview}
          visible={visible}
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
          {drawnLabels.map((l) => (
            <g
              key={l.id}
              style={{
                opacity: visibleIds.has(l.id) ? 1 : 0,
                transition: 'opacity 180ms ease',
              }}
            >
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
        {drawnLabels.map((l) => {
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
              data-visible={visibleIds.has(l.id)}
              aria-hidden={!visibleIds.has(l.id)}
              tabIndex={visibleIds.has(l.id) ? 0 : -1}
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
