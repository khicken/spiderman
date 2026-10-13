import { savePack, type PackFiles, type PackMeta } from "./store";
import { readZip } from "./zip";

const NS = "assets/minecraft/";
const ASSET = /^(textures\/.+\.(png|mcmeta)|sounds\/.+\.ogg|sounds\.json|font\/.+\.(png|json))$/;
function wanted(p: string): boolean {
  const i = p.indexOf(NS);
  return i >= 0 ? ASSET.test(p.slice(i + NS.length)) : /(^|\/)(pack\.mcmeta|pack\.png|version\.json)$/.test(p);
}

function flatten(d: unknown): string {
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map(flatten).join("");
  if (d && typeof d === "object") {
    const o = d as { text?: unknown; translate?: unknown; extra?: unknown };
    return flatten(o.text ?? o.translate ?? "") + flatten(o.extra ?? "");
  }
  return d == null ? "" : String(d);
}

const json = (b: Uint8Array | undefined): unknown => {
  if (!b) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b).replace(/^﻿/, ""));
  } catch {
    return null;
  }
};

export async function buildPack(name: string, raw: Map<string, Uint8Array>, jarHint: boolean): Promise<{ meta: PackMeta; files: PackFiles }> {
  let root = "";
  for (const p of raw.keys()) {
    const i = p.indexOf(NS);
    if (i >= 0) {
      root = p.slice(0, i);
      break;
    }
    if (p.endsWith("pack.mcmeta")) root = p.slice(0, -"pack.mcmeta".length);
  }
  const files: PackFiles = new Map();
  let bytes = 0, blocks = 0;
  for (const [p, b] of raw) {
    if (!p.startsWith(root)) continue;
    const rel = p.slice(root.length);
    if (!rel.startsWith(NS) || !ASSET.test(rel.slice(NS.length))) continue;
    const key = rel.slice(NS.length);
    files.set(key, b);
    bytes += b.length;
    if (key.startsWith("textures/block/") && key.endsWith(".png")) blocks++;
  }
  if (!files.size) throw new Error("No assets/minecraft files found");
  const mc = json(raw.get(root + "pack.mcmeta")) as { pack?: { pack_format?: number; description?: unknown } } | null;
  const version = json(raw.get(root + "version.json")) as { pack_version?: number | { resource?: number }; name?: string } | null;
  const jar = jarHint || !!version;
  const vanilla = jar || (blocks > 600 && files.has("textures/block/stone.png"));
  const pv = version?.pack_version;
  const format = (typeof pv === "object" ? pv?.resource : pv) ?? mc?.pack?.pack_format ?? 34;
  const desc = jar ? "The default look and feel of Minecraft" : flatten(mc?.pack?.description ?? "").replace(/§./g, "");
  const meta: PackMeta = {
    id: `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: jar ? `Default${version?.name ? ` (${version.name})` : ""}` : name.replace(/\.(zip|jar)$/i, ""),
    description: desc,
    format,
    icon: raw.get(root + "pack.png") ?? null,
    vanilla,
    files: files.size,
    bytes,
    added: Date.now(),
  };
  return { meta, files };
}

export async function importZip(file: File): Promise<PackMeta> {
  const raw = await readZip(new Uint8Array(await file.arrayBuffer()), wanted);
  const jar = /\.jar$/i.test(file.name) || [...raw.keys()].some((k) => k === "version.json");
  const { meta, files } = await buildPack(file.name, raw, jar);
  await savePack(meta, files);
  return meta;
}

async function readEntry(entry: FileSystemEntry, out: Map<string, Uint8Array>, base: string): Promise<void> {
  const path = base ? `${base}/${entry.name}` : entry.name;
  if (entry.isFile) {
    if (!wanted(path)) return;
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.set(path, new Uint8Array(await file.arrayBuffer()));
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    await Promise.all(batch.map((e) => readEntry(e, out, path)));
  }
}

export async function importFolderEntry(entry: FileSystemEntry): Promise<PackMeta> {
  const raw = new Map<string, Uint8Array>();
  await readEntry(entry, raw, "");
  const { meta, files } = await buildPack(entry.name, raw, false);
  await savePack(meta, files);
  return meta;
}

// <input webkitdirectory> gives files with webkitRelativePath.
export async function importFileList(list: File[]): Promise<PackMeta[]> {
  const zips = list.filter((f) => /\.(zip|jar)$/i.test(f.name) && !f.webkitRelativePath.includes("/assets/"));
  const loose = list.filter((f) => !zips.includes(f) && wanted(f.webkitRelativePath || f.name));
  const out: PackMeta[] = [];
  for (const z of zips) out.push(await importZip(z));
  if (loose.length) {
    const raw = new Map<string, Uint8Array>();
    await Promise.all(loose.map(async (f) => raw.set(f.webkitRelativePath || f.name, new Uint8Array(await f.arrayBuffer()))));
    const name = (loose[0].webkitRelativePath || "Pack").split("/")[0];
    const { meta, files } = await buildPack(name, raw, false);
    await savePack(meta, files);
    out.push(meta);
  }
  return out;
}

export async function importDrop(dt: DataTransfer): Promise<PackMeta[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  const files = [...dt.files];
  const out: PackMeta[] = [];
  for (const e of entries) {
    if (e.isDirectory) out.push(await importFolderEntry(e));
    else {
      const f = files.find((x) => x.name === e.name);
      if (f && /\.(zip|jar)$/i.test(f.name)) out.push(await importZip(f));
    }
  }
  return out;
}
