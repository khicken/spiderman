import type * as THREE from "three";
import type { AudioApi } from "../contracts";
import { createMusic, type MusicSetting } from "./music";
import { createRecords } from "./records";
import { rand } from "./synth/dsp";
import { renderVariant, resolveSound, type Resolved } from "./synth/registry";

const MAX_VOICES = 32;
const WARM_SOUNDS = [
  "block.stone.step", "block.grass.step", "block.wood.step", "block.gravel.step", "block.sand.step",
  "block.stone.break", "block.grass.break", "block.wood.break", "block.stone.place", "block.grass.place",
  "block.wood.place", "block.stone.hit", "random.pop", "entity.player.hurt", "ui.button.click",
  "entity.player.attack.weak", "entity.player.attack.strong", "entity.generic.eat",
];

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  panner: PannerNode | null;
}

export interface AmbientState {
  dark?: boolean;
  rain?: number;
}

const HOSTILE = new Set([
  "zombie", "husk", "drowned", "zombie_villager", "skeleton", "stray", "bogged", "wither_skeleton", "creeper", "spider", "cave_spider",
  "enderman", "endermite", "silverfish", "witch", "slime", "magma_cube", "blaze", "ghast", "phantom", "pillager", "vindicator",
  "evoker", "illusioner", "ravager", "vex", "guardian", "elder_guardian", "shulker", "hoglin", "zoglin", "piglin_brute", "warden",
  "breeze", "wither", "ender_dragon",
]);

// Vanilla SoundSource from the sound event name.
export function soundCategory(name: string): string {
  if (name.startsWith("ui.")) return "master";
  if (name.startsWith("music_disc.") || name.startsWith("block.note_block.") || name.startsWith("block.jukebox")) return "records";
  if (name.startsWith("weather.") || name.startsWith("entity.lightning_bolt")) return "weather";
  if (name.startsWith("ambient.")) return "ambient";
  if (name.startsWith("block.")) return "blocks";
  if (name.startsWith("entity.player.") || name.startsWith("item.") || name === "random.pop") return "players";
  if (name.startsWith("entity.")) {
    const mob = name.slice(7, name.indexOf(".", 7) < 0 ? undefined : name.indexOf(".", 7));
    return HOSTILE.has(mob) ? "hostile" : "neutral";
  }
  return "blocks";
}

export type GameAudio = AudioApi & {
  setCategories(v: Record<string, number>): void;
  resume(): void;
  setUnderwater(on: boolean): void;
  setAmbient(s: AmbientState): void;
};

export function createAudio(): GameAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let sfx: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let muffle: BiquadFilterNode | null = null;
  let music: ReturnType<typeof createMusic> | null = null;
  let records: ReturnType<typeof createRecords> | null = null;
  let rainSrc: AudioBufferSourceNode | null = null;
  let rainGain: GainNode | null = null;
  const buffers = new Map<string, AudioBuffer>();
  const voices: Voice[] = [];
  const warned = new Set<string>();
  const vol = { master: 1, music: 1, sfx: 1 };
  const cats: Record<string, number> = {};
  const listener = { x: 0, y: 0, z: 0 };
  let musicKind: MusicSetting = "none";
  let underwater = false;
  let dark = false;
  let nextCave = 0;
  let warmIdx = 0;
  let warmTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function warnOnce(key: string, msg: string, err?: unknown): void {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(msg, err ?? "");
  }

  function buffer(res: Resolved, variant: number): AudioBuffer | null {
    if (!ctx) return null;
    const k = `${res.key}#${variant}`;
    let b = buffers.get(k);
    if (!b) {
      const data = renderVariant(res.key, res.recipe, variant, ctx.sampleRate);
      b = ctx.createBuffer(1, data.length, ctx.sampleRate);
      b.getChannelData(0).set(data);
      buffers.set(k, b);
    }
    return b;
  }

  function warm(): void {
    warmTimer = null;
    if (disposed || !ctx || warmIdx >= WARM_SOUNDS.length * 4) return;
    const name = WARM_SOUNDS[warmIdx % WARM_SOUNDS.length];
    const v = Math.floor(warmIdx / WARM_SOUNDS.length);
    warmIdx++;
    try {
      const res = resolveSound(name);
      if (res && v < (res.recipe.variants ?? 4)) buffer(res, v);
    } catch (err) {
      warnOnce("warm", "audio warm-up failed", err);
    }
    warmTimer = setTimeout(warm, 30);
  }

  function release(v: Voice): void {
    const i = voices.indexOf(v);
    if (i >= 0) voices.splice(i, 1);
    try {
      v.src.disconnect();
      v.gain.disconnect();
      v.panner?.disconnect();
    } catch { /* already disconnected */ }
  }

  function steal(): void {
    const v = voices.shift();
    if (!v || !ctx) return;
    try {
      const now = ctx.currentTime;
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + 0.015);
      v.src.stop(now + 0.02);
    } catch { /* stopped already */ }
  }

  function applyVolumes(): void {
    if (!ctx || !master || !sfx || !musicBus) return;
    const now = ctx.currentTime;
    master.gain.setTargetAtTime(vol.master, now, 0.03);
    sfx.gain.setTargetAtTime(vol.sfx, now, 0.03);
    musicBus.gain.setTargetAtTime(vol.music * 0.8, now, 0.03);
  }

  function play(name: string, x?: number, y?: number, z?: number, volume?: number, pitch?: number): void {
    if (!ctx || !sfx || disposed || ctx.state === "closed") return;
    const res = resolveSound(name);
    if (!res) {
      warnOnce(`unknown:${name}`, `unknown sound "${name}"`);
      return;
    }
    const rec = res.recipe;
    const variant = Math.floor(Math.random() * (rec.variants ?? 4));
    const buf = buffer(res, variant);
    if (!buf) return;
    while (voices.length >= MAX_VOICES) steal();
    const pv = rec.pitchVar ?? 0.1;
    const rate = Math.min(4, Math.max(0.25, (pitch ?? 1) * (1 + (Math.random() - Math.random()) * pv)));
    const v = (volume ?? 1) * (cats[soundCategory(name)] ?? 1);
    if (v <= 0) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(1, Math.max(0, v)) * (rec.gain ?? 1);
    src.connect(gain);
    let panner: PannerNode | null = null;
    if (x !== undefined && y !== undefined && z !== undefined) {
      panner = ctx.createPanner();
      panner.panningModel = "equalpower";
      panner.distanceModel = "linear";
      panner.refDistance = 1;
      panner.maxDistance = 16 * Math.max(1, v);
      panner.rolloffFactor = 1;
      setPos(panner, x, y, z);
      gain.connect(panner).connect(sfx);
    } else {
      gain.connect(sfx);
    }
    const voice: Voice = { src, gain, panner };
    voices.push(voice);
    src.onended = () => release(voice);
    src.start();
  }

  function setPos(p: PannerNode, x: number, y: number, z: number): void {
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      p.setPosition(x, y, z);
    }
  }

  function updateAmbient(): void {
    if (!ctx || !dark) return;
    const now = ctx.currentTime;
    if (nextCave === 0) nextCave = now + rand(Math.random, 30, 120);
    if (now >= nextCave) {
      nextCave = now + rand(Math.random, 60, 180);
      const a = Math.random() * Math.PI * 2;
      play("ambient.cave", listener.x + Math.cos(a) * 6, listener.y + rand(Math.random, -3, 3), listener.z + Math.sin(a) * 6, 0.9);
    }
  }

  function setRain(level: number): void {
    if (!ctx || !sfx) return;
    if (level > 0.01 && !rainSrc) {
      const res = resolveSound("weather.rain");
      const buf = res && buffer(res, 0);
      if (!buf) return;
      rainGain = ctx.createGain();
      rainGain.gain.value = 0;
      rainSrc = ctx.createBufferSource();
      rainSrc.buffer = buf;
      rainSrc.loop = true;
      rainSrc.connect(rainGain).connect(sfx);
      rainSrc.start();
    }
    if (rainGain) rainGain.gain.setTargetAtTime(Math.min(1, level) * 0.3 * (cats.weather ?? 1), ctx.currentTime, 0.5);
  }

  function guard<A extends unknown[]>(key: string, fn: (...a: A) => void): (...a: A) => void {
    return (...a: A) => {
      try { fn(...a); } catch (err) { warnOnce(key, `audio ${key} failed`, err); }
    };
  }

  return {
    resume: guard("resume", () => {
      if (disposed) return;
      if (!ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new Ctor({ latencyHint: "interactive" });
        master = ctx.createGain();
        sfx = ctx.createGain();
        musicBus = ctx.createGain();
        muffle = ctx.createBiquadFilter();
        muffle.type = "lowpass";
        muffle.frequency.value = underwater ? 700 : 22000;
        sfx.connect(muffle).connect(master);
        musicBus.connect(master);
        master.connect(ctx.destination);
        music = createMusic(ctx, musicBus);
        records = createRecords(ctx, sfx);
        applyVolumes();
        music.setKind(musicKind);
        warmTimer = setTimeout(warm, 100);
      }
      if (ctx.state === "suspended") void ctx.resume().catch((err) => warnOnce("resume-promise", "audio resume failed", err));
    }),
    play: guard("play", play),
    playRecord: guard("record", (id: string, disc: string, x: number, y: number, z: number, seconds: number) => records?.play(id, disc, x, y, z, seconds)),
    stopRecord: guard("record", (id: string) => records?.stop(id)),
    setListener: guard("listener", (pos: THREE.Vector3, yaw: number, pitch: number) => {
      listener.x = pos.x;
      listener.y = pos.y;
      listener.z = pos.z;
      if (!ctx) return;
      const l = ctx.listener;
      const cp = Math.cos(pitch);
      const fx = -Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cp;
      const ux = Math.sin(yaw) * Math.sin(pitch), uy = cp, uz = Math.cos(yaw) * Math.sin(pitch);
      if (l.positionX) {
        l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
        l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
        l.upX.value = ux; l.upY.value = uy; l.upZ.value = uz;
      } else {
        l.setPosition(pos.x, pos.y, pos.z);
        l.setOrientation(fx, fy, fz, ux, uy, uz);
      }
      updateAmbient();
    }),
    setVolume: guard("volume", (m: number, mu: number, s: number) => {
      vol.master = Math.max(0, Math.min(1, m));
      vol.music = Math.max(0, Math.min(1, mu));
      vol.sfx = Math.max(0, Math.min(1, s));
      applyVolumes();
    }),
    setCategories: guard("categories", (v: Record<string, number>) => {
      for (const [k, x] of Object.entries(v)) cats[k] = Math.max(0, Math.min(1, x));
    }),
    setMusic: guard("music", (kind: MusicSetting) => {
      musicKind = kind;
      music?.setKind(kind);
    }),
    setUnderwater: guard("underwater", (on: boolean) => {
      underwater = on;
      if (ctx && muffle) muffle.frequency.setTargetAtTime(on ? 700 : 22000, ctx.currentTime, 0.05);
    }),
    setAmbient: guard("ambient", (s: AmbientState) => {
      if (s.dark !== undefined && s.dark !== dark) {
        dark = s.dark;
        nextCave = 0;
      }
      if (s.rain !== undefined) setRain(s.rain);
    }),
    dispose: guard("dispose", () => {
      disposed = true;
      if (warmTimer) clearTimeout(warmTimer);
      music?.dispose();
      records?.dispose();
      for (const v of voices.slice()) {
        try { v.src.stop(); } catch { /* not playing */ }
        release(v);
      }
      try { rainSrc?.stop(); } catch { /* not playing */ }
      buffers.clear();
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
      ctx = null;
    }),
  };
}
