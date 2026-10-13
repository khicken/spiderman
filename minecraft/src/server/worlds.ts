import type { BlobStore } from "./blobs";
import type { Kv } from "./kv";
import { isEntryKey, type PackEntry } from "../game/cloud/pack";

export const QUOTA_BYTES = 50 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 1024 * 1024;
export const MAX_META_BYTES = 1024 * 1024;
export const MAX_FETCH_BYTES = 3 * 1024 * 1024;
const MAX_ICON = 64 * 1024;
const MODES = new Set(["survival", "creative", "adventure", "spectator"]);

export interface EntryInfo {
  size: number;
  rev: number;
}

export interface WorldDoc {
  rev: number;
  base: number;
  updatedAt: number;
  device: string;
  metaBytes: number;
  entries: Record<string, EntryInfo>;
}

export interface WorldSummary {
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

type Index = Record<string, WorldSummary>;

export class CloudError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

const indexKey = (uid: string) => `mc:worlds:${uid}`;
const docKey = (uid: string, id: string) => `mc:world:${uid}:${id}`;
const blobKey = (uid: string, id: string, entry: string) => `${uid}/${id}/${entry}`;
const metaBlob = (uid: string, id: string) => `${uid}/${id}/meta`;

const docBytes = (d: WorldDoc) => d.metaBytes + Object.values(d.entries).reduce((n, e) => n + e.size, 0);

async function readIndex(kv: Kv, uid: string): Promise<Index> {
  const raw = await kv.get(indexKey(uid));
  return raw ? (JSON.parse(raw) as Index) : {};
}

async function readDoc(kv: Kv, uid: string, id: string): Promise<WorldDoc | null> {
  const raw = await kv.get(docKey(uid, id));
  return raw ? (JSON.parse(raw) as WorldDoc) : null;
}

const emptyDoc = (): WorldDoc => ({ rev: 0, base: 0, updatedAt: 0, device: "", metaBytes: 0, entries: {} });

const usedBy = (index: Index, skip: string) => Object.values(index).reduce((n, w) => (w.id === skip ? n : n + w.bytes), 0);

function quotaCheck(index: Index, id: string, nextBytes: number) {
  if (usedBy(index, id) + nextBytes > QUOTA_BYTES) throw new CloudError(413, "Cloud storage full (50 MB)", { quota: QUOTA_BYTES, used: usedBy(index, id) });
}

function revCheck(doc: WorldDoc | null, baseRev: number, force: boolean) {
  const rev = doc?.rev ?? 0;
  if (!force && rev !== baseRev) throw new CloudError(409, "This world was changed on another device", { rev, updatedAt: doc?.updatedAt ?? 0, device: doc?.device ?? "" });
}

export async function listWorlds(kv: Kv, uid: string): Promise<{ worlds: WorldSummary[]; used: number; quota: number }> {
  const index = await readIndex(kv, uid);
  return { worlds: Object.values(index).filter((w) => w.rev > 0), used: usedBy(index, ""), quota: QUOTA_BYTES };
}

export async function getWorld(kv: Kv, blobs: BlobStore, uid: string, id: string) {
  const doc = await readDoc(kv, uid, id);
  if (!doc || doc.rev === 0) return null;
  const meta = await blobs.get(metaBlob(uid, id));
  if (!meta) return null;
  return { rev: doc.rev, base: doc.base, updatedAt: doc.updatedAt, device: doc.device, entries: doc.entries, meta: JSON.parse(new TextDecoder().decode(meta)) as unknown };
}

export async function putEntries(kv: Kv, blobs: BlobStore, uid: string, id: string, entries: PackEntry[], baseRev: number, force: boolean) {
  for (const [key, data] of entries) {
    if (!isEntryKey(key)) throw new CloudError(400, "Bad entry key");
    if (data.length === 0 || data.length > MAX_ENTRY_BYTES) throw new CloudError(400, "Bad entry size");
  }
  const doc = (await readDoc(kv, uid, id)) ?? emptyDoc();
  revCheck(doc, baseRev, force);
  const index = await readIndex(kv, uid);
  const next: WorldDoc = { ...doc, entries: { ...doc.entries } };
  for (const [key, data] of entries) next.entries[key] = { size: data.length, rev: doc.rev + 1 };
  quotaCheck(index, id, docBytes(next));
  for (const [key, data] of entries) await blobs.put(blobKey(uid, id, key), data);
  await kv.set(docKey(uid, id), JSON.stringify(next));
  index[id] = { ...(index[id] ?? blank(id)), bytes: docBytes(next) };
  await kv.set(indexKey(uid), JSON.stringify(index));
  return { stored: entries.length };
}

const blank = (id: string): WorldSummary => ({ id, name: "", rev: 0, updatedAt: 0, device: "", bytes: 0, lastPlayed: 0, gameMode: "survival", hardcore: false, cheats: false });

export function checkMeta(id: string, meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new CloudError(400, "Bad world data");
  const m = meta as Record<string, unknown>;
  if (m.id !== id) throw new CloudError(400, "World id mismatch");
  if (typeof m.name !== "string" || m.name.length > 64) throw new CloudError(400, "Bad world name");
  if (typeof m.seed !== "number" || !Number.isFinite(m.seed)) throw new CloudError(400, "Bad seed");
  if (typeof m.gameMode !== "string" || !MODES.has(m.gameMode)) throw new CloudError(400, "Bad game mode");
  if (typeof m.lastPlayed !== "number") throw new CloudError(400, "Bad world data");
  if (m.icon !== undefined && (typeof m.icon !== "string" || !m.icon.startsWith("data:image/") || m.icon.length > MAX_ICON)) delete m.icon;
  return m;
}

export async function commitWorld(
  kv: Kv,
  blobs: BlobStore,
  uid: string,
  id: string,
  o: { meta: unknown; baseRev: number; force: boolean; device: string; keep?: string[] },
) {
  const meta = checkMeta(id, o.meta);
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  if (metaBytes.length > MAX_META_BYTES) throw new CloudError(413, "World data too large");
  const doc = (await readDoc(kv, uid, id)) ?? emptyDoc();
  revCheck(doc, o.baseRev, o.force);
  const rev = doc.rev + 1;
  const next: WorldDoc = { ...doc, rev, updatedAt: Date.now(), device: o.device.slice(0, 64), metaBytes: metaBytes.length, entries: { ...doc.entries } };
  const drop: string[] = [];
  if (o.keep) {
    const keep = new Set(o.keep);
    for (const k of Object.keys(next.entries)) if (!keep.has(k)) drop.push(k);
    for (const k of drop) delete next.entries[k];
    next.base = rev;
  }
  const index = await readIndex(kv, uid);
  quotaCheck(index, id, docBytes(next));
  await blobs.put(metaBlob(uid, id), metaBytes);
  await kv.set(docKey(uid, id), JSON.stringify(next));
  if (drop.length) await blobs.del(drop.map((k) => blobKey(uid, id, k)));
  index[id] = {
    id,
    name: String(meta.name),
    rev,
    updatedAt: next.updatedAt,
    device: next.device,
    bytes: docBytes(next),
    lastPlayed: Number(meta.lastPlayed),
    gameMode: String(meta.gameMode),
    hardcore: !!meta.hardcore,
    cheats: !!meta.cheats,
    icon: typeof meta.icon === "string" ? meta.icon : undefined,
  };
  await kv.set(indexKey(uid), JSON.stringify(index));
  return { rev, updatedAt: next.updatedAt };
}

export async function fetchEntries(kv: Kv, blobs: BlobStore, uid: string, id: string, keys: string[]): Promise<PackEntry[]> {
  const doc = await readDoc(kv, uid, id);
  if (!doc) throw new CloudError(404, "World not found");
  const out: PackEntry[] = [];
  let size = 0;
  for (const key of keys) {
    const info = doc.entries[key];
    if (!info || !isEntryKey(key)) continue;
    if (out.length && size + info.size > MAX_FETCH_BYTES) break;
    const data = await blobs.get(blobKey(uid, id, key));
    if (!data) continue;
    out.push([key, data]);
    size += data.length;
  }
  return out;
}

export async function deleteWorld(kv: Kv, blobs: BlobStore, uid: string, id: string) {
  const doc = await readDoc(kv, uid, id);
  if (doc) await blobs.del([...Object.keys(doc.entries).map((k) => blobKey(uid, id, k)), metaBlob(uid, id)]);
  await kv.del([docKey(uid, id)]);
  const index = await readIndex(kv, uid);
  delete index[id];
  await kv.set(indexKey(uid), JSON.stringify(index));
}

const profileKey = (uid: string) => `mc:profile:${uid}`;
export const MAX_PROFILE_BYTES = 64 * 1024;

export interface Profile {
  settings: Record<string, unknown> | null;
  packs: string[];
  playerName: string;
  updatedAt: number;
}

export function checkProfile(b: Record<string, unknown>): Profile {
  const settings = b.settings;
  if (settings !== null && (typeof settings !== "object" || Array.isArray(settings))) throw new CloudError(400, "Bad settings");
  const packs = b.packs;
  if (!Array.isArray(packs) || packs.length > 64 || packs.some((p) => typeof p !== "string" || p.length > 128)) throw new CloudError(400, "Bad packs");
  const name = typeof b.playerName === "string" ? b.playerName : "";
  if (!/^[A-Za-z0-9_]{0,16}$/.test(name)) throw new CloudError(400, "Bad player name");
  const at = Number(b.updatedAt);
  if (!Number.isFinite(at) || at <= 0) throw new CloudError(400, "Bad time");
  return { settings: (settings as Record<string, unknown> | null) ?? null, packs: packs as string[], playerName: name, updatedAt: Math.min(at, Date.now() + 60_000) };
}

export async function getProfile(kv: Kv, uid: string): Promise<Profile | null> {
  const raw = await kv.get(profileKey(uid));
  return raw ? (JSON.parse(raw) as Profile) : null;
}

export async function putProfile(kv: Kv, uid: string, p: Profile): Promise<Profile> {
  const cur = await getProfile(kv, uid);
  if (cur && cur.updatedAt > p.updatedAt) return cur;
  await kv.set(profileKey(uid), JSON.stringify(p));
  return p;
}
