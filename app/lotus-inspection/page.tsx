'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { createLanternBatch, LOTUS_MODEL_URL } from '../../lib/lotus-glb';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

function Study({ bloom, angle }: { bloom: number; angle: number }) {
  const { camera, gl, scene } = useThree();
  useEffect(() => {
    camera.position.set(
      ...(
        [
          [0, 2.6, 6.6],
          [4, 4.2, 5.5],
          [0, 8.3, 0.02],
        ] as [number, number, number][]
      )[angle],
    );
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld();
  }, [camera, angle]);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl),
      room = new RoomEnvironment(),
      env = pmrem.fromScene(room, 0.04);
    scene.environment = env.texture;
    room.dispose();
    pmrem.dispose();
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [gl, scene]);
  const asset = useGLTF(LOTUS_MODEL_URL);
  const resources = useMemo(() => createLanternBatch(asset, 1), [asset]);
  useEffect(() => () => resources.dispose(), [resources]);
  useFrame(({ clock }) => {
    resources.set(0, new THREE.Matrix4(), bloom, true, clock.elapsedTime);
    resources.flush(1);
  });
  return (
    <>
      <hemisphereLight args={['#fff1dc', '#40515c', 1.3]} />
      <directionalLight position={[3, 6, 4]} intensity={0.65} />
      {resources.parts.map(({ mesh }) => (
        <primitive key={mesh.uuid} object={mesh} dispose={null} />
      ))}
    </>
  );
}
export default function LotusInspection() {
  const [bloom, setBloom] = useState(1),
    [angle, setAngle] = useState(1),
    [contrast, setContrast] = useState(false);
  return (
    <main
      style={{
        height: '100dvh',
        background: contrast ? '#13e2bc' : '#182d39',
        color: '#f6edde',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 12,
          padding: 16,
          flexWrap: 'wrap',
          background: '#182d39',
        }}
      >
        <strong>莲灯层间遮挡检查</strong>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <button
            aria-pressed={bloom === v}
            style={{
              color: '#fff8ed',
              border: '1px solid #8a9eac',
              padding: '6px 14px',
              background: bloom === v ? '#65858d' : 'transparent',
            }}
            key={v}
            onClick={() => setBloom(v)}
          >
            {v === 0 ? '闭合' : v === 1 ? '展开' : `${v * 100}%`}
          </button>
        ))}
        {['正面', '斜上方', '俯视'].map((v, i) => (
          <button
            aria-pressed={angle === i}
            key={v}
            style={{
              color: '#fff8ed',
              border: '1px solid #8a9eac',
              padding: '6px 14px',
              background: angle === i ? '#65858d' : 'transparent',
            }}
            onClick={() => setAngle(i)}
          >
            {v}
          </button>
        ))}
        <button
          aria-pressed={contrast}
          style={{
            color: '#fff8ed',
            border: '1px solid #8a9eac',
            padding: '6px 14px',
            background: contrast ? '#65858d' : 'transparent',
          }}
          onClick={() => setContrast((v) => !v)}
        >
          高对比背景
        </button>
        <a href="/" style={{ padding: 6 }}>
          返回诗游中国
        </a>
      </div>
      <div style={{ flex: 1 }}>
        <Canvas camera={{ fov: 38, position: [4, 4.2, 5.5] }} dpr={[1, 1.5]}>
          <Suspense fallback={null}>
            <Study bloom={bloom} angle={angle} />
          </Suspense>
        </Canvas>
      </div>
    </main>
  );
}
