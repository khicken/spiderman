import * as THREE from "three";
import type { Quality, Scenery, Track } from "./contracts";
import { buildBuildings } from "./scenery-buildings";
import { createFacadeMaterial } from "./scenery-facade";
import { createRoadIndex, disposeTree, farPatch, Geo, RING_D, STYLES, TIERS, U } from "./scenery-kit";
import { buildGround } from "./scenery-ground";
import { buildLandmarks, buildRing, glowMaterial } from "./scenery-landmarks";
import { buildNeon } from "./scenery-neon";
import { createProps } from "./scenery-props";
import { createStands } from "./scenery-stands";
import { buildStreets } from "./scenery-streets";
import { createTrees } from "./scenery-trees";
import { createWater } from "./scenery-water";

const CHUNK = 250;
const camPos = new THREE.Vector3();

export function createScenery(track: Track, quality: Quality): Scenery {
  const map = track.map;
  const style = STYLES[map.id];
  const roads = createRoadIndex(map);
  const group = new THREE.Group();
  group.name = "scenery";
  const { material: facadeMat, lit } = createFacadeMaterial();
  lit.value = style.lit;
  U.snow.value = map.env.season === "winter" ? 0.55 : 0;
  let tier = TIERS[quality];
  let parts: { dispose(): void }[] = [];
  let chunks: THREE.Mesh[] = [];
  let trees: ReturnType<typeof createTrees> | null = null;
  let props: ReturnType<typeof createProps> | null = null;
  let night = 0;

  function build() {
    tier = TIERS[quality];
    const { chunks: geos, blocker } = buildBuildings(map, track, roads, style, tier.detail, CHUNK);
    const extra = new Geo(), plain = new Geo(), glow = new Geo();
    const stands = createStands(map, track, roads, style, blocker, tier, extra);
    buildLandmarks(map, track, roads, style, extra, plain, glow);
    if (extra.count) geos.set("extra", extra);
    chunks = [];
    for (const g of geos.values()) {
      const m = new THREE.Mesh(g.build(), facadeMat);
      m.castShadow = m.receiveShadow = true;
      chunks.push(m);
      group.add(m);
    }
    const local = new THREE.Group();
    for (const [geo, mat] of [[plain, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 })], [glow, glowMaterial("lm", 0.9)]] as const) {
      if (!geo.count) {
        mat.dispose();
        continue;
      }
      const m = new THREE.Mesh(geo.build(false), mat);
      m.castShadow = m.receiveShadow = true;
      local.add(m);
    }
    const ring = buildRing(map, style);
    const ringMat = ring.facade ? createFacadeMaterial(true).material : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    if (!ring.facade) {
      ringMat.onBeforeCompile = farPatch;
      ringMat.customProgramCacheKey = () => "ringFar1";
    }
    const ringMesh = new THREE.Mesh(ring.geo, ringMat);
    ringMesh.name = "ring";
    ringMesh.frustumCulled = false;
    local.add(ringMesh);
    if (style.neon) {
      const neon = buildNeon(map, track, roads, tier.detail);
      if (neon) local.add(neon);
    }
    group.add(local);
    const ground = map.id === "monaco" || map.id === "tokyo" || map.id === "sanfrancisco" ? buildGround(map, track, roads) : null;
    if (ground) group.add(ground.mesh);
    trees = createTrees(map, track, roads, style, blocker, tier);
    const water = createWater(map, track, roads, style, tier);
    props = createProps(map, track, roads, style, blocker, tier);
    const streets = buildStreets(map, track, roads, style);
    for (const p of [trees, water, props, stands, streets]) group.add(p.group);
    props.setNight(night);
    parts = [
      trees, water, props, stands, streets,
      { dispose: () => (disposeTree(local), ground?.dispose()) },
      { dispose: () => chunks.forEach((c) => c.geometry.dispose()) },
    ];
  }

  function clear() {
    for (const p of parts) p.dispose();
    parts = [];
    group.clear();
    trees = props = null;
  }

  build();

  return {
    group,
    setNight(n) {
      night = n;
      U.night.value = n;
      props?.setNight(n);
    },
    setQuality(q) {
      if (q === quality) return;
      quality = q;
      clear();
      build();
    },
    update(dt, camera) {
      U.time.value += Math.min(dt, 0.1);
      camera.getWorldPosition(camPos);
      if (camera instanceof THREE.PerspectiveCamera) RING_D.value = camera.far * 0.6;
      trees?.update(dt, camPos);
      for (const c of chunks) {
        const s = c.geometry.boundingSphere!;
        c.visible = s.center.distanceTo(camPos) - s.radius < tier.far;
      }
    },
    dispose() {
      clear();
      facadeMat.dispose();
    },
  };
}
