import type { CarSpec, EngineInput, EngineVoice } from "./contracts";
import { ENGINE_PARAMS, type EngineProfile, SURFACES } from "./audio-engine-dsp";

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

// Loudness trims measured with the offline renders, so every car sits at a similar level at full load.
const TRIM: Record<string, number> = { i4: 1.05, i6: 0.95, f6: 1, v8: 0.95, v8flat: 0.95, v10: 1.1, v12: 1.2, electric: 16 };

export function engineProfile(spec: CarSpec, sr: number, cheap: boolean): EngineProfile {
  const e = spec.engine;
  const s = spec.sound;
  const lay = LAYOUTS[e.layout] ?? { order: [...Array(Math.max(1, e.cylinders)).keys()], banks: alt(Math.max(1, e.cylinders)) };
  const n = e.layout === "electric" ? 0 : lay.order.length;
  const r = hash(spec.id);
  const cross = e.layout === "v8";
  const old = spec.year < 1990;
  const unequal = cross || e.layout === "f6" || old;
  const ms = (x: number) => Math.round((x * sr) / 1000);
  return {
    cheap,
    electric: e.layout === "electric",
    slots: lay.order.slice(0, n).map((i) => i / n),
    bank: lay.banks.slice(0, n),
    amp: Array.from({ length: n }, () => 1 + (r() - 0.5) * (cross ? 0.3 : old ? 0.25 : 0.1)),
    hdr: Array.from({ length: n }, (_, i) => ms((lay.banks[i] ? 0.35 : 0) + r() * (unequal ? 0.9 : 0.2))),
    bankLen: [ms(0.9 + 1.4 * (1 - s.tone)), ms(1.0 + 1.5 * (1 - s.tone) + (unequal ? 0.4 : 0.05))],
    pipe: ms(5.6 - 3.8 * s.tone),
    refl: -0.3 - 0.25 * (1 - s.tone),
    muffler: 900 + 4200 * s.tone + 1200 * s.rasp,
    body: 80 + 170 * s.tone,
    width: cross ? 0.15 : n >= 10 ? 0.08 : n <= 4 ? 0.13 : 0.11,
    jitter: old ? 0.4 : cross ? 0.28 : 0.12,
    rasp: s.rasp,
    pops: s.pops,
    whine: e.aspiration === "super" ? 0.2 : s.whine,
    tone: s.tone,
    turbo: e.aspiration === "turbo" ? 1 : e.aspiration === "twin" ? 2 : 0,
    sc: e.aspiration === "super" ? s.whine : 0,
    flutter: (e.aspiration === "turbo" || e.aspiration === "twin") && s.pops >= 0.55,
    bang: spec.shiftTime <= 0.1 && s.pops >= 0.45,
    idle: Math.max(e.idle, 1),
    redline: e.redline,
    gain: 0.25 * (cheap ? 0.75 : 1) * (TRIM[e.layout] ?? 1),
    stereo: cheap || n < 6 ? 0 : 0.5,
  };
}

export type Ears = { pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number }; wet: number };
export type VoiceCtl = EngineVoice & { apply(i: EngineInput, at?: number): void; readonly level: number; readonly tunnel: boolean };

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
  let node: AudioWorkletNode | null = null;
  let params: Record<string, AudioParam> = {};
  let dead = false;
  let last: EngineInput | null = null;
  const prev = { x: 0, y: 0, z: 0, t: -1 };
  const vel = { x: 0, y: 0, z: 0 };
  let level = 0;
  let tunnel = false;

  void ready.then((ok) => {
    if (!ok || dead) return;
    try {
      node = new AudioWorkletNode(ctx, "car-engine", {
        numberOfInputs: 0,
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
