import type { MusicState, Sfx } from "./contracts";

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
// D minor heroic loop: Dm, Bb, F, C, two bars each.
const CHORDS = [
  [50, 57, 62, 65],
  [46, 53, 58, 62],
  [41, 53, 57, 60],
  [48, 55, 60, 64],
];
const BEAT = 60 / 112;

export function createAudio() {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  const sfxBus = ctx.createGain();
  const musicBus = ctx.createGain();
  sfxBus.connect(master);
  musicBus.connect(master);
  musicBus.gain.value = 0.32;

  const sr = ctx.sampleRate;
  const noise = ctx.createBuffer(1, sr * 2, sr);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const loopNoise = (type: BiquadFilterType, freq: number, q: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(sfxBus);
    src.start();
    return { f, g };
  };
  const wind = loopNoise("bandpass", 500, 0.6);
  const hiss = loopNoise("highpass", 2500, 0.5);

  const env = (g: GainNode, t: number, peak: number, attack: number, decay: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  const out = (vol: number, pan = 0, bus: AudioNode = sfxBus) => {
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.gain.value = vol;
    g.connect(p).connect(bus);
    return g;
  };
  const tone = (dest: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, attack = 0.005) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    env(g, t, peak, attack, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  };
  const burst = (dest: AudioNode, type: BiquadFilterType, f0: number, f1: number, t: number, dur: number, peak: number, attack = 0.005, q = 1) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    env(g, t, peak, attack, dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random());
    s.stop(t + attack + dur + 0.05);
  };

  const SFX: Record<Sfx, (d: AudioNode, t: number) => void> = {
    hook: (d, t) => {
      burst(d, "bandpass", 3000, 900, t, 0.12, 0.5, 0.003, 2);
      tone(d, "square", 900, 300, t, 0.08, 0.08);
    },
    hookHit: (d, t) => {
      tone(d, "triangle", 1800, 1200, t, 0.06, 0.25);
      burst(d, "highpass", 4000, 2000, t, 0.05, 0.3);
    },
    hookMiss: (d, t) => tone(d, "sine", 500, 200, t, 0.15, 0.15),
    retract: (d, t) => burst(d, "bandpass", 1200, 3000, t, 0.15, 0.2, 0.01, 3),
    burst: (d, t) => burst(d, "highpass", 1800, 600, t, 0.35, 0.8, 0.01),
    slash: (d, t) => burst(d, "bandpass", 6000, 1500, t, 0.18, 0.6, 0.01, 1.5),
    slashHit: (d, t) => {
      burst(d, "bandpass", 5000, 1200, t, 0.12, 0.7, 0.003, 1.5);
      burst(d, "lowpass", 600, 200, t, 0.25, 0.6);
    },
    napeKill: (d, t) => {
      burst(d, "bandpass", 7000, 1500, t, 0.2, 0.9, 0.002, 1.2);
      tone(d, "sine", 90, 40, t, 0.6, 0.9);
      burst(d, "highpass", 3000, 1500, t + 0.15, 1.6, 0.25, 0.3);
    },
    cripple: (d, t) => {
      tone(d, "sine", 70, 35, t, 0.5, 0.7);
      burst(d, "lowpass", 400, 100, t, 0.6, 0.6);
    },
    dull: (d, t) => tone(d, "triangle", 300, 260, t, 0.12, 0.25),
    reload: (d, t) => {
      tone(d, "square", 1200, 1100, t, 0.03, 0.12);
      burst(d, "bandpass", 5000, 7000, t + 0.08, 0.3, 0.35, 0.01, 4);
      tone(d, "triangle", 2400, 2300, t + 0.35, 0.12, 0.15);
    },
    refill: (d, t) => [0, 4, 7, 12].forEach((n, i) => tone(d, "triangle", mtof(72 + n), mtof(72 + n), t + i * 0.07, 0.3, 0.12)),
    hurt: (d, t) => {
      tone(d, "sawtooth", 200, 80, t, 0.25, 0.3);
      burst(d, "lowpass", 900, 200, t, 0.2, 0.5);
    },
    grabbed: (d, t) => {
      tone(d, "sawtooth", 110, 70, t, 0.8, 0.4, 0.05);
      burst(d, "lowpass", 300, 120, t, 0.6, 0.7);
    },
    escape: (d, t) => {
      burst(d, "bandpass", 6000, 2000, t, 0.25, 0.8, 0.002);
      tone(d, "triangle", 600, 1200, t, 0.25, 0.2);
    },
    death: (d, t) => {
      tone(d, "sawtooth", 220, 55, t, 1.4, 0.35, 0.02);
      tone(d, "sine", 60, 30, t, 1.2, 0.8);
    },
    stomp: (d, t) => {
      tone(d, "sine", 60, 28, t, 0.5, 1);
      burst(d, "lowpass", 300, 60, t, 0.4, 0.8);
    },
    roar: (d, t) => {
      for (const f of [95, 142, 190]) tone(d, "sawtooth", f * 1.3, f * 0.8, t, 1.6, 0.15, 0.25);
      burst(d, "bandpass", 800, 300, t, 1.6, 0.5, 0.3, 0.8);
    },
    horn: (d, t) => {
      for (const n of [50, 57, 62]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = mtof(n);
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 900;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t + 0.3);
        g.gain.setValueAtTime(0.18, t + 1.4);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
        o.connect(f).connect(g).connect(d);
        o.start(t);
        o.stop(t + 2.3);
      }
    },
    land: (d, t) => burst(d, "lowpass", 500, 120, t, 0.12, 0.5),
    lock: (d, t) => tone(d, "square", 1400, 1400, t, 0.05, 0.08),
    start: (d, t) => SFX.horn(d, t),
  };

  const pad = ctx.createGain();
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 900;
  pad.connect(padFilter).connect(musicBus);
  pad.gain.value = 0.0001;
  const drums = ctx.createGain();
  drums.connect(musicBus);
  drums.gain.value = 0;

  let nextBeat = 0;
  let beat = 0;
  let state: MusicState = "menu";
  const schedule = () => {
    const now = ctx.currentTime;
    if (nextBeat < now) nextBeat = now + 0.05;
    while (nextBeat < now + 0.2) {
      const t = nextBeat;
      const bar = Math.floor(beat / 4);
      const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
      if (beat % 8 === 0)
        for (const n of chord) {
          for (const det of [-6, 6]) {
            const o = ctx.createOscillator();
            o.type = "sawtooth";
            o.frequency.value = mtof(n);
            o.detune.value = det;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.05, t + 0.8);
            g.gain.setValueAtTime(0.05, t + BEAT * 7);
            g.gain.exponentialRampToValueAtTime(0.0001, t + BEAT * 8 + 0.4);
            o.connect(g).connect(pad);
            o.start(t);
            o.stop(t + BEAT * 8 + 0.5);
          }
        }
      if (state === "battle") {
        if (beat % 2 === 0) tone(drums, "sine", 120, 40, t, 0.35, 0.9);
        if (beat % 4 === 3) burst(drums, "bandpass", 1800, 900, t, 0.18, 0.5, 0.002, 0.8);
        const n = chord[[0, 1, 2, 1][beat % 4]] + 12;
        tone(drums, "square", mtof(n), mtof(n), t, BEAT * 0.4, 0.05);
        tone(drums, "square", mtof(n), mtof(n), t + BEAT / 2, BEAT * 0.3, 0.035);
      }
      beat++;
      nextBeat += BEAT;
    }
  };

  let muted = false;
  let volume = 0.8;
  const applyVol = () => master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.05);
  applyVol();

  return {
    sfx(name: Sfx, o: { volume?: number; pan?: number } = {}) {
      if (ctx.state !== "running") return;
      SFX[name](out(o.volume ?? 1, o.pan), ctx.currentTime + 0.005);
    },
    update(speed: number, boosting: boolean, music: MusicState) {
      const now = ctx.currentTime;
      state = music;
      wind.g.gain.setTargetAtTime(Math.min(0.5, speed / 120), now, 0.1);
      wind.f.frequency.setTargetAtTime(300 + speed * 18, now, 0.1);
      hiss.g.gain.setTargetAtTime(boosting ? 0.22 : 0, now, 0.04);
      pad.gain.setTargetAtTime(music === "menu" ? 0.6 : music === "battle" ? 1 : 0.75, now, 0.5);
      padFilter.frequency.setTargetAtTime(music === "battle" ? 1800 : 800, now, 0.5);
      drums.gain.setTargetAtTime(music === "battle" ? 1 : 0, now, 0.4);
      schedule();
    },
    setMuted(m: boolean) {
      muted = m;
      applyVol();
    },
    setVolume(v: number) {
      volume = v;
      applyVol();
    },
    resume: () => ctx.resume(),
    dispose: () => ctx.close(),
  };
}

export type Audio = ReturnType<typeof createAudio>;
