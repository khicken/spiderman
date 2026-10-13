import * as packs from "../packs";

export type PackLookup = (event: string) => unknown;

export interface PackClip {
  buffer: AudioBuffer;
  volume: number;
  pitch: number;
  attenuation: number;
  stream: boolean;
}

interface Entry {
  buffer?: AudioBuffer;
  sound?: AudioBuffer;
  volume?: number;
  pitch?: number;
  weight?: number;
  attenuation_distance?: number;
  stream?: boolean;
}

const isBuffer = (v: unknown): v is AudioBuffer => typeof v === "object" && v !== null && typeof (v as AudioBuffer).getChannelData === "function";

// Accepts AudioBuffer[] (weights already expanded) or entry objects carrying sounds.json fields.
export function packLookup(): PackLookup {
  const fn = (packs as Record<string, unknown>).packSound;
  if (typeof fn !== "function") return () => null;
  return (event) => {
    try {
      return (fn as (e: string) => unknown)(event);
    } catch {
      return null;
    }
  };
}

export function pickPackClip(look: PackLookup, event: string): PackClip | null {
  const list = look(event);
  if (!Array.isArray(list) || list.length === 0) return null;
  let total = 0;
  for (const it of list) total += isBuffer(it) ? 1 : Math.max(0, (it as Entry)?.weight ?? 1);
  if (total <= 0) return null;
  let x = Math.random() * total;
  let chosen: unknown = list[list.length - 1];
  for (const it of list) {
    x -= isBuffer(it) ? 1 : Math.max(0, (it as Entry)?.weight ?? 1);
    if (x <= 0) { chosen = it; break; }
  }
  if (isBuffer(chosen)) return { buffer: chosen, volume: 1, pitch: 1, attenuation: 16, stream: chosen.duration > 10 };
  const e = chosen as Entry;
  const buffer = e?.buffer ?? e?.sound;
  if (!isBuffer(buffer)) return null;
  return { buffer, volume: e.volume ?? 1, pitch: e.pitch ?? 1, attenuation: e.attenuation_distance ?? 16, stream: e.stream ?? buffer.duration > 10 };
}

export function onPackChange(cb: () => void): () => void {
  const fn = (packs as Record<string, unknown>).onPacksChanged;
  if (typeof fn !== "function") return () => undefined;
  try {
    return (fn as (c: () => void) => () => void)(cb);
  } catch {
    return () => undefined;
  }
}
