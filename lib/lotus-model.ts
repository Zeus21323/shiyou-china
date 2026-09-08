import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const PETALS_PER_LOTUS = 24;
export const PETAL_THICKNESS = 0.12;

// Rounded ceramic petals occupy separate angular wedges and nested radial
// shells. Both endpoints share a topology; no hinge crosses the flower axis.
export function petalSurface(
  t: number,
  s: number,
  open: boolean,
  back = false,
  outer = true,
) {
  const tipCurl = Math.pow(THREE.MathUtils.smoothstep(t, 0.72, 1), 2);
  const radius = open
    ? 0.5 + .98 * t
    : 0.4 * (1 - t) +
      0.3 * Math.sin(Math.PI * t * 0.94) +
      0.16 * t +
      (outer ? 0.33 : 0) * tipCurl;
  // Width is measured in Cartesian space, so an increasing open radius
  // cannot accidentally make the middle wider than the broad root.
  const halfWidth = (open ? .5 : .4) * Math.sin(.55) * Math.pow(1 - t, .65);
  const theta = Math.asin(s * halfWidth / radius);
  const thickness = PETAL_THICKNESS * (0.35 + 0.65 * Math.sin(Math.PI * t));
  const r = radius + (open ? 0 : (back ? thickness / 2 : -thickness / 2));
  const y = open
    ? 0.18 + (back ? -thickness / 2 : thickness / 2)
    : 1.6 * t - (outer ? 0.12 : 0) * tipCurl;
  return [r * Math.sin(theta), y, r * Math.cos(theta)] as const;
}
export function buildLotusPetal(lengthSteps = 24, widthSteps = 10) {
  const positions: number[] = [],
    closedPositions: number[] = [],
    closedInnerPositions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const stride = widthSteps + 1,
    sheet = (lengthSteps + 1) * stride;
  for (let side = 0; side < 2; side++)
    for (let j = 0; j <= lengthSteps; j++)
      for (let i = 0; i <= widthSteps; i++) {
        const t = 0.002 + (j / lengthSteps) * 0.996,
          s = (i / widthSteps) * 2 - 1;
        positions.push(...petalSurface(t, s, true, !!side));
        closedPositions.push(...petalSurface(t, s, false, !!side));
        closedInnerPositions.push(...petalSurface(t, s, false, !!side, false));
        uvs.push(i / widthSteps, j / lengthSteps);
        if (j < lengthSteps && i < widthSteps) {
          const k = side * sheet + j * stride + i;
          const tri = [k, k + stride, k + 1, k + 1, k + stride, k + stride + 1];
          indices.push(...(side ? tri.reverse() : tri));
        }
      }
  const edge = (a: number, b: number) =>
    indices.push(a, b, a + sheet, b, b + sheet, a + sheet);
  for (let j = 0; j < lengthSteps; j++) {
    edge(j * stride, (j + 1) * stride);
    edge((j + 1) * stride + widthSteps, j * stride + widthSteps);
  }
  for (let i = 0; i < widthSteps; i++) {
    edge(i + 1, i);
    edge(lengthSteps * stride + i, lengthSteps * stride + i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  const closed = new THREE.BufferGeometry();
  closed.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(closedPositions, 3),
  );
  closed.setIndex(indices);
  closed.computeVertexNormals();
  g.setAttribute('closedPosition', closed.attributes.position.clone());
  g.setAttribute('closedNormal', closed.attributes.normal.clone());
  closed.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(closedInnerPositions, 3),
  );
  closed.computeVertexNormals();
  g.setAttribute('closedInnerPosition', closed.attributes.position.clone());
  g.setAttribute('closedInnerNormal', closed.attributes.normal.clone());
  closed.dispose();
  g.computeBoundingSphere();
  return g;
}
export function lotusPetalPose(index: number, bloom: number, phase: number) {
  const layer = Math.floor(index / 6);
  const start = layer * 6,
    count = 6;
  // Stable per-petal targets: outer petals reach horizontal; inner petals
  // stop at different angles. The seed is fixed for the life of each lamp.
  const seed = Math.sin((index + 1) * 127.1 + phase * 13.7) * 43758.5453;
  const rank = ((index % 6) * 5 + layer * 2 + Math.floor(Math.abs(phase) * 7)) % 6;
  const random = (rank + .2 + (seed - Math.floor(seed)) * .6) / 6;
  const target = layer === 0 ? 1 : [1, .88, .77, .65][layer] + random * [0, .06, .07, .08][layer];
  const progress = THREE.MathUtils.smoothstep(bloom, 0, 1) * target;
  const size = 1 + Math.sin(phase) * 0.015;
  const azimuth =
    ((index - start) * Math.PI * 2) / count + (layer * Math.PI) / 6;
  // Larger inner shells and nearly level rims overlap in projection. Keep
  // physical clearance for the thick surfaces instead of intersecting them.
  const scale = THREE.MathUtils.lerp([1.18, .98, .78, .58][layer], [1.18, 1.09, .98, .87][layer], THREE.MathUtils.smoothstep(bloom, 0, 1)) * size;
  return {
    layer,
    progress,
    angle: azimuth + phase * 0.08,
    tilt: 0,
    scale,
    width: 1,
    heightScale: THREE.MathUtils.lerp(
      1 + layer * 0.018,
      1 + layer * 0.025,
      progress,
    ),
    radius: THREE.MathUtils.lerp(
      0.18 - layer * 0.04,
      0.2 - layer * 0.025,
      progress,
    ),
    lift: 0.53 + layer * .09 * progress,
  };
}
// A shared, monotone spatial deformation gives different petals different
// heights and slopes without moving one shell through another. It leaves X/Z
// unchanged; even while closing, d(newY)/dY remains strictly positive.
export function lotusHeightWave(
  x: number,
  y: number,
  z: number,
  progress: number,
) {
  const r = Math.hypot(x, z),
    a = Math.atan2(x, z);
  const rhythm = 0.65 * Math.sin(2 * a + 0.7) + 0.35 * Math.cos(3 * a - 0.4);
  const rim =
    0.075 *
    (1 - progress) *
    THREE.MathUtils.smoothstep(r, 0.48, 0.78) *
    THREE.MathUtils.smoothstep(y, 0.85, 1.4);
  return rim * rhythm;
}
// Match pointer picking to the same morph used by the GPU, including closed
// tips that are outside the open geometry's original bounding volume.
export function createPetalRaycast() {
  const copies = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const probe = new THREE.Mesh(),
    matrix = new THREE.Matrix4(),
    sphere = new THREE.Sphere(new THREE.Vector3(), 3);
  const hits: THREE.Intersection[] = [];
  function raycast(
    this: THREE.InstancedMesh,
    raycaster: THREE.Raycaster,
    result: THREE.Intersection[],
  ) {
    const source = this.geometry;
    let g = copies.get(source);
    if (!g) {
      g = source.clone();
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
      g.boundingBox = null;
      copies.set(source, g);
    }
    probe.geometry = g;
    probe.material = this.material;
    const open = source.attributes.position,
      out = g.attributes.position;
    for (let first = 0; first < this.count; first += PETALS_PER_LOTUS) {
      this.getMatrixAt(first, matrix);
      matrix.premultiply(this.matrixWorld);
      sphere.center.setFromMatrixPosition(matrix);
      sphere.radius = 3;
      if (!raycaster.ray.intersectsSphere(sphere)) continue;
      for (
        let i = first;
        i < Math.min(first + PETALS_PER_LOTUS, this.count);
        i++
      ) {
        const p = this.instanceColor?.getZ(i) ?? 0;
        const closed =
          (this.instanceColor?.getY(i) ?? 0) < 0.1
            ? source.attributes.closedPosition
            : source.attributes.closedInnerPosition;
        this.getMatrixAt(i, matrix);
        const e = matrix.elements,
          layer = (this.instanceColor?.getY(i) ?? 0) * 3;
        const radius = THREE.MathUtils.lerp(
          0.18 - layer * 0.04,
          0.2 - layer * 0.025,
          p,
        );
        const radialScale = Math.hypot(e[8], e[10]);
        for (let k = 0; k < out.count; k++) {
          const x = closed.getX(k) * (1 - p) + open.getX(k) * p;
          const y = closed.getY(k) * (1 - p) + open.getY(k) * p;
          const z = closed.getZ(k) * (1 - p) + open.getZ(k) * p;
          const dy = lotusHeightWave(
            e[0] * x + e[8] * z + (e[8] / radialScale) * radius,
            e[5] * y,
            e[2] * x + e[10] * z + (e[10] / radialScale) * radius,
            p,
          );
          out.setXYZ(k, x, y + dy / e[5], z);
        }
        probe.matrixWorld.multiplyMatrices(this.matrixWorld, matrix);
        hits.length = 0;
        probe.raycast(raycaster, hits);
        for (const hit of hits)
          result.push({ ...hit, object: this, instanceId: i });
      }
    }
  }
  return {
    raycast,
    dispose: () => {
      for (const g of copies.values()) g.dispose();
      copies.clear();
    },
  };
}
export function buildPetalMaterial() {
  const grain = buildPetalTexture();
  const material = new THREE.MeshPhysicalMaterial({
    fog: false,
    bumpMap: grain,
    bumpScale: 0.045,
    roughnessMap: grain,
    side: THREE.DoubleSide,
    roughness: 0.38,
    metalness: 0,
    clearcoat: 0.3,
    sheen: 0.65,
    sheenColor: new THREE.Color('#ee8fa7'),
    sheenRoughness: 0.7,
    envMapIntensity: 0.28,
  });
  material.addEventListener('dispose', () => grain.dispose());
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      varying vec2 petalUv;
      attribute vec3 closedPosition,closedNormal,closedInnerPosition,closedInnerNormal;
      float stepDerivative(float lo,float hi,float v){
        float t=clamp((v-lo)/(hi-lo),0.,1.);return 6.*t*(1.-t)/(hi-lo);
      }
      // Return displacement and its gradient in lamp coordinates.
      vec4 heightWave(vec3 q,float p){
        float r=max(length(q.xz),.0001),a=atan(q.x,q.z);
        float rhythm=.65*sin(2.*a+.7)+.35*cos(3.*a-.4);
        float da=1.3*cos(2.*a+.7)-1.05*sin(3.*a-.4);
        float gate=smoothstep(.85,1.4,q.y),rim=smoothstep(.48,.78,r);
        float envelope=.075*(1.-p)*rim*gate;
        float dr=.075*(1.-p)*stepDerivative(.48,.78,r)*gate;
        float dy=.075*(1.-p)*rim*stepDerivative(.85,1.4,q.y)*rhythm;
        return vec4(envelope*rhythm,
          dr*q.x/r*rhythm+envelope*da*q.z/(r*r),dy,
          dr*q.z/r*rhythm-envelope*da*q.x/(r*r));
      }
      vec4 localHeightWave(vec3 v){
        float layer=instanceColor.g*3.,p=instanceColor.b;
        vec3 q=mat3(instanceMatrix)*v;
        q.xz+=normalize(instanceMatrix[2].xz)*mix(.18-layer*.04,.2-layer*.025,p);
        vec4 w=heightWave(q,p);
        vec3 gradient=vec3(dot(w.yzw,instanceMatrix[0].xyz),dot(w.yzw,instanceMatrix[1].xyz),dot(w.yzw,instanceMatrix[2].xyz))/instanceMatrix[1].y;
        return vec4(w.x/instanceMatrix[1].y,gradient);
      }`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
      vec3 morphed=mix(mix(closedPosition,closedInnerPosition,step(.1,instanceColor.g)),position,instanceColor.b);
      vec4 wave=localHeightWave(morphed);
      objectNormal=normalize(mix(mix(closedNormal,closedInnerNormal,step(.1,instanceColor.g)),normal,instanceColor.b));
      objectNormal.y/=1.+wave.z;
      objectNormal.xz-=wave.yw*objectNormal.y;
      objectNormal=normalize(objectNormal);`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed=morphed;transformed.y+=wave.x;',
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      '#include <uv_vertex>\npetalUv=uv;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec2 petalUv;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float lit=step(.7,vColor.r),outer=1.-vColor.g;
      float edge=smoothstep(.86,1.,abs(petalUv.x*2.-1.));
      float vein=pow(.5+.5*cos(petalUv.x*55.+sin(petalUv.y*3.)*2.),18.)*.15;
      float pink=clamp(outer*.65+smoothstep(.05,1.,petalUv.y)*.35,0.,1.);
      vec3 tint=mix(vec3(1.,.98,.97),vec3(.83,.18,.30),pink);
      diffuseColor.rgb=mix(vec3(.065,.08,.095),tint,lit)*(1.-vein);
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float litGlow=step(.7,vColor.r);
      totalEmissiveRadiance+=tint*(exp(-petalUv.y*2.4)*.14+.025)*litGlow*(1.-vein);
    `,
    );
  };
  material.customProgramCacheKey = () => 'ceramic-horizontal-outer-v7';
  return material;
}

// Continuous longitudinal veins with branching fibres, sampled by the PBR
// bump and roughness channels. Generated locally, with no asset dependency.
export function buildPetalTexture() {
  const width = 256,
    height = 512,
    data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x / width,
        v = y / height;
      const curve = u * 31 + Math.sin(v * 4 + u * 2) * 0.75;
      const vein = Math.pow(0.5 + 0.5 * Math.cos(curve * Math.PI * 2), 20);
      const fibre =
        Math.sin(u * 820 + v * 43) * 0.5 + Math.sin(u * 1330 - v * 29) * 0.5;
      const branch = Math.pow(
        0.5 + 0.5 * Math.cos(u * 180 + v * 74 + Math.sin(v * 9)),
        16,
      );
      const grain = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      const value = Math.round(
        THREE.MathUtils.clamp(
          0.77 -
            vein * 0.23 -
            branch * 0.055 +
            fibre * 0.025 +
            (grain - Math.floor(grain) - 0.5) * 0.055,
          0,
          1,
        ) * 255,
      );
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = value;
      data[i + 3] = 255;
    }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function buildLotusPedestal() {
  const parts: THREE.BufferGeometry[] = [];
  const add = (profile: number[][], hex: string) => {
    const g = new THREE.LatheGeometry(
      profile.map(([r, y]) => new THREE.Vector2(r, y)),
      64,
    );
    const color = new THREE.Color(hex),
      colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++)
      color.toArray(colors, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  };
  add(
    [
      [0, 0.035],
      [1.28, 0.035],
      [1.42, 0.065],
      [1.47, 0.12],
      [1.46, 0.18],
      [1.38, 0.225],
      [1.1, 0.24],
      [0, 0.24],
    ],
    '#e6dfd0',
  );
  add(
    [
      [0, 0.22],
      [0.72, 0.22],
      [0.81, 0.27],
      [0.79, 0.32],
      [0.65, 0.39],
      [0.53, 0.47],
      [0.53, 0.52],
      // Ceramic receptacle supports the elevated petal roots and flame cup.
      [0.68, 0.6],
      [0.82, 0.68],
      [0.8, 0.74],
      [0.66, 0.84],
      [0.52, 0.9],
      [0, 0.9],
    ],
    '#d3c5ad',
  );
  const rim = new THREE.TorusGeometry(1.42, 0.018, 8, 64);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, 0.18, 0);
  const c = new THREE.Color('#b89569'),
    colors = new Float32Array(rim.attributes.position.count * 3);
  for (let i = 0; i < rim.attributes.position.count; i++)
    c.toArray(colors, i * 3);
  rim.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  parts.push(rim);
  const merged = mergeGeometries(parts)!;
  for (const g of parts) g.dispose();
  return merged;
}
export function buildLotusFlame() {
  const p: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  for (let j = 0; j <= 24; j++)
    for (let i = 0; i <= 12; i++) {
      const t = j / 24,
        angle = (i / 12) * Math.PI * 2;
      const r = Math.pow(Math.sin(Math.PI * t), 0.8) * (0.29 - 0.15 * t);
      const bend = Math.sin(t * 6.5) * 0.22 * t;
      p.push(Math.cos(angle) * r + bend, t * 1.75, Math.sin(angle) * r * 0.65);
      uv.push(i / 12, t);
      if (j < 24 && i < 12) {
        const k = j * 13 + i;
        idx.push(k, k + 1, k + 13, k + 1, k + 14, k + 13);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
export function buildFlameMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: { time: { value: 0 } },
    vertexShader: `uniform float time;varying vec2 vFlame;void main(){vFlame=uv;vec3 p=position;p.x+=sin(time*2.4+uv.y*8.)*.05*uv.y;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(p,1.);}`,
    fragmentShader: `varying vec2 vFlame;void main(){float rim=pow(abs(sin(vFlame.x*6.283)),3.);vec3 c=mix(vec3(1.,.82,.31),vec3(1.,.19,.025),rim*.6);c=mix(c,vec3(1.,.98,.69),pow(1.-vFlame.y,2.)*.8);gl_FragColor=vec4(c*1.8,.88);}`,
  });
}
