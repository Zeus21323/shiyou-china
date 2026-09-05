'use client';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Edges, Html } from '@react-three/drei';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
type Point = [number, number];
export type Province = {
  properties: { name: string; adcode: number | string; center?: Point };
  geometry: { type: string; coordinates: number[][][][] | number[][][] };
};
const project = ([lon, lat]: number[]): Point => [
  (lon - 104) * 0.75,
  (lat - 35) * 0.95,
];
function ProvinceMesh({
  feature,
  selected,
  onSelect,
}: {
  feature: Province;
  selected: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const shapes = useMemo(() => {
    const polygons =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    return (polygons as number[][][][])
      .filter((p) => p[0]?.length >= 3)
      .map((polygon) => {
        const shape = new THREE.Shape(
          polygon[0].map((p) => new THREE.Vector2(...project(p))),
        );
        polygon
          .slice(1)
          .forEach((ring) =>
            shape.holes.push(
              new THREE.Path(ring.map((p) => new THREE.Vector2(...project(p)))),
            ),
          );
        return shape;
      });
  }, [feature]);
  const geometry = useMemo(
    () =>
      new THREE.ExtrudeGeometry(shapes, { depth: 0.36, bevelEnabled: false }),
    [shapes],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const decorative = !feature.properties.name;
  return (
    <mesh
      geometry={geometry}
      position={[0, 0, selected ? 0.25 : 0]}
      onPointerOver={
        decorative
          ? undefined
          : (e) => {
              e.stopPropagation();
              setHovered(true);
            }
      }
      onPointerOut={() => setHovered(false)}
      onClick={
        decorative
          ? undefined
          : (e) => {
              e.stopPropagation();
              onSelect();
            }
      }
    >
      <meshStandardMaterial
        color={
          selected
            ? '#d5b974'
            : hovered
              ? '#60aaa5'
              : feature.properties.adcode === 330000
                ? '#439990'
                : '#254f54'
        }
        roughness={0.65}
        metalness={0.25}
      />
      <Edges threshold={25} color={selected ? '#ffe5a0' : '#5f9797'} />
      {hovered && feature.properties.center && (
        <Html
          position={[...project(feature.properties.center), 0.7]}
          center
          style={{
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            color: '#ffe5a0',
          }}
        >
          {feature.properties.name}
        </Html>
      )}
    </mesh>
  );
}
function View({
  selected,
  provinces,
}: {
  selected: Province | null;
  provinces: Province[];
}) {
  const { camera, size } = useThree();
  const bounds = useMemo(() => {
    const points = (selected ? [selected] : provinces)
      .flatMap(
        (p) =>
          (p.geometry.type === 'Polygon'
            ? [p.geometry.coordinates]
            : p.geometry.coordinates) as number[][][][],
      )
      .flat(2)
      .map(project);
    const box = new THREE.Box2();
    points.forEach((p) => box.expandByPoint(new THREE.Vector2(...p)));
    return box;
  }, [selected, provinces]);
  const center = bounds.isEmpty()
    ? new THREE.Vector2(0, -4)
    : bounds.getCenter(new THREE.Vector2());
  const target: [number, number, number] = [center.x, center.y, 0];
  useEffect(() => {
    const span = bounds.getSize(new THREE.Vector2());
    const aspect = size.width / size.height;
    const distance = Math.max(8, span.y, span.x / aspect) * 1.8;
    camera.position.set(center.x, center.y - distance * 0.35, distance);
    camera.lookAt(center.x, center.y, 0);
    camera.updateProjectionMatrix();
  }, [camera, bounds, size.width, size.height, center.x, center.y]);
  return (
    <OrbitControls
      key={selected?.properties.adcode ?? 'all'}
      target={target}
      minDistance={2}
      maxDistance={180}
      maxPolarAngle={Math.PI * 0.48}
      enableDamping
    />
  );
}
export default function ChinaMap({
  provinces,
  selected,
  onSelect,
}: {
  provinces: Province[];
  selected: Province | null;
  onSelect: (p: Province) => void;
}) {
  return (
    <Canvas
      camera={{ position: [0, -28, 43], fov: 43, up: [0, 1, 0] }}
      dpr={[1, 1.5]}
      fallback={<p>当前设备不支持三维地图，请通过省份列表探索。</p>}
    >
      <color attach="background" args={['#071d25']} />
      <ambientLight intensity={1.3} />
      <directionalLight position={[-15, 10, 30]} intensity={2.3} />
      <pointLight position={[20, -10, 10]} color="#78cdc4" intensity={60} />
      {provinces.map((feature) => (
        <ProvinceMesh
          key={feature.properties.adcode}
          feature={feature}
          selected={selected?.properties.adcode === feature.properties.adcode}
          onSelect={() => onSelect(feature)}
        />
      ))}
      <View selected={selected} provinces={provinces} />
    </Canvas>
  );
}
