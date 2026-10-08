import type { MusicState, Sfx, Stinger } from "./contracts";
import type { Bank, HitName, InstName } from "./audio-bank";
import { INSTS } from "./audio-bank";
import { clamp, filter, gain, noiseBuffer } from "./audio-dsp";
import { GENS, LAYERS, type Layer, type Note, TEMPO, fill, layerGains } from "./audio-music";
import { SFX } from "./audio-sfx";

export type EngineInput = { music: MusicState; speed: number; gas: boolean; danger: number };
type Voice = { s: AudioBufferSourceNode; v: GainNode; when: number; end: number };
type Sn = { k: HitName | InstName; m?: number; dt: number; g: number; len?: number; pan?: number };

const REL: Partial<Record<HitName | InstName, number>> = { choirAh: 0.8, choirOh: 0.8, strLong: 0.7, brassLong: 0.35, gtrOpen: 0.25, bass: 0.08 };
const TRIM: Record<Layer, number> = { drums: 0.75, perc: 0.65, str: 2.1, brass: 1.7, choir: 2.3, gtr: 1.9, bass: 0.55, keys: 1.3, fx: 1 };
const URGENT_TO: MusicState[] = ["intro", "defeat"];
const URGENT_FROM: MusicState[] = ["title", "intro", "defeat"];

const chordSn = (k: InstName, ms: number[], dt: number, g: number, len?: number): Sn[] => ms.map((m, j) => ({ k, m, dt, g, len, pan: ms.length > 1 ? (j / (ms.length - 1) - 0.5) * 0.8 : 0 }));
const roll = (dt: number, span: number, n: number, g: number): Sn[] =>
  Array.from({ length: n }, (_, j) => ({ k: (["tomHi", "tomMid", "tomLo", "taiko"] as const)[Math.floor((j / n) * 4)], dt: dt + (span * j) / n, g: g * (0.6 + (0.4 * j) / n), pan: ((j % 3) - 1) * 0.4 }));

const STINGERS: Record<Stinger, { notes: Sn[]; duck: number; hold: number }> = {
  wave: { duck: 0.45, hold: 2, notes: [{ k: "horn", m: 38, dt: 0, g: 0.55 }, { k: "horn", m: 50, dt: 0.05, g: 0.3 }, ...roll(0.25, 0.5, 8, 0.75), { k: "taiko", dt: 0.8, g: 0.95 }, { k: "crash", dt: 0.8, g: 0.5 }, { k: "chant", m: 50, dt: 0.8, g: 0.5 }, { k: "boom", dt: 0.8, g: 0.6 }] },
  waveClear: { duck: 0.5, hold: 1.6, notes: [...chordSn("brassLong", [50, 54, 57, 62], 0, 0.24, 1.8), ...chordSn("choirAh", [50, 54, 57, 62], 0, 0.2, 2.2), { k: "crash", dt: 0, g: 0.5 }, { k: "taiko", dt: 0, g: 0.85 }, { k: "boom", dt: 0, g: 0.4 }, { k: "anvil", dt: 0, g: 0.25 }] },
  kill: { duck: 0.6, hold: 0.5, notes: [...chordSn("brassStab", [50, 57, 62, 65], 0, 0.3), ...chordSn("strStac", [38, 50], 0, 0.35), { k: "chant", m: 50, dt: 0, g: 0.55 }, { k: "kick", dt: 0, g: 0.8 }, { k: "taiko", dt: 0, g: 0.6 }, { k: "crash", dt: 0, g: 0.3 }] },
  bossIntro: { duck: 0.3, hold: 2.5, notes: [{ k: "impact", dt: 0, g: 0.9 }, { k: "horn", m: 38, dt: 0.1, g: 0.5 }, ...chordSn("choirAh", [50, 51, 57, 62, 63], 0, 0.17, 3), ...chordSn("brassLong", [38, 39], 0.1, 0.3, 2.5), { k: "boom", dt: 0, g: 0.7 }] },
  bossDown: { duck: 0.3, hold: 3, notes: [{ k: "impact", dt: 0, g: 0.9 }, ...chordSn("choirAh", [50, 54, 57, 62, 66], 0.05, 0.19, 4), ...chordSn("brassLong", [38, 50, 54, 57], 0.05, 0.27, 3.4), { k: "crash", dt: 0, g: 0.5 }, ...roll(0.6, 0.8, 10, 0.6), { k: "taiko", dt: 1.4, g: 0.9 }, { k: "crash", dt: 1.4, g: 0.4 }] },
  death: { duck: 0.2, hold: 3.5, notes: [{ k: "boom", dt: 0, g: 0.7 }, ...chordSn("strLong", [50, 53, 57], 0, 0.17, 3.5), ...chordSn("choirOh", [45, 50, 53], 0.2, 0.2, 4), { k: "bell", m: 38, dt: 0, g: 0.4 }] },
};

function reverbIR(c: BaseAudioContext, seconds: number) {
  const n = Math.floor(c.sampleRate * seconds);
  const b = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / c.sampleRate;
      const k = 0.15 + 0.8 * Math.exp(-t / 0.6);
      lp += k * (Math.random() * 2 - 1 - lp);
      d[i] = t < 0.012 ? 0 : lp * Math.exp(-t / 0.55);
    }
  }
  return b;
}

function softClip() {
  const cv = new Float32Array(4096);
  for (let i = 0; i < cv.length; i++) {
    const x = (i / (cv.length - 1)) * 2 - 1;
    const a = Math.abs(x);
    cv[i] = Math.sign(x) * (a < 0.7 ? a : 0.7 + 0.22 * Math.tanh((a - 0.7) / 0.22));
  }
  return cv;
}

export function createEngine(ctx: BaseAudioContext, bank: Bank, live = false) {
  const master = gain(ctx, ctx.destination, 1);
  const clip = ctx.createWaveShaper();
  clip.curve = softClip();
  clip.oversample = "2x";
  clip.connect(master);
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -4;
  lim.knee.value = 0;
  lim.ratio.value = 20;
  lim.attack.value = 0.002;
  lim.release.value = 0.12;
  lim.connect(clip);
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18;
  glue.knee.value = 8;
  glue.ratio.value = 3;
  glue.attack.value = 0.015;
  glue.release.value = 0.25;
  glue.connect(lim);
  const pre = filter(ctx, glue, "highpass", 28);
  const verb = ctx.createConvolver();
  verb.buffer = reverbIR(ctx, 2.6);
  verb.connect(gain(ctx, pre, 0.8));
  const musicBus = gain(ctx, pre, 0.32);
  const musicSend = gain(ctx, verb, 0.22);
  const duck = gain(ctx, musicBus, 1);
  duck.connect(musicSend);
  const stingBus = gain(ctx, musicBus, 0.9);
  stingBus.connect(musicSend);
  const sfxBus = gain(ctx, pre, 0.75);
  sfxBus.connect(gain(ctx, verb, 0.1));
  const layers = Object.fromEntries(LAYERS.map((l) => [l, gain(ctx, duck, 1)])) as Record<Layer, GainNode>;

  let ends: number[] = [];
  const busy = (when: number) => {
    if (ends.length > 256) ends = ends.filter((e) => e > ctx.currentTime);
    let k = 0;
    for (const e of ends) if (e > when) k++;
    return k;
  };
  const music: Voice[] = [];
  const sfxLive = new Map<Sfx, Voice[]>();
  const sfxLast = new Map<Sfx, number>();

  function play(buf: AudioBuffer, when: number, g: number, dest: AudioNode, o: { rate?: number; pan?: number; len?: number; rel?: number; swell?: boolean; offset?: number } = {}, cap = 96): Voice | null {
    if (g <= 0 || busy(when) >= cap) return null;
    const rate = o.rate ?? 1;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    const v = ctx.createGain();
    s.connect(v);
    let p: StereoPannerNode | null = null;
    if (o.pan) {
      p = ctx.createStereoPanner();
      p.pan.value = clamp(o.pan, -1, 1);
      v.connect(p).connect(dest);
    } else v.connect(dest);
    const full = when + (buf.duration - (o.offset ?? 0)) / rate;
    let end = full;
    if (o.swell && o.len) {
      v.gain.setValueAtTime(0.0001, when);
      v.gain.linearRampToValueAtTime(g, when + o.len);
    } else v.gain.value = g;
    if (o.len && when + o.len < full) {
      const rel = o.rel ?? 0.3;
      v.gain.setValueAtTime(g, when + o.len);
      v.gain.setTargetAtTime(0, when + o.len, rel / 3);
      end = Math.min(full, when + o.len + rel * 1.5);
    }
    s.start(when, o.offset ?? 0);
    if (end < full) s.stop(end);
    ends.push(end);
    s.onended = () => {
      s.disconnect();
      v.disconnect();
      p?.disconnect();
    };
    return { s, v, when, end };
  }

  const duckTo = (amount: number, hold: number) => {
    const t = ctx.currentTime;
    duck.gain.cancelScheduledValues(t);
    duck.gain.setTargetAtTime(1 - amount, t, 0.02);
    duck.gain.setTargetAtTime(1, t + hold, 0.5);
  };

  function sound(k: HitName | InstName, m: number | undefined, t: number, g: number, dest: AudioNode, o: { pan?: number; len?: number; swell?: boolean; offset?: number }, track: boolean) {
    const src = m !== undefined && k in INSTS ? bank.note(k as InstName, m) : bank.get(k) ? { buf: bank.get(k)!, rate: 1 } : null;
    if (!src) return false;
    const drum = m === undefined;
    const rate = src.rate * (drum && k !== "riser" && k !== "swell" ? 1 + (Math.random() - 0.5) * 0.03 : 1);
    const rel = REL[k];
    const choir = k === "choirAh" || k === "choirOh";
    const opts = { ...o, rate, rel };
    const vs = choir
      ? [play(src.buf, t, g * 0.75, dest, { ...opts, pan: (o.pan ?? 0) - 0.35, rate: rate * 0.997 }), play(src.buf, t + 0.012, g * 0.75, dest, { ...opts, pan: (o.pan ?? 0) + 0.35, rate: rate * 1.003 })]
      : [play(src.buf, t, g * (drum ? 0.97 + Math.random() * 0.06 : 1), dest, opts)];
    if (track) for (const v of vs) if (v) music.push(v);
    return true;
  }

  let cur: MusicState | null = null;
  let raw: MusicState = "title";
  let rawSince = 0;
  let want: MusicState = "title";
  let n = 0;
  let beat = 0;
  let tBeat = 0;
  let spb = 60 / 160 / 4;
  let bar: Note[] = [];
  let intensity = 0.5;
  let danger = 0;
  let heartT = 0;
  let late: { note: Note; t: number }[] = [];
  let seen = false;

  function release(at: number) {
    for (const v of music) {
      if (v.end <= at + 0.05) continue;
      if (v.when < at && v.end - at < 0.4) continue;
      const p = v.v.gain;
      if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(at);
      else p.cancelScheduledValues(at);
      if (v.when >= at) p.setValueAtTime(0, at);
      else p.setTargetAtTime(0, at, 0.12);
      v.end = Math.min(v.end, at + 0.7);
    }
  }

  function switchTo(s: MusicState, at: number) {
    release(at);
    late = [];
    cur = s;
    n = 0;
    beat = 0;
    spb = 60 / TEMPO[s] / 4;
    tBeat = at;
    if (s === "intro") {
      const pre: Note[] = [
        { k: "riser", st: 0, g: 0.55, l: "fx" },
        { k: "choirAh", m: 50, st: 0, g: 0.22, l: "choir", len: 2.6 / spb, swell: true },
        { k: "choirAh", m: 57, st: 0, g: 0.2, l: "choir", len: 2.6 / spb, swell: true },
        { k: "choirAh", m: 62, st: 0, g: 0.2, l: "choir", len: 2.6 / spb, swell: true },
        { k: "boom", st: 0, g: 0.4, l: "drums" },
      ];
      for (let st = 8; st < 28; st++) pre.push({ k: "strStac", m: 38 + (st % 2 ? 12 : 0), st, g: 0.06 + (st - 8) * 0.012, l: "str" });
      for (const nt of pre) schedule(nt, at + nt.st * spb, true);
      tBeat = at + 2.6;
    }
  }

  function schedule(nt: Note, t: number, allowLate = false) {
    const ok = sound(nt.k, nt.m, t, nt.g, layers[nt.l], { pan: nt.pan, len: nt.len ? nt.len * spb : undefined, swell: nt.swell }, true);
    if (!ok && allowLate) late.push({ note: nt, t });
  }

  function retryLate(now: number) {
    if (!late.length) return;
    late = late.filter(({ note, t }) => {
      const b = note.m !== undefined ? bank.note(note.k as InstName, note.m)?.buf : bank.get(note.k);
      if (!b) return now < t + 2;
      const off = Math.max(0, now + 0.03 - t);
      const len = note.len ? note.len * spb - off : undefined;
      if (off < b.duration - 0.2 && (len === undefined || len > 0.1)) sound(note.k, note.m, Math.max(t, now + 0.03), note.g, layers[note.l], { pan: note.pan, offset: off, len, swell: note.swell }, true);
      return false;
    });
  }

  function pump(until: number) {
    const now = ctx.currentTime;
    if (!seen) return;
    if (cur === null) switchTo(want, now + 0.05);
    retryLate(now);
    for (let i = music.length - 1; i >= 0; i--) if (music[i].end < now) music.splice(i, 1);
    while (tBeat < until) {
      if (want !== cur && (beat === 0 || URGENT_TO.includes(want) || URGENT_FROM.includes(cur!))) {
        const at = tBeat;
        switchTo(want, at);
        if (tBeat > at) continue;
      }
      if (beat === 0) {
        bar = GENS[cur!](n, intensity, spb);
        if (raw !== cur && raw !== "intro") {
          bar = bar.filter((e) => !(e.st >= 12 && (e.l === "drums" || e.l === "perc")));
          bar.push(...fill(spb, raw));
        }
      }
      const lo = beat * 4;
      const first = beat === 0 ? -Infinity : lo;
      for (const e of bar) if (e.st >= first && e.st < lo + 4) schedule(e, tBeat + (e.st - lo) * spb, cur === "intro");
      tBeat += 4 * spb;
      if (++beat === 4) {
        beat = 0;
        n++;
      }
    }
    if (danger > 0.55 && cur && cur !== "title" && cur !== "defeat") {
      heartT = Math.max(heartT, now + 0.05);
      while (heartT < until) {
        const b = bank.get("heart");
        if (b) play(b, heartT, (danger - 0.55) * 1.6, sfxBus, {}, 120);
        heartT += 60 / (80 + danger * 70);
      }
    }
  }

  let wind: { lo: GainNode; hi: GainNode; bp: BiquadFilterNode; gas: GainNode } | null = null;
  if (live) {
    const loop = (dest: AudioNode, rate = 1) => {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuffer(ctx);
      s.loop = true;
      s.playbackRate.value = rate;
      s.connect(dest);
      s.start();
    };
    const lo = gain(ctx, sfxBus, 0);
    loop(filter(ctx, filter(ctx, lo, "lowpass", 380, 0.9), "highpass", 60));
    const hi = gain(ctx, sfxBus, 0);
    const bp = filter(ctx, hi, "bandpass", 900, 1.6);
    loop(bp, 0.93);
    const gas = gain(ctx, sfxBus, 0);
    loop(filter(ctx, filter(ctx, gas, "peaking", 5200, 1.2, 6), "highpass", 1800), 1.07);
    wind = { lo, hi, bp, gas };
  }

  return {
    pump,
    update(s: EngineInput, now = ctx.currentTime) {
      seen = true;
      if (s.music !== raw) {
        raw = s.music;
        rawSince = now;
      }
      const calm = (raw === "explore" || raw === "battle") && (want === "explore" || want === "battle");
      if (!calm || now - rawSince > 1.2) want = raw;
      danger = clamp(s.danger);
      const sp = clamp((s.speed - 10) / 40);
      intensity = want === "boss" ? 1 : want === "battle" ? clamp(0.3 + 0.7 * danger + 0.25 * sp) : 0.5;
      const lg = layerGains(cur ?? want, intensity, danger);
      for (const l of LAYERS) layers[l].gain.setTargetAtTime(lg[l] * TRIM[l], now, 0.4);
      if (wind) {
        const w = Math.pow(clamp((s.speed - 6) / 45), 1.4);
        wind.lo.gain.setTargetAtTime(w * 0.4, now, 0.15);
        wind.hi.gain.setTargetAtTime(w * w * 0.22, now, 0.15);
        wind.bp.frequency.setTargetAtTime(600 + s.speed * 28, now, 0.2);
        wind.gas.gain.setTargetAtTime(s.gas ? 0.13 : 0, now, s.gas ? 0.03 : 0.08);
      }
    },
    sfx(name: Sfx, volume = 1, pan = 0, when = ctx.currentTime) {
      const d = SFX[name];
      const buf = bank.sfx(name);
      if (!buf || volume <= 0.01) return;
      if (when - (sfxLast.get(name) ?? -1) < 0.035) return;
      sfxLast.set(name, when);
      const list = (sfxLive.get(name) ?? []).filter((v) => v.end > when);
      if (list.length >= 4) {
        const old = list.shift()!;
        old.v.gain.setTargetAtTime(0, when, 0.03);
      }
      const fixed = name === "horn" || name === "bell" || name === "ui" || name === "lock" || name === "lockCycle";
      const v = play(buf, when, d.g * volume, sfxBus, { pan, rate: fixed ? 1 : 1 + (Math.random() - 0.5) * 0.08 }, 128);
      if (v) list.push(v);
      sfxLive.set(name, list);
      if (d.duck && volume > 0.4) duckTo(d.duck * Math.min(1, volume), d.dur * 0.4);
    },
    stinger(name: Stinger, when = ctx.currentTime + 0.02) {
      const st = STINGERS[name];
      for (const x of st.notes) sound(x.k, x.m, when + x.dt, x.g, stingBus, { pan: x.pan, len: x.len }, false);
      duckTo(st.duck, st.hold);
    },
    setMaster(v: number) {
      master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    },
    get state() {
      return cur;
    },
  };
}
