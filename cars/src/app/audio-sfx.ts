import type { CarId, Sfx } from "./contracts";
import { type C, type Rng, ahr, env, filter, gain, hit, hz, noise, osc, rng, shaper, slide } from "./audio-dsp";

type Recipe = (c: C, o: AudioNode, r: Rng, k: number) => void;

const bell = (c: C, o: AudioNode, t: number, m: number, v: number, dur = 0.9) => {
  const f = hz(m);
  const carrier = osc(c, env(c, o, (p) => hit(p, t, v, 0.002, dur * 0.35)), "sine", f, t, dur * 2);
  const mod = osc(c, env(c, carrier.frequency, (p) => hit(p, t, f * 1.6, 0.001, dur * 0.12)), "sine", f * 3.5, t, dur * 2);
  void mod;
  osc(c, env(c, o, (p) => hit(p, t, v * 0.3, 0.002, dur * 0.6)), "sine", f * 2, t, dur * 2);
};

const thud = (c: C, o: AudioNode, t: number, f0: number, f1: number, v: number, tau: number) => {
  const s = osc(c, env(c, shaper(c, o, 2), (p) => hit(p, t, v, 0.002, tau)), "sine", f0, t, tau * 6);
  slide(s.frequency, t, f0, f1, tau * 2);
};

const metal = (c: C, o: AudioNode, t: number, r: Rng, v: number, tau: number, base: number) => {
  for (const m of [1, 1.47, 2.09, 2.56, 3.39, 4.18, 5.43]) {
    const f = base * m * (0.97 + r() * 0.06);
    osc(c, env(c, o, (p) => hit(p, t + r() * 0.01, (v * 0.5) / Math.sqrt(m), 0.001, tau / Math.sqrt(m))), "sine", f, t, tau * 6);
  }
};

const crunch = (c: C, o: AudioNode, t: number, r: Rng, v: number, dur: number) => {
  const g = gain(c, filter(c, filter(c, o, "highpass", 600), "peaking", 2400, 1, 6), 0);
  const p = g.gain;
  p.setValueAtTime(0, t);
  for (let x = 0; x < dur; x += 0.004 + r() * 0.012) p.setValueAtTime(v * (1 - x / dur) * (0.3 + r()), t + x);
  p.setValueAtTime(0, t + dur);
  noise(c, g, t, dur + 0.05);
};

const chime = (notes: number[], gap: number, v: number, dur: number, shimmer = 0): Recipe => (c, o) => {
  const out = filter(c, o, "highshelf", 5000, 0.7, 3);
  notes.forEach((m, i) => bell(c, out, i * gap, m, v * (1 - i * 0.05), dur));
  notes.forEach((m, i) => osc(c, env(c, out, (p) => hit(p, i * gap, v * 0.25, 0.004, dur * 0.5)), "triangle", hz(m), i * gap, dur * 2));
  if (shimmer) noise(c, filter(c, env(c, out, (p) => ahr(p, 0, shimmer, notes.length * gap * 0.6, 0.05, 0.6)), "bandpass", 9000, 1.2), 0, notes.length * gap + 1);
};

const HORNS: Partial<Record<CarId, [number, number, number]>> = { classic: [310, 390, 0.8], muscle: [330, 415, 0.5], hyper: [440, 554, 0.3], v12: [392, 494, 0.35], gt3: [415, 523, 0.25], rally: [415, 523, 0.3], jdm: [466, 587, 0.35], ev: [523, 659, 0.15] };
export const HORN_CARS = Object.keys(HORNS) as CarId[];

export const SFX: Record<Sfx, { n: number; dur: number; g: number; fn: Recipe }> = {
  shift: {
    n: 3, dur: 0.25, g: 0.5,
    fn: (c, o, r) => {
      noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.5, 0.001, 0.006)), "bandpass", 2200 + r() * 800, 2), 0, 0.05);
      metal(c, gain(c, o, 0.4), 0.004, r, 0.4, 0.03, 1500 + r() * 500);
      thud(c, o, 0.006, 140, 70, 0.6, 0.03);
    },
  },
  impact: {
    n: 4, dur: 1.4, g: 0.9,
    fn: (c, o, r, k) => {
      const heavy = k >= 2;
      thud(c, o, 0, heavy ? 95 : 120, heavy ? 38 : 55, 1, heavy ? 0.16 : 0.08);
      noise(c, filter(c, env(c, o, (p) => hit(p, 0, heavy ? 0.9 : 0.6, 0.001, heavy ? 0.06 : 0.03)), "lowpass", 1400), 0, 0.4);
      crunch(c, o, 0.005, r, heavy ? 0.6 : 0.35, heavy ? 0.35 : 0.15);
      metal(c, gain(c, o, heavy ? 0.6 : 0.3), 0.003, r, 0.5, heavy ? 0.35 : 0.12, 250 + r() * 150);
      if (heavy) for (let i = 0; i < 9; i++) osc(c, env(c, o, (p) => hit(p, 0.06 + r() * 0.5, 0.06, 0.001, 0.05)), "sine", 3000 + r() * 5000, 0, 1.4);
    },
  },
  scrape: {
    n: 1, dur: 2, g: 0.45,
    fn: (c, o, r) => {
      const g = gain(c, o, 0.5);
      for (const [f, q] of [[1150, 14], [2630, 18], [4100, 12], [6300, 8]]) noise(c, filter(c, gain(c, g, 0.9), "bandpass", f * (0.95 + r() * 0.1), q), 0, 2);
      noise(c, filter(c, gain(c, g, 0.3), "highpass", 3000), 0, 2);
      const sq = osc(c, filter(c, gain(c, g, 0.08), "bandpass", 1800, 3), "sawtooth", 880, 0, 2);
      osc(c, env(c, sq.frequency, (p) => p.setValueAtTime(60, 0)), "sine", 13, 0, 2);
      const am = gain(c, g.gain, 0.4);
      osc(c, am, "square", 23, 0, 2);
    },
  },
  curb: {
    n: 2, dur: 0.35, g: 0.6,
    fn: (c, o, r) => {
      for (let i = 0; i < 4; i++) thud(c, o, i * 0.055 + r() * 0.005, 90, 50, 0.6 - i * 0.1, 0.025);
      noise(c, filter(c, env(c, o, (p) => ahr(p, 0, 0.15, 0.01, 0.15, 0.05)), "lowpass", 500), 0, 0.3);
    },
  },
  backfire: {
    n: 3, dur: 0.6, g: 0.8,
    fn: (c, o, r) => {
      const sh = shaper(c, o, 3);
      noise(c, filter(c, env(c, sh, (p) => hit(p, 0, 1, 0.0005, 0.012 + r() * 0.01)), "lowpass", 2500 + r() * 2000), 0, 0.2);
      thud(c, sh, 0, 120, 45, 0.9, 0.05);
      noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.5, 0.001, 0.08)), "bandpass", 160 + r() * 60, 4), 0, 0.5);
      if (r() < 0.6) noise(c, filter(c, env(c, sh, (p) => hit(p, 0.07 + r() * 0.05, 0.6, 0.0005, 0.01)), "lowpass", 3000), 0, 0.5);
    },
  },
  blowoff: {
    n: 2, dur: 0.8, g: 0.45,
    fn: (c, o, r, k) => {
      const bp = filter(c, o, "bandpass", 3000, 1.2);
      slide(bp.frequency, 0, 3200, 800, 0.5);
      const g = env(c, bp, (p) => ahr(p, 0, 1, 0.01, 0.12, 0.45));
      if (k === 1) {
        const am = gain(c, g.gain, 0.8);
        const lfo = osc(c, am, "square", 20, 0, 0.8);
        slide(lfo.frequency, 0, 22, 9, 0.6);
      }
      noise(c, g, 0, 0.8);
      void r;
    },
  },
  horn: {
    n: HORN_CARS.length, dur: 0.7, g: 0.5,
    fn: (c, o, _r, k) => {
      const [f1, f2, grit] = HORNS[HORN_CARS[k]]!;
      const g = env(c, filter(c, filter(c, o, "peaking", 1400, 1.2, 6), "lowpass", 3800), (p) => ahr(p, 0, 0.5, 0.012, 0.5, 0.08));
      for (const f of [f1, f2]) {
        osc(c, gain(c, g, 0.5), "square", f, 0, 0.7, -3);
        osc(c, gain(c, shaper(c, g, 2), grit), "sawtooth", f, 0, 0.7, 4);
      }
    },
  },
  beep: { n: 1, dur: 0.35, g: 0.45, fn: (c, o) => { osc(c, env(c, o, (p) => ahr(p, 0, 0.6, 0.005, 0.14, 0.08)), "sine", 880, 0, 0.35); osc(c, env(c, filter(c, o, "lowpass", 3000), (p) => ahr(p, 0, 0.12, 0.005, 0.14, 0.08)), "square", 880, 0, 0.35); } },
  go: {
    n: 1, dur: 1.2, g: 0.5,
    fn: (c, o) => {
      for (const m of [81, 85, 88, 93]) {
        osc(c, env(c, o, (p) => ahr(p, 0, 0.25, 0.005, 0.45, 0.4)), "sine", hz(m), 0, 1.2);
        osc(c, env(c, filter(c, o, "lowpass", 5000), (p) => ahr(p, 0, 0.05, 0.005, 0.4, 0.3)), "sawtooth", hz(m), 0, 1.2, 6);
      }
      noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.3, 0.05, 0.25)), "bandpass", 6000, 0.8), 0, 1);
    },
  },
  checkpoint: { n: 1, dur: 1.1, g: 0.45, fn: chime([88, 95], 0.075, 0.35, 0.6) },
  lap: { n: 1, dur: 1.6, g: 0.5, fn: chime([84, 88, 91, 96], 0.07, 0.32, 0.8, 0.05) },
  best: { n: 1, dur: 2, g: 0.5, fn: chime([84, 88, 91, 95, 98, 103], 0.055, 0.3, 0.9, 0.12) },
  finish: {
    n: 1, dur: 3.5, g: 0.6,
    fn: (c, o, r) => {
      const lp = filter(c, o, "lowpass", 400, 1.5);
      slide(lp.frequency, 0, 400, 4500, 0.35);
      const g = env(c, lp, (p) => ahr(p, 0, 0.5, 0.05, 1.6, 1.2));
      for (const m of [60, 64, 67, 72, 76]) for (const d of [-9, 9]) osc(c, gain(c, g, 0.12), "sawtooth", hz(m), 0, 3.5, d);
      chime([72, 76, 79, 84, 88, 91], 0.06, 0.25, 1.2, 0.1)(c, o, r, 0);
      noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.35, 0.002, 0.9)), "highpass", 4000), 0, 3);
      thud(c, o, 0, 90, 35, 0.6, 0.25);
    },
  },
  rewind: {
    n: 1, dur: 0.9, g: 0.45,
    fn: (c, o) => {
      const g = env(c, o, (p) => ahr(p, 0, 0.5, 0.05, 0.6, 0.15));
      const s = osc(c, filter(c, gain(c, g, 0.3), "bandpass", 1500, 1), "sawtooth", 300, 0, 0.9);
      slide(s.frequency, 0, 250, 1800, 0.7);
      osc(c, env(c, s.frequency, (p) => p.setValueAtTime(120, 0)), "sine", 14, 0, 0.9);
      const bp = filter(c, g, "bandpass", 2000, 1.5);
      slide(bp.frequency, 0, 900, 6000, 0.75);
      noise(c, bp, 0, 0.9, 1.5);
    },
  },
  click: { n: 1, dur: 0.05, g: 0.3, fn: (c, o) => { noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.5, 0.0005, 0.002)), "bandpass", 3200, 2), 0, 0.03); osc(c, env(c, o, (p) => hit(p, 0, 0.2, 0.001, 0.006)), "sine", 2400, 0, 0.04); } },
  hover: { n: 1, dur: 0.05, g: 0.12, fn: (c, o) => void osc(c, env(c, o, (p) => hit(p, 0, 0.3, 0.002, 0.008)), "sine", 3300, 0, 0.05) },
  splash: {
    n: 2, dur: 1.2, g: 0.6,
    fn: (c, o, r) => {
      const lp = filter(c, o, "lowpass", 5000, 0.8);
      slide(lp.frequency, 0, 6000, 500, 0.8);
      noise(c, env(c, lp, (p) => hit(p, 0, 0.8, 0.005, 0.25)), 0, 1.2);
      for (let i = 0; i < 10; i++) {
        const t = 0.05 + r() * 0.6;
        const b = osc(c, env(c, o, (p) => hit(p, t, 0.08, 0.002, 0.025)), "sine", 400, t, 0.1);
        slide(b.frequency, t, 300 + r() * 300, 900 + r() * 700, 0.04);
      }
    },
  },
  land: {
    n: 2, dur: 0.5, g: 0.7,
    fn: (c, o, r) => {
      thud(c, o, 0, 85, 40, 1, 0.09);
      noise(c, filter(c, env(c, o, (p) => hit(p, 0.01, 0.25, 0.002, 0.05)), "bandpass", 700 + r() * 300, 1.5), 0, 0.3);
      noise(c, filter(c, env(c, o, (p) => hit(p, 0.02, 0.15, 0.005, 0.06)), "bandpass", 1200, 8), 0, 0.3);
    },
  },
  join: { n: 1, dur: 1, g: 0.4, fn: chime([79, 86], 0.09, 0.3, 0.6) },
  leave: { n: 1, dur: 1, g: 0.35, fn: chime([86, 79], 0.09, 0.25, 0.6) },
};

export async function bakeSfx(sr: number, name: Sfx, k: number) {
  const d = SFX[name];
  const c = new OfflineAudioContext(1, Math.ceil(d.dur * sr), sr);
  const out = c.createGain();
  out.connect(c.destination);
  d.fn(c, out, rng(k * 7919 + name.length * 31 + 1), k);
  const b = await c.startRendering();
  const x = b.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const g = peak > 1e-6 ? 0.9 / peak : 0;
  const fade = Math.min(x.length, Math.floor(sr * 0.01));
  for (let i = 0; i < x.length; i++) x[i] *= x.length - i < fade ? (g * (x.length - i)) / fade : g;
  return b;
}
