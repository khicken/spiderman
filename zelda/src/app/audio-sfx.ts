// HOLLOWMERE audio: sound effects and UI cues for every GameEvent that wants a sound. All synthesized.
// Positional sounds use spat() for pan and distance gain. Player sounds are centered.
import type { EnemyKind, GameEvent, Surface, V3 } from "./contracts";
import { Rig, bell, clamp, hz, noise, pluck, spat, tone, vocal } from "./audio-dsp";

export type UiCue = "move" | "ok" | "back" | "open" | "close" | "error";

export interface SfxFrame {
  hp: number;
  maxHp: number;
  charging: number; // 0..1 sword charge while the charge action runs, else 0
  wet: number;
}

export interface Sfx {
  handle(e: GameEvent): void;
  ui(cue: UiCue): void;
  update(now: number, f: SfxFrame): void;
  dispose(): void;
}

// Output trims measured with the offline level check so every cue lands near its target peak.
const TRIM: Record<string, number> = {
  "footstep:grass": 4.5, "footstep:dirt": 4.5, "footstep:rock": 3.2, "footstep:sand": 2.4, "footstep:stone": 3.6,
  "footstep:wood": 3.8, "footstep:water": 2.4, "footstep:ash": 4.2,
  jump: 4, climb: 4, "shield:true": 4, "shield:false": 8, "lock:false": 5, "lock:true": 1.6, saved: 2,
  "arrowHit:ground": 3, "arrowHit:water": 3, "arrowHit:prop": 3.5, "arrowHit:enemy": 3,
  "plate:true": 2.2, "plate:false": 2.6, "hit:claw": 3.3, "hit:bolt": 2.2, "hit:sword": 2.5, staminaOut: 1.4, bowDraw: 1.9,
  "glide:false": 1.5, "enemyHurt:wisp": 2.5, "swing:1": 2.4, "swing:2": 2.4, "swing:3": 2.1, "enemyWindup:brambling": 2.2,
  "land:soft": 2, "pickup:glimmer": 1.7, trialProgress: 1.7, "splash:small": 1.7,
  heal: 0.55, "areaEnter:true": 0.5, "pickup:shard": 0.6, trialDone: 0.6, "pickup:heart": 0.5, "pickup:glider": 0.58,
  "pickup:bow": 0.58, respawned: 0.6, died: 0.8,
};
function trimKey(e: GameEvent): string {
  switch (e.type) {
    case "footstep": return "footstep:" + e.surface;
    case "swing": return "swing:" + e.combo;
    case "hit": return "hit:" + e.kind;
    case "pickup": return "pickup:" + e.kind;
    case "shield": return "shield:" + e.on;
    case "areaEnter": return "areaEnter:" + e.first;
    case "plate": return "plate:" + e.on;
    case "glide": return "glide:" + e.on;
    case "arrowHit": return "arrowHit:" + e.on;
    case "enemyHurt": return "enemyHurt:" + e.kind;
    case "enemyWindup": return "enemyWindup:" + e.kind;
    case "land": return e.speed < 10 ? "land:soft" : "land:hard";
    case "splash": return e.size < 0.5 ? "splash:small" : "splash:big";
    case "lock": return "lock:" + (e.id >= 0);
    default: return e.type;
  }
}

const PENT = [74, 76, 78, 81, 83, 86, 88, 90, 93];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export function createSfx(r: Rig): Sfx {
  const ac = r.ac;
  let o: AudioNode = r.sfxBus;
  const T = () => ac.currentTime + 0.005;
  let streak = 0;
  let lastGlim = -10;
  let hbNext = 0;
  let wet = 0;
  const srcs: AudioScheduledSourceNode[] = [];

  // Persistent: sword charge hum and block-push grind.
  const humG = ac.createGain();
  humG.gain.value = 0;
  const humLp = ac.createBiquadFilter();
  humLp.type = "lowpass";
  humLp.frequency.value = 520;
  const hum = ac.createOscillator();
  hum.type = "triangle";
  hum.frequency.value = 110;
  hum.connect(humLp);
  humLp.connect(humG);
  humG.connect(o);
  hum.start();
  srcs.push(hum);
  const grindG = ac.createGain();
  grindG.gain.value = 0;
  const grindBp = ac.createBiquadFilter();
  grindBp.type = "bandpass";
  grindBp.frequency.value = 180;
  grindBp.Q.value = 2.2;
  const grindSrc = ac.createBufferSource();
  grindSrc.buffer = r.noise;
  grindSrc.loop = true;
  grindSrc.connect(grindBp);
  grindBp.connect(grindG);
  grindG.connect(o);
  grindSrc.start(0, 1.7);
  srcs.push(grindSrc);
  r.nodes.push(humG, humLp, grindG, grindBp);

  const whoosh = (t: number, dur: number, f1: number, f2: number, vol: number, pan = 0, prio: 1 | 2 | 3 = 2) =>
    noise(r, { t, dur, vol, out: o, f: f1, f2, q: 1.1, a: dur * 0.35, tc: dur * 0.25, pan, prio });
  const thud = (t: number, f: number, to: number, dur: number, vol: number, pan = 0, prio: 1 | 2 | 3 = 2) => {
    tone(r, { t, f, to, bend: dur * 0.6, dur, tc: dur / 5, vol, out: o, pan, prio });
    noise(r, { t, dur: dur * 0.5, vol: vol * 0.55, out: o, f: f * 5, kind: "lp", tc: dur / 9, pan, prio });
  };

  function step(surface: Surface, run: boolean, g = 1, pan = 0) {
    const t = T();
    const v = (run ? 1 : 0.7) * g;
    const k = rnd(0.9, 1.12);
    switch (surface) {
      case "grass":
        noise(r, { t, dur: 0.09, vol: 0.13 * v, out: o, f: 2200 * k, q: 0.8, tc: 0.022, pan });
        noise(r, { t, dur: 0.07, vol: 0.12 * v, out: o, f: 420, kind: "lp", tc: 0.02, pan });
        break;
      case "dirt":
        noise(r, { t, dur: 0.09, vol: 0.17 * v, out: o, f: 900 * k, kind: "lp", tc: 0.025, pan });
        tone(r, { t, f: 115 * k, to: 70, dur: 0.07, vol: 0.1 * v, out: o, pan });
        break;
      case "rock":
        noise(r, { t, dur: 0.06, vol: 0.13 * v, out: o, f: 1800 * k, kind: "hp", tc: 0.012, pan });
        tone(r, { t, f: 420 * k, to: 300, dur: 0.05, vol: 0.05 * v, out: o, pan });
        break;
      case "sand":
        noise(r, { t, dur: 0.18, vol: 0.11 * v, out: o, f: 1600 * k, kind: "lp", a: 0.03, tc: 0.05, pan });
        break;
      case "stone":
        noise(r, { t, dur: 0.08, vol: 0.14 * v, out: o, f: 1400 * k, q: 2, tc: 0.02, pan });
        tone(r, { t, f: 190 * k, to: 130, dur: 0.09, vol: 0.12 * v, out: o, pan });
        break;
      case "wood":
        tone(r, { t, f: 170 * k, to: 110, dur: 0.11, vol: 0.17 * v, out: o, pan });
        noise(r, { t, dur: 0.07, vol: 0.1 * v, out: o, f: 700, q: 2, tc: 0.02, pan });
        break;
      case "water":
        noise(r, { t, dur: 0.16, vol: 0.14 * v, out: o, f: 1300 * k, f2: 2300, q: 1, a: 0.01, tc: 0.05, pan });
        tone(r, { t: t + 0.02, f: 600 * k, to: 950, dur: 0.06, vol: 0.03 * v, out: o, pan });
        break;
      default:
        noise(r, { t, dur: 0.12, vol: 0.12 * v, out: o, f: 1400 * k, kind: "lp", a: 0.015, tc: 0.035, pan });
        noise(r, { t, dur: 0.06, vol: 0.05 * v, out: o, f: 3500, kind: "hp", tc: 0.015, pan });
    }
    if (wet > 0.4 && surface !== "water") noise(r, { t: t + 0.01, dur: 0.1, vol: 0.06 * wet * v, out: o, f: 2600, f2: 1800, q: 1, a: 0.01, tc: 0.03, pan });
  }

  function splash(size: number, g = 1, pan = 0) {
    const t = T();
    const s = clamp(size);
    noise(r, { t, dur: 0.35 + 0.3 * s, vol: (0.18 + 0.25 * s) * g, out: o, f: 1500, f2: 900, q: 0.8, a: 0.01, tc: 0.12, pan });
    noise(r, { t, dur: 0.25, vol: (0.12 + 0.2 * s) * g, out: o, f: 420, kind: "lp", tc: 0.08, pan });
    for (let i = 0; i < 3; i++) tone(r, { t: t + 0.05 + i * rnd(0.05, 0.1), f: rnd(450, 700), to: rnd(1000, 1400), dur: 0.05, vol: 0.05 * g, out: o, pan });
  }

  function enemyVoice(kind: EnemyKind, what: "alert" | "windup" | "hurt" | "die", g: number, pan: number) {
    const t = T();
    const v = g;
    if (kind === "brambling") {
      const vo = (dt: number, a: number, b: number, d: number, vol: number) =>
        vocal(r, { t: t + dt, f0: a, f0to: b, dur: d, f1: 900, f2: 2600, q: 6, vol: vol * v, out: o, pan, a: 0.01 });
      if (what === "alert") { vo(0, 560, 900, 0.12, 0.13); vo(0.16, 700, 1100, 0.14, 0.12); }
      else if (what === "windup") vo(0, 400, 820, 0.24, 0.13);
      else if (what === "hurt") vo(0, 950, 480, 0.16, 0.15);
      else {
        vo(0, 820, 190, 0.42, 0.15);
        noise(r, { t, dur: 0.3, vol: 0.12 * v, out: o, f: 2000, kind: "lp", tc: 0.1, pan });
      }
    } else if (kind === "mossback") {
      const vo = (a: number, b: number, d: number, vol: number, breath = 0.07) =>
        vocal(r, { t, f0: a, f0to: b, dur: d, f1: 420, f2: 900, q: 4, vol: vol * v, out: o, pan, a: 0.05, breath: breath * v });
      if (what === "alert") { vo(95, 70, 0.6, 0.22); thud(t, 80, 45, 0.3, 0.12 * v, pan); }
      else if (what === "windup") vo(68, 92, 0.35, 0.2);
      else if (what === "hurt") vo(115, 62, 0.3, 0.22);
      else { vo(92, 38, 0.9, 0.2); thud(t + 0.5, 90, 40, 0.5, 0.3 * v, pan); }
    } else if (kind === "wisp") {
      if (what === "alert") {
        tone(r, { t, f: 660, to: 990, dur: 0.4, a: 0.06, tc: 0.12, vol: 0.1 * v, out: o, pan, vib: [7, 14, 0] });
        bell(r, { t: t + 0.05, f: 1320, vol: 0.05 * v, out: o, decay: 0.5, pan });
      } else if (what === "windup") {
        tone(r, { t, f: 600, to: 1500, dur: 0.4, a: 0.1, sus: true, rel: 0.05, vol: 0.09 * v, out: o, pan, vib: [9, 22, 0] });
        noise(r, { t, dur: 0.32, vol: 0.06 * v, out: o, f: 3000, kind: "hp", a: 0.2, tc: 0.08, pan });
      } else if (what === "hurt") {
        bell(r, { t, f: 880, vol: 0.08 * v, out: o, decay: 0.3, pan });
        bell(r, { t, f: 933, vol: 0.07 * v, out: o, decay: 0.3, pan });
      } else {
        [1568, 1319, 1047, 784].forEach((f, i) => bell(r, { t: t + i * 0.09, f, vol: 0.08 * v, out: o, decay: 0.45, pan }));
        noise(r, { t, dur: 0.5, vol: 0.06 * v, out: o, f: 5000, kind: "hp", tc: 0.15, pan });
      }
    } else {
      const roar = (d: number, f0: number, f1: number, vol: number) => {
        vocal(r, { t, f0, f0to: f1, dur: d, f1: 320, f2: 720, q: 3, vol: vol * v, out: o, pan, a: 0.15, breath: 0.22 * v, prio: 3 });
        tone(r, { t, f: 46, to: 30, dur: d, a: 0.1, tc: d / 4, vol: 0.28 * v, out: o, pan, prio: 3 });
        noise(r, { t, dur: d, vol: 0.2 * v, out: o, f: 220, kind: "lp", a: 0.2, tc: d / 3, pan, prio: 3 });
      };
      if (what === "alert") roar(1.6, 52, 36, 0.36);
      else if (what === "windup") {
        vocal(r, { t, f0: 60, f0to: 44, dur: 0.6, f1: 300, f2: 700, q: 3, vol: 0.26 * v, out: o, pan, a: 0.2, prio: 3 });
        noise(r, { t, dur: 0.5, vol: 0.12 * v, out: o, f: 900, a: 0.3, tc: 0.15, pan, prio: 3 });
      } else if (what === "hurt") roar(0.55, 70, 50, 0.3);
      else roar(2.2, 58, 24, 0.38);
    }
  }

  function posGain(p: V3, ref = 12, max = 85): { g: number; pan: number } | null {
    const s = spat(r, p, ref, max);
    return s ? { g: s.g, pan: s.pan } : null;
  }

  function hit(e: Extract<GameEvent, { type: "hit" }>) {
    const sp = posGain(e.pos, 14);
    if (!sp) return;
    const t = T();
    const g = Math.max(0.55, sp.g);
    const pan = sp.pan;
    if (e.parried) {
      bell(r, { t, f: 1760, vol: 0.28, out: o, decay: 0.85, partials: [[1, 1], [2.01, 0.5], [3.02, 0.3]], pan, prio: 3 });
      noise(r, { t, dur: 0.12, vol: 0.3, out: o, f: 3000, kind: "hp", tc: 0.03, pan, prio: 3 });
      thud(t, 150, 70, 0.14, 0.2, pan, 3);
      return;
    }
    if (e.blocked) {
      thud(t, 140, 60, 0.22, 0.4 * g, pan, 3);
      tone(r, { t, f: 780, to: 700, dur: 0.25, tc: 0.06, vol: 0.06, out: o, pan });
      tone(r, { t, f: 1150, dur: 0.2, tc: 0.05, vol: 0.04, out: o, pan });
      return;
    }
    if (e.kind === "arrow") return;
    if (e.team === "player") {
      const dm = clamp(0.6 + e.damage / 6, 0.6, 1.4);
      noise(r, { t, dur: 0.1, vol: 0.28 * dm * g, out: o, f: 800, q: 0.9, tc: 0.025, pan, prio: 3 });
      tone(r, { t, f: 190, to: 100, dur: 0.14, tc: 0.04, vol: 0.28 * dm * g, out: o, pan, prio: 3 });
      bell(r, { t, f: 2800, vol: 0.05 * dm, out: o, decay: 0.2, pan });
      if (e.kind === "riposte") bell(r, { t: t + 0.03, f: 1320, vol: 0.12, out: o, decay: 0.6, pan });
      return;
    }
    if (e.kind === "slam") {
      thud(t, 70, 32, 0.7, 0.5 * g, pan, 3);
      noise(r, { t, dur: 0.5, vol: 0.3 * g, out: o, f: 300, kind: "lp", tc: 0.15, pan, prio: 3 });
    } else if (e.kind === "warden") {
      thud(t, 60, 28, 0.9, 0.55 * g, pan, 3);
      noise(r, { t, dur: 0.6, vol: 0.2 * g, out: o, f: 1200, f2: 300, q: 0.6, tc: 0.2, pan, prio: 3 });
    } else if (e.kind === "bolt") {
      tone(r, { t, f: 900, to: 280, dur: 0.25, tc: 0.07, vol: 0.14 * g, out: o, type: "sawtooth", lp: 1800, pan });
      bell(r, { t, f: 1480, vol: 0.06 * g, out: o, decay: 0.4, pan });
    } else {
      whoosh(t, 0.12, 1000, 2000, 0.15 * g, pan);
      noise(r, { t: t + 0.04, dur: 0.08, vol: 0.18 * g, out: o, f: 900, tc: 0.02, pan });
    }
  }

  function arrowHit(e: Extract<GameEvent, { type: "arrowHit" }>) {
    const sp = posGain(e.pos, 14);
    if (!sp) return;
    const t = T();
    const g = Math.max(0.5, sp.g);
    if (e.on === "enemy") thud(t, 200, 110, 0.14, 0.3 * g, sp.pan);
    else if (e.on === "prop") {
      tone(r, { t, f: 320, to: 200, dur: 0.09, tc: 0.025, vol: 0.2 * g, out: o, pan: sp.pan });
      noise(r, { t, dur: 0.06, vol: 0.14 * g, out: o, f: 1100, q: 2, tc: 0.015, pan: sp.pan });
    } else if (e.on === "ground") thud(t, 130, 80, 0.1, 0.2 * g, sp.pan);
    else {
      tone(r, { t, f: 700, to: 1400, dur: 0.08, tc: 0.03, vol: 0.1 * g, out: o, pan: sp.pan });
      noise(r, { t, dur: 0.14, vol: 0.12 * g, out: o, f: 1800, q: 0.9, tc: 0.04, pan: sp.pan });
    }
  }

  const handle = (e: GameEvent): void => {
    try {
      const t = T();
      switch (e.type) {
        case "footstep": {
          const sp = posGain(e.pos, 20, 40);
          step(e.surface, e.run, sp ? 1 : 0.5, 0);
          break;
        }
        case "jump":
          whoosh(t, 0.15, 350, 800, 0.1);
          noise(r, { t, dur: 0.09, vol: 0.06, out: o, f: 1200, q: 0.7, tc: 0.03 });
          break;
        case "land": {
          const s = clamp(e.speed / 18);
          thud(t, 110, 45, 0.25, 0.12 + 0.35 * s);
          step(e.surface, true, 0.5 + 0.5 * s);
          break;
        }
        case "fallDamage":
          thud(t, 90, 40, 0.38, 0.5, 0, 3);
          vocal(r, { t, f0: 180, f0to: 130, dur: 0.22, f1: 500, f2: 1000, q: 4, vol: 0.14, out: o, prio: 3 });
          break;
        case "climb":
          if (e.on) noise(r, { t, dur: 0.05, vol: 0.12, out: o, f: 2500, kind: "hp", tc: 0.012 });
          break;
        case "glide":
          if (e.on) {
            whoosh(t, 0.45, 300, 1500, 0.3);
            noise(r, { t, dur: 0.12, vol: 0.28, out: o, f: 500, kind: "lp", a: 0.01, tc: 0.04 });
          } else whoosh(t, 0.3, 1200, 300, 0.14);
          break;
        case "swim":
          if (e.on) splash(0.6);
          else noise(r, { t, dur: 0.2, vol: 0.1, out: o, f: 1200, f2: 600, tc: 0.07 });
          break;
        case "splash": {
          const sp = posGain(e.pos, 18);
          if (sp) splash(e.size, Math.max(0.4, sp.g), sp.pan);
          break;
        }
        case "staminaOut":
          noise(r, { t, dur: 0.5, vol: 0.1, out: o, f: 1200, f2: 500, kind: "lp", a: 0.12, tc: 0.15 });
          break;
        case "dodge":
          noise(r, { t, dur: 0.22, vol: 0.14, out: o, f: 1200, kind: "hp", a: 0.05, tc: 0.07 });
          noise(r, { t: t + 0.2, dur: 0.12, vol: 0.1, out: o, f: 600, q: 0.8, tc: 0.04 });
          break;
        case "push":
          try { grindG.gain.setTargetAtTime(e.on ? 0.3 : 0, t, e.on ? 0.15 : 0.12); } catch { /* swallow */ }
          break;
        case "blockMove": {
          const sp = posGain(e.pos, 20);
          if (sp) {
            noise(r, { t, dur: 0.9, vol: 0.3 * Math.max(0.4, sp.g), out: o, f: 180, q: 2, a: 0.08, tc: 0.35, pan: sp.pan });
            tone(r, { t, f: 55, to: 48, dur: 0.9, a: 0.05, tc: 0.35, vol: 0.14, out: o, pan: sp.pan });
          }
          break;
        }
        case "plate": {
          tone(r, { t, f: e.on ? 900 : 700, dur: 0.05, tc: 0.012, vol: 0.12, out: o });
          thud(t, e.on ? 160 : 120, 70, 0.14, e.on ? 0.22 : 0.16);
          break;
        }
        case "swing": {
          const c = e.combo;
          const dur = c === 3 ? 0.26 : 0.17;
          const f1 = c === 1 ? 900 : c === 2 ? 700 : 800;
          whoosh(t, dur, f1, c === 3 ? 3400 : 2600, c === 3 ? 0.26 : 0.2, c === 2 ? 0.15 : -0.15);
          tone(r, { t, f: 3100, to: 2400, dur: 0.08, tc: 0.02, vol: 0.02, out: o });
          break;
        }
        case "chargeReady":
          bell(r, { t, f: 1320, vol: 0.14, out: o, decay: 0.6 });
          tone(r, { t, f: 660, to: 1320, dur: 0.2, tc: 0.06, vol: 0.06, out: o });
          break;
        case "spin":
          whoosh(t, 0.28, 700, 2400, 0.22, -0.6);
          whoosh(t + 0.12, 0.28, 800, 2600, 0.22, 0.6);
          whoosh(t + 0.26, 0.28, 700, 2200, 0.18, -0.3);
          break;
        case "shield":
          noise(r, { t, dur: 0.12, vol: e.on ? 0.1 : 0.05, out: o, f: 900, q: 0.8, tc: 0.03 });
          if (e.on) tone(r, { t, f: 200, to: 150, dur: 0.08, tc: 0.02, vol: 0.06, out: o });
          break;
        case "bowDraw":
          tone(r, { t, f: 90, to: 150, dur: 0.5, a: 0.1, tc: 0.25, vol: 0.05, out: o, type: "sawtooth", lp: 420, vib: [14, 6, 0] });
          noise(r, { t, dur: 0.5, vol: 0.08, out: o, f: 300, f2: 520, q: 2, a: 0.1, tc: 0.2 });
          break;
        case "arrowFired":
          pluck(r, { t, midi: 40, vol: 0.3, out: o, kind: "lute", dur: 0.3, prio: 2 });
          whoosh(t, 0.2, 1500, 3500, 0.15);
          tone(r, { t, f: 220, to: 120, dur: 0.06, tc: 0.015, vol: 0.12, out: o });
          break;
        case "lock":
          if (e.id >= 0) {
            tone(r, { t, f: 1400, dur: 0.05, tc: 0.012, vol: 0.08, out: o });
            tone(r, { t: t + 0.04, f: 1900, dur: 0.06, tc: 0.015, vol: 0.06, out: o });
          } else tone(r, { t, f: 900, to: 600, dur: 0.08, tc: 0.02, vol: 0.05, out: o });
          break;
        case "hit":
          hit(e);
          break;
        case "arrowHit":
          arrowHit(e);
          break;
        case "propHit": {
          const sp = posGain(e.pos, 14);
          if (!sp) break;
          const g = Math.max(0.5, sp.g);
          noise(r, { t, dur: 0.15, vol: 0.25 * g, out: o, f: 1500, q: 0.9, tc: 0.04, pan: sp.pan });
          tone(r, { t, f: 280, to: 150, dur: 0.1, tc: 0.03, vol: 0.18 * g, out: o, pan: sp.pan });
          for (let i = 0; i < 4; i++) noise(r, { t: t + 0.03 + i * rnd(0.02, 0.05), dur: 0.05, vol: 0.08 * g, out: o, f: rnd(3500, 5500), kind: "hp", tc: 0.012, pan: sp.pan });
          break;
        }
        case "hurt":
          thud(t, 120, 55, 0.2, 0.3, 0, 3);
          vocal(r, { t, f0: 330, f0to: 250, dur: 0.22, f1: 700, f2: 1500, q: 5, vol: 0.12, out: o, prio: 3 });
          break;
        case "heal":
          bell(r, { t, f: 880, vol: 0.12, out: o, decay: 0.7 });
          bell(r, { t: t + 0.1, f: 1175, vol: 0.12, out: o, decay: 0.8 });
          break;
        case "died":
          tone(r, { t, f: 220, to: 70, dur: 1.4, a: 0.05, tc: 0.5, vol: 0.2, out: o, prio: 3 });
          noise(r, { t, dur: 1, vol: 0.2, out: o, f: 300, kind: "lp", tc: 0.4, prio: 3 });
          vocal(r, { t, f0: 250, f0to: 120, dur: 0.5, f1: 600, f2: 1300, q: 4, vol: 0.12, out: o, prio: 3 });
          break;
        case "respawned":
          [74, 81, 86].forEach((m, i) => bell(r, { t: t + i * 0.14, f: hz(m), vol: 0.09, out: o, decay: 0.8 }));
          break;
        case "drowned":
          for (let i = 0; i < 6; i++) tone(r, { t: t + i * 0.12, f: rnd(400, 600), to: rnd(900, 1300), dur: 0.07, vol: 0.07, out: o, prio: 3 });
          noise(r, { t, dur: 0.8, vol: 0.14, out: o, f: 900, f2: 300, tc: 0.3, prio: 3 });
          break;
        case "enemyAlert":
        case "enemyWindup":
        case "enemyHurt":
        case "enemyDied": {
          const sp = posGain(e.pos, e.kind === "warden" ? 40 : 14, e.kind === "warden" ? 220 : 85);
          if (!sp) break;
          const what = e.type === "enemyAlert" ? "alert" : e.type === "enemyWindup" ? "windup" : e.type === "enemyHurt" ? "hurt" : "die";
          enemyVoice(e.kind, what, Math.max(e.kind === "warden" ? 0.6 : 0.3, sp.g), sp.pan);
          break;
        }
        case "bossWake": {
          enemyVoice("warden", "alert", 1, 0);
          [0.6, 1.1, 1.6].forEach((d) => thud(t + d, 62, 34, 0.5, 0.4, 0, 3));
          break;
        }
        case "bossPhase": {
          enemyVoice("warden", "alert", 0.9 + e.phase * 0.05, 0);
          thud(t, 70, 30, 0.7, 0.45, 0, 3);
          break;
        }
        case "bossDefeated":
          thud(t, 70, 28, 2.5, 0.42, 0, 3);
          noise(r, { t, dur: 2, vol: 0.2, out: o, f: 400, f2: 80, kind: "lp", tc: 0.7, prio: 3 });
          enemyVoice("warden", "die", 1, 0);
          break;
        case "pickup":
          switch (e.kind) {
            case "glimmer": {
              streak = t - lastGlim < 1.4 ? Math.min(streak + 1, PENT.length - 1) : 0;
              lastGlim = t;
              const f = hz(PENT[streak]);
              bell(r, { t, f, vol: 0.13, out: o, decay: 0.55, partials: [[1, 1], [2, 0.3], [3.01, 0.12]] });
              break;
            }
            case "shard":
              bell(r, { t, f: hz(86), vol: 0.13, out: o, decay: 1.2 });
              bell(r, { t: t + 0.08, f: hz(91), vol: 0.12, out: o, decay: 1.2 });
              noise(r, { t, dur: 0.4, vol: 0.04, out: o, f: 6000, kind: "hp", a: 0.05, tc: 0.12 });
              break;
            case "heart":
              [67, 71, 74].forEach((m, i) => bell(r, { t: t + i * 0.12, f: hz(m + 12), vol: 0.1, out: o, decay: 1 }));
              tone(r, { t, f: 294, dur: 0.8, a: 0.2, sus: true, rel: 0.4, vol: 0.08, out: o });
              break;
            case "arrows":
              for (let i = 0; i < 3; i++) {
                tone(r, { t: t + i * 0.06, f: 600, to: 400, dur: 0.04, tc: 0.01, vol: 0.12, out: o });
                noise(r, { t: t + i * 0.06, dur: 0.04, vol: 0.08, out: o, f: 1500, q: 2, tc: 0.01 });
              }
              break;
            default:
              [69, 73, 76, 81].forEach((m, i) => {
                bell(r, { t: t + i * 0.13, f: hz(m + 12), vol: 0.12, out: o, decay: 0.9 });
                pluck(r, { t: t + i * 0.13, midi: m, vol: 0.16, out: o, kind: "harp", prio: 2 });
              });
          }
          break;
        case "areaEnter":
          if (e.first) [74, 78, 81, 86].forEach((m, i) => bell(r, { t: t + i * 0.14, f: hz(m + 12), vol: 0.08, out: o, decay: 1.4 }));
          else bell(r, { t, f: hz(81 + 12), vol: 0.07, out: o, decay: 1.4 });
          break;
        case "trialStart":
          tone(r, { t, f: 110, to: 165, dur: 1.2, a: 0.3, sus: true, rel: 0.4, vol: 0.12, out: o, type: "sawtooth", lp: 500 });
          tone(r, { t, f: 1700, dur: 0.05, tc: 0.012, vol: 0.12, out: o });
          break;
        case "trialProgress":
          bell(r, { t, f: hz(74 + Math.round((7 * e.value) / Math.max(1, e.total)) + 12), vol: 0.1, out: o, decay: 0.7 });
          break;
        case "trialFail":
          tone(r, { t, f: 220, to: 110, dur: 0.6, tc: 0.2, vol: 0.14, out: o, type: "sawtooth", lp: 800 });
          tone(r, { t, f: 233, to: 116, dur: 0.6, tc: 0.2, vol: 0.1, out: o, type: "sawtooth", lp: 800 });
          break;
        case "trialDone":
          [74, 78, 81, 86].forEach((m, i) => bell(r, { t: t + i * 0.1, f: hz(m + 12), vol: 0.1, out: o, decay: 0.9 }));
          break;
        case "beaconLit": {
          const sp = posGain(e.pos, 40, 400);
          const g = sp ? Math.max(0.35, sp.g) : 0.35;
          const pan = sp ? sp.pan : 0;
          noise(r, { t, dur: 1.4, vol: 0.4 * g, out: o, f: 500, f2: 2200, kind: "lp", a: 0.5, tc: 0.6, pan, prio: 3 });
          thud(t, 80, 40, 1.2, 0.35 * g, pan, 3);
          for (let i = 0; i < 6; i++) noise(r, { t: t + rnd(0.1, 2), dur: 0.04, vol: 0.1 * g, out: o, f: 3000, kind: "hp", tc: 0.01, pan });
          break;
        }
        case "barrierDown":
          noise(r, { t, dur: 3, vol: 0.5, out: o, f: 250, kind: "lp", a: 0.4, tc: 1.2, prio: 3 });
          tone(r, { t, f: 50, to: 30, dur: 2.4, a: 0.2, tc: 0.9, vol: 0.3, out: o, prio: 3 });
          for (let i = 0; i < 8; i++) noise(r, { t: t + rnd(0.2, 2.4), dur: 0.12, vol: 0.14, out: o, f: rnd(500, 1200), q: 1, tc: 0.03, prio: 3 });
          break;
        case "saved":
          bell(r, { t, f: hz(98), vol: 0.04, out: o, decay: 0.3 });
          break;
        case "read":
          noise(r, { t, dur: 0.25, vol: 0.1, out: o, f: 2500, kind: "hp", a: 0.05, tc: 0.08 });
          bell(r, { t: t + 0.1, f: hz(81), vol: 0.05, out: o, decay: 0.8 });
          break;
        case "dusk":
          [0, 0.7].forEach((d, i) => tone(r, { t: t + d, f: i ? 300 : 330, to: i ? 280 : 300, dur: 0.5, a: 0.06, tc: 0.15, vol: 0.07, out: o, pan: 0.5, prio: 1 }));
          break;
        default:
          break;
      }
    } catch { /* audio must never throw into the game loop */ }
  };

  const handleTrimmed = (e: GameEvent): void => {
    const k = TRIM[trimKey(e)] ?? 1;
    if (Math.abs(k - 1) < 0.02) return handle(e);
    try {
      const g = ac.createGain();
      g.gain.value = k;
      g.connect(r.sfxBus);
      o = g;
      handle(e);
    } catch { /* swallow */ } finally {
      o = r.sfxBus;
    }
  };

  return {
    handle: handleTrimmed,
    ui(cue) {
      try {
        const t = T();
        switch (cue) {
          case "move":
            tone(r, { t, f: 880, dur: 0.07, tc: 0.02, vol: 0.08, out: o });
            tone(r, { t, f: 1320, dur: 0.05, tc: 0.015, vol: 0.03, out: o });
            break;
          case "ok":
            tone(r, { t, f: 660, dur: 0.12, tc: 0.04, vol: 0.1, out: o });
            tone(r, { t: t + 0.07, f: 990, dur: 0.18, tc: 0.06, vol: 0.1, out: o });
            break;
          case "back":
            tone(r, { t, f: 700, dur: 0.1, tc: 0.03, vol: 0.09, out: o });
            tone(r, { t: t + 0.06, f: 520, dur: 0.14, tc: 0.05, vol: 0.09, out: o });
            break;
          case "open":
            bell(r, { t, f: hz(81), vol: 0.08, out: o, decay: 0.8 });
            noise(r, { t, dur: 0.25, vol: 0.06, out: o, f: 2200, kind: "hp", a: 0.08, tc: 0.08 });
            break;
          case "close":
            noise(r, { t, dur: 0.2, vol: 0.05, out: o, f: 2200, kind: "hp", a: 0.02, tc: 0.06 });
            bell(r, { t: t + 0.04, f: hz(74), vol: 0.07, out: o, decay: 0.6 });
            break;
          case "error":
            tone(r, { t, f: 150, dur: 0.12, tc: 0.04, vol: 0.09, out: o, type: "sawtooth", lp: 600 });
            tone(r, { t: t + 0.13, f: 130, dur: 0.16, tc: 0.05, vol: 0.09, out: o, type: "sawtooth", lp: 600 });
            break;
        }
      } catch { /* swallow */ }
    },
    update(now, f) {
      try {
        wet = f.wet;
        const ch = clamp(f.charging);
        humG.gain.setTargetAtTime(ch > 0.05 ? 0.02 + 0.05 * ch : 0, now, 0.08);
        hum.frequency.setTargetAtTime(110 + 140 * ch, now, 0.1);
        const low = f.hp > 0 && (f.hp <= 4 || f.hp / Math.max(1, f.maxHp) <= 0.25);
        if (!low) {
          hbNext = 0;
          return;
        }
        if (hbNext === 0) hbNext = now;
        if (now >= hbNext - 0.14) {
          const t = Math.max(now, hbNext);
          tone(r, { t, f: 62, to: 44, dur: 0.22, tc: 0.07, vol: 0.4, out: o, prio: 3 });
          tone(r, { t: t + 0.19, f: 56, to: 42, dur: 0.2, tc: 0.06, vol: 0.28, out: o, prio: 3 });
          const k = clamp(1 - f.hp / Math.max(4, f.maxHp * 0.25));
          hbNext = t + 1.05 - 0.4 * k;
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
