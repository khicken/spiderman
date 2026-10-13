// Local change tracking for cloud sync, in its own database so the world save schema never changes for it.
const DB = "minecraft-cloud";
const hasIdb = () => typeof indexedDB !== "undefined";

export interface SyncState {
  rev: number;
  played: number; // meta.lastPlayed at the last sync
  at: number;
}

let dbp: Promise<IDBDatabase> | null = null;
let stampSeq = 0;

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("dirty");
      r.result.createObjectStore("state");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => {
      dbp = null;
      reject(r.error);
    };
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve((req ? req.result : undefined) as T);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

const range = (worldId: string) => IDBKeyRange.bound(`${worldId}/`, `${worldId}/￿`);

export function markDirty(worldId: string, entry: string) {
  if (!hasIdb()) return;
  const stamp = Date.now() * 1000 + (stampSeq++ % 1000);
  tx("dirty", "readwrite", (s) => s.put(stamp, `${worldId}/${entry}`)).catch((e) => console.warn("cloud: mark dirty failed", e));
}

export async function dirtyEntries(worldId: string): Promise<Map<string, number>> {
  if (!hasIdb()) return new Map();
  const prefix = worldId.length + 1;
  const [keys, vals] = await Promise.all([
    tx<IDBValidKey[]>("dirty", "readonly", (s) => s.getAllKeys(range(worldId))),
    tx<number[]>("dirty", "readonly", (s) => s.getAll(range(worldId))),
  ]);
  const out = new Map<string, number>();
  keys.forEach((k, i) => out.set(String(k).slice(prefix), vals[i]));
  return out;
}

// Deletes a mark only if no save happened after the upload read it.
export async function clearDirty(worldId: string, done: Map<string, number>) {
  if (!hasIdb() || !done.size) return;
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction("dirty", "readwrite");
    const s = t.objectStore("dirty");
    for (const [entry, stamp] of done) {
      const key = `${worldId}/${entry}`;
      const g = s.get(key);
      g.onsuccess = () => {
        if (g.result === stamp) s.delete(key);
      };
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function clearAllDirty(worldId: string) {
  if (hasIdb()) await tx("dirty", "readwrite", (s) => s.delete(range(worldId)));
}

const stateKey = (user: string, worldId: string) => `${user.toLowerCase()}/${worldId}`;

export async function getState(user: string, worldId: string): Promise<SyncState | null> {
  if (!hasIdb()) return null;
  return (await tx<SyncState | undefined>("state", "readonly", (s) => s.get(stateKey(user, worldId)))) ?? null;
}

export async function allStates(user: string): Promise<Map<string, SyncState>> {
  const out = new Map<string, SyncState>();
  if (!hasIdb()) return out;
  const prefix = `${user.toLowerCase()}/`;
  const r = IDBKeyRange.bound(prefix, `${prefix}￿`);
  const [keys, vals] = await Promise.all([
    tx<IDBValidKey[]>("state", "readonly", (s) => s.getAllKeys(r)),
    tx<SyncState[]>("state", "readonly", (s) => s.getAll(r)),
  ]);
  keys.forEach((k, i) => out.set(String(k).slice(prefix.length), vals[i]));
  return out;
}

export async function setState(user: string, worldId: string, st: SyncState | null) {
  if (!hasIdb()) return;
  await tx("state", "readwrite", (s) => (st ? s.put(st, stateKey(user, worldId)) : s.delete(stateKey(user, worldId))));
}

export async function worldsWithDirty(): Promise<Set<string>> {
  if (!hasIdb()) return new Set();
  const keys = await tx<IDBValidKey[]>("dirty", "readonly", (s) => s.getAllKeys());
  return new Set(keys.map((k) => String(k).split("/")[0]));
}
