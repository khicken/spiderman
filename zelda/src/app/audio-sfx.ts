// HOLLOWMERE audio v2: sound effects for every GameEvent that wants a sound.
// Physical sounds (steps, swings, hits, creatures, stone, water) are recorded clips from public/sfx through the SampleBank.
// Oscillators are allowed only for UI cues (tagged "ui") and magic cues (Thread, Tallow, beacons, pickups; tagged "magic").
// Owner: audio (T12).
import type { GameEvent, Surface, V3 } from "./contracts";
import { Rig, bell, clamp, hz, pluck, take, tone } from "./audio-dsp";
import type { Emitter } from "./audio-space";

export type UiCue = "move" | "ok" | "back" | "open" | "close" | "error";

export interface SfxFrame {
  hp: number;
  maxHp: number;
  charging: number; // 0..1 sword charge while the charge action runs, else 0
  wet: number;
  pushing?: boolean;
  riding?: boolean;
}

export interface Sfx {
  handle(e: GameEvent): void;
  ui(cue: UiCue): void;
  update(now: number, f: SfxFrame): void;
  dispose(): void;
}

// D Lydian pentatonic: D E F# A B. MIDI numbers per octave.
const D = [62, 64, 66, 69, 71];
const penta = (i: number) => D[((i % 5) + 5) % 5] + 12 * Math.floor(i / 5);

/** Gain per cue, linear, applied to clips that ship at about -3 dBFS peak. Calibrated by scripts/audio/level-check.mjs. */
export const LEVEL = {
  step: 0.57, stepWalk: 0.7, cloth: 0.12, jump: 0.1, land: 0.5, fall: 0.8,
  swing: 1.55, swing3: 1.95, whoosh: 0.2, dodge: 0.08,
  hit: 20, hitBlocked: 0.6, hurt: 0.9, arrowHit: 0.4, prop: 0.4,
  clash: 0.5, bow: 0.34, splash: 0.4, swim: 0.2,
  growl: 0.36, roar: 0.55, stone: 0.5, fire: 0.3, creak: 0.22, enemyStep: 0.3,
  magic: 0.09, ui: 0.14, thread: 0.14,
} as const;

const SURF: Record<Surface, string> = {
  grass: "step-grass", dirt: "step-dirt", rock: "step-rock", sand: "step-sand",
  stone: "step-stone", wood: "step-wood", water: "step-water", ash: "step-ash",
};
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface PlayOpts {
  g?: number;
  rate?: number;
  jit?: number; // playback-rate jitter, fraction
  pos?: V3;
  lp?: number;
  hp?: number;
  delay?: number;
  ref?: number;
  prio?: 1 | 2 | 3;
  off?: number; // start offset in the clip, s
  dur?: number; // cut the clip after this many seconds
  duck?: number; // impact duck length, s
}

export function createSfx(r: Rig): Sfx {
  const ac = r.ac;
  const bus = r.mix.sfx;
  const T = () => ac.currentTime + 0.005;
  let pushNext = 0;
  let hbNext = 0;
  let lastGlim = -10;
  let streak = 0;
  const srcs: AudioScheduledSourceNode[] = [];

  function play(id: string, o: PlayOpts = {}): boolean {
    const buf = r.bank.take(id);
    if (!buf) return false;
    const rate = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (o.jit ?? 0.04));
    const off = Math.min(o.off ?? 0, Math.max(0, buf.duration - 0.05));
    const len = Math.min((buf.duration - off) / rate, o.dur ?? 99);
    const t = T() + (o.delay ?? 0);
    if (!take(r, t, len + 0.05, o.prio ?? 2)) return false;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ac.createGain();
    g.gain.value = (o.g ?? 1) * Math.pow(10, rnd(-1.2, 1.2) / 20);
    if (o.dur !== undefined) {
      g.gain.setValueAtTime(g.gain.value, t + Math.max(0, len - 0.06));
      g.gain.linearRampToValueAtTime(0, t + len);
    }
    let node: AudioNode = src;
    src.connect(g);
    node = g;
    if (o.lp) {
      const f = ac.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = o.lp;
      node.connect(f);
      node = f;
    }
    if (o.hp) {
      const f = ac.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = o.hp;
      node.connect(f);
      node = f;
    }
    let em: Emitter | null = null;
    if (o.pos) {
      em = r.space.emit(o.pos, bus, { ref: o.ref });
      if (!em) return false;
      em.end = t + len + 0.3;
      node.connect(em.input);
    } else node.connect(bus);
    src.start(t, off);
    src.stop(t + len + 0.02);
    if (o.duck) r.mix.duck("impact", o.duck);
    return true;
  }

  const magic = (fn: () => void) => {
    r.mix.tag("magic");
    try { fn(); } finally { r.mix.untag(); }
  };
  const ui = (fn: () => void) => {
    r.mix.tag("ui");
    try { fn(); } finally { r.mix.untag(); }
  };
  const mag = ac.createGain();
  mag.connect(bus);
  const shSend = ac.createGain();
  shSend.gain.value = 0.35;
  mag.connect(shSend);
  shSend.connect(r.space.shimmer);
  const chime = (t: number, notes: number[], vol: number, gap = 0.09, decay = 0.9, out: AudioNode = mag) =>
    magic(() => {
      notes.forEach((m, i) => {
        bell(r, { t: t + i * gap, f: hz(m), vol, out, decay });
      });
    });

  function step(surface: Surface, run: boolean, g = 1) {
    const ok = play(SURF[surface], { g: LEVEL.step * (run ? 1 : LEVEL.stepWalk) * g, jit: 0.05 });
    if (ok && run && Math.random() < 0.3) play("cloth", { g: LEVEL.cloth * 0.5, rate: rnd(1.1, 1.4), delay: 0.02 });
  }

  const handle = (e: GameEvent): void => {
    try {
      const t = T();
      switch (e.type) {
        case "footstep": step(e.surface, e.run); break;
        case "jump":
          play("cloth", { g: LEVEL.cloth, rate: 1.25 });
          play("whoosh-soft", { g: LEVEL.jump, rate: 1.3, lp: 3000 });
          break;
        case "land": {
          const s = clamp(e.speed / 18);
          step(e.surface, true, 0.7 + 1.1 * s);
          play("rock-hit", { g: LEVEL.land * s, rate: 0.5, lp: 420, duck: s > 0.5 ? 0.2 : 0 });
          play("cloth", { g: LEVEL.cloth * (0.5 + s), rate: 0.9 });
          break;
        }
        case "fallDamage":
          play("hit-flesh", { g: LEVEL.fall, rate: 0.7, prio: 3, duck: 0.4 });
          play("rock-hit", { g: LEVEL.fall * 0.6, rate: 0.45, lp: 500, prio: 3 });
          break;
        case "climb":
          if (e.on) {
            play("cloth", { g: LEVEL.cloth, rate: 0.9 });
            play("rock-hit", { g: LEVEL.cloth * 0.7, rate: 1.6, lp: 2500 });
          }
          break;
        case "glide":
          if (e.on) play("whoosh-soft", { g: LEVEL.whoosh, rate: 0.75 });
          else play("whoosh-soft", { g: LEVEL.whoosh * 0.6, rate: 1.1 });
          play("cloth", { g: LEVEL.cloth, rate: 0.8 });
          break;
        case "swim":
          if (e.on) {
            play("splash", { g: LEVEL.splash * 0.7, rate: 0.9 });
            play("swim", { g: LEVEL.swim });
          } else play("swim", { g: LEVEL.swim * 0.6, rate: 1.15 });
          break;
        case "splash":
          play(e.size < 0.5 ? "splash" : "splash-big", { g: LEVEL.splash * (0.5 + clamp(e.size)), pos: e.pos, ref: 6 });
          break;
        case "staminaOut":
          play("cloth", { g: LEVEL.cloth * 1.2, rate: 0.7 });
          break;
        case "dodge":
          play("cloth", { g: LEVEL.dodge * 1.4, rate: 1.0 });
          play("whoosh-soft", { g: LEVEL.dodge, rate: 1.4, lp: 3500 });
          break;
        case "push":
          if (e.on) pushNext = 0.0001;
          else pushNext = 0;
          break;
        case "blockMove":
          play("stone-drag", { g: LEVEL.stone, pos: e.pos, ref: 7 });
          play("rock-hit", { g: LEVEL.stone * 0.8, rate: 0.6, pos: e.pos, ref: 7, delay: 0.5 });
          break;
        case "plate":
          play("rock-hit", { g: LEVEL.stone * 0.8, rate: e.on ? 0.55 : 0.8, lp: 1500 });
          if (e.on) play("stone-drag", { g: LEVEL.stone * 0.5, rate: 1.1, dur: 0.5 });
          break;
        case "swing":
          play("swing", { g: e.combo === 3 ? LEVEL.swing3 : LEVEL.swing, rate: e.combo === 2 ? 1.06 : e.combo === 3 ? 0.9 : 1, prio: 3 });
          play("cloth", { g: LEVEL.cloth * 0.7, rate: 1.1 });
          break;
        case "chargeReady":
          chime(t, [penta(5), penta(8)], LEVEL.magic, 0.06, 0.6);
          break;
        case "spin":
          play("swing", { g: LEVEL.swing3 * 1.1, rate: 0.8, prio: 3, dur: 0.5 });
          play("whoosh-soft", { g: LEVEL.whoosh, rate: 0.9 });
          break;
        case "shield":
          if (e.on) play("clash", { g: LEVEL.clash * 0.3, rate: 1.5, lp: 3000 });
          play("cloth", { g: LEVEL.cloth, rate: e.on ? 0.9 : 1.2 });
          break;
        case "bowDraw":
          play("creak", { g: LEVEL.creak, rate: 1.3, dur: 0.6 });
          break;
        case "arrowFired":
          play("bow-release", { g: LEVEL.bow, prio: 3 });
          play("whoosh-soft", { g: LEVEL.whoosh * 0.6, rate: 1.5, delay: 0.03 });
          break;
        case "lock":
          if (e.id >= 0) play("twig", { g: LEVEL.cloth * 0.8, rate: 1.8, lp: 4000 });
          else play("cloth", { g: LEVEL.cloth * 0.6, rate: 1.3 });
          break;
        case "hit":
          if (e.blocked || e.parried) {
            play("clash", { g: e.parried ? LEVEL.clash * 1.15 : LEVEL.hitBlocked, pos: e.pos, ref: 8, prio: 3, duck: 0.25 });
          } else if (e.kind === "bolt") {
            play("hit-flesh", { g: LEVEL.hit * 0.8, rate: 1.2, pos: e.pos, ref: 8, prio: 3, duck: 0.2 });
            play("fire-whoosh", { g: LEVEL.fire * 0.7, rate: 1.4, pos: e.pos, ref: 8, dur: 0.5 });
          } else {
            play("hit-flesh", { g: LEVEL.hit * clamp(0.65 + e.damage / 10, 0, 1.2), pos: e.pos, ref: 8, prio: 3, duck: e.damage >= 3 ? 0.3 : 0.15 });
            play("rock-hit", { g: LEVEL.hit * 0.5, rate: 0.5, lp: 700, pos: e.pos, ref: 8, prio: 3 });
            if (e.kind === "sword") play("clash", { g: LEVEL.clash * 0.35, rate: 1.4, pos: e.pos, ref: 8, lp: 6000 });
          }
          break;
        case "arrowHit":
          if (e.on === "water") play("splash", { g: LEVEL.splash * 0.5, rate: 1.2, pos: e.pos });
          else if (e.on === "enemy") {
            play("arrow-hit", { g: LEVEL.arrowHit, pos: e.pos });
            play("hit-flesh", { g: LEVEL.hit * 0.5, rate: 1.1, pos: e.pos });
          } else {
            play("arrow-hit", { g: LEVEL.arrowHit, pos: e.pos });
            if (e.on === "ground") play("twig", { g: LEVEL.prop * 0.4, rate: 1.2, pos: e.pos, delay: 0.03 });
          }
          break;
        case "propHit":
          if (e.id.startsWith("chime-")) {
            // wind chime secret: each chime is one D Lydian pentatonic note, picked by its index
            const n = parseInt(e.id.slice(6), 10);
            const idx = Number.isFinite(n) ? n : e.id.length;
            const m = penta(5 + (((idx % 5) + 5) % 5));
            magic(() => bell(r, { t, f: hz(m), vol: LEVEL.magic * 1.3, out: mag, decay: 2.2, prio: 3, partials: [[1, 1], [2.76, 0.35], [5.4, 0.12]] }));
            break;
          }
          if (/wood|crate|barrel|fence|bramble|post|sign/.test(e.id)) play("twig", { g: LEVEL.prop, pos: e.pos });
          else play("rock-hit", { g: LEVEL.prop, rate: 1.1, pos: e.pos });
          break;
        case "hurt":
          play("hit-flesh", { g: LEVEL.hurt, rate: 0.85, prio: 3, duck: 0.35 });
          play("cloth", { g: LEVEL.cloth * 1.4, rate: 0.8 });
          break;
        case "heal":
          chime(t, [penta(5), penta(7), penta(9)], LEVEL.magic * 0.8, 0.1, 1.2);
          break;
        case "died":
          play("hit-flesh", { g: LEVEL.hurt, rate: 0.6, prio: 3, duck: 0.6 });
          play("cloth", { g: LEVEL.cloth * 2, rate: 0.6 });
          break;
        case "respawned":
          chime(t, [penta(2), penta(4), penta(7)], LEVEL.magic * 0.8, 0.14, 1.4);
          break;
        case "drowned":
          play("splash-big", { g: LEVEL.splash, rate: 0.8, prio: 3 });
          play("swim", { g: LEVEL.swim, rate: 0.8 });
          break;
        case "enemyAlert":
          if (e.kind === "wisp") magic(() => bell(r, { t, f: hz(penta(8)), vol: LEVEL.magic * 0.7, out: mag, decay: 0.5 }));
          else if (e.kind === "warden") play("roar", { g: LEVEL.roar * 0.7, rate: 0.95, pos: e.pos, ref: 14, prio: 3 });
          else play("growl", { g: LEVEL.growl, rate: e.kind === "mossback" ? 0.65 : 1.05, pos: e.pos, ref: 10, dur: 1 });
          break;
        case "enemyWindup":
          if (e.kind === "brambling") {
            play("whoosh-soft", { g: LEVEL.whoosh * 0.9, rate: 1.2, pos: e.pos, ref: 8 });
            play("twig", { g: LEVEL.prop * 0.6, rate: 1.3, pos: e.pos, ref: 8 });
          } else if (e.kind === "mossback") {
            play("creak", { g: LEVEL.creak * 1.4, rate: 0.6, pos: e.pos, ref: 9, dur: 0.8 });
            play("growl", { g: LEVEL.growl * 0.6, rate: 0.55, pos: e.pos, ref: 9, dur: 0.6 });
          } else if (e.kind === "wisp") {
            magic(() => {
              tone(r, { t, f: hz(penta(8)), to: hz(penta(11)), dur: 0.35, tc: 0.12, vol: LEVEL.magic * 0.7, out: mag, a: 0.05, lp: 5000, prio: 3 });
              bell(r, { t: t + 0.05, f: hz(penta(11)), vol: LEVEL.magic * 0.5, out: mag, decay: 0.4 });
            });
          } else {
            play("roar", { g: LEVEL.roar * 0.8, rate: 1.1, pos: e.pos, ref: 16, dur: 1.2, prio: 3 });
            play("fire-whoosh", { g: LEVEL.fire * 0.8, rate: 0.8, pos: e.pos, ref: 16, dur: 0.9 });
          }
          break;
        case "tell":
          // The parry cue: short, bright, in front of the mix. Lands lead seconds before the hit.
          magic(() => {
            bell(r, { t, f: hz(penta(10)), vol: LEVEL.magic * 1.3, out: mag, decay: 0.22, prio: 3 });
            bell(r, { t, f: hz(penta(12)), vol: LEVEL.magic * 0.7, out: mag, decay: 0.16, prio: 3, partials: [[1, 1], [2, 0.3]] });
          });
          break;
        case "enemyHurt":
          if (e.kind === "wisp") magic(() => bell(r, { t, f: hz(penta(9)), vol: LEVEL.magic * 0.6, out: mag, decay: 0.3 }));
          else play("hit-flesh", { g: LEVEL.hit * 0.6, rate: e.kind === "mossback" || e.kind === "warden" ? 0.75 : 1.15, pos: e.pos, ref: 9 });
          break;
        case "enemyDied":
          if (e.kind === "wisp") {
            chime(t, [penta(9), penta(6), penta(3)], LEVEL.magic * 0.7, 0.12, 0.8);
          } else if (e.kind === "mossback") {
            play("growl", { g: LEVEL.growl, rate: 0.55, pos: e.pos, ref: 10 });
            play("rock-hit", { g: LEVEL.prop, rate: 0.6, pos: e.pos, ref: 10, delay: 0.2 });
          } else if (e.kind === "warden") {
            play("roar", { g: LEVEL.roar, rate: 0.75, pos: e.pos, ref: 18, prio: 3 });
          } else {
            play("growl", { g: LEVEL.growl, rate: 1.25, pos: e.pos, ref: 10, dur: 0.7 });
            play("twig", { g: LEVEL.prop, rate: 0.8, pos: e.pos, ref: 10, delay: 0.1 });
          }
          break;
        case "bossWake":
          play("roar", { g: LEVEL.roar, rate: 0.85, prio: 3, duck: 1.2 });
          play("stone-door", { g: LEVEL.stone * 0.6, rate: 0.9, delay: 0.2 });
          break;
        case "bossPhase":
          play("roar", { g: LEVEL.roar * 0.9, rate: 0.8 + 0.06 * e.phase, prio: 3, duck: 0.8 });
          break;
        case "bossDefeated":
          play("roar", { g: LEVEL.roar, rate: 0.6, pos: e.pos, ref: 20, prio: 3 });
          play("stone-door", { g: LEVEL.stone * 0.5, rate: 0.8, delay: 0.6 });
          break;
        case "pickup":
          switch (e.kind) {
            case "glimmer": {
              streak = t - lastGlim < 0.9 ? Math.min(streak + 1, 6) : 0;
              lastGlim = t;
              chime(t, [penta(5 + (streak % 4))], LEVEL.magic * 0.8, 0, 0.5);
              break;
            }
            case "shard": chime(t, [penta(5), penta(7), penta(9), penta(10)], LEVEL.magic, 0.08, 1.2); break;
            case "heart": chime(t, [penta(2), penta(5), penta(7), penta(10)], LEVEL.magic, 0.12, 1.5); break;
            case "arrows": play("twig", { g: LEVEL.prop, rate: 1.2 }); play("cloth", { g: LEVEL.cloth, rate: 1.4 }); break;
            case "bow": case "glider":
              play("creak", { g: LEVEL.creak, rate: 1.1, dur: 0.7 });
              chime(t + 0.1, [penta(5), penta(8), penta(10)], LEVEL.magic, 0.14, 1.3);
              break;
            case "wick":
              play("fire-whoosh", { g: LEVEL.fire * 0.8, rate: 1.1, dur: 0.8 });
              chime(t + 0.05, [penta(7), penta(9)], LEVEL.magic * 0.7, 0.1, 0.8);
              break;
            default:
              play("twig", { g: LEVEL.prop, rate: 1.5 });
              break;
          }
          break;
        case "areaEnter":
          chime(t, e.first ? [penta(3), penta(5), penta(8)] : [penta(5), penta(8)], LEVEL.magic * (e.first ? 0.9 : 0.6), 0.2, 2);
          break;
        case "trialStart": chime(t, [penta(2), penta(7)], LEVEL.magic, 0.16, 1.2); break;
        case "trialProgress": chime(t, [penta(5 + (e.value % 4))], LEVEL.magic * 0.8, 0, 0.6); break;
        case "trialFail":
          play("rock-hit", { g: LEVEL.stone * 0.7, rate: 0.55, lp: 900 });
          chime(t, [penta(5), penta(2)], LEVEL.magic * 0.7, 0.18, 1);
          break;
        case "trialDone": chime(t, [penta(5), penta(7), penta(9), penta(10), penta(12)], LEVEL.magic, 0.11, 1.6); break;
        case "beaconLit":
        case "gladeLit":
          play("fire-whoosh", { g: LEVEL.fire, rate: 0.9, pos: e.pos, ref: 20, prio: 3 });
          chime(t + 0.05, [penta(2), penta(5), penta(7), penta(10), penta(12)], LEVEL.magic * (e.type === "beaconLit" ? 1 : 0.8), 0.15, 2.4);
          break;
        case "barrierDown":
          play("stone-door", { g: LEVEL.stone, prio: 3, duck: 1 });
          play("roar", { g: LEVEL.roar * 0.4, rate: 0.5, delay: 0.3 });
          chime(t + 0.2, [penta(2), penta(7), penta(10)], LEVEL.magic, 0.3, 2.5);
          break;
        case "rest":
          chime(t, [penta(2), penta(5), penta(7)], LEVEL.magic * 0.7, 0.25, 2);
          play("cloth", { g: LEVEL.cloth, rate: 0.8 });
          break;
        case "read":
          play("cloth", { g: LEVEL.cloth * 1.1, rate: 1.6 });
          break;
        case "saved":
          chime(t, [penta(7)], LEVEL.magic * 0.45, 0, 0.5);
          break;
        case "dusk":
          chime(t, [penta(3), penta(0)], LEVEL.magic * 0.5, 0.3, 2);
          break;
        // Thread: plucked strings (no oscillators) with a bell accent. Pitches are D Lydian pentatonic.
        case "threadPin": {
          const m = penta(e.end === 1 ? 5 : 7);
          pluck(r, { t, midi: m, vol: LEVEL.thread, out: mag, kind: "harp", dur: 1.4, prio: 3 });
          if (e.kind === "brazier") play("fire-whoosh", { g: LEVEL.fire * 0.5, rate: 1.4, pos: e.pos, dur: 0.5 });
          else if (e.kind === "knot") play("twig", { g: LEVEL.prop * 0.5, rate: 1.6, pos: e.pos });
          break;
        }
        case "threadLink": {
          const by: Record<string, number[]> = {
            ride: [5, 8], pull: [7, 5], bind: [5, 6, 7], tether: [6, 9], carry: [5, 7, 9], inert: [4],
          };
          (by[e.use] ?? [5, 7]).forEach((n, i) => pluck(r, { t: t + i * 0.07, midi: penta(n), vol: LEVEL.thread, out: mag, kind: "harp", dur: 1.6, prio: 3 }));
          if (e.burning) play("fire-whoosh", { g: LEVEL.fire * 0.6, rate: 1.2, dur: 0.8 });
          break;
        }
        case "threadCut":
          if (e.why === "broken") {
            play("twig", { g: LEVEL.prop * 0.8, rate: 1.6 });
            pluck(r, { t, midi: penta(2), vol: LEVEL.thread * 0.8, out: mag, kind: "bass", dur: 0.8 });
          } else if (e.why === "recall") {
            play("whoosh-soft", { g: LEVEL.whoosh * 0.8, rate: 1.4 });
            pluck(r, { t: t + 0.04, midi: penta(8), vol: LEVEL.thread * 0.7, out: mag, kind: "harp", dur: 1 });
          } else if (e.why === "pending") {
            play("cloth", { g: LEVEL.cloth, rate: 1.5 });
          } else {
            pluck(r, { t, midi: penta(6), vol: LEVEL.thread * 0.7, out: mag, kind: "harp", dur: 1 });
            pluck(r, { t: t + 0.09, midi: penta(3), vol: LEVEL.thread * 0.7, out: mag, kind: "harp", dur: 1 });
          }
          break;
        case "threadRide":
          if (e.on) {
            play("bow-release", { g: LEVEL.bow * 0.8, rate: 0.8, pos: e.pos, ref: 4 });
            play("whoosh-soft", { g: LEVEL.whoosh * 1.2, rate: 0.9, delay: 0.05 });
          } else play("whoosh-soft", { g: LEVEL.whoosh * 0.7, rate: 1.15 });
          break;
        case "threadFizzle":
          if (e.why === "heavy") play("creak", { g: LEVEL.creak, rate: 0.8, dur: 0.5 });
          else play("cloth", { g: LEVEL.cloth * 0.9, rate: 1.7 });
          pluck(r, { t, midi: penta(e.why === "far" ? 1 : 0), vol: LEVEL.thread * 0.5, out: mag, kind: "bass", dur: 0.5, prio: 3 });
          break;
        case "threadFire":
          play("fire-whoosh", { g: LEVEL.fire, rate: 1, pos: e.pos, ref: 12, prio: 3 });
          chime(t + 0.04, [penta(7), penta(10)], LEVEL.magic * 0.8, 0.1, 1);
          break;
        case "threadBind":
          play("clash", { g: LEVEL.clash * 0.6, rate: 0.8, pos: e.pos, ref: 10, duck: 0.15 });
          pluck(r, { t, midi: penta(5), vol: LEVEL.thread, out: mag, kind: "bass", dur: 0.8 });
          break;
        case "parry":
          play("clash", { g: LEVEL.clash * 1.2, pos: e.pos, ref: 8, prio: 3, duck: 0.3 });
          chime(t, [penta(10), penta(12), penta(14)], LEVEL.magic * 1.2, 0.04, 0.8);
          break;
        case "slowmo":
          play("whoosh-soft", { g: LEVEL.whoosh, rate: 0.45, dur: Math.max(0.4, e.seconds), lp: 2200 });
          break;
        case "hint": ui(() => tone(r, { t, f: hz(penta(5)), dur: 0.1, tc: 0.03, vol: LEVEL.ui * 0.5, out: r.mix.ui })); break;
        case "objective": ui(() => chimeUi(t, [penta(5), penta(7)], 0.6)); break;
        case "waystone":
          play("stone-door", { g: LEVEL.stone * 0.5, rate: 1.2, dur: 1.5 });
          chime(t + 0.1, e.first ? [penta(2), penta(5), penta(8), penta(10)] : [penta(5), penta(8)], LEVEL.magic, 0.18, 2);
          break;
        case "power":
        case "upgrade":
          chime(t, [penta(5), penta(7), penta(10), penta(12)], LEVEL.magic, 0.1, 1.6);
          break;
        case "shop":
          chime(t, [penta(8), penta(10)], LEVEL.magic * 0.7, 0.07, 0.7);
          play("cloth", { g: LEVEL.cloth, rate: 1.5 });
          break;
        case "secret":
          chime(t, [penta(7), penta(9), penta(12)], LEVEL.magic * 0.9, 0.09, 1.5);
          break;
        case "toast":
          ui(() => chimeUi(t, [penta(7)], 0.5));
          break;
        default:
          break;
      }
    } catch { /* audio never throws into the game loop */ }
  };

  const chimeUi = (t: number, notes: number[], k = 1) => {
    notes.forEach((m, i) => {
      const f = hz(m);
      tone(r, { t: t + i * 0.07, f, dur: 0.22, tc: 0.07, vol: LEVEL.ui * k, out: r.mix.ui, a: 0.006 });
      tone(r, { t: t + i * 0.07, f: f * 2, dur: 0.12, tc: 0.035, vol: LEVEL.ui * k * 0.25, out: r.mix.ui, a: 0.006 });
    });
  };

  let chargeSrc: AudioBufferSourceNode | null = null;
  let chargeG: GainNode | null = null;
  let chargeBp: BiquadFilterNode | null = null;

  return {
    handle,
    ui(cue) {
      try {
        const t = T();
        ui(() => {
          switch (cue) {
            case "move": chimeUi(t, [penta(5)], 0.55); break;
            case "ok": chimeUi(t, [penta(5), penta(8)]); break;
            case "back": chimeUi(t, [penta(8), penta(5)], 0.8); break;
            case "open": chimeUi(t, [penta(2), penta(5), penta(7)], 0.8); break;
            case "close": chimeUi(t, [penta(7), penta(5), penta(2)], 0.7); break;
            case "error":
              // two soft low notes, no buzz
              tone(r, { t, f: hz(penta(0) - 12), dur: 0.14, tc: 0.05, vol: LEVEL.ui * 0.9, out: r.mix.ui, lp: 900 });
              tone(r, { t: t + 0.11, f: hz(penta(-1) - 12), dur: 0.18, tc: 0.06, vol: LEVEL.ui * 0.9, out: r.mix.ui, lp: 900 });
              break;
          }
        });
      } catch { /* swallow */ }
    },
    update(now, f) {
      try {
        // sword charge: a rising band of wind
        const ch = clamp(f.charging);
        if (ch > 0.05) {
          if (!chargeSrc) {
            const b = r.bank.first("bed-wind-high") ?? r.bank.first("bed-wind");
            if (b) {
              chargeSrc = ac.createBufferSource();
              chargeSrc.buffer = b;
              chargeSrc.loop = true;
              chargeBp = ac.createBiquadFilter();
              chargeBp.type = "bandpass";
              chargeBp.Q.value = 1.4;
              chargeG = ac.createGain();
              chargeG.gain.value = 0;
              chargeSrc.connect(chargeBp);
              chargeBp.connect(chargeG);
              chargeG.connect(bus);
              chargeSrc.start(0, Math.random() * Math.max(0, b.duration - 1));
              srcs.push(chargeSrc);
            }
          }
          if (chargeG && chargeBp) {
            chargeG.gain.setTargetAtTime(0.1 + 0.35 * ch, now, 0.08);
            chargeBp.frequency.setTargetAtTime(500 + 2600 * ch, now, 0.1);
          }
        } else if (chargeSrc && chargeG) {
          chargeG.gain.setTargetAtTime(0, now, 0.05);
          const s = chargeSrc;
          const g = chargeG;
          // stop on the audio clock (no timer to outlive dispose) and drop it from srcs once it ends
          s.onended = () => {
            const i = srcs.indexOf(s);
            if (i >= 0) srcs.splice(i, 1);
            try { g.disconnect(); } catch { /* gone */ }
          };
          try { s.stop(now + 0.4); } catch { /* ended */ }
          chargeSrc = null;
          chargeG = null;
          chargeBp = null;
        }
        // block push: re-trigger the stone drag while it lasts
        if (pushNext > 0 && f.pushing !== false && now >= pushNext - 0.02) {
          if (play("stone-drag", { g: LEVEL.stone * 0.7, dur: 1.1 })) pushNext = now + 1.0;
          else pushNext = now + 0.5;
        }
        // low-health heartbeat: a low-passed, rate-shifted knock (a recorded thud, not a sine)
        const low = f.hp > 0 && (f.hp <= 4 || f.hp / Math.max(1, f.maxHp) <= 0.25);
        if (!low) {
          hbNext = 0;
          return;
        }
        if (hbNext === 0) hbNext = now;
        if (now >= hbNext - 0.14) {
          const k = clamp(1 - f.hp / Math.max(4, f.maxHp * 0.25));
          play("rock-hit", { g: LEVEL.land * 0.9, rate: 0.42, lp: 150, jit: 0, prio: 3, delay: Math.max(0, hbNext - now) });
          play("rock-hit", { g: LEVEL.land * 0.6, rate: 0.38, lp: 130, jit: 0, prio: 3, delay: Math.max(0, hbNext - now) + 0.19 });
          hbNext = Math.max(now, hbNext) + 1.05 - 0.4 * k;
        }
      } catch { /* swallow */ }
    },
    dispose() {
      for (const s of srcs) {
        try { s.stop(); } catch { /* already stopped */ }
      }
    },
  };
}
