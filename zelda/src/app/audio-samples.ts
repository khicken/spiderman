// HOLLOWMERE audio: the sample loader. One SampleBank for SFX, ambience beds and voice (T11 reuses it for instruments).
// A manifest lists clip ids with one or more takes. take(id) rotates through the takes and never repeats the previous one.
// Owner: audio (T12).
import type { SampleBank } from "./contracts";

export interface ManifestClip {
  files?: string[];
  file?: string;
}
export interface Manifest {
  version?: number;
  boot?: string[]; // ids that must be decoded before load() resolves
  clips: Record<string, ManifestClip | string | string[]>;
  loops?: Record<string, boolean>;
}

/** Pure take rotation. Exported so the offline test can drive it without a browser. */
export interface TakePicker {
  pick(id: string, n: number): number;
}
export function createTakePicker(seed = 1): TakePicker {
  const last = new Map<string, number>();
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  return {
    pick(id, n) {
      if (n <= 1) return 0;
      const prev = last.get(id);
      let i = Math.floor(rnd() * n);
      if (i === prev) i = (i + 1 + Math.floor(rnd() * (n - 1))) % n;
      last.set(id, i);
      return i;
    },
  };
}

export interface BankOpts {
  fetchFn?: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;
  seed?: number;
}

export interface BankPlus extends SampleBank {
  /** A specific take, no rotation (used for beds and looped material). */
  first(id: string): AudioBuffer | null;
  count(id: string): number;
  ids(): string[];
  isLoop(id: string): boolean;
  /** Decode the rest of the manifests in the background after the boot set is ready. */
  whenAll(): Promise<void>;
}

function norm(c: ManifestClip | string | string[]): string[] {
  if (typeof c === "string") return [c];
  if (Array.isArray(c)) return c;
  return c.files ?? (c.file ? [c.file] : []);
}

function resolve(base: string, file: string): string {
  if (/^(https?:)?\/\//.test(file) || file.startsWith("/")) return file;
  const i = base.lastIndexOf("/");
  return (i < 0 ? "" : base.slice(0, i + 1)) + file;
}

function decode(ac: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // Callback form: older Safari has no promise-returning decodeAudioData.
  return new Promise((res, rej) => {
    try {
      const p = ac.decodeAudioData(data, res, rej);
      if (p && typeof (p as Promise<AudioBuffer>).catch === "function") (p as Promise<AudioBuffer>).catch(rej);
    } catch (e) {
      rej(e);
    }
  });
}

export function createSampleBank(ac: BaseAudioContext, opts: BankOpts = {}): BankPlus {
  const f = opts.fetchFn ?? ((u: string) => fetch(u));
  const takes = new Map<string, (AudioBuffer | null)[]>();
  const loops = new Set<string>();
  const picker = createTakePicker(opts.seed ?? 12345);
  const pending: Promise<void>[] = [];

  async function loadFile(url: string): Promise<AudioBuffer | null> {
    try {
      const r = await f(url);
      if (!r.ok) return null;
      return await decode(ac, await r.arrayBuffer());
    } catch {
      return null;
    }
  }

  async function loadId(base: string, id: string, files: string[]): Promise<void> {
    const arr: (AudioBuffer | null)[] = takes.get(id) ?? [];
    takes.set(id, arr);
    await Promise.all(
      files.map(async (file, i) => {
        arr[i] = await loadFile(resolve(base, file));
      }),
    );
  }

  const bank: BankPlus = {
    async load(manifestUrl, onProgress) {
      let m: Manifest;
      try {
        const r = await f(manifestUrl);
        if (!r.ok) throw new Error(String(r.status));
        m = (await r.json()) as Manifest;
      } catch {
        onProgress?.(1);
        return;
      }
      const ids = Object.keys(m.clips ?? {});
      for (const id of ids) if (m.loops?.[id]) loops.add(id);
      const boot = new Set((m.boot ?? []).filter((id) => id in m.clips));
      const bootIds = ids.filter((id) => boot.has(id));
      const rest = ids.filter((id) => !boot.has(id));
      let done = 0;
      const tick = () => onProgress?.(bootIds.length ? ++done / bootIds.length : 1);
      await Promise.all(bootIds.map((id) => loadId(manifestUrl, id, norm(m.clips[id])).then(tick)));
      if (!bootIds.length) onProgress?.(1);
      // The remaining clips load a few at a time so a slow phone connection is not swamped.
      const queue = rest.slice();
      const worker = async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) await loadId(manifestUrl, id, norm(m.clips[id]));
      };
      pending.push(Promise.all([worker(), worker(), worker()]).then(() => undefined));
    },
    take(id) {
      const arr = takes.get(id);
      if (!arr) return null;
      // count the loaded takes, pick an index among them, then walk to it: no array per play
      let n = 0;
      for (let i = 0; i < arr.length; i++) if (arr[i]) n++;
      if (!n) return null;
      let k = picker.pick(id, n);
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
        if (b && k-- === 0) return b;
      }
      return null;
    },
    first(id) {
      const arr = takes.get(id);
      if (!arr) return null;
      for (const b of arr) if (b) return b;
      return null;
    },
    has(id) {
      const arr = takes.get(id);
      if (!arr) return false;
      for (const b of arr) if (b) return true;
      return false;
    },
    ids() {
      return Array.from(takes.keys());
    },
    count(id) {
      const arr = takes.get(id);
      return arr ? arr.filter(Boolean).length : 0;
    },
    isLoop(id) {
      return loops.has(id);
    },
    async whenAll() {
      await Promise.all(pending);
    },
  };
  return bank;
}

/** All shipped clips are CC0, so no on-screen credit is required. T10 may still show this line in settings. */
export const SFX_ATTRIBUTION = "";
/** Public base for the game's static files (matches next.config basePath). */
export const ASSET_BASE = "/zelda";
export const SFX_MANIFEST = ASSET_BASE + "/sfx/manifest.json";
export const VOICE_MANIFEST = ASSET_BASE + "/voice/manifest.json";
