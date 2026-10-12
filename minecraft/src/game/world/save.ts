import type { BlockEntityData, ChunkData, Dim, EntitySave, GameMode, Rules } from "../contracts";

export interface WorldMeta {
  id: string;
  name: string;
  seed: number;
  gameMode: GameMode;
  hardcore: boolean;
  created: number;
  lastPlayed: number;
  dim: Dim;
  dayTime: number;
  tick: number;
  rules: Rules;
  player?: unknown;
  inventory?: unknown;
  version: 1;
  cheats: boolean;
  rain?: number;
  thunder?: number;
  spawn?: { x: number; y: number; z: number };
  icon?: string; // data URL screenshot taken on quit
}

export interface SavedChunk {
  blocks: Uint16Array;
  light: Uint8Array;
  biomes: Uint8Array;
  heightmap: Int16Array;
  blockEntities?: BlockEntityData[];
  entities?: EntitySave[];
  waterlogged?: number[];
  caveBiomes?: Uint8Array;
}

const DB_NAME = "minecraft";
const DB_VERSION = 1;
const hasIdb = () => typeof indexedDB !== "undefined";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("worlds")) db.createObjectStore("worlds", { keyPath: "id" });
        if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks");
        if (!db.objectStoreNames.contains("entities")) db.createObjectStore("entities");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

function request<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const chunkSaveKey = (worldId: string, dim: Dim, cx: number, cz: number) => `${worldId}/${dim}/${cx},${cz}`;

export const defaultRules = (cheats = false): Rules => ({
  difficulty: "normal",
  keepInventory: false,
  doDaylightCycle: true,
  doMobSpawning: true,
  mobGriefing: true,
  doFireTick: true,
  randomTickSpeed: 3,
  cheats,
});

export async function listWorlds(): Promise<WorldMeta[]> {
  if (!hasIdb()) return [];
  const all = await request<WorldMeta[]>("worlds", "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.lastPlayed - a.lastPlayed);
}

export async function loadMeta(id: string): Promise<WorldMeta | null> {
  if (!hasIdb()) return null;
  return (await request<WorldMeta | undefined>("worlds", "readonly", (s) => s.get(id))) ?? null;
}

export async function saveMeta(meta: WorldMeta): Promise<void> {
  if (!hasIdb()) return;
  await request("worlds", "readwrite", (s) => s.put(meta));
}

export async function createWorldMeta(
  name: string,
  seed: number,
  gameMode: GameMode,
  opts: { hardcore?: boolean; cheats?: boolean; rules?: Partial<Rules> } = {},
): Promise<WorldMeta> {
  const now = Date.now();
  const cheats = opts.cheats ?? gameMode === "creative";
  const meta: WorldMeta = {
    id: `w${now.toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`,
    name: name.trim() || "New World",
    seed,
    gameMode: opts.hardcore ? "survival" : gameMode,
    hardcore: !!opts.hardcore,
    created: now,
    lastPlayed: now,
    dim: "overworld",
    dayTime: 0,
    tick: 0,
    rules: { ...defaultRules(cheats), ...opts.rules, difficulty: opts.hardcore ? "hard" : opts.rules?.difficulty ?? "normal" },
    version: 1,
    cheats,
  };
  await saveMeta(meta);
  return meta;
}

export async function deleteWorld(id: string): Promise<void> {
  if (!hasIdb()) return;
  const range = IDBKeyRange.bound(`${id}/`, `${id}/￿`);
  await request("worlds", "readwrite", (s) => s.delete(id));
  await request("chunks", "readwrite", (s) => s.delete(range));
  await request("entities", "readwrite", (s) => s.delete(range));
}

export async function saveChunk(worldId: string, chunk: ChunkData): Promise<void> {
  if (!hasIdb()) return;
  const value: SavedChunk = {
    blocks: chunk.blocks,
    light: chunk.light,
    biomes: chunk.biomes,
    heightmap: chunk.heightmap,
    blockEntities: chunk.blockEntities,
    entities: chunk.entities,
    waterlogged: chunk.waterlogged,
    caveBiomes: chunk.caveBiomes,
  };
  await request("chunks", "readwrite", (s) => s.put(value, chunkSaveKey(worldId, chunk.dim, chunk.cx, chunk.cz)));
}

export async function loadChunk(worldId: string, dim: Dim, cx: number, cz: number): Promise<ChunkData | null> {
  if (!hasIdb()) return null;
  const v = await request<SavedChunk | undefined>("chunks", "readonly", (s) => s.get(chunkSaveKey(worldId, dim, cx, cz)));
  if (!v) return null;
  return { cx, cz, dim, ...v };
}

export async function saveEntities(worldId: string, dim: Dim, list: EntitySave[]): Promise<void> {
  if (!hasIdb()) return;
  await request("entities", "readwrite", (s) => s.put(list, `${worldId}/${dim}`));
}

export async function loadEntities(worldId: string, dim: Dim): Promise<EntitySave[]> {
  if (!hasIdb()) return [];
  return (await request<EntitySave[] | undefined>("entities", "readonly", (s) => s.get(`${worldId}/${dim}`))) ?? [];
}

const MAX_LONG = BigInt("9223372036854775807");
const MIN_LONG = BigInt("-9223372036854775808");

export function javaHashCode(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return h;
}

// Vanilla reads a numeric string as a long and hashes any other text.
export function parseSeed(text: string): number {
  const t = text.trim();
  if (!t) return randomSeed();
  if (/^[+-]?\d+$/.test(t)) {
    const big = BigInt(t);
    if (big <= MAX_LONG && big >= MIN_LONG) {
      const n = Number(big);
      if (Number.isSafeInteger(n)) return n;
      return Number(BigInt.asIntN(32, big ^ (big >> BigInt(32))));
    }
  }
  return javaHashCode(t);
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296) - 2147483648;
}
