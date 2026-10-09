import type { Sfx } from "./contracts";
import { type C, type Recipe, type Rng, ahr, hz, env, filter, gain, hit, lfo, noise, osc, shaper, slide } from "./audio-dsp";
import { bell, boom, brassStab, crash, horn, impact, kick, strStac } from "./audio-inst";

const thud = (c: C, o: AudioNode, f0: number, f1: number, tau: number, level = 1, t = 0) => {
  const s = osc(c, env(c, shaper(c, o, 1.8), (p) => hit(p, t, level, 0.003, tau)), "sine", f0, t, tau * 6 + 0.1);
  slide(s.frequency, t, f0, f1, tau * 2);
};

const hiss = (c: C, o: AudioNode, t: number, a: number, tau: number, f: number, level = 1, q = 0.9) =>
  noise(c, filter(c, filter(c, env(c, o, (p) => hit(p, t, level, a, tau)), "bandpass", f, q), "highpass", 1200), t, a + tau * 6);

const ring = (c: C, o: AudioNode, fs: number[], tau: number, level: number, t = 0) => {
  fs.forEach((fr, i) => osc(c, env(c, o, (p) => hit(p, t, level / (1 + i * 0.5), 0.001, tau / (1 + i * 0.3))), "sine", fr, t, tau * 6));
};

const shing = (c: C, o: AudioNode, r: Rng, t: number, level: number, len = 0.12) => {
  const bp = filter(c, env(c, o, (p) => hit(p, t, level, 0.004, len)), "bandpass", 2500, 2.5);
  slide(bp.frequency, t, 1800 + r() * 600, 9000, len * 1.5);
  noise(c, bp, t, len * 6);
  const base = 2600 + r() * 900;
  ring(c, o, [base, base * 1.47, base * 2.13], 0.18, level * 0.25, t + 0.02);
  noise(c, filter(c, env(c, o, (p) => hit(p, t, level * 0.5, 0.02, 0.06)), "lowpass", 900), t, 0.4);
};

const squelch = (c: C, o: AudioNode, r: Rng, t: number, level: number) => {
  const bp = filter(c, env(c, o, (p) => hit(p, t, level, 0.003, 0.08)), "bandpass", 700, 3);
  bp.frequency.setValueAtTime(500 + r() * 400, t);
  lfo(c, [bp.frequency], 23 + r() * 10, 350, t, 0.5);
  noise(c, shaper(c, bp, 3), t, 0.5);
};

const crackles = (c: C, o: AudioNode, r: Rng, t: number, span: number, count: number, lo: number, hi: number, level: number) => {
  for (let i = 0; i < count; i++) {
    const at = t + Math.pow(r(), 1.6) * span;
    const fr = lo + r() * (hi - lo);
    osc(c, env(c, o, (p) => hit(p, at, level * (0.4 + r() * 0.6), 0.0005, 0.006 + r() * 0.02)), "sine", fr, at, 0.15);
  }
};

const debris = (c: C, o: AudioNode, r: Rng, t: number, span: number, n: number, level: number) => {
  for (let i = 0; i < n; i++) {
    const at = t + Math.pow(r(), 1.4) * span;
    const bp = filter(c, env(c, o, (p) => hit(p, at, level * (0.3 + r() * 0.7), 0.002, 0.03 + r() * 0.08)), "bandpass", 300 + r() * 1800, 1.5);
    noise(c, bp, at, 0.4);
  }
};

const rumble = (c: C, o: AudioNode, t: number, a: number, tau: number, f: number, level: number) =>
  noise(c, filter(c, env(c, o, (p) => hit(p, t, level, a, tau)), "lowpass", f, 1.2), t, a + tau * 6);

const roarVoice = (c: C, o: AudioNode, r: Rng, dur: number, f: number, level: number) => {
  const out = filter(c, env(c, o, (p) => ahr(p, 0, level, 0.18, dur - 0.6, 0.5)), "lowpass", 3200);
  const sh = shaper(c, out, 5);
  const v = [[650, 1, 1.4], [1080, 0.6, 2], [2500, 0.25, 3]] as const;
  const fm = c.createGain();
  for (const [fr, a, q] of v) fm.connect(filter(c, gain(c, sh, a), "bandpass", fr * (0.9 + r() * 0.2), q));
  const am = gain(c, fm, 0.7);
  lfo(c, [am.gain], 28 + r() * 12, 0.35, 0, dur, "triangle");
  for (const d of [-25, 0, 18]) {
    const s = osc(c, am, "sawtooth", f, 0, dur, d);
    s.frequency.setValueAtTime(f * 0.8, 0);
    s.frequency.linearRampToValueAtTime(f * 1.15, dur * 0.35);
    s.frequency.linearRampToValueAtTime(f * 0.7, dur);
  }
  noise(c, gain(c, fm, 0.4), 0, dur);
  osc(c, gain(c, out, 0.4), "sawtooth", f / 2, 0, dur);
};

const blip = (c: C, o: AudioNode, t: number, f0: number, f1: number, tau: number, level: number) => {
  const s = osc(c, env(c, o, (p) => hit(p, t, level, 0.002, tau)), "triangle", f0, t, tau * 6);
  slide(s.frequency, t, f0, f1, tau * 2);
};

const steam = (c: C, o: AudioNode, t: number, len: number, level: number) => {
  const g = env(c, o, (p) => ahr(p, t, level, 0.08, len * 0.3, len * 0.7));
  noise(c, filter(c, filter(c, g, "highpass", 2200), "peaking", 6000, 1, 5), t, len * 1.5);
};

export type SfxDef = { dur: number; n: number; g: number; duck?: number; lo?: boolean; fn: Recipe };

export const SFX: Record<Sfx, SfxDef> = {
  anchorFire: { dur: 0.6, n: 3, g: 1.2, fn: (c, o, _f, r) => {
    thud(c, o, 260, 120, 0.03, 0.8);
    ring(c, o, [1150 + r() * 200, 1900, 3100], 0.06, 0.25);
    noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.7, 0.001, 0.01)), "bandpass", 2400, 1.2), 0, 0.05);
    const am = env(c, o, (p) => ahr(p, 0.01, 0.35, 0.02, 0.2, 0.25));
    lfo(c, [am.gain], 70 + r() * 20, 0.2, 0, 0.6, "square");
    const s = osc(c, filter(c, am, "bandpass", 1600, 2), "sawtooth", 700, 0, 0.6);
    slide(s.frequency, 0, 700 + r() * 100, 1500, 0.45);
    hiss(c, o, 0, 0.005, 0.05, 3500, 0.3);
  } },
  anchorHit: { dur: 0.5, n: 3, g: 0.95, fn: (c, o, _f, r) => {
    thud(c, o, 150, 70, 0.06, 1);
    noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.6, 0.001, 0.03)), "lowpass", 1600), 0, 0.2);
    ring(c, o, [2200 + r() * 300, 3500], 0.08, 0.15);
  } },
  anchorMiss: { dur: 0.5, n: 2, g: 0.28, fn: (c, o, _f, r) => {
    const s = osc(c, filter(c, env(c, o, (p) => ahr(p, 0, 0.3, 0.01, 0.1, 0.25)), "bandpass", 1500, 2), "sawtooth", 1300, 0, 0.5);
    slide(s.frequency, 0, 1300 + r() * 200, 600, 0.4);
    ring(c, o, [3300 + r() * 500], 0.04, 0.2, 0.25);
  } },
  reel: { dur: 0.7, n: 3, g: 0.28, fn: (c, o, _f, r) => {
    const g = env(c, o, (p) => ahr(p, 0, 0.6, 0.03, 0.4, 0.2));
    lfo(c, [g.gain], 36 + r() * 8, 0.3, 0, 0.7, "square");
    const s = osc(c, filter(c, g, "bandpass", 1800, 3), "sawtooth", 600, 0, 0.7);
    slide(s.frequency, 0, 550 + r() * 80, 1250, 0.55);
    const s2 = osc(c, gain(c, g, 0.3), "square", 2400, 0, 0.7);
    slide(s2.frequency, 0, 2200, 3600, 0.55);
    hiss(c, o, 0, 0.02, 0.15, 4000, 0.2);
  } },
  release: { dur: 0.35, n: 2, g: 1.6, fn: (c, o) => {
    noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.8, 0.001, 0.01)), "bandpass", 3000, 2), 0, 0.05);
    ring(c, o, [2800, 4100], 0.03, 0.2);
    hiss(c, o, 0.01, 0.01, 0.05, 5000, 0.3);
  } },
  gasBurst: { dur: 0.9, n: 3, g: 1.0, fn: (c, o, _f, r) => {
    hiss(c, o, 0, 0.012, 0.14, 3500 + r() * 1500, 1, 0.6);
    noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.35, 0.02, 0.1)), "lowpass", 500), 0, 0.8);
    osc(c, env(c, o, (p) => hit(p, 0, 0.05, 0.02, 0.1)), "sine", 3200 + r() * 400, 0, 0.6);
  } },
  gasDash: { dur: 1.1, n: 3, g: 1.2, fn: (c, o, _f, r) => {
    const bp = filter(c, env(c, o, (p) => hit(p, 0, 1, 0.01, 0.2)), "bandpass", 2000, 0.7);
    slide(bp.frequency, 0, 1800 + r() * 400, 6500, 0.4);
    noise(c, filter(c, bp, "highpass", 900), 0, 1.1);
    noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.7, 0.03, 0.18)), "lowpass", 380), 0, 1.1);
    thud(c, o, 90, 45, 0.08, 0.6);
  } },
  land: { dur: 0.5, n: 3, g: 0.62, fn: (c, o, _f, r) => {
    thud(c, o, 110, 50, 0.07, 1);
    noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.5, 0.002, 0.05)), "lowpass", 1400 + r() * 500), 0, 0.4);
    debris(c, o, r, 0.01, 0.15, 5, 0.15);
  } },
  roll: { dur: 0.6, n: 2, g: 0.4, fn: (c, o, _f, r) => {
    const g = env(c, o, (p) => ahr(p, 0, 0.7, 0.02, 0.25, 0.2));
    lfo(c, [g.gain], 14, 0.3, 0, 0.6);
    noise(c, filter(c, g, "lowpass", 900), 0, 0.6);
    debris(c, o, r, 0, 0.4, 6, 0.12);
  } },
  bladeDraw: { dur: 0.7, n: 2, g: 0.32, fn: (c, o, _f, r) => {
    const bp = filter(c, env(c, o, (p) => ahr(p, 0, 0.6, 0.02, 0.2, 0.1)), "bandpass", 3000, 5);
    slide(bp.frequency, 0, 2800, 7500, 0.3);
    noise(c, bp, 0, 0.5);
    ring(c, o, [3100 + r() * 200, 4700, 6200], 0.2, 0.3, 0.26);
  } },
  charge: { dur: 1.0, n: 1, g: 0.5, fn: (c, o) => {
    const g = env(c, o, (p) => ahr(p, 0, 0.6, 0.6, 0.2, 0.15));
    const bp = filter(c, g, "bandpass", 500, 3);
    slide(bp.frequency, 0, 400, 3500, 0.8);
    const s = osc(c, bp, "sawtooth", 180, 0, 1);
    slide(s.frequency, 0, 180, 720, 0.8);
    noise(c, filter(c, gain(c, g, 0.4), "highpass", 4000), 0, 1);
  } },
  slash: { dur: 0.7, n: 4, g: 1.1, fn: (c, o, _f, r) => shing(c, o, r, 0, 1) },
  slashHit: { dur: 0.7, n: 4, g: 1.9, fn: (c, o, _f, r) => {
    shing(c, o, r, 0, 0.8, 0.08);
    squelch(c, o, r, 0.01, 0.9);
    thud(c, o, 140, 70, 0.05, 0.7);
  } },
  slashCrit: { dur: 1.0, n: 3, g: 1.6, duck: 0.3, fn: (c, o, _f, r) => {
    shing(c, o, r, 0, 1, 0.15);
    squelch(c, o, r, 0.01, 1);
    thud(c, o, 120, 45, 0.1, 1);
    noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.8, 0.001, 0.015)), "highpass", 2500), 0, 0.1);
    ring(c, o, [3800, 5600, 7900], 0.35, 0.3, 0.02);
  } },
  sever: { dur: 1.0, n: 3, g: 1.5, duck: 0.4, fn: (c, o, _f, r) => {
    thud(c, o, 90, 35, 0.12, 1);
    const sh = shaper(c, filter(c, o, "bandpass", 900, 0.8), 4);
    noise(c, env(c, sh, (p) => hit(p, 0, 1, 0.002, 0.07)), 0, 0.5);
    squelch(c, o, r, 0, 1);
    squelch(c, o, r, 0.09, 0.6);
    crackles(c, o, r, 0.02, 0.12, 8, 1200, 3000, 0.4);
    shing(c, o, r, 0, 0.5, 0.06);
  } },
  napeKill: { dur: 2.4, n: 2, g: 1.6, duck: 0.8, fn: (c, o, _f, r) => {
    shing(c, o, r, 0, 1, 0.18);
    squelch(c, o, r, 0.02, 1);
    thud(c, o, 100, 30, 0.2, 1);
    steam(c, gain(c, o, 0.5), 0.08, 1.6, 1);
    const orch = gain(c, o, 0.6);
    kick(c, orch, 1, r);
    for (const m of [50, 57, 62, 65]) brassStab(c, gain(c, orch, 0.25), hz(m), r);
    for (const m of [38, 50]) strStac(c, gain(c, orch, 0.3), hz(m), r);
    crash(c, gain(c, orch, 0.3), 1, r);
  } },
  clang: { dur: 1.2, n: 3, g: 1.0, fn: (c, o, _f, r) => {
    const b = 1700 + r() * 300;
    ring(c, o, [b, b * 1.56, b * 2.41, b * 3.47, b * 4.3], 0.35, 0.8);
    ring(c, o, [b * 1.01, b * 2.43], 0.3, 0.3);
    noise(c, filter(c, env(c, o, (p) => hit(p, 0, 1, 0.0005, 0.006)), "highpass", 3000), 0, 0.05);
  } },
  bladeBreak: { dur: 1.2, n: 2, g: 1.4, duck: 0.3, fn: (c, o, _f, r) => {
    const b = 1500 + r() * 300;
    ring(c, o, [b, b * 1.56, b * 2.41], 0.2, 0.7);
    noise(c, filter(c, env(c, o, (p) => hit(p, 0, 1, 0.0005, 0.02)), "highpass", 2000), 0, 0.2);
    crackles(c, o, r, 0.01, 0.5, 40, 3000, 9000, 0.35);
    debris(c, o, r, 0.03, 0.4, 6, 0.2);
  } },
  bladeSwap: { dur: 0.6, n: 2, g: 0.55, fn: (c, o, _f, r) => {
    for (const t of [0, 0.12]) {
      noise(c, filter(c, env(c, o, (p) => hit(p, t, 0.8, 0.0005, 0.008)), "bandpass", 2800, 2), t, 0.05);
      thud(c, o, 300, 200, 0.015, 0.4, t);
    }
    ring(c, o, [3200 + r() * 300, 5100], 0.15, 0.25, 0.12);
  } },
  resupply: { dur: 1.2, n: 1, g: 0.8, fn: (c, o) => {
    thud(c, o, 200, 120, 0.03, 0.6);
    ring(c, o, [1400, 2300], 0.06, 0.3);
    const g = env(c, o, (p) => ahr(p, 0.05, 0.4, 0.05, 0.4, 0.2));
    noise(c, filter(c, g, "bandpass", 3000, 0.8), 0.05, 0.8);
    blip(c, o, 0.5, 880, 880, 0.15, 0.25);
    blip(c, o, 0.62, 1320, 1320, 0.25, 0.25);
  } },
  hurt: { dur: 0.6, n: 3, g: 1.2, fn: (c, o, _f, r) => {
    thud(c, o, 130, 55, 0.07, 1);
    noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.6, 0.001, 0.04)), "lowpass", 1200), 0, 0.3);
    const fm = filter(c, filter(c, env(c, o, (p) => ahr(p, 0.02, 0.4, 0.02, 0.08, 0.1)), "bandpass", 600, 2), "lowpass", 2000);
    const s = osc(c, fm, "sawtooth", 160 + r() * 30, 0.02, 0.3);
    slide(s.frequency, 0.02, 170 + r() * 30, 110, 0.2);
  } },
  grabbed: { dur: 1.0, n: 2, g: 0.7, duck: 0.4, fn: (c, o, _f, r) => {
    noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.8, 0.05, 0.12)), "lowpass", 600), 0, 0.8);
    thud(c, o, 100, 40, 0.12, 1, 0.08);
    const g = env(c, o, (p) => ahr(p, 0.1, 0.5, 0.05, 0.3, 0.2));
    lfo(c, [g.gain], 18, 0.3, 0.1, 0.8);
    noise(c, filter(c, g, "bandpass", 500, 2), 0.1, 0.8);
    crackles(c, o, r, 0.15, 0.3, 6, 800, 2000, 0.25);
  } },
  bite: { dur: 0.8, n: 2, g: 1.1, duck: 0.4, fn: (c, o, _f, r) => {
    thud(c, o, 120, 40, 0.1, 1);
    const sh = shaper(c, filter(c, o, "bandpass", 1100, 0.9), 5);
    for (const t of [0, 0.04, 0.09, 0.15]) noise(c, env(c, sh, (p) => hit(p, t, 0.7, 0.001, 0.025)), t, 0.2);
    squelch(c, o, r, 0.05, 0.8);
    crackles(c, o, r, 0, 0.2, 10, 1500, 4000, 0.4);
  } },
  escape: { dur: 0.8, n: 2, g: 1.3, fn: (c, o, _f, r) => {
    hiss(c, o, 0, 0.01, 0.12, 4000, 0.9, 0.6);
    shing(c, o, r, 0.05, 0.7);
    thud(c, o, 140, 60, 0.05, 0.6);
  } },
  death: { dur: 2.5, n: 1, g: 0.8, duck: 0.6, fn: (c, o, _f, r) => {
    thud(c, o, 100, 30, 0.25, 1);
    squelch(c, o, r, 0, 0.8);
    crackles(c, o, r, 0, 0.3, 12, 900, 2500, 0.4);
    const s = osc(c, filter(c, env(c, o, (p) => ahr(p, 0.05, 0.3, 0.2, 1, 0.8)), "lowpass", 900), "sawtooth", 220, 0.05, 2.4);
    slide(s.frequency, 0.05, 220, 55, 2.2);
  } },
  stomp: { dur: 2.2, n: 3, g: 0.95, duck: 0.4, fn: (c, o, _f, r) => {
    thud(c, o, 60, 24, 0.35, 1);
    rumble(c, o, 0, 0.01, 0.4, 220, 0.9);
    debris(c, o, r, 0.05, 0.8, 14, 0.25);
    noise(c, filter(c, env(c, o, (p) => hit(p, 0, 0.6, 0.002, 0.04)), "lowpass", 2000), 0, 0.3);
  } },
  swat: { dur: 1.2, n: 3, g: 0.85, duck: 0.4, fn: (c, o, _f, r) => {
    const bp = filter(c, env(c, o, (p) => ahr(p, 0, 0.8, 0.18, 0.02, 0.08)), "bandpass", 300, 1.2);
    slide(bp.frequency, 0, 200 + r() * 60, 900, 0.2);
    noise(c, bp, 0, 0.4);
    thud(c, o, 110, 32, 0.14, 1, 0.2);
    noise(c, filter(c, env(c, o, (p) => hit(p, 0.2, 0.9, 0.001, 0.05)), "lowpass", 1800), 0.2, 0.4);
    squelch(c, o, r, 0.21, 0.6);
    debris(c, o, r, 0.22, 0.3, 5, 0.2);
  } },
  titanStep: { dur: 1.4, n: 4, g: 0.75, lo: true, fn: (c, o, _f, r) => {
    thud(c, o, 52 + r() * 8, 26, 0.25, 1);
    rumble(c, o, 0, 0.01, 0.25, 160, 0.6);
    debris(c, o, r, 0.03, 0.4, 4, 0.12);
  } },
  roar: { dur: 2.6, n: 2, g: 0.85, duck: 0.5, lo: true, fn: (c, o, _f, r) => roarVoice(c, o, r, 2.5, 95 + r() * 25, 1) },
  titanHurt: { dur: 1.2, n: 3, g: 0.75, lo: true, fn: (c, o, _f, r) => roarVoice(c, o, r, 1.1, 150 + r() * 40, 1) },
  titanFall: { dur: 3.5, n: 2, g: 1, duck: 0.6, fn: (c, o, f, r) => {
    thud(c, o, 55, 20, 0.6, 1);
    rumble(c, o, 0, 0.05, 0.8, 180, 1);
    boom(c, gain(c, o, 0.6), f, r);
    debris(c, o, r, 0.05, 2, 30, 0.3);
    steam(c, gain(c, o, 0.3), 0.3, 2.5, 1);
  } },
  steamHiss: { dur: 2.2, n: 2, g: 0.25, fn: (c, o) => steam(c, o, 0, 1.7, 1) },
  harden: { dur: 1.8, n: 2, g: 0.75, fn: (c, o, _f, r) => {
    crackles(c, o, r, 0, 1.2, 90, 2500, 10000, 0.35);
    const g = env(c, filter(c, o, "highpass", 1500), (p) => ahr(p, 0, 0.3, 0.6, 0.3, 0.5));
    for (const b of [1800, 2700, 4050]) {
      const s = osc(c, g, "triangle", b * (0.95 + r() * 0.1), 0, 1.8);
      slide(s.frequency, 0, b, b * 1.5, 1.2);
    }
    const cr = filter(c, env(c, o, (p) => ahr(p, 0, 0.4, 0.3, 0.6, 0.3)), "bandpass", 300, 4);
    lfo(c, [cr.frequency], 7, 120, 0, 1.6);
    noise(c, shaper(c, cr, 3), 0, 1.6);
  } },
  horn: { dur: 3.8, n: 1, g: 0.7, lo: true, fn: (c, o, _f, r) => horn(c, o, hz(50), r) },
  bell: { dur: 5, n: 1, g: 0.55, lo: true, fn: (c, o, _f, r) => bell(c, o, hz(50), r) },
  gateBreak: { dur: 5, n: 1, g: 1, duck: 0.9, fn: (c, o, f, r) => {
    impact(c, gain(c, o, 0.8), f, r);
    const sh = shaper(c, filter(c, o, "bandpass", 500, 0.6), 4);
    for (const t of [0, 0.07, 0.18, 0.32]) noise(c, env(c, sh, (p) => hit(p, t, 0.6, 0.002, 0.12)), t, 1);
    rumble(c, o, 0, 0.05, 1.2, 200, 1);
    debris(c, o, r, 0.1, 3.5, 60, 0.35);
    crackles(c, o, r, 0.05, 1, 30, 600, 2500, 0.3);
  } },
  lightning: { dur: 4, n: 2, g: 1, duck: 0.9, fn: (c, o, f, r) => {
    noise(c, filter(c, env(c, o, (p) => hit(p, 0, 1, 0.0005, 0.03)), "highpass", 800), 0, 0.3);
    noise(c, env(c, o, (p) => hit(p, 0.005, 0.8, 0.001, 0.012)), 0.005, 0.1);
    const g = env(c, o, (p) => ahr(p, 0.05, 0.9, 0.1, 0.6, 1.8));
    lfo(c, [g.gain], 9 + r() * 4, 0.35, 0.05, 3.5, "triangle");
    noise(c, filter(c, g, "lowpass", 500, 0.8), 0.05, 3.5);
    boom(c, gain(c, o, 0.8), f, r);
    const z = filter(c, env(c, o, (p) => hit(p, 0, 0.25, 0.002, 0.15)), "bandpass", 1800, 2);
    const s = osc(c, z, "sawtooth", 120, 0, 0.8);
    lfo(c, [s.frequency], 60, 80, 0, 0.8, "square");
  } },
  lock: { dur: 0.3, n: 1, g: 0.48, fn: (c, o) => {
    blip(c, o, 0, 1200, 1250, 0.03, 0.6);
    blip(c, o, 0.06, 1800, 1850, 0.05, 0.6);
  } },
  lockCycle: { dur: 0.2, n: 1, g: 1.2, fn: (c, o) => blip(c, o, 0, 1500, 1550, 0.025, 0.6) },
  ui: { dur: 0.2, n: 1, g: 1.5, fn: (c, o) => blip(c, o, 0, 900, 880, 0.02, 0.6) },
};
