import { filter, midiHz, rand, TAU, type Rng } from "./dsp";

// One bright, full-velocity note; playback adds a velocity lowpass and the damper release.
export function renderPiano(midi: number, sr: number, r: Rng): Float32Array {
  const f0 = midiHz(midi);
  const reg = Math.pow(261.6 / f0, 0.5);
  const dur = Math.min(6.5, Math.max(2.4, 2.5 + 3.5 * reg));
  const n = Math.ceil(dur * sr);
  const out = new Float32Array(n);
  const B = 0.00018 * Math.pow(2, (midi - 21) / 18);
  const strike = 1 / rand(r, 7.2, 8.3);
  const strings = midi >= 40 ? 2 : 1;
  const maxK = Math.min(midi < 48 ? 22 : 14, Math.floor((sr * 0.42) / f0));
  for (let k = 1; k <= maxK; k++) {
    const fk = f0 * k * Math.sqrt(1 + B * k * k);
    if (fk > sr * 0.45) break;
    const comb = 0.25 + 0.75 * Math.abs(Math.sin(Math.PI * k * strike));
    const amp = Math.pow(k, -0.95) * comb * Math.exp(-fk / 7000);
    if (amp < 0.002) continue;
    const t1 = Math.min(4, (0.7 * reg) / (1 + fk / 1800));
    const t2 = Math.min(6, (3.2 * reg) / (1 + fk / 2600));
    for (let s = 0; s < strings; s++) {
      const cents = strings === 1 ? 0 : (s - (strings - 1) / 2) * rand(r, 0.6, 1.4);
      const f = fk * Math.pow(2, cents / 1200);
      const w = (TAU * f) / sr;
      const c = 2 * Math.cos(w);
      const ph = r() * TAU;
      let y1 = Math.sin(ph - w);
      let y2 = Math.sin(ph - 2 * w);
      let e1 = (0.72 * amp) / strings;
      let e2 = (0.28 * amp) / strings;
      const k1 = Math.exp(-1 / (Math.max(0.03, t1) * sr));
      const k2 = Math.exp(-1 / (Math.max(0.1, t2) * sr));
      for (let i = 0; i < n; i++) {
        const y = c * y1 - y2;
        y2 = y1;
        y1 = y;
        out[i] += y * (e1 + e2);
        e1 *= k1;
        e2 *= k2;
        if ((i & 255) === 0 && e1 + e2 < 3e-5) break;
      }
    }
  }
  const thumpN = Math.floor(0.04 * sr);
  const thump = new Float32Array(thumpN);
  for (let i = 0; i < thumpN; i++) thump[i] = (r() * 2 - 1) * Math.exp(-i / (0.008 * sr));
  filter(thump, "lowpass", Math.min(2500, f0 * 4 + 600), 0.7, sr);
  for (let i = 0; i < thumpN; i++) out[i] += thump[i] * 0.05 + Math.sin((TAU * 95 * i) / sr) * 0.03 * Math.exp(-i / (0.03 * sr));
  const attack = Math.floor((midi < 48 ? 0.004 : 0.0025) * sr);
  for (let i = 0; i < attack; i++) out[i] *= Math.sin((Math.PI / 2) * (i / attack));
  const rel = Math.floor(0.4 * sr);
  for (let i = 0; i < rel; i++) out[n - 1 - i] *= i / rel;
  let p = 0;
  for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(out[i]));
  const g = p > 0 ? (0.8 / p) * (midi < 45 ? 0.8 : midi > 84 ? 0.85 : 1) : 0;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

// Stereo hall impulse: sparse early reflections, then diffuse noise whose highs die faster than its lows.
export function renderImpulse(sr: number, seconds: number, r: Rng): [Float32Array, Float32Array] {
  const n = Math.ceil(seconds * sr);
  const pre = Math.floor(0.018 * sr);
  const chans: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  const bands: [number, number, number][] = [[700, 0.55, seconds * 0.95], [2500, 0.3, seconds * 0.6], [7000, 0.15, seconds * 0.3]];
  for (const ch of chans) {
    for (let k = 0; k < 14; k++) {
      const at = pre + Math.floor(rand(r, 0.003, 0.08) * sr);
      if (at < n) ch[at] += (r() < 0.5 ? -1 : 1) * rand(r, 0.15, 0.45) * (1 - k / 16);
    }
    let lo = 0;
    for (const [fc, amp, t60] of bands) {
      const band = new Float32Array(n);
      for (let i = pre; i < n; i++) band[i] = r() * 2 - 1;
      filter(band, "lowpass", fc, 0.6, sr);
      if (lo) filter(band, "highpass", lo, 0.6, sr);
      lo = fc;
      const tau = t60 / 6.9;
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / sr;
        ch[i] += band[i] * amp * Math.exp(-t / tau) * Math.min(1, t / 0.04);
      }
    }
  }
  let p = 0;
  for (const ch of chans) for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(ch[i]));
  for (const ch of chans) for (let i = 0; i < n; i++) ch[i] /= p * 6;
  return chans;
}
