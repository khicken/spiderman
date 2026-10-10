import * as THREE from "three";
import type { Quality, Scenery, Track } from "./contracts";
import { updateLamps } from "./render-lamps";
import { cancelJob, runNow, runSoon } from "./render-shared";
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

  // A generator, so a quality switch can build the new set across frames while the old one stays on screen.
  function* build(q: Quality): Generator<void, void> {
    const t = TIERS[q];
    const out = new THREE.Group();
    const { chunks: geos, blocker } = buildBuildings(map, track, roads, style, t.detail, CHUNK);
    yield;
    const extra = new Geo(), plain = new Geo(), glow = new Geo();
    const stands = createStands(map, track, roads, style, blocker, t, extra);
    buildLandmarks(map, track, roads, style, extra, plain, glow);
    if (extra.count) geos.set("extra", extra);
    const nextChunks: THREE.Mesh[] = [];
    for (const g of geos.values()) {
      const m = new THREE.Mesh(g.build(), facadeMat);
      m.castShadow = m.receiveShadow = true;
      nextChunks.push(m);
      out.add(m);
    }
    yield;
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
      const neon = buildNeon(map, track, roads, t.detail);
      if (neon) local.add(neon);
    }
    out.add(local);
    yield;
    const ground = map.id === "monaco" || map.id === "tokyo" || map.id === "sanfrancisco" ? buildGround(map, track, roads) : null;
    if (ground) out.add(ground.mesh);
    yield;
    const nextTrees = createTrees(map, track, roads, style, blocker, t);
    yield;
    const water = createWater(map, track, roads, style, t);
    const nextProps = createProps(map, track, roads, style, blocker, t);
    yield;
    const streets = buildStreets(map, track, roads, style);
    for (const p of [nextTrees, water, nextProps, stands, streets]) out.add(p.group);
    nextProps.setNight(night);
    clear();
    group.add(out);
    quality = q;
    tier = t;
    chunks = nextChunks;
    trees = nextTrees;
    props = nextProps;
    parts = [
      nextTrees, water, nextProps, stands, streets,
      { dispose: () => (disposeTree(local), ground?.dispose()) },
      { dispose: () => nextChunks.forEach((c) => c.geometry.dispose()) },
    ];
  }

  function clear() {
    for (const p of parts) p.dispose();
    parts = [];
    group.clear();
    trees = props = null;
  }

  let job: Generator<void, void> | null = null;
  runNow(build(quality));

  return {
    group,
    setNight(n) {
      night = n;
      U.night.value = n;
      props?.setNight(n);
    },
    setQuality(q) {
      const busy = cancelJob(job);
      job = q === quality && !busy ? null : runSoon(build(q));
    },
    update(dt, camera) {
      U.time.value += Math.min(dt, 0.1);
      camera.getWorldPosition(camPos);
      if (camera instanceof THREE.PerspectiveCamera) RING_D.value = camera.far * 0.6;
      trees?.update(dt, camPos);
      updateLamps(camera, night);
      for (const c of chunks) {
        const s = c.geometry.boundingSphere!;
        c.visible = s.center.distanceTo(camPos) - s.radius < tier.far;
      }
    },
    dispose() {
      cancelJob(job);
      clear();
      facadeMat.dispose();
    },
  };
}
