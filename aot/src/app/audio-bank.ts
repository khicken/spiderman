import type { Sfx } from "./contracts";
import { type Recipe, bake, hz } from "./audio-dsp";
import * as I from "./audio-inst";
import { SFX } from "./audio-sfx";

type Pitched = { fn: Recipe; lo: number; hi: number; step: number; dur: number; sr: number };
type Hit = { fn: Recipe; f: number; dur: number; sr?: number };

export const HITS = {
  kick: { fn: I.kick, f: 1, dur: 0.7 },
  snare: { fn: I.snare, f: 1, dur: 0.9 },
  taiko: { fn: I.taiko, f: 1, dur: 1.4 },
  taikoHi: { fn: I.taiko, f: 1.45, dur: 1 },
  rim: { fn: I.rim, f: 1, dur: 0.15 },
  tomLo: { fn: I.tom, f: 92, dur: 0.8 },
  tomMid: { fn: I.tom, f: 130, dur: 0.7 },
  tomHi: { fn: I.tom, f: 180, dur: 0.6 },
  hat: { fn: I.hat, f: 0.018, dur: 0.15 },
  hatOpen: { fn: I.hat, f: 0.1, dur: 0.6 },
  crash: { fn: I.crash, f: 1, dur: 3.2 },
  boom: { fn: I.boom, f: 1, dur: 3.5, sr: 24000 },
  impact: { fn: I.impact, f: 1, dur: 4 },
  riser: { fn: I.riser, f: 2.6, dur: 2.6 },
  swell: { fn: I.swell, f: 1.3, dur: 1.3 },
  heart: { fn: I.heart, f: 1, dur: 0.6, sr: 24000 },
  anvil: { fn: I.anvil, f: 440, dur: 1.5 },
} satisfies Record<string, Hit>;
export type HitName = keyof typeof HITS;

export const INSTS = {
  chant: { fn: I.chant, lo: 45, hi: 57, step: 3, dur: 0.55, sr: 32000 },
  choirAh: { fn: I.choirAh, lo: 43, hi: 79, step: 4, dur: 5.6, sr: 24000 },
  strStac: { fn: I.strStac, lo: 31, hi: 64, step: 3, dur: 0.4, sr: 32000 },
  brassStab: { fn: I.brassStab, lo: 45, hi: 78, step: 3, dur: 0.6, sr: 32000 },
  brassLong: { fn: I.brassLong, lo: 38, hi: 78, step: 4, dur: 3.7, sr: 24000 },
  horn: { fn: I.horn, lo: 38, hi: 50, step: 12, dur: 3.8, sr: 24000 },
  bass: { fn: I.bass, lo: 26, hi: 50, step: 3, dur: 0.4, sr: 24000 },
  gtrMute: { fn: I.gtrMute, lo: 33, hi: 48, step: 3, dur: 0.3, sr: 32000 },
  gtrOpen: { fn: I.gtrOpen, lo: 33, hi: 48, step: 3, dur: 1.7, sr: 32000 },
  choirOh: { fn: I.choirOh, lo: 43, hi: 79, step: 4, dur: 5.6, sr: 24000 },
  strLong: { fn: I.strLong, lo: 38, hi: 86, step: 4, dur: 5.4, sr: 24000 },
  piano: { fn: I.piano, lo: 50, hi: 90, step: 3, dur: 2.7, sr: 32000 },
  bell: { fn: I.bell, lo: 38, hi: 62, step: 12, dur: 5, sr: 24000 },
} satisfies Record<string, Pitched>;
export type InstName = keyof typeof INSTS;

const FIRST_SFX: Sfx[] = ["gateBreak", "anchorFire", "anchorHit", "reel", "gasBurst", "gasDash", "slash", "slashHit", "titanStep", "roar", "napeKill"];

export type Bank = ReturnType<typeof createBank>;

export function createBank(rate: number) {
  const bufs = new Map<string, AudioBuffer>();
  const jobs: { key: string; run: () => Promise<AudioBuffer> }[] = [];
  let stopped = false;
  let seed = 1;
  const sr = (s?: number) => Math.min(rate, s ?? rate);

  const hitJob = (k: HitName) => {
    const h: Hit = HITS[k];
    jobs.push({ key: k, run: () => bake(sr(h.sr), h.dur, h.fn, h.f, seed++) });
  };
  const instJob = (k: InstName) => {
    const p = INSTS[k];
    for (let m = p.lo; m <= p.hi; m += p.step) jobs.push({ key: `${k}:${m}`, run: () => bake(p.sr, p.dur, p.fn, hz(m), seed++) });
  };
  const sfxJob = (k: Sfx) => {
    const d = SFX[k];
    for (let i = 0; i < d.n; i++) jobs.push({ key: `sfx:${k}:${i}`, run: () => bake(d.lo ? 24000 : sr(), d.dur, d.fn, 1, seed++ * 7919) });
  };

  (Object.keys(HITS) as HitName[]).forEach(hitJob);
  (["chant", "choirAh", "strStac", "brassStab", "brassLong", "horn"] as InstName[]).forEach(instJob);
  FIRST_SFX.forEach(sfxJob);
  (Object.keys(SFX) as Sfx[]).filter((k) => !FIRST_SFX.includes(k)).forEach(sfxJob);
  (["bass", "gtrMute", "gtrOpen", "choirOh", "strLong", "piano", "bell"] as InstName[]).forEach(instJob);

  return {
    get: (key: string) => bufs.get(key),
    note(k: InstName, m: number) {
      const p = INSTS[k];
      const root = Math.min(p.hi - ((p.hi - p.lo) % p.step), Math.max(p.lo, p.lo + Math.round((m - p.lo) / p.step) * p.step));
      const buf = bufs.get(`${k}:${root}`);
      return buf ? { buf, rate: Math.pow(2, (m - root) / 12) } : null;
    },
    sfx(k: Sfx) {
      const i = Math.floor(Math.random() * SFX[k].n);
      return bufs.get(`sfx:${k}:${i}`) ?? bufs.get(`sfx:${k}:0`);
    },
    async load(parallel = 3) {
      let next = 0;
      const worker = async () => {
        while (!stopped && next < jobs.length) {
          const j = jobs[next++];
          try {
            bufs.set(j.key, await j.run());
          } catch (e) {
            console.warn("audio bake failed", j.key, e);
          }
          await new Promise((r) => setTimeout(r, 0));
        }
      };
      await Promise.all(Array.from({ length: parallel }, worker));
    },
    stop() {
      stopped = true;
    },
    get size() {
      return bufs.size;
    },
    get total() {
      return jobs.length;
    },
  };
}
