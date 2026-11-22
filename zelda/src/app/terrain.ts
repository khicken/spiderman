import * as THREE from "three";
import type { FrameCtx, Look, Quality, QualityPreset, Terrain, World } from "./contracts";
import { LAKE, QUALITY, WORLD } from "./contracts";
import { worldData } from "./world";
import { generateWorld } from "./world-gen";
import { makeTerrainTextures } from "./terrain-textures";
import { TERRAIN_VERT, WATER_VERT, terrainFrag, waterFrag } from "./terrain-shader";
import { makeInlandWaterGeometry, makeSeaGeometry } from "./terrain-water";

export { createWorld } from "./world";

// Terrain meshes and water. 20 x 20 chunks drawn as 4 instanced grids (one per LOD), sea + inland water: 6 draw calls.
// Owner: terrain.

const LOD_QUADS = [64, 32, 16, 8] as const;
const LOD_SKIRT = [6, 12, 26, 48] as const;
const DEEP_CULL = -14; // chunks entirely below this are hidden by opaque deep water

function chunkGeometry(quads: number, skirt: number, capacity: number): THREE.InstancedBufferGeometry {
  const S = WORLD.chunk;
  const v = quads + 1;
  const step = S / quads;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j < v; j++) for (let i = 0; i < v; i++) pos.push(i * step, 0, j * step);
  for (let j = 0; j < quads; j++) {
    for (let i = 0; i < quads; i++) {
      const a = j * v + i, b = (j + 1) * v + i, c = a + 1, d = b + 1;
      idx.push(a, b, c, c, b, d);
    }
  }
  // skirts: walk each edge, drop a copy of the edge down, face it outward
  const edge = (verts: number[], ox: number, oz: number) => {
    const base = pos.length / 3;
    for (const vi of verts) pos.push(pos[vi * 3], -skirt, pos[vi * 3 + 2]);
    for (let k = 0; k < verts.length - 1; k++) {
      const t0 = verts[k], t1 = verts[k + 1], s0 = base + k, s1 = base + k + 1;
      const ex = pos[t1 * 3] - pos[t0 * 3], ez = pos[t1 * 3 + 2] - pos[t0 * 3 + 2];
      // (t0, s0, t1) faces (-ez, 0, ex); flip it to face outward (ox, oz)
      if (ex * oz - ez * ox > 0) idx.push(t0, s0, t1, t1, s0, s1);
      else idx.push(t0, t1, s0, t1, s1, s0);
    }
  };
  const row = (j: number) => Array.from({ length: v }, (_, i) => j * v + i);
  const col = (i: number) => Array.from({ length: v }, (_, j) => j * v + i);
  edge(row(0), 0, -1);
  edge(row(quads), 0, 1);
  edge(col(0), -1, 0);
  edge(col(quads), 1, 0);

  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const off = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  off.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute("aOffset", off);
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

const C = (hex: string) => ({ value: new THREE.Color(hex) });

export function createTerrain(scene: THREE.Scene, world: World, look: Look, quality: Quality): Terrain {
  const data = worldData(world) ?? generateWorld(world.seed);
  const tex = makeTerrainTextures(data, world.seed);
  let preset: QualityPreset = QUALITY[quality];

  const fade = { value: preset.drawDist };
  const group = new THREE.Group();
  group.name = "terrain";

  const terrainMat = new THREE.ShaderMaterial({
    name: "hm-terrain",
    vertexShader: TERRAIN_VERT,
    fragmentShader: terrainFrag(look.glsl),
    uniforms: {
      ...look.uniforms,
      uTHeight: { value: tex.height },
      uTNormal: { value: tex.normal },
      uTSplatA: { value: tex.splatA },
      uTSplatB: { value: tex.splatB },
      uTDetail: { value: tex.detail },
      uTNoise: { value: tex.water },
      uCGrass: C("#7f9f4e"),
      uCGrassFar: C("#93ad5c"),
      uCGrassWarm: C("#aaa55c"),
      uCForest: C("#4d6b3a"),
      uCRock: C("#a39a88"),
      uCAshRock: C("#7c736a"),
      uCAsh: C("#857b70"),
      uCSand: C("#e0cc98"),
      uCDirt: C("#9c7b55"),
      uCSnow: C("#f4efe2"),
      uCMud: C("#6e5a40"),
      uCWaterShallow: C("#6fc2b4"),
      uTLake: { value: new THREE.Vector4(LAKE.x, LAKE.z, LAKE.r, LAKE.level) },
      uFade: fade,
    },
  });

  const C2 = WORLD.chunks * WORLD.chunks;
  const lods = LOD_QUADS.map((q, i) => {
    const geo = chunkGeometry(q, LOD_SKIRT[i], C2);
    const mesh = new THREE.Mesh(geo, terrainMat);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.name = `terrain-lod${i}`;
    group.add(mesh);
    return { geo, mesh, off: geo.getAttribute("aOffset") as THREE.InstancedBufferAttribute, count: 0 };
  });

  const waterMat = new THREE.ShaderMaterial({
    name: "hm-water",
    vertexShader: WATER_VERT,
    fragmentShader: waterFrag(look.glsl),
    transparent: true,
    side: THREE.DoubleSide,
    defines: { WQ: preset.water },
    uniforms: {
      ...look.uniforms,
      uTHeightLo: { value: tex.heightLo },
      uTNoise: { value: tex.water },
      uWShallow: C("#6fc2b4"),
      uWDeep: C("#1c4f5c"),
      uWFoam: C("#f8f0dd"),
      uFade: fade,
    },
  });
  let seaGeo = makeSeaGeometry(preset.drawDist * 1.1);
  const sea = new THREE.Mesh(seaGeo, waterMat);
  sea.name = "sea";
  sea.frustumCulled = false;
  sea.renderOrder = 1;
  const inlandGeo = makeInlandWaterGeometry(data);
  const inland = new THREE.Mesh(inlandGeo, waterMat);
  inland.name = "inland-water";
  inland.renderOrder = 2;
  group.add(sea, inland);
  scene.add(group);

  // per-chunk culling boxes
  const S = WORLD.chunk, H = WORLD.half, CN = WORLD.chunks;
  const boxes: THREE.Box3[] = [];
  for (let cz = 0; cz < CN; cz++) {
    for (let cx = 0; cx < CN; cx++) {
      const k = cz * CN + cx;
      boxes.push(new THREE.Box3(
        new THREE.Vector3(cx * S - H, data.chunkMin[k] - LOD_SKIRT[3], cz * S - H),
        new THREE.Vector3(cx * S - H + S, data.chunkMax[k] + 1, cz * S - H + S),
      ));
    }
  }
  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();

  return {
    group,
    update(ctx: FrameCtx) {
      const cam = ctx.camera;
      cam.updateMatrixWorld();
      projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      const px = cam.position.x, py = cam.position.y, pz = cam.position.z;
      const l0 = preset.terrainLod[0], l1 = preset.terrainLod[1], l2 = preset.terrainLod[2];
      const far = preset.drawDist;
      for (let i = 0; i < 4; i++) lods[i].count = 0;
      for (let k = 0; k < C2; k++) {
        if (data.chunkMax[k] < DEEP_CULL) continue;
        const b = boxes[k];
        const dx = Math.max(b.min.x - px, 0, px - b.max.x);
        const dz = Math.max(b.min.z - pz, 0, pz - b.max.z);
        const dy = Math.max(data.chunkMin[k] - py, 0, py - data.chunkMax[k]);
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > far) continue;
        if (!frustum.intersectsBox(b)) continue;
        const L = lods[d < l0 ? 0 : d < l1 ? 1 : d < l2 ? 2 : 3];
        L.off.array[L.count * 2] = b.min.x;
        L.off.array[L.count * 2 + 1] = b.min.z;
        L.count++;
      }
      for (let i = 0; i < 4; i++) {
        const L = lods[i];
        L.geo.instanceCount = L.count;
        L.mesh.visible = L.count > 0;
        if (L.count > 0) {
          L.off.clearUpdateRanges();
          L.off.addUpdateRange(0, L.count * 2);
          L.off.needsUpdate = true;
        }
      }
      sea.position.set(Math.round(px / 32) * 32, 0, Math.round(pz / 32) * 32);
    },
    setQuality(q: Quality) {
      const prev = preset;
      preset = QUALITY[q];
      fade.value = preset.drawDist;
      if (prev.water !== preset.water) {
        waterMat.defines.WQ = preset.water;
        waterMat.needsUpdate = true;
      }
      if (prev.drawDist !== preset.drawDist) {
        seaGeo.dispose();
        seaGeo = makeSeaGeometry(preset.drawDist * 1.1);
        sea.geometry = seaGeo;
      }
    },
    dispose() {
      scene.remove(group);
      for (const L of lods) L.geo.dispose();
      seaGeo.dispose();
      inlandGeo.dispose();
      terrainMat.dispose();
      waterMat.dispose();
      tex.dispose();
    },
  };
}
