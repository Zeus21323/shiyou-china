import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createLanternBatch } from '../lib/lotus-glb.ts';

test('imported GLBs preserve source bytes, independent native bloom and extinguished instances', async () => {
  for (const filename of ['lotus-lantern.glb', 'lotus-lantern-lite.glb']) {
    const bytes = await readFile(
      new URL(`../public/models/${filename}`, import.meta.url),
    );
    assert.deepEqual(
      bytes,
      await readFile(new URL(`../../莲花灯/${filename}`, import.meta.url)),
    );
    const loader = new GLTFLoader();
    // Node tests exercise actual geometry and animation; browser verifies embedded textures.
    loader.register(() => ({
      name: 'test-texture',
      loadTexture: () => Promise.resolve(new THREE.Texture()),
    }));
    const asset = await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    );
    const batch = createLanternBatch(asset, 3);
    batch.set(0, new THREE.Matrix4(), 0, true);
    batch.flush(1);
    batch.set(1, new THREE.Matrix4().makeTranslation(8, 0, 0), 1, true);
    batch.set(2, new THREE.Matrix4().makeTranslation(16, 0, 0), 0.5, false);
    batch.flush(3);
    const petals = batch.parts.filter((p) => p.sample);
    assert.equal(petals.length, 28);
    for (const part of petals) {
      part.mesh.getMorphAt(0, part.source);
      assert.equal(part.source.morphTargetInfluences[0], 0);
      part.mesh.getMorphAt(1, part.source);
      assert.equal(part.source.morphTargetInfluences[0], 1);
      part.mesh.getMorphAt(2, part.source);
      assert.ok(Number.isFinite(part.source.morphTargetInfluences[0]));
      assert.equal(part.mesh.morphTexture.image.height, 3);
    }
    const matrix = new THREE.Matrix4();
    for (const part of batch.parts.filter((p) => p.flame)) {
      part.mesh.getMatrixAt(2, matrix);
      assert.equal(matrix.determinant(), 0);
      part.mesh.getMatrixAt(0, matrix);
      assert.notEqual(matrix.determinant(), 0);
    }
    const flames = batch.parts.filter((p) => p.sampleFlame);
    assert.equal(flames.length, 5);
    batch.set(0, new THREE.Matrix4(), 0, true, 0.37);
    const first = flames.map((p) => {
      p.mesh.getMorphAt(0, p.source);
      return [...p.source.morphTargetInfluences];
    });
    batch.set(0, new THREE.Matrix4(), 0, true, 1.73);
    for (const [i, p] of flames.entries()) {
      p.mesh.getMorphAt(0, p.source);
      assert.notDeepEqual(p.source.morphTargetInfluences, first[i]);
      assert.ok(p.source.morphTargetInfluences.every(Number.isFinite));
      p.mesh.getMorphAt(2, p.source);
      assert.deepEqual(p.source.morphTargetInfluences, [0, 0, 0]);
    }
    // Rays hit the real closed and open morph surfaces with correct instance identity.
    for (const i of [0, 1]) {
      const ray = new THREE.Raycaster(
        new THREE.Vector3(i * 8, 10, 0.8),
        new THREE.Vector3(0, -1, 0),
      );
      const hits = petals.flatMap((p) => ray.intersectObject(p.mesh));
      assert.ok(hits.some((hit) => hit.instanceId === i));
    }
    batch.dispose();
  }
});
