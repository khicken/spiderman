import { deleteWorld, listWorlds, loadMeta, request, saveMeta, type SavedChunk, type WorldMeta } from "../world/save";
import type { EntitySave } from "../contracts";
import { account, deviceName, setAccount } from "./account";
import { ApiError, api } from "./api";
import { decodeChunk, decodeJson, encodeChunk, encodeJson, gunzip, gzip } from "./codec";
import { allStates, clearAllDirty, clearDirty, dirtyEntries, getState, setState, worldsWithDirty } from "./dirty";
import { packEntries, unpackEntries, type PackEntry } from "./pack";

export interface CloudWorld {
  id: string;
  name: string;
  rev: number;
  updatedAt: number;
  device: string;
  bytes: number;
  lastPlayed: number;
  gameMode: string;
  hardcore: boolean;
  cheats: boolean;
  icon?: string;
}

export type CloudStatus = "local" | "cloud" | "synced" | "upload" | "behind" | "conflict";
export type SyncResult = "synced" | "behind" | "conflict" | "offline" | "quota" | "error" | "skipped";

const BATCH_BYTES = 2.5 * 1024 * 1024;
const FETCH_BYTES = 3 * 1024 * 1024;
const AUTOSYNC_MS = 3 * 60 * 1000;

interface CloudList {
  worlds: CloudWorld[];
  used: number;
  quota: number;
}

interface CloudDoc {
  rev: number;
  base: number;
  updatedAt: number;
  device: string;
  entries: Record<string, { size: number; rev: number }>;
  meta: WorldMeta;
}

const isEntity = (entry: string) => entry.startsWith("e/");
const localKey = (id: string, entry: string) => (isEntity(entry) ? `${id}/${entry.slice(2)}` : `${id}/${entry}`);
const range = (id: string) => IDBKeyRange.bound(`${id}/`, `${id}/￿`);

async function localEntryKeys(id: string): Promise<string[]> {
  const [chunks, ents] = await Promise.all([
    request<IDBValidKey[]>("chunks", "readonly", (s) => s.getAllKeys(range(id))),
    request<IDBValidKey[]>("entities", "readonly", (s) => s.getAllKeys(range(id))),
  ]);
  const cut = id.length + 1;
  return [...chunks.map((k) => String(k).slice(cut)), ...ents.map((k) => `e/${String(k).slice(cut)}`)];
}

async function readEntry(id: string, entry: string): Promise<Uint8Array | null> {
  const store = isEntity(entry) ? "entities" : "chunks";
  const v = await request<SavedChunk | EntitySave[] | undefined>(store, "readonly", (s) => s.get(localKey(id, entry)));
  if (!v) return null;
  return gzip(isEntity(entry) ? encodeJson(v) : encodeChunk(v as SavedChunk));
}

async function writeEntry(id: string, entry: string, gz: Uint8Array) {
  const raw = await gunzip(gz);
  const store = isEntity(entry) ? "entities" : "chunks";
  const value = isEntity(entry) ? decodeJson<EntitySave[]>(raw) : decodeChunk(raw);
  await request(store, "readwrite", (s) => s.put(value, localKey(id, entry)));
}

const fail = (e: unknown): SyncResult => {
  if (e instanceof ApiError) {
    if (e.status === 0) return "offline";
    if (e.status === 409) return "conflict";
    if (e.status === 413) {
      setAccount({ error: e.message === "Request too large" ? "World data too large to sync" : "Cloud storage full (50 MB). Delete a cloud world." });
      return "quota";
    }
    if (e.status === 401) {
      setAccount({ user: null });
      return "skipped";
    }
  }
  console.warn("cloud sync failed", e);
  return "error";
};

const chains = new Map<string, Promise<unknown>>();
function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const next = (chains.get(id) ?? Promise.resolve()).then(fn, fn);
  chains.set(id, next.catch(() => {}));
  return next;
}

export const cloudList = () => api<CloudList>("/cloud/worlds");

export function syncWorld(id: string, opts: { force?: boolean } = {}): Promise<SyncResult> {
  return serial(id, async () => {
    const user = account().user;
    if (!user) return "skipped";
    try {
      const meta = await loadMeta(id);
      if (!meta) return "skipped";
      const [st, list, dirty] = await Promise.all([getState(user, id), cloudList(), dirtyEntries(id)]);
      const cloudRev = list.worlds.find((w) => w.id === id)?.rev ?? 0;
      const localRev = st?.rev ?? 0;
      const changed = !st || dirty.size > 0 || meta.lastPlayed > st.played;
      if (!opts.force && cloudRev !== localRev) return changed ? "conflict" : "behind";
      if (!opts.force && !changed) return "synced";
      const full = opts.force || !st;
      const keys = full ? await localEntryKeys(id) : [...dirty.keys()];
      const q = (force: boolean) => `?baseRev=${localRev}${force ? "&force=1" : ""}`;
      let batch: PackEntry[] = [];
      let size = 0;
      const flush = async () => {
        if (!batch.length) return;
        await api(`/cloud/worlds/${id}/chunks${q(!!opts.force)}`, { method: "PUT", body: packEntries(batch) });
        batch = [];
        size = 0;
      };
      const present: string[] = [];
      for (const entry of keys) {
        const data = await readEntry(id, entry);
        if (!data) continue;
        present.push(entry);
        if (size + data.length > BATCH_BYTES) await flush();
        batch.push([entry, data]);
        size += data.length;
      }
      await flush();
      const r = await api<{ rev: number }>(`/cloud/worlds/${id}`, {
        method: "PUT",
        json: { meta, baseRev: localRev, force: !!opts.force, device: deviceName(), keep: full ? present : undefined },
      });
      await setState(user, id, { rev: r.rev, played: meta.lastPlayed, at: Date.now() });
      await clearDirty(id, dirty);
      if (account().error) setAccount({ error: null });
      return "synced";
    } catch (e) {
      return fail(e);
    }
  });
}

export function pullWorld(id: string, mode: "update" | "replace"): Promise<SyncResult> {
  return serial(id, async () => {
    const user = account().user;
    if (!user) return "skipped";
    try {
      const doc = await api<CloudDoc>(`/cloud/worlds/${id}`);
      const [st, local] = await Promise.all([getState(user, id), loadMeta(id)]);
      const full = mode === "replace" || !local || !st || st.rev < doc.base;
      const since = full ? 0 : st.rev;
      const want = Object.entries(doc.entries).filter(([, e]) => e.rev > since);
      const got: PackEntry[] = [];
      while (want.length) {
        const group: string[] = [];
        let size = 0;
        while (want.length && (group.length === 0 || size + want[0][1].size <= FETCH_BYTES)) {
          const [k, e] = want.shift()!;
          group.push(k);
          size += e.size;
        }
        const part = unpackEntries(await api<Uint8Array>(`/cloud/worlds/${id}/chunks`, { method: "POST", json: { keys: group }, raw: true }));
        if (!part.length) throw new Error("download returned nothing");
        const back = new Set(part.map(([k]) => k));
        const last = group.indexOf(part[part.length - 1][0]);
        for (let i = group.length - 1; i > last; i--) want.unshift([group[i], doc.entries[group[i]]]);
        if (back.size < last + 1) console.warn("cloud: some world entries are missing in the cloud");
        got.push(...part.map(([k, d]): PackEntry => [k, d.slice()]));
      }
      if (full && local) await deleteWorld(id);
      for (const [k, d] of got) await writeEntry(id, k, d);
      await saveMeta({ ...doc.meta, id });
      await setState(user, id, { rev: doc.rev, played: doc.meta.lastPlayed, at: Date.now() });
      await clearAllDirty(id);
      return "synced";
    } catch (e) {
      return fail(e);
    }
  });
}

// Pulls cloud changes when this device has none, so Play opens the newest copy.
export async function prepareToPlay(id: string): Promise<"play" | "conflict"> {
  const r = await syncWorld(id);
  if (r === "behind") await pullWorld(id, "update");
  return r === "conflict" ? "conflict" : "play";
}

export async function worldStatuses(local: WorldMeta[]): Promise<{ status: Map<string, CloudStatus>; cloudOnly: CloudWorld[]; cloud: Map<string, CloudWorld>; used: number; quota: number } | null> {
  const user = account().user;
  if (!user) return null;
  let list: CloudList;
  try {
    list = await cloudList();
  } catch (e) {
    fail(e);
    return null;
  }
  const [states, dirty] = await Promise.all([allStates(user), worldsWithDirty()]);
  const cloud = new Map(list.worlds.map((w) => [w.id, w]));
  const status = new Map<string, CloudStatus>();
  for (const m of local) {
    const c = cloud.get(m.id);
    const st = states.get(m.id);
    if (!c) {
      status.set(m.id, "local");
      continue;
    }
    const changed = !st || dirty.has(m.id) || m.lastPlayed > st.played;
    if (st && c.rev === st.rev) status.set(m.id, changed ? "upload" : "synced");
    else status.set(m.id, changed ? "conflict" : "behind");
  }
  const ids = new Set(local.map((m) => m.id));
  const cloudOnly = list.worlds.filter((w) => !ids.has(w.id));
  for (const w of cloudOnly) status.set(w.id, "cloud");
  return { status, cloudOnly, cloud, used: list.used, quota: list.quota };
}

export async function syncPending(): Promise<void> {
  const view = await worldStatuses(await listWorlds());
  if (!view) return;
  for (const [id, s] of view.status) if (s === "upload" || s === "local") await syncWorld(id);
}

export function startAutosync(id: string): () => void {
  const t = setInterval(() => void syncWorld(id), AUTOSYNC_MS);
  return () => clearInterval(t);
}

export async function deleteCloudWorld(id: string) {
  const user = account().user;
  if (!user) return;
  await api(`/cloud/worlds/${id}`, { method: "DELETE" }).catch((e) => fail(e));
  await setState(user, id, null);
}
