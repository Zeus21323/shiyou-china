'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { LotusBody } from '../lib/lotus-water';

const skyFragment = `
varying vec3 direction;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
 vec3 d=normalize(direction);
 float h=max(0.,d.y);
 vec3 sky=mix(vec3(.022,.061,.09),vec3(.004,.009,.03),smoothstep(0.,.65,h));
 vec3 moonDir=normalize(vec3(.38,.06,-1.));
 float angle=acos(clamp(dot(d,moonDir),-1.,1.));
 float halo=exp(-angle*angle*65.);
 sky+=vec3(.16,.21,.26)*halo*.3;
 float moon=1.-smoothstep(.020,.022,angle);
 float maria=sin(d.x*470.+sin(d.y*290.)*2.)*sin(d.y*530.)*.035+sin(d.x*190.+d.y*200.)*.055;
 sky=mix(sky,vec3(.94,.88,.68)*( .86+maria),moon);
 vec2 sphere=vec2(atan(d.x,-d.z),asin(d.y));
 vec2 grid=sphere*vec2(155.,145.);
 vec2 cell=floor(grid), q=fract(grid)-.5;
 float seed=hash(cell),star=1.-smoothstep(.015,.11+seed*.06,length(q));
 star*=step(.978,seed)*smoothstep(.01,.14,h)*(1.-moon);
 sky+=mix(vec3(.4,.65,.95),vec3(.92,.78,.49),hash(cell+3.))*star*.8;
 // Distant ink-wash hills sit below the stars, with a softer second ridge.
 float ridge=.008+.018*pow(.5+.5*sin(sphere.x*11.+sin(sphere.x*7.)*2.),2.);
 float ridge2=.004+.009*sin(sphere.x*19.)+.012*sin(sphere.x*6.+1.);
 sky=mix(sky,vec3(.035,.079,.102),1.-smoothstep(ridge-.006,ridge+.004,d.y));
 sky=mix(sky,vec3(.016,.047,.059),1.-smoothstep(ridge2-.002,ridge2+.002,d.y));
 gl_FragColor=vec4(sky,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;

export function MoonSky() {
  return (
    <mesh raycast={() => {}}>
      <sphereGeometry args={[440, 48, 24]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        vertexShader={
          'varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}'
        }
        fragmentShader={skyFragment}
      />
    </mesh>
  );
}

function leafGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (let i = 0; i <= 72; i++) {
    const a = 0.16 + (i / 72) * (Math.PI * 2 - 0.32);
    const r = 1 + Math.sin(a * 9) * 0.026;
    shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const g = new THREE.ShapeGeometry(shape, 48);
  // Keep UVs as local leaf coordinates for the radial vein shader.
  const p = g.getAttribute('position'),
    uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getY(i));
  g.rotateX(-Math.PI / 2);
  return g;
}

export function LotusLeaves({
  time,
  bodies,
}: {
  time: { current: number };
  bodies: LotusBody[];
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(leafGeometry, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const leaves = useMemo(
    () =>
      Array.from({ length: 88 }, (_, i) => {
        const a = i * 2.399963 + 0.8,
          radius = 7 + Math.sqrt(i) * 4;
        return {
          x: Math.cos(a) * radius,
          z: Math.sin(a) * radius,
          phase: a,
          size: 0.55 + (Math.sin(i * 8) * 0.5 + 0.5) * 0.9,
        };
      }),
    [],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(() => {
    if (!mesh.current) return;
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      // Leaves yield to lanterns instead of covering their pedestals.
      let x = leaf.x + Math.sin(time.current * 0.13 + leaf.phase) * 0.18;
      let z = leaf.z + Math.cos(time.current * 0.17 + leaf.phase) * 0.18;
      for (const b of bodies) {
        const dx = x - b.x / 25,
          dz = z - b.y / 25,
          d = Math.hypot(dx, dz);
        const gap = 1.8 + leaf.size;
        if (d < gap && d > 0.001) {
          x += (dx / d) * (gap - d);
          z += (dz / d) * (gap - d);
        }
      }
      dummy.position.set(
        x,
        0.055 + Math.sin(time.current * 0.8 + leaf.phase) * 0.012,
        z,
      );
      dummy.rotation.set(
        0.015 * Math.sin(time.current + leaf.phase),
        leaf.phase,
        0,
      );
      dummy.scale.setScalar(leaf.size);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, leaves.length]}
      frustumCulled={false}
      raycast={() => {}}
    >
      <shaderMaterial
        side={THREE.DoubleSide}
        vertexShader={
          'varying vec2 leafUv; varying vec3 wp;void main(){leafUv=uv;vec4 p=instanceMatrix*vec4(position,1.);wp=(modelMatrix*p).xyz;gl_Position=projectionMatrix*modelViewMatrix*p;}'
        }
        fragmentShader={`varying vec2 leafUv;varying vec3 wp;void main(){
        float r=length(leafUv),a=atan(leafUv.y,leafUv.x);
        float veins=pow(max(0.,cos(a*12.+sin(r*10.)*.16)),38.)*(1.-smoothstep(.75,1.,r));
        float fine=pow(max(0.,cos(a*38.+r*18.)),24.)*.10;
        float variant=.5+.5*sin(wp.x*.23+wp.z*.14);
        vec3 c=mix(vec3(.023,.105,.075),vec3(.09,.22,.13),variant);
        c*=.78+.25*(1.-r);c+=vec3(.07,.11,.045)*(veins*.6+fine);
        c=mix(c,vec3(.18,.24,.09),smoothstep(.92,1.,r)*.38);
        gl_FragColor=vec4(c,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`}
      />
    </instancedMesh>
  );
}
