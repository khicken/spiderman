// Resource pack stack. The built-in Claude pack is the procedural art in textures/, ui/, render/, entities/ and audio/.
// Player packs only override files they contain; every lookup that misses falls back to Claude.
import { toStrip, type AnimMeta, type Strip } from "./anim";
import { crop, type Img } from "./img";
import { decodePng } from "./png";
import { deletePack, listPacks, loadPackFiles, type PackMeta } from "./store";

export type { Img } from "./img";
export type { PackMeta } from "./store";
export const CLAUDE_ID = "claude";
export const PACK_FORMAT = 34;

const SEL_KEY = "mc.resourcePacks";

interface SoundEntry {
  name: string;
  weight: number;
  stream: boolean;
  event: boolean;
  volume: number;
  pitch: number;
  attenuation: number;
}

// One playable variant with its sounds.json fields; the audio module picks by weight.
export interface PackSound {
  buffer: AudioBuffer;
  volume: number;
  pitch: number;
  weight: number;
  attenuation_distance: number;
  stream: boolean;
}

let images = new Map<string, Img>();
let metas = new Map<string, AnimMeta>();
let sounds = new Map<string, SoundEntry[]>();
let soundFiles = new Map<string, Uint8Array>();
const decoded = new Map<string, PackSound[] | null>();
let version = 0;
let active: string[] = [];
const listeners = new Set<() => void>();
let applying: Promise<void> | null = null;
let inited = false;

const hasDom = () => typeof document !== "undefined";

export function selectedPacks(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SEL_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x !== CLAUDE_ID) : [];
  } catch {
    return [];
  }
}

function saveSelection(ids: string[]) {
  try {
    localStorage.setItem(SEL_KEY, JSON.stringify(ids.filter((x) => x !== CLAUDE_ID)));
  } catch {
    // Private mode: the selection lasts for this page only.
  }
}

// Cache key for derived art; also bumps around withClaudeOnly. stackVersion only changes when the selection is applied.
export const packVersion = () => version;
let applied = 0;
export const stackVersion = () => applied;
export const activePacks = () => active;

export function onPacksChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Path under assets/minecraft/textures/ without ".png", e.g. "block/stone", "gui/sprites/hud/heart/full".
export const packImage = (path: string): Img | null => images.get(path) ?? null;
export const packMeta = (path: string): AnimMeta | null => metas.get(path) ?? null;
export const hasPackImage = (path: string) => images.has(path);
export const packImagePaths = () => images.keys();

// First animation frame for block, item and particle textures that may be vertical strips.
const tiles = new Map<string, Img>();
let tilesV = -1;
export function packTile(path: string): Img | null {
  const img = images.get(path);
  if (!img) return null;
  if (img.h <= img.w || img.h % img.w !== 0) return img;
  if (tilesV !== version) {
    tiles.clear();
    tilesV = version;
  }
  let t = tiles.get(path);
  if (!t) {
    const f = metas.get(path)?.frames?.[0];
    const i = typeof f === "number" ? f : f?.index ?? 0;
    t = crop(img, 0, Math.min(img.h / img.w - 1, Math.max(0, i)) * img.w, img.w, img.w);
    tiles.set(path, t);
  }
  return t;
}

export function packStrip(path: string): Strip | null {
  const img = images.get(path);
  if (!img) return null;
  const meta = metas.get(path) ?? null;
  return toStrip(img, meta ?? (img.h > img.w ? { frametime: 1 } : null));
}

// Runs fn synchronously as if only the Claude pack were selected. Version bumps make every cache re-derive afterwards.
export function withClaudeOnly<T>(fn: () => T): T {
  const saved = active;
  active = [];
  version++;
  try {
    return fn();
  } finally {
    active = saved;
    version++;
  }
}

export async function initPacks(): Promise<void> {
  if (inited || !hasDom()) return;
  inited = true;
  if (process.env.NODE_ENV !== "production")
    (window as unknown as { __mcPacks: unknown }).__mcPacks = {
      coverage: (probe?: string) => import("./coverage").then((m) => m.packCoverage(probe)),
      exportClaudePack: () => import("./export").then((m) => m.exportClaudePack()),
      select: setSelectedPacks,
      list: listAllPacks,
    };
  if (selectedPacks().length) await applyPacks(selectedPacks());
}

export async function setSelectedPacks(ids: string[]): Promise<void> {
  saveSelection(ids);
  await applyPacks(ids.filter((x) => x !== CLAUDE_ID));
}

export async function listAllPacks(): Promise<PackMeta[]> {
  try {
    return (await listPacks()).sort((a, b) => b.added - a.added);
  } catch {
    return [];
  }
}

export async function removePack(id: string): Promise<void> {
  await deletePack(id);
  const sel = selectedPacks();
  if (sel.includes(id)) await setSelectedPacks(sel.filter((x) => x !== id));
}

// A full vanilla pack (client jar or complete pack) goes above Claude as soon as it is added.
export async function selectIfVanilla(meta: PackMeta): Promise<boolean> {
  if (!meta.vanilla) return false;
  await setSelectedPacks([meta.id, ...selectedPacks().filter((x) => x !== meta.id)]);
  return true;
}

async function pool<T>(items: T[], n: number, f: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await f(items[i++]);
  }));
}

const fin = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);

function mergeSounds(target: Map<string, SoundEntry[]>, bytes: Uint8Array) {
  let doc: Record<string, { replace?: boolean; sounds?: (string | { name: string; weight?: number; stream?: boolean; type?: string; volume?: number; pitch?: number; attenuation_distance?: number })[] }>;
  try {
    doc = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return;
  }
  for (const [event, def] of Object.entries(doc ?? {})) {
    const list: SoundEntry[] = (def?.sounds ?? []).map((s) =>
      typeof s === "string"
        ? { name: s, weight: 1, stream: false, event: false, volume: 1, pitch: 1, attenuation: 16 }
        : {
            name: s.name,
            weight: Math.max(1, s.weight ?? 1),
            stream: !!s.stream,
            event: s.type === "event",
            volume: fin(s.volume, 1),
            pitch: fin(s.pitch, 1),
            attenuation: fin(s.attenuation_distance, 16),
          },
    );
    target.set(event, def?.replace || !target.has(event) ? list : [...(target.get(event) ?? []), ...list]);
  }
}

// ids are top first. Decodes every winning texture once; consumers read them synchronously afterwards.
export function applyPacks(ids: string[]): Promise<void> {
  const run = async () => {
    const files = new Map<string, Uint8Array>();
    const nextSounds = new Map<string, SoundEntry[]>();
    const nextFiles = new Map<string, Uint8Array>();
    const loaded: string[] = [];
    const known = new Set((await listAllPacks()).map((p) => p.id));
    const stack = ids.filter((id) => known.has(id));
    const perPack = await Promise.all(stack.map((id) => loadPackFiles(id).catch(() => new Map<string, Uint8Array>())));
    for (let k = perPack.length - 1; k >= 0; k--) {
      const pf = perPack[k];
      loaded.unshift(stack[k]);
      for (const [p, b] of pf) {
        if (p.startsWith("textures/")) files.set(p, b);
        else if (p.startsWith("sounds/")) nextFiles.set(p, b);
      }
      const sj = pf.get("sounds.json");
      if (sj) mergeSounds(nextSounds, sj);
    }
    const nextImages = new Map<string, Img>();
    const nextMetas = new Map<string, AnimMeta>();
    const pngs = [...files].filter(([p]) => p.endsWith(".png"));
    await pool(pngs, 16, async ([p, b]) => {
      try {
        nextImages.set(p.slice(9, -4), await decodePng(b));
      } catch (e) {
        console.warn(`pack texture ${p} failed`, e);
      }
    });
    for (const [p, b] of files) {
      if (!p.endsWith(".png.mcmeta")) continue;
      try {
        const a = JSON.parse(new TextDecoder().decode(b))?.animation;
        if (a && typeof a === "object") nextMetas.set(p.slice(9, -11), a as AnimMeta);
      } catch {
        // A broken .mcmeta leaves the texture still.
      }
    }
    images = nextImages;
    metas = nextMetas;
    sounds = nextSounds;
    soundFiles = nextFiles;
    decoded.clear();
    active = loaded;
    version++;
    applied++;
    for (const cb of [...listeners]) {
      try {
        cb();
      } catch (e) {
        console.warn("pack listener failed", e);
      }
    }
  };
  const p = (applying ?? Promise.resolve()).then(run, run);
  applying = p;
  return p;
}

let audioCtx: BaseAudioContext | null = null;
function decoder(): BaseAudioContext | null {
  if (!audioCtx && typeof OfflineAudioContext !== "undefined") audioCtx = new OfflineAudioContext(1, 1, 44100);
  return audioCtx;
}

interface Leaf {
  path: string;
  volume: number;
  pitch: number;
  weight: number;
  attenuation: number;
  stream: boolean;
}

// An entry of type "event" points at another event; its volume and pitch multiply the referenced entries.
function soundLeaves(event: string, depth = 0, vol = 1, pitch = 1): Leaf[] {
  const list = sounds.get(event);
  if (!list || depth > 4) return [];
  const out: Leaf[] = [];
  for (const s of list) {
    if (s.event) out.push(...soundLeaves(s.name, depth + 1, vol * s.volume, pitch * s.pitch));
    else out.push({ path: `sounds/${s.name.replace(/^minecraft:/, "")}.ogg`, volume: vol * s.volume, pitch: pitch * s.pitch, weight: s.weight, attenuation: s.attenuation, stream: s.stream });
  }
  return out;
}

export const hasPackSound = (event: string) => sounds.has(event);

// Decodes on first use, so the first call for an event returns null while it loads; callers fall back to synthesis.
export function packSound(event: string): PackSound[] | null {
  if (decoded.has(event)) return decoded.get(event) ?? null;
  if (!sounds.has(event)) return null;
  void packSoundAsync(event);
  return null;
}

export async function packSoundAsync(event: string): Promise<PackSound[] | null> {
  if (decoded.has(event)) return decoded.get(event) ?? null;
  const ctx = decoder();
  const leaves = soundLeaves(event).filter((l) => soundFiles.has(l.path));
  if (!ctx || !leaves.length) return null;
  decoded.set(event, null);
  const v = version;
  const cache = new Map<string, Promise<AudioBuffer | null>>();
  const one = (p: string) => {
    let c = cache.get(p);
    if (!c) {
      const b = soundFiles.get(p) as Uint8Array;
      c = ctx.decodeAudioData(b.slice().buffer).catch(() => null);
      cache.set(p, c);
    }
    return c;
  };
  const bufs = await Promise.all(leaves.map((l) => one(l.path)));
  if (v !== version) return null;
  const list: PackSound[] = [];
  leaves.forEach((l, i) => {
    const buffer = bufs[i];
    if (buffer) list.push({ buffer, volume: l.volume, pitch: l.pitch, weight: l.weight, attenuation_distance: l.attenuation, stream: l.stream });
  });
  const out = list.length ? list : null;
  decoded.set(event, out);
  return out;
}
