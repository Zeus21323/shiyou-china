'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import manifest from '../public/data/terrain/manifest.json';
import relief from '../public/data/terrain/relief.json';
import chinaHeights from '../public/data/terrain/china-elevation.json';
import {
  elevationAt,
  HEIGHT_SCALE,
  type ElevationGrid,
} from '../lib/terrain-height';
import { provincePolygons } from '../lib/province-view';
import { useReducedMotion } from '../lib/use-motion-preference';
import type { Province } from './china-map';
import { ResourceCache } from '../lib/resource-cache';

type Region = {
  texture: string;
  elevation: string;
  mesh: string;
  vertexCount: number;
};
const regions = (manifest as unknown as { provinces: Record<string, Region> })
  .provinces;
type Detail = {
  geometry: THREE.BufferGeometry;
  texture: THREE.Texture;
  grid: ElevationGrid;
  blend: { value: number };
  release?: () => void;
};
// Only mounted detail resources are held here. Release them after the return transition.
const liveDetails = new Map<string, Detail>();
export const provinceTerrainBlend = (code?: number | string) =>
  liveDetails.get(String(code))?.blend.value ?? 0;
export function provinceTerrainHeight(
  code: number | string | undefined,
  point: number[],
) {
  const base = Math.max(0, elevationAt(chinaHeights, point[0], point[1]));
  const detail = liveDetails.get(String(code));
  return detail
    ? THREE.MathUtils.lerp(
        base,
        Math.max(0, elevationAt(detail.grid, point[0], point[1])),
        detail.blend.value,
      )
    : base;
}
const meshBuffers = new WeakMap<
  ArrayBuffer,
  { data: THREE.InterleavedBuffer; index: THREE.BufferAttribute }
>();
function geometryFrom(
  buffer: ArrayBuffer,
  vertexCount: number,
  shared = false,
) {
  let buffers = shared ? meshBuffers.get(buffer) : undefined;
  if (!buffers) {
    buffers = {
      data: new THREE.InterleavedBuffer(
        new Float32Array(buffer, 0, vertexCount * 8),
        8,
      ),
      index: new THREE.BufferAttribute(
        new Uint32Array(buffer, vertexCount * 32),
        1,
      ),
    };
    if (shared) meshBuffers.set(buffer, buffers);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.InterleavedBufferAttribute(buffers.data, 3, 0),
  );
  geometry.setAttribute(
    'normal',
    new THREE.InterleavedBufferAttribute(buffers.data, 3, 3),
  );
  geometry.setAttribute(
    'uv',
    new THREE.InterleavedBufferAttribute(buffers.data, 2, 6),
  );
  geometry.setIndex(buffers.index);
  return geometry;
}
async function loadDetail(code: string, signal: AbortSignal): Promise<Detail> {
  const region = regions[code];
  const read = async (name: string) => {
    const response = await fetch(`/data/terrain/${name}`, { signal });
    if (!response.ok) throw Error('省级地形资源读取失败');
    return response;
  };
  const results = await Promise.allSettled([
    read(region.mesh).then((r) => r.arrayBuffer()),
    read(region.elevation).then((r) => r.json() as Promise<ElevationGrid>),
    new THREE.TextureLoader().loadAsync(`/data/terrain/${region.texture}`),
  ] as const);
  const [mesh, grid, image] = results;
  if (
    signal.aborted ||
    mesh.status === 'rejected' ||
    grid.status === 'rejected' ||
    image.status === 'rejected'
  ) {
    if (image.status === 'fulfilled') image.value.dispose();
    throw Error('省级地形未完成读取');
  }
  const geometry = geometryFrom(mesh.value, region.vertexCount);
  const finePosition = geometry.getAttribute('position');
  const fineNormal = geometry.getAttribute('normal');
  const base = new Float32Array(region.vertexCount * 3);
  const uv = new Float32Array(region.vertexCount * 2);
  const [w, s, e, n] = manifest.china.bounds;
  for (let i = 0; i < region.vertexCount; i++) {
    const x = finePosition.getX(i),
      y = finePosition.getY(i);
    const lon = x / 0.75 + 104,
      lat = y / 0.95 + 35;
    base.set(
      [
        x,
        y,
        Math.max(0, elevationAt(chinaHeights, lon, lat)) * HEIGHT_SCALE + 0.025,
      ],
      i * 3,
    );
    uv.set([(lon - w) / (e - w), (lat - s) / (n - s)], i * 2);
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(base, 3));
  geometry.deleteAttribute('normal');
  geometry.computeVertexNormals();
  geometry.setAttribute('nationalUv', new THREE.BufferAttribute(uv, 2));
  geometry.morphAttributes.position = [finePosition];
  geometry.morphAttributes.normal = [fineNormal];
  return {
    geometry,
    grid: grid.value,
    texture: image.value,
    blend: { value: 0 },
  };
}
export type TerrainStatus = 'loading' | 'ready' | 'error';
const detailCache = new ResourceCache<Detail>(6, loadDetail, (asset) => {
  asset.geometry.dispose();
  asset.texture.dispose();
});
const initializedTextures = new WeakSet<THREE.Texture>();
function initializeTexture(texture: THREE.Texture, gl: THREE.WebGLRenderer) {
  if (initializedTextures.has(texture)) return;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  gl.initTexture(texture);
  initializedTextures.add(texture);
}
export function warmProvinceTexture(
  code: string | number,
  gl: THREE.WebGLRenderer,
) {
  const detail = detailCache.peek(String(code));
  if (detail) initializeTexture(detail.texture, gl);
}
export function prefetchProvinceTerrain(code: string | number) {
  if (regions[String(code)]) detailCache.prefetch(String(code));
}
export const ProvinceShape = memo(function ProvinceShape({
  feature,
  active,
  muted,
  onSelect,
  meshData,
  onStatus,
}: {
  feature: Province;
  active: boolean;
  muted: boolean;
  onSelect: (p: Province) => void;
  meshData: ArrayBuffer;
  onStatus: (code: string, status: TerrainStatus) => void;
}) {
  const code = String(feature.properties.adcode);
  const nationalTexture = useTexture(`/data/terrain/${manifest.china.texture}`);
  const { gl } = useThree();
  const reduced = useReducedMotion();
  const [detail, setDetail] = useState<Detail | null>(null);
  const releaseQueued = useRef(false);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const activeColor = useMemo(() => new THREE.Color('#fff9dc'), []);
  const baseColor = useMemo(() => new THREE.Color('#e1e9df'), []);
  const borderColor = useMemo(() => new THREE.Color('#a77c30'), []);
  const focusBlend = useRef(0);
  useEffect(() => {
    for (const texture of [nationalTexture, detail?.texture])
      if (texture) initializeTexture(texture, gl);
  }, [nationalTexture, detail, gl]);
  useEffect(() => {
    if (!active || detail || !regions[code]) return;
    const lease = detailCache.acquire(code);
    let cancelled = false,
      accepted = false;
    onStatus(code, 'loading');
    lease.promise
      .then((asset) => {
        if (cancelled) return;
        accepted = true;
        const current = {
          ...asset,
          blend: { value: 0 },
          release: lease.release,
        };
        releaseQueued.current = false;
        liveDetails.set(code, current);
        setDetail(current);
        onStatus(code, 'ready');
      })
      .catch(() => {
        if (!cancelled) {
          onStatus(code, 'error');
        }
      });
    return () => {
      cancelled = true;
      if (!accepted) lease.release();
    };
  }, [code, active, detail, onStatus]);
  useEffect(
    () => () => {
      if (detail) {
        if (liveDetails.get(code) === detail) liveDetails.delete(code);
        detail.release?.();
      }
    },
    [code, detail],
  );
  const baseGeometry = useMemo(() => {
    const g = geometryFrom(meshData, relief.vertexCount, true);
    const part = relief.features[code as keyof typeof relief.features];
    g.setDrawRange(part.start, part.count);
    return g;
  }, [meshData, code]);
  const outline = useMemo(() => {
    const values: number[] = [],
      fine: number[] = [];
    for (const polygon of provincePolygons(feature))
      for (const ring of polygon)
        for (let i = 1; i < ring.length; i++)
          for (const p of [ring[i - 1], ring[i]]) {
            const x = (p[0] - 104) * 0.75,
              y = (p[1] - 35) * 0.95;
            values.push(
              x,
              y,
              Math.max(0, elevationAt(chinaHeights, p[0], p[1])) *
                HEIGHT_SCALE +
                0.033,
            );
            if (detail)
              fine.push(
                x,
                y,
                Math.max(0, elevationAt(detail.grid, p[0], p[1])) *
                  HEIGHT_SCALE +
                  0.033,
              );
          }
    const geometry = new LineSegmentsGeometry().setPositions(values);
    const material = new LineMaterial({
      color: '#000000',
      linewidth: 1.6,
      transparent: true,
      opacity: 1,
      dashed: false,
      depthWrite: false,
      depthTest: false,
    });
    const line = new LineSegments2(geometry, material);
    line.renderOrder = 10;
    line.frustumCulled = false;
    line.raycast = () => {};
    return { line, values, fine, blend: -1 };
  }, [feature, detail]);
  useEffect(() => () => baseGeometry.dispose(), [baseGeometry]);
  useEffect(
    () => () => {
      outline.line.geometry.dispose();
      outline.line.material.dispose();
    },
    [outline],
  );
  const detailedMaterial = useMemo(() => {
    if (!detail) return null;
    const m = new THREE.MeshStandardMaterial({
      map: detail.texture,
      roughness: 1,
      transparent: true,
      color: material.current?.color ?? baseColor,
      opacity: material.current?.opacity ?? 1,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.terrainBlend = detail.blend;
      shader.uniforms.nationalMap = { value: nationalTexture };
      shader.vertexShader =
        'attribute vec2 nationalUv; varying vec2 vNationalUv;\n' +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\nvNationalUv = nationalUv;',
      );
      shader.fragmentShader =
        'uniform sampler2D nationalMap; uniform float terrainBlend; varying vec2 vNationalUv;\n' +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        #ifdef USE_MAP
          diffuseColor *= mix(texture2D(nationalMap, vNationalUv), texture2D(map, vMapUv), terrainBlend);
        #endif
      `,
      );
    };
    m.customProgramCacheKey = () => 'province-terrain-blend-v1';
    return m;
  }, [detail, nationalTexture]);
  useEffect(() => () => detailedMaterial?.dispose(), [detailedMaterial]);
  useFrame(({ size }, dt) => {
    if (detail) {
      const target = active ? 1 : 0;
      detail.blend.value = reduced
        ? target
        : THREE.MathUtils.damp(
            detail.blend.value,
            target,
            18,
            Math.min(dt, 0.05),
          );
      if (mesh.current?.morphTargetInfluences)
        mesh.current.morphTargetInfluences[0] = detail.blend.value;
      if (Math.abs(outline.blend - detail.blend.value) > 0.0001) {
        const positions = outline.line.geometry.attributes
          .instanceStart as THREE.InterleavedBufferAttribute;
        const array = positions.data.array;
        for (let i = 2; i < outline.values.length; i += 3)
          array[i] = THREE.MathUtils.lerp(
            outline.values[i],
            outline.fine[i],
            detail.blend.value,
          );
        positions.data.needsUpdate = true;
        outline.blend = detail.blend.value;
      }
      if (!active && detail.blend.value < 0.002 && !releaseQueued.current) {
        releaseQueued.current = true;
        setDetail(null);
      }
    }
    const mat = detailedMaterial ?? material.current;
    // 高亮只属于当前省份，旧省份的地形退场不能再次点亮旧省界。
    focusBlend.current = active
      ? reduced
        ? 1
        : THREE.MathUtils.damp(focusBlend.current, 1, 28, Math.min(dt, 0.05))
      : 0;
    const emphasis = focusBlend.current;
    if (mat) {
      const t = reduced ? 1 : 1 - Math.exp(-8 * dt);
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, muted ? 0.82 : 1, t);
      mat.color.copy(baseColor).lerp(activeColor, emphasis);
      mat.depthWrite = true;
    }
    const border = outline.line.material;
    outline.line.renderOrder = active ? 11 : 10;
    if (border) {
      border.color.set('#000000').lerp(borderColor, emphasis);
      border.opacity = 1;
      border.linewidth = 1.6 + 0.8 * emphasis;
      border.resolution.set(size.width, size.height);
    }
  });
  return (
    <group>
      <mesh
        key={detail ? 'detail' : 'base'}
        ref={mesh}
        args={[detail?.geometry ?? baseGeometry]}
        frustumCulled={false}
        onPointerEnter={() => prefetchProvinceTerrain(code)}
        onClick={(e) => {
          e.stopPropagation();
          if (e.delta < 5 && feature.properties.name && !active)
            onSelect(feature);
        }}
      >
        {detailedMaterial ? (
          <primitive object={detailedMaterial} attach="material" />
        ) : (
          <meshStandardMaterial
            ref={material}
            map={nationalTexture}
            transparent
            depthWrite
            color={baseColor}
            roughness={1}
            metalness={0}
          />
        )}
      </mesh>
      <primitive object={outline.line} />
    </group>
  );
});
