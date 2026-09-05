'use client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls as Controls } from 'three-stdlib';
import { useReducedMotion } from '../lib/use-motion-preference';
import { HEIGHT_SCALE } from '../lib/terrain-height';
import {
  ProvinceShape,
  provinceTerrainBlend,
  provinceTerrainHeight,
  type TerrainStatus,
} from './province-terrain';
import {
  fitProvinceZoom,
  provinceAt,
  requiresCameraFit,
  provincePolygons as polygons,
  provinceFocusPolygons,
} from '../lib/province-view';
import type { Province } from './china-map';
import type { ScenicArea, Catalog } from '../lib/content';
import { selectScenicAreas } from '../lib/scenic-selection';
import {
  clusterAnchors,
  placeLabels,
  labelDock,
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
  scale: number;
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
function CameraAndLabels({
  provinces,
  selected,
  points,
  areas,
  command,
  onScreen,
  resetRevision,
  onViewportSelect,
  visible,
}: {
  provinces: Province[];
  selected: Province | null;
  points: PointRecord[];
  areas: ScenicArea[];
  command: { id: number; factor: number };
  onScreen: (s: ScreenState) => void;
  resetRevision: number;
  onViewportSelect: (p: Province | null) => void;
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
  const lastFit = useRef({ revision: -1, width: 0, height: 0 });
  const dragStart = useRef<THREE.Vector3 | null>(null);
  const panPending = useRef(false);
  const panSettlesAt = useRef(0);
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
  const nationalZoom = useMemo(
    () =>
      fitProvinceZoom(
        provinces.filter((p) => p.properties.name),
        size.width,
        size.height,
      ),
    [provinces, size],
  );
  const bounds = useMemo(() => {
    const b = new THREE.Box2();
    (selected ? [selected] : provinces.filter((p) => p.properties.name))
      .flatMap(selected ? provinceFocusPolygons : polygons)
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
    initialZoom.current = fitProvinceZoom(
      selected ? [selected] : provinces.filter((p) => p.properties.name),
      size.width,
      size.height,
    );
    const fitRequested = requiresCameraFit(
      lastFit.current,
      resetRevision,
      size.width,
      size.height,
      initialized.current,
    );
    previousLabels.current = [];
    showFour.current = false;
    lastCamera.current = '';
    returning.current = false;
    // 平移/缩小引起的选择变化只更新数据范围，不改镜头或缩放目标。
    if (!fitRequested) return;
    lastFit.current = {
      revision: resetRevision,
      width: size.width,
      height: size.height,
    };
    const destination = {
      position: new THREE.Vector3(center.x, center.y - 26, 36),
      target: new THREE.Vector3(center.x, center.y, 0),
      zoom: initialZoom.current,
    };
    zoomTarget.current = null;
    pivot.current = null;
    userZoomed.current = false;
    panPending.current = false;
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
          nationalZoom * 0.65,
          1400,
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
        nationalZoom * 0.65,
        1400,
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
  }, [gl, cam, selected, visible, nationalZoom]);
  useEffect(() => {
    if (command.id && command.id !== lastCommand.current) {
      lastCommand.current = command.id;
      flight.current = null;
      const next = Math.max(
        nationalZoom * 0.65,
        Math.min(1400, (zoomTarget.current ?? cam.zoom) * command.factor),
      );
      userZoomed.current = true;
      pivot.current = null;
      if (reduced) {
        cam.zoom = next;
        cam.updateProjectionMatrix();
      } else zoomTarget.current = next;
    }
  }, [command, cam, reduced, selected, nationalZoom]);
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
    gl.domElement.dataset.mapZoom = cam.zoom.toFixed(4);
    if (
      selected &&
      userZoomed.current &&
      !flight.current &&
      !returning.current &&
      cam.zoom / initialZoom.current < 0.6
    ) {
      returning.current = true;
      zoomTarget.current = null;
      onViewportSelect(null);
    }
    if (
      panPending.current &&
      performance.now() > panSettlesAt.current &&
      controls.current &&
      !flight.current &&
      zoomTarget.current === null
    ) {
      panPending.current = false;
      ray.setFromCamera(new THREE.Vector2(0, 0), cam);
      const hit = ray.ray.intersectPlane(ground, new THREE.Vector3());
      let candidate = hit
        ? provinceAt(provinces, [hit.x / 0.75 + 104, hit.y / 0.95 + 35])
        : null;
      if (
        candidate &&
        cam.zoom < fitProvinceZoom([candidate], size.width, size.height) * 0.6
      )
        candidate = null;
      if (candidate?.properties.adcode !== selected?.properties.adcode) {
        userZoomed.current = false;
        onViewportSelect(candidate);
      }
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
      provinceTerrainBlend(selected?.properties.adcode).toFixed(3),
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
      const h =
        provinceTerrainHeight(selected?.properties.adcode, point) *
        HEIGHT_SCALE;
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
      scale: cam.zoom / nationalZoom,
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
        dragStart.current = controls.current?.target.clone() ?? null;
        panPending.current = false;
      }}
      onEnd={() => {
        if (
          dragStart.current &&
          controls.current &&
          dragStart.current.distanceTo(controls.current.target) > 0.02
        ) {
          panPending.current = true;
          panSettlesAt.current = performance.now() + 300;
        }
        dragStart.current = null;
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
  onViewportSelect,
  visible = true,
}: {
  provinces: Province[];
  selected: Province | null;
  onSelect: (p: Province) => void;
  onScenic: (s: ScenicArea) => void;
  resetRevision: number;
  onViewportSelect: (p: Province | null) => void;
  visible?: boolean;
}) {
  const [terrainStatus, setTerrainStatus] = useState<
    Record<string, TerrainStatus>
  >({});
  const onTerrainStatus = useCallback((code: string, status: TerrainStatus) => {
    setTerrainStatus((old) => ({ ...old, [code]: status }));
  }, []);
  const currentTerrainStatus = selected
    ? (terrainStatus[String(selected.properties.adcode)] ?? 'loading')
    : 'overview';
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
    scale: 1,
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
      data-terrain-status={currentTerrainStatus}
      data-highlighted-province={selected?.properties.adcode ?? ''}
      tabIndex={0}
      aria-label="立体山水地图，可左键拖动或方向键平移，滚轮缩放"
    >
      {!meshData && (
        <p className="map-error" role="status">
          {dataError ? '地形加载失败，请刷新重试。' : '正在铺展立体山河…'}
        </p>
      )}
      {selected &&
        (currentTerrainStatus === 'loading' ||
          currentTerrainStatus === 'error') && (
          <p className="terrain-status" role="status">
            {currentTerrainStatus === 'loading'
              ? '正在细绘此地山河…'
              : '精细地形暂未载入，仍可浏览基础地图。请重新选择此省重试。'}
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
              onStatus={onTerrainStatus}
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
          onViewportSelect={onViewportSelect}
          visible={visible}
        />
      </Canvas>
      <div
        className="map-signs"
        aria-label={selected ? '景区地图标签' : '省份地图标签'}
      >
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
              <svg
                className="sign-connector"
                width={l.width}
                height={l.height}
                aria-hidden="true"
              >
                <line
                  x1={l.x - l.left}
                  y1={l.y - l.top}
                  x2={labelDock(l).x}
                  y2={labelDock(l).y}
                  stroke="#937345"
                  strokeWidth=".8"
                  opacity=".65"
                />
                <circle
                  cx={l.x - l.left}
                  cy={l.y - l.top}
                  r={l.kind === 'province' ? 2 : 4}
                  fill="#b78a37"
                  stroke="#fff5d1"
                  strokeWidth="2"
                />
              </svg>
              <div
                className="sign-solid"
                style={{
                  transformOrigin: `${labelDock(l).x - 4}px ${labelDock(l).y - 4}px`,
                }}
              >
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
        <span>{screen.scale.toFixed(1)}×</span>
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
