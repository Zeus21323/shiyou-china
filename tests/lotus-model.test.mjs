import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPetalRaycast } from '../lib/lotus-model.ts';
import {
  buildLotusPetal,
  buildLotusPedestal,
  buildLotusFlame,
  lotusPetalPose,
  PETALS_PER_LOTUS,
  buildPetalTexture,
  petalSurface,
  lotusHeightWave,
} from '../lib/lotus-model.ts';
test('厚瓣网格、闭合目标、法线与灯座火焰均有效', () => {
  for (const build of [buildLotusPetal, buildLotusPedestal, buildLotusFlame]) {
    const g = build();
    for (const a of Object.values(g.attributes))
      assert.ok([...a.array].every(Number.isFinite));
    assert.ok(g.index.count > 100);
    g.dispose();
  }
  const full = buildLotusPetal(),
    low = buildLotusPetal(8, 4);
  assert.ok(low.attributes.position.count < full.attributes.position.count / 4);
  assert.equal(
    full.attributes.closedPosition.count,
    full.attributes.position.count,
  );
  full.dispose();
  low.dispose();
});
function point(t, s, back, pose) {
  const c = petalSurface(t, s, false, back, pose.layer === 0),
    o = petalSurface(t, s, true, back),
    p = pose.progress;
  return [
    (c[0] * (1 - p) + o[0] * p) * pose.scale,
    (c[1] * (1 - p) + o[1] * p) * pose.heightScale + pose.lift,
    (c[2] * (1 - p) + o[2] * p) * pose.scale + pose.radius,
  ];
}
test('全过程厚瓣位于水面以上和碰撞体内，不越过同层角分区', () => {
  for (let frame = 0; frame <= 60; frame++)
    for (const phase of [0, 1.7, 3.9, 5.8])
      for (let i = 0; i < PETALS_PER_LOTUS; i++) {
        const p = lotusPetalPose(i, frame / 60, phase),
          count = 6;
        for (let j = 0; j <= 24; j++)
          for (const s of [-1, 0, 1])
            for (const back of [false, true]) {
              const [x, y, z] = point(0.002 + (j / 24) * 0.996, s, back, p);
              assert.ok(y > 0.5);
              assert.ok(Math.hypot(x, z) < 52 / 25);
              assert.ok(
                Math.abs(Math.atan2(x, z)) < Math.PI / count - 0.008,
                '同层花瓣必须留出角向间隙',
              );
            }
      }
});
// A horizontal petal has no invertible height profile. Pairwise triangle
// collision checks now live in lotus-intersections.test.mjs instead.
test('最外层展开中面完全水平，内层每片的目标角度固定且不同', () => {
  for(const phase of [0,1.7,3.9,5.8]) {
    const targets=[];
    for(let i=0;i<24;i++) {
      const pose=lotusPetalPose(i,1,phase);
      if(i<6) {
        const heights=[.002,.2,.5,.8,.998].map(t=>{
          const a=point(t,0,false,pose),b=point(t,0,true,pose);
          return (a[1]+b[1])/2;
        });
        assert.ok(Math.max(...heights)-Math.min(...heights)<1e-8);
      } else {
        assert.ok(pose.progress>0 && pose.progress<1);
        assert.deepEqual(pose,lotusPetalPose(i,1,phase));
        targets.push(pose.progress);
      }
    }
    assert.equal(new Set(targets).size,18);
  }
});
test('纹理含细纹且远景使用mipmap', () => {
  const t = buildPetalTexture(),
    values = new Set();
  for (let i = 0; i < t.image.data.length; i += 4) {
    values.add(t.image.data[i]);
    assert.equal(t.image.data[i + 3], 255);
  }
  assert.ok(values.size > 40);
  assert.equal(t.generateMipmaps, true);
  t.dispose();
});

test('闭合外瓣尖外翻，花瓣厚度加倍且从宽根持续收窄', () => {
  const neck = petalSurface(0.78, 0, false),
    tip = petalSurface(0.998, 0, false);
  assert.ok(tip[2] > neck[2] + 0.05);
  const front = petalSurface(0.5, 0, false),
    back = petalSurface(0.5, 0, false, true);
  assert.ok(Math.abs(back[2] - front[2] - .12)<1e-8);
  const openFront=petalSurface(.5,0,true),openBack=petalSurface(.5,0,true,true);
  assert.ok(Math.abs(openFront[1]-openBack[1]-.12)<1e-8);
  for(const open of [false,true]) for(const outer of [false,true]) for(const back of [false,true]) {
    let previous=Infinity;
    for(let j=0;j<=100;j++) {
      const width=petalSurface(.002+j/100*.996,1,open,back,outer)[0];
      assert.ok(width<previous,'花瓣宽度必须从根部到末端单调下降');previous=width;
    }
  }
});
test('仅外层闭合瓣外翻，闭合外缘保持高低与倾角变化', () => {
  const innerTip = petalSurface(0.998, 0, false, false, false);
  const innerNeck = petalSurface(0.78, 0, false, false, false);
  assert.ok(innerTip[2] < innerNeck[2] - 0.15, '内层瓣尖必须向内收拢');
  const worldPoint = (i, bloom, t) => {
    const pose = lotusPetalPose(i, bloom, 0),
      [x, y, z] = point(t, 0, false, pose);
    const wx = x * Math.cos(pose.angle) + z * Math.sin(pose.angle);
    const wz = -x * Math.sin(pose.angle) + z * Math.cos(pose.angle);
    return [wx, y + lotusHeightWave(wx, y - pose.lift, wz, pose.progress), wz];
  };
  for (const bloom of [0]) {
    const tips = [],
      angles = [];
    for (let i = 0; i < 6; i++) {
      const a = worldPoint(i, bloom, 0.8),
        b = worldPoint(i, bloom, 0.96);
      tips.push(b[1]);
      angles.push(
        Math.atan2(b[1] - a[1], Math.hypot(b[0] - a[0], b[2] - a[2])),
      );
    }
    assert.ok(Math.max(...tips) - Math.min(...tips) > (bloom ? 0.2 : 0.06));
    assert.ok(
      Math.max(...angles) - Math.min(...angles) > (bloom ? 0.1 : 0.03),
      `bloom=${bloom}, angle range=${Math.max(...angles) - Math.min(...angles)}`,
    );
  }
});
test('共享错落变形在61个开合状态保持高度严格单调，不改变壳层拓扑', () => {
  for (let frame = 0; frame <= 60; frame++)
    for (let a = 0; a < 24; a++)
      for (let r = 0.1; r < 2.1; r += 0.1)
        for (let y = 0.1; y < 2; y += 0.1) {
          const x = Math.sin((a * Math.PI) / 12) * r,
            z = Math.cos((a * Math.PI) / 12) * r;
          const dy =
            (lotusHeightWave(x, y + 0.0001, z, frame / 60) -
              lotusHeightWave(x, y, z, frame / 60)) /
            0.0001;
          assert.ok(1 + dy > 0.79, '变形不能翻转高度顺序');
        }
});
test('闭合瓣尖可点击，展开后不保留旧花苞的虚假点击面', () => {
  const geometry = buildLotusPetal(),
    material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geometry, material, 1),
    picker = createPetalRaycast();
  const pose = lotusPetalPose(0, 0, 0),
    dummy = new THREE.Object3D();
  dummy.position.set(0, pose.lift, pose.radius);
  dummy.scale.set(pose.scale, pose.heightScale, pose.scale);
  dummy.updateMatrix();
  mesh.setMatrixAt(0, dummy.matrix);
  mesh.setColorAt(0, new THREE.Color(1, 0, 0));
  mesh.updateMatrixWorld();
  const ray = new THREE.Raycaster(
      new THREE.Vector3(0, 1.94, 5),
      new THREE.Vector3(0, 0, -1),
    ),
    hits = [];
  picker.raycast.call(mesh, ray, hits);
  assert.ok(hits.length > 0);
  assert.equal(hits[0].instanceId, 0);
  mesh.setColorAt(0, new THREE.Color(1, 0, 1));
  hits.length = 0;
  picker.raycast.call(mesh, ray, hits);
  assert.equal(hits.length, 0);
  picker.dispose();
  geometry.dispose();
  material.dispose();
});
