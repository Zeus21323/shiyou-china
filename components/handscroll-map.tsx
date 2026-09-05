'use client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls as Controls } from 'three-stdlib';
import { useReducedMotion } from '../lib/use-motion-preference';
import { HEIGHT_SCALE, elevationAt } from '../lib/terrain-height';
import { PROVINCE_LIFT } from '../lib/province-lift';
import chinaHeights from '../public/data/terrain/china-elevation.json';
import {
  ProvinceShape,
  provinceTerrainBlend,
  provinceTerrainHeight,
  provinceDisplayLift,
  type TerrainStatus,
  prefetchProvinceTerrain,
  warmProvinceTexture,
  createBoundaryContext,
} from './province-terrain';
import {
  fitProvinceZoom,
  MAP_CAMERA_OFFSET,
  provinceAt,
  containsProvince,
  PROVINCE_FOCUS_SCALE,
  provinceFocusEnabled,
  focusProvince,
  settleProvinceFocus,
  retainBoundaryFocus,
  requiresCameraFit,
  provincePolygons as polygons,
  provinceFocusPolygons,
} from '../lib/province-view';
import type { Province } from './china-map';
import type { ScenicArea } from '../lib/content';
import cityData from '../public/data/city-labels.json';
import {
  clusterAnchors,
  placeLabels,
  cityVisible,
  capitalPosition,
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
  position: [...MAP_CAMERA_OFFSET] as [number, number, number],
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
  const zoomDirection = useRef(1);
  const returning = useRef(false);
  const lastFit = useRef({ revision: -1, width: 0, height: 0 });
  const dragStart = useRef<THREE.Vector3 | null>(null);
  const panPending = useRef(false);
  const panSettlesAt = useRef(0);
  const selectionCheckAt = useRef(0);
  const proposed = useRef({ code: '', since: 0 });
  const previousLabels = useRef<PlacedLabel[]>([]);
  const showFour = useRef(false);
  const pivot = useRef<THREE.Vector2 | null>(null);
  const hoverPointer = useRef<{ point: THREE.Vector2 } | null>(null);
  const pointerPick = useRef<{
    stamp: string;
    point: number[];
    nearby: number[][];
  } | null>(null);
  const previewCheckAt = useRef(0);
  const focusHistory = useRef<{ code: string; scale: number; time: number }[]>(
    [],
  );
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
    if (selected)
      initialZoom.current = Math.max(
        initialZoom.current,
        nationalZoom * PROVINCE_FOCUS_SCALE,
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
    hoverPointer.current = null;
    proposed.current = {
      code: String(selected?.properties.adcode ?? ''),
      since: performance.now(),
    };
    lastFit.current = {
      revision: resetRevision,
      width: size.width,
      height: size.height,
    };
    const destination = {
      position: new THREE.Vector3(
        center.x,
        center.y + MAP_CAMERA_OFFSET[1],
        MAP_CAMERA_OFFSET[2],
      ),
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
    const warmPointer = () => {
      if (!pivot.current) return;
      ray.setFromCamera(pivot.current, cam);
      const hit = ray.ray.intersectPlane(ground, new THREE.Vector3());
      const province =
        hit && provinceAt(provinces, [hit.x / 0.75 + 104, hit.y / 0.95 + 35]);
      if (province) prefetchProvinceTerrain(province.properties.adcode);
    };
    let pinchDistance = 0;
    let hoverWarmAt = 0;
    const hoverMove = (event: Event) => {
      const e = event as PointerEvent;
      if (e.pointerType !== 'mouse') return;
      if (
        (e.target as HTMLElement).closest(
          '.map-cluster, .map-density, .map-zoom',
        )
      ) {
        hoverPointer.current = null;
        return;
      }
      const rect = gl.domElement.getBoundingClientRect();
      hoverPointer.current = {
        point: new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          1 - ((e.clientY - rect.top) / rect.height) * 2,
        ),
      };
      if (cam.zoom / nationalZoom >= 2.5 && performance.now() >= hoverWarmAt) {
        hoverWarmAt = performance.now() + 120;
        // 预载使用鼠标位置，不改变现有滚轮缩放中心。
        ray.setFromCamera(hoverPointer.current.point, cam);
        const hit = ray.ray.intersectPlane(ground, new THREE.Vector3());
        const p =
          hit && provinceAt(provinces, [hit.x / 0.75 + 104, hit.y / 0.95 + 35]);
        if (p) prefetchProvinceTerrain(p.properties.adcode);
      }
    };
    const hoverLeave = () => {
      hoverPointer.current = null;
    };
    const touchDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      hoverPointer.current = null;
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
      zoomDirection.current = distance >= pinchDistance ? 1 : -1;
      pinchDistance = distance;
      warmPointer();
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
      zoomDirection.current = pixels < 0 ? 1 : -1;
      hoverPointer.current = { point: pivot.current.clone() };
      flight.current = null;
      userZoomed.current = true;
      zoomTarget.current = THREE.MathUtils.clamp(
        (zoomTarget.current ?? cam.zoom) *
          Math.exp(-THREE.MathUtils.clamp(pixels, -240, 240) * 0.0032),
        nationalZoom * 0.65,
        1400,
      );
      if (pixels < 0) warmPointer();
    };
    host.addEventListener('wheel', wheel, { passive: false });
    host.addEventListener('pointermove', hoverMove);
    host.addEventListener('pointerleave', hoverLeave);
    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', touchDown, true);
    canvas.addEventListener('pointermove', touchMove, true);
    canvas.addEventListener('pointerup', touchUp, true);
    canvas.addEventListener('pointercancel', touchUp, true);
    controls.current?.listenToKeyEvents(host as HTMLElement);
    return () => {
      host.removeEventListener('wheel', wheel);
      host.removeEventListener('pointermove', hoverMove);
      host.removeEventListener('pointerleave', hoverLeave);
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
      zoomDirection.current = command.factor > 1 ? 1 : -1;
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
      ) {
        cam.position.copy(f.position);
        controls.current.target.copy(f.target);
        cam.zoom = f.zoom;
        cam.lookAt(f.target);
        cam.updateProjectionMatrix();
        flight.current = null;
      }
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
      if (Math.abs(cam.zoom - zoomTarget.current) < 0.02) {
        cam.zoom = zoomTarget.current;
        cam.updateProjectionMatrix();
        zoomTarget.current = null;
      }
    }
    cam.updateMatrixWorld();
    gl.domElement.dataset.mapZoom = cam.zoom.toFixed(4);
    const canFocus = provinceFocusEnabled(cam.zoom / nationalZoom);
    const awaitingFit = requiresCameraFit(
      lastFit.current,
      resetRevision,
      size.width,
      size.height,
      initialized.current,
    );
    gl.domElement.dataset.mapScale = (cam.zoom / nationalZoom).toFixed(4);
    const focusCode = canFocus ? String(selected?.properties.adcode ?? '') : '';
    if (focusHistory.current.at(-1)?.code !== focusCode) {
      focusHistory.current.push({
        code: focusCode,
        scale: cam.zoom / nationalZoom,
        time: Math.round(performance.now()),
      });
      focusHistory.current = focusHistory.current.slice(-24);
      gl.domElement.dataset.focusHistory = JSON.stringify(focusHistory.current);
    }
    gl.domElement.dataset.provinceLifts = JSON.stringify(
      provinces
        .map((p) => [
          p.properties.adcode,
          provinceDisplayLift(p.properties.adcode),
        ])
        .filter(([, lift]) => Number(lift) > 0),
    );
    gl.domElement.dataset.terrainProgress = provinceTerrainBlend(
      selected?.properties.adcode,
    ).toFixed(3);
    if (
      selected &&
      !awaitingFit &&
      !flight.current &&
      !returning.current &&
      !canFocus
    ) {
      returning.current = true;
      onViewportSelect(null);
    }
    if (canFocus) returning.current = false;
    const now = performance.now();
    const followingMouse = canFocus && hoverPointer.current !== null;
    if (
      !flight.current &&
      canFocus &&
      !awaitingFit &&
      now >= selectionCheckAt.current &&
      (followingMouse ||
        (userZoomed.current && zoomDirection.current > 0) ||
        panPending.current ||
        dragStart.current)
    ) {
      selectionCheckAt.current = now + 32;
      const samples = [
        [0, 0],
        [-0.32, 0],
        [0.32, 0],
        [0, 0.28],
        [0, -0.28],
      ].flatMap(([x, y]) => {
        ray.setFromCamera(new THREE.Vector2(x, y), cam);
        const hit = ray.ray.intersectPlane(ground, new THREE.Vector3());
        return hit ? [[hit.x / 0.75 + 104, hit.y / 0.95 + 35]] : [];
      });
      let pointerGeo: number[] | undefined;
      let pointerNearby: number[][] = [];
      if (followingMouse && hoverPointer.current) {
        const pointer = hoverPointer.current.point;
        // 只有鼠标或镜头实际移动才重算落点，渲染与资源更新不会改写选择。
        const stamp = [
          pointer.x.toFixed(5),
          pointer.y.toFixed(5),
          cam.zoom.toFixed(4),
          cam.position.x.toFixed(4),
          cam.position.y.toFixed(4),
          cam.position.z.toFixed(4),
          cam.quaternion.x.toFixed(5),
          cam.quaternion.y.toFixed(5),
          cam.quaternion.z.toFixed(5),
          cam.quaternion.w.toFixed(5),
          size.width,
          size.height,
        ].join('|');
        const projectPointer = (point: THREE.Vector2, lift = 0) => {
          ray.setFromCamera(point, cam);
          const hit = ray.ray.intersectPlane(ground, new THREE.Vector3());
          if (hit) {
            // 命中使用不随选择与加载变化的全国DEM，避免模型渐变造成反馈抖动。
            for (let i = 0; i < 3; i++) {
              const geo = [hit.x / 0.75 + 104, hit.y / 0.95 + 35];
              const h =
                Math.max(0, elevationAt(chinaHeights, geo[0], geo[1])) *
                  HEIGHT_SCALE +
                lift;
              ray.ray.intersectPlane(
                new THREE.Plane(new THREE.Vector3(0, 0, 1), -h),
                hit,
              );
            }
            return [hit.x / 0.75 + 104, hit.y / 0.95 + 35];
          } else return [NaN, NaN];
        };
        // 选中板块上表面可继续命中；使用固定目标高度，升降动画不参与命中反馈。
        const pickPointer = (point: THREE.Vector2) => {
          if (selected) {
            const raised = projectPointer(point, PROVINCE_LIFT);
            if (containsProvince(selected, raised)) return raised;
          }
          return projectPointer(point);
        };
        if (pointerPick.current?.stamp !== stamp) {
          const point = pickPointer(pointer);
          const nearby = [
            [-6 / size.width, 0],
            [6 / size.width, 0],
            [0, -6 / size.height],
            [0, 6 / size.height],
          ].map(([dx, dy]) =>
            pickPointer(new THREE.Vector2(pointer.x + dx, pointer.y + dy)),
          );
          pointerPick.current = { stamp, point, nearby };
        }
        pointerGeo = pointerPick.current.point;
        pointerNearby = pointerPick.current.nearby;
      }
      let candidate = focusProvince(
        provinces,
        cam.zoom / nationalZoom,
        pointerGeo,
        samples,
        selected,
      );
      if (followingMouse)
        candidate = retainBoundaryFocus(
          candidate,
          selected,
          pointerNearby.map((p) => provinceAt(provinces, p)),
        );
      if (candidate) {
        prefetchProvinceTerrain(candidate.properties.adcode);
        warmProvinceTexture(candidate.properties.adcode, gl);
      }
      const code = String(candidate?.properties.adcode ?? '');
      const settled = settleProvinceFocus(proposed.current, code, now);
      proposed.current = settled.proposal;
      // 空间滞回负责边界稳定，省内只需40ms响应。
      if (
        !returning.current &&
        settled.ready &&
        candidate?.properties.adcode !== selected?.properties.adcode
      ) {
        onViewportSelect(candidate);
      }
      if (panPending.current && now > panSettlesAt.current)
        panPending.current = false;
      if (
        zoomTarget.current === null &&
        !panPending.current &&
        !dragStart.current &&
        now - proposed.current.since >= 220
      )
        userZoomed.current = false;
    }
    // 6倍前预载当前及相邻视野；点击飞入阶段也提前准备GPU纹理。
    if (now >= previewCheckAt.current && cam.zoom / nationalZoom >= 2.5) {
      previewCheckAt.current = now + 220;
      const warmCodes = new Set<string>();
      if (selected) warmCodes.add(String(selected.properties.adcode));
      for (const [x, y] of [
        [0, 0],
        [-0.3, 0],
        [0.3, 0],
        [0, -0.45],
        [0, 0.45],
      ]) {
        ray.setFromCamera(new THREE.Vector2(x, y), cam);
        const hit = ray.ray.intersectPlane(ground, new THREE.Vector3());
        const region =
          hit && provinceAt(provinces, [hit.x / 0.75 + 104, hit.y / 0.95 + 35]);
        if (region) warmCodes.add(String(region.properties.adcode));
      }
      for (const code of warmCodes) {
        prefetchProvinceTerrain(code);
        warmProvinceTexture(code, gl);
      }
    }
    elapsed.current += dt;
    if (elapsed.current < 1 / 60) return;
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
      provinces
        .map((p) => provinceDisplayLift(p.properties.adcode).toFixed(4))
        .join(','),
    ].join('|');
    if (cameraStamp === lastCamera.current) return;
    lastCamera.current = cameraStamp;
    const zoom = cam.zoom / initialZoom.current;
    const mapSelected = canFocus ? selected : null;
    const anchors: MapAnchor[] = [];
    const add = (
      id: string,
      name: string,
      point: number[],
      priority: number,
      kind: MapAnchor['kind'],
      provinceCode: string | number | undefined = selected?.properties.adcode,
    ) => {
      const h =
        provinceTerrainHeight(provinceCode, point) * HEIGHT_SCALE +
        provinceDisplayLift(provinceCode);
      const p = new THREE.Vector3(
        ...project(point),
        h + (kind === 'scenic' ? 0.028 : 0.07),
      ).project(cam);
      const x = ((p.x + 1) * size.width) / 2,
        y = ((1 - p.y) * size.height) / 2;
      if (kind === 'capital') {
        anchors.push({
          id,
          name,
          priority,
          kind,
          ...capitalPosition(x, y, size.width, size.height),
        });
        return;
      }
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
    if (!mapSelected) {
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
            4,
            'province',
            p.properties.adcode,
          ),
        );
    } else {
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
    const cityAnchors: MapAnchor[] = [];
    {
      for (const city of cityData.cities) {
        const capital = city.province === 110000;
        if (
          !capital &&
          !cityVisible(city.province, mapSelected?.properties.adcode)
        )
          continue;
        const start = anchors.length;
        add(
          city.id,
          city.name,
          city.coordinates,
          capital ? 1000 : 12,
          capital ? 'capital' : 'city',
          city.province,
        );
        if (anchors.length > start) cityAnchors.push(anchors.pop()!);
      }
      // 直辖市和港澳的同名行政区牌与城市牌只保留一份。
      for (let i = anchors.length - 1; i >= 0; i--)
        if (
          anchors[i].kind === 'province' &&
          cityAnchors.some((c) => c.name === anchors[i].name)
        )
          anchors.splice(i, 1);
    }
    const groups = mapSelected
      ? clusterAnchors(anchors, 28)
      : anchors.map((a) => ({ anchor: a, members: [a] }));
    const budget = mapSelected
      ? Math.min(80, Math.max(5, Math.floor(8 * zoom * zoom)))
      : 100;
    const eligible = [
      ...groups.slice(0, budget).map((g) => g.anchor),
      ...cityAnchors,
    ];
    const result = placeLabels(
      eligible,
      size.width,
      size.height,
      !mapSelected,
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
          panSettlesAt.current = performance.now() + 200;
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
  areas,
  points,
  selected,
  onSelect,
  onScenic,
  resetRevision,
  onViewportSelect,
  visible = true,
}: {
  provinces: Province[];
  areas: ScenicArea[];
  points: PointRecord[];
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
  const boundaries = useMemo(
    () => createBoundaryContext(provinces),
    [provinces],
  );
  const onTerrainStatus = useCallback((code: string, status: TerrainStatus) => {
    setTerrainStatus((old) => ({ ...old, [code]: status }));
  }, []);
  const currentTerrainStatus = selected
    ? (terrainStatus[String(selected.properties.adcode)] ?? 'loading')
    : 'overview';
  const [meshData, setMeshData] = useState<ArrayBuffer | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/data/terrain/relief.bin?v=${HEIGHT_SCALE}`, {
      signal: controller.signal,
    })
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
  const [dataError, setDataError] = useState(false);
  const [screen, setScreen] = useState<ScreenState>({
    labels: [],
    hidden: [],
    groups: [],
    zoom: 1,
    scale: 1,
    width: 1,
    height: 1,
  });
  useEffect(() => {
    if (selected) prefetchProvinceTerrain(selected.properties.adcode);
  }, [selected]);
  const [command, setCommand] = useState({ id: 0, factor: 1 }),
    [expanded, setExpanded] = useState<string[] | null>(null);
  const mapSelected = provinceFocusEnabled(screen.scale) ? selected : null;
  const retainedLabels = useRef(new Map<string, PlacedLabel>());
  for (const label of screen.labels)
    retainedLabels.current.set(label.id, label);
  const visibleIds = new Set(screen.labels.map((l) => l.id));
  const drawnLabels = [...retainedLabels.current.values()];
  const [, refreshRetainedLabels] = useState(0);
  useEffect(() => {
    // 淡出完成后释放旧省标签，长时间跨省浏览不积累不可见按钮。
    const timer = window.setTimeout(() => {
      const keep = new Set(screen.labels.map((label) => label.id));
      let removed = false;
      for (const id of retainedLabels.current.keys()) {
        if (!keep.has(id)) {
          retainedLabels.current.delete(id);
          removed = true;
        }
      }
      if (removed) refreshRetainedLabels((n) => n + 1);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [screen.labels]);
  useEffect(() => {
    setExpanded(null);
  }, [selected, visible]);
  const act = (id: string) => {
    const city = cityData.cities.find((c) => c.id === id);
    if (city) {
      const p = provinces.find(
        (p) => Number(p.properties.adcode) === city.province,
      );
      if (p && p.properties.adcode !== selected?.properties.adcode) onSelect(p);
      return;
    }
    if (!mapSelected) {
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
      data-highlighted-province={mapSelected?.properties.adcode ?? ''}
      tabIndex={0}
      aria-label="立体山水地图，可左键拖动或方向键平移，滚轮缩放"
    >
      {!meshData && (
        <p className="map-error" role="status">
          {dataError ? '地形加载失败，请刷新重试。' : '正在铺展立体山河…'}
        </p>
      )}
      {mapSelected &&
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
        <ambientLight intensity={0.95} />
        <directionalLight position={[-18, -12, 22]} intensity={1.45} />
        {meshData &&
          provinces.map((p) => (
            <ProvinceShape
              key={p.properties.adcode}
              feature={p}
              boundaries={boundaries}
              focusCode={mapSelected?.properties.adcode}
              active={mapSelected?.properties.adcode === p.properties.adcode}
              muted={
                !!mapSelected &&
                mapSelected.properties.adcode !== p.properties.adcode
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
        aria-label={mapSelected ? '景区地图标签' : '省份地图标签'}
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
                l.kind === 'capital'
                  ? l.offscreen
                    ? '北京位于画面外，点击前往'
                    : '北京，首都，点击查看'
                  : l.kind === 'city'
                    ? `${l.name} · 城市，查看所在省份`
                    : l.name + (count > 1 ? `及附近${count - 1}个景点` : '')
              }
              onPointerEnter={() => {
                const code =
                  l.kind === 'province'
                    ? l.id
                    : cityData.cities.find((c) => c.id === l.id)?.province;
                if (code) prefetchProvinceTerrain(code);
              }}
              onFocus={() => {
                const code =
                  l.kind === 'province'
                    ? l.id
                    : cityData.cities.find((c) => c.id === l.id)?.province;
                if (code) prefetchProvinceTerrain(code);
              }}
              onClick={() => act(l.id)}
            >
              {l.kind === 'province' ? (
                <span className="province-map-name">{l.name}</span>
              ) : l.kind === 'capital' ? (
                <>
                  <svg
                    className="capital-star"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M12 1.5 15.2 8.1 22.5 9.2 17.2 14.3 18.5 21.6 12 18.2 5.5 21.6 6.8 14.3 1.5 9.2 8.8 8.1Z" />
                  </svg>
                  {l.offscreen ? (
                    <span className="capital-direction">
                      北京方向{' '}
                      <span
                        style={{
                          display: 'inline-block',
                          transform: `rotate(${l.direction}deg)`,
                        }}
                      >
                        →
                      </span>
                    </span>
                  ) : mapSelected?.properties.adcode === 110000 ? (
                    <span className="capital-name">北京</span>
                  ) : null}
                </>
              ) : l.kind === 'city' ? (
                <>
                  <span
                    className="city-map-dot"
                    style={{ left: l.x - l.left, top: l.y - l.top }}
                    aria-hidden="true"
                  />
                  <span className="city-map-name">{l.name}</span>
                </>
              ) : (
                <>
                  <svg
                    className="sign-connector"
                    width={l.width}
                    height={l.height}
                    aria-hidden="true"
                  >
                    <line
                      x1={l.x - l.left}
                      y1={l.y - l.top}
                      x2={l.x - l.left}
                      y2={l.height}
                      stroke="#8b713e"
                      strokeWidth="1.5"
                    />
                    <circle
                      cx={l.x - l.left}
                      cy={l.y - l.top}
                      r={4}
                      fill="#b78a37"
                      stroke="#fff5d1"
                      strokeWidth="2"
                    />
                  </svg>
                  <div className="scenic-stem-label">
                    <span title={l.name}>
                      {l.name.length > 14 ? l.name.slice(0, 13) + '…' : l.name}
                    </span>
                    {l.kind === 'scenic' && (
                      <small>
                        {count > 1
                          ? `+${count - 1}`
                          : areas.find((a) => a.id === l.id)?.grade}
                      </small>
                    )}
                  </div>
                </>
              )}
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
      {!mapSelected && screen.hidden.length > 0 && (
        <div className="map-density">
          <small>地名较密，可从列表选择全部省份</small>
          <button onClick={() => document.getElementById('province')?.focus()}>
            选择省份
          </button>
        </div>
      )}
      {mapSelected && areas.length > 0 && (
        <div className="map-density">
          <span>
            5A 优先 · 已显示{' '}
            {screen.labels.filter((l) => l.kind === 'scenic').length} 处
          </span>
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
