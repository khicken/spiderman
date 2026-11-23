// HOLLOWMERE audio v2: ambience. Recorded seamless beds (public/sfx bed-*) crossfaded by game state, 3D bird one-shots and
// recorded thunder. No oscillators. Owner: audio (T12).
import { Rig, clamp } from "./audio-dsp";

export interface AmbInput {
  daylight: number; // 0 night .. 1 noon
  rain: number; // 0..1
  wind: number; // 0..1 (speed / 14 m/s)
  altitude: number; // 0..1 (player y / 200)
  gliding: boolean;
  water: number; // 0..1 proximity
  waterKind: 0 | 1 | 2; // sea, lake, river
  waterPan: number; // -1..1
  birdy: number; // 0..1 how many birds this area holds
}

export interface Ambience {
  set(i: AmbInput, now: number, dt: number): void;
  thunder(delay: number, pan: number): void;
  chirpNow(n: number): void;
  dispose(): void;
}

/** Linear gain per bed at weight 1. Beds ship at -23 LUFS; these set the final level (calibrated by level-check.mjs). */
export const BED_GAIN = {
  forest: 0.55, birds: 0.5, night: 0.68, frogs: 0.32, wind: 0.5, windHigh: 0.35, rain: 0.8, rainHeavy: 0.7,
  river: 0.6, sea: 0.6, lake: 0.45, cricketCap: 0.68,
} as const;

interface Bed {
  id: string;
  src: AudioBufferSourceNode | null;
  g: GainNode | null;
  pan: StereoPannerNode | null;
  want: number;
}

export function createAmbience(r: Rig): Ambience {
  const ac = r.ac;
  const out = r.mix.amb;
  const ids = ["bed-forest", "bed-birds", "bed-night", "bed-frogs", "bed-wind", "bed-wind-high", "bed-rain", "bed-rain-heavy", "bed-river", "bed-sea", "bed-lake"];
  const beds = new Map<string, Bed>(ids.map((id) => [id, { id, src: null, g: null, pan: null, want: 0 }]));
  let nextBird = 0;
  let disposed = false;
  const timers: ReturnType<typeof setTimeout>[] = [];

  function ensure(b: Bed): boolean {
    if (b.src) return true;
    const buf = r.bank.first(b.id);
    if (!buf) return false;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ac.createGain();
    g.gain.value = 0;
    const pan = ac.createStereoPanner();
    src.connect(g);
    g.connect(pan);
    pan.connect(out);
    src.start(0, Math.random() * buf.duration);
    b.src = src;
    b.g = g;
    b.pan = pan;
    return true;
  }

  function drive(id: string, w: number, now: number, pan = 0, tc = 1.2) {
    const b = beds.get(id);
    if (!b) return;
    b.want = w;
    if (w < 0.002 && !b.src) return;
    if (!Number.isFinite(w) || !Number.isFinite(pan)) return;
    if (!ensure(b) || !b.g || !b.pan) return;
    b.g.gain.setTargetAtTime(w, now, tc);
    if (pan !== 0 || b.pan.pan.value !== 0) b.pan.pan.setTargetAtTime(pan, now, 0.5);
  }

  function bird(delay = 0) {
    const buf = r.bank.take("bird");
    if (!buf) return;
    const ang = Math.random() * Math.PI * 2;
    const d = 10 + Math.random() * 35;
    const L = r.listener;
    const pos = { x: L.x + Math.cos(ang) * d, y: L.y + 2 + Math.random() * 8, z: L.z + Math.sin(ang) * d };
    const em = r.space.emit(pos, out, { ref: 8, occlude: false });
    if (!em) return;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.92 + Math.random() * 0.2;
    const g = ac.createGain();
    g.gain.value = 0.34 * Math.pow(10, (Math.random() * 6 - 3) / 20);
    src.connect(g);
    g.connect(em.input);
    const t = ac.currentTime + delay + 0.01;
    em.end = t + buf.duration + 0.3;
    src.start(t);
  }

  return {
    set(i, now, dt) {
      if (disposed) return;
      const day = clamp((i.daylight - 0.2) / 0.5);
      const night = 1 - day;
      const wetness = clamp(i.rain);
      const rainy = 1 - wetness * 0.6;

      drive("bed-forest", BED_GAIN.forest * (0.35 + 0.65 * i.birdy) * day * rainy, now);
      drive("bed-birds", BED_GAIN.birds * i.birdy * day * rainy * rainy, now);
      // night insects: capped so they never lead the mix
      drive("bed-night", Math.min(BED_GAIN.cricketCap, BED_GAIN.night) * night * (1 - wetness * 0.5) * (i.altitude > 0.5 ? 0.3 : 1), now);
      drive("bed-frogs", BED_GAIN.frogs * night * clamp(i.water * 2) * (i.waterKind === 0 ? 0 : 1) * (1 - wetness * 0.3), now, i.waterPan * 0.5);

      const wind = clamp(0.12 + i.wind * 0.9 + i.altitude * 0.4);
      drive("bed-wind", BED_GAIN.wind * wind * (1 - clamp(i.altitude * 0.7)), now);
      drive("bed-wind-high", BED_GAIN.windHigh * clamp(i.altitude * 1.3 + (i.gliding ? 0.5 : 0) + i.wind * 0.2) * (i.gliding ? 1.3 : 1), now);
      drive("bed-rain", BED_GAIN.rain * clamp(wetness * 1.6) * (1 - clamp((wetness - 0.5) * 2)), now);
      drive("bed-rain-heavy", BED_GAIN.rainHeavy * clamp((wetness - 0.4) * 1.7), now);

      const w = i.water;
      drive("bed-sea", BED_GAIN.sea * (i.waterKind === 0 ? w : 0), now, i.waterPan * 0.6);
      drive("bed-lake", BED_GAIN.lake * (i.waterKind === 1 ? w : 0), now, i.waterPan * 0.6);
      drive("bed-river", BED_GAIN.river * (i.waterKind === 2 ? w : 0), now, i.waterPan * 0.8);

      // sparse bird calls on top of the bed, only in daylight
      nextBird -= dt;
      if (nextBird <= 0) {
        nextBird = 2.5 + Math.random() * 7 / Math.max(0.15, i.birdy);
        if (day * i.birdy * rainy > 0.25) bird();
      }
    },
    thunder(delay, pan) {
      if (disposed) return;
      const buf = r.bank.take("thunder");
      if (!buf) return;
      const t = ac.currentTime + Math.max(0, delay);
      const src = ac.createBufferSource();
      src.buffer = buf;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = clamp(9000 - delay * 2200, 1400, 9000);
      const g = ac.createGain();
      g.gain.value = clamp(0.9 - delay * 0.08, 0.3, 0.9);
      const p = ac.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      src.connect(lp);
      lp.connect(g);
      g.connect(p);
      p.connect(out);
      src.start(t);
      r.mix.duck("impact", 0.6);
    },
    chirpNow(n) {
      if (disposed) return;
      for (let k = 0; k < n; k++) bird(k * (0.4 + Math.random() * 0.8));
    },
    dispose() {
      disposed = true;
      for (const t of timers) clearTimeout(t);
      for (const b of beds.values()) {
        try { b.src?.stop(); } catch { /* ended */ }
      }
    },
  };
}
