// HOOPS audio: baked one-shot sound effects. Every sound is generated sample by sample at startup.
// Owner: audio-fx.
import type { Sfx } from "./contracts";
import { type Rng, TAU, finish, hp1, lp1, mode, rng, svf } from "./audio-dsp";

type Gen = (sr: number, r: Rng, k: number) => Float32Array;
export type BankName = Sfx | "pa" | "stomp" | "clapCrowd" | "slap" | "fire" | "grunt";

const N = (sr: number, s: number) => new Float32Array(Math.floor(sr * s));

// Basketball on hardwood: low body thump, hollow ball "pang" partials, sharp leather click.
const dribble: Gen = (sr, r, k) => {
  const d = N(sr, 0.3);
  const f0 = 150 + k * 9 + r() * 10;
  const pang = 395 + r() * 60;
  const click = svf(sr).set(3200 + r() * 1500, 1.2);
  const body = lp1(sr, 2200);
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    ph += (f0 * (0.68 + 0.32 * Math.exp(-t / 0.012))) / sr;
    let y = Math.sin(TAU * ph) * Math.exp(-t / 0.032) * 1.1;
    y += mode(t, pang, 0.055) * 0.42 + mode(t, pang * 2.71, 0.02) * 0.16 + mode(t, pang * 4.1, 0.012) * 0.07;
    y += click.run(r() * 2 - 1) * Math.exp(-t / 0.0035) * 1.6;
    y += mode(t, 62, 0.05) * 0.4; // floor boards
    d[i] = Math.tanh(body(y) * 1.4);
  }
  return finish(d, 0.95, sr);
};

const floor: Gen = (sr, r, k) => {
  const d = N(sr, 0.4);
  const f0 = 125 + r() * 20;
  const pang = 360 + k * 40;
  const click = svf(sr).set(2600, 0.9);
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    ph += (f0 * (0.7 + 0.3 * Math.exp(-t / 0.015))) / sr;
    let y = Math.sin(TAU * ph) * Math.exp(-t / 0.045);
    y += mode(t, pang, 0.09) * 0.5 + mode(t, pang * 2.6, 0.03) * 0.18;
    y += click.run(r() * 2 - 1) * Math.exp(-t / 0.005) * 1.3;
    d[i] = Math.tanh(y * 1.3);
  }
  return finish(d, 0.9, sr);
};

// Sneaker on lacquered maple: a stick-slip chirp. Harmonic rich tone, fast jitter, pitch glides.
const squeak: Gen = (sr, r, k) => {
  const dur = 0.07 + r() * 0.17 + (k % 3) * 0.03;
  const d = N(sr, dur + 0.02);
  const f0 = 1500 + r() * 1700;
  const f1 = f0 * (k % 2 ? 1.25 + r() * 0.3 : 0.7 + r() * 0.2);
  const bp = svf(sr).set(2600 + r() * 1200, 1.4);
  const hp = hp1(sr, 900);
  let ph = 0;
  let slip = 1;
  let next = 0;
  const rate = 90 + r() * 90;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const x = Math.min(1, t / dur);
    if (t >= next) {
      slip = 0.55 + r() * 0.45;
      next = t + 1 / (rate * (0.7 + r() * 0.6));
    }
    const f = f0 + (f1 - f0) * x * x + Math.sin(TAU * 37 * t) * 60 + (r() - 0.5) * 140;
    ph += f / sr;
    const p = ph % 1;
    const tone = Math.sin(TAU * p) + 0.55 * Math.sin(2 * TAU * p) + 0.3 * Math.sin(3 * TAU * p) + 0.15 * Math.sin(5 * TAU * p);
    const envA = Math.min(1, t / 0.006) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / 0.015)) * (0.75 + 0.25 * Math.sin(Math.PI * x));
    const y = tone * slip * envA + (r() - 0.5) * 0.25 * envA;
    d[i] = hp(bp.run(y) * 1.2 + y * 0.35);
  }
  return finish(d, 0.8, sr, 0.002, 0.008);
};

// Ball through a nylon net: brushed noise with cord flicks, ending in a soft snap.
const swish: Gen = (sr, r, k) => {
  const d = N(sr, 0.5);
  const bp = svf(sr);
  const bp2 = svf(sr).set(7000, 0.8);
  const thump = lp1(sr, 300);
  const dur = 0.22 + k * 0.03;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    if (i % 16 === 0) bp.set(2400 + 3800 * Math.sin(Math.min(1, t / dur) * Math.PI) + 500 * r(), 0.9);
    const n = r() * 2 - 1;
    const envA = t < 0.012 ? t / 0.012 : Math.exp(-(t - 0.012) / (dur * 0.42));
    const cords = 0.6 + 0.4 * Math.abs(Math.sin(TAU * (38 + k * 6) * t + r() * 0.3));
    let y = bp.run(n) * envA * cords * 1.6 + bp2.run(n) * envA * 0.5;
    const snapT = t - dur * 0.75;
    if (snapT > 0) y += bp2.run(n) * Math.exp(-snapT / 0.02) * 0.9;
    y += thump(n) * Math.exp(-t / 0.03) * 1.2;
    d[i] = y;
  }
  return finish(d, 0.85, sr, 0.002, 0.03);
};

const net: Gen = (sr, r, k) => {
  const d = N(sr, 0.35);
  const bp = svf(sr);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    if (i % 16 === 0) bp.set(3200 + 2000 * Math.exp(-t / 0.1) + 300 * k, 0.8);
    const envA = Math.min(1, t / 0.01) * Math.exp(-t / 0.08);
    d[i] = bp.run(r() * 2 - 1) * envA * (0.7 + 0.3 * Math.sin(TAU * 44 * t));
  }
  return finish(d, 0.7, sr, 0.002, 0.03);
};

// Steel rim: inharmonic ring modes, the ball's thunk, and the support arm rattle.
const RIM_MODES = [612, 1180, 1655, 2390, 3260, 4410, 5650];
const rim: Gen = (sr, r, k) => {
  const hard = k >= 2;
  const d = N(sr, hard ? 0.9 : 0.6);
  const detune = 0.93 + r() * 0.14;
  const modes = RIM_MODES.map((f, j) => ({ f: f * detune * (0.98 + r() * 0.04), tau: (hard ? 0.22 : 0.13) / (1 + j * 0.35), a: (1 / (1 + j * 0.5)) * (0.6 + r() * 0.6), ph: r() * TAU }));
  const click = svf(sr).set(4500, 1);
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    let y = 0;
    for (const m of modes) y += mode(t, m.f, m.tau, m.ph) * m.a * 0.5;
    ph += (210 * (0.75 + 0.25 * Math.exp(-t / 0.02))) / sr;
    y += Math.sin(TAU * ph) * Math.exp(-t / 0.04) * 0.9; // ball thunk
    y += mode(t, 88, 0.12) * (hard ? 0.45 : 0.2); // arm / stanchion
    y += click.run(r() * 2 - 1) * Math.exp(-t / 0.002) * 1.2;
    // a slight wobble in the ring as the rim flexes
    y *= 1 + 0.15 * Math.sin(TAU * 11 * t) * Math.exp(-t / 0.2);
    d[i] = Math.tanh(y * 1.2);
  }
  return finish(d, 0.9, sr, 0.0003, 0.05);
};

const rimRattle: Gen = (sr, r, k) => {
  const d = N(sr, 1.1);
  const hits: number[] = [];
  let t = 0;
  let gap = 0.08 + r() * 0.04;
  while (t < 0.85) {
    hits.push(t);
    t += gap;
    gap *= k ? 1.12 : 0.88 + r() * 0.2;
  }
  for (const h of hits) {
    const a = 0.35 + r() * 0.5;
    const f = RIM_MODES[0] * (0.95 + r() * 0.1);
    const s0 = Math.floor(h * sr);
    for (let i = 0; i < sr * 0.18 && s0 + i < d.length; i++) {
      const tt = i / sr;
      d[s0 + i] += a * (mode(tt, f, 0.06) * 0.6 + mode(tt, f * 1.93, 0.04) * 0.4 + mode(tt, f * 3.8, 0.02) * 0.25 + mode(tt, 200, 0.02) * 0.5);
    }
  }
  return finish(d, 0.75, sr, 0.0005, 0.05);
};

// Tempered glass board in an aluminium frame: thick "thock", glass partials, frame buzz.
const backboard: Gen = (sr, r, k) => {
  const d = N(sr, 0.7);
  const f0 = 190 + r() * 30 + k * 10;
  const lp = lp1(sr, 2500);
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    ph += (f0 * (0.8 + 0.2 * Math.exp(-t / 0.01))) / sr;
    let y = Math.sin(TAU * ph) * Math.exp(-t / 0.05) * 1.2;
    y += mode(t, 940 + r() * 3, 0.09) * 0.25 + mode(t, 1730, 0.06) * 0.18 + mode(t, 2870, 0.04) * 0.1;
    y += mode(t, 72, 0.18) * 0.5;
    y += (r() * 2 - 1) * Math.exp(-t / 0.004) * 0.6;
    y += Math.sign(Math.sin(TAU * 143 * t)) * Math.exp(-t / 0.06) * 0.06; // frame buzz
    d[i] = Math.tanh(lp(y) * 1.5);
  }
  return finish(d, 0.9, sr, 0.0003, 0.05);
};

// Slam: hard rim strike, breakaway spring buzz, stanchion boom, glass shudder.
const dunk: Gen = (sr, r, k) => {
  const d = N(sr, 1.6);
  const det = 0.9 + r() * 0.15;
  const modes = RIM_MODES.map((f, j) => ({ f: f * det * 0.94, tau: 0.35 / (1 + j * 0.3), a: 1 / (1 + j * 0.4) }));
  const spring = svf(sr).set(1900, 6);
  const boom = lp1(sr, 160);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    let y = 0;
    for (const m of modes) y += mode(t, m.f, m.tau) * m.a * 0.55;
    y += mode(t, 56 + k * 4, 0.42) * 1.3 + mode(t, 83, 0.25) * 0.7; // stanchion
    y += boom(r() * 2 - 1) * Math.exp(-t / 0.06) * 4;
    y += spring.run(Math.sign(Math.sin(TAU * 31 * t)) * (r() * 0.5 + 0.5)) * Math.exp(-t / 0.18) * 0.5;
    y += mode(t, 940, 0.12) * 0.3 + mode(t, 1730, 0.08) * 0.2; // glass
    y += (r() * 2 - 1) * Math.exp(-t / 0.006) * 0.9;
    d[i] = Math.tanh(y * 1.4);
  }
  return finish(d, 0.98, sr, 0.0003, 0.1);
};

const catchS: Gen = (sr, r, k) => {
  const d = N(sr, 0.16);
  const bp = svf(sr).set(1300 + k * 300 + r() * 300, 1.1);
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    ph += 230 / sr;
    d[i] = bp.run(r() * 2 - 1) * Math.exp(-t / 0.012) * 1.5 + Math.sin(TAU * ph) * Math.exp(-t / 0.025) * 0.6 + mode(t, 520, 0.02) * 0.2;
  }
  return finish(d, 0.75, sr);
};

const pass: Gen = (sr, r, k) => {
  const d = N(sr, 0.32);
  const bp = svf(sr);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const x = t / 0.3;
    if (i % 16 === 0) bp.set(500 + 1300 * Math.sin(Math.PI * x) + k * 150, 1.6);
    d[i] = bp.run(r() * 2 - 1) * Math.sin(Math.PI * Math.min(1, x)) ** 2;
  }
  return finish(d, 0.5, sr, 0.005, 0.02);
};

const slap: Gen = (sr, r, k) => {
  const d = N(sr, 0.25);
  const bp = svf(sr).set(2200 + r() * 800, 0.9);
  const lo = svf(sr).set(700, 1.2);
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    ph += 180 / sr;
    const n = r() * 2 - 1;
    d[i] = Math.tanh(bp.run(n) * Math.exp(-t / 0.007) * 3 + lo.run(n) * Math.exp(-t / 0.02) * 1.5 + Math.sin(TAU * ph) * Math.exp(-t / 0.03) * (0.8 + k * 0.2));
  }
  return finish(d, 0.9, sr);
};

const steal: Gen = (sr, r, k) => {
  const d = N(sr, 0.3);
  const s = slap(sr, r, k);
  const bp = svf(sr);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    if (i % 16 === 0) bp.set(900 + 2400 * Math.exp(-t / 0.05), 1.3);
    d[i] = (i < s.length ? s[i] * 0.8 : 0) + bp.run(r() * 2 - 1) * Math.exp(-t / 0.06) * 0.6;
  }
  return finish(d, 0.85, sr);
};

const bump: Gen = (sr, r, k) => {
  const d = N(sr, 0.3);
  const cloth = svf(sr).set(1800, 0.7);
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    ph += (95 * (0.8 + 0.2 * Math.exp(-t / 0.02))) / sr;
    d[i] = Math.sin(TAU * ph) * Math.exp(-t / 0.05) * 1.2 + cloth.run(r() * 2 - 1) * Math.exp(-t / 0.04) * (0.4 + 0.1 * k);
  }
  return finish(d, 0.8, sr);
};

// Effort grunt: a short voiced "hh-uh" through two formants.
const grunt: Gen = (sr, r, k) => {
  const d = N(sr, 0.22);
  const f1 = svf(sr).set(520 + k * 40, 5);
  const f2 = svf(sr).set(1250 + r() * 150, 6);
  let ph = 0;
  const p0 = 105 + r() * 30;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    ph += (p0 * (1 - 0.25 * t / 0.22)) / sr;
    const pulse = (ph % 1) < 0.08 ? 1 : 0;
    const src = pulse * 0.9 + (r() - 0.5) * 0.4;
    const envA = Math.min(1, t / 0.02) * Math.exp(-Math.max(0, t - 0.04) / 0.05);
    d[i] = (f1.run(src) + f2.run(src) * 0.6) * envA;
  }
  return finish(d, 0.5, sr, 0.003, 0.02);
};

// Pea whistle: ~3 kHz tone, the pea flutters it at ~30 Hz, breath noise on top. k: 0 tweet, 1 long, 2 double.
const whistle: Gen = (sr, r, k) => {
  const segs: [number, number][] = k === 0 ? [[0, 0.28]] : k === 1 ? [[0, 0.85]] : [[0, 0.17], [0.24, 0.62]];
  const d = N(sr, segs[segs.length - 1][1] + 0.08);
  const f0 = 2900 + r() * 250;
  const br = svf(sr).set(3200, 1.5);
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    let a = 0;
    for (const [s, e] of segs) if (t >= s && t < e + 0.04) a = Math.max(a, Math.min(1, (t - s) / 0.012) * Math.min(1, Math.max(0, (e + 0.04 - t) / 0.04)));
    const trill = Math.sin(TAU * (29 + 4 * Math.sin(TAU * 1.3 * t)) * t);
    ph += (f0 + trill * 170 + (r() - 0.5) * 40) / sr;
    const am = 0.75 + 0.25 * trill;
    d[i] = (Math.sin(TAU * ph) + 0.12 * Math.sin(2 * TAU * ph) + br.run(r() * 2 - 1) * 0.35) * a * am;
  }
  return finish(d, 0.85, sr, 0.001, 0.01);
};

// Arena horn: two detuned buzzy tones, hard start, flat sustain. k: 0 game horn, 1 shot clock horn.
const buzzer: Gen = (sr, r, k) => {
  const dur = k ? 1.05 : 1.75;
  const d = N(sr, dur + 0.05);
  const fa = k ? 330 : 196;
  const fb = fa * 1.26;
  const lp = svf(sr).set(k ? 3400 : 2600, 0.8);
  const res = svf(sr).set(k ? 1300 : 900, 2.5);
  let pa = 0, pb = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    pa += (fa * (1 + 0.003 * Math.sin(TAU * 6 * t))) / sr;
    pb += fb / sr;
    const sq = (pa % 1 < 0.5 ? 1 : -1) + 0.8 * (pb % 1 < 0.42 ? 1 : -1) + 0.3 * ((pa * 2) % 1 - 0.5);
    const a = Math.min(1, t / 0.008) * Math.min(1, Math.max(0, (dur - t) / 0.03));
    const y = lp.run(sq) * 0.7 + res.run(sq) * 0.5;
    d[i] = Math.tanh(y * 1.4) * a;
  }
  return finish(d, 0.9, sr, 0.001, 0.02);
};

const horn: Gen = (sr) => {
  const dur = 0.5;
  const d = N(sr, dur + 0.03);
  const lp = svf(sr).set(1900, 0.9);
  let pa = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    pa += 247 / sr;
    const sq = (pa % 1 < 0.5 ? 1 : -1) + 0.6 * ((pa * 1.5) % 1 < 0.5 ? 1 : -1);
    d[i] = Math.tanh(lp.run(sq) * 1.3) * Math.min(1, t / 0.006) * Math.min(1, Math.max(0, (dur - t) / 0.02));
  }
  return finish(d, 0.8, sr);
};

const shotClock: Gen = (sr, _r, k) => {
  const d = N(sr, 0.16);
  const f = k ? 1320 : 990;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const a = Math.min(1, t / 0.004) * Math.min(1, Math.max(0, (0.12 - t) / 0.01));
    d[i] = (Math.sin(TAU * f * t) * 0.7 + Math.sign(Math.sin(TAU * f * t)) * 0.15) * a;
  }
  return finish(d, 0.6, sr);
};

// Perfect release: a bright two-note FM glint with a shimmer tail. Original sound, used as the "green" cue.
const perfect: Gen = (sr, r) => {
  const d = N(sr, 1.0);
  const notes = [1318.5, 1975.5, 2637];
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    let y = 0;
    notes.forEach((f, j) => {
      const tt = t - j * 0.045;
      if (tt < 0) return;
      const idx = 2.2 * Math.exp(-tt / 0.08);
      y += Math.sin(TAU * f * tt + idx * Math.sin(TAU * f * 2 * tt)) * Math.exp(-tt / (0.25 - j * 0.04)) * (j === 2 ? 0.35 : 0.6);
    });
    y += (r() * 2 - 1) * 0.08 * Math.exp(-t / 0.15) * (0.5 + 0.5 * Math.sin(TAU * 60 * t));
    d[i] = y;
  }
  return finish(d, 0.7, sr, 0.001, 0.05);
};

const meterTick: Gen = (sr, r) => {
  const d = N(sr, 0.05);
  const bp = svf(sr).set(2400, 2);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    d[i] = bp.run(r() * 2 - 1) * Math.exp(-t / 0.004) + mode(t, 1800, 0.008) * 0.5;
  }
  return finish(d, 0.5, sr);
};

const ui = (notes: number[], step: number, tau: number, bright: number): Gen => (sr) => {
  const d = N(sr, step * notes.length + tau * 5);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    let y = 0;
    notes.forEach((f, j) => {
      const tt = t - j * step;
      if (tt < 0) return;
      y += Math.sin(TAU * f * tt + bright * Math.exp(-tt / 0.02) * Math.sin(TAU * f * 3 * tt)) * Math.exp(-tt / tau);
    });
    d[i] = y;
  }
  return finish(d, 0.55, sr, 0.0008, 0.01);
};

const menuMove: Gen = (sr, r) => {
  const d = N(sr, 0.06);
  const bp = svf(sr).set(1700, 3);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    d[i] = mode(t, 1650, 0.012) * 0.8 + bp.run(r() * 2 - 1) * Math.exp(-t / 0.003) * 0.6;
  }
  return finish(d, 0.45, sr);
};

const menuTab: Gen = (sr, r) => {
  const d = N(sr, 0.12);
  const bp = svf(sr);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    if (i % 8 === 0) bp.set(800 + 9000 * t, 2);
    d[i] = bp.run(r() * 2 - 1) * Math.exp(-t / 0.03) + mode(t, 1200, 0.015) * 0.4;
  }
  return finish(d, 0.45, sr);
};

const error: Gen = (sr) => {
  const d = N(sr, 0.3);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const on = (t < 0.09 || (t > 0.13 && t < 0.24)) ? 1 : 0;
    d[i] = Math.sign(Math.sin(TAU * 140 * t)) * 0.4 * on + Math.sin(TAU * 280 * t) * 0.3 * on;
  }
  const lp = lp1(sr, 1500);
  for (let i = 0; i < d.length; i++) d[i] = lp(d[i]);
  return finish(d, 0.45, sr, 0.002, 0.01);
};

// PA attention chime: two soft bells, a falling third.
const pa: Gen = (sr) => {
  const d = N(sr, 2.0);
  const notes: [number, number][] = [[0, 784], [0.42, 622.3]];
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    let y = 0;
    for (const [s, f] of notes) {
      const tt = t - s;
      if (tt < 0) continue;
      y += (Math.sin(TAU * f * tt) + 0.4 * Math.sin(TAU * f * 2.01 * tt) * Math.exp(-tt / 0.3) + 0.15 * Math.sin(TAU * f * 3.98 * tt) * Math.exp(-tt / 0.15)) * Math.exp(-tt / 0.6) * Math.min(1, tt / 0.004);
    }
    d[i] = y;
  }
  return finish(d, 0.6, sr, 0.001, 0.05);
};

const stomp: Gen = (sr, r) => {
  const d = N(sr, 0.35);
  const lp = lp1(sr, 400);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    // thousands of feet: smeared onset
    d[i] = lp(r() * 2 - 1) * Math.min(1, t / 0.02) * Math.exp(-t / 0.08) * 3 + mode(t, 55, 0.1) * Math.min(1, t / 0.015);
  }
  return finish(d, 0.9, sr, 0.002, 0.02);
};

// A section of the crowd clapping together: many claps smeared over ~40 ms.
const clapCrowd: Gen = (sr, r) => {
  const d = N(sr, 0.3);
  for (let c = 0; c < 60; c++) {
    const s0 = Math.floor((r() * r()) * 0.045 * sr);
    const f = 900 + r() * 2200;
    const bp = svf(sr).set(f, 1.5 + r());
    const a = 0.3 + r() * 0.7;
    for (let i = 0; i < sr * 0.04 && s0 + i < d.length; i++) d[s0 + i] += bp.run(r() * 2 - 1) * Math.exp(-i / (sr * 0.008)) * a;
  }
  return finish(d, 0.8, sr, 0.001, 0.02);
};

// "On fire" whoosh: rising filtered roar.
const fire: Gen = (sr, r) => {
  const d = N(sr, 1.2);
  const bp = svf(sr);
  const lo = lp1(sr, 250);
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    if (i % 16 === 0) bp.set(300 + 2400 * Math.min(1, t / 0.5), 0.8);
    const n = r() * 2 - 1;
    const envA = Math.min(1, t / 0.35) * Math.exp(-Math.max(0, t - 0.4) / 0.25);
    d[i] = (bp.run(n) * 1.2 + lo(n) * 2.5 * (1 + 0.5 * Math.sin(TAU * 9 * t))) * envA;
  }
  return finish(d, 0.75, sr, 0.01, 0.05);
};

export const BANK: Record<BankName, { gen: Gen; n: number; g: number; jitter: number }> = {
  dribble: { gen: dribble, n: 5, g: 0.9, jitter: 0.06 },
  floor: { gen: floor, n: 3, g: 0.8, jitter: 0.08 },
  squeak: { gen: squeak, n: 8, g: 0.38, jitter: 0.12 },
  swish: { gen: swish, n: 3, g: 0.75, jitter: 0.05 },
  net: { gen: net, n: 2, g: 0.6, jitter: 0.05 },
  rim: { gen: rim, n: 4, g: 0.85, jitter: 0.04 },
  rimRattle: { gen: rimRattle, n: 2, g: 0.7, jitter: 0.04 },
  backboard: { gen: backboard, n: 3, g: 0.85, jitter: 0.05 },
  dunk: { gen: dunk, n: 2, g: 1.0, jitter: 0.04 },
  catch: { gen: catchS, n: 3, g: 0.5, jitter: 0.08 },
  pass: { gen: pass, n: 2, g: 0.3, jitter: 0.1 },
  block: { gen: slap, n: 2, g: 0.95, jitter: 0.05 },
  steal: { gen: steal, n: 2, g: 0.75, jitter: 0.06 },
  bump: { gen: bump, n: 3, g: 0.55, jitter: 0.08 },
  whistle: { gen: whistle, n: 3, g: 0.7, jitter: 0.015 },
  buzzer: { gen: buzzer, n: 2, g: 0.75, jitter: 0 },
  shotClock: { gen: shotClock, n: 2, g: 0.35, jitter: 0 },
  horn: { gen: horn, n: 1, g: 0.6, jitter: 0 },
  perfect: { gen: perfect, n: 1, g: 0.55, jitter: 0 },
  meterTick: { gen: meterTick, n: 1, g: 0.35, jitter: 0.03 },
  menuMove: { gen: menuMove, n: 1, g: 0.5, jitter: 0.02 },
  menuSelect: { gen: ui([880, 1318.5], 0.05, 0.07, 1.2), n: 1, g: 0.55, jitter: 0 },
  menuBack: { gen: ui([987.8, 659.3], 0.05, 0.06, 0.8), n: 1, g: 0.5, jitter: 0 },
  menuTab: { gen: menuTab, n: 1, g: 0.45, jitter: 0.02 },
  error: { gen: error, n: 1, g: 0.45, jitter: 0 },
  pa: { gen: pa, n: 1, g: 0.55, jitter: 0 },
  stomp: { gen: stomp, n: 2, g: 0.8, jitter: 0.03 },
  clapCrowd: { gen: clapCrowd, n: 3, g: 0.6, jitter: 0.03 },
  slap: { gen: slap, n: 2, g: 0.7, jitter: 0.06 },
  fire: { gen: fire, n: 1, g: 0.6, jitter: 0 },
  grunt: { gen: grunt, n: 3, g: 0.35, jitter: 0.06 },
};

// Most used first, so early gameplay already has its sounds.
export const BANK_ORDER: BankName[] = [
  "menuMove", "menuSelect", "menuBack", "menuTab", "error", "dribble", "squeak", "swish", "rim", "whistle", "catch",
  "backboard", "net", "buzzer", "dunk", "block", "steal", "pass", "floor", "bump", "shotClock", "horn", "perfect",
  "meterTick", "rimRattle", "pa", "stomp", "clapCrowd", "slap", "fire", "grunt",
];

export function bake(sr: number, name: BankName, k: number): Float32Array {
  const def = BANK[name];
  return def.gen(sr, rng(name.length * 1013 + k * 7919 + name.charCodeAt(0)), k);
}
