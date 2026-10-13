import * as THREE from "three";
import { CHUNK, MIN_Y, SECTIONS } from "../contracts";
import type { ChunkEvent, MeshBuffers, MeshInput, MeshOutput, WorldApi } from "../contracts";
import { GFX, meshSection } from "../mesh";
import { ALL_VIS } from "../mesh/vis";
import { createCaveCull } from "./cave-cull";
import { createSectionBatches } from "./section-batch";
import { chunkKey, createMeshQueue, sectionKey } from "./mesh-queue";

interface Materials {
  opaque: THREE.Material;
  cutout: THREE.Material;
  translucent: THREE.Material;
}

interface Section {
  key: number;
  cx: number;
  sy: number;
  cz: number;
  box: THREE.Box3;
  opaque: boolean;
  cutout: boolean;
  translucent: boolean;
  dist: number;
}

interface Pending {
  key: number;
  version: number;
  cx: number;
  sy: number;
  cz: number;
  w?: PoolWorker;
}

interface PoolWorker {
  w: Worker;
  busy: number;
  dead: boolean;
}

const LAYERS = ["opaque", "cutout", "translucent"] as const;
const MAX_IN_FLIGHT = 4;
const now = () => performance.now();

const _frustum = new THREE.Frustum();
const _proj = new THREE.Matrix4();

export function createChunkMeshes(world: WorldApi, scene: THREE.Scene, mats: Materials, workerCount: number, gl: WebGL2RenderingContext) {
  const group = new THREE.Group();
  group.name = "chunks";
  scene.add(group);

  const queue = createMeshQueue();
  const ready = new Set<number>();
  const starved = new Set<number>();
  const sections = new Map<number, Section>();
  const versions = new Map<number, number>();
  const meshedOnce = new Set<number>();
  const inFlight = new Map<number, Pending>();
  const results: { p: Pending; out: MeshOutput }[] = [];
  const drawList: Section[] = [];
  const batches = {
    opaque: createSectionBatches(gl, group, mats.opaque, 0, "opaque"),
    cutout: createSectionBatches(gl, group, mats.cutout, 1, "cutout"),
    translucent: createSectionBatches(gl, group, mats.translucent, 10, "translucent"),
  };
  let nextId = 1;
  let renderDistance = 12;
  let uploadMs = 4;
  let visible = 0;
  const cave = createCaveCull((cx, cz) => ready.has(chunkKey(cx, cz)));

  const workers: PoolWorker[] = [];
  function spawnWorkers(n: number) {
    for (let i = 0; i < n; i++) {
      let w: Worker;
      try {
        w = new Worker(new URL("../mesh/mesh.worker.ts", import.meta.url), { type: "module" });
      } catch (err) {
        console.warn("mesh worker failed to start, meshing on main thread", err);
        return;
      }
      const pw: PoolWorker = { w, busy: 0, dead: false };
      w.onmessage = (e: MessageEvent<{ id: number; out: MeshOutput }>) => {
        const p = inFlight.get(e.data.id);
        if (!p) return;
        inFlight.delete(e.data.id);
        pw.busy--;
        results.push({ p, out: e.data.out });
      };
      w.onerror = (e) => {
        console.warn("mesh worker error, meshing on main thread", e.message);
        pw.dead = true;
        for (const [id, p] of inFlight) {
          if (p.w !== pw) continue;
          inFlight.delete(id);
          queue.push(p.cx, p.sy, p.cz, false);
        }
      };
      workers.push(pw);
    }
  }
  if (typeof Worker !== "undefined") spawnWorkers(Math.max(1, workerCount));

  function bump(key: number) {
    const v = (versions.get(key) ?? 0) + 1;
    versions.set(key, v);
    return v;
  }

  function neighborsLoaded(cx: number, cz: number) {
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        if (!world.isLoaded((cx + dx) * CHUNK, (cz + dz) * CHUNK)) return false;
    return true;
  }

  function queueChunk(cx: number, cz: number, fast: boolean) {
    for (let sy = 0; sy < SECTIONS; sy++) {
      bump(sectionKey(cx, sy, cz));
      queue.push(cx, sy, cz, fast);
    }
  }

  function tryReady(cx: number, cz: number) {
    const k = chunkKey(cx, cz);
    if (starved.has(k) && neighborsLoaded(cx, cz)) {
      starved.delete(k);
      queueChunk(cx, cz, false);
    }
    if (ready.has(k) || !neighborsLoaded(cx, cz)) return;
    ready.add(k);
    cave.touch();
    queueChunk(cx, cz, false);
  }

  function disposeSection(s: Section) {
    for (const layer of LAYERS) {
      if (s[layer]) batches[layer].remove(s.key);
      s[layer] = false;
    }
    sections.delete(s.key);
  }

  function unloadChunk(cx: number, cz: number) {
    ready.delete(chunkKey(cx, cz));
    starved.delete(chunkKey(cx, cz));
    cave.clearChunk(cx, cz);
    queue.removeChunk(cx, cz, SECTIONS);
    for (let sy = 0; sy < SECTIONS; sy++) {
      const key = sectionKey(cx, sy, cz);
      versions.delete(key);
      meshedOnce.delete(key);
      const s = sections.get(key);
      if (s) disposeSection(s);
    }
  }

  const off = world.on((e: ChunkEvent) => {
    if (e.type === "loaded") {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) tryReady(e.cx + dx, e.cz + dz);
    } else if (e.type === "unloaded") {
      unloadChunk(e.cx, e.cz);
    } else if (ready.has(chunkKey(e.cx, e.cz))) {
      if (e.sy === undefined) queueChunk(e.cx, e.cz, false);
      else if (e.sy >= 0 && e.sy < SECTIONS) {
        const key = sectionKey(e.cx, e.sy, e.cz);
        bump(key);
        // Only shown sections jump the queue. A light spill into a never-meshed section must not starve the spawn area.
        queue.push(e.cx, e.sy, e.cz, meshedOnce.has(key));
      }
    }
  });

  function setLayer(s: Section, layer: (typeof LAYERS)[number], b: MeshBuffers | null) {
    if (!b || !b.index.length) {
      if (s[layer]) batches[layer].remove(s.key);
      s[layer] = false;
      return;
    }
    batches[layer].set(s.key, b, s.cx * CHUNK, MIN_Y + s.sy * CHUNK, s.cz * CHUNK);
    s[layer] = true;
  }

  function apply(p: Pending, out: MeshOutput | null) {
    if (!ready.has(chunkKey(p.cx, p.cz))) return;
    if (versions.get(p.key) !== p.version) return;
    meshedOnce.add(p.key);
    let s = sections.get(p.key);
    cave.setVis(p.key, out?.vis ?? ALL_VIS);
    if (!out || (!out.opaque && !out.cutout && !out.translucent)) {
      if (s) disposeSection(s);
      return;
    }
    if (!s) {
      const x = p.cx * CHUNK, y = MIN_Y + p.sy * CHUNK, z = p.cz * CHUNK;
      s = {
        key: p.key, cx: p.cx, sy: p.sy, cz: p.cz,
        box: new THREE.Box3(new THREE.Vector3(x, y, z), new THREE.Vector3(x + CHUNK, y + CHUNK, z + CHUNK)),
        opaque: false, cutout: false, translucent: false, dist: 0,
      };
      sections.set(p.key, s);
    }
    for (const layer of LAYERS) setLayer(s, layer, out[layer]);
    if (!s.opaque && !s.cutout && !s.translucent) sections.delete(p.key);
  }

  // meshInput is null for an empty section and for missing neighbors. Only the first clears the mesh;
  // the second marks the chunk so the neighbor's next "loaded" event meshes it again.
  function input(p: Pending): MeshInput | null {
    const inp = world.meshInput(p.cx, p.sy, p.cz);
    if (!inp) {
      if (neighborsLoaded(p.cx, p.cz)) apply(p, null);
      else if (ready.has(chunkKey(p.cx, p.cz))) starved.add(chunkKey(p.cx, p.cz));
    }
    return inp;
  }

  function freeWorker(): PoolWorker | null {
    let best: PoolWorker | null = null;
    for (const w of workers) if (!w.dead && w.busy < MAX_IN_FLIGHT && (!best || w.busy < best.busy)) best = w;
    return best;
  }

  function popPending(): Pending | null {
    const j = queue.pop();
    if (!j) return null;
    return { key: j.key, version: versions.get(j.key) ?? 0, cx: j.cx, sy: j.sy, cz: j.cz };
  }

  function update(camera: THREE.PerspectiveCamera) {
    const t0 = now();
    queue.setCamera(camera.position.x, camera.position.y, camera.position.z);

    while (queue.hasFast() && now() - t0 < uploadMs) {
      const p = popPending();
      if (!p) break;
      const inp = input(p);
      if (inp) apply(p, meshSection(inp));
    }

    const live = workers.some(isLive);
    while (now() - t0 < uploadMs) {
      if (live) {
        const w = freeWorker();
        if (!w) break;
        const p = popPending();
        if (!p) break;
        const inp = input(p);
        if (!inp) continue;
        const id = nextId++;
        p.w = w;
        inFlight.set(id, p);
        w.busy++;
        w.w.postMessage({ id, input: inp, fancyLeaves: GFX.fancyLeaves });
      } else {
        const p = popPending();
        if (!p) break;
        const inp = input(p);
        if (inp) apply(p, meshSection(inp));
      }
    }

    const t1 = now();
    let i = 0;
    while (i < results.length && (i === 0 || now() - t1 < uploadMs)) {
      apply(results[i].p, results[i].out);
      i++;
    }
    if (i) results.splice(0, i);

    cull(camera);
  }

  function cull(camera: THREE.PerspectiveCamera) {
    _proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_proj);
    const px = camera.position.x, py = camera.position.y, pz = camera.position.z;
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const maxD = renderDistance + 1;
    cave.update(pcx, Math.floor((py - MIN_Y) / CHUNK), pcz, maxD, now());
    visible = 0;
    batches.opaque.begin();
    batches.cutout.begin();
    batches.translucent.begin();
    for (const s of sections.values()) {
      if (!(Math.abs(s.cx - pcx) <= maxD && Math.abs(s.cz - pcz) <= maxD && cave.visible(s.cx, s.sy, s.cz) && _frustum.intersectsBox(s.box))) continue;
      const dx = (s.box.min.x + 8) - px, dy = (s.box.min.y + 8) - py, dz = (s.box.min.z + 8) - pz;
      s.dist = dx * dx + dy * dy + dz * dz;
      drawList[visible++] = s;
    }
    drawList.length = visible;
    drawList.sort(byDist);
    for (let k = 0; k < visible; k++) {
      const s = drawList[k];
      if (s.opaque) batches.opaque.draw(s.key);
      if (s.cutout) batches.cutout.draw(s.key);
    }
    for (let k = visible - 1; k >= 0; k--) if (drawList[k].translucent) batches.translucent.draw(drawList[k].key);
    batches.opaque.end();
    batches.cutout.end();
    batches.translucent.end();
  }

  return {
    group,
    update,
    pending: () => queue.size() + inFlight.size + results.length,
    chunkMeshed(cx: number, cz: number) {
      if (!ready.has(chunkKey(cx, cz))) return false;
      for (let sy = 0; sy < SECTIONS; sy++) {
        const key = sectionKey(cx, sy, cz);
        if (queue.has(key)) return false;
        for (const p of inFlight.values()) if (p.key === key) return false;
        for (const r of results) if (r.p.key === key) return false;
      }
      return true;
    },
    sectionCount: () => sections.size,
    counts: () => ({
      pages: batches.opaque.pageCount() + batches.cutout.pageCount() + batches.translucent.pageCount(),
      verts: batches.opaque.usedVerts() + batches.cutout.usedVerts() + batches.translucent.usedVerts(),
      sections: sections.size, visible, queued: queue.size(), inFlight: inFlight.size, results: results.length, workers: workers.length }),
    setRenderDistance(n: number) { renderDistance = n; },
    remeshAll() {
      for (const k of ready) queueChunk(Math.floor(k / 65536) - 32768, (k % 65536) - 32768, false);
    },
    setUploadBudget(ms: number) { uploadMs = ms; },
    dispose() {
      off();
      for (const w of workers) w.w.terminate();
      workers.length = 0;
      for (const s of [...sections.values()]) disposeSection(s);
      for (const layer of LAYERS) batches[layer].dispose();
      scene.remove(group);
      queue.clear();
      inFlight.clear();
      results.length = 0;
      ready.clear();
      starved.clear();
      meshedOnce.clear();
      cave.clear();
    },
  };
}

const isLive = (w: PoolWorker) => !w.dead;
const byDist = (a: Section, b: Section) => a.dist - b.dist;

export type ChunkMeshes = ReturnType<typeof createChunkMeshes>;
