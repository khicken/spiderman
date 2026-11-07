// HOOPS fx: particles and in-world indicators. One particle pool (one draw call) plus one decal draw call.
// Events map to bursts: swish glints, three-point splash, dunk shockwave + sweat + photographer flashes, block and steal
// streaks, buzzer-beater pyro and confetti, on-fire embers and floor trails, camera flashes twinkling in the stands.
// Owner: audio-fx.
import * as THREE from "three";
import type { Fx, FxKind, GameEvent, Quality, SimView, TeamSide, V3 } from "./contracts";
import { COURT, QUALITY } from "./contracts";
import { createMarks } from "./fx-marks";
import { K, createPool, spawnRec } from "./fx-pool";

export type FxPlus = Fx & {
  /** Where the seating bowl is, for crowd camera flashes. Distances in meters outward from the court lines. */
  setBowl(b: Partial<Bowl>): void;
  /** Confetti in two colors (hex), for menus or celebrations. */
  confetti(colorA: string, colorB: string, seconds: number): void;
  readonly count: number;
};

export interface Bowl {
  gap: number; // court line to the first row (m)
  depth: number; // how far back the seats go (m)
  rise: number; // seat height gain per meter back
  base: number; // first row height (m)
  ceiling: number; // confetti drop height (m)
}

const POOL_MAX = 2048;
const MAX_EMIT = 24;
const E = { flashStands: 0, flashBaseline: 1, confettiCeil: 2, cannon: 3, fountain: 4, fire: 5 } as const;

export function createFx(scene: THREE.Scene, quality: Quality): FxPlus {
  const pool = createPool(scene, POOL_MAX);
  pool.setCap(QUALITY[quality].particles);
  const marks = createMarks(scene);
  const S = spawnRec();
  const bowl: Bowl = { gap: 2.6, depth: 26, rise: 0.52, base: 0.8, ceiling: 14 };
  let q = quality;
  let time = 0;
  let view: SimView | null = null;
  let lastMake = -99;
  let lastMakeSide: 1 | -1 = 1;
  let ambientAcc = 0;
  let lastDt = 1 / 60;
  const trailDist = new Float32Array(10);
  const emberAcc = new Float32Array(10);

  // emitters (struct of arrays)
  const eType = new Int8Array(MAX_EMIT).fill(-1);
  const eX = new Float32Array(MAX_EMIT), eY = new Float32Array(MAX_EMIT), eZ = new Float32Array(MAX_EMIT);
  const eRate = new Float32Array(MAX_EMIT), eUntil = new Float32Array(MAX_EMIT), eAcc = new Float32Array(MAX_EMIT);
  const eParam = new Float32Array(MAX_EMIT);
  const eCol = new Float32Array(MAX_EMIT * 6);

  // team colors per side (rgb x2), linear
  const teamCol = new Float32Array(12);
  const tmpC = new THREE.Color();
  let teamKey = "";
  const camPos = new THREE.Vector3();

  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const scaleQ = () => (q === "low" ? 0.45 : q === "medium" ? 0.7 : 1);

  function hexTo(hex: string, out: Float32Array, o: number) {
    tmpC.set(hex);
    out[o] = tmpC.r;
    out[o + 1] = tmpC.g;
    out[o + 2] = tmpC.b;
  }

  function syncTeams(v: SimView) {
    const a = v.teams[0].data, b = v.teams[1].data;
    const key = a.abbr + b.abbr;
    if (key === teamKey) return;
    teamKey = key;
    hexTo(a.primary, teamCol, 0);
    hexTo(a.secondary, teamCol, 3);
    hexTo(b.primary, teamCol, 6);
    hexTo(b.secondary, teamCol, 9);
  }

  function reset() {
    S.vx = S.vy = S.vz = 0;
    S.grow = 0;
    S.drag = 0;
    S.grav = 0;
    S.stretch = 0;
    S.spin = 0;
    S.flutter = 0;
    S.bounce = 0.3;
    S.alpha = 1;
    S.add = 1;
  }

  // --- primitive bursts -------------------------------------------------------------------------------------------
  function flash(x: number, y: number, z: number, s: number) {
    reset();
    S.x = x; S.y = y; S.z = z;
    S.kind = K.flash;
    S.size = 0.42 * s;
    S.life = rnd(0.12, 0.2);
    S.r = 7; S.g = 7; S.b = 8;
    pool.spawn(S);
  }

  function glow(x: number, y: number, z: number, size: number, life: number, r: number, g: number, b: number, alpha = 1) {
    reset();
    S.x = x; S.y = y; S.z = z;
    S.kind = K.glow;
    S.size = size;
    S.life = life;
    S.r = r; S.g = g; S.b = b;
    S.alpha = alpha;
    pool.spawn(S);
  }

  function sparks(x: number, y: number, z: number, n: number, speed: number, r: number, g: number, b: number, up = 0.4, life = 0.7) {
    n = Math.round(n * scaleQ());
    for (let i = 0; i < n; i++) {
      reset();
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(rnd(-1, 1));
      const sp = speed * rnd(0.35, 1);
      S.x = x; S.y = y; S.z = z;
      S.vx = Math.sin(ph) * Math.cos(th) * sp;
      S.vy = Math.cos(ph) * sp + up * speed;
      S.vz = Math.sin(ph) * Math.sin(th) * sp;
      S.kind = K.spark;
      S.size = rnd(0.008, 0.016);
      S.life = life * rnd(0.5, 1.1);
      S.r = r; S.g = g; S.b = b;
      S.drag = 1.6;
      S.grav = 6;
      S.stretch = 0.035;
      S.bounce = 0.35;
      pool.spawn(S);
    }
  }

  function glints(x: number, y: number, z: number, n: number, rad: number, r: number, g: number, b: number) {
    n = Math.round(n * scaleQ());
    for (let i = 0; i < n; i++) {
      reset();
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * rad;
      S.x = x + Math.cos(a) * d;
      S.y = y + rnd(-0.15, 0.25);
      S.z = z + Math.sin(a) * d;
      S.vx = Math.cos(a) * 0.3;
      S.vy = rnd(-0.9, -0.2);
      S.vz = Math.sin(a) * 0.3;
      S.kind = K.glint;
      S.size = rnd(0.035, 0.075);
      S.life = rnd(0.3, 0.65);
      S.r = r; S.g = g; S.b = b;
      S.drag = 2;
      pool.spawn(S);
    }
  }

  function ring(x: number, y: number, z: number, grow: number, life: number, r: number, g: number, b: number, alpha = 1) {
    reset();
    S.x = x; S.y = y + 0.015; S.z = z;
    S.kind = K.ring;
    S.size = 0.25;
    S.grow = grow;
    S.life = life;
    S.r = r; S.g = g; S.b = b;
    S.alpha = alpha;
    pool.spawn(S);
  }

  function drops(x: number, y: number, z: number, n: number, speed: number, r: number, g: number, b: number, add: number, down = 0) {
    n = Math.round(n * scaleQ());
    for (let i = 0; i < n; i++) {
      reset();
      const a = Math.random() * Math.PI * 2;
      const sp = speed * rnd(0.4, 1);
      S.x = x + rnd(-0.06, 0.06); S.y = y; S.z = z + rnd(-0.06, 0.06);
      S.vx = Math.cos(a) * sp;
      S.vy = rnd(0.2, 1) * speed * (1 - down) - down * speed * rnd(0.3, 1);
      S.vz = Math.sin(a) * sp;
      S.kind = K.drop;
      S.size = rnd(0.008, 0.015);
      S.life = rnd(0.5, 0.9);
      S.r = r; S.g = g; S.b = b;
      S.add = add;
      S.alpha = 0.9;
      S.drag = 0.6;
      S.grav = 9.8;
      S.stretch = 0.03;
      S.bounce = 0;
      pool.spawn(S);
    }
  }

  function dust(x: number, z: number, n: number) {
    n = Math.round(n * scaleQ());
    for (let i = 0; i < n; i++) {
      reset();
      const a = Math.random() * Math.PI * 2;
      S.x = x + Math.cos(a) * 0.15; S.y = 0.05; S.z = z + Math.sin(a) * 0.15;
      S.vx = Math.cos(a) * rnd(0.4, 1.2);
      S.vy = rnd(0.05, 0.35);
      S.vz = Math.sin(a) * rnd(0.4, 1.2);
      S.kind = K.dust;
      S.size = rnd(0.08, 0.16);
      S.grow = 0.5;
      S.life = rnd(0.6, 1.1);
      S.r = 0.78; S.g = 0.72; S.b = 0.64;
      S.add = 0;
      S.alpha = 0.45;
      S.drag = 3;
      pool.spawn(S);
    }
  }

  function confettiPiece(x: number, y: number, z: number, vx: number, vy: number, vz: number, side: number) {
    reset();
    S.x = x; S.y = y; S.z = z;
    S.vx = vx; S.vy = vy; S.vz = vz;
    S.kind = K.confetti;
    S.size = rnd(0.075, 0.11);
    S.life = rnd(11, 15);
    const pick = Math.random();
    if (pick < 0.12) {
      // metallic gold
      S.r = 1.0; S.g = 0.72; S.b = 0.25;
    } else if (pick < 0.24) {
      S.r = S.g = S.b = 0.92;
    } else {
      const o = side * 6 + (pick < 0.62 ? 0 : 3);
      S.r = teamCol[o]; S.g = teamCol[o + 1]; S.b = teamCol[o + 2];
    }
    S.add = 0;
    S.drag = 1.7;
    S.grav = 3.2;
    S.flutter = rnd(1.5, 3.2);
    S.spin = rnd(4, 11) * (Math.random() < 0.5 ? -1 : 1);
    pool.spawn(S);
  }

  /** A random seat in the bowl (far side and baselines mostly, the near side rarely). */
  function seat(out: THREE.Vector3) {
    const d = Math.pow(Math.random(), 0.8) * bowl.depth;
    const y = bowl.base + d * bowl.rise;
    const pick = Math.random();
    if (pick < 0.5) out.set(rnd(-COURT.halfL - 3, COURT.halfL + 3), y, COURT.halfW + COURT.apron + bowl.gap + d);
    else if (pick < 0.88) {
      const s = Math.random() < 0.5 ? -1 : 1;
      out.set(s * (COURT.halfL + COURT.apron + bowl.gap + 1 + d), y, rnd(-COURT.halfW - 6, COURT.halfW + 6));
    } else out.set(rnd(-COURT.halfL, COURT.halfL), y + 0.5, -(COURT.halfW + COURT.apron + bowl.gap + 3 + d));
    return out;
  }
  const seatV = new THREE.Vector3();

  function standFlash(s = 1) {
    seat(seatV);
    // flashes far from the camera need more size to read
    const d = seatV.distanceTo(camPos);
    flash(seatV.x, seatV.y, seatV.z, s * (0.6 + d * 0.025));
  }

  function baselineFlash(side: number) {
    const z = (Math.random() < 0.5 ? -1 : 1) * rnd(1.3, 4.8);
    flash(side * (COURT.halfL + rnd(0.8, 1.8)), rnd(0.4, 1.0), z, 0.7);
  }

  function emitter(type: number, x: number, y: number, z: number, rate: number, seconds: number, param = 0) {
    let slot = -1;
    for (let i = 0; i < MAX_EMIT; i++) if (eType[i] < 0) {
      slot = i;
      break;
    }
    if (slot < 0) return -1;
    eType[slot] = type;
    eX[slot] = x; eY[slot] = y; eZ[slot] = z;
    eRate[slot] = rate * scaleQ();
    eUntil[slot] = time + seconds;
    eAcc[slot] = 0;
    eParam[slot] = param;
    return slot;
  }

  function celebrate(side: TeamSide, big: boolean) {
    // confetti may take about 55% of the pool; it lives long, so rate = budget / seconds
    const cap = QUALITY[q].particles;
    if (big) {
      const per = (cap * 0.42) / 4 / 4.5;
      for (let i = 0; i < 4; i++) emitter(E.confettiCeil, rnd(-8, 8), bowl.ceiling, rnd(-3, 3), per / scaleQ(), 4.5, side);
      for (let k = 0; k < 2; k++) emitter(E.cannon, (k ? 1 : -1) * (COURT.halfL + 1), 1.2, 0, (cap * 0.13) / 2 / 1.4 / scaleQ(), 1.4, side);
    }
    for (let k = 0; k < 4; k++) emitter(E.fountain, (k & 1 ? 1 : -1) * COURT.halfL, 0.1, (k & 2 ? 1 : -1) * (COURT.halfW + 0.6), 70, 2.6, side);
    emitter(E.flashStands, 0, 0, 0, 30, 4);
  }

  function basket(side: number, out: THREE.Vector3) {
    return out.set(side * COURT.rimX, COURT.rimHeight, 0);
  }
  const bv = new THREE.Vector3();

  // --- public kinds -----------------------------------------------------------------------------------------------
  function emit(kind: FxKind, at: V3, strength = 1) {
    const s = strength;
    switch (kind) {
      case "swish":
        glints(at.x, at.y - 0.25, at.z, 10 + 8 * s, 0.22, 3, 2.8, 2.2);
        glow(at.x, at.y - 0.2, at.z, 0.6, 0.25, 1.2, 1.0, 0.7, 0.6);
        break;
      case "splash":
        drops(at.x, at.y - 0.4, at.z, 26 * s, 2.4, 0.6, 1.8, 2.6, 0.75, 0.5);
        glints(at.x, at.y - 0.3, at.z, 14, 0.35, 1.2, 2.6, 3.2);
        break;
      case "rimHit":
        if (s > 0.45) sparks(at.x, at.y, at.z, 3 + 5 * s, 2.2 * s, 2.4, 2.2, 2.0, 0.2, 0.25);
        break;
      case "dunk":
        sparks(at.x, at.y, at.z, 30 * s, 5.5, 4, 2.2, 0.8, 0.1, 0.8);
        glints(at.x, at.y - 0.1, at.z, 12, 0.4, 3, 2.6, 1.8);
        ring(at.x, 0, at.z, 9 * s, 0.5, 2.2, 1.6, 1.0, 0.9);
        ring(at.x, 0, at.z, 5 * s, 0.7, 1.0, 0.8, 0.6, 0.5);
        glow(at.x, at.y, at.z, 1.4, 0.18, 2.5, 2.0, 1.4, 0.8);
        dust(at.x - Math.sign(at.x) * 0.4, at.z, 8);
        break;
      case "block":
        sparks(at.x, at.y, at.z, 22 * s, 5, 3, 3, 3.2, 0, 0.45);
        glow(at.x, at.y, at.z, 0.9, 0.15, 2.5, 2.5, 2.8, 0.9);
        ring(at.x, 0, at.z, 6, 0.4, 1.8, 1.8, 2.0, 0.6);
        break;
      case "steal":
        sparks(at.x, at.y, at.z, 14 * s, 3.5, 0.8, 2.4, 3.2, 0.1, 0.4);
        glow(at.x, at.y, at.z, 0.6, 0.15, 0.6, 1.8, 2.4, 0.8);
        break;
      case "sweat":
        drops(at.x, at.y, at.z, 12 * s, 2.6, 0.85, 0.92, 1.0, 0.25);
        break;
      case "confetti":
        celebrate(at.x >= 0 ? 0 : 1, true);
        break;
      case "flashes":
        emitter(E.flashStands, 0, 0, 0, 12 + 30 * s, 1.5 + s);
        break;
      case "fire":
        for (let i = 0; i < 18 * s; i++) emberAt(at.x, at.z, at.y);
        break;
      case "perfect":
        glints(at.x, at.y, at.z, 14, 0.3, 0.6, 3.2, 1.8);
        sparks(at.x, at.y, at.z, 12, 2.2, 0.5, 3, 1.6, 0.6, 0.45);
        glow(at.x, at.y, at.z, 0.8, 0.22, 0.4, 2.2, 1.2, 0.9);
        break;
      case "ankleBreak":
        dust(at.x, at.z, 14);
        ring(at.x, 0, at.z, 5, 0.45, 2.6, 1.4, 0.5, 0.8);
        break;
      case "andOne":
        sparks(at.x, at.y, at.z, 20 * s, 3.5, 4, 3, 0.8, 0.5, 0.7);
        glints(at.x, at.y, at.z, 12, 0.5, 3.5, 2.8, 1);
        break;
      case "buzzer":
        celebrate(at.x >= 0 ? 0 : 1, s > 0.5);
        break;
    }
  }

  function emberAt(x: number, z: number, h: number) {
    reset();
    const a = Math.random() * Math.PI * 2;
    const r = rnd(0.1, 0.35);
    S.x = x + Math.cos(a) * r;
    S.y = rnd(0.1, Math.max(0.3, h));
    S.z = z + Math.sin(a) * r;
    S.vx = rnd(-0.2, 0.2);
    S.vy = rnd(0.6, 1.5);
    S.vz = rnd(-0.2, 0.2);
    S.kind = K.ember;
    S.size = rnd(0.05, 0.1);
    S.life = rnd(0.5, 1.0);
    S.r = 6; S.g = 2.2; S.b = 0.5;
    S.drag = 1.2;
    S.grav = -0.6;
    pool.spawn(S);
  }

  function handleOne(e: GameEvent, v: SimView) {
    switch (e.type) {
      case "make": {
        lastMake = time;
        lastMakeSide = e.side;
        basket(e.side, bv);
        if (e.points === 3) emit("splash", bv, 1);
        if (e.andOne) emit("andOne", bv, 1);
        if (e.points === 3 || v.state.clutch) emitter(E.flashStands, 0, 0, 0, 25, 1.2);
        break;
      }
      case "swish":
        emit("swish", basket(e.side, bv), 1);
        break;
      case "net":
        glints(e.side * COURT.rimX, COURT.rimHeight - 0.25, 0, 5, 0.2, 2.6, 2.4, 2);
        break;
      case "rim":
        emit("rimHit", e.at, e.strength);
        break;
      case "backboard":
        if (e.strength > 0.5) glints(e.at.x, e.at.y, e.at.z, 4, 0.2, 2, 2, 2.2);
        break;
      case "dunk": {
        emit("dunk", e.at, 1);
        const p = v.players[e.slot];
        if (p) emit("sweat", { x: p.pos.x, y: p.pos.y + p.height * 0.92, z: p.pos.z }, 1.3);
        emitter(E.flashBaseline, 0, 0, 0, 14, 1.4, e.side);
        emitter(E.flashStands, 0, 0, 0, 40, 2.2);
        break;
      }
      case "block":
        emit("block", e.at, 1);
        emitter(E.flashStands, 0, 0, 0, 20, 1);
        break;
      case "steal":
        emit("steal", e.at, 1);
        break;
      case "deflection":
        sparks(e.at.x, e.at.y, e.at.z, 6, 2, 2, 2, 2.2, 0, 0.3);
        break;
      case "ankleBreaker": {
        const p = v.players[e.victim];
        if (p) emit("ankleBreak", p.pos, 1);
        emitter(E.flashStands, 0, 0, 0, 30, 1.5);
        break;
      }
      case "bump":
        if (e.strength > 0.65) drops(e.at.x, e.at.y, e.at.z, 6, 1.8, 0.85, 0.92, 1, 0.25);
        break;
      case "meter":
        if (e.grade === "perfect") {
          const p = v.players[e.slot];
          if (p) emit("perfect", { x: v.ball.pos.x, y: v.ball.pos.y + 0.1, z: v.ball.pos.z }, 1);
        }
        break;
      case "streak":
        if (e.level >= 1) {
          const p = v.players[e.slot];
          if (p) emit("fire", { x: p.pos.x, y: p.height, z: p.pos.z }, 1.5);
        }
        break;
      case "buzzer":
        if (e.kind !== "shotClock" && time - lastMake < 1.6) emit("buzzer", { x: lastMakeSide * COURT.rimX, y: 3, z: 0 }, 1);
        break;
      case "crowdHype":
        if (e.reason === "buzzerBeater") emit("buzzer", { x: lastMakeSide * COURT.rimX, y: 3, z: 0 }, 1);
        else emitter(E.flashStands, 0, 0, 0, 10 + 30 * e.level, 1.5);
        break;
      case "gameEnd":
        celebrate(e.winner, e.winner === 0);
        break;
      case "tipoff":
      case "freeThrowStart":
        emitter(E.flashStands, 0, 0, 0, 14, 1);
        if (e.type === "freeThrowStart") {
          const p = v.players[e.slot];
          if (p) emitter(E.flashBaseline, 0, 0, 0, 3, 0.8, v.dir(p.team));
        }
        break;
      default:
        break;
    }
  }

  function runEmitters(dt: number) {
    for (let i = 0; i < MAX_EMIT; i++) {
      const tp = eType[i];
      if (tp < 0) continue;
      if (time > eUntil[i]) {
        eType[i] = -1;
        continue;
      }
      eAcc[i] += eRate[i] * dt;
      while (eAcc[i] >= 1) {
        eAcc[i] -= 1;
        switch (tp) {
          case E.flashStands:
            standFlash(1);
            break;
          case E.flashBaseline:
            baselineFlash(eParam[i] >= 0 ? 1 : -1);
            break;
          case E.confettiCeil:
            confettiPiece(eX[i] + rnd(-5, 5), eY[i] + rnd(-1, 1), eZ[i] + rnd(-4, 4), rnd(-0.8, 0.8), rnd(-2.2, -0.8), rnd(-0.8, 0.8), eParam[i]);
            break;
          case E.cannon: {
            const sx = eX[i] > 0 ? -1 : 1;
            confettiPiece(eX[i], eY[i], eZ[i] + rnd(-2, 2), sx * rnd(3, 7), rnd(10, 15), rnd(-3, 3), eParam[i]);
            break;
          }
          case E.fountain: {
            reset();
            S.x = eX[i]; S.y = eY[i]; S.z = eZ[i];
            S.vx = rnd(-0.8, 0.8); S.vy = rnd(7, 10.5); S.vz = rnd(-0.8, 0.8);
            S.kind = K.spark;
            S.size = rnd(0.02, 0.034);
            S.life = rnd(0.9, 1.5);
            S.r = 6; S.g = 3.6; S.b = 1.1;
            S.drag = 0.8;
            S.grav = 9.8;
            S.stretch = 0.05;
            S.bounce = 0.25;
            pool.spawn(S);
            if (Math.random() < 0.12) glow(eX[i], 0.5, eZ[i], 1.6, 0.25, 3, 1.8, 0.6, 0.5);
            break;
          }
          default:
            break;
        }
      }
    }
  }

  function perPlayer(dt: number, v: SimView) {
    for (let i = 0; i < v.players.length && i < 10; i++) {
      const p = v.players[i];
      if (p.onFire >= 0.5) {
        const sp = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
        if (sp > 4.2 && p.pos.y < 0.05) {
          trailDist[i] += sp * dt;
          if (trailDist[i] > 0.32) {
            trailDist[i] = 0;
            reset();
            S.x = p.pos.x; S.y = 0.012; S.z = p.pos.z;
            S.kind = K.floorGlow;
            S.size = 0.34;
            S.grow = -0.2;
            S.life = 0.55;
            S.r = 2.6 * p.onFire; S.g = 0.95; S.b = 0.25;
            S.alpha = 0.55;
            pool.spawn(S);
          }
        }
        emberAcc[i] += dt * 70 * (p.onFire - 0.3) * scaleQ();
        while (emberAcc[i] >= 1) {
          emberAcc[i] -= 1;
          emberAt(p.pos.x, p.pos.z, p.height + p.pos.y);
          if (Math.random() < 0.08) glow(p.pos.x + rnd(-0.2, 0.2), p.pos.y + rnd(0.3, p.height), p.pos.z + rnd(-0.2, 0.2), rnd(0.35, 0.6), 0.35, 2.2, 0.7, 0.15, 0.35);
        }
      } else {
        emberAcc[i] = 0;
      }
    }
  }

  const api: FxPlus = {
    handle(events, v) {
      view = v;
      syncTeams(v);
      for (const e of events) {
        try {
          handleOne(e, v);
        } catch (err) {
          console.warn("fx", err);
        }
      }
    },
    emit(kind, at, strength) {
      emit(kind, at, strength ?? 1);
    },
    indicators(v, ind) {
      view = v;
      syncTeams(v);
      // game.ts calls this before update() each frame, so smooth with the previous frame's dt
      marks.update(lastDt, v, ind);
    },
    update(dt, camera) {
      time += dt;
      lastDt = dt;
      camera.getWorldPosition(camPos);
      const v = view;
      // crowd photographers: a steady trickle that grows with hype
      if (v) {
        const s = v.state;
        const live = s.phase === "live" || s.phase === "freeThrow" || s.phase === "tipoff";
        const rate = (live ? 0.6 + s.hype * 4 + (s.clutch ? 2.5 : 0) : 0.35) * scaleQ();
        ambientAcc += rate * dt;
        while (ambientAcc >= 1) {
          ambientAcc -= 1;
          standFlash(0.9);
        }
        perPlayer(dt, v);
      }
      runEmitters(dt);
      pool.update(dt, camera);
    },
    setQuality(nq) {
      q = nq;
      pool.setCap(QUALITY[nq].particles);
    },
    clear() {
      pool.clear();
      marks.clear();
      eType.fill(-1);
      view = null;
      teamKey = "";
    },
    setBowl(b) {
      Object.assign(bowl, b);
    },
    confetti(a, b, seconds) {
      hexTo(a, teamCol, 0);
      hexTo(b, teamCol, 3);
      teamKey = "";
      for (let i = 0; i < 4; i++) emitter(E.confettiCeil, rnd(-9, 9), bowl.ceiling, rnd(-4, 4), 70, seconds, 0);
    },
    get count() {
      return pool.count;
    },
    dispose() {
      pool.dispose();
      marks.dispose();
    },
  };
  return api;
}
