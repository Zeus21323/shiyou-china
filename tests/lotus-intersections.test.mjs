import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { buildLotusPetal, lotusPetalPose, lotusHeightWave, PETALS_PER_LOTUS } from '../lib/lotus-model.ts';

test('厚瓣在采样开合状态与随机种子下无三角形相交', () => {
  const source = buildLotusPetal(12, 6), identity = new THREE.Matrix4();
  for (const phase of [0, 1.7, 3.9, 5.8]) for(let frame=0;frame<=24;frame++) {
    const petals=[];
    for(let i=0;i<PETALS_PER_LOTUS;i++) {
      const pose=lotusPetalPose(i,frame/24,phase), p=pose.progress;
      const c=source.attributes[pose.layer===0?'closedPosition':'closedInnerPosition'], o=source.attributes.position;
      const g=new THREE.BufferGeometry(), points=[];
      for(let k=0;k<o.count;k++) {
        const x=THREE.MathUtils.lerp(c.getX(k),o.getX(k),p)*pose.scale;
        const y=THREE.MathUtils.lerp(c.getY(k),o.getY(k),p)*pose.heightScale;
        const z=THREE.MathUtils.lerp(c.getZ(k),o.getZ(k),p)*pose.scale+pose.radius;
        const wx=x*Math.cos(pose.angle)+z*Math.sin(pose.angle), wz=-x*Math.sin(pose.angle)+z*Math.cos(pose.angle);
        points.push(wx,y+pose.lift+lotusHeightWave(wx,y,wz,p),wz);
      }
      g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.setIndex(source.index.clone());
      g.computeBoundingBox();g.boundsTree=new MeshBVH(g);
      petals.push(g);
    }
    try {
      for(let i=0;i<petals.length;i++)for(let j=i+1;j<petals.length;j++) {
        if(!petals[i].boundingBox.intersectsBox(petals[j].boundingBox))continue;
        assert.equal(petals[i].boundsTree.intersectsGeometry(petals[j],identity),false,`phase=${phase}, frame=${frame}, petals=${i}/${j}`);
      }
    }finally{petals.forEach(g=>g.dispose());}
  }
  source.dispose();
});
