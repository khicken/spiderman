import { addGrain, addGrains, addNoise, addPartials, addTone, alloc, filter, filterFn, mixInto, rand, TAU, type Rng } from "./dsp";
import { formantVoice, lerpCurve, recipe, type Recipe, type VoiceOpts } from "./voice";

export type Gen = (r: Rng, sr: number) => Float32Array;
export type MobSounds = Record<string, Recipe>;

export interface SayOpts extends Omit<VoiceOpts, "pitch" | "dur" | "amp"> {
  dur: number;
  f: number[];
  amp?: number[];
  spread?: number;
}

export function say(o: SayOpts): Gen {
  return (r, sr) => {
    const v = rand(r, 1 - (o.spread ?? 0.07), 1 + (o.spread ?? 0.07));
    const pts = o.f.map((x) => x * v);
    return formantVoice(sr, r, {
      ...o,
      dur: o.dur * rand(r, 0.88, 1.12),
      pitch: lerpCurve(pts),
      amp: o.amp ? lerpCurve(o.amp) : undefined,
    });
  };
}

export function seq(parts: [Gen, number, number?][]): Gen {
  return (r, sr) => {
    const rendered = parts.map(([g, off, gain]) => ({ d: g(r, sr), off, gain: gain ?? 1 }));
    let len = 0;
    for (const p of rendered) len = Math.max(len, p.d.length + Math.floor(p.off * sr));
    const out = new Float32Array(len);
    for (const p of rendered) mixInto(out, p.d, p.gain, p.off, sr);
    return out;
  };
}

export function repeat(g: Gen, count: [number, number], gap: [number, number]): Gen {
  return (r, sr) => {
    const n = Math.floor(rand(r, count[0], count[1] + 0.999));
    const parts: Float32Array[] = [];
    const offs: number[] = [];
    let t = 0;
    for (let i = 0; i < n; i++) {
      parts.push(g(r, sr));
      offs.push(t);
      t += rand(r, gap[0], gap[1]);
    }
    let len = 0;
    for (let i = 0; i < n; i++) len = Math.max(len, parts[i].length + Math.floor(offs[i] * sr));
    const out = new Float32Array(len);
    for (let i = 0; i < n; i++) mixInto(out, parts[i], 1, offs[i], sr);
    return out;
  };
}

export function ringMod(g: Gen, hz: number, depth: number): Gen {
  return (r, sr) => {
    const d = g(r, sr);
    for (let i = 0; i < d.length; i++) d[i] *= 1 - depth + depth * Math.sin((TAU * hz * i) / sr);
    return d;
  };
}

export function tremolo(g: Gen, hz: number, depth: number): Gen {
  return (r, sr) => {
    const d = g(r, sr);
    for (let i = 0; i < d.length; i++) d[i] *= 1 - depth * 0.5 * (1 + Math.sin((TAU * hz * i) / sr));
    return d;
  };
}

export function lowpass(g: Gen, hz: number): Gen {
  return (r, sr) => filter(g(r, sr), "lowpass", hz, 0.7, sr);
}

export function noiseSweep(dur: number, f0: number, f1: number, q: number, attack = 0.2, type: "bandpass" | "lowpass" | "highpass" = "bandpass"): Gen {
  return (r, sr) => {
    const d = alloc(dur, sr);
    addNoise(d, r, 1);
    const fm = rand(r, 0.9, 1.1);
    filter(d, type, f0 * fm, q, sr, f1 * fm);
    const n = d.length;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      d[i] *= Math.min(1, t / attack) * Math.min(1, (1 - t) * 3);
    }
    return d;
  };
}

export function whoosh(dur: number, lo: number, hi: number, q = 1.5): Gen {
  return (r, sr) => {
    const d = alloc(dur, sr);
    addNoise(d, r, 1);
    const peakT = rand(r, 0.3, 0.5);
    const fm = rand(r, 0.85, 1.15);
    const freq = (t: number): number => {
      const u = t / dur;
      return (u < peakT ? lo + (hi - lo) * (u / peakT) : hi - (hi - lo) * 0.7 * ((u - peakT) / (1 - peakT))) * fm;
    };
    filter(d, "highpass", 80, 0.7, sr);
    filterFn(d, "bandpass", q, sr, freq);
    const n = d.length;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      d[i] *= u < peakT ? Math.pow(u / peakT, 1.5) : Math.pow(1 - (u - peakT) / (1 - peakT), 1.3);
    }
    return d;
  };
}

export function clicks(count: [number, number], dur: number, lo: number, hi: number, tone = 0.5, shape = 1): Gen {
  return (r, sr) => {
    const d = alloc(dur + 0.05, sr);
    const n = Math.floor(rand(r, count[0], count[1] + 0.999));
    for (let k = 0; k < n; k++) {
      const t0 = Math.pow(r(), shape) * dur;
      const f = rand(r, lo, hi);
      const a = rand(r, 0.5, 1);
      addGrain(d, sr, r, { start: t0, amp: a, dur: rand(r, 0.004, 0.01), freq: f * 2, q: 3 });
      addTone(d, sr, { start: t0, dur: 0.05, freq: f, amp: a * tone, attack: 0.0003, decay: rand(r, 0.006, 0.014) });
    }
    return d;
  };
}

export function chirps(count: [number, number], gap: number, f0: number, f1: number, len: number): Gen {
  return (r, sr) => {
    const n = Math.floor(rand(r, count[0], count[1] + 0.999));
    const d = alloc(n * gap + len + 0.02, sr);
    for (let k = 0; k < n; k++) {
      const a = rand(r, 0.85, 1.15);
      const l = len * rand(r, 0.7, 1.3);
      addTone(d, sr, { start: k * gap * rand(r, 0.8, 1.2), dur: l, freq: (t) => (f0 + (f1 - f0) * (t / l)) * a, amp: rand(r, 0.6, 1), attack: 0.002, decay: l * 0.5, wave: "tri" });
    }
    return d;
  };
}

export function bubbles(dur: number, count: number, lo: number, hi: number): Gen {
  return (r, sr) => {
    const d = alloc(dur + 0.1, sr);
    for (let k = 0; k < count; k++) {
      const t0 = r() * dur;
      const f = rand(r, lo, hi);
      addTone(d, sr, { start: t0, dur: 0.06, freq: (t) => f * (1 + t * 25), amp: rand(r, 0.3, 1), attack: 0.001, decay: 0.012 });
    }
    return d;
  };
}

export function squelch(dur: number, f: number): Gen {
  return (r, sr) => {
    const d = alloc(dur, sr);
    addNoise(d, r, 1);
    filter(d, "lowpass", f * rand(r, 2.5, 3.5), 8, sr, f * rand(r, 0.4, 0.6));
    const n = d.length;
    for (let i = 0; i < n; i++) d[i] *= Math.min(1, i / (0.008 * sr)) * Math.exp(-i / (n * 0.3));
    addTone(d, sr, { start: 0.02, dur: dur * 0.5, freq: (t) => f * (1.5 + t * 10), amp: 0.25, decay: dur * 0.15 });
    return d;
  };
}

export function clank(f: number, dec: number, crunch = 0.3): Gen {
  return (r, sr) => {
    const d = alloc(dec * 5 + 0.1, sr);
    const ff = f * rand(r, 0.9, 1.1);
    addPartials(d, sr, 0, ff, [[1, 1, dec], [2.76, 0.6, dec * 0.6], [5.4, 0.35, dec * 0.35], [1.47, 0.4, dec * 0.5], [8.9, 0.2, dec * 0.2]]);
    addGrain(d, sr, r, { start: 0, amp: 0.8, dur: 0.01, freq: 3000, q: 1 });
    if (crunch) addGrains(d, sr, r, { start: 0, dur: 0.2, count: 15, amp: crunch, freqLo: 300, freqHi: 3000, q: 1.2, grainLo: 0.005, grainHi: 0.03 });
    return d;
  };
}

export function thud(f: number, dec: number, grit = 0.3): Gen {
  return (r, sr) => {
    const d = alloc(dec * 6 + 0.05, sr);
    const ff = f * rand(r, 0.85, 1.15);
    addTone(d, sr, { dur: dec * 6, freq: (t) => ff * (1 + 2 * Math.exp(-t / 0.012)), amp: 1, decay: dec });
    addGrains(d, sr, r, { start: 0, dur: 0.06, count: 8, amp: grit, freqLo: 200, freqHi: 1500, q: 1, grainLo: 0.005, grainHi: 0.03 });
    return d;
  };
}

export function step(weight: "light" | "mid" | "heavy" | "click"): Gen {
  if (weight === "click") return clicks([2, 3], 0.06, 1200, 3000, 0.4);
  const f = weight === "light" ? 1800 : weight === "mid" ? 1100 : 500;
  return (r, sr) => {
    const d = alloc(0.3, sr);
    const ff = f * rand(r, 0.8, 1.25);
    addGrains(d, sr, r, { start: 0, dur: 0.08, count: weight === "light" ? 7 : 12, amp: 0.6, freqLo: ff * 0.5, freqHi: ff * 2.5, q: 1, grainLo: 0.004, grainHi: 0.02 });
    addGrains(d, sr, r, { start: rand(r, 0.06, 0.11), dur: 0.08, count: weight === "light" ? 3 : 6, amp: 0.3, freqLo: ff * 0.4, freqHi: ff * 1.8, q: 1, grainLo: 0.004, grainHi: 0.016 });
    const low = (weight === "heavy" ? 55 : 110) * rand(r, 0.8, 1.25);
    addTone(d, sr, { dur: 0.15, freq: (t) => low * (1 + Math.exp(-t / 0.01)), amp: (weight === "heavy" ? 0.8 : 0.35) * rand(r, 0.7, 1), decay: rand(r, 0.02, 0.04) });
    return d;
  };
}

export function hissNoise(dur: number, lo: number, attack = 0.3): Gen {
  return noiseSweep(dur, lo, lo * 1.3, 0.7, attack, "highpass");
}

export const R = recipe;

export function grunt(f: number, shift = 1, rough = 0.4): Gen {
  return say({ dur: 0.3, f: [f, f * 1.15, f * 0.8], vowels: ["uh", "a", "u"], rough, breath: 0.15, shift });
}

export function genericMob(f: number, shift = 1): MobSounds {
  return {
    ambient: R(say({ dur: 0.6, f: [f, f * 1.1, f * 0.9], vowels: ["uh", "o", "u"], rough: 0.3, breath: 0.1, shift }), 0.6),
    hurt: R(grunt(f * 1.3, shift), 0.8),
    death: R(say({ dur: 0.8, f: [f * 1.3, f, f * 0.6], vowels: ["a", "uh", "u"], rough: 0.4, breath: 0.15, shift }), 0.8),
    step: R(step("mid"), 0.75, 4, 0.1),
  };
}
