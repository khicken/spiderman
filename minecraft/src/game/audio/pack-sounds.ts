import { onPacksChanged, packSound, type PackSound } from "../packs";

export type PackLookup = (event: string) => PackSound[] | null;

export interface PackClip {
  buffer: AudioBuffer;
  volume: number;
  pitch: number;
  attenuation: number;
  stream: boolean;
}

export const packLookup = (): PackLookup => packSound;
export const onPackChange = onPacksChanged;

export function pickPackClip(look: PackLookup, event: string): PackClip | null {
  const list = look(event);
  if (!list?.length) return null;
  let total = 0;
  for (const s of list) total += Math.max(0, s.weight);
  if (total <= 0) return null;
  let x = Math.random() * total;
  let chosen = list[list.length - 1];
  for (const s of list) {
    x -= Math.max(0, s.weight);
    if (x <= 0) {
      chosen = s;
      break;
    }
  }
  return { buffer: chosen.buffer, volume: chosen.volume, pitch: chosen.pitch, attenuation: chosen.attenuation_distance, stream: chosen.stream };
}
