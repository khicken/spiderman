import type * as THREE from "three";
import type { AudioApi } from "../contracts";
import { createMusic, type MusicSetting } from "./music";
import { onPackChange, packLookup, pickPackClip } from "./pack-sounds";
import { createBiomeAmbient, seamless } from "./biome-ambient";
import { createRecords } from "./records";
import { renderVariant, resolveSound, type Resolved } from "./synth/registry";

const MAX_VOICES = 32;
const MUSIC_LEVEL = 0.25;
// Share of a positional sound sent to both ears, so a sound at the side is not silent in the far ear.
const CENTER = 0.35;
const WARM_SOUNDS = [
  "block.stone.step", "block.grass.step", "block.wood.step", "block.gravel.step", "block.sand.step",
  "block.stone.break", "block.grass.break", "block.wood.break", "block.stone.place", "block.grass.place",
  "block.wood.place", "block.stone.hit", "random.pop", "entity.player.hurt", "ui.button.click",
  "entity.player.attack.weak", "entity.player.attack.strong", "entity.generic.eat", "entity.experience_orb.pickup",
];

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  panner: PannerNode | null;
  center: GainNode | null;
  ui: boolean;
}

export interface MoodWorld {
  getSkyLight(x: number, y: number, z: number): number;
  getBlockLight(x: number, y: number, z: number): number;
}

export interface AmbientState {
  dark?: boolean;
  rain?: number;
  world?: MoodWorld;
}

// Vanilla AmbientMoodSettings shared by every biome: tickDelay 6000, blockSearchExtent 8, soundPositionOffset 2.
const MOOD_DELAY = 6000;
const MOOD_EXTENT = 8;
const MOOD_OFFSET = 2;

const HOSTILE = new Set([
  "zombie", "husk", "drowned", "zombie_villager", "skeleton", "stray", "bogged", "wither_skeleton", "creeper", "spider", "cave_spider",
  "enderman", "endermite", "silverfish", "witch", "slime", "magma_cube", "blaze", "ghast", "phantom", "pillager", "vindicator",
  "evoker", "evoker_fangs", "illusioner", "ravager", "vex", "guardian", "elder_guardian", "shulker", "shulker_bullet", "hoglin", "zoglin",
  "piglin_brute", "warden", "breeze", "wither", "wither_skull", "ender_dragon", "dragon_fireball",
]);
const BLOCK_ENTITY = new Set(["generic.explode", "tnt.primed", "minecart.riding", "minecart.inside", "item_frame", "painting", "leash_knot", "armor_stand"]);

// Vanilla SoundSource from the sound event name.
export function soundCategory(name: string): string {
  if (name.startsWith("ui.")) return "master";
  if (name.startsWith("music_disc.") || name.startsWith("block.note_block.") || name.startsWith("block.jukebox")) return "records";
  if (name.startsWith("weather.") || name.startsWith("entity.lightning_bolt")) return "weather";
  if (name.startsWith("ambient.") || name.startsWith("entity.firework_rocket")) return "ambient";
  if (name.startsWith("block.")) return "blocks";
  if (name.startsWith("entity.player.") || name.startsWith("item.") || name === "random.pop" || name.startsWith("entity.experience_orb") || name.startsWith("entity.item.") || name === "entity.generic.eat" || name === "entity.generic.drink") return "players";
  if (name.startsWith("entity.")) {
    const rest = name.slice(7);
    for (const b of BLOCK_ENTITY) if (rest.startsWith(b)) return "blocks";
    const dot = rest.indexOf(".");
    return HOSTILE.has(dot < 0 ? rest : rest.slice(0, dot)) ? "hostile" : "neutral";
  }
  return "blocks";
}

export type GameAudio = AudioApi & {
  setCategories(v: Record<string, number>): void;
  resume(): void;
  setUnderwater(on: boolean): void;
  setAmbient(s: AmbientState): void;
  setMusic(kind: MusicSetting): void;
  setPaused(on: boolean): void;
  changeDim(): void;
  setBiomeAmbient(biome: string | null): void;
  stopAll(): void;
  musicState(): { kind: string; playing: string | null; nextIn: number } | null;
};

export function createAudio(): GameAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let sfx: GainNode | null = null;
  let sfxMute: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let recordsBus: GainNode | null = null;
  let music: ReturnType<typeof createMusic> | null = null;
  let records: ReturnType<typeof createRecords> | null = null;
  let rainSrc: AudioBufferSourceNode | null = null;
  let rainGain: GainNode | null = null;
  let rainLevel = 0;
  const pack = packLookup();
  const buffers = new Map<string, AudioBuffer>();
  const voices: Voice[] = [];
  const warned = new Set<string>();
  const vol = { master: 1, music: 1, sfx: 1 };
  const cats: Record<string, number> = {};
  const listener = { x: 0, y: 0, z: 0 };
  let musicKind: MusicSetting = "none";
  let underwater = false;
  let paused = false;
  let moodWorld: MoodWorld | null = null;
  let moodiness = 0;
  let moodBiome: string | null = null;
  let lastTick = 0;
  let waterLoop: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  let warmIdx = 0;
  let warmTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let biomeAmb: ReturnType<typeof createBiomeAmbient> | null = null;

  const offPack = onPackChange(() => {
    for (const n of WARM_SOUNDS) pack(n);
  });

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
      v.center?.disconnect();
    } catch { /* already disconnected */ }
  }

  function fadeStop(v: Voice): void {
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + 0.015);
      v.src.stop(now + 0.02);
    } catch { /* stopped already */ }
  }

  function steal(): void {
    const v = voices.shift();
    if (v) fadeStop(v);
  }

  function stopSfx(keepUi: boolean): void {
    for (const v of voices.slice()) if (!keepUi || !v.ui) fadeStop(v);
  }

  function applyVolumes(): void {
    if (!ctx || !master || !sfx || !musicBus || !recordsBus) return;
    const now = ctx.currentTime;
    master.gain.setTargetAtTime(vol.master, now, 0.03);
    sfx.gain.setTargetAtTime(vol.sfx, now, 0.03);
    musicBus.gain.setTargetAtTime(vol.music * MUSIC_LEVEL, now, 0.03);
    recordsBus.gain.setTargetAtTime(cats.records ?? 1, now, 0.03);
    if (rainGain) rainGain.gain.setTargetAtTime(rainLevel * 0.3 * (cats.weather ?? 1), now, 0.5);
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

  function play(name: string, x?: number, y?: number, z?: number, volume?: number, pitch?: number): void {
    if (!ctx || !sfx || !sfxMute || disposed || ctx.state === "closed") return;
    const ui = name.startsWith("ui.");
    if (paused && !ui) return;
    const v = (volume ?? 1) * (cats[soundCategory(name)] ?? 1);
    if (v <= 0) return;
    const clip = pickPackClip(pack, name);
    let buf: AudioBuffer | null;
    let gainScale: number;
    let rate: number;
    let range = 16;
    if (clip) {
      buf = clip.buffer;
      gainScale = clip.volume;
      rate = (pitch ?? 1) * clip.pitch;
      range = clip.attenuation;
    } else {
      const res = resolveSound(name);
      if (!res) {
        warnOnce(`unknown:${name}`, `unknown sound "${name}"`);
        return;
      }
      const rec = res.recipe;
      buf = buffer(res, Math.floor(Math.random() * (rec.variants ?? 4)));
      gainScale = rec.gain ?? 1;
      // A caller pitch other than 1 already carries vanilla's own randomness.
      const pv = pitch !== undefined && pitch !== 1 ? Math.min(0.05, rec.pitchVar ?? 0.1) : rec.pitchVar ?? 0.1;
      rate = (pitch ?? 1) * (1 + (Math.random() - Math.random()) * pv);
    }
    if (!buf) return;
    const far = range * Math.max(1, v);
    if (x !== undefined && y !== undefined && z !== undefined) {
      const dx = x - listener.x, dy = y - listener.y, dz = z - listener.z;
      if (dx * dx + dy * dy + dz * dz > far * far) return;
    }
    while (voices.length >= MAX_VOICES) steal();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.min(4, Math.max(0.25, rate));
    const gain = ctx.createGain();
    gain.gain.value = Math.min(1, v) * gainScale;
    src.connect(gain);
    let panner: PannerNode | null = null;
    let center: GainNode | null = null;
    if (x !== undefined && y !== undefined && z !== undefined) {
      panner = ctx.createPanner();
      panner.panningModel = "equalpower";
      panner.distanceModel = "linear";
      panner.refDistance = 0;
      panner.maxDistance = far;
      panner.rolloffFactor = 1;
      setPos(panner, x, y, z);
      const out = ui ? sfx : sfxMute;
      gain.connect(panner).connect(out);
      const d = Math.hypot(x - listener.x, y - listener.y, z - listener.z);
      center = ctx.createGain();
      center.gain.value = CENTER * Math.max(0, 1 - d / far);
      gain.connect(center).connect(out);
      gain.gain.value *= 0.75;
    } else {
      gain.connect(ui ? sfx : sfxMute);
    }
    const voice: Voice = { src, gain, panner, center, ui };
    voices.push(voice);
    src.onended = () => release(voice);
    src.start();
  }

  // Vanilla BiomeAmbientSoundsHandler mood: each tick samples one block within 8; darkness fills it over 6000 ticks.
  function moodTick(w: MoodWorld): void {
    const span = MOOD_EXTENT * 2 + 1;
    const bx = Math.floor(listener.x) + Math.floor(Math.random() * span) - MOOD_EXTENT;
    const by = Math.floor(listener.y) + Math.floor(Math.random() * span) - MOOD_EXTENT;
    const bz = Math.floor(listener.z) + Math.floor(Math.random() * span) - MOOD_EXTENT;
    const sky = w.getSkyLight(bx, by, bz);
    if (sky > 0) moodiness -= (sky / 15) * 0.001;
    else moodiness -= (w.getBlockLight(bx, by, bz) - 1) / MOOD_DELAY;
    if (moodiness < 1) {
      moodiness = Math.max(0, moodiness);
      return;
    }
    moodiness = 0;
    const dx = bx + 0.5 - listener.x, dy = by + 0.5 - listener.y, dz = bz + 0.5 - listener.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const off = len + MOOD_OFFSET;
    play(moodBiome ? `ambient.${moodBiome}.mood` : "ambient.cave", listener.x + (dx / len) * off, listener.y + (dy / len) * off, listener.z + (dz / len) * off, 0.9);
  }

  function waterTick(): void {
    if (Math.random() < 0.01) play("ambient.underwater.loop.additions");
    if (Math.random() < 0.001) play("ambient.underwater.loop.additions.rare");
    if (Math.random() < 0.0001) play("ambient.underwater.loop.additions.ultra_rare");
  }

  function updateAmbient(): void {
    if (!ctx || paused) return;
    const now = ctx.currentTime;
    if (!lastTick || now - lastTick > 1) lastTick = now;
    for (; now - lastTick >= 0.05; lastTick += 0.05) {
      if (moodWorld) moodTick(moodWorld);
      if (waterLoop) waterTick();
    }
  }

  function stopWaterLoop(secs: number): void {
    const l = waterLoop;
    waterLoop = null;
    if (!l || !ctx) return;
    const now = ctx.currentTime;
    try {
      l.gain.gain.cancelScheduledValues(now);
      l.gain.gain.setValueAtTime(l.gain.gain.value, now);
      l.gain.gain.linearRampToValueAtTime(0, now + secs);
      l.src.stop(now + secs + 0.05);
    } catch { /* stopped already */ }
    l.src.onended = () => {
      try { l.gain.disconnect(); } catch { /* gone */ }
    };
  }

  function startWaterLoop(): void {
    if (!ctx || !sfxMute || waterLoop) return;
    const clip = pickPackClip(pack, "ambient.underwater.loop");
    const res = clip ? null : resolveSound("ambient.underwater.loop");
    const raw = clip ? clip.buffer : res && buffer(res, 0);
    if (!raw) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const src = ctx.createBufferSource();
    src.buffer = clip ? raw : seamless(ctx, raw, 0.75);
    src.loop = true;
    src.connect(gain).connect(sfxMute);
    src.start();
    gain.gain.linearRampToValueAtTime((res?.recipe.gain ?? 1) * (cats.ambient ?? 1), ctx.currentTime + 2);
    waterLoop = { src, gain };
  }

  function syncWaterLoop(): void {
    if (paused) return;
    if (underwater && !waterLoop) startWaterLoop();
    else if (!underwater && waterLoop) stopWaterLoop(2);
  }

  function stopRain(): void {
    try { rainSrc?.stop(); } catch { /* not playing */ }
    try { rainGain?.disconnect(); } catch { /* gone */ }
    rainSrc = null;
    rainGain = null;
  }

  function setRain(level: number): void {
    if (!ctx || !sfxMute) return;
    rainLevel = Math.min(1, Math.max(0, level));
    if (rainLevel > 0.01 && !rainSrc) {
      const clip = pickPackClip(pack, "weather.rain");
      const res = clip ? null : resolveSound("weather.rain");
      const buf = clip ? clip.buffer : res && buffer(res, 0);
      if (!buf) return;
      rainGain = ctx.createGain();
      rainGain.gain.value = 0;
      rainSrc = ctx.createBufferSource();
      rainSrc.buffer = buf;
      rainSrc.loop = true;
      rainSrc.connect(rainGain).connect(sfxMute);
      rainSrc.start();
    }
    if (rainGain) rainGain.gain.setTargetAtTime(rainLevel * 0.3 * (cats.weather ?? 1), ctx.currentTime, 0.5);
    if (rainLevel <= 0.01 && rainSrc && rainGain && rainGain.gain.value < 0.002) stopRain();
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
        sfxMute = ctx.createGain();
        musicBus = ctx.createGain();
        recordsBus = ctx.createGain();
        sfxMute.gain.value = paused ? 0 : 1;
        sfxMute.connect(sfx);
        recordsBus.connect(sfxMute);
        sfx.connect(master);
        musicBus.connect(master);
        // Many sounds at once (mining, explosions) sum past 1.0; limit instead of clipping.
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.knee.value = 6;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.2;
        master.connect(limiter).connect(ctx.destination);
        music = createMusic(ctx, musicBus, pack);
        biomeAmb = createBiomeAmbient({
          ctx,
          out: sfxMute,
          loopBuffer: (n) => {
            const clip = pickPackClip(pack, n);
            if (clip) return clip.buffer;
            const r = resolveSound(n);
            return r ? buffer(r, 0) : null;
          },
          play: (n, v) => play(n, undefined, undefined, undefined, v),
          level: () => cats.ambient ?? 1,
        });
        records = createRecords(ctx, recordsBus, pack);
        applyVolumes();
        music.setKind(musicKind);
        warmTimer = setTimeout(warm, 100);
        syncWaterLoop();
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
      if (cats.music !== undefined) vol.music = cats.music;
      applyVolumes();
    }),
    setMusic: guard("music", (kind: MusicSetting) => {
      musicKind = kind;
      music?.setKind(kind);
    }),
    setUnderwater: guard("underwater", (on: boolean) => {
      if (on === underwater) return;
      underwater = on;
      if (paused) return;
      play(on ? "ambient.underwater.enter" : "ambient.underwater.exit");
      if (on) startWaterLoop();
      else stopWaterLoop(2);
    }),
    setAmbient: guard("ambient", (s: AmbientState) => {
      if (s.world !== undefined) moodWorld = s.world;
      if (s.rain !== undefined) setRain(s.rain);
    }),
    setPaused: guard("pause", (on: boolean) => {
      if (on === paused) return;
      paused = on;
      if (!ctx || !sfxMute) return;
      if (on) stopSfx(true);
      sfxMute.gain.setTargetAtTime(on ? 0 : 1, ctx.currentTime, on ? 0.02 : 0.1);
      syncWaterLoop();
    }),
    setBiomeAmbient: guard("biome-ambient", (biome: string | null) => {
      moodBiome = biome;
      biomeAmb?.set(biome, paused);
      if (biome) music?.setBiome(biome);
    }),
    changeDim: guard("dim", () => {
      biomeAmb?.stop();
      stopWaterLoop(0.1);
      moodiness = 0;
      moodBiome = null;
      stopSfx(true);
      stopRain();
      rainLevel = 0;
      music?.fadeAll();
    }),
    stopAll: guard("stop", () => {
      stopWaterLoop(0.1);
      stopSfx(true);
      stopRain();
      rainLevel = 0;
      records?.dispose();
      if (ctx && recordsBus) records = createRecords(ctx, recordsBus, pack);
    }),
    musicState: () => music?.state() ?? null,
    dispose: guard("dispose", () => {
      disposed = true;
      biomeAmb?.stop();
      stopWaterLoop(0);
      offPack();
      if (warmTimer) clearTimeout(warmTimer);
      music?.dispose();
      records?.dispose();
      for (const v of voices.slice()) {
        try { v.src.stop(); } catch { /* not playing */ }
        release(v);
      }
      stopRain();
      buffers.clear();
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
      ctx = null;
    }),
  };
}
