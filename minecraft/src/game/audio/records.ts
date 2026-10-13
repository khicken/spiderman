import { pickPackClip, type PackLookup } from "./pack-sounds";
import { hashString, makeRng, midiHz, type Rng } from "./synth/dsp";

// Generative jukebox tracks. Each disc gets a seeded style, so a disc always plays the same piece.
interface Style {
  bpm: number;
  root: number;
  scale: number[];
  lead: OscillatorType;
  bass: OscillatorType;
  drums: number; // 0 none, 1 soft, 2 full
  eerie?: boolean;
  density: number;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PENTA = [0, 2, 4, 7, 9];
const PHRYG = [0, 1, 3, 5, 7, 8, 10];

const STYLES: Record<string, Style> = {
  "13": { bpm: 50, root: 45, scale: PHRYG, lead: "sine", bass: "sine", drums: 0, eerie: true, density: 0.15 },
  cat: { bpm: 112, root: 60, scale: MAJOR, lead: "square", bass: "triangle", drums: 2, density: 0.7 },
  blocks: { bpm: 126, root: 57, scale: DORIAN, lead: "sawtooth", bass: "square", drums: 2, density: 0.75 },
  chirp: { bpm: 110, root: 62, scale: MAJOR, lead: "triangle", bass: "sine", drums: 1, density: 0.6 },
  far: { bpm: 88, root: 55, scale: PENTA, lead: "sine", bass: "triangle", drums: 1, density: 0.45 },
  mall: { bpm: 100, root: 58, scale: MAJOR, lead: "triangle", bass: "triangle", drums: 1, density: 0.55 },
  mellohi: { bpm: 60, root: 53, scale: MINOR, lead: "sine", bass: "sine", drums: 0, density: 0.35 },
  stal: { bpm: 96, root: 51, scale: DORIAN, lead: "sawtooth", bass: "sine", drums: 1, density: 0.5 },
  strad: { bpm: 120, root: 60, scale: MAJOR, lead: "square", bass: "triangle", drums: 2, density: 0.65 },
  ward: { bpm: 104, root: 50, scale: MINOR, lead: "triangle", bass: "sawtooth", drums: 2, density: 0.6 },
  "11": { bpm: 40, root: 40, scale: PHRYG, lead: "sawtooth", bass: "sine", drums: 0, eerie: true, density: 0.1 },
  wait: { bpm: 116, root: 59, scale: PENTA, lead: "triangle", bass: "square", drums: 2, density: 0.6 },
  otherside: { bpm: 92, root: 56, scale: DORIAN, lead: "sawtooth", bass: "triangle", drums: 2, density: 0.55 },
  "5": { bpm: 70, root: 48, scale: PHRYG, lead: "sine", bass: "sawtooth", drums: 0, eerie: true, density: 0.25 },
  pigstep: { bpm: 85, root: 46, scale: MINOR, lead: "sawtooth", bass: "square", drums: 2, density: 0.55 },
  relic: { bpm: 78, root: 52, scale: MINOR, lead: "triangle", bass: "sine", drums: 1, density: 0.4 },
  creator: { bpm: 124, root: 57, scale: DORIAN, lead: "square", bass: "sawtooth", drums: 2, density: 0.7 },
  creator_music_box: { bpm: 124, root: 69, scale: DORIAN, lead: "sine", bass: "sine", drums: 0, density: 0.6 },
  precipice: { bpm: 98, root: 50, scale: MINOR, lead: "sawtooth", bass: "triangle", drums: 2, density: 0.55 },
};

interface Song {
  style: Style;
  chords: number[];
  motif: number[];
  motifB: number[];
}

function compose(disc: string): Song {
  const style = STYLES[disc] ?? STYLES.cat;
  const r = makeRng(hashString(`disc:${disc}`));
  const chords = [0, 0, 0, 0].map((_, i) => (i === 0 ? 0 : [3, 4, 5, 1, 2][Math.floor(r() * 5)]));
  const line = () => Array.from({ length: 16 }, (_, i) => (r() < style.density * (i % 4 === 0 ? 1.4 : 0.8) ? Math.floor(r() * 8) : -1));
  return { style, chords, motif: line(), motifB: line() };
}

const pitch = (s: Style, degree: number, octave = 0) => {
  const n = s.scale.length;
  const o = Math.floor(degree / n);
  return s.root + 12 * (o + octave) + s.scale[((degree % n) + n) % n];
};

interface Playing {
  song: Song;
  out: GainNode;
  panner: PannerNode;
  start: number;
  end: number;
  step: number;
  nodes: Set<AudioScheduledSourceNode>;
}

export function createRecords(ctx: AudioContext, dest: AudioNode, pack: PackLookup) {
  const playing = new Map<string, Playing>();
  let noise: AudioBuffer | null = null;

  function noiseBuf(): AudioBuffer {
    if (noise) return noise;
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    const r: Rng = makeRng(7);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    return noise;
  }

  function track(p: Playing, n: AudioScheduledSourceNode) {
    p.nodes.add(n);
    n.onended = () => p.nodes.delete(n);
  }

  function tone(p: Playing, type: OscillatorType, midi: number, t: number, dur: number, amp: number) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = midiHz(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(p.out);
    o.start(t);
    o.stop(t + dur + 0.05);
    track(p, o);
  }

  function hit(p: Playing, t: number, freq: number, dur: number, amp: number, type: BiquadFilterType) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(g).connect(p.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
    track(p, src);
  }

  function kick(p: Playing, t: number, amp: number) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.25);
    o.connect(g).connect(p.out);
    o.start(t);
    o.stop(t + 0.3);
    track(p, o);
  }

  function scheduleStep(p: Playing, t: number) {
    const s = p.song.style;
    const step = p.step;
    const sixteenth = 60 / s.bpm / 4;
    const bar = Math.floor(step / 16);
    const i = step % 16;
    const chord = p.song.chords[bar % 4];
    const section = Math.floor(bar / 8) % 2;
    if (s.eerie) {
      if (i === 0 && bar % 2 === 0) {
        tone(p, s.bass, pitch(s, chord, -1), t, sixteenth * 32, 0.12);
        tone(p, "sine", pitch(s, chord + 4, 0) + (Math.random() < 0.3 ? 1 : 0), t + sixteenth * 4, sixteenth * 24, 0.04);
      }
      if (Math.random() < s.density * 0.15) hit(p, t, 300 + Math.random() * 2000, 0.6, 0.03, "bandpass");
      return;
    }
    if (i === 0) for (const d of [0, 2, 4]) tone(p, "triangle", pitch(s, chord + d, -1), t, sixteenth * 15, 0.035);
    if (i % 4 === 0) tone(p, s.bass, pitch(s, chord, -2), t, sixteenth * 3, 0.1);
    const motif = section ? p.song.motifB : p.song.motif;
    const deg = motif[i];
    if (deg >= 0 && bar % 8 !== 7) tone(p, s.lead, pitch(s, chord + deg, s.lead === "sine" ? 1 : 0), t, sixteenth * (s.lead === "sine" ? 6 : 2.5), s.lead === "sine" ? 0.08 : 0.045);
    if (s.drums > 0) {
      if (i % 8 === 0) kick(p, t, s.drums > 1 ? 0.35 : 0.2);
      if (s.drums > 1 && i % 8 === 4) hit(p, t, 1800, 0.12, 0.12, "bandpass");
      if (i % 2 === 0) hit(p, t, 7000, 0.04, s.drums > 1 ? 0.05 : 0.03, "highpass");
    }
  }

  const timer = setInterval(() => {
    const now = ctx.currentTime;
    for (const [id, p] of playing) {
      if (now > p.end) {
        stop(id);
        continue;
      }
      const sixteenth = 60 / p.song.style.bpm / 4;
      if (p.step === Number.MAX_SAFE_INTEGER) continue;
      while (p.start + p.step * sixteenth < now + 0.6) {
        const t = p.start + p.step * sixteenth;
        if (t >= now - 0.05) scheduleStep(p, Math.max(t, now));
        p.step++;
      }
    }
  }, 200);

  function play(id: string, disc: string, x: number, y: number, z: number, seconds: number) {
    stop(id);
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.5);
    const panner = ctx.createPanner();
    panner.panningModel = "equalpower";
    panner.distanceModel = "linear";
    panner.refDistance = 1;
    panner.maxDistance = 64;
    if (panner.positionX) {
      panner.positionX.value = x;
      panner.positionY.value = y;
      panner.positionZ.value = z;
    } else panner.setPosition(x, y, z);
    out.connect(panner).connect(dest);
    const start = ctx.currentTime + 0.1;
    const clip = pickPackClip(pack, `music_disc.${disc}`);
    const p: Playing = { song: compose(disc), out, panner, start, end: start + seconds, step: 0, nodes: new Set() };
    if (clip) {
      const src = ctx.createBufferSource();
      src.buffer = clip.buffer;
      src.playbackRate.value = clip.pitch;
      const g = ctx.createGain();
      g.gain.value = Math.min(1, clip.volume);
      src.connect(g).connect(out);
      src.start(start);
      track(p, src);
      p.step = Number.MAX_SAFE_INTEGER;
      p.end = start + clip.buffer.duration / clip.pitch;
    }
    playing.set(id, p);
  }

  function stop(id: string) {
    const p = playing.get(id);
    if (!p) return;
    playing.delete(id);
    const t = ctx.currentTime;
    p.out.gain.cancelScheduledValues(t);
    p.out.gain.setTargetAtTime(0, t, 0.05);
    for (const n of p.nodes) {
      try {
        n.stop(t + 0.3);
      } catch {
        // not started
      }
    }
    setTimeout(() => p.panner.disconnect(), 600);
  }

  return {
    play,
    stop,
    dispose() {
      clearInterval(timer);
      for (const id of [...playing.keys()]) stop(id);
    },
  };
}
