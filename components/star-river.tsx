'use client';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import { useMemo, useRef, useState } from 'react';
import type { Work } from '../lib/content';
import { useReducedMotion } from '../lib/use-motion-preference';
import * as THREE from 'three';

function StarRiver({ paused }: { paused: boolean }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const data = useMemo(() => {
    let seed = 2409;
    const rand = () =>
      (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const position = new Float32Array(2800 * 3),
      colors = new Float32Array(2800 * 3),
      phases = new Float32Array(2800);
    for (let i = 0; i < 2800; i++) {
      const r = Math.pow(rand(), 0.65) * 10,
        angle = r * 0.72 + ((i % 3) * Math.PI * 2) / 3 + (rand() - 0.5) * 0.6;
      position.set(
        [
          Math.cos(angle) * r,
          (rand() - 0.5) * (0.7 + r * 0.06),
          Math.sin(angle) * r,
        ],
        i * 3,
      );
      const c = new THREE.Color(
        i % 5 === 0 ? '#efd5a0' : i % 3 === 0 ? '#c9e5e0' : '#639a9c',
      );
      colors.set([c.r, c.g, c.b], i * 3);
      phases[i] = rand() * 6.283;
    }
    return { position, colors, phases };
  }, []);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame((_, dt) => {
    if (!paused && material.current && !document.hidden)
      material.current.uniforms.uTime.value += Math.min(dt, 0.05);
  });
  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[data.position, 3]}
        />
        <bufferAttribute attach="attributes-color" args={[data.colors, 3]} />
        <bufferAttribute attach="attributes-phase" args={[data.phases, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexShader={`attribute vec3 color; attribute float phase; uniform float uTime; varying vec3 vColor; varying float vAlpha;
      void main(){float a=uTime*.045;vec3 p=position;p.x=position.x*cos(a)-position.z*sin(a);p.z=position.x*sin(a)+position.z*cos(a);p.y+=sin(uTime*.35+phase)*.16;
      vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((65.+phase*18.)/-mv.z,2.,10.);vColor=color;vAlpha=.75+.25*sin(uTime*.65+phase);}`}
        fragmentShader={`varying vec3 vColor; varying float vAlpha; void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;float halo=pow(1.-d,1.5);float core=1.-smoothstep(0.,.25,d);gl_FragColor=vec4(vColor*1.8,(halo*.55+core*.8)*vAlpha);}`}
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
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  return (
    <div
      className={'nebula-scene' + (paused || reduced ? ' motion-paused' : '')}
    >
      <div className="nebula-wash" aria-hidden="true" />
      <div className="nebula-moon" aria-hidden="true" />
      <Canvas
        camera={{ position: [0, 10, 19], fov: 45 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
        fallback={<p>星河暂时无法显示，请从作品列表阅读。</p>}
      >
        <StarRiver paused={paused || reduced} />
        {works.map((w, i) => {
          const angle = i * 2.399 + 0.4,
            radius = works.length === 1 ? 0 : 2.5 + Math.sqrt(i) * 1.25;
          return (
            <group
              key={w.id}
              position={[
                Math.cos(angle) * radius,
                0.5,
                Math.sin(angle) * radius,
              ]}
            >
              <mesh onClick={() => onRead(w)}>
                <sphereGeometry args={[0.095, 16, 16]} />
                <meshBasicMaterial color="#f1d6a0" />
              </mesh>
              <Html center position={[0, 0.6, 0]} zIndexRange={[6, 0]}>
                <button className="star-label" onClick={() => onRead(w)}>
                  <span>{w.title}</span>
                  <small>
                    {w.author} · {w.genre}
                  </small>
                </button>
              </Html>
            </group>
          );
        })}
        <OrbitControls
          enablePan={false}
          enableDamping
          dampingFactor={0.1}
          minDistance={9}
          maxDistance={28}
          minPolarAngle={0.3}
          maxPolarAngle={1.3}
        />
      </Canvas>
      <button
        className="motion-toggle"
        aria-pressed={paused || reduced}
        disabled={reduced}
        onClick={() => setPaused((p) => !p)}
      >
        {reduced ? '已减少动态效果' : paused ? '播放星河' : '暂停星河'}
      </button>
      <p className="nebula-caption">星河流转，字句长明</p>
    </div>
  );
}
