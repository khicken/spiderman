import * as THREE from "three";
import { CHUNK, MIN_Y, SECTIONS } from "../contracts";
import type { ChunkEvent, MeshBuffers, MeshInput, MeshOutput, WorldApi } from "../contracts";
import { meshSection } from "../mesh";
import { chunkKey, createMeshQueue, sectionKey } from "./mesh-queue";

interface Materials {
  opaque: THREE.Material;
  cutout: THREE.Material;
  translucent: THREE.Material;
}

interface Section {
  key: number;
  cx: number;
  cz: number;
  box: THREE.Box3;
  opaque: THREE.Mesh | null;
  cutout: THREE.Mesh | null;
  translucent: THREE.Mesh | null;
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
const LOCAL_BOX = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(CHUNK, CHUNK, CHUNK));
const LOCAL_SPHERE = new THREE.Sphere(new THREE.Vector3(8, 8, 8), Math.sqrt(3 * 64));
const MAX_IN_FLIGHT = 4;
const now = () => performance.now();

function toGeometry(b: MeshBuffers): THREE.BufferGeometry | null {
  if (!b.index.length) return null;
  const g = new THREE.BufferGeometry();
  for (const name in b.attributes) {
    const a = b.attributes[name];
    g.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized ?? false));
  }
  g.setIndex(new THREE.BufferAttribute(b.index, 1));
  g.boundingBox = LOCAL_BOX;
  g.boundingSphere = LOCAL_SPHERE;
  return g;
}

const _frustum = new THREE.Frustum();
const _proj = new THREE.Matrix4();

export function createChunkMeshes(world: WorldApi, scene: THREE.Scene, mats: Materials, workerCount: number) {
  const group = new THREE.Group();
  group.name = "chunks";
  scene.add(group);

  const queue = createMeshQueue();
  const ready = new Set<number>();
  const sections = new Map<number, Section>();
  const versions = new Map<number, number>();
  const inFlight = new Map<number, Pending>();
  const results: { p: Pending; out: MeshOutput }[] = [];
  const translucent: Section[] = [];
  let nextId = 1;
  let renderDistance = 12;
  let uploadMs = 4;

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
    if (ready.has(k) || !neighborsLoaded(cx, cz)) return;
    ready.add(k);
    queueChunk(cx, cz, false);
  }

  function disposeSection(s: Section) {
    for (const layer of LAYERS) {
      const m = s[layer];
      if (m) {
        group.remove(m);
        m.geometry.dispose();
        s[layer] = null;
      }
    }
    sections.delete(s.key);
  }

  function unloadChunk(cx: number, cz: number) {
    ready.delete(chunkKey(cx, cz));
    queue.removeChunk(cx, cz, SECTIONS);
    for (let sy = 0; sy < SECTIONS; sy++) {
      const key = sectionKey(cx, sy, cz);
      versions.delete(key);
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
        bump(sectionKey(e.cx, e.sy, e.cz));
        queue.push(e.cx, e.sy, e.cz, true);
      }
    }
  });

  function setLayer(s: Section, layer: (typeof LAYERS)[number], b: MeshBuffers | null, sy: number) {
    const g = b ? toGeometry(b) : null;
    let m = s[layer];
    if (!g) {
      if (m) {
        group.remove(m);
        m.geometry.dispose();
        s[layer] = null;
      }
      return;
    }
    if (m) {
      m.geometry.dispose();
      m.geometry = g;
      return;
    }
    m = new THREE.Mesh(g, mats[layer]);
    m.position.set(s.cx * CHUNK, MIN_Y + sy * CHUNK, s.cz * CHUNK);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.frustumCulled = false;
    m.renderOrder = layer === "opaque" ? 0 : layer === "cutout" ? 1 : 10;
    m.name = layer;
    group.add(m);
    s[layer] = m;
  }

  function apply(p: Pending, out: MeshOutput | null) {
    if (!ready.has(chunkKey(p.cx, p.cz))) return;
    if (versions.get(p.key) !== p.version) return;
    let s = sections.get(p.key);
    if (!out || (!out.opaque && !out.cutout && !out.translucent)) {
      if (s) disposeSection(s);
      return;
    }
    if (!s) {
      const x = p.cx * CHUNK, y = MIN_Y + p.sy * CHUNK, z = p.cz * CHUNK;
      s = {
        key: p.key, cx: p.cx, cz: p.cz,
        box: new THREE.Box3(new THREE.Vector3(x, y, z), new THREE.Vector3(x + CHUNK, y + CHUNK, z + CHUNK)),
        opaque: null, cutout: null, translucent: null, dist: 0,
      };
      sections.set(p.key, s);
    }
    for (const layer of LAYERS) setLayer(s, layer, out[layer], p.sy);
    if (!s.opaque && !s.cutout && !s.translucent) sections.delete(p.key);
  }

  // meshInput is null for an empty section and for missing neighbors. Only the first clears the mesh.
  function input(p: Pending): MeshInput | null {
    const inp = world.meshInput(p.cx, p.sy, p.cz);
    if (!inp && neighborsLoaded(p.cx, p.cz)) apply(p, null);
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
        w.w.postMessage({ id, input: inp });
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
    translucent.length = 0;
    for (const s of sections.values()) {
      const vis = Math.abs(s.cx - pcx) <= maxD && Math.abs(s.cz - pcz) <= maxD && _frustum.intersectsBox(s.box);
      if (s.opaque) s.opaque.visible = vis;
      if (s.cutout) s.cutout.visible = vis;
      if (s.translucent) {
        s.translucent.visible = vis;
        if (vis) {
          const dx = (s.box.min.x + 8) - px, dy = (s.box.min.y + 8) - py, dz = (s.box.min.z + 8) - pz;
          s.dist = dx * dx + dy * dy + dz * dz;
          translucent.push(s);
        }
      }
    }
    translucent.sort(byDistDesc);
    for (let k = 0; k < translucent.length; k++) translucent[k].translucent!.renderOrder = 10 + k;
  }

  return {
    group,
    update,
    pending: () => queue.size() + inFlight.size + results.length,
    sectionCount: () => sections.size,
    setRenderDistance(n: number) { renderDistance = n; },
    setUploadBudget(ms: number) { uploadMs = ms; },
    dispose() {
      off();
      for (const w of workers) w.w.terminate();
      workers.length = 0;
      for (const s of [...sections.values()]) disposeSection(s);
      scene.remove(group);
      queue.clear();
      inFlight.clear();
      results.length = 0;
      ready.clear();
    },
  };
}

const isLive = (w: PoolWorker) => !w.dead;
const byDistDesc = (a: Section, b: Section) => b.dist - a.dist;

export type ChunkMeshes = ReturnType<typeof createChunkMeshes>;
