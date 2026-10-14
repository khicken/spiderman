import type { CarSpec, EngineInput, EngineVoice } from "./contracts";
import { ENGINE_PARAMS, type EngineProfile, SURFACES } from "./audio-engine-dsp";
import { type ProcNode, type ProcParam, procNode } from "./audio-worklet";

type Layout = { order: number[]; banks: number[] };
const alt = (n: number) => Array.from({ length: n }, (_, i) => i % 2);
// Firing order as bank sequence. Cross-plane V8 (1-8-7-2-6-5-4-3, odd cylinders left) puts two same-bank firings in a row: that is the burble.
const LAYOUTS: Record<string, Layout> = {
  i4: { order: [0, 1, 2, 3], banks: [0, 0, 0, 0] },
  i6: { order: [0, 1, 2, 3, 4, 5], banks: alt(6) },
  f6: { order: [0, 1, 2, 3, 4, 5], banks: alt(6) },
  v8: { order: [0, 1, 2, 3, 4, 5, 6, 7], banks: [0, 1, 0, 1, 1, 0, 1, 0] },
  v8flat: { order: [0, 1, 2, 3, 4, 5, 6, 7], banks: alt(8) },
  v10: { order: [...Array(10).keys()], banks: alt(10) },
  v12: { order: [...Array(12).keys()], banks: alt(12) },
};

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h >>> 0) % 10000) / 10000;
  };
};

// Pipe lengths in ms. Long pipes and a low muffler give depth, short pipes and a high muffler give the howl.
type Voice = {
  width: number; minMs: number; maxMs: number; jitter: number; timeJit: number;
  hdr: [number, number]; hdrR: number; bankB: number; pipe: number; pipeR: number; loopHz: number;
  muffler: number; body: number; noise: number; noiseHz: number; noiseQ: number; rasp: number;
  roar: number; roarHz: number; intake: number; intakeHz: number;
  drive: number; asym: number; tilt: number; hybrid: number; trim: number;
};
const VOICES: Record<string, Voice> = {
  hyper: { width: 0.5, minMs: 1.1, maxMs: 3.5, jitter: 0.07, timeJit: 0.03, hdr: [1.6, 1.75], hdrR: -0.35, bankB: 0.9, pipe: 5, pipeR: -0.45, loopHz: 1800, muffler: 2600, body: 0.6, noise: 1.6, noiseHz: 900, noiseQ: 0.8, rasp: 0.25, roar: 0.025, roarHz: 700, intake: 0.02, intakeHz: 350, drive: 4, asym: 0.15, tilt: 6000, hybrid: 0.004, trim: 1.15 },
  gt3: { width: 0.36, minMs: 0.45, maxMs: 2.5, jitter: 0.05, timeJit: 0.02, hdr: [0.9, 0.95], hdrR: -0.5, bankB: 0.95, pipe: 2.6, pipeR: -0.35, loopHz: 3200, muffler: 5500, body: 0.25, noise: 1.6, noiseHz: 2200, noiseQ: 1.1, rasp: 0.35, roar: 0.02, roarHz: 1400, intake: 0.03, intakeHz: 500, drive: 5, asym: 0.1, tilt: 8000, hybrid: 0, trim: 1.58 },
  jdm: { width: 0.42, minMs: 0.9, maxMs: 3.5, jitter: 0.05, timeJit: 0.02, hdr: [1.2, 1.25], hdrR: -0.4, bankB: 0.95, pipe: 3.8, pipeR: -0.4, loopHz: 2400, muffler: 3600, body: 0.4, noise: 1.2, noiseHz: 1500, noiseQ: 0.8, rasp: 0.3, roar: 0.02, roarHz: 900, intake: 0.03, intakeHz: 420, drive: 3.5, asym: 0.08, tilt: 6500, hybrid: 0, trim: 1.46 },
  muscle: { width: 0.45, minMs: 1.4, maxMs: 5, jitter: 0.14, timeJit: 0.05, hdr: [1.7, 3.6], hdrR: -0.45, bankB: 0.6, pipe: 6, pipeR: -0.5, loopHz: 1500, muffler: 2100, body: 0.8, noise: 2, noiseHz: 650, noiseQ: 0.7, rasp: 0.3, roar: 0.035, roarHz: 500, intake: 0.03, intakeHz: 280, drive: 6, asym: 0.25, tilt: 5000, hybrid: 0, trim: 1.6 },
  rally: { width: 0.36, minMs: 1, maxMs: 3, jitter: 0.1, timeJit: 0.03, hdr: [1.4, 1.4], hdrR: -0.45, bankB: 0.95, pipe: 4.2, pipeR: -0.45, loopHz: 2200, muffler: 3300, body: 0.9, noise: 2.6, noiseHz: 700, noiseQ: 0.7, rasp: 0.6, roar: 0.03, roarHz: 800, intake: 0.03, intakeHz: 400, drive: 6, asym: 0.2, tilt: 6000, hybrid: 0, trim: 1.58 },
  v12: { width: 0.65, minMs: 0.4, maxMs: 2.5, jitter: 0.03, timeJit: 0.012, hdr: [0.75, 0.8], hdrR: -0.45, bankB: 0.95, pipe: 2.2, pipeR: -0.3, loopHz: 4000, muffler: 4800, body: 0.6, noise: 0.9, noiseHz: 2000, noiseQ: 1.2, rasp: 0.2, roar: 0.015, roarHz: 1500, intake: 0.03, intakeHz: 600, drive: 3, asym: 0.05, tilt: 9000, hybrid: 0, trim: 0.78 },
  classic: { width: 0.38, minMs: 1, maxMs: 3, jitter: 0.2, timeJit: 0.06, hdr: [1.3, 1.4], hdrR: -0.35, bankB: 0.95, pipe: 2.4, pipeR: -0.4, loopHz: 2600, muffler: 4000, body: 0.25, noise: 2.8, noiseHz: 2000, noiseQ: 1.4, rasp: 0.5, roar: 0.02, roarHz: 1000, intake: 0.04, intakeHz: 450, drive: 3.5, asym: 0.3, tilt: 6500, hybrid: 0, trim: 1.21 },
};
const BY_LAYOUT: Record<string, string> = { v8: "muscle", v8flat: "hyper", f6: "gt3", i6: "jdm", i4: "rally", v10: "v12", v12: "v12" };
const EV_TRIM = 4.7;

export function engineProfile(spec: CarSpec, sr: number, cheap: boolean): EngineProfile {
  const e = spec.engine;
  const s = spec.sound;
  const lay = LAYOUTS[e.layout] ?? { order: [...Array(Math.max(1, e.cylinders)).keys()], banks: alt(Math.max(1, e.cylinders)) };
  const electric = e.layout === "electric";
  const n = electric ? 0 : lay.order.length;
  const v = VOICES[spec.id] ?? VOICES[BY_LAYOUT[e.layout] ?? "jdm"];
  const r = hash(spec.id);
  const cross = e.layout === "v8";
  const ms = (x: number) => Math.round((x * sr) / 1000);
  return {
    cheap,
    electric,
    slots: lay.order.slice(0, n).map((i) => i / n),
    bank: lay.banks.slice(0, n),
    amp: Array.from({ length: n }, () => 1 + (r() - 0.5) * (cross ? 0.3 : 0.12)),
    width: v.width,
    minMs: v.minMs,
    maxMs: v.maxMs,
    jitter: v.jitter,
    timeJit: v.timeJit,
    hdr: v.hdr.map(ms),
    hdrR: v.hdrR,
    bankB: v.bankB,
    pipe: ms(v.pipe),
    pipeR: v.pipeR,
    loopHz: v.loopHz,
    muffler: v.muffler,
    body: v.body,
    noise: v.noise,
    noiseHz: v.noiseHz,
    noiseQ: v.noiseQ,
    rasp: v.rasp,
    roar: v.roar,
    roarHz: v.roarHz,
    intake: v.intake,
    intakeHz: v.intakeHz,
    drive: v.drive,
    asym: v.asym,
    tilt: Math.min(v.tilt, sr * 0.4),
    pops: s.pops,
    turbo: e.aspiration === "turbo" ? 1 : e.aspiration === "twin" ? 2 : 0,
    sc: e.aspiration === "super" ? s.whine : 0,
    hybrid: v.hybrid,
    whine: s.whine,
    flutter: (e.aspiration === "turbo" || e.aspiration === "twin") && s.pops >= 0.55,
    bang: spec.shiftTime <= 0.1 && s.pops >= 0.45,
    idle: Math.max(e.idle, 1),
    redline: e.redline,
    gain: (cheap ? 0.75 : 1) * (electric ? EV_TRIM : v.trim),
    stereo: cheap || n < 6 ? 0 : 0.5,
  };
}

export type Ears = { pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number }; wet: number };
export type VoiceCtl = EngineVoice & { apply(i: EngineInput, at?: number): void; dist(p: { x: number; y: number; z: number }): number; readonly level: number; readonly tunnel: boolean };

const C = 343;

export function createVoice(ctx: BaseAudioContext, dest: AudioNode, spec: CarSpec, player: boolean, ears: Ears, ready: Promise<boolean>): VoiceCtl {
  const out = ctx.createGain();
  out.gain.value = player ? 1 : 0.8;
  let pan: PannerNode | null = null;
  if (!player) {
    pan = ctx.createPanner();
    pan.panningModel = "equalpower";
    pan.distanceModel = "inverse";
    pan.refDistance = 9;
    pan.rolloffFactor = 1.3;
    pan.maxDistance = 3000;
    pan.connect(out);
  }
  out.connect(dest);
  let node: ProcNode | null = null;
  const params: Record<string, ProcParam> = {};
  let dead = false;
  let last: EngineInput | null = null;
  const prev = { x: 0, y: 0, z: 0, t: -1 };
  const vel = { x: 0, y: 0, z: 0 };
  let level = 0;
  let tunnel = false;

  void ready.then((ok) => {
    if (!ok || dead) return;
    try {
      node = procNode(ctx, "car-engine", {
        numberOfOutputs: 1,
        outputChannelCount: [player ? 2 : 1],
        processorOptions: engineProfile(spec, player ? ctx.sampleRate : ctx.sampleRate / 2, !player),
      });
      for (const n of ENGINE_PARAMS) params[n] = node.parameters.get(n)!;
      node.connect(pan ?? out);
      if (last) apply(last);
    } catch (e) {
      console.warn("engine voice", e);
    }
  });

  const sent: Record<string, number> = {};
  const set = (n: string, v: number, at?: number) => {
    const p = params[n];
    if (!p || sent[n] === v) return;
    sent[n] = v;
    if (at === undefined) p.value = v;
    else p.setValueAtTime(v, at);
  };

  function apply(i: EngineInput, at?: number) {
    last = i;
    tunnel = i.tunnel;
    const t = at ?? ctx.currentTime;
    const dtv = prev.t < 0 ? 0 : t - prev.t;
    if (dtv > 0.001) {
      const k = Math.min(1, dtv / 0.08);
      vel.x += ((i.pos.x - prev.x) / dtv - vel.x) * k;
      vel.y += ((i.pos.y - prev.y) / dtv - vel.y) * k;
      vel.z += ((i.pos.z - prev.z) / dtv - vel.z) * k;
    }
    prev.x = i.pos.x;
    prev.y = i.pos.y;
    prev.z = i.pos.z;
    prev.t = t;
    const dx = ears.pos.x - i.pos.x;
    const dy = ears.pos.y - i.pos.y;
    const dz = ears.pos.z - i.pos.z;
    const d = Math.hypot(dx, dy, dz);
    let pitch = 1;
    if (!player && d > 0.5) {
      const ux = dx / d;
      const uy = dy / d;
      const uz = dz / d;
      const vs = vel.x * ux + vel.y * uy + vel.z * uz;
      const vl = -(ears.vel.x * ux + ears.vel.y * uy + ears.vel.z * uz);
      pitch = Math.min(1.5, Math.max(0.66, (C + vl) / (C - Math.min(vs, 200))));
    }
    const redline = spec.engine.redline;
    level = Math.min(1, (0.3 + 0.7 * i.throttle) * (i.rpm / redline));
    if (!node) return;
    set("rpm", i.rpm, at);
    set("throttle", i.throttle, at);
    set("load", i.load, at);
    set("gear", i.gear, at);
    set("boost", i.boost, at);
    set("speed", i.speed, at);
    set("skid", i.skid, at);
    set("surface", Math.max(0, SURFACES.indexOf(i.surface)), at);
    set("limiter", i.limiter ? 1 : 0, at);
    set("pitch", pitch, at);
    set("interior", player && d < 2.2 ? 1 : 0, at);
    set("wet", ears.wet, at);
    set("active", player || d < 600 ? 1 : 0, at);
    if (pan) {
      if (at === undefined) {
        pan.positionX.value = i.pos.x;
        pan.positionY.value = i.pos.y;
        pan.positionZ.value = i.pos.z;
      } else {
        if (sent.px === i.pos.x && sent.pz === i.pos.z) return;
        sent.px = i.pos.x;
        sent.pz = i.pos.z;
        pan.positionX.setValueAtTime(i.pos.x, at);
        pan.positionY.setValueAtTime(i.pos.y, at);
        pan.positionZ.setValueAtTime(i.pos.z, at);
      }
    }
  }

  return {
    apply,
    update(i) {
      try {
        apply(i);
      } catch (e) {
        console.warn("engine update", e);
      }
    },
    dist: (q) => Math.hypot(q.x - prev.x, q.y - prev.y, q.z - prev.z),
    get level() {
      return level;
    },
    get tunnel() {
      return tunnel;
    },
    dispose() {
      dead = true;
      try {
        out.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
        setTimeout(() => {
          node?.disconnect();
          pan?.disconnect();
          out.disconnect();
          node?.port.postMessage("stop");
        }, 200);
      } catch {
        /* context closed */
      }
    },
  };
}
