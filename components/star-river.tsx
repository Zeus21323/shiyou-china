'use client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OrbitControls as Controls } from 'three-stdlib';
import * as THREE from 'three';
import type { Work } from '../lib/content';
import { useReducedMotion } from '../lib/use-motion-preference';
import { layoutStarLabels, type StarLabel } from '../lib/star-layout';
import {
  buildCloud,
  pickCloudStar,
  isCloudClick,
  cloudWheelDistance,
  smoothCloudDistance,
  cloudLabelOpacity,
} from '../lib/poetry-cloud';

type CloudLabel = StarLabel & { opacity: number };

type Command = {
  id: number;
  type: 'home' | 'in' | 'out' | 'left' | 'right' | 'up' | 'down';
};
type CloudProps = {
  works: Work[];
  matchingIds: Set<string>;
  selectedId?: string;
  onRead: (work: Work) => void;
  onDeselect: () => void;
  active?: boolean;
};
const vertex = `attribute vec3 color; attribute float size; attribute float match; attribute float starIndex;
uniform float uSelected; uniform float uHover; uniform float uDpr; uniform float uDiameter; uniform float uOverviewDistance;
varying vec3 vColor; varying float vAlpha;
void main(){
  float focus=step(abs(starIndex-uSelected),.1)+step(abs(starIndex-uHover),.1);
  vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
  gl_PointSize=clamp(uDiameter*size*uOverviewDistance/max(1.,-mv.z),4.,72.)*uDpr*(1.+min(focus,1.)*.35);
  vColor=mix(color,vec3(1.,.9,.65),min(focus,1.));vAlpha=mix(.065,.9,match);
}`;
const fragment = `varying vec3 vColor; varying float vAlpha;
void main(){vec2 p=gl_PointCoord*2.-1.;float d=dot(p,p);if(d>1.)discard;
float halo=exp(-d*12.);float core=exp(-d*38.);
gl_FragColor=vec4(vColor*(1.+core*.2),(halo*.13+core*.78)*vAlpha);}`;

function CloudScene({
  works,
  matchingIds,
  selectedId,
  onRead,
  onDeselect,
  paused,
  reduced,
  command,
  onLayout,
  onHover,
  labelHoverId,
}: CloudProps & {
  paused: boolean;
  reduced: boolean;
  command: Command;
  onLayout: (labels: CloudLabel[]) => void;
  onHover: (id: string | undefined) => void;
  labelHoverId?: string;
}) {
  const { camera, size, gl } = useThree();
  const controls = useRef<Controls>(null);
  const cloud = useMemo(() => buildCloud(works), [works]);
  const indices = useMemo(() => Float32Array.from(works, (_, i) => i), [works]);
  const matches = useMemo(
    () => Float32Array.from(works, (w) => (matchingIds.has(w.id) ? 1 : 0)),
    [works, matchingIds],
  );
  const projected = useMemo(
    () => new Float32Array(works.length * 3).fill(Infinity),
    [works],
  );
  const pickRadii = useMemo(
    () => new Float32Array(works.length).fill(12),
    [works],
  );
  const visualMatches = useMemo(
    () => new Float32Array(works.length).fill(1),
    [works],
  );
  const matchAttribute = useRef<THREE.BufferAttribute>(null);
  const filterMoving = useRef(true);
  useEffect(() => {
    filterMoving.current = true;
  }, [matches]);
  const flight = useRef<{
    position: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);
  const hover = useRef(-1),
    lastHover = useRef(-1),
    tick = useRef(0);
  const sticky = useRef<string[]>([]);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const down = useRef<{
    x: number;
    y: number;
    dragged: boolean;
    pointerId: number;
  } | null>(null);
  const zoomTarget = useRef<number | null>(null);
  const zoomOffset = useMemo(() => new THREE.Vector3(), []);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const uniforms = useMemo(
    () => ({
      uSelected: { value: -1 },
      uHover: { value: -1 },
      uDpr: { value: gl.getPixelRatio() },
      uDiameter: { value: cloud.diameter },
      uOverviewDistance: { value: 64 },
    }),
    [gl, cloud],
  );
  const home = () => {
    const distance =
      Math.max(8, cloud.radius * 2.6) / Math.min(1, size.width / size.height);
    const target = new THREE.Vector3().fromArray(cloud.center);
    uniforms.uOverviewDistance.value = distance;
    return {
      position: target
        .clone()
        .add(new THREE.Vector3(0, distance * 0.49, distance * 0.872)),
      target,
    };
  };
  useEffect(() => {
    const h = home();
    camera.position.copy(h.position);
    controls.current?.target.copy(h.target);
    controls.current?.update();
    flight.current = null;
    zoomTarget.current = null;
    sticky.current = [];
    onLayout([]);
    // New collections reset the camera; list pagination and filters never do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud]);
  useEffect(() => {
    const i = selectedId === undefined ? undefined : cloud.ids.get(selectedId);
    uniforms.uSelected.value = i ?? -1;
    if (i === undefined) {
      flight.current = null;
      return;
    }
    if (!controls.current) return;
    zoomTarget.current = null;
    const target = new THREE.Vector3().fromArray(cloud.positions, i * 3);
    const direction = camera.position
      .clone()
      .sub(controls.current.target)
      .normalize();
    flight.current = {
      target,
      position: target.clone().addScaledVector(direction, 10),
    };
  }, [selectedId, cloud, camera, uniforms]);
  useEffect(() => {
    const c = controls.current;
    if (!c || command.id === 0) return;
    zoomTarget.current = null;
    if (command.type === 'home') flight.current = home();
    else if (command.type === 'in' || command.type === 'out') {
      const target = c.target.clone(),
        delta = camera.position.clone().sub(target);
      delta.setLength(
        THREE.MathUtils.clamp(
          delta.length() * (command.type === 'in' ? 0.72 : 1.38),
          2,
          220,
        ),
      );
      flight.current = { target, position: target.clone().add(delta) };
    } else {
      const delta = new THREE.Vector3(
        command.type === 'left' ? -2 : command.type === 'right' ? 2 : 0,
        command.type === 'up' ? 2 : command.type === 'down' ? -2 : 0,
        0,
      ).applyQuaternion(camera.quaternion);
      flight.current = {
        target: c.target.clone().add(delta),
        position: camera.position.clone().add(delta),
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);
  useEffect(() => {
    const canvas = gl.domElement;
    const locate = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const move = (event: PointerEvent) => {
      const p = locate(event);
      pointer.current = p;
      if (down.current && !isCloudClick(down.current, p))
        down.current.dragged = true;
    };
    const start = (event: PointerEvent) => {
      if (!event.isPrimary) {
        down.current = null;
        return;
      }
      if (event.button !== 0) return;
      const p = locate(event);
      pointer.current = p;
      down.current = { ...p, dragged: false, pointerId: event.pointerId };
      flight.current = null;
      zoomTarget.current = null;
    };
    const end = (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerId !== down.current?.pointerId)
        return;
      const p = locate(event),
        initial = down.current;
      down.current = null;
      if (!initial || initial.dragged || !isCloudClick(initial, p)) return;
      const i = pickCloudStar(
        projected,
        matches,
        p.x,
        p.y,
        event.pointerType === 'touch' ? 28 : pickRadii,
      );
      if (i >= 0) onRead(works[i]);
      else onDeselect();
    };
    const preventMiddleAutoscroll = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };
    const leave = () => {
      pointer.current = null;
      down.current = null;
    };
    // Capture above both the canvas and floating labels, before OrbitControls'
    // immediate wheel dolly. Touch pinch remains handled by OrbitControls.
    const surface = canvas.closest('.poetry-cloud') ?? canvas;
    const wheel = (event: Event) => {
      const e = event as WheelEvent;
      const c = controls.current;
      if (!c || !e.deltaY) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      flight.current = null;
      zoomTarget.current = cloudWheelDistance(
        zoomTarget.current ?? camera.position.distanceTo(c.target),
        e.deltaY,
        e.deltaMode,
        canvas.clientHeight,
      );
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('pointercancel', leave);
    canvas.addEventListener('mousedown', preventMiddleAutoscroll);
    surface.addEventListener('wheel', wheel, { passive: false, capture: true });
    return () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerdown', start);
      canvas.removeEventListener('pointerup', end);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('pointercancel', leave);
      canvas.removeEventListener('mousedown', preventMiddleAutoscroll);
      surface.removeEventListener('wheel', wheel, true);
      canvas.style.cursor = '';
    };
  }, [gl, camera, works, matches, projected, pickRadii, onRead, onDeselect]);
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c || document.hidden) return;
    if (filterMoving.current) {
      const blend = reduced ? 1 : 1 - Math.exp(-Math.min(dt, 0.05) * 18);
      let moving = false;
      for (let i = 0; i < matches.length; i++) {
        visualMatches[i] += (matches[i] - visualMatches[i]) * blend;
        if (Math.abs(matches[i] - visualMatches[i]) < 0.002)
          visualMatches[i] = matches[i];
        else moving = true;
      }
      if (matchAttribute.current) matchAttribute.current.needsUpdate = true;
      filterMoving.current = moving;
    }
    // Reading and hover only emphasize a poem; they do not pause the orbit.
    // Camera flights integrate the same orbit while they own the camera.
    c.autoRotate = !paused && !reduced && !flight.current;
    c.autoRotateSpeed = 0.18 * Math.min(dt, 0.05) * 60;
    if (zoomTarget.current !== null) {
      zoomOffset.copy(camera.position).sub(c.target);
      const distance = smoothCloudDistance(
        zoomOffset.length(),
        zoomTarget.current,
        dt,
        reduced,
      );
      camera.position.copy(c.target).add(zoomOffset.setLength(distance));
      if (Math.abs(Math.log(distance / zoomTarget.current)) < 0.0001)
        zoomTarget.current = null;
    }
    if (flight.current) {
      if (!paused && !reduced) {
        flight.current.position
          .sub(flight.current.target)
          .applyAxisAngle(
            THREE.Object3D.DEFAULT_UP,
            -((Math.PI * 2) / 60) * 0.18 * Math.min(dt, 0.05),
          )
          .add(flight.current.target);
      }
      const t = reduced ? 1 : 1 - Math.exp(-Math.min(dt, 0.05) * 6);
      camera.position.lerp(flight.current.position, t);
      c.target.lerp(flight.current.target, t);
      if (
        camera.position.distanceTo(flight.current.position) < 0.025 &&
        c.target.distanceTo(flight.current.target) < 0.025
      ) {
        camera.position.copy(flight.current.position);
        c.target.copy(flight.current.target);
        flight.current = null;
      }
      c.update();
    }
    tick.current += dt;
    if (tick.current < 0.055) return;
    tick.current = 0;
    camera.updateMatrixWorld();
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const m = matrix.elements,
      positions = cloud.positions;
    for (let i = 0; i < works.length; i++) {
      const j = i * 3,
        x = positions[j],
        y = positions[j + 1],
        z = positions[j + 2];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      const diameter = THREE.MathUtils.clamp(
        (cloud.diameter * cloud.sizes[i] * uniforms.uOverviewDistance.value) /
          Math.max(1, w),
        4,
        72,
      );
      pickRadii[i] = Math.max(10, diameter * 0.5);
      const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
        ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      projected[j] = ((nx + 1) * size.width) / 2;
      projected[j + 1] = ((1 - ny) * size.height) / 2;
      projected[j + 2] =
        w <= 0 || Math.abs(nx) > 1 || Math.abs(ny) > 1
          ? Infinity
          : (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    }
    hover.current = labelHoverId
      ? (cloud.ids.get(labelHoverId) ?? -1)
      : pointer.current && !down.current?.dragged
        ? pickCloudStar(
            projected,
            matches,
            pointer.current.x,
            pointer.current.y,
            pickRadii,
          )
        : -1;
    uniforms.uHover.value = hover.current;
    if (hover.current !== lastHover.current) {
      lastHover.current = hover.current;
      onHover(works[hover.current]?.id);
    }
    gl.domElement.style.cursor = down.current?.dragged
      ? 'grabbing'
      : hover.current >= 0
        ? 'pointer'
        : 'grab';
    const zoom =
      uniforms.uOverviewDistance.value / camera.position.distanceTo(c.target);
    if (cloudLabelOpacity(zoom, 0) === 0) {
      if (sticky.current.length) {
        sticky.current = [];
        onLayout([]);
      }
      return;
    }
    const candidates: number[] = [];
    const add = (i: number | undefined) => {
      if (i !== undefined && i >= 0 && matches[i] && !candidates.includes(i))
        candidates.push(i);
    };
    add(selectedId ? cloud.ids.get(selectedId) : undefined);
    add(hover.current);
    for (const id of sticky.current) add(cloud.ids.get(id));
    for (let i = 0; i < works.length && candidates.length < 90; i++) {
      if (projected[i * 3 + 2] < -1 || projected[i * 3 + 2] > 1) continue;
      add(i);
    }
    const anchors = candidates
      .filter((i) => projected[i * 3 + 2] >= -1 && projected[i * 3 + 2] <= 1)
      .map((i) => ({
        id: works[i].id,
        x: projected[i * 3],
        y: projected[i * 3 + 1],
      }));
    const labels = layoutStarLabels(anchors, size.width, size.height)
      .labels.slice(0, size.width < 500 ? 4 : 7)
      .map((label, i) => ({ ...label, opacity: cloudLabelOpacity(zoom, i) }))
      .filter((label) => label.opacity > 0);
    sticky.current = labels.map((l) => l.id);
    onLayout(labels);
  });
  return (
    <>
      <points frustumCulled={false} raycast={() => {}}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[cloud.positions, 3]}
          />
          <bufferAttribute attach="attributes-color" args={[cloud.colors, 3]} />
          <bufferAttribute attach="attributes-size" args={[cloud.sizes, 1]} />
          <bufferAttribute
            ref={matchAttribute}
            attach="attributes-match"
            args={[visualMatches, 1]}
          />
          <bufferAttribute attach="attributes-starIndex" args={[indices, 1]} />
        </bufferGeometry>
        <shaderMaterial
          key={fragment}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          vertexShader={vertex}
          fragmentShader={fragment}
        />
      </points>
      <OrbitControls
        ref={controls}
        enablePan
        mouseButtons={{
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.ROTATE,
          RIGHT: THREE.MOUSE.PAN,
        }}
        enableDamping
        dampingFactor={0.08}
        autoRotateSpeed={0.18}
        zoomSpeed={1.2}
        minDistance={2}
        maxDistance={220}
        minPolarAngle={0.08}
        maxPolarAngle={Math.PI - 0.08}
        onStart={() => {
          flight.current = null;
          zoomTarget.current = null;
        }}
      />
    </>
  );
}

export default function PoetryNebula({
  works,
  matchingIds,
  selectedId,
  onRead,
  onDeselect,
  active = true,
}: CloudProps) {
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false),
    [labels, setLabels] = useState<CloudLabel[]>([]);
  const [hoverId, setHoverId] = useState<string>();
  const [labelHoverId, setLabelHoverId] = useState<string>();
  const [command, setCommand] = useState<Command>({ id: 0, type: 'home' });
  const index = useMemo(() => new Map(works.map((w) => [w.id, w])), [works]);
  const act = (type: Command['type']) =>
    setCommand((c) => ({ id: c.id + 1, type }));
  const randomPoem = () => {
    const candidates = works.filter((w) => matchingIds.has(w.id));
    if (candidates.length)
      onRead(candidates[Math.floor(Math.random() * candidates.length)]);
  };
  return (
    <div
      className={
        'nebula-scene poetry-cloud' +
        (paused || reduced || !active ? ' motion-paused' : '')
      }
      data-star-count={works.length}
      data-matching-count={matchingIds.size}
      data-selected-star={selectedId ?? ''}
      tabIndex={0}
      aria-label="完整诗词星云，左键拖动平移，按住滚轮拖动旋转，滚轮缩放，单击空白取消选中；方向键平移，加减键缩放，Home查看全云"
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const key: Record<string, Command['type']> = {
          ArrowLeft: 'left',
          ArrowRight: 'right',
          ArrowUp: 'up',
          ArrowDown: 'down',
          '+': 'in',
          '=': 'in',
          '-': 'out',
          Home: 'home',
        };
        if (key[event.key]) {
          event.preventDefault();
          act(key[event.key]);
        }
      }}
    >
      <div className="nebula-wash" aria-hidden="true" />
      <Canvas
        frameloop={active ? 'always' : 'never'}
        camera={{ position: [0, 32, 56], fov: 50, near: 0.1, far: 600 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
        fallback={<p>星云暂时无法显示，请从作品列表阅读全部诗词。</p>}
      >
        <CloudScene
          works={works}
          matchingIds={matchingIds}
          selectedId={selectedId}
          onRead={onRead}
          onDeselect={onDeselect}
          paused={paused}
          reduced={reduced}
          command={command}
          onLayout={setLabels}
          onHover={setHoverId}
          labelHoverId={labelHoverId}
        />
      </Canvas>
      <div className="star-titles" aria-label="整片星云中的可见诗词题名">
        {labels.map((l) => {
          const w = index.get(l.id);
          return (
            w && (
              <button
                key={w.id}
                className={
                  'star-label compact-star cloud-title' +
                  (w.id === selectedId || w.id === hoverId ? ' is-focused' : '')
                }
                style={{
                  transform: `translate3d(${l.left}px,${l.top}px,0)`,
                  width: l.width,
                  height: l.height,
                  opacity: l.opacity,
                  pointerEvents: l.opacity < 0.15 ? 'none' : 'auto',
                }}
                tabIndex={l.opacity < 0.15 ? -1 : 0}
                aria-hidden={l.opacity < 0.15}
                aria-label={`${w.title} · ${w.author}`}
                aria-pressed={w.id === selectedId}
                title={`${w.title} · ${w.author} · ${w.dynasty}`}
                onClick={() => onRead(w)}
                onMouseEnter={() => setLabelHoverId(w.id)}
                onMouseLeave={() => setLabelHoverId(undefined)}
                onFocus={() => setLabelHoverId(w.id)}
                onBlur={() => setLabelHoverId(undefined)}
              >
                <span>{w.title}</span>
                <small>
                  {w.author} · {w.dynasty}
                </small>
              </button>
            )
          );
        })}
      </div>
      <div className="cloud-toolbar" aria-label="星云漫游工具">
        <button
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused || reduced}
          disabled={reduced}
        >
          {reduced ? '已减少动态' : paused ? '继续漫游' : '暂停漫游'}
        </button>
        <button onClick={() => act('home')}>查看全云</button>
        <button onClick={randomPoem} disabled={!matchingIds.size}>
          邂逅一首
        </button>
      </div>
      <div className="cloud-zoom" aria-label="星云缩放">
        <button aria-label="放大星云" onClick={() => act('in')}>
          ＋
        </button>
        <button aria-label="缩小星云" onClick={() => act('out')}>
          −
        </button>
      </div>
      <div className="cloud-caption">
        <span>{works.length.toLocaleString()} 首 · 同在一片星云</span>
        <small>
          {matchingIds.size < works.length
            ? `${matchingIds.size.toLocaleString()} 首匹配作品已点亮，其余保留为暗星`
            : '一星一首诗 · 放大后显示诗词题名'}
        </small>
      </div>
    </div>
  );
}
