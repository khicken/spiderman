import type { MusicState, Sfx } from "./contracts";
import { makeBuffers, makeVoices, mtof, shaperCurve } from "./audio-synth";
import { CHANNELS, TRACKS, type Beat, type Ch, type Track, type TrackId } from "./audio-tracks";

export type { MusicState, Sfx };

const LOOKAHEAD = 0.12;
const XFADE = 2;
const ROAM_SEC = 150;
const ROAM: TrackId[] = ["hero", "harlem", "jingle"];
const STATE_TRACK: Record<Exclude<MusicState, "explore" | "swing">, TrackId> = {
  menu: "roof",
  combat: "fight",
  boss: "boss",
  race: "rush",
  stealth: "stealth",
  victory: "victory",
};
const TRIM: Record<TrackId, number> = { hero: 1, harlem: 1.05, fight: 1, stealth: 1.2, boss: 0.9, roof: 1.4, jingle: 1.15, rush: 1, victory: 1.3 };
// [reverb send, delay send]
const SENDS: Record<Ch, [number, number]> = {
  drums: [0.1, 0],
  bass: [0, 0],
  keys: [0.3, 0.12],
  pad: [0.35, 0],
  lead: [0.3, 0.18],
  str: [0.28, 0],
  perc: [0.2, 0.22],
  fx: [0.4, 0],
};
const LOW: Record<Ch, number> = { drums: 0.5, bass: 0.8, keys: 1, pad: 0.9, lead: 0, str: 0.3, perc: 0.4, fx: 0.5 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

type Deck = {
  out: GainNode[]; // dry, reverb, delay buses fade together
  ch: Record<Ch, GainNode>;
  lvl: Record<Ch, number>;
  crackle: GainNode;
  track: Track | null;
  until: number;
  t: number;
  s: number;
  steps: number;
  bar: number;
  bars: number;
  sec: string;
  n: number;
  plays: Record<string, number>;
  beat: Beat;
};

export function createAudio() {
  const ctx = new AudioContext({ latencyHint: "interactive" });
  const buf = makeBuffers(ctx);
  const v = makeVoices(ctx, buf.noise);
  const { g, filt } = v;

  const master = g(1);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 8;
  comp.ratio.value = 3;
  comp.attack.value = 0.006;
  comp.release.value = 0.2;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  const clip = ctx.createWaveShaper();
  clip.curve = shaperCurve(1.2, 0.97);
  const out = g(1);
  master.connect(comp).connect(limiter).connect(clip).connect(out).connect(ctx.destination);

  const revIn = g(1);
  const conv = ctx.createConvolver();
  conv.buffer = buf.impulse;
  revIn.connect(filt("highpass", 350)).connect(conv).connect(g(0.45)).connect(master);

  const dlyIn = g(1);
  const dly = ctx.createDelay(2);
  const dlyFb = g(0.32);
  const dlyLp = filt("lowpass", 2800);
  dlyIn.connect(dly).connect(dlyLp).connect(dlyFb).connect(dly);
  dlyLp.connect(g(0.35)).connect(master);

  const musicTone = filt("lowpass", 6000, 0.5);
  const duck = g(1);
  const swellGain = g(1);
  const musicVol = g(0.4);
  musicTone.connect(duck).connect(swellGain).connect(musicVol).connect(master);
  const revBus = g(1);
  revBus.connect(revIn);
  const dlyBus = g(1);
  dlyBus.connect(dlyIn);

  const crackleSrc = ctx.createBufferSource();
  crackleSrc.buffer = buf.crackle;
  crackleSrc.loop = true;
  const crackleOut = g(0.3);
  crackleSrc.connect(filt("highpass", 900)).connect(filt("lowpass", 6500)).connect(crackleOut);
  crackleSrc.start();

  function makeDeck(): Deck {
    const dry = g(0);
    const rv = g(0);
    const dl = g(0);
    dry.connect(musicTone);
    rv.connect(revBus);
    dl.connect(dlyBus);
    const ch = {} as Record<Ch, GainNode>;
    const lvl = {} as Record<Ch, number>;
    for (const c of CHANNELS) {
      const n = g(1);
      n.connect(dry);
      const [r, d] = SENDS[c];
      if (r) n.connect(g(r)).connect(rv);
      if (d) n.connect(g(d)).connect(dl);
      ch[c] = n;
      lvl[c] = 1;
    }
    const crackle = g(0);
    crackleOut.connect(crackle).connect(ch.fx);
    const beat = { r: [0, 0, 0, 0, 0, 0, 0, 0], v, c: ch } as unknown as Beat;
    return { out: [dry, rv, dl], ch, lvl, crackle, track: null, until: 0, t: 0, s: 0, steps: 16, bar: 0, bars: 0, sec: "", n: 0, plays: {}, beat };
  }
  let cur = makeDeck();
  let other = makeDeck();

  const wind = ctx.createBufferSource();
  wind.buffer = buf.noise;
  wind.loop = true;
  const windBand = filt("bandpass", 300, 0.7);
  const windGain = g(0);
  wind.connect(windBand).connect(windGain).connect(master);
  wind.start();

  const sfxBus = g(0.8);
  sfxBus.connect(master);
  const sfxRev = g(0.35);
  sfxRev.connect(revIn);

  let state: MusicState = "menu";
  let energy = 0;
  let bossPhase = 0;
  let roamIdx = Math.floor(Math.random() * ROAM.length);
  let roamSince = 0;
  let rotate = false;
  let pendingRoam = false;
  const played = new Set<TrackId>();

  function fade(d: Deck, to: number, t: number, dur: number, cut = false) {
    for (const o of d.out) {
      o.gain.cancelScheduledValues(t);
      o.gain.setValueAtTime(o.gain.value, t);
      if (cut) o.gain.linearRampToValueAtTime(0, t + 0.05);
      o.gain.linearRampToValueAtTime(to, t + dur + (cut ? 0.05 : 0));
    }
  }

  function enterSection(d: Deck, sec: string) {
    const tr = d.track!;
    d.sec = sec;
    d.bar = 0;
    d.bars = tr.sections[sec];
    d.beat.loop = d.plays[sec] ?? 0;
    d.plays[sec] = d.beat.loop + 1;
  }

  function load(id: TrackId) {
    const now = ctx.currentTime;
    const back = other.track?.id === id && now < other.until;
    if (back) other.until = 0;
    else {
      const tr = TRACKS[id];
      other.track = tr;
      other.until = 0;
      other.t = now + 0.06;
      other.s = 0;
      other.n = 0;
      other.plays = {};
      enterSection(other, played.has(id) ? tr.resume : tr.start);
      played.add(id);
      other.crackle.gain.value = tr.crackle ?? 0;
      dly.delayTime.setValueAtTime((60 / tr.bpm) * 0.75, now);
    }
    fade(other, TRIM[id], now, XFADE, !back);
    if (cur.track) {
      fade(cur, 0, now, XFADE);
      cur.until = now + XFADE + 0.1;
    }
    [cur, other] = [other, cur];
    if (ROAM.includes(id)) roamSince = now;
  }

  function stepDeck(d: Deck) {
    const tr = d.track!;
    const S16 = 60 / tr.bpm / 4;
    const b = d.beat;
    if (d.s === 0) {
      if (d.bar >= d.bars) {
        const opts = tr.flow[d.sec];
        const pick = opts[Math.floor(Math.random() * opts.length)];
        enterSection(d, pick);
        if (rotate && d === cur && ROAM.includes(tr.id as TrackId)) {
          rotate = false;
          pendingRoam = true;
        }
      }
      d.steps = tr.barSteps?.(d.n) ?? 16;
      for (let i = 0; i < 8; i++) b.r[i] = Math.random();
      b.k = tr.key?.(bossPhase) ?? 0;
    }
    const sw = tr.swing ?? 0;
    const late = tr.swing8 ? (d.s % 4 === 2 ? sw : 0) : d.s % 2 === 1 ? sw : 0;
    b.t = d.t + late * S16;
    b.s = d.s;
    b.steps = d.steps;
    b.bar = d.bar;
    b.bars = d.bars;
    b.sec = d.sec;
    b.n = d.n;
    b.e = energy;
    b.S16 = S16;
    tr.step(b);
    d.t += S16;
    if (++d.s >= d.steps) {
      d.s = 0;
      d.bar++;
      d.n++;
    }
  }

  function tick() {
    if (ctx.state !== "running") return;
    const now = ctx.currentTime;
    for (const d of [cur, other]) {
      if (!d.track) continue;
      if (d.until && now > d.until) {
        d.track = null;
        continue;
      }
      if (d.t < now - 0.2) d.t = now + 0.05;
      while (d.t < now + LOOKAHEAD) stepDeck(d);
    }
    if (pendingRoam) {
      pendingRoam = false;
      roamIdx = (roamIdx + 1) % ROAM.length;
      load(ROAM[roamIdx]);
    }
  }
  const timer = setInterval(tick, 25);

  function setMix() {
    const t = ctx.currentTime;
    const roam = state === "explore" || state === "swing";
    for (const c of CHANNELS) {
      let x = 1;
      if (state === "explore") x = LOW[c];
      else if (state === "swing") {
        if (c === "lead") x = 0.55 + 0.45 * energy;
        else if (c === "str") x = 0.75 + 0.25 * energy;
        else if (c === "drums") x = 0.85 + 0.15 * energy;
        else if (c === "keys") x = 0.8;
      }
      if (!roam && c === "lead" && state === "menu") x = 0.9;
      if (Math.abs(x - cur.lvl[c]) > 0.02) {
        cur.lvl[c] = x;
        cur.ch[c].gain.setTargetAtTime(x, t, x > cur.ch[c].gain.value ? 0.35 : 0.8);
      }
    }
    const tone =
      state === "explore" ? 4500 : state === "swing" ? 7000 + 9000 * energy : state === "stealth" ? 3200 : state === "menu" ? 7000 : 16000;
    if (Math.abs(tone - lastTone) > 150) {
      lastTone = tone;
      musicTone.frequency.setTargetAtTime(tone, t, 0.4);
    }
  }
  let lastTone = 0;

  let lastSwell = -10;
  function swell() {
    const t = ctx.currentTime;
    if (t - lastSwell < 2.5 || !cur.track) return;
    lastSwell = t;
    v.swell(cur.ch.fx, t, 0.45, 0.22);
    v.crash(cur.ch.fx, t + 0.45, 0.16, 1.4);
    v.tone(cur.ch.fx, t + 0.45, "sine", 90, 45, 0.3, 0.35, 0.003, 0.6);
    swellGain.gain.cancelScheduledValues(t);
    swellGain.gain.setTargetAtTime(1.3, t, 0.15);
    swellGain.gain.setTargetAtTime(1, t + 1.2, 0.8);
  }

  function duckMusic(amount: number, dur: number) {
    const t = ctx.currentTime;
    duck.gain.cancelScheduledValues(t);
    duck.gain.setTargetAtTime(1 - amount, t, 0.02);
    duck.gain.setTargetAtTime(1, t + dur, 0.4);
  }

  let muted = false;
  let windLevel = -1;
  let prevSpeed = 0;
  return {
    ctx,
    update(_dt: number, speed: number, next: MusicState) {
      const sp = Math.max(0, speed);
      energy = clamp01((sp - 15) / 45);
      const st: MusicState = next === "explore" && sp > 22 ? "swing" : next;
      const roam = st === "explore" || st === "swing";
      if (st === "swing" && (state === "explore" || (sp - prevSpeed > 6 && prevSpeed < 25))) swell();
      prevSpeed = sp;
      state = st;
      const now = ctx.currentTime;
      if (roam && cur.track && ROAM.includes(cur.track.id as TrackId) && now - roamSince > ROAM_SEC) rotate = true;
      const want = roam ? ROAM[roamIdx] : STATE_TRACK[st];
      if (cur.track?.id !== want) {
        if (roam && cur.track && !ROAM.includes(cur.track.id as TrackId) && ROAM.includes(want)) rotate = false;
        load(want);
      }
      setMix();
      const k = Math.min(sp / 60, 1);
      const w = k * k * 0.12;
      if (Math.abs(w - windLevel) > 0.003) {
        windLevel = w;
        windGain.gain.setTargetAtTime(w, now, 0.12);
        windBand.frequency.setTargetAtTime(250 + sp * 25, now, 0.12);
      }
    },
    swell,
    setBossPhase(phase: number) {
      bossPhase = Math.max(0, Math.floor(phase));
    },
    setVolume(x: number) {
      master.gain.setTargetAtTime(clamp01(x) * clamp01(x), ctx.currentTime, 0.05);
    },
    sfx(name: Sfx, opts?: { pan?: number; volume?: number }) {
      if (ctx.state === "closed") return;
      playSfx(name, opts?.pan ?? 0, opts?.volume ?? 1);
    },
    setMuted(m: boolean) {
      muted = m;
      out.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.03);
    },
    get muted() {
      return muted;
    },
    suspend() {
      void ctx.suspend();
    },
    resume() {
      void ctx.resume().then(() => {
        for (const d of [cur, other]) d.t = Math.max(d.t, ctx.currentTime + 0.05);
      });
    },
    dispose() {
      clearInterval(timer);
      if (ctx.state !== "closed") void ctx.close();
    },
  };

  function playSfx(name: Sfx, panV: number, volume: number) {
    const t = ctx.currentTime + 0.005;
    const vol = g(volume);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, panV));
    vol.connect(pan).connect(sfxBus);
    const wet = g(0);
    vol.connect(wet).connect(sfxRev);
    let life = 0.5;
    const live = (end: number) => (life = Math.max(life, end - t));
    const R = Math.random;

    const N = (at: number, dur: number, x: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1, a = 0.002) => {
      v.nz(vol, at, dur, x, type, f0, f1, q, a);
      live(at + a + dur);
    };
    const T = (at: number, type: OscillatorType, f0: number, f1: number, glide: number, x: number, a: number, d: number) => {
      v.tone(vol, at, type, f0, f1, glide, x, a, d);
      live(at + a + d);
    };
    const bell = (at: number, midi: number, x: number, d = 0.9) => {
      v.bell(vol, at, midi, x, d);
      live(at + d);
    };
    const horn = (at: number, notes: number[], dur: number, x: number, bright = 0.9) => {
      for (const m of notes) v.brass(vol, at, m, dur, x, bright);
      live(at + dur + 0.4);
    };
    const debris = (from: number, to: number, count: number, x: number) => {
      for (let i = 0; i < count; i++) {
        const f = 2000 + R() * 4000;
        N(from + R() * (to - from), 0.025 + R() * 0.03, x * (0.5 + R() * 0.5), "bandpass", f, f, 2.5, 0.001);
      }
    };
    // Noise through a moving band: [time, freq] points plus a gain envelope.
    const sweep = (at: number, freqs: [number, number][], gains: [number, number][], q = 1.8, type: BiquadFilterType = "bandpass") => {
      const n = v.noise(at);
      const f = filt(type, freqs[0][1], q);
      for (const [dt, hz] of freqs.slice(1)) f.frequency.exponentialRampToValueAtTime(hz, at + dt);
      const e = g(0);
      e.gain.setValueAtTime(0, at);
      for (const [dt, x] of gains) e.gain.linearRampToValueAtTime(x, at + dt);
      const end = at + gains[gains.length - 1][0];
      n.connect(f).connect(e).connect(vol);
      v.play([n], [f, e], at, end + 0.02);
      live(end);
      return e;
    };
    const crowd = (at: number, dur: number, x: number, voices: number, rise: number) => {
      for (let i = 0; i < voices; i++) {
        const f = [500, 750, 1100, 1600, 2400, 3200][i % 6] * (0.9 + R() * 0.2);
        const n = v.noise(at);
        const bp = filt("bandpass", f, 3 + R() * 3);
        bp.frequency.linearRampToValueAtTime(f * rise, at + dur * 0.4);
        const e = g(0);
        e.gain.setValueAtTime(0, at);
        e.gain.linearRampToValueAtTime(x, at + 0.12 + R() * 0.15);
        e.gain.setTargetAtTime(0, at + dur * (0.5 + R() * 0.3), dur * 0.2);
        const am = g(0.75);
        const lfo = v.osc("sine", 3 + R() * 6, at);
        const la = g(0.25);
        lfo.connect(la).connect(am.gain);
        n.connect(bp).connect(e).connect(am).connect(vol);
        v.play([n, lfo], [bp, e, am, la], at, at + dur + 0.2);
      }
      live(at + dur + 0.2);
    };

    switch (name) {
      case "thwip":
        N(t, 0.12, 0.55, "bandpass", 5200, 1100, 2.5, 0.002);
        N(t, 0.015, 0.25, "highpass", 6500, 6500, 0.7, 0.0005);
        T(t, "triangle", 1700, 650, 0.05, 0.18, 0.001, 0.06);
        break;
      case "zip":
        sweep(t, [[0, 450], [0.42, 3800]], [[0.32, 0.5], [0.5, 0]], 2.5);
        T(t, "sine", 240, 900, 0.42, 0.06, 0.3, 0.15);
        N(t, 0.1, 0.3, "bandpass", 4500, 1200, 2.5);
        break;
      case "land":
        T(t, "sine", 130, 38, 0.18, 0.62, 0.002, 0.28);
        N(t, 0.16, 0.35, "lowpass", 900, 300, 0.7);
        debris(t + 0.03, t + 0.22, 4, 0.12);
        break;
      case "bigLand":
        wet.gain.value = 0.5;
        T(t, "sine", 100, 28, 0.45, 1, 0.003, 0.7);
        T(t, "sine", 48, 40, 0.5, 0.5, 0.01, 0.8);
        N(t, 0.45, 0.7, "lowpass", 600, 150, 0.7);
        N(t, 0.08, 0.35, "highpass", 1500, 1500, 0.7, 0.001);
        debris(t + 0.04, t + 0.6, 10, 0.16);
        break;
      case "collect":
        wet.gain.value = 0.6;
        [80, 84, 87, 92].forEach((m, i) => {
          T(t + i * 0.055, "sine", mtof(m), mtof(m), 0, 0.16, 0.002, 0.35);
          T(t + i * 0.055, "triangle", mtof(m) * 2, mtof(m) * 2, 0, 0.04, 0.002, 0.15);
        });
        break;
      case "checkpoint":
        wet.gain.value = 0.6;
        bell(t, 80, 0.26);
        bell(t + 0.12, 87, 0.3, 1.2);
        break;
      case "hit":
        T(t, "sine", 190, 55, 0.08, 0.95, 0.001, 0.17);
        N(t, 0.07, 0.6, "bandpass", 1400, 700, 0.8, 0.001);
        N(t, 0.01, 0.35, "highpass", 3500, 3500, 0.7, 0.0005);
        break;
      case "ko":
        wet.gain.value = 0.5;
        T(t, "sine", 210, 50, 0.1, 1, 0.001, 0.22);
        T(t + 0.02, "sine", 140, 30, 0.7, 0.8, 0.005, 0.9);
        N(t, 0.3, 0.6, "lowpass", 1800, 300, 0.7, 0.001);
        N(t, 0.012, 0.4, "highpass", 3000, 3000, 0.7, 0.0005);
        debris(t + 0.05, t + 0.35, 5, 0.12);
        break;
      case "whoosh":
        sweep(t, [[0, 400], [0.18, 2400], [0.45, 550]], [[0.15, 0.55], [0.46, 0]]);
        break;
      case "trick":
        wet.gain.value = 0.4;
        horn(t, [65, 72], 0.1, 0.09);
        horn(t + 0.09, [72, 77], 0.22, 0.1);
        T(t + 0.09, "sine", mtof(89), mtof(89), 0, 0.06, 0.002, 0.25);
        break;
      case "complete":
        wet.gain.value = 0.7;
        duckMusic(0.5, 1.6);
        horn(t, [49, 61, 65, 68, 73], 0.16, 0.075);
        horn(t + 0.2, [51, 63, 67, 70, 75], 0.16, 0.075);
        horn(t + 0.42, [41, 53, 65, 69, 72, 77], 1.4, 0.08, 1);
        T(t + 0.42, "sine", mtof(29), mtof(29), 0, 0.6, 0.005, 1.2);
        v.crash(vol, t + 0.42, 0.25);
        live(t + 2.2);
        break;
      case "fail":
        wet.gain.value = 0.5;
        [67, 66, 65].forEach((m, i) => horn(t + i * 0.3, [m, m - 12], 0.24, 0.08, 0.25));
        horn(t + 0.9, [64, 52], 0.8, 0.08, 0.2);
        break;
      case "start":
        wet.gain.value = 0.6;
        T(t, "sine", 80, 35, 0.4, 0.9, 0.003, 0.7);
        N(t, 0.25, 0.4, "lowpass", 1200, 300);
        horn(t, [53, 60, 65], 0.13, 0.09);
        horn(t + 0.17, [53, 60, 65], 0.13, 0.09);
        horn(t + 0.34, [56, 63, 68, 72], 0.75, 0.085, 1);
        v.snare(vol, t + 0.34, 0.6, true);
        break;
      case "levelUp":
        wet.gain.value = 0.7;
        [65, 69, 72].forEach((m, i) => horn(t + i * 0.1, [m], 0.12, 0.1));
        horn(t + 0.32, [53, 65, 69, 72, 77], 1.1, 0.075, 1);
        [89, 93, 96, 101].forEach((m, i) => T(t + 0.32 + i * 0.05, "sine", mtof(m), mtof(m), 0, 0.07, 0.002, 0.5));
        break;
      case "countdown":
        T(t, "sine", 880, 880, 0, 0.3, 0.002, 0.13);
        T(t, "triangle", 1760, 1760, 0, 0.06, 0.002, 0.08);
        break;
      case "go":
        wet.gain.value = 0.4;
        T(t, "sine", 1760, 1760, 0, 0.32, 0.002, 0.4);
        T(t, "triangle", 880, 880, 0, 0.12, 0.002, 0.35);
        T(t, "square", 1318.5, 1318.5, 0, 0.03, 0.002, 0.3);
        break;
      case "siren": {
        wet.gain.value = 0.5;
        const o = v.osc("sawtooth", 700, t);
        const o2 = v.osc("sawtooth", 700, t);
        o2.detune.value = 8;
        for (let i = 0; i < 2; i++) {
          const d = i === 0 ? 1.03 : 0.95; // doppler: approach then pass
          for (const p of [o.frequency, o2.frequency]) {
            p.linearRampToValueAtTime(1250 * d, t + i + 0.55);
            p.linearRampToValueAtTime(700 * d, t + i + 1);
          }
        }
        const lp = filt("lowpass", 1600, 0.7);
        lp.frequency.linearRampToValueAtTime(3000, t + 0.9);
        lp.frequency.linearRampToValueAtTime(1300, t + 2);
        const e = g(0);
        e.gain.setValueAtTime(0, t);
        e.gain.linearRampToValueAtTime(0.11, t + 0.9);
        e.gain.linearRampToValueAtTime(0, t + 2);
        o.connect(lp);
        o2.connect(lp);
        lp.connect(e).connect(vol);
        v.play([o, o2], [lp, e], t, t + 2.02);
        live(t + 2.05);
        break;
      }
      case "ui":
        T(t, "sine", 1500, 1100, 0.03, 0.14, 0.001, 0.035);
        N(t, 0.008, 0.05, "highpass", 4000, 4000, 0.7, 0.0005);
        break;
      case "punch": {
        const p = 0.85 + R() * 0.3;
        const body = 900 + R() * 900;
        T(t, "sine", (160 + R() * 70) * p, 48 * p, 0.07, 0.9, 0.001, 0.14 + R() * 0.05);
        N(t, 0.05 + R() * 0.04, 0.55, "bandpass", body, body * 0.55, 0.9, 0.001);
        N(t, 0.01, 0.3 + R() * 0.15, "highpass", 2800 + R() * 2200, 3000, 0.7, 0.0005);
        const kind = Math.floor(R() * 3);
        if (kind === 1) N(t + 0.006, 0.03, 0.3, "bandpass", 2600, 2600, 1.5, 0.0005);
        if (kind === 2) T(t, "triangle", 320 * p, 90, 0.05, 0.25, 0.001, 0.07);
        break;
      }
      case "punchHeavy":
        wet.gain.value = 0.4;
        duckMusic(0.35, 0.3);
        T(t, "sine", 140, 32, 0.25, 1, 0.002, 0.45);
        T(t, "triangle", 95, 40, 0.2, 0.35, 0.001, 0.25);
        N(t, 0.18, 0.8, "lowpass", 2600, 300, 0.7, 0.001);
        N(t, 0.015, 0.5, "highpass", 2500, 2500, 0.7, 0.0005);
        debris(t + 0.03, t + 0.25, 4, 0.1);
        break;
      case "dodge":
        sweep(t, [[0, 600], [0.08, 3000], [0.24, 700]], [[0.07, 0.42], [0.25, 0]], 1.6);
        break;
      case "perfectDodge":
        wet.gain.value = 0.75;
        duckMusic(0.45, 0.8);
        sweep(t, [[0, 2600], [0.85, 260]], [[0.1, 0.5], [0.9, 0]], 1.4);
        T(t, "sine", 320, 70, 0.75, 0.28, 0.01, 0.8);
        [88, 91, 95, 100].forEach((m, i) => bell(t + 0.08 + i * 0.07, m, 0.06, 1.1));
        break;
      case "spiderSense": {
        wet.gain.value = 0.6;
        for (let i = 0; i < 10; i++) {
          const f = [2900, 3500, 4100][i % 3] * (1 + R() * 0.06);
          T(t + i * 0.035, "sine", f, f * 1.03, 0.05, 0.06 * (1 - i / 12), 0.002, 0.07);
        }
        T(t, "sine", 160, 230, 0.3, 0.16, 0.05, 0.4);
        break;
      }
      case "webShot":
        N(t, 0.1, 0.5, "bandpass", 4200, 900, 2.5);
        N(t, 0.02, 0.3, "highpass", 7000, 7000, 0.7, 0.0005);
        T(t, "triangle", 1400, 500, 0.04, 0.16, 0.001, 0.05);
        N(t + 0.02, 0.06, 0.2, "lowpass", 900, 300);
        break;
      case "webImpact":
        N(t, 0.12, 0.45, "lowpass", 1200, 200, 1, 0.001);
        N(t, 0.18, 0.45, "bandpass", 1400, 250, 6, 0.003);
        T(t, "sine", 180, 60, 0.1, 0.4, 0.001, 0.15);
        break;
      case "whiff":
        sweep(t, [[0, 800], [0.07, 2000], [0.2, 600]], [[0.06, 0.28], [0.2, 0]], 1.5);
        break;
      case "glide": {
        const e = sweep(t, [[0, 400], [0.5, 650], [1.2, 450]], [[0.4, 0.32], [0.9, 0.28], [1.25, 0]], 0.8);
        const lfo = v.osc("sine", 13, t);
        const la = g(0.08);
        lfo.connect(la).connect(e.gain);
        v.play([lfo], [la], t, t + 1.25);
        break;
      }
      case "finisher":
        wet.gain.value = 0.6;
        duckMusic(0.7, 1);
        T(t, "sine", 150, 30, 0.3, 1, 0.002, 0.5);
        T(t, "sine", 70, 25, 0.9, 0.8, 0.003, 1.2);
        N(t, 0.25, 0.8, "lowpass", 3000, 250, 0.7, 0.001);
        N(t, 0.02, 0.5, "highpass", 2500, 2500, 0.7, 0.0005);
        horn(t + 0.02, [38, 45, 50, 53], 0.5, 0.08, 1);
        v.crash(vol, t, 0.3);
        debris(t + 0.05, t + 0.5, 8, 0.12);
        live(t + 1.6);
        break;
      case "hurt":
        T(t, "sine", 160, 60, 0.12, 0.75, 0.001, 0.2);
        N(t, 0.1, 0.5, "bandpass", 700, 400, 1, 0.001);
        T(t + 0.01, "sawtooth", 170, 110, 0.18, 0.08, 0.01, 0.2);
        break;
      case "heal":
        wet.gain.value = 0.7;
        [69, 73, 76, 81, 85].forEach((m, i) => T(t + i * 0.06, "sine", mtof(m), mtof(m), 0, 0.11, 0.01, 0.6));
        N(t, 0.4, 0.1, "bandpass", 2000, 5000, 1.5, 0.3);
        break;
      case "focusFull":
        wet.gain.value = 0.6;
        N(t, 0.1, 0.22, "bandpass", 500, 4000, 1.5, 0.25);
        [76, 83, 88].forEach((m) => bell(t + 0.28, m, 0.1, 1.1));
        break;
      case "bossIntro":
        wet.gain.value = 0.8;
        duckMusic(0.85, 2.4);
        T(t, "sine", 55, 30, 1.5, 0.9, 0.01, 2.2);
        horn(t, [36, 43, 48, 51], 1.8, 0.09, 0.8);
        [0, 0.3, 0.6, 1.2].forEach((d, i) => v.tom(vol, t + d, i === 3 ? 31 : 36, 0.6, 0.7));
        N(t, 1.8, 0.35, "lowpass", 800, 150, 0.7, 0.05);
        v.crash(vol, t, 0.25, 2);
        live(t + 2.6);
        break;
      case "bossPhase":
        wet.gain.value = 0.6;
        duckMusic(0.6, 1.2);
        horn(t, [48, 55, 60, 63], 0.15, 0.08, 0.8);
        horn(t + 0.2, [49, 56, 61, 64], 0.9, 0.09, 1);
        v.tom(vol, t + 0.2, 33, 0.7, 0.8);
        T(t + 0.2, "sine", 80, 35, 0.5, 0.6, 0.005, 0.8);
        live(t + 1.4);
        break;
      case "bossDefeat":
        wet.gain.value = 0.8;
        duckMusic(0.9, 3);
        T(t, "sine", 70, 22, 0.8, 1, 0.003, 1.4);
        N(t, 1.2, 0.8, "lowpass", 2500, 120, 0.7, 0.002);
        debris(t + 0.1, t + 1, 10, 0.14);
        horn(t + 0.6, [48, 55, 60, 64, 67, 72], 2, 0.07, 1);
        T(t + 0.6, "sine", mtof(36), mtof(36), 0, 0.5, 0.01, 2);
        v.crash(vol, t + 0.6, 0.25, 2.2);
        live(t + 3);
        break;
      case "cheer":
        wet.gain.value = 0.5;
        crowd(t, 2, 0.24, 8, 1.15);
        T(t + 0.3, "sine", 1800, 2700, 0.35, 0.04, 0.05, 0.4);
        T(t + 0.9, "sine", 2200, 1700, 0.3, 0.035, 0.05, 0.35);
        break;
      case "gasp":
        wet.gain.value = 0.4;
        crowd(t, 0.6, 0.3, 6, 1.4);
        break;
      case "photo":
        N(t, 0.008, 0.6, "highpass", 3000, 3000, 0.7, 0.0005);
        N(t, 0.03, 0.4, "bandpass", 1800, 1800, 2, 0.001);
        N(t + 0.07, 0.02, 0.5, "bandpass", 2600, 2600, 2, 0.0005);
        T(t + 0.1, "square", 900, 1400, 0.15, 0.025, 0.01, 0.15);
        break;
      case "gunshot":
        wet.gain.value = 0.7;
        N(t, 0.03, 1, "highpass", 1500, 1500, 0.7, 0.0005);
        N(t, 0.12, 0.7, "bandpass", 900, 400, 0.8, 0.001);
        T(t, "sine", 120, 45, 0.1, 0.7, 0.001, 0.15);
        N(t + 0.02, 0.4, 0.15, "lowpass", 2000, 500, 0.7, 0.005);
        break;
      case "rocket":
        wet.gain.value = 0.5;
        T(t, "sine", 90, 40, 0.2, 0.6, 0.002, 0.3);
        sweep(t, [[0, 600], [1, 3000], [1.3, 2000]], [[0.15, 0.45], [0.9, 0.35], [1.3, 0]], 0.7, "lowpass");
        debris(t + 0.1, t + 1.1, 9, 0.08);
        break;
      case "explosion":
        wet.gain.value = 0.7;
        duckMusic(0.6, 1.2);
        T(t, "sine", 70, 22, 0.8, 1, 0.003, 1.4);
        N(t, 1.2, 0.9, "lowpass", 2500, 120, 0.7, 0.002);
        N(t, 0.05, 0.6, "highpass", 1200, 1200, 0.7, 0.001);
        debris(t + 0.1, t + 1, 12, 0.15);
        break;
      case "shock": {
        wet.gain.value = 0.3;
        const o = v.osc("sawtooth", 55, t);
        const q = v.osc("square", 300, t);
        for (let i = 1; i < 25; i++) q.frequency.setValueAtTime(150 + R() * 900, t + i * 0.02);
        const bp = filt("bandpass", 2000, 1);
        const e = g(0);
        v.perc(e.gain, t, 0.22, 0.005, 0.5);
        o.connect(bp);
        q.connect(bp);
        bp.connect(e).connect(vol);
        v.play([o, q], [bp, e], t, t + 0.52);
        for (let i = 0; i < 8; i++) N(t + R() * 0.45, 0.01, 0.2 + R() * 0.2, "highpass", 4000, 4000, 0.7, 0.0005);
        break;
      }
      case "metal": {
        wet.gain.value = 0.5;
        const f = 420 * (0.9 + R() * 0.2);
        [[1, 0.28, 0.9], [2.76, 0.18, 0.5], [5.4, 0.1, 0.3], [8.93, 0.06, 0.2]].forEach(([m, x, d]) => T(t, "sine", f * m, f * m, 0, x, 0.001, d));
        N(t, 0.02, 0.4, "highpass", 3000, 3000, 0.7, 0.0005);
        break;
      }
      case "fistBump":
        T(t, "sine", 200, 90, 0.06, 0.55, 0.001, 0.12);
        N(t, 0.03, 0.25, "bandpass", 1500, 1500, 1, 0.001);
        bell(t + 0.08, 84, 0.07, 0.5);
        bell(t + 0.15, 91, 0.07, 0.6);
        break;
      case "ping":
        wet.gain.value = 0.6;
        [0, 0.18, 0.36].forEach((d, i) => {
          T(t + d, "sine", 1318.5, 1318.5, 0, 0.2 / (i + 1), 0.002, 0.45);
          T(t + d, "sine", 2637, 2637, 0, 0.04 / (i + 1), 0.002, 0.18);
        });
        break;
    }
    setTimeout(() => {
      vol.disconnect();
      pan.disconnect();
      wet.disconnect();
    }, (life + 0.3) * 1000);
  }
}
