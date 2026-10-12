import { makeRng, midiHz, rand } from "./synth/dsp";
import { composePiece, renderImpulse, renderPiano, type MusicEvent, type MusicKind } from "./synth/music-synth";

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
const FILTER_HZ: Record<MusicKind, number> = { menu: 9000, overworld: 9000, creative: 10000, underwater: 1300, nether: 2600, end: 6000 };
const PAD_WAVE: Record<MusicKind, OscillatorType> = { menu: "triangle", overworld: "triangle", creative: "triangle", underwater: "sine", nether: "sawtooth", end: "sawtooth" };

function safeStop(n: AudioScheduledSourceNode, when: number): void {
  try { n.stop(when); } catch { /* already stopped */ }
}

export function createMusic(ctx: AudioContext, dest: AudioNode) {
  const rng = makeRng((Date.now() & 0xffffffff) >>> 0);
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const verb = ctx.createConvolver();
  const [l, r] = renderImpulse(ctx.sampleRate, 3.8, rng);
  const ir = ctx.createBuffer(2, l.length, ctx.sampleRate);
  ir.getChannelData(0).set(l);
  ir.getChannelData(1).set(r);
  verb.buffer = ir;
  dry.gain.value = 0.7;
  wet.gain.value = 0.5;
  input.connect(dry).connect(dest);
  input.connect(verb).connect(wet).connect(dest);

  const pianoCache = new Map<number, AudioBuffer>();
  let kind: MusicSetting = "none";
  let current: Piece | null = null;
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
      const g = ctx.createGain();
      g.gain.value = e.vel * 0.55;
      src.connect(g).connect(p.filter);
      src.start(when);
      track(p, src);
      return;
    }
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = p.kind === "nether" ? 500 : p.kind === "end" ? 900 : 1400;
    lp.Q.value = 0.5;
    const level = e.vel * (p.kind === "underwater" || p.kind === "end" || p.kind === "nether" ? 0.07 : 0.045);
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

  function startPiece(k: MusicKind): void {
    const { events, length } = composePiece(k, rng);
    const out = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = FILTER_HZ[k];
    filter.connect(out).connect(input);
    const start = ctx.currentTime + 1;
    out.gain.setValueAtTime(0, ctx.currentTime);
    out.gain.linearRampToValueAtTime(1, start + 2);
    current = { kind: k, out, filter, events, next: 0, start, end: start + length, nodes: new Set() };
  }

  function fadeOut(p: Piece): void {
    const now = ctx.currentTime;
    p.out.gain.cancelScheduledValues(now);
    p.out.gain.setValueAtTime(p.out.gain.value, now);
    p.out.gain.linearRampToValueAtTime(0, now + FADE);
    for (const n of p.nodes) safeStop(n, now + FADE + 0.1);
    p.end = now + FADE + 0.2;
    p.next = p.events.length;
    fading.push(p);
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
      for (let i = p.next; i < p.events.length && p.start + p.events[i].t < now + LOOKAHEAD + 8; i++) {
        const e = p.events[i];
        if (e.kind === "piano" && !pianoCache.has(e.midi)) {
          piano(e.midi);
          break;
        }
      }
      if (now > p.end) {
        fadeOut(p);
        current = null;
        nextStart = now + rand(rng, 60, 180);
      }
    } else if (kind !== "none" && now >= nextStart) {
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
      if (current) {
        fadeOut(current);
        current = null;
      }
      if (k === "none") { nextStart = Infinity; return; }
      const now = ctx.currentTime;
      if (k === "menu") nextStart = now + 0.5;
      else if (prev === "none" || prev === "menu") nextStart = now + rand(rng, 10, 20);
      else nextStart = now + rand(rng, 2, 5);
    },
    dispose(): void {
      disposed = true;
      clearInterval(timer);
      for (const p of [...fading, ...(current ? [current] : [])]) for (const n of p.nodes) safeStop(n, 0);
      try { input.disconnect(); } catch { /* gone */ }
    },
  };
}
