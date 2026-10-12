import type { BlockBehavior, BlockEntityData, BlockState, ChunkData, ChunkEvent, Dim, EntitySave, GameCtx, WorldApi } from "../contracts";
import { MAX_Y, MIN_Y, SECTIONS, SET_DEFAULT, SET_NO_DROP, SET_NO_LIGHT, SET_NOTIFY } from "../contracts";
import { BLOCKS, LIGHT_FILTER, STATE_EMIT } from "../blocks/registry";
import { IMPLICIT_WATER, WATER_ID, WATER_SOURCE, canHoldWater } from "../blocks/waterlog";
import { BIOMES } from "../worldgen/biomes";
import { createGenPool, type GenPool } from "./gen-pool";
import { createLight } from "./light";
import { buildMeshInput } from "./mesh-input";
import { createQuery } from "./query";
import { loadChunk, saveChunk } from "./save";
import { chunkKey, createStore, wrapChunk, type Chunk } from "./store";
import { createTicker } from "./ticks";

export interface WorldOpts {
  seed: number;
  dim: Dim;
  worldId: string;
  behaviors: Record<string, BlockBehavior>;
  getCtx: () => GameCtx;
  // Synchronous generator for node tests or a worker-free fallback.
  generate?: (seed: number, dim: Dim, cx: number, cz: number) => ChunkData;
}

export interface World extends WorldApi {
  // Structure mobs placed by world gen. Returns them once, then clears them from the chunk.
  takeEntities(cx: number, cz: number): EntitySave[] | undefined;
  // Live chunk arrays for renderers that scan loaded chunks (enchanting books, sign text).
  chunkAt(cx: number, cz: number): { blocks: Uint16Array; be: Map<number, BlockEntityData> } | undefined;
}

const MAX_DEPTH = 64;
const ARRIVAL_BUDGET_MS = 6;
const DX6 = [1, -1, 0, 0, 0, 0];
const DY6 = [0, 0, 1, -1, 0, 0];
const DZ6 = [0, 0, 0, 0, 1, -1];

const offsetCache = new Map<number, Int32Array>();
function ringOffsets(r: number): Int32Array {
  let o = offsetCache.get(r);
  if (o) return o;
  const list: [number, number][] = [];
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) list.push([dx, dz]);
  list.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  o = new Int32Array(list.length * 2);
  list.forEach(([dx, dz], i) => {
    o![i * 2] = dx;
    o![i * 2 + 1] = dz;
  });
  offsetCache.set(r, o);
  return o;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function createWorld(opts: WorldOpts): World {
  const { seed, dim, worldId, behaviors } = opts;
  const hasSky = dim === "overworld";
  const store = createStore();
  const light = createLight(store, hasSky);
  const ticker = createTicker(store, behaviors);
  const tickable = ticker.tickable;
  const listeners = new Set<(e: ChunkEvent) => void>();
  const pool: GenPool | null = opts.generate || typeof Worker === "undefined" ? null : createGenPool();
  const generate = opts.generate;
  const useIdb = typeof indexedDB !== "undefined";
  const pending = new Set<number>();
  const arrivals: ChunkData[] = [];
  const saving = new Map<number, ChunkData>();
  let centerCx = NaN;
  let centerCz = NaN;
  let radius = -1;
  let wanted = ringOffsets(0);
  let wantIdx = 0;
  let scan = false;
  let lastTick = 0;
  let depth = 0;
  const notifyQ: number[] = [];
  let disposed = false;

  const emit = (e: ChunkEvent) => {
    for (const fn of listeners) fn(e);
  };

  const safeCtx = (): GameCtx | null => {
    try {
      return opts.getCtx() ?? null;
    } catch {
      return null;
    }
  };

  const flush = () => {
    for (const c of store.takeDirty()) {
      const mask = c.dirty;
      c.dirty = 0;
      if (!c.announced || store.get(c.cx, c.cz) !== c) continue;
      for (let sy = 0; sy < SECTIONS; sy++) if (mask & (1 << sy)) emit({ type: "dirty", cx: c.cx, cz: c.cz, sy });
    }
  };

  const isReady = (c: Chunk) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!store.get(c.cx + dx, c.cz + dz)) return false;
    return true;
  };

  const unannounce = (c: Chunk) => {
    if (!c.announced) return;
    c.announced = false;
    emit({ type: "unloaded", cx: c.cx, cz: c.cz });
  };

  const persist = (c: Chunk) => {
    c.data.blockEntities = [...c.be.values()];
    c.data.waterlogged = c.wl.size ? [...c.wl] : undefined;
    c.modified = false;
    if (!useIdb) return Promise.resolve();
    const data = c.data;
    saving.set(c.key, data);
    return saveChunk(worldId, data)
      .catch((e) => console.error("chunk save failed", e))
      .finally(() => {
        if (saving.get(c.key) === data) saving.delete(c.key);
      });
  };

  const unload = (c: Chunk) => {
    unannounce(c);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = store.get(c.cx + dx, c.cz + dz);
        if (n && n !== c) unannounce(n);
      }
    }
    if (c.modified) void persist(c);
    store.remove(c);
    scan = true;
  };

  const inRange = (cx: number, cz: number, extra: number) =>
    Math.abs(cx - centerCx) <= radius + extra && Math.abs(cz - centerCz) <= radius + extra;

  const arrive = (data: ChunkData) => {
    const key = chunkKey(data.cx, data.cz);
    pending.delete(key);
    if (disposed || store.chunks.has(key) || !inRange(data.cx, data.cz, 2)) return;
    const c = wrapChunk(data);
    store.add(c);
    light.lightChunk(c, tickable);
    ticker.unpark(key);
    scan = true;
  };

  const generateNow = (cx: number, cz: number) => {
    if (generate) arrivals.push(generate(seed, dim, cx, cz));
    else pool?.request(seed, dim, cx, cz, (c) => arrivals.push(c));
  };

  const request = (cx: number, cz: number) => {
    const key = chunkKey(cx, cz);
    pending.add(key);
    const cached = saving.get(key);
    if (cached) {
      arrivals.push(cached);
      return;
    }
    if (!useIdb) {
      generateNow(cx, cz);
      return;
    }
    loadChunk(worldId, dim, cx, cz)
      .then((saved) => {
        if (disposed) return;
        if (saved) arrivals.push(saved);
        else generateNow(cx, cz);
      })
      .catch(() => {
        if (!disposed) generateNow(cx, cz);
      });
  };

  const announceScan = () => {
    const near = ringOffsets(radius);
    for (let i = 0; i < near.length; i += 2) {
      const c = store.get(centerCx + near[i], centerCz + near[i + 1]);
      if (c && !c.announced && isReady(c)) {
        c.announced = true;
        emit({ type: "loaded", cx: c.cx, cz: c.cz });
      }
    }
  };

  const recompute = (cx: number, cz: number, r: number) => {
    centerCx = cx;
    centerCz = cz;
    radius = r;
    const drop: Chunk[] = [];
    for (const c of store.chunks.values()) {
      const d = Math.max(Math.abs(c.cx - cx), Math.abs(c.cz - cz));
      if (d > r + 2) drop.push(c);
      else if (d > r + 1) unannounce(c);
    }
    for (const c of drop) unload(c);
    wanted = ringOffsets(r + 1);
    wantIdx = 0;
    scan = true;
  };

  const callNeighbor = (ctx: GameCtx, nx: number, ny: number, nz: number, fx: number, fy: number, fz: number) => {
    const ns = query.getBlock(nx, ny, nz);
    if (ns === 0) return;
    if (IMPLICIT_WATER[ns & 0xfff] || store.get(nx >> 4, nz >> 4)?.wl.has(((ny - MIN_Y) << 8) | ((nz & 15) << 4) | (nx & 15))) {
      ticker.schedule(nx, ny, nz, WATER_ID, lastTick + 5);
    }
    behaviors[BLOCKS[ns & 0xfff]?.name]?.neighborChanged?.(ctx, nx, ny, nz, ns, fx, fy, fz);
  };

  const notifyNeighbors = (ctx: GameCtx, x: number, y: number, z: number) => {
    for (let d = 0; d < 6; d++) {
      const nx = x + DX6[d];
      const ny = y + DY6[d];
      const nz = z + DZ6[d];
      if (ny < MIN_Y || ny > MAX_Y) continue;
      if (depth > MAX_DEPTH) notifyQ.push(nx, ny, nz, x, y, z);
      else callNeighbor(ctx, nx, ny, nz, x, y, z);
    }
  };

  const drain = (ctx: GameCtx) => {
    depth = 1;
    let i = 0;
    while (i < notifyQ.length) {
      callNeighbor(ctx, notifyQ[i], notifyQ[i + 1], notifyQ[i + 2], notifyQ[i + 3], notifyQ[i + 4], notifyQ[i + 5]);
      i += 6;
    }
    notifyQ.length = 0;
    depth = 0;
  };

  const setBlock = (x: number, y: number, z: number, s: BlockState, flags = SET_DEFAULT): boolean => {
    if (y < MIN_Y || y > MAX_Y) return false;
    const c = store.get(x >> 4, z >> 4);
    if (!c) return false;
    const lx = x & 15;
    const lz = z & 15;
    const col = (lz << 4) | lx;
    const i = ((y - MIN_Y) << 8) | col;
    const old = c.blocks[i];
    const wasWet = c.wl.has(i) || IMPLICIT_WATER[old & 0xfff] === 1;
    if (s === 0 && wasWet) s = WATER_SOURCE;
    if (old === s) return false;
    const holds = canHoldWater(s) && (wasWet || old === WATER_SOURCE) && !IMPLICIT_WATER[s & 0xfff];
    if (holds) c.wl.add(i);
    else c.wl.delete(i);
    const oid = old & 0xfff;
    const nid = s & 0xfff;
    c.blocks[i] = s;
    c.modified = true;
    const sec = (y - MIN_Y) >> 4;
    if (oid === 0) c.counts[sec]++;
    if (nid === 0) c.counts[sec]--;
    c.tickable[sec] += tickable[nid] - tickable[oid];

    const hm = c.data.heightmap;
    if (nid !== 0 && y > hm[col]) hm[col] = y;
    else if (nid === 0 && y === hm[col]) {
      let h = y - 1;
      while (h >= MIN_Y && c.blocks[((h - MIN_Y) << 8) | col] === 0) h--;
      hm[col] = h;
    }
    const top = c.skyTop[col];
    if (LIGHT_FILTER[nid] > 0 && y >= top) c.skyTop[col] = y + 1;
    else if (LIGHT_FILTER[nid] === 0 && y === top - 1) {
      let h = y - 1;
      while (h >= MIN_Y && LIGHT_FILTER[c.blocks[((h - MIN_Y) << 8) | col] & 0xfff] === 0) h--;
      c.skyTop[col] = h + 1;
    }
    const lostBe = oid !== nid ? c.be.get(i) : undefined;
    if (lostBe) c.be.delete(i);
    store.markDirty(c, lx, y, lz);
    if (!(flags & SET_NO_LIGHT) && (LIGHT_FILTER[oid] !== LIGHT_FILTER[nid] || STATE_EMIT[old] !== STATE_EMIT[s])) {
      light.update(x, y, z);
    }
    flush();

    const ctx = safeCtx();
    if (!ctx) return true;
    ctx.emit({ type: "block_changed", x, y, z, from: old, to: s });
    if (lostBe?.items && !(flags & SET_NO_DROP)) {
      for (const st of lostBe.items) if (st && st.count > 0) ctx.entities.dropItem(st, x + 0.25 + ctx.random() * 0.5, y + 0.25 + ctx.random() * 0.5, z + 0.25 + ctx.random() * 0.5);
    }
    depth++;
    try {
      if (oid !== nid) {
        if (oid) behaviors[BLOCKS[oid]?.name]?.onRemoved?.(ctx, x, y, z, old);
        if (nid) behaviors[BLOCKS[nid]?.name]?.onPlaced?.(ctx, x, y, z, s);
      }
      if (flags & SET_NOTIFY) notifyNeighbors(ctx, x, y, z);
      if (holds || IMPLICIT_WATER[nid]) ticker.schedule(x, y, z, WATER_ID, lastTick + 5);
    } finally {
      depth--;
      if (depth === 0 && notifyQ.length) drain(ctx);
    }
    return true;
  };

  const lightAt = (x: number, y: number, z: number, shift: number) => {
    if (y > MAX_Y) return shift && hasSky ? 15 : 0;
    if (y < MIN_Y) return 0;
    const c = store.get(x >> 4, z >> 4);
    if (!c) return shift && hasSky ? 15 : 0;
    return (c.light[((y - MIN_Y) << 8) | ((z & 15) << 4) | (x & 15)] >> shift) & 15;
  };

  let api: World;
  const query = createQuery(store, behaviors, () => api);

  api = {
    dim,
    seed,
    getBlock: query.getBlock,
    setBlock,
    getSkyLight: (x, y, z) => lightAt(x, y, z, 4),
    getBlockLight: (x, y, z) => lightAt(x, y, z, 0),
    getBiome(x, z) {
      const c = store.get(x >> 4, z >> 4);
      return (c && BIOMES[c.data.biomes[((z & 15) << 4) | (x & 15)]]) || BIOMES[0];
    },
    topY(x, z) {
      const c = store.get(x >> 4, z >> 4);
      return c ? c.data.heightmap[((z & 15) << 4) | (x & 15)] : MIN_Y - 1;
    },
    isLoaded: (x, z) => !!store.get(x >> 4, z >> 4),
    raycast: query.raycast,
    collide: query.collide,
    scheduleTick(x, y, z, delay) {
      const id = query.getBlock(x, y, z) & 0xfff;
      ticker.schedule(x, y, z, id, lastTick + Math.max(1, delay | 0));
    },
    blockEntitiesIn(cx, cz) {
      return store.get(cx, cz)?.be.values();
    },
    getBlockEntity(x, y, z) {
      if (y < MIN_Y || y > MAX_Y) return undefined;
      return store.get(x >> 4, z >> 4)?.be.get(((y - MIN_Y) << 8) | ((z & 15) << 4) | (x & 15));
    },
    setBlockEntity(be: BlockEntityData | null, x, y, z) {
      if (y < MIN_Y || y > MAX_Y) return;
      const c = store.get(x >> 4, z >> 4);
      if (!c) return;
      const i = ((y - MIN_Y) << 8) | ((z & 15) << 4) | (x & 15);
      if (be) {
        be.x = x;
        be.y = y;
        be.z = z;
        c.be.set(i, be);
      } else c.be.delete(i);
      c.modified = true;
    },
    isWaterlogged(x, y, z) {
      if (y < MIN_Y || y > MAX_Y) return false;
      const c = store.get(x >> 4, z >> 4);
      if (!c) return false;
      const i = ((y - MIN_Y) << 8) | ((z & 15) << 4) | (x & 15);
      return c.wl.has(i) || IMPLICIT_WATER[c.blocks[i] & 0xfff] === 1;
    },
    setWaterlogged(x, y, z, on) {
      if (y < MIN_Y || y > MAX_Y) return false;
      const c = store.get(x >> 4, z >> 4);
      if (!c) return false;
      const i = ((y - MIN_Y) << 8) | ((z & 15) << 4) | (x & 15);
      const s = c.blocks[i];
      if (IMPLICIT_WATER[s & 0xfff] || (on && !canHoldWater(s)) || on === c.wl.has(i)) return false;
      if (on) c.wl.add(i);
      else c.wl.delete(i);
      c.modified = true;
      store.markDirty(c, x & 15, y, z & 15);
      flush();
      const ctx = safeCtx();
      if (!ctx) return true;
      ctx.emit({ type: "block_changed", x, y, z, from: s, to: s });
      depth++;
      try {
        notifyNeighbors(ctx, x, y, z);
        if (on) ticker.schedule(x, y, z, WATER_ID, lastTick + 5);
      } finally {
        depth--;
        if (depth === 0 && notifyQ.length) drain(ctx);
      }
      return true;
    },
    meshInput: (cx, sy, cz) => buildMeshInput(store, cx, sy, cz, hasSky),
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    update(centerX, centerZ, r) {
      if (disposed) return;
      const cx = Math.floor(centerX) >> 4;
      const cz = Math.floor(centerZ) >> 4;
      if (cx !== centerCx || cz !== centerCz || r !== radius) recompute(cx, cz, r);

      const start = now();
      let n = 0;
      while (arrivals.length && (n === 0 || now() - start < ARRIVAL_BUDGET_MS)) {
        arrive(arrivals.shift()!);
        n++;
      }

      const cap = pool ? pool.size * 3 : 2;
      let issued = 0;
      while (wantIdx < wanted.length && pending.size - arrivals.length < cap && issued < cap) {
        const ox = centerCx + wanted[wantIdx];
        const oz = centerCz + wanted[wantIdx + 1];
        wantIdx += 2;
        const key = chunkKey(ox, oz);
        if (store.chunks.has(key) || pending.has(key)) continue;
        request(ox, oz);
        issued++;
      }

      if (scan) {
        scan = false;
        announceScan();
      }
      flush();
    },
    tick(ctx) {
      lastTick = ctx.time.tick;
      const p = ctx.player?.body?.pos;
      ticker.run(ctx, p ? Math.floor(p.x) : centerCx << 4, p ? Math.floor(p.z) : centerCz << 4);
      flush();
    },
    loadedChunks: () => store.chunks.size,
    pendingChunks: () => pending.size + (wanted.length - wantIdx) / 2,
    ready(x, z) {
      const c = store.get(Math.floor(x) >> 4, Math.floor(z) >> 4);
      return !!c && isReady(c);
    },
    async save() {
      const jobs: Promise<void>[] = [];
      for (const c of store.chunks.values()) if (c.modified) jobs.push(persist(c));
      await Promise.all(jobs);
    },
    chunkAt: (cx, cz) => store.get(cx, cz),
    takeEntities(cx, cz) {
      const c = store.get(cx, cz);
      const list = c?.data.entities;
      if (!c || !list) return undefined;
      c.data.entities = undefined;
      c.modified = true;
      return list;
    },
    dispose() {
      disposed = true;
      pool?.dispose();
      for (const c of store.chunks.values()) store.remove(c);
      store.chunks.clear();
      store.takeDirty();
      listeners.clear();
      ticker.clear();
      arrivals.length = 0;
      pending.clear();
    },
  };
  return api;
}
