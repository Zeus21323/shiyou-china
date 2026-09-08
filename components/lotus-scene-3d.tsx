'use client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, useGLTF } from '@react-three/drei';
import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { OrbitControls as Controls } from 'three-stdlib';
import type { Work } from '../lib/content';
import { MoonSky, LotusLeaves } from './pond-garden';
import { FISH_COUNT, samplePondFish, applyFishWakes } from '../lib/pond-life';
import {
  createLanternBatch,
  LOTUS_MODEL_URL,
  LOTUS_LITE_URL,
} from '../lib/lotus-glb';
import {
  pondVertexShader,
  pondFragmentShader,
} from '../lib/lotus-water-shader';
import {
  createLotusBodies,
  stepLotusBodies,
  clearLotusSpace,
} from '../lib/lotus-water';

function Water({
  time,
  pulse,
}: {
  time: { current: number };
  pulse: THREE.Vector3;
}) {
  const { gl } = useThree();
  const water = useMemo(() => {
    const mirror = new Reflector(new THREE.PlaneGeometry(900, 900, 160, 160), {
      textureWidth: 1024,
      textureHeight: 1024,
      color: 0x779a9d,
      clipBias: 0.003,
    });
    mirror.rotation.x = -Math.PI / 2;
    const m = mirror.material as THREE.ShaderMaterial;
    m.uniforms.waterTime = { value: 0 };
    m.uniforms.pulse = { value: new THREE.Vector3() };
    m.uniforms.pondFish = {
      value: Array.from({ length: FISH_COUNT }, () => new THREE.Vector4()),
    };
    m.vertexShader = pondVertexShader;
    m.fragmentShader = pondFragmentShader;
    return mirror;
  }, []);
  useEffect(
    () => () => {
      water.geometry.dispose();
      (water.material as THREE.Material).dispose();
      water.getRenderTarget().dispose();
    },
    [water],
  );
  useFrame(() => {
    const m = water.material as THREE.ShaderMaterial;
    m.uniforms.waterTime.value = time.current;
    m.uniforms.pulse.value.copy(pulse);
    for (let i = 0; i < FISH_COUNT; i++) {
      const fish = samplePondFish(time.current, i);
      m.uniforms.pondFish.value[i].set(
        fish.x,
        fish.z,
        fish.heading,
        fish.phase,
      );
    }
  });
  // Keep the render target within the device's supported allocation.
  useEffect(() => {
    water.getRenderTarget().texture.anisotropy = Math.min(
      4,
      gl.capabilities.getMaxAnisotropy(),
    );
  }, [gl, water]);
  return <primitive object={water} />;
}

function Pond({
  works,
  selectedId,
  onRead,
  onDeselect,
  paused,
  reduced,
  zoomCommand,
}: {
  works: Work[];
  selectedId?: string;
  onRead: (w: Work) => void;
  onDeselect: () => void;
  paused: boolean;
  reduced: boolean;
  zoomCommand?: { id: number; direction: number };
}) {
  const { camera, gl, size, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04);
    scene.environment = env.texture;
    room.dispose();
    pmrem.dispose();
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [gl, scene]);
  const bodies = useMemo(() => createLotusBodies(works.length), [works]);
  const fullAsset = useGLTF(LOTUS_MODEL_URL);
  const liteAsset = useGLTF(LOTUS_LITE_URL);
  const full = useMemo(
    () => createLanternBatch(fullAsset, bodies.length),
    [fullAsset, bodies.length],
  );
  const lite = useMemo(
    () => createLanternBatch(liteAsset, bodies.length),
    [liteAsset, bodies.length],
  );
  useEffect(
    () => () => {
      full.dispose();
      lite.dispose();
    },
    [full, lite],
  );
  const controls = useRef<Controls>(null);
  const light = useRef<THREE.PointLight>(null);
  const time = useRef(0),
    transition = useRef(0),
    previous = useRef<string | undefined>(undefined);
  const saved = useRef({
    position: new THREE.Vector3(0, 8, 26),
    target: new THREE.Vector3(),
  });
  const pulse = useMemo(() => new THREE.Vector3(10000, 10000, -100), []);
  const blooms = useMemo(() => new Float32Array(bodies.length), [bodies]);
  const zoomTarget = useRef<number | null>(null);
  const selectedZoom = useRef(1);
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const projection = useMemo(() => new THREE.Matrix4(), []);
  const sphere = useMemo(() => new THREE.Sphere(new THREE.Vector3(), 3), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const appliedZoomCommand = useRef<number | undefined>(undefined);
  const selectedIndex = works.findIndex((w) => w.id === selectedId);
  useEffect(() => {
    if (previous.current === selectedId) return;
    if (selectedId && !previous.current) {
      saved.current.position.copy(camera.position);
      if (controls.current) saved.current.target.copy(controls.current.target);
    }
    previous.current = selectedId;
    transition.current = 1;
    selectedZoom.current = 1;
    zoomTarget.current = null;
    if (selectedIndex >= 0) {
      const b = bodies[selectedIndex];
      pulse.set(b.x / 25, b.y / 25, time.current);
    }
  }, [selectedId, selectedIndex, bodies, camera, pulse]);
  useEffect(() => {
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const dy =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
      const factor = Math.exp(Math.max(-180, Math.min(180, dy)) * 0.002);
      if (selectedId)
        selectedZoom.current = THREE.MathUtils.clamp(
          selectedZoom.current * factor,
          0.6,
          2.8,
        );
      else {
        transition.current = 0;
        const distance = camera.position.distanceTo(
          controls.current?.target ?? new THREE.Vector3(),
        );
        zoomTarget.current = THREE.MathUtils.clamp(
          (zoomTarget.current ?? distance) * factor,
          4,
          220,
        );
      }
    };
    const el = gl.domElement;
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [gl, camera, size.height, selectedId]);
  useEffect(() => {
    if (!zoomCommand || appliedZoomCommand.current === zoomCommand.id) return;
    appliedZoomCommand.current = zoomCommand.id;
    const factor = zoomCommand.direction > 0 ? 1 / 1.5 : 1.5;
    if (selectedId)
      selectedZoom.current = THREE.MathUtils.clamp(
        selectedZoom.current * factor,
        0.6,
        2.8,
      );
    else {
      transition.current = 0;
      zoomTarget.current = THREE.MathUtils.clamp(
        (zoomTarget.current ??
          camera.position.distanceTo(
            controls.current?.target ?? new THREE.Vector3(),
          )) * factor,
        4,
        220,
      );
    }
  }, [zoomCommand, camera, selectedId]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.04);
    if (!paused && !reduced) {
      time.current += dt;
      applyFishWakes(bodies, time.current, dt, selectedIndex);
      stepLotusBodies(bodies, time.current, dt);
    }
    const chosen = selectedIndex >= 0 ? bodies[selectedIndex] : null;
    for (let i = 0; i < blooms.length; i++)
      blooms[i] = reduced
        ? i === selectedIndex
          ? 1
          : 0
        : THREE.MathUtils.damp(blooms[i], i === selectedIndex ? 1 : 0, 1.8, dt);
    if (chosen) clearLotusSpace(bodies, selectedIndex, dt, reduced);
    if (controls.current && (chosen || transition.current > 0)) {
      const target = chosen
        ? new THREE.Vector3(chosen.x / 25, -1.1, chosen.y / 25)
        : saved.current.target;
      const distance =
        Math.max(7.8, 8 / (size.width / size.height)) * selectedZoom.current;
      const pos = chosen
        ? new THREE.Vector3(target.x, distance * 0.42, target.z + distance)
        : saved.current.position;
      const ease = reduced ? 1 : 1 - Math.exp(-dt * (chosen ? 6 : 3));
      camera.position.lerp(pos, ease);
      controls.current.target.lerp(target, ease);
      controls.current.update();
      if (!chosen && camera.position.distanceTo(pos) < 0.02)
        transition.current = 0;
    }
    if (!chosen && zoomTarget.current !== null && controls.current) {
      const offset = camera.position.clone().sub(controls.current.target),
        distance = offset.length();
      const next = reduced
        ? zoomTarget.current
        : THREE.MathUtils.damp(distance, zoomTarget.current, 10, dt);
      camera.position
        .copy(controls.current.target)
        .add(offset.multiplyScalar(next / Math.max(0.001, distance)));
      controls.current.update();
      if (Math.abs(next - zoomTarget.current) < 0.005)
        zoomTarget.current = null;
    }
    if (light.current) {
      light.current.visible = !!chosen;
      if (chosen) light.current.position.set(chosen.x / 25, 1.5, chosen.y / 25);
    }
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(
      projection.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
    );
    full.indices = [];
    lite.indices = [];
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i],
        lit = i < works.length,
        focus = i === selectedIndex;
      sphere.center.set(b.x / 25, 0.5, b.y / 25);
      if (!focus && !frustum.intersectsSphere(sphere)) continue;
      const batch = focus ? full : lite;
      const slot = batch.indices.length;
      batch.indices.push(i);
      const bob = Math.sin(time.current * 1.3 + b.phase) * 0.025;
      dummy.position.set(b.x / 25, bob - 0.018, b.y / 25);
      dummy.rotation.set(0, b.phase, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      batch.set(
        slot,
        dummy.matrix,
        blooms[i],
        lit,
        reduced ? 0 : time.current + b.phase,
      );
    }
    full.flush(full.indices.length);
    lite.flush(lite.indices.length);
    gl.domElement.dataset.lotusCount = String(bodies.length);
    gl.domElement.dataset.litCount = String(works.length);
    gl.domElement.dataset.cameraDistance = controls.current
      ? camera.position.distanceTo(controls.current.target).toFixed(2)
      : '';
  });
  return (
    <>
      <color attach="background" args={['#243e54']} />
      <MoonSky />
      <fog attach="fog" args={['#243e54', 24, 85]} />
      <hemisphereLight args={['#caddea', '#152b38', 0.75]} />
      <directionalLight
        position={[-6, 12, -8]}
        intensity={1.3}
        color="#fff1dc"
      />
      <directionalLight
        position={[2, 8, 12]}
        intensity={0.65}
        color="#dce8ff"
      />
      <pointLight
        ref={light}
        color="#ffc174"
        intensity={1.2}
        distance={9}
        decay={2}
      />
      <Water time={time} pulse={pulse} />
      <LotusLeaves time={time} bodies={bodies} />
      {[full, lite].flatMap((batch, batchIndex) =>
        batch.parts.map(({ mesh }, index) => (
          <primitive
            key={batchIndex + ':' + index}
            object={mesh}
            dispose={null}
            onClick={(
              e: import('@react-three/fiber').ThreeEvent<MouseEvent>,
            ) => {
              e.stopPropagation();
              if (e.delta > 5) return;
              const i = batch.indices[e.instanceId ?? -1];
              if (works[i]) onRead(works[i]);
            }}
          />
        )),
      )}
      <OrbitControls
        ref={controls}
        enableRotate={!selectedId}
        enablePan={!selectedId}
        enableZoom={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={4}
        maxDistance={220}
        maxPolarAngle={Math.PI * 0.47}
        minPolarAngle={0.25}
        mouseButtons={{
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.ROTATE,
          RIGHT: THREE.MOUSE.ROTATE,
        }}
      />
    </>
  );
}
class ModelBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div role="alert" style={{ padding: 24, color: '#fff4de' }}>
          <p>莲花灯模型加载失败，仍可从右侧目录阅读诗文。</p>
          <button
            onClick={() => {
              useGLTF.clear(LOTUS_MODEL_URL);
              useGLTF.clear(LOTUS_LITE_URL);
              this.setState({ failed: false });
            }}
          >
            重新加载莲花灯
          </button>
        </div>
      );
    return this.props.children;
  }
}

export default function LotusScene3D(props: {
  works: Work[];
  selectedId?: string;
  onRead: (w: Work) => void;
  onDeselect: () => void;
  paused: boolean;
  reduced: boolean;
  active: boolean;
  zoomCommand?: { id: number; direction: number };
}) {
  return (
    <ModelBoundary>
      <Canvas
        camera={{ position: [0, 8, 26], fov: 43, near: 0.1, far: 2000 }}
        dpr={[1, 1.5]}
        frameloop={props.active ? 'always' : 'never'}
        gl={{ antialias: true }}
        onPointerMissed={(e) => {
          if (e.button === 0) props.onDeselect();
        }}
        fallback={<p>三维水面暂时不可用，可从右侧作品列表阅读。</p>}
      >
        <Suspense
          fallback={
            <Html center>
              <p
                style={{ color: '#fff4de', whiteSpace: 'nowrap' }}
                role="status"
              >
                正在加载莲花灯…
              </p>
            </Html>
          }
        >
          <Pond {...props} />
        </Suspense>
      </Canvas>
    </ModelBoundary>
  );
}
