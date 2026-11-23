// BS.1770-4 loudness (integrated LUFS with gating, short-term max) and 4x true peak, in plain JS. No dependencies.
// Shared by level-check.mjs and fetch-sfx.mjs. Input: array of Float32Array channels at sample rate sr.

function biquad(b0, b1, b2, a1, a2) {
  return { b0, b1, b2, a1, a2 };
}

/** K-weighting for any sample rate (high shelf + RLB high-pass), after ITU-R BS.1770-4. */
function kFilters(sr) {
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = biquad((Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773;
  K = Math.tan((Math.PI * f1) / sr);
  a0 = 1 + K / Q1 + K * K;
  const hp = biquad(1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q1 + K * K) / a0);
  return [shelf, hp];
}

function run(x, f) {
  const y = new Float32Array(x.length);
  let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const o = f.b0 * v + z1;
    z1 = f.b1 * v - f.a1 * o + z2;
    z2 = f.b2 * v - f.a2 * o;
    y[i] = o;
  }
  return y;
}

function blockPowers(chs, sr, win, hop) {
  const [s, h] = kFilters(sr);
  const w = chs.map((c) => run(run(c, s), h));
  const n = w[0].length;
  const W = Math.round(win * sr), H = Math.round(hop * sr);
  const pre = w.map((c) => {
    const cs = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + c[i] * c[i];
    return cs;
  });
  const out = [];
  for (let st = 0; st + W <= n; st += H) {
    let p = 0;
    for (let c = 0; c < pre.length; c++) p += (pre[c][st + W] - pre[c][st]) / W; // L,R weight 1; mono counts once
    out.push(p);
  }
  return out;
}
const lufs = (p) => (p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity);

/** Integrated loudness with absolute (-70) and relative (-10 LU) gates. Returns -Infinity for silence. */
export function integratedLufs(chs, sr) {
  const bp = blockPowers(chs, sr, 0.4, 0.1);
  const abs = bp.filter((p) => lufs(p) > -70);
  if (!abs.length) return -Infinity;
  const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = abs.filter((p) => lufs(p) > lufs(mean) - 10);
  if (!rel.length) return -Infinity;
  return lufs(rel.reduce((a, b) => a + b, 0) / rel.length);
}

/** Loudest 3 s window (short-term max). */
export function shortTermMax(chs, sr) {
  const bp = blockPowers(chs, sr, 3, 0.5);
  return bp.length ? lufs(Math.max(...bp)) : integratedLufs(chs, sr);
}

/** Mean power over the whole signal in LUFS, no gating (for stems with long silences). */
export function ungatedLufs(chs, sr) {
  const bp = blockPowers(chs, sr, 0.4, 0.1);
  if (!bp.length) return -Infinity;
  return lufs(bp.reduce((a, b) => a + b, 0) / bp.length);
}

const TP_TAPS = (() => {
  // 4x polyphase windowed-sinc, 12 taps per phase
  const L = 4, N = 12, h = [];
  for (let ph = 0; ph < L; ph++) {
    const row = [];
    for (let k = -N / 2 + 1; k <= N / 2; k++) {
      const t = k - ph / L;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const win = 0.5 * (1 + Math.cos((Math.PI * t) / (N / 2 + 0.5)));
      row.push(sinc * win);
    }
    h.push(row);
  }
  return h;
})();

/** True peak in dBFS (4x oversampled). */
export function truePeakDb(chs) {
  let pk = 0;
  const N = 12;
  for (const x of chs) {
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a > pk) pk = a;
      if (a < 0.2) continue; // only near-peaks can matter
      for (let ph = 1; ph < 4; ph++) {
        let s = 0;
        const row = TP_TAPS[ph];
        for (let k = 0; k < N; k++) {
          const j = i + k - N / 2 + 1;
          if (j >= 0 && j < x.length) s += x[j] * row[k];
        }
        if (Math.abs(s) > pk) pk = Math.abs(s);
      }
    }
  }
  return pk > 0 ? 20 * Math.log10(pk) : -Infinity;
}

export const sampleDb = (chs) => {
  let pk = 0;
  for (const x of chs) for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
  return pk > 0 ? 20 * Math.log10(pk) : -Infinity;
};

// ---------------------------------------------------------------------------------------------------------------------
// Offline level check. Renders the engine's mix states in an OfflineAudioContext (node-web-audio-api), measures
// integrated LUFS (BS.1770-4, gated) and 4x true peak, and compares them with MIX in src/app/contracts.ts.
//   node scripts/audio/level-check.mjs [--only id,id] [--out dir] [--no-music]
//   node scripts/audio/level-check.mjs --wav file.wav --target -24 [--tol 2]     (any WAV, used by the music track)
// States are solo renders: only the named bus stays connected to the master chain (reverb send, ducks, compressor and
// limiter included), so each number is "this layer through the master bus". Integrated loudness gates out silence, so
// sparse cues (swing, hit) are measured on the blocks that contain the cue, spaced as in play.
// Needs node-web-audio-api (a devDependency, or installed in scripts/audio/.render-deps).
// ---------------------------------------------------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SRC = path.join(ROOT, "src", "app");
const PUBLIC = path.join(ROOT, "public");
const SR = 48000;
const Q = 128 * 47; // control tick in frames (about 125 ms, a whole number of render quanta)

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "RIFF") throw new Error("not a WAV file: " + file);
  let p = 12, fmt = null, data = null;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4), n = b.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = { tag: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === "data") data = b.subarray(p + 8, p + 8 + n);
    p += 8 + n + (n & 1);
  }
  if (!fmt || !data) throw new Error("bad WAV: " + file);
  const bytes = fmt.bits / 8, frames = Math.floor(data.length / (bytes * fmt.ch));
  const chs = Array.from({ length: fmt.ch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.ch; c++) {
      const o = (i * fmt.ch + c) * bytes;
      chs[c][i] = fmt.tag === 3 ? data.readFloatLE(o) : fmt.bits === 16 ? data.readInt16LE(o) / 32768 : fmt.bits === 24 ? data.readIntLE(o, 3) / 8388608 : data.readInt32LE(o) / 2147483648;
    }
  }
  return { chs, sr: fmt.sr };
}

function writeWav(file, chs, sr) {
  const n = chs[0].length, ch = chs.length, buf = Buffer.alloc(44 + n * ch * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * ch * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(ch, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * ch * 2, 28); buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36);
  buf.writeUInt32LE(n * ch * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(chs[c][i] * 32767))), 44 + (i * ch + c) * 2);
  fs.writeFileSync(file, buf);
}

/** Transpile the audio modules (TypeScript to CommonJS) into scripts/audio/.render-build and load audio.ts. */
export function loadEngine() {
  const req = createRequire(path.join(ROOT, "package.json"));
  const ts = req("typescript");
  const out = path.join(HERE, ".render-build");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "package.json"), '{"type":"commonjs"}');
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const src = fs.readFileSync(path.join(SRC, name + ".ts"), "utf8");
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
    fs.writeFileSync(path.join(out, name + ".js"), js.outputText);
    for (const m of src.matchAll(/from "\.\/([\w-]+)"/g)) visit(m[1]);
  };
  visit("audio");
  const r = createRequire(path.join(out, "x.js"));
  return { audio: r("./audio.js"), samples: r("./audio-samples.js"), contracts: r("./contracts.js"), music: r("./audio-music.js") };
}

function loadWebAudio() {
  try { return createRequire(import.meta.url)("node-web-audio-api"); } catch { /* fall through */ }
  try { return createRequire(path.join(ROOT, "package.json"))("node-web-audio-api"); } catch { /* fall through */ }
  return createRequire(path.join(HERE, ".render-deps", "package.json"))("node-web-audio-api");
}

/** Serve /zelda/... from public/ so the engine's own fetch() works offline. */
function shimFetch() {
  const real = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const s = String(u);
    if (!s.startsWith("/zelda/")) return real(u, init);
    const f = path.join(PUBLIC, s.slice(7));
    if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const b = fs.readFileSync(f);
    return {
      ok: true, status: 200,
      json: async () => JSON.parse(b.toString("utf8")),
      arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    };
  };
}

const V = (x, y, z) => ({ x, y, z });
const NEAR = V(3, 0, 2);
const SURFACES = ["grass", "dirt", "stone", "rock", "sand", "wood"];
const UI_CUES = ["move", "ok", "move", "back", "open", "close", "move", "error"];
const VOICE_IDS = ["oriel-1", "oriel-2", "oriel-3", "tallow-wake", "tallow-gate", "tallow-vista", "tallow-ride", "tallow-gladeLit", "tallow-mem0", "tallow-mem1", "tallow-mem2", "tallow-mem3"];

const every = (h, from, to, step, fn) => { let i = 0; for (let t = from; t < to; t += step) h.at(t, (a) => fn(a, i++, t)); };

/** MIX targets read from contracts.ts at run time. */
function stateTable(MIX, voiceSeconds) {
  const FULL = MIX.full;
  const enemies = (n, kind, brain, phase = 1) => Array.from({ length: n }, (_, i) => ({ alive: true, kind, brain, phase, pos: V(4 + i * 2, 0, 3 - i) }));
  return [
    { id: "ambience-day", dur: 34, skip: 6, solo: ["amb"], target: MIX.ambienceDay, env: { daylight: 1, rain: 0, wind: 2.5 }, area: "village" },
    { id: "ambience-night", dur: 34, skip: 6, solo: ["amb"], target: MIX.ambienceNight, env: { daylight: 0, rain: 0, wind: 1.5 }, area: "whisperwood" },
    { id: "footsteps", dur: 14, skip: 1, solo: ["sfx"], target: MIX.footsteps, setup: (h) => every(h, 1, 14, 0.34, (a, i) => a.handle([{ type: "footstep", pos: NEAR, surface: SURFACES[Math.floor(i / 6) % SURFACES.length], run: true }])) },
    { id: "swing", dur: 14, skip: 1, solo: ["sfx"], target: MIX.swing, setup: (h) => every(h, 1, 14, 0.9, (a, i) => a.handle([{ type: "swing", pos: NEAR, combo: (i % 3) + 1 }])) },
    { id: "hit", dur: 14, skip: 1, solo: ["sfx"], target: MIX.hit, setup: (h) => every(h, 1, 14, 0.8, (a, i) => a.handle([{ type: "hit", team: "player", target: 1, source: -1, damage: 2, pos: NEAR, dir: V(1, 0, 0), kind: "sword", blocked: false, parried: false, knockback: 1 }])) },
    { id: "ui", dur: 12, skip: 0.5, solo: ["ui"], target: MIX.ui, setup: (h) => every(h, 0.5, 12, 0.5, (a, i) => a.ui(UI_CUES[i % UI_CUES.length])) },
    {
      id: "voice", dur: 34, skip: 0.5, solo: ["voice"], target: MIX.voice, voice: true,
      setup: (h) => { let t = 0.5; VOICE_IDS.forEach((id) => { const who = id.startsWith("oriel") ? "oriel" : "tallow"; h.at(t, (a) => a.handle([{ type: "say", who, line: id, text: id, voice: id, seconds: voiceSeconds[id] ?? 2 }])); t += (voiceSeconds[id] ?? 2) + 0.4; }); h.dur = Math.max(h.dur, t + 1); },
    },
    {
      id: "mix-explore", dur: 48, skip: 6, solo: null, target: FULL, music: true, env: { daylight: 1, rain: 0, wind: 2.5 }, area: "village",
      setup: (h) => {
        every(h, 3, 48, 0.36, (a, i) => a.handle([{ type: "footstep", pos: NEAR, surface: SURFACES[Math.floor(i / 12) % SURFACES.length], run: true }]));
        every(h, 9, 48, 11, (a, i) => a.handle([{ type: "pickup", kind: "glimmer", amount: 1, pos: NEAR, id: "g" + i }]));
        every(h, 8, 48, 2.6, (a, i) => a.handle([{ type: "swing", pos: NEAR, combo: 1 }]));
        every(h, 8.3, 48, 2.6, (a) => a.handle([{ type: "hit", team: "player", target: 1, source: -1, damage: 1, pos: NEAR, dir: V(1, 0, 0), kind: "sword", blocked: false, parried: false, knockback: 1 }]));
        every(h, 4, 48, 5, (a, i) => { const id = VOICE_IDS[3 + (i % 9)]; a.handle([{ type: "say", who: "tallow", line: id, text: id, voice: id, seconds: voiceSeconds[id] ?? 2 }]); });
      },
    },
    {
      id: "mix-combat", dur: 40, skip: 5, solo: null, target: FULL, music: true, env: { daylight: 1, rain: 0, wind: 2.5 }, area: "whisperwood",
      enemies: enemies(3, "brambling", "chase"),
      setup: (h) => {
        every(h, 1, 40, 0.9, (a, i) => a.handle([{ type: "swing", pos: NEAR, combo: (i % 3) + 1 }]));
        every(h, 1.3, 40, 0.9, (a, i) => a.handle([{ type: "hit", team: "player", target: 1, source: -1, damage: 2, pos: NEAR, dir: V(1, 0, 0), kind: "sword", blocked: false, parried: false, knockback: 1 }]));
        every(h, 2, 40, 4.5, (a, i) => a.handle([{ type: "enemyAlert", id: 1, kind: "brambling", pos: V(5, 0, 3) }, { type: "tell", id: 1, kind: "brambling", pos: V(5, 0, 3), lead: 0.15 }]));
        every(h, 5, 40, 7, (a) => a.handle([{ type: "hurt", amount: 2, hp: 10, pos: NEAR }]));
        every(h, 2, 40, 0.38, (a, i) => a.handle([{ type: "footstep", pos: NEAR, surface: "grass", run: true }]));
      },
    },
    { id: "music-explore", dur: 40, skip: 4, solo: ["music"], target: MIX.musicExplore, music: true, tMusic: true, env: { daylight: 1, rain: 0, wind: 1 }, area: "village" },
    { id: "music-combat", dur: 36, skip: 6, solo: ["music"], target: MIX.musicCombat, music: true, tMusic: true, env: { daylight: 1, rain: 0, wind: 1 }, area: "whisperwood", enemies: enemies(3, "brambling", "chase") },
    { id: "music-boss", dur: 36, skip: 6, solo: ["music"], target: MIX.musicBoss, music: true, tMusic: true, env: { daylight: 1, rain: 0, wind: 1 }, area: "spire", enemies: enemies(1, "warden", "attack", 2) },
  ];
}

async function renderState(env, st, banks) {
  const { OfflineAudioContext } = env.wa;
  const dur0 = st.dur;
  const h = { dur: dur0, events: [], at(t, fn) { this.events.push({ t, fn, done: false }); } };
  st.setup?.(h);
  const dur = h.dur;
  const ac = new OfflineAudioContext(2, Math.ceil(dur * SR / Q) * Q, SR);
  const musicBank = st.music ? banks.music : env.samples.createSampleBank(ac);
  const audio = env.audio.createAudio(ac, { manual: true, seed: 7, bank: banks.sfx, musicBank, firstGap: 0.5, noLoad: true });
  const rig = audio.lab.rig;
  const buses = { music: rig.mix.music, sfx: rig.mix.sfx, amb: rig.mix.amb, voice: rig.mix.voice, ui: rig.mix.ui };
  if (st.solo) for (const [k, n] of Object.entries(buses)) if (!st.solo.includes(k)) n.disconnect();
  audio.setVolumes(0.8, 0.7, 0.9, 0.9);
  audio.setAmbienceVolume(1);
  const E = st.env ?? { daylight: 1, rain: 0, wind: 0 };
  const enemies = st.enemies ?? [];
  const ctx = {
    dt: Q / SR, realDt: Q / SR, time: 0,
    world: { areaAt: () => (st.area ? { id: st.area } : null), waterAt: () => -Infinity, heightAt: () => 0 },
    player: { pos: { x: 0, y: 1, z: 0 }, hp: 12, maxHp: 12, mode: "walk", action: "none", charge: 0 },
    enemies,
    env: { daylight: E.daylight, rain: E.rain, wind: { x: E.wind, y: 0 }, wet: 0 },
    camera: { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.7, 0, 1] } },
  };
  const ticks = Math.floor((dur * SR) / Q);
  for (let k = 1; k < ticks; k++) {
    const t = (k * Q) / SR;
    ac.suspend(t).then(() => {
      ctx.time = t;
      audio.update(ctx);
      audio.lab.pump(t + 0.7);
      for (const e of h.events) if (!e.done && e.t <= t + 1e-6) { e.done = true; e.fn(audio, t); }
      ac.resume();
    });
  }
  for (const e of h.events) if (e.t < Q / SR) { e.done = true; e.fn(audio, 0); }
  const buf = await ac.startRendering();
  const chs = [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()];
  const osc = rig.mix.oscStarts;
  audio.dispose();
  return { chs, osc };
}

function check(MIX, st, chs) {
  const skip = Math.floor((st.skip ?? 0) * SR);
  const part = chs.map((c) => c.subarray(skip));
  const lu = integratedLufs(part, SR);
  const tp = truePeakDb(part);
  const t = st.target;
  const dist = Array.isArray(t) ? (lu < t[0] ? t[0] - lu : lu > t[1] ? lu - t[1] : 0) : Math.abs(lu - t);
  const pass = Number.isFinite(lu) && dist <= 2 && tp <= MIX.truePeak;
  return { lu, tp, dist, pass };
}

async function takeTest(env, banks) {
  const lines = [];
  let ok = true;
  const picker = env.samples.createTakePicker(99);
  for (let n = 2; n <= 8; n++) {
    let prev = -1, bad = 0;
    for (let i = 0; i < 1000; i++) { const k = picker.pick("t" + n, n); if (k === prev || k < 0 || k >= n) bad++; prev = k; }
    if (bad) ok = false;
    lines.push(`takes n=${n}: 1000 picks, ${bad} repeats`);
  }
  let checked = 0;
  for (const id of banks.sfx.ids()) {
    if (banks.sfx.count(id) < 2) continue;
    let prev = null, bad = 0;
    for (let i = 0; i < 1000; i++) { const b = banks.sfx.take(id); if (b === prev) bad++; prev = b; }
    if (bad) { ok = false; lines.push(`bank ${id}: ${bad} back-to-back repeats`); }
    checked++;
  }
  lines.push(`bank: ${checked} multi-take clips, 1000 picks each`);
  return { ok, lines };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const has = (k) => args.includes(k);
  if (opt("--wav")) {
    const { chs, sr } = readWav(opt("--wav"));
    const target = parseFloat(opt("--target")), tol = parseFloat(opt("--tol") ?? "2");
    const skip = Math.floor(parseFloat(opt("--skip") ?? "0") * sr);
    const part = chs.map((c) => c.subarray(skip));
    const lu = integratedLufs(part, sr), tp = truePeakDb(part);
    const pass = Math.abs(lu - target) <= tol && tp <= -1;
    console.log(`${path.basename(opt("--wav"))}: ${lu.toFixed(1)} LUFS (target ${target}, tol ${tol}), true peak ${tp.toFixed(1)} dBFS (max -1)  ${pass ? "PASS" : "FAIL"}`);
    process.exit(pass ? 0 : 1);
  }
  let sd = 0x9e3779b9;
  Math.random = () => { sd = (sd + 0x6d2b79f5) | 0; let t = Math.imul(sd ^ (sd >>> 15), 1 | sd); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  shimFetch();
  const wa = loadWebAudio();
  const eng = loadEngine();
  const env = { wa, ...eng };
  const MIX = eng.contracts.MIX;
  const sfxCtx = new wa.OfflineAudioContext(2, Q, SR);
  const sfxBank = eng.samples.createSampleBank(sfxCtx);
  await sfxBank.load(eng.samples.SFX_MANIFEST);
  await sfxBank.load(eng.samples.VOICE_MANIFEST);
  await sfxBank.whenAll();
  const vm = JSON.parse(fs.readFileSync(path.join(PUBLIC, "voice", "manifest.json"), "utf8"));
  const voiceSeconds = Object.fromEntries(Object.entries(vm.clips).map(([k, v]) => [k, v.seconds]));
  const banks = { sfx: sfxBank, music: null };
  const only = opt("--only")?.split(",");
  let table = stateTable(MIX, voiceSeconds);
  if (only) table = table.filter((s) => only.includes(s.id));
  if (has("--no-music")) table = table.filter((s) => !s.music);
  if (table.some((s) => s.music)) {
    const mc = new wa.OfflineAudioContext(2, Q, SR);
    banks.music = eng.samples.createSampleBank(mc);
    await banks.music.load(eng.music.MUSIC_MANIFEST);
    await banks.music.whenAll();
  }
  const outDir = opt("--out");
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  let fail = 0;
  const rows = [];
  for (const st of table) {
    const { chs, osc } = await renderState(env, st, banks);
    const r = check(MIX, st, chs);
    if (outDir) writeWav(path.join(outDir, st.id + ".wav"), chs, SR);
    const tgt = Array.isArray(st.target) ? `${st.target[0]}..${st.target[1]}` : String(st.target);
    const informational = st.tMusic; // the score is T11's: it is reported and counted, but flagged
    if (!r.pass) fail++;
    rows.push(`${st.id.padEnd(15)} ${r.lu.toFixed(1).padStart(6)} LUFS  target ${tgt.padStart(8)}  off ${r.dist.toFixed(1)}  TP ${r.tp.toFixed(1).padStart(5)}  osc ${JSON.stringify(osc)}  ${r.pass ? "PASS" : "FAIL"}${informational ? " (music, T11)" : ""}`);
    console.log(rows[rows.length - 1]);
  }
  const tk = await takeTest(env, banks);
  tk.lines.forEach((l) => console.log(l));
  console.log("take rotation: " + (tk.ok ? "PASS" : "FAIL"));
  if (!tk.ok) fail++;
  console.log(fail ? `${fail} check(s) failed` : "all checks passed");
  process.exitCode = fail ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((e) => { console.error(e); process.exit(2); });
