import { makeRng, midiHz, rand } from "./synth/dsp";
import { composePiece, NETHER_MOODS, type MusicEvent, type MusicKind } from "./synth/music-synth";
import { renderImpulse, renderPiano } from "./synth/piano";
import { pickPackClip, type PackLookup } from "./pack-sounds";

export type MusicSetting = MusicKind | "none";

interface Piece {
  kind: MusicKind;
  out: GainNode;
  filter: BiquadFilterNode;
  events: MusicEvent[];
  next: number;
  start: number;
  end: number;
  nodes: Set<AudioScheduledSourceNode>;
}

const LOOKAHEAD = 1.5;
const FADE = 4;
const FILTER_HZ: Record<MusicKind, number> = { menu: 12000, overworld: 12000, creative: 12000, underwater: 4500, nether: 5000, end: 9000, credits: 12000 };
const PAD_WAVE: Record<MusicKind, OscillatorType> = { menu: "triangle", overworld: "triangle", creative: "triangle", underwater: "sine", nether: "sawtooth", end: "sawtooth", credits: "triangle" };
// Seconds of silence between tracks: vanilla minDelay..maxDelay, game sets shortened from 10-20 min to 1-5 min.
const GAP: Record<MusicKind, [number, number]> = { menu: [1, 30], overworld: [60, 300], creative: [60, 180], underwater: [60, 300], nether: [60, 300], end: [60, 300], credits: [0, 0] };
const REPLACES: Record<MusicKind, boolean> = { menu: true, overworld: false, creative: false, underwater: false, nether: true, end: true, credits: true };
const NETHER_FILTER_HZ: Record<string, number> = { crimson_forest: 4200, warped_forest: 7000, soul_sand_valley: 3800, basalt_deltas: 3500 };
const PACK_EVENTS: Record<MusicKind, string[]> = {
  menu: ["music.menu"],
  overworld: ["music.game"],
  creative: ["music.creative", "music.game"],
  underwater: ["music.under_water", "music.game"],
  nether: ["music.nether.nether_wastes", "music.nether.crimson_forest", "music.nether.soul_sand_valley", "music.nether.basalt_deltas", "music.nether.warped_forest"],
  end: ["music.end"],
  credits: ["music.credits"],
};

function safeStop(n: AudioScheduledSourceNode, when: number): void {
  try { n.stop(when); } catch { /* already stopped */ }
}

export function createMusic(ctx: AudioContext, dest: AudioNode, pack: PackLookup) {
  const rng = makeRng((Date.now() & 0xffffffff) >>> 0);
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const verb = ctx.createConvolver();
  const [l, r] = renderImpulse(ctx.sampleRate, 4.2, rng);
  const ir = ctx.createBuffer(2, l.length, ctx.sampleRate);
  ir.getChannelData(0).set(l);
  ir.getChannelData(1).set(r);
  verb.normalize = false;
  verb.buffer = ir;
  dry.gain.value = 0.8;
  wet.gain.value = 1;
  input.connect(dry).connect(dest);
  input.connect(verb).connect(wet).connect(dest);

  const pianoCache = new Map<number, AudioBuffer>();
  let kind: MusicSetting = "none";
  let biome = "nether_wastes";
  let current: Piece | null = null;
  let stream: { src: AudioBufferSourceNode; out: GainNode; kind: MusicKind } | null = null;
  const fading: Piece[] = [];
  let nextStart = Infinity;
  let disposed = false;

  function piano(midi: number): AudioBuffer {
    let b = pianoCache.get(midi);
    if (!b) {
      const data = renderPiano(midi, ctx.sampleRate, makeRng(midi * 7919));
      b = ctx.createBuffer(1, data.length, ctx.sampleRate);
      b.getChannelData(0).set(data);
      pianoCache.set(midi, b);
    }
    return b;
  }

  function track(p: Piece, n: AudioScheduledSourceNode): void {
    p.nodes.add(n);
    n.onended = () => p.nodes.delete(n);
  }

  function playEvent(p: Piece, e: MusicEvent): void {
    const when = Math.max(ctx.currentTime, p.start + e.t);
    if (e.kind === "piano") {
      const src = ctx.createBufferSource();
      src.buffer = piano(e.midi);
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = Math.min(16000, midiHz(e.midi) * 2 + 700 + Math.pow(e.vel, 1.4) * 9000);
      tone.Q.value = 0.5;
      const g = ctx.createGain();
      const level = Math.pow(e.vel, 1.5) * 0.22;
      const off = when + Math.max(0.08, e.off);
      g.gain.setValueAtTime(level, when);
      g.gain.setValueAtTime(level, off);
      g.gain.setTargetAtTime(0, off, 0.1);
      src.connect(tone).connect(g).connect(p.filter);
      src.start(when);
      safeStop(src, Math.min(when + src.buffer.duration, off + 0.8));
      track(p, src);
      return;
    }
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = p.kind === "nether" ? 600 : p.kind === "end" ? 1000 : 1500;
    lp.Q.value = 0.5;
    const level = e.vel * (p.kind === "underwater" || p.kind === "end" || p.kind === "nether" ? 0.022 : 0.012);
    const atk = Math.min(3, e.dur * 0.3);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(level, when + atk);
    g.gain.setValueAtTime(level, when + e.dur - atk);
    g.gain.linearRampToValueAtTime(0, when + e.dur);
    lp.connect(g).connect(p.filter);
    for (const m of e.midis) {
      for (const det of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = PAD_WAVE[p.kind];
        o.frequency.value = midiHz(m);
        o.detune.value = det;
        o.connect(lp);
        o.start(when);
        o.stop(when + e.dur + 0.1);
        track(p, o);
      }
    }
  }

  function packEvents(k: MusicKind): string[] {
    return k === "nether" ? [`music.nether.${biome}`] : PACK_EVENTS[k];
  }

  function startStream(k: MusicKind): boolean {
    for (const ev of packEvents(k)) {
      const clip = pickPackClip(pack, ev);
      if (!clip) continue;
      const out = ctx.createGain();
      out.gain.value = Math.min(1, clip.volume);
      const src = ctx.createBufferSource();
      src.buffer = clip.buffer;
      src.playbackRate.value = clip.pitch;
      src.connect(out).connect(dest);
      src.start(ctx.currentTime + 0.2);
      stream = { src, out, kind: k };
      src.onended = () => {
        if (stream?.src !== src) return;
        stream = null;
        try { out.disconnect(); } catch { /* gone */ }
        scheduleNext(k);
      };
      return true;
    }
    return false;
  }

  function startPiece(k: MusicKind): void {
    if (startStream(k)) return;
    const nether = k === "nether" ? NETHER_MOODS[biome] : undefined;
    const { events, length } = composePiece(k, rng, nether);
    const out = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = (k === "nether" && NETHER_FILTER_HZ[biome]) || FILTER_HZ[k];
    filter.connect(out).connect(input);
    const start = ctx.currentTime + 3;
    out.gain.setValueAtTime(0, ctx.currentTime);
    out.gain.linearRampToValueAtTime(1, start + 0.5);
    current = { kind: k, out, filter, events, next: 0, start, end: start + length, nodes: new Set() };
  }

  function fadeOut(p: Piece, secs = FADE): void {
    const now = ctx.currentTime;
    p.out.gain.cancelScheduledValues(now);
    p.out.gain.setValueAtTime(p.out.gain.value, now);
    p.out.gain.linearRampToValueAtTime(0, now + secs);
    for (const n of p.nodes) safeStop(n, now + secs + 0.1);
    p.end = now + secs + 0.2;
    p.next = p.events.length;
    fading.push(p);
  }

  function stopCurrent(secs = FADE): void {
    if (current) {
      fadeOut(current, secs);
      current = null;
    }
    if (stream) {
      const s = stream;
      stream = null;
      const now = ctx.currentTime;
      s.out.gain.cancelScheduledValues(now);
      s.out.gain.setValueAtTime(s.out.gain.value, now);
      s.out.gain.linearRampToValueAtTime(0, now + secs);
      safeStop(s.src, now + secs + 0.1);
    }
  }

  function scheduleNext(k: MusicKind): void {
    const [a, b] = GAP[k];
    nextStart = ctx.currentTime + rand(rng, a, b);
  }

  function tick(): void {
    if (disposed) return;
    const now = ctx.currentTime;
    for (let i = fading.length - 1; i >= 0; i--) {
      if (now > fading[i].end) {
        try { fading[i].out.disconnect(); } catch { /* gone */ }
        fading.splice(i, 1);
      }
    }
    if (current) {
      const p = current;
      while (p.next < p.events.length && p.start + p.events[p.next].t < now + LOOKAHEAD) {
        playEvent(p, p.events[p.next]);
        p.next++;
      }
      // Each note takes 10-25 ms to render: warm the cache ahead under a small budget per tick.
      const t0 = performance.now();
      for (let i = p.next; i < p.events.length && p.start + p.events[i].t < now + LOOKAHEAD + 10 && performance.now() - t0 < 8; i++) {
        const e = p.events[i];
        if (e.kind === "piano" && !pianoCache.has(e.midi)) piano(e.midi);
      }
      if (now > p.end) {
        fadeOut(p, 1);
        current = null;
        scheduleNext(p.kind);
      }
    } else if (!stream && kind !== "none" && now >= nextStart) {
      startPiece(kind);
    }
  }

  const timer = setInterval(() => {
    try { tick(); } catch (err) { console.warn("music tick failed", err); }
  }, 250);

  return {
    setKind(k: MusicSetting): void {
      if (k === kind) return;
      const prev = kind;
      kind = k;
      if (k !== "none") for (const ev of packEvents(k)) pickPackClip(pack, ev);
      const playing = current?.kind ?? stream?.kind ?? null;
      const now = ctx.currentTime;
      if (k === "none") {
        stopCurrent();
        nextStart = Infinity;
        return;
      }
      if (playing && (REPLACES[k] || REPLACES[playing] || prev === "none")) stopCurrent();
      if (current || stream) return;
      if (k === "menu" || k === "credits") nextStart = now + (k === "menu" ? rand(rng, 0.5, 2) : 0.5);
      else if (prev === "none" || prev === "menu") nextStart = now + rand(rng, 5, 15);
      else nextStart = Math.min(Math.max(nextStart, now + 5), now + rand(rng, 5, 20));
    },
    // Vanilla picks the next nether track from the current biome and never cuts the playing one.
    setBiome(b: string): void {
      if (NETHER_MOODS[b]) biome = b;
    },
    fadeAll(): void {
      stopCurrent(2.5);
      if (kind !== "none") nextStart = ctx.currentTime + rand(rng, 6, 20);
    },
    state: () => ({ kind, playing: current ? current.kind : stream ? stream.kind : null, nextIn: Math.round(nextStart - ctx.currentTime) }),
    skip(): void {
      stopCurrent(0.5);
      nextStart = ctx.currentTime + 1;
    },
    dispose(): void {
      disposed = true;
      clearInterval(timer);
      for (const p of [...fading, ...(current ? [current] : [])]) for (const n of p.nodes) safeStop(n, 0);
      if (stream) safeStop(stream.src, 0);
      try { input.disconnect(); } catch { /* gone */ }
    },
  };
}
