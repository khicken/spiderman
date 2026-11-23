#!/usr/bin/env node
// HOLLOWMERE sound pack builder. Downloads the source recordings, checks each clip's license on its own Freesound page
// (only "Creative Commons 0" is accepted), cuts and normalizes the takes, encodes MP3 and writes
// public/sfx/manifest.json and public/sfx/CREDITS.md.
//
//   node scripts/audio/fetch-sfx.mjs            build everything (cached downloads in scripts/audio/.sfx-cache)
//   node scripts/audio/fetch-sfx.mjs --only step-grass,bed-night
//   node scripts/audio/fetch-sfx.mjs --report   print a per-source analysis without writing files
//
// Needs ffmpeg on PATH. Freesound serves its 128 kbps preview MP3s without a login; we use those (CC0 clips need no
// attribution, and the previews are plenty for game foley). anything not CC0 is refused here.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ungatedLufs, truePeakDb, integratedLufs } from "./level-check.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const OUT = path.join(ROOT, "public", "sfx");
const CACHE = path.join(HERE, ".sfx-cache");
const SR = 44100;
const UA = "Mozilla/5.0 (compatible; hollowmere-asset-check)";

// ---------------------------------------------------------------------------------------------------------------------
// Recipes. `src` is a Freesound sound id. Every take of one id comes from one recording (one mic, one room).
//   steps/hits: cut isolated transients from a long recording, keep the n cleanest.
//   whole:      one trimmed clip per entry in `parts`.
//   bed:        a seamless stereo loop (equal-power crossfade of the end into the start), loudest-calm window picked.
// Options: hp / lp (Hz), rate (resample ratio, <1 = lower and slower), len (max take seconds), gap (min seconds between
// takes), n, peak (group peak, linear), kbps, sr.
// ---------------------------------------------------------------------------------------------------------------------
const GROUPS = [
  // footsteps: one recording per surface
  { id: "step-grass", kind: "steps", src: 575320, n: 8, len: 0.34, hp: 60 },
  { id: "step-dirt", kind: "steps", src: 352870, n: 8, len: 0.32, hp: 60 },
  { id: "step-rock", kind: "steps", src: 556002, n: 8, len: 0.3, hp: 70 },
  { id: "step-stone", kind: "steps", src: 792077, n: 8, len: 0.34, hp: 70 },
  { id: "step-sand", kind: "steps", src: 383490, n: 8, len: 0.36, hp: 60 },
  { id: "step-wood", kind: "steps", src: 543685, n: 8, len: 0.34, hp: 70 },
  { id: "step-water", kind: "steps", src: 627004, n: 6, len: 0.5, hp: 70, gap: 0.3 },
  { id: "step-ash", kind: "steps", src: 613849, n: 8, len: 0.36, hp: 60, lp: 5500, rate: 0.93 },
  // player
  { id: "cloth", kind: "hits", src: 435290, n: 8, len: 0.5, gap: 0.4, hp: 80, lp: 7000 },
  { id: "whoosh-soft", kind: "hits", src: 733891, n: 3, len: 0.6, gap: 0.3, hp: 120, lp: 4200 },
  { id: "swing", kind: "hits", src: 737541, n: 8, len: 0.55, gap: 0.5, hp: 100, lp: 9000 },
  { id: "hit-flesh", kind: "hits", src: 586841, n: 7, len: 0.5, gap: 0.5, hp: 50 },
  { id: "clash", kind: "hits", src: 737537, n: 8, len: 0.9, gap: 0.6, hp: 150 },
  { id: "creak", kind: "hits", src: 822745, n: 5, len: 1.0, gap: 0.7, hp: 90, lp: 6500 },
  { id: "bow-release", kind: "whole", parts: [{ src: 394180, start: 0, dur: 0.6 }, { src: 394179, start: 0, dur: 0.7 }], hp: 120 },
  { id: "arrow-hit", kind: "hits", src: 521242, n: 4, len: 0.45, gap: 0.5, hp: 80 },
  { id: "splash", kind: "hits", src: 320330, n: 5, min: 2, len: 1.0, gap: 0.8, hp: 70 },
  { id: "splash-big", kind: "whole", parts: [{ src: 442773, start: 0, dur: 2.2 }], hp: 50 },
  { id: "swim", kind: "hits", src: 438845, n: 6, len: 0.9, gap: 0.7, hp: 90, lp: 8000 },
  // world
  { id: "rock-hit", kind: "hits", src: 567701, n: 8, len: 0.5, gap: 0.4, hp: 50 },
  { id: "stone-drag", kind: "hits", src: 316688, n: 4, len: 1.4, gap: 1.0, hp: 50, lp: 9000 },
  { id: "stone-door", kind: "whole", parts: [{ src: 578491, start: 0, dur: 8 }], hp: 35 },
  { id: "twig", kind: "hits", src: 552006, n: 6, len: 0.4, gap: 0.5, hp: 150 },
  { id: "growl", kind: "hits", src: 735438, n: 6, len: 1.4, gap: 1.0, hp: 70 },
  { id: "roar", kind: "whole", parts: [{ src: 469123, start: 0, dur: 6 }], hp: 40 },
  { id: "fire-whoosh", kind: "hits", src: 483316, n: 5, len: 1.4, gap: 1.2, hp: 100 },
  { id: "bird", kind: "hits", src: 182503, n: 6, len: 1.0, gap: 0.8, hp: 900 },
  {
    id: "thunder", kind: "whole", hp: 30,
    parts: [{ src: 476738, start: 0, dur: 12 }, { src: 683420, start: 0, dur: 6.4 }, { src: 243782, start: 0, dur: 11 }, { src: 38250, start: 0, dur: 10 }],
  },
  // ambience beds (stereo, seamless)
  { id: "bed-forest", kind: "bed", src: 856018, dur: 30, hp: 40 },
  { id: "bed-birds", kind: "bed", src: 850507, dur: 30, hp: 40 },
  { id: "bed-night", kind: "bed", src: 746366, dur: 30, hp: 40 },
  { id: "bed-frogs", kind: "bed", src: 32655, dur: 30, hp: 40 },
  { id: "bed-wind", kind: "bed", src: 104282, dur: 30, hp: 30 },
  { id: "bed-wind-high", kind: "bed", src: 104282, dur: 24, hp: 900 },
  { id: "bed-rain", kind: "bed", src: 523391, dur: 30, hp: 40 },
  { id: "bed-rain-heavy", kind: "bed", src: 719062, dur: 30, hp: 40 },
  { id: "bed-river", kind: "bed", src: 420557, dur: 24, hp: 40 },
  { id: "bed-sea", kind: "bed", src: 698911, dur: 30, hp: 35 },
  { id: "bed-lake", kind: "bed", src: 637981, dur: 20, hp: 35 },
];

// ---------------------------------------------------------------------------------------------------------------------
// Freesound page check + download
// ---------------------------------------------------------------------------------------------------------------------
const meta = new Map();

async function page(id) {
  if (meta.has(id)) return meta.get(id);
  fs.mkdirSync(CACHE, { recursive: true });
  const mf = path.join(CACHE, `${id}.json`);
  let m;
  if (fs.existsSync(mf)) m = JSON.parse(fs.readFileSync(mf, "utf8"));
  else {
    const res = await fetch(`https://freesound.org/s/${id}/`, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`freesound ${id}: HTTP ${res.status}`);
    const html = await res.text();
    const lic = /title="Go to the full license text"\s+href="([^"]+)"[^>]*>\s*([^<]+?)\s*</.exec(html);
    const title = /<title>Freesound - ([\s\S]*?) by ([^<]+?)<\/title>/.exec(html);
    const mp3 = /https:\/\/cdn\.freesound\.org\/previews\/[^"]+-hq\.mp3/.exec(html);
    const dur = /data-duration="([\d.]+)"/.exec(html);
    if (!lic || !title || !mp3) throw new Error(`freesound ${id}: could not parse the page`);
    m = {
      id, url: res.url, license: lic[2], licenseUrl: lic[1], title: decode(title[1]), author: decode(title[2]),
      mp3: mp3[0], duration: dur ? +dur[1] : 0, checked: new Date().toISOString().slice(0, 10),
    };
    fs.writeFileSync(mf, JSON.stringify(m, null, 1));
  }
  // The license is re-checked on every run, cached or not.
  if (m.license !== "Creative Commons 0" || !/publicdomain\/zero\/1\.0/.test(m.licenseUrl)) {
    throw new Error(`REFUSED ${id} "${m.title}": license is "${m.license}", not Creative Commons 0`);
  }
  meta.set(id, m);
  return m;
}
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function audioOf(id, ch) {
  const m = await page(id);
  const f = path.join(CACHE, `${id}.mp3`);
  if (!fs.existsSync(f)) {
    const res = await fetch(m.mp3, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`download ${id}: HTTP ${res.status}`);
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  }
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", f, "-f", "f32le", "-ac", String(ch), "-ar", String(SR), "-"], { maxBuffer: 1 << 30 });
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const chs = Array.from({ length: ch }, () => new Float32Array(all.length / ch));
  for (let i = 0; i < chs[0].length; i++) for (let c = 0; c < ch; c++) chs[c][i] = all[i * ch + c];
  return chs;
}

function encode(chs, file, kbps, sr = SR) {
  const n = chs[0].length, ch = chs.length;
  const buf = new Float32Array(n * ch);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) buf[i * ch + c] = chs[c][i];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "f32le", "-ar", String(SR), "-ac", String(ch), "-i", "-", "-ar", String(sr), "-c:a", "libmp3lame", "-b:a", `${kbps}k`, file], {
    input: Buffer.from(buf.buffer), maxBuffer: 1 << 28,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// DSP
// ---------------------------------------------------------------------------------------------------------------------
function biquad(x, type, f, Q = 0.7071) {
  const w = (2 * Math.PI * f) / SR, c = Math.cos(w), al = Math.sin(w) / (2 * Q);
  const a0 = 1 + al;
  const lo = type === "lp";
  const b0 = ((lo ? 1 - c : 1 + c) / 2) / a0, b1 = (lo ? 1 - c : -(1 + c)) / a0, b2 = b0;
  const a1 = (-2 * c) / a0, a2 = (1 - al) / a0;
  const y = new Float32Array(x.length);
  let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], o = b0 * v + z1;
    z1 = b1 * v - a1 * o + z2;
    z2 = b2 * v - a2 * o;
    y[i] = o;
  }
  return y;
}
const filt = (x, type, f) => biquad(biquad(x, type, f, 0.7071), type, f, 0.7071); // 4th order

function resample(x, rate) {
  if (rate === 1) return x;
  const n = Math.floor((x.length - 1) / rate);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * rate, k = Math.floor(p), f = p - k;
    y[i] = x[k] * (1 - f) + x[k + 1] * f;
  }
  return y;
}

function shape(x, o) {
  let y = x;
  if (o.rate && o.rate !== 1) y = resample(y, o.rate);
  y = filt(y, "hp", o.hp ?? 30);
  if (o.lp) y = filt(y, "lp", o.lp);
  return y;
}

const dbOf = (v) => 20 * Math.log10(Math.max(v, 1e-9));
/** RMS envelope in dB, one value per `hop` samples. */
function envelope(x, hop, win) {
  const n = Math.floor(x.length / hop);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const a = i * hop, b = Math.min(x.length, a + win);
    for (let k = a; k < b; k++) s += x[k] * x[k];
    e[i] = dbOf(Math.sqrt(s / Math.max(1, b - a)));
  }
  return e;
}

/** Cut isolated transients. Returns up to n takes (Float32Array), cleanest first picked, then in time order. */
function cutTransients(x, o) {
  const hop = Math.round(0.0025 * SR), win = Math.round(0.006 * SR);
  const env = envelope(x, hop, win);
  const sorted = Array.from(env).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.2)];
  const gap = Math.round((o.gap ?? 0.3) / 0.0025);
  const back = Math.round(0.06 / 0.0025);
  const found = [];
  let last = -1e9;
  for (let i = back; i < env.length - 4; i++) {
    let base = 1e9;
    for (let k = i - back; k < i - 2; k++) base = Math.min(base, env[k]);
    if (env[i] - base > (o.rise ?? 9) && env[i] > floor + 10 && i - last > gap) {
      found.push(i);
      last = i;
    }
  }
  const takes = [];
  for (let f = 0; f < found.length; f++) {
    const i = found[f];
    const nextI = f + 1 < found.length ? found[f + 1] : env.length;
    let pk = i, pv = env[i];
    for (let k = i; k < Math.min(env.length, i + Math.round(0.12 / 0.0025)); k++) if (env[k] > pv) { pv = env[k]; pk = k; }
    let end = Math.min(nextI - 3, i + Math.round((o.len ?? 0.4) / 0.0025));
    for (let k = pk + 4; k < end; k++) if (env[k] < pv - 38) { end = k + 8; break; }
    const s0 = Math.max(0, (i - 5) * hop), s1 = Math.min(x.length, end * hop);
    if (s1 - s0 < 0.05 * SR) continue;
    let pre = 0, cnt = 0;
    for (let k = Math.max(0, i - 40); k < i - 4; k++) { pre += env[k]; cnt++; }
    const iso = pv - (cnt ? pre / cnt : floor);
    let peak = 0;
    for (let k = s0; k < s1; k++) peak = Math.max(peak, Math.abs(x[k]));
    if (peak > 0.985) continue; // clipped
    takes.push({ s0, s1, iso, pv, data: x.slice(s0, s1) });
  }
  takes.sort((a, b) => b.iso - a.iso);
  const keep = takes.slice(0, o.n).sort((a, b) => a.s0 - b.s0);
  for (const t of keep) {
    const d = t.data, fi = Math.round(0.002 * SR), fo = Math.min(Math.round(0.04 * SR), d.length >> 2);
    for (let i = 0; i < fi; i++) d[i] *= i / fi;
    for (let i = 0; i < fo; i++) d[d.length - 1 - i] *= i / fo;
  }
  return { takes: keep.map((t) => t.data), found: found.length, usable: takes.length };
}

const rmsHead = (d, sec = 0.2) => {
  const n = Math.min(d.length, Math.round(sec * SR));
  let s = 0;
  for (let i = 0; i < n; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, n));
};

/** Same loudness for every take of a group, group peak at `peak`. */
function normalizeGroup(takes, peak = 0.7) {
  const r = takes.map((t) => rmsHead(t));
  const med = [...r].sort((a, b) => a - b)[r.length >> 1];
  const gains = r.map((v) => Math.min(4, Math.max(0.25, med / Math.max(v, 1e-6))));
  let mx = 0;
  takes.forEach((t, i) => { for (let k = 0; k < t.length; k++) mx = Math.max(mx, Math.abs(t[k]) * gains[i]); });
  const g = peak / Math.max(mx, 1e-6);
  takes.forEach((t, i) => { for (let k = 0; k < t.length; k++) t[k] *= gains[i] * g; });
}

/** Spectral hum check: tonal lines that persist (engines, mains hum, aircraft). Returns count of persistent lines 80-1500 Hz. */
function humLines(x) {
  const N = 4096, bins = N / 2, frames = 12;
  const hits = new Int32Array(bins);
  const step = Math.max(N, Math.floor((x.length - N) / frames));
  let used = 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let st = 0; st + N <= x.length && used < frames; st += step) {
    for (let i = 0; i < N; i++) { re[i] = x[st + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); im[i] = 0; }
    fft(re, im);
    const mag = new Float64Array(bins);
    for (let k = 0; k < bins; k++) mag[k] = Math.hypot(re[k], im[k]);
    const lo = Math.floor((80 * N) / SR), hi = Math.floor((1500 * N) / SR);
    for (let k = lo + 8; k < hi - 8; k++) {
      let m = 0;
      for (let j = -8; j <= 8; j++) if (Math.abs(j) > 1) m += mag[k + j];
      m /= 14;
      if (mag[k] > m * 6 && mag[k] >= mag[k - 1] && mag[k] >= mag[k + 1]) hits[k]++;
    }
    used++;
  }
  let lines = 0;
  for (let k = 0; k < bins; k++) if (hits[k] >= Math.max(3, used * 0.85)) lines++;
  return lines;
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** Calmest window of `dur` seconds: low level spread (no loud passers-by), no tonal hum. */
function bestWindow(chs, dur) {
  const n = chs[0].length, W = Math.round(dur * SR);
  if (n <= W) return { start: 0, score: 0, hum: humLines(chs[0]) };
  const sec = Math.floor(SR);
  const lv = [];
  for (let s = 0; s + sec <= n; s += sec) {
    let a = 0;
    for (let i = s; i < s + sec; i++) a += chs[0][i] * chs[0][i];
    lv.push(dbOf(Math.sqrt(a / sec)));
  }
  let best = { start: 0, score: 1e9, hum: 0 };
  const stepS = Math.max(1, Math.floor(dur / 6));
  for (let s0 = 0; s0 + dur <= lv.length; s0 += stepS) {
    const seg = lv.slice(s0, s0 + Math.floor(dur));
    const mean = seg.reduce((a, b) => a + b, 0) / seg.length;
    const spread = Math.max(...seg) - mean;
    const hum = humLines(chs[0].subarray(s0 * SR, s0 * SR + W));
    const score = spread + hum * 3;
    if (score < best.score) best = { start: s0 * SR, score, hum };
  }
  return best;
}

/** Seamless loop: take dur+fade seconds, blend the extra tail into the start with an equal-power crossfade. */
function makeLoop(chs, startSample, dur, fade) {
  const L = Math.round(dur * SR), F = Math.round(fade * SR);
  return chs.map((c) => {
    const seg = c.subarray(startSample, startSample + L + F);
    const out = new Float32Array(L);
    out.set(seg.subarray(0, L));
    for (let i = 0; i < F; i++) {
      const t = i / F;
      out[i] = seg[i] * Math.sin((t * Math.PI) / 2) + seg[L + i] * Math.cos((t * Math.PI) / 2);
    }
    return out;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------------------------------
async function build(g, report) {
  const files = [];
  const used = new Set();
  const notes = [];
  const say = (s) => notes.push(s);
  const write = (chs, name, kbps, sr) => {
    if (!report) encode(chs, path.join(OUT, name), kbps, sr);
    files.push(name);
  };
  if (g.kind === "steps" || g.kind === "hits") {
    const [x0] = await audioOf(g.src, 1);
    used.add(g.src);
    const x = shape(x0, g);
    const r = cutTransients(x, g);
    say(`${r.found} onsets, ${r.usable} usable, kept ${r.takes.length}`);
    if (r.takes.length < Math.min(g.min ?? 3, g.n)) throw new Error(`${g.id}: only ${r.takes.length} takes from ${g.src}; pick another source`);
    normalizeGroup(r.takes, g.peak ?? 0.7);
    r.takes.forEach((t, i) => write([t], `${g.id}-${i + 1}.mp3`, g.kbps ?? 64));
  } else if (g.kind === "whole") {
    const takes = [];
    for (const p of g.parts) {
      const [x0] = await audioOf(p.src, 1);
      used.add(p.src);
      let x = shape(x0, g).slice(Math.round(p.start * SR), Math.round((p.start + p.dur) * SR));
      const fo = Math.min(Math.round(0.25 * SR), x.length >> 2);
      for (let i = 0; i < fo; i++) x[x.length - 1 - i] *= i / fo;
      takes.push(x);
    }
    normalizeGroup(takes, g.peak ?? 0.7);
    takes.forEach((t, i) => write([t], `${g.id}-${i + 1}.mp3`, g.kbps ?? 80));
  } else if (g.kind === "bed") {
    const chs = await audioOf(g.src, 2);
    used.add(g.src);
    const px = chs.map((c) => shape(c, g));
    const fade = 2.5;
    const w = bestWindow(px, g.dur + fade);
    say(`window @${(w.start / SR).toFixed(0)}s score ${w.score.toFixed(1)} humLines ${w.hum}${w.hum > 2 ? "  <-- TONAL HUM, check by ear" : ""}`);
    const loop = makeLoop(px, w.start, g.dur, fade);
    const lu = ungatedLufs(loop, SR);
    const gain = Math.pow(10, (-23 - lu) / 20); // beds ship at -23 LUFS; the engine sets the final level
    for (const c of loop) for (let i = 0; i < c.length; i++) c[i] *= gain;
    write(loop, `${g.id}-1.mp3`, g.kbps ?? 72);
  }
  return { files, used: [...used], notes };
}

async function main() {
  const args = parseArgs();
  const only = args.only ? new Set(args.only.split(",")) : null;
  const groups = GROUPS.filter((g) => !only || only.has(g.id));
  const manifest = { version: 1, boot: ["step-grass", "swing", "hit-flesh", "cloth"], clips: {}, loops: {} };
  const credits = new Map();
  let failed = 0;
  for (const g of groups) {
    try {
      const r = await build(g, args.report);
      console.log(`${g.id.padEnd(16)} ${r.files.length} file(s)  ${r.notes.join("; ")}`);
      if (g.kind === "bed") manifest.loops[g.id] = true;
      manifest.clips[g.id] = { files: r.files };
      for (const id of r.used) {
        const m = await page(id);
        if (!credits.has(id)) credits.set(id, { m, ids: new Set() });
        credits.get(id).ids.add(g.id);
      }
    } catch (e) {
      failed++;
      console.error(`FAIL ${g.id}: ${e.message}`);
    }
  }
  if (args.report || only) {
    console.log(failed ? `${failed} failed` : "done");
    process.exit(failed ? 1 : 0);
  }
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
  const lines = [
    "# HOLLOWMERE sound credits",
    "",
    "Every recorded sound here is a **Creative Commons 0 (public domain)** clip from freesound.org. Each clip's own page was",
    "fetched by `scripts/audio/fetch-sfx.mjs` and its license line read as \"Creative Commons 0\" before the clip was",
    "used; the script refuses to build with any other license. No commercial sample-library audio, no game or film audio, no CC BY, no CC BY-NC.",
    "No attribution is required, but the authors are listed anyway. Clips are the site's 128 kbps preview MP3s, cut,",
    "filtered, level-matched and re-encoded (edited). No on-screen credit is required.",
    "",
    "Still synthesized on purpose: menu / UI cues (D Lydian pentatonic) and magic cues (Thread, glimmer, heart, wisp,",
    "Tallow's chirp). Voice lines are generated once with Chatterbox-Turbo (`scripts/voice/`), see `public/voice/`.",
    "",
    "| Source clip | Author | License | Verified | Used as |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const { m, ids } of [...credits.values()].sort((a, b) => a.m.id - b.m.id)) {
    lines.push(`| [${m.title.replace(/\|/g, "/")}](https://freesound.org/s/${m.id}/) | ${m.author} | CC0 1.0 | ${m.checked} | ${[...ids].join(", ")} |`);
  }
  fs.writeFileSync(path.join(OUT, "CREDITS.md"), lines.join("\n") + "\n");
  let total = 0;
  for (const f of fs.readdirSync(OUT)) if (f.endsWith(".mp3")) total += fs.statSync(path.join(OUT, f)).size;
  console.log(`\n${Object.keys(manifest.clips).length} sounds, ${(total / 1048576).toFixed(2)} MB of mp3, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
function parseArgs() {
  const a = process.argv.slice(2), o = { report: false, only: "" };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--report") o.report = true;
    else if (a[i] === "--only") o.only = a[++i] ?? "";
  }
  return o;
}
main();
