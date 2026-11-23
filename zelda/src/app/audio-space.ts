// HOLLOWMERE audio: space. Generated reverb IRs per area, crossfaded; positional emitters with HRTF inside 30 m, air
// absorption by distance and a terrain occlusion check every 125 ms. Owner: audio (T12).
import type { V3 } from "./contracts";
import type { Mix } from "./audio-mix";
import { rng } from "./audio-dsp";

export type AreaPreset = "open" | "forest" | "ruin" | "cave";
/** RT60 in seconds: 0.8 open, 1.4 forest, 2.6 ruin, 3.8 cave and spire. */
export const RT60: Record<AreaPreset, number> = { open: 0.8, forest: 1.4, ruin: 2.6, cave: 3.8 };

export function presetFor(areaId: string | undefined): AreaPreset {
  switch (areaId) {
    case "shrine": case "village": return "ruin";
    case "whisperwood": case "beacon-wood": case "beacon-glade": return "forest";
    case "spire": case "cinder": return "cave";
    default: return "open";
  }
}

/** Exponential decay to -60 dB at rt60. The high band dies about twice as fast as the lows. */
export function makeIR(ac: BaseAudioContext, preset: AreaPreset): AudioBuffer {
  const sr = ac.sampleRate;
  const rt = RT60[preset];
  const L = Math.floor(rt * 1.15 * sr);
  const buf = ac.createBuffer(2, L, sr);
  const pre = Math.floor((preset === "cave" ? 0.03 : preset === "open" ? 0.012 : 0.02) * sr);
  const ln = Math.log(1000);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const r = rng(9100 + c * 31 + rt * 100);
    let y = 0;
    for (let i = pre; i < L; i++) {
      const t = (i - pre) / sr;
      const p = t / rt;
      const k = Math.max(0.06, 0.55 * Math.exp(-1.6 * p));
      y += ((r() * 2 - 1) - y) * k;
      const att = Math.min(1, (i - pre) / (0.004 * sr));
      d[i] = y * Math.exp(-ln * p) * att;
    }
    // Early reflections: a handful of discrete taps, spread wider in bigger rooms.
    const taps = preset === "open" ? 3 : 6;
    for (let k = 0; k < taps; k++) {
      const at = pre + Math.floor((0.006 + r() * 0.05 * (1 + rt / 2)) * sr);
      if (at < L) d[at] += (r() < 0.5 ? -1 : 1) * (0.5 - k * 0.05);
    }
  }
  let e = 0;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < L; i++) e += d[i] * d[i];
  }
  const norm = 1 / Math.sqrt(e / 2 / (sr * 0.05)) * 0.05;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < L; i++) d[i] *= norm;
  }
  return buf;
}

export interface EmitOpts {
  ref?: number; // distance where the sound is at full level
  occlude?: boolean; // default true
}

export interface Emitter {
  input: AudioNode;
  /** Context time after which tick() releases the nodes. */
  end: number;
  /** Move the source and re-check occlusion (throttled to 125 ms). */
  set(p: V3, now: number): void;
  dispose(): void;
}

export interface Space {
  setArea(p: AreaPreset): void;
  setOcclusion(fn: ((x: number, y: number, z: number) => boolean) | null): void;
  /** Reverb send from a bus. */
  send(from: AudioNode, amount: number): GainNode;
  /** Voice reverb send, level set by the area. */
  voiceSend: GainNode;
  /** Shimmer reverb input for magic cues. */
  shimmer: GainNode;
  setListener(x: number, y: number, z: number, rx: number, rz: number): void;
  /** One-shot or moving source routed through panner, air absorption and occlusion into `bus`. */
  emit(p: V3, bus: AudioNode, o?: EmitOpts): Emitter | null;
  tick(now: number): void;
  dist(p: V3): number;
  dispose(): void;
}

const MAX_EMITTERS = 40;

export function createSpace(ac: BaseAudioContext, mix: Mix): Space {
  const nodes: AudioNode[] = [];
  const g = (v: number) => {
    const n = ac.createGain();
    n.gain.value = v;
    nodes.push(n);
    return n;
  };
  const irs = new Map<AreaPreset, AudioBuffer>();
  const ir = (p: AreaPreset) => {
    let b = irs.get(p);
    if (!b) {
      b = makeIR(ac, p);
      irs.set(p, b);
    }
    return b;
  };

  const inGain = g(1);
  const outGain = g(0.7);
  const convA = ac.createConvolver();
  const convB = ac.createConvolver();
  const gA = g(1);
  const gB = g(0);
  nodes.push(convA, convB);
  let cur: AreaPreset = "open";
  let activeA = true;
  convA.buffer = ir(cur);
  inGain.connect(convA);
  inGain.connect(convB);
  convA.connect(gA);
  convB.connect(gB);
  gA.connect(outGain);
  gB.connect(outGain);
  outGain.connect(mix.pre);

  const voiceSend = g(0.16);
  voiceSend.connect(inGain);
  mix.voice.connect(voiceSend);

  const shimmer = g(0.0);
  shimmer.gain.value = 1;
  const sd = ac.createDelay(0.5);
  sd.delayTime.value = 0.11;
  const sfb = g(0.4);
  const shp = ac.createBiquadFilter();
  shp.type = "highpass";
  shp.frequency.value = 1500;
  const sOut = g(0.5);
  nodes.push(sd, shp);
  shimmer.connect(sd);
  sd.connect(shp);
  shp.connect(sfb);
  sfb.connect(sd);
  shp.connect(sOut);
  sOut.connect(inGain);
  sOut.connect(mix.pre);

  let occ: ((x: number, y: number, z: number) => boolean) | null = null;
  let upSet = false;
  const L = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
  const live = new Set<EmitterImpl>();

  interface EmitterImpl extends Emitter {
    next: number;
    occluded: boolean;
    pos: V3;
  }

  function dist(p: V3): number {
    const dx = p.x - L.x;
    const dz = p.z - L.z;
    const dy = p.y - L.y;
    return Math.sqrt(dx * dx + dz * dz + dy * dy * 0.25);
  }

  return {
    voiceSend,
    shimmer,
    setArea(p) {
      if (p === cur) return;
      cur = p;
      const now = ac.currentTime;
      const next = activeA ? convB : convA;
      next.buffer = ir(p);
      const gi = activeA ? gB : gA;
      const go = activeA ? gA : gB;
      gi.gain.cancelScheduledValues(now);
      go.gain.cancelScheduledValues(now);
      gi.gain.setTargetAtTime(1, now, 0.7);
      go.gain.setTargetAtTime(0, now, 0.7);
      activeA = !activeA;
      voiceSend.gain.setTargetAtTime(p === "open" ? 0.12 : p === "forest" ? 0.16 : 0.26, now, 0.4);
    },
    setOcclusion(fn) {
      occ = fn;
    },
    send(from, amount) {
      const s = g(amount);
      from.connect(s);
      s.connect(inGain);
      return s;
    },
    setListener(x, y, z, rx, rz) {
      if (!Number.isFinite(x + y + z + rx + rz)) return;
      L.x = x; L.y = y; L.z = z; L.rx = rx; L.rz = rz;
      const l = ac.listener;
      // forward is the right vector turned a quarter turn about Y: (rz, 0, -rx)
      // .value, not setValueAtTime: a per-frame event on each param grows its automation list without end
      if (l.positionX) {
        l.positionX.value = x;
        l.positionY.value = y;
        l.positionZ.value = z;
        l.forwardX.value = rz;
        l.forwardZ.value = -rx;
        if (!upSet) {
          upSet = true;
          l.forwardY.value = 0;
          l.upX.value = 0;
          l.upY.value = 1;
          l.upZ.value = 0;
        }
      } else {
        l.setPosition(x, y, z);
        l.setOrientation(rz, 0, -rx, 0, 1, 0);
      }
    },
    dist,
    emit(p, bus, o = {}) {
      if (live.size >= MAX_EMITTERS) return null;
      const d = dist(p);
      if (d > 140) return null;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 0.5;
      const og = ac.createGain();
      const pn = ac.createPanner();
      pn.panningModel = d < 30 ? "HRTF" : "equalpower";
      pn.distanceModel = "inverse";
      pn.refDistance = o.ref ?? 5;
      pn.rolloffFactor = 1.15;
      pn.maxDistance = 400;
      lp.connect(og);
      og.connect(pn);
      pn.connect(bus);
      const e: EmitterImpl = {
        input: lp,
        end: ac.currentTime + 6,
        next: 0,
        occluded: false,
        pos: { x: p.x, y: p.y, z: p.z },
        set(q, now) {
          e.pos.x = q.x; e.pos.y = q.y; e.pos.z = q.z;
          const dd = dist(q);
          if (!Number.isFinite(q.x + q.y + q.z)) return;
          if (pn.positionX) {
            pn.positionX.value = q.x;
            pn.positionY.value = q.y;
            pn.positionZ.value = q.z;
          } else pn.setPosition(q.x, q.y, q.z);
          if (now < e.next) return;
          e.next = now + 0.125;
          const hit = o.occlude === false || !occ ? false : occ(q.x, q.y, q.z);
          e.occluded = hit;
          const air = Math.min(18000, Math.max(1800, 18000 * Math.exp(-dd / 55)));
          const f = hit ? Math.min(air, 1200) : air;
          lp.frequency.setTargetAtTime(f, now, 0.05);
          og.gain.setTargetAtTime(hit ? 0.5 : 1, now, 0.05);
        },
        dispose() {
          live.delete(e);
          try {
            lp.disconnect();
            og.disconnect();
            pn.disconnect();
          } catch { /* already gone */ }
        },
      };
      const now = ac.currentTime;
      e.set(p, now);
      lp.frequency.value = lp.frequency.value || 18000;
      live.add(e);
      return e;
    },
    tick(now) {
      for (const e of live) {
        if (now > e.end) e.dispose();
        else e.set(e.pos, now);
      }
    },
    dispose() {
      for (const e of Array.from(live)) e.dispose();
      for (const n of nodes) {
        try { n.disconnect(); } catch { /* already gone */ }
      }
    },
  };
}
