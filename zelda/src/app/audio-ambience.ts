// HOLLOWMERE audio: ambience beds (wind, rain, sea/lake waves, river, crickets), bird calls and thunder.
// Beds are looping sources whose gains are steered at ~8 Hz from the game state; birds and thunder are one-shots.
import { Rig, clamp, noise, ramp, rng, tone } from "./audio-dsp";

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

function cricketBuffer(r: Rig): AudioBuffer {
  const ac = r.ac;
  const sr = ac.sampleRate;
  const L = 6 * sr;
  const buf = ac.createBuffer(1, L, sr);
  const d = buf.getChannelData(0);
  const gen = rng(4242);
  const voices = [
    { f: 4302, per: 15, ph: gen() }, // carrier Hz (integer * 6 for a seamless loop), bursts per loop
    { f: 4614, per: 13, ph: gen() },
    { f: 4980, per: 16, ph: gen() },
    { f: 4458, per: 11, ph: gen() },
  ];
  for (const v of voices) {
    const T = 6 / v.per;
    for (let i = 0; i < L; i++) {
      const t = i / sr;
      const u = (((t / T + v.ph) % 1) + 1) % 1;
      if (u > 0.4) continue;
      const burst = u / 0.4;
      const env = Math.sin(burst * Math.PI);
      const am = 0.5 + 0.5 * Math.sin(2 * Math.PI * 27 * burst * T * 0.4);
      d[i] += Math.sin(2 * Math.PI * v.f * t) * env * am * 0.25;
    }
  }
  let pk = 0.001;
  for (let i = 0; i < L; i++) pk = Math.max(pk, Math.abs(d[i]));
  for (let i = 0; i < L; i++) d[i] *= 0.9 / pk;
  return buf;
}

export function createAmbience(r: Rig): Ambience {
  const ac = r.ac;
  const out = r.ambBus;
  const srcs: AudioScheduledSourceNode[] = [];
  const mk = <T extends AudioNode>(n: T): T => {
    r.nodes.push(n);
    return n;
  };
  const gainNode = (v = 0) => {
    const g = mk(ac.createGain());
    g.gain.value = v;
    return g;
  };
  const filt = (type: BiquadFilterType, f: number, q = 0.7) => {
    const b = mk(ac.createBiquadFilter());
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  };
  const noiseSrc = (offset: number) => {
    const s = ac.createBufferSource();
    s.buffer = r.noise;
    s.loop = true;
    s.start(0, offset);
    srcs.push(s);
    return mk(s);
  };

  const wind = gainNode();
  const windBp = filt("bandpass", 500, 0.6);
  noiseSrc(0.3).connect(windBp);
  windBp.connect(wind);
  wind.connect(out);

  const rainA = gainNode();
  const rainHp = filt("highpass", 900, 0.5);
  const rainLp = filt("lowpass", 9000, 0.5);
  noiseSrc(1.1).connect(rainHp);
  rainHp.connect(rainLp);
  rainLp.connect(rainA);
  rainA.connect(out);
  const rainB = gainNode();
  const rainBp = filt("bandpass", 260, 0.4);
  noiseSrc(2.2).connect(rainBp);
  rainBp.connect(rainB);
  rainB.connect(out);

  const waterPan = mk(ac.createStereoPanner());
  waterPan.connect(out);
  const wave = gainNode();
  const waveMod = gainNode(0.55);
  const waveLp = filt("lowpass", 650, 0.5);
  noiseSrc(3.1).connect(waveLp);
  waveLp.connect(waveMod);
  waveMod.connect(wave);
  wave.connect(waterPan);
  for (const [rate, depth] of [[0.13, 0.4], [0.31, 0.12]] as const) {
    const lfo = mk(ac.createOscillator());
    lfo.frequency.value = rate;
    const lg = gainNode(depth);
    lfo.connect(lg);
    lg.connect(waveMod.gain);
    lfo.start();
    srcs.push(lfo);
  }
  const river = gainNode();
  const riverBp = filt("bandpass", 1100, 0.5);
  const riverHp = filt("highpass", 350, 0.5);
  noiseSrc(0.8).connect(riverHp);
  riverHp.connect(riverBp);
  riverBp.connect(river);
  river.connect(waterPan);

  const cricket = gainNode();
  const cb = cricketBuffer(r);
  const crickPan: StereoPannerNode[] = [];
  [[0, 1, -0.5], [1.9, 0.97, 0.5]].forEach(([off, rate, pan]) => {
    const s = ac.createBufferSource();
    s.buffer = cb;
    s.loop = true;
    s.playbackRate.value = rate;
    const p = mk(ac.createStereoPanner());
    p.pan.value = pan;
    crickPan.push(p);
    s.connect(p);
    p.connect(cricket);
    s.start(0, off);
    srcs.push(s);
    mk(s);
  });
  const crickHp = filt("highpass", 2500, 0.5);
  cricket.connect(crickHp);
  crickHp.connect(out);

  let birdT = 3;
  let gustPh = 0;
  const R = Math.random;

  function birdCall(t: number, pan: number, vol: number) {
    const kind = Math.floor(R() * 3);
    const base = 2400 + R() * 1400;
    if (kind === 0) {
      const n = 3 + Math.floor(R() * 3);
      for (let i = 0; i < n; i++) tone(r, { t: t + i * 0.11, f: base * (1 + i * 0.02), to: base * 1.28, bend: 0.06, dur: 0.075, tc: 0.02, vol, out, pan, prio: 1 });
    } else if (kind === 1) {
      tone(r, { t, f: base * 0.7, to: base * 0.95, bend: 0.45, dur: 0.55, a: 0.04, tc: 0.18, vol: vol * 0.8, out, pan, prio: 1, vib: [22, base * 0.07, 0] });
    } else {
      const f = 380 + R() * 120;
      for (let i = 0; i < 3; i++) tone(r, { t: t + i * 0.26, f: f * (i === 2 ? 0.88 : 1), dur: 0.2, a: 0.03, tc: 0.07, vol: vol * 1.2, out, pan, prio: 1 });
    }
  }

  return {
    set(i, now, dt) {
      try {
        gustPh += dt;
        const gust = 0.78 + 0.22 * Math.sin(gustPh * 0.37 + Math.sin(gustPh * 0.11) * 2.2);
        const w = clamp(i.wind + (i.gliding ? 0.5 : 0));
        const alt = clamp(i.altitude);
        const wl = (0.025 + 0.2 * Math.pow(w, 1.2) * (0.55 + 0.45 * alt)) * gust;
        ramp(wind.gain, wl, now, 0.35);
        ramp(windBp.frequency, 330 + 520 * w + 260 * alt, now, 0.4);
        const rain = clamp(i.rain);
        ramp(rainA.gain, 0.14 * Math.pow(rain, 0.7), now, 0.5);
        ramp(rainB.gain, 0.14 * rain * rain, now, 0.5);
        ramp(rainLp.frequency, 6500 + 3500 * (1 - rain), now, 0.5);
        const wk = i.waterKind;
        const near = clamp(i.water);
        ramp(wave.gain, wk === 2 ? 0 : near * (wk === 0 ? 0.34 : 0.17), now, 0.4);
        ramp(waveLp.frequency, wk === 0 ? 650 : 420, now, 0.5);
        ramp(river.gain, wk === 2 ? near * 0.2 : 0, now, 0.4);
        ramp(waterPan.pan, clamp(i.waterPan, -0.9, 0.9) * 0.8, now, 0.3);
        const night = clamp(1 - i.daylight * 1.6) * (1 - rain) * (1 - clamp(alt * 2));
        ramp(cricket.gain, 0.2 * night, now, 1.2);
        if (i.daylight > 0.35 && rain < 0.3 && i.birdy > 0.02 && alt < 0.6) {
          birdT -= dt;
          if (birdT <= 0) {
            birdT = (3 + R() * 6) / (0.4 + i.birdy);
            birdCall(ac.currentTime + 0.02, (R() - 0.5) * 1.5, 0.045 + R() * 0.03);
          }
        } else birdT = Math.max(birdT, 1.5);
      } catch { /* swallow */ }
    },
    chirpNow(n) {
      try {
        const t = ac.currentTime + 0.05;
        for (let k = 0; k < n; k++) birdCall(t + k * (0.2 + R() * 0.5), (R() - 0.5) * 1.5, 0.06);
      } catch { /* swallow */ }
    },
    thunder(delay, pan) {
      try {
        const t = ac.currentTime + Math.max(0, delay);
        noise(r, { t, dur: 0.18, vol: 0.5, out, f: 3500, kind: "hp", tc: 0.04, pan, prio: 3 });
        for (let k = 0; k < 4; k++) {
          noise(r, { t: t + 0.05 + k * (0.4 + R() * 0.5), dur: 2.4 - k * 0.3, vol: 0.55 - k * 0.08, out, f: 320 - k * 40, f2: 50, kind: "lp", q: 0.7, a: 0.15, tc: 0.9, pan: pan * (0.6 + k * 0.1), prio: 3 });
        }
        tone(r, { t: t + 0.1, f: 55, to: 32, bend: 2.4, dur: 2.8, a: 0.2, tc: 0.9, vol: 0.28, out, prio: 3 });
      } catch { /* swallow */ }
    },
    dispose() {
      for (const s of srcs) {
        try { s.stop(); } catch { /* not started or already stopped */ }
      }
    },
  };
}

