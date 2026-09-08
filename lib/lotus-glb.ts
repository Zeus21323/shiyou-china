import * as THREE from 'three';

export const LOTUS_MODEL_URL = '/models/lotus-lantern.glb?v=6';
export const LOTUS_LITE_URL = '/models/lotus-lantern-lite.glb?v=6';

// Share the imported geometry/textures; own only instance buffers and cloned materials.
export function createLanternBatch(
  gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] },
  capacity: number,
) {
  gltf.scene.updateMatrixWorld(true);
  const clip = gltf.animations.find((clip) => clip.name === 'Bloom');
  if (!clip) throw new Error('莲花灯模型缺少 Bloom 开合动画');
  const flicker = gltf.animations.find((clip) => clip.name === 'FlameFlicker');
  const parts: {
    mesh: THREE.InstancedMesh;
    source: THREE.Mesh;
    transform: THREE.Matrix4;
    flame: boolean;
    sample?: (time: number) => ArrayLike<number>;
    sampleFlame?: (time: number) => ArrayLike<number>;
  }[] = [];
  gltf.scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const source = new THREE.Mesh(node.geometry, node.material);
    const materials = (
      Array.isArray(node.material) ? node.material : [node.material]
    ).map((original) => {
      const material: THREE.Material = original.clone();
      if ('fog' in material) material.fog = false;
      // Instance colour also gates the candle's emission for empty, extinguished lamps.
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance *= vColor;\n#endif',
        );
      };
      return material;
    });
    const mesh = new THREE.InstancedMesh(
      node.geometry,
      Array.isArray(node.material) ? materials : materials[0],
      capacity,
    );
    mesh.name = node.name;
    // Allocate morph storage at capacity before visibility reduces the draw count.
    if (source.morphTargetInfluences?.length) mesh.setMorphAt(0, source);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Three's default instanced raycast does not apply per-instance morph weights.
    const world = new THREE.Matrix4(),
      local = new THREE.Matrix4();
    mesh.raycast = (raycaster, hits) => {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, local);
        world.multiplyMatrices(mesh.matrixWorld, local);
        source.matrixWorld.copy(world);
        if (mesh.morphTexture) mesh.getMorphAt(i, source);
        const found: THREE.Intersection[] = [];
        source.raycast(raycaster, found);
        for (const hit of found)
          hits.push({ ...hit, object: mesh, instanceId: i });
      }
    };
    const track = clip.tracks.find(
      (track) => track.name === `${node.name}.morphTargetInfluences`,
    );
    // Three exposes this factory at runtime; its public typings omit it.
    const interpolant = track
      ? (
          track as THREE.KeyframeTrack & {
            createInterpolant(): THREE.Interpolant;
          }
        ).createInterpolant()
      : undefined;
    const flameTrack = flicker?.tracks.find(
      (track) => track.name === `${node.name}.morphTargetInfluences`,
    );
    const flameInterpolant = flameTrack
      ? (
          flameTrack as THREE.KeyframeTrack & {
            createInterpolant(): THREE.Interpolant;
          }
        ).createInterpolant()
      : undefined;
    parts.push({
      mesh,
      source,
      transform: node.matrixWorld.clone(),
      flame: node.name.startsWith('Flame_'),
      sample: interpolant ? (time) => interpolant.evaluate(time) : undefined,
      sampleFlame: flameInterpolant
        ? (time) => flameInterpolant.evaluate(time)
        : undefined,
    });
  });
  const matrix = new THREE.Matrix4(),
    tint = new THREE.Color();
  return {
    parts,
    indices: [] as number[],
    set(
      slot: number,
      transform: THREE.Matrix4,
      openness: number,
      lit: boolean,
      time = 0,
    ) {
      tint.setRGB(lit ? 1 : 0.14, lit ? 1 : 0.19, lit ? 1 : 0.23);
      for (const part of parts) {
        matrix.multiplyMatrices(transform, part.transform);
        if (part.flame && !lit) matrix.scale(new THREE.Vector3(0, 0, 0));
        part.mesh.setMatrixAt(slot, matrix);
        part.mesh.setColorAt(slot, tint);
        if (part.sample && part.source.morphTargetInfluences) {
          part.source.morphTargetInfluences[0] = part.sample(
            THREE.MathUtils.clamp(openness, 0, 1) * clip.duration,
          )[0];
          part.mesh.setMorphAt(slot, part.source);
        }
        if (part.sampleFlame && part.source.morphTargetInfluences && flicker) {
          const weights = part.sampleFlame(
            ((time % flicker.duration) + flicker.duration) % flicker.duration,
          );
          for (let i = 0; i < part.source.morphTargetInfluences.length; i++)
            part.source.morphTargetInfluences[i] = lit ? weights[i] : 0;
          part.mesh.setMorphAt(slot, part.source);
        }
      }
    },
    flush(count: number) {
      for (const { mesh } of parts) {
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        if (mesh.morphTexture) mesh.morphTexture.needsUpdate = true;
      }
    },
    dispose() {
      for (const { mesh } of parts) {
        mesh.dispose();
        (Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material]
        ).forEach((m) => m.dispose());
      }
    },
  };
}
