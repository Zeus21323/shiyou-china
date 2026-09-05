'use client';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import { useMemo } from 'react';
import type { Work } from '../lib/content';
import * as THREE from 'three';
function Dust() {
  const positions = useMemo(() => {
    let seed = 2409;
    const rand = () =>
      (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const p = new Float32Array(1800 * 3);
    for (let i = 0; i < 1800; i++) {
      const radius = Math.sqrt(rand()) * 7,
        angle = radius * 1.2 + ((i % 3) * Math.PI * 2) / 3 + rand() * 0.5;
      p[i * 3] = Math.cos(angle) * radius;
      p[i * 3 + 1] = (rand() - 0.5) * (1 - radius / 9);
      p[i * 3 + 2] = Math.sin(angle) * radius;
    }
    return p;
  }, []);
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.035}
        color="#89c6cc"
        transparent
        opacity={0.65}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
export default function PoetryNebula({
  works,
  onRead,
}: {
  works: Work[];
  onRead: (w: Work) => void;
}) {
  return (
    <Canvas
      camera={{ position: [0, 10, 19], fov: 45 }}
      dpr={[1, 1.5]}
      fallback={<p>请从作品列表阅读。</p>}
    >
      <color attach="background" args={['#071d25']} />
      <ambientLight intensity={1.2} />
      <Dust />
      {works.map((w, i) => {
        const angle = i * 2.399,
          radius = 1 + Math.sqrt(i) * 0.7;
        return (
          <mesh
            key={w.id}
            position={[Math.cos(angle) * radius, 0.4, Math.sin(angle) * radius]}
            onClick={() => onRead(w)}
          >
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshBasicMaterial
              color={w.genre === '文' ? '#90c8de' : '#ebc27d'}
            />
            <Html center distanceFactor={10} position={[0, 0.4, 0]}>
              <button className="star-label" onClick={() => onRead(w)}>
                {w.title}
                <small>
                  {w.author} · {w.genre}
                </small>
              </button>
            </Html>
          </mesh>
        );
      })}
      <OrbitControls enablePan={false} minDistance={5} maxDistance={24} />
    </Canvas>
  );
}
