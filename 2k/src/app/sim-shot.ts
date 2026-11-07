import * as THREE from "three";
import type { Action, DunkStyle, MeterGrade, PlayerState, ShotKind } from "./contracts";
import { ACTION_DUR, COURT, distToBasket, shotValue, shotZone } from "./contracts";
import type { Ctx, ShotPlan } from "./sim-core";
import {
  airY, canDunk, clamp, dirOf, emit, foulMult, horizDist, isUser, launchApex, launchTime, rumble, setAction, shotBonus,
  sideOf, stat, toBasket, v3, vertOf,
} from "./sim-core";
import { callFoul, registerMake, registerMiss, releaseLane } from "./sim-rules";

// Shots: choosing the shot, the release meter, make probability, contest, trajectories (swish / rim-in / bank /
// physical misses), dunks, blocks and goaltending. Owner: sim builder.

const tB = new THREE.Vector3();
const tA = new THREE.Vector3();
const tC = new THREE.Vector3();
const tR = new THREE.Vector3();
const tD = new THREE.Vector3();

const JUMPERS: ReadonlySet<ShotKind> = new Set<ShotKind>(["jumper", "pullUp", "stepBack", "fadeaway", "three", "freeThrow"]);
const CLOSE: ReadonlySet<ShotKind> = new Set<ShotKind>(["layup", "reverseLayup", "alleyOopLayup", "putback", "tip"]);

export function isDunkKind(k: ShotKind): boolean {
  return k === "dunk" || k === "alleyOopDunk";
}

function actionFor(kind: ShotKind): Action {
  if (kind === "freeThrow") return "freeThrow";
  if (JUMPERS.has(kind)) return "jumpShot";
  if (isDunkKind(kind)) return "dunk";
  if (kind === "floater") return "floater";
  if (kind === "hook") return "hook";
  return "layup";
}

/** Release window per action, in actionP: [min, target, max]. */
function windowFor(a: Action): [number, number, number] {
  switch (a) {
    case "jumpShot": return [0.45, 0.625, 0.8];
    case "freeThrow": return [0.5, 0.62, 0.85];
    case "layup": return [0.5, 0.6, 0.75];
    case "floater": return [0.45, 0.58, 0.75];
    case "hook": return [0.45, 0.58, 0.75];
    default: return [0.6, 0.6, 0.6];
  }
}

/** Season percentages arrive as 0.38 or 38.0 depending on the roster file. */
export function pct(v: number): number {
  return v > 1.5 ? v / 100 : v;
}

function rnd(ctx: Ctx, a: number, b: number): number {
  return a + (b - a) * ctx.rng();
}

// ---------------------------------------------------------------------------------------------------------------------
// Choosing the shot
// ---------------------------------------------------------------------------------------------------------------------
export function chooseShot(ctx: Ctx, p: PlayerState): ShotKind {
  const st = ctx.state;
  if (st.phase === "freeThrow") return "freeThrow";
  const x = ctx.px[p.slot];
  const it = ctx.intents[p.slot];
  const r = p.data.ratings;
  const dir = dirOf(ctx, p.team);
  const dist = distToBasket(p.pos.x, p.pos.z, dir);
  toBasket(ctx, p, tB);
  const speed = Math.hypot(p.vel.x, p.vel.z);
  const along = p.vel.x * tB.x + p.vel.z * tB.z;
  const dunker = canDunk(p);
  if (ctx.time - x.offRebT < 0.8 && dist < 2.3) {
    if (dunker && r.dunk >= 65 && ctx.rng() < 0.55) return "dunk";
    return "putback";
  }
  if (it.post && dist < 4.8) return dist < 3.4 && r.postScoring >= r.mid - 5 ? "hook" : "fadeaway";
  const driving = along > 2.2;
  const attack = it.sprint > 0.5 || speed > 4.4;
  if (dist < 1.9 || (driving && dist < 4.3)) {
    const bigPower = dist < 1.8 && p.height > 2.03 && r.dunk >= 70;
    if (dunker && (attack || bigPower)) {
      // dunks need a lane: a body at the rim turns most of them into layups
      let dp = 0.1 + clamp((r.dunk - 55) / 40, 0, 1) * 0.5;
      dp *= 1 - 0.75 * computeContest(ctx, p.slot);
      if (dist > 3) dp *= 0.5;
      if (ctx.rng() < dp) return "dunk";
    }
    if (driving && dist > 2.7 && (r.close + r.layup) / 2 >= 55 && ctx.rng() < (attack ? 0.4 : 0.85)) return "floater";
    const baseline = Math.abs(tB.x) < 0.4 && p.pos.z * p.vel.z < 0 && Math.abs(p.pos.z) < 2.2;
    return baseline && ctx.rng() < 0.6 ? "reverseLayup" : "layup";
  }
  if (dist < 3.4 && !driving && r.postScoring > 64 && ctx.rng() < 0.35) return "hook";
  if (driving && dist < 5.2 && dist > 2.6 && (r.close + r.layup) / 2 >= 68 && ctx.rng() < 0.45) return "floater";
  if (x.lastMove === "stepBack" && ctx.time - x.lastMoveT < 0.75) return "stepBack";
  if (along < -1.2) return "fadeaway";
  if (speed > 2.4) return "pullUp";
  return shotValue(p.pos.x, p.pos.z, dir) === 3 ? "three" : "jumper";
}

function shotRating(p: PlayerState, kind: ShotKind, dist: number): number {
  const r = p.data.ratings;
  switch (kind) {
    case "freeThrow": return r.ft;
    case "three": return r.three;
    case "jumper": case "pullUp": case "stepBack": case "fadeaway": {
      const base = dist >= COURT.threeR - 0.2 ? r.three : dist < 3.2 ? (r.mid + r.close) / 2 : r.mid;
      return kind === "jumper" ? base : kind === "fadeaway" ? base * 0.85 + r.postScoring * 0.15 : base * 0.82 + r.handle * 0.18;
    }
    case "layup": case "reverseLayup": case "alleyOopLayup": case "putback": case "tip": return r.layup * 0.7 + r.close * 0.3;
    case "floater": return (r.close + r.layup) / 2;
    case "hook": return (r.postScoring + r.close) / 2;
    case "dunk": case "alleyOopDunk": return r.dunk;
  }
  return 50;
}

// ---------------------------------------------------------------------------------------------------------------------
// Contest and make chance
// ---------------------------------------------------------------------------------------------------------------------
export function computeContest(ctx: Ctx, slot: number): number {
  const p = ctx.players[slot];
  toBasket(ctx, p, tB);
  const dist = distToBasket(p.pos.x, p.pos.z, dirOf(ctx, p.team));
  let best = 0;
  let second = 0;
  const base = p.team === 0 ? 5 : 0;
  for (let i = base; i < base + 5; i++) {
    if (!ctx.px[i].active) continue;
    const d = ctx.players[i];
    if (d.stunned > 0) continue;
    const dx = d.pos.x - p.pos.x;
    const dz = d.pos.z - p.pos.z;
    const hd = Math.sqrt(dx * dx + dz * dz);
    if (hd > 3.0) continue;
    const closeness = clamp(1 - (hd - 0.45) / 1.9, 0, 1);
    const dot = hd > 1e-4 ? (dx * tB.x + dz * tB.z) / hd : 1;
    const front = clamp(0.35 + 0.65 * dot, 0.15, 1);
    const air = d.pos.y > 0.08 && (d.action === "contest" || d.action === "block") ? 1 : 0;
    const hands = 0.25 + 0.35 * d.handsUp + 0.3 * air;
    const size = clamp(1 + (d.reach - p.reach) * 0.9, 0.7, 1.35);
    const rt = dist < 3.2 ? d.data.ratings.interiorD : d.data.ratings.perimeterD;
    const rating = 0.7 + (0.6 * rt) / 99;
    const c = closeness * front * hands * size * rating;
    // only a help defender who is really there (< 1.5 m) adds to the contest
    const help = hd < 1.5 ? c : 0;
    if (c > best) {
      second = Math.max(second, hd < 1.5 ? best : 0);
      best = c;
    } else if (help > second) second = help;
  }
  return clamp(best + 0.3 * second, 0, 1);
}

/** Make probability (0..1). grade "none" = CPU or estimate. */
export function makeChance(ctx: Ctx, slot: number, kind: ShotKind, dist: number, contest: number, grade: MeterGrade): number {
  const p = ctx.players[slot];
  const s = p.data.season;
  const rt = shotRating(p, kind, dist);
  let c: number;
  switch (kind) {
    case "freeThrow": {
      c = 0.47 + (rt - 50) * 0.0105;
      if (pct(s.ftPct) > 0.3) c = c * 0.5 + pct(s.ftPct) * 0.5;
      c = clamp(c, 0.3, 0.96);
      break;
    }
    case "three": case "jumper": case "pullUp": case "stepBack": case "fadeaway": {
      const three = dist >= COURT.threeR - 0.2 || shotValue(p.pos.x, p.pos.z, dirOf(ctx, p.team)) === 3;
      if (three) {
        c = 0.12 + (rt - 25) * 0.0052;
        if (pct(s.tpPct) > 0.2) c = c * 0.5 + (pct(s.tpPct) + 0.04) * 0.5;
        if (dist > 7.9) c -= 0.09 * (dist - 7.9);
        if (shotZone(p.pos.x, p.pos.z, dirOf(ctx, p.team)) === "corner3") c += 0.015;
      } else {
        c = 0.22 + (rt - 25) * 0.0048;
        if (dist < 3.5) c += 0.04;
        else if (dist < 5) c += 0.015;
      }
      if (kind === "pullUp") c -= 0.025;
      else if (kind === "stepBack") c -= 0.035;
      else if (kind === "fadeaway") c -= 0.045;
      // open looks fall a bit more often; a real hand in the face hurts a lot (non-linear)
      c = (c + (three ? 0.06 : 0.035)) * (1 - 0.45 * Math.pow(contest, 1.2));
      break;
    }
    case "layup": case "reverseLayup": case "putback": case "tip": case "alleyOopLayup":
      c = 0.53 + (rt - 25) * 0.0055;
      if (kind === "reverseLayup") c -= 0.03;
      if (kind === "alleyOopLayup") c *= 0.95;
      c *= 1 - 0.24 * contest;
      break;
    case "floater":
      c = 0.3 + (rt - 25) * 0.0048;
      c *= 1 - 0.22 * contest;
      break;
    case "hook":
      c = 0.33 + (rt - 25) * 0.0046;
      c *= 1 - 0.26 * contest;
      break;
    case "dunk": case "alleyOopDunk":
      c = 0.8 + (rt - 25) * 0.0026;
      if (kind === "alleyOopDunk") c *= 0.94;
      c *= 1 - 0.12 * contest;
      break;
    default:
      c = 0.4;
  }
  const close = CLOSE.has(kind) || kind === "floater" || kind === "hook";
  // how much good timing can lift this shooter: a great shooter turns a perfect release into a near-sure make,
  // a non-shooter only gets a modest bump
  const skill = clamp((rt - 40) / 50, 0, 1);
  switch (grade) {
    case "perfect":
      c += (1 - c) * (close ? 0.45 * (1 - 0.5 * contest) : kind === "freeThrow" ? 0.7 : 0.62 * (1 - contest) * (1 - contest) * (0.3 + 0.7 * skill));
      break;
    case "slightlyEarly": case "slightlyLate": c *= close ? 0.95 : 0.88 + 0.05 * clamp((rt - 60) / 35, 0, 1); break;
    case "early": case "late": c *= close ? 0.7 : kind === "freeThrow" ? 0.55 : 0.45; break;
    default: break;
  }
  c += shotBonus(ctx, p.team);
  c += p.onFire * 0.04;
  if (p.stamina < 0.6 && kind !== "freeThrow") c -= (0.6 - p.stamina) * 0.2;
  return clamp(c, 0.02, 0.98);
}

/** Cheap estimate for the AI: current spot, current contest, average timing. */
export function estimateChance(ctx: Ctx, slot: number): number {
  const p = ctx.players[slot];
  const dir = dirOf(ctx, p.team);
  const dist = distToBasket(p.pos.x, p.pos.z, dir);
  const kind: ShotKind = dist < 1.9 ? (canDunk(p) && p.data.ratings.dunk >= 70 ? "dunk" : "layup") : shotValue(p.pos.x, p.pos.z, dir) === 3 ? "three" : "jumper";
  return makeChance(ctx, slot, kind, dist, computeContest(ctx, slot), "none");
}

// ---------------------------------------------------------------------------------------------------------------------
// Starting and releasing
// ---------------------------------------------------------------------------------------------------------------------
export function startShot(ctx: Ctx, slot: number, forced?: ShotKind): boolean {
  const st = ctx.state;
  const ball = ctx.ball;
  const p = ctx.players[slot];
  const x = ctx.px[slot];
  if (ball.holder !== slot || (ball.mode !== "held" && ball.mode !== "dribble")) return false;
  if (x.shot.on || x.passing || p.stunned > 0) return false;
  if (st.phase !== "live" && st.phase !== "freeThrow") return false;
  const kind = forced ?? chooseShot(ctx, p);
  const action = actionFor(kind);
  const sp = x.shot;
  const r = p.data.ratings;
  const dir = dirOf(ctx, p.team);
  const dist = distToBasket(p.pos.x, p.pos.z, dir);
  sp.on = true;
  sp.kind = kind;
  sp.points = kind === "freeThrow" ? 1 : shotValue(p.pos.x, p.pos.z, dir);
  const [minP, targetP, maxP] = windowFor(action);
  sp.minP = minP;
  sp.targetP = targetP;
  sp.maxP = maxP;
  sp.decided = false;
  sp.released = false;
  sp.grade = "none";
  sp.user = isUser(ctx, slot);
  sp.startT = ctx.time;
  sp.alley = kind === "alleyOopDunk" || kind === "alleyOopLayup";
  sp.style = null;
  sp.from.set(p.pos.x, 0, p.pos.z);
  sp.contest0 = computeContest(ctx, slot);
  const rt = shotRating(p, kind, dist);
  sp.window = ctx.diff.perfectWindow * (0.65 + (0.7 * rt) / 99) * (1 - 0.4 * sp.contest0) * (kind === "freeThrow" ? 1.2 : 1) / maxP;

  // finish point for drives
  toBasket(ctx, p, tB);
  const rim = dir * COURT.rimX;
  if (action === "layup" || action === "dunk") {
    const off = action === "dunk" ? 0.45 : 0.8;
    if (dist > off) sp.finish.set(rim - tB.x * off, 0, -tB.z * off);
    else sp.finish.set(p.pos.x, 0, p.pos.z);
  } else sp.finish.set(p.pos.x, 0, p.pos.z);

  let dur = ACTION_DUR[action];
  if (action === "jumpShot") dur *= 1.1 - (rt / 99) * 0.2;
  if (action === "dunk") sp.style = dunkStyle(ctx, p, kind);
  setAction(ctx, slot, action, dur);
  const v = vertOf(p);
  x.jumpH = action === "jumpShot" ? v * (kind === "three" ? 0.5 : 0.58) : action === "layup" ? v * 0.85 : action === "dunk" ? v : action === "floater" ? v * 0.5 : action === "hook" ? v * 0.45 : 0;
  p.variant = Math.floor(ctx.rng() * 8);
  p.actionSide = ball.dribbleHand;
  p.dunkStyle = sp.style;
  ball.mode = "held";
  x.heldT = 0;

  const m = p.meter;
  m.active = sp.user && !isDunkKind(kind);
  m.fill = 0;
  m.target = targetP / maxP;
  m.window = sp.window;
  m.grade = "none";
  m.shownT = 0;
  if (isDunkKind(kind)) {
    sp.decided = true;
    sp.releaseP = 0.6;
  } else if (!sp.user) {
    const noise = (ctx.rng() - 0.5) * 0.09 * (1.25 - rt / 99);
    sp.decided = true;
    sp.releaseP = clamp(targetP + noise, minP, maxP);
  }
  emit(ctx, { type: "shotStart", slot, kind });
  scheduleContests(ctx, slot, dur * (sp.decided ? sp.releaseP : targetP));
  return true;
}

function dunkStyle(ctx: Ctx, p: PlayerState, kind: ShotKind): DunkStyle {
  const r = p.data.ratings;
  if (ctx.time - ctx.px[p.slot].offRebT < 0.8) return "putback";
  const roll = ctx.rng();
  const flashy = (r.dunk + r.vertical) / 2;
  if (kind === "alleyOopDunk") return roll < 0.5 ? "twoHand" : flashy > 82 && roll < 0.75 ? "reverse" : "oneHand";
  if (p.height > 2.05 && roll < 0.55) return "twoHand";
  if (flashy > 88 && roll < 0.22) return "windmill";
  if (flashy > 80 && roll < 0.4) return "tomahawk";
  if (flashy > 84 && roll < 0.5) return "cuff";
  if (roll < 0.62) return "reverse";
  return roll < 0.82 ? "oneHand" : "twoHand";
}

/** CPU defenders near the shot react with a timed contest / block jump. */
function scheduleContests(ctx: Ctx, slot: number, releaseIn: number): void {
  const p = ctx.players[slot];
  const sp = ctx.px[slot].shot;
  if (sp.kind === "freeThrow") return;
  const rim = sp.kind !== "jumper" && sp.kind !== "three" && sp.kind !== "pullUp" && sp.kind !== "stepBack" && sp.kind !== "fadeaway";
  toBasket(ctx, p, tB);
  const base = p.team === 0 ? 5 : 0;
  const iq = ctx.diff.cpuIQ;
  for (let i = base; i < base + 5; i++) {
    if (isUser(ctx, i) || !ctx.px[i].active) continue;
    const d = ctx.players[i];
    if (d.stunned > 0 || d.pos.y > 0.01) continue;
    const dx = d.pos.x - p.pos.x;
    const dz = d.pos.z - p.pos.z;
    const hd = Math.hypot(dx, dz);
    const dx2 = d.pos.x - sp.finish.x;
    const dz2 = d.pos.z - sp.finish.z;
    const nearFinish = Math.hypot(dx2, dz2);
    const reaction = ctx.diff.cpuReaction * (0.4 + ctx.rng() * 0.8);
    if (rim) {
      if (Math.min(hd, nearFinish) > 2.4) continue;
      if (ctx.rng() > 0.15 + (0.45 * d.data.ratings.block) / 99 * (0.6 + 0.4 * iq)) continue;
      ctx.px[i].contestBlock = true;
      ctx.px[i].contestAt = ctx.time + Math.max(0, releaseIn - 0.45 + reaction * 0.6);
    } else {
      const front = hd > 0.01 ? (dx * tB.x + dz * tB.z) / hd : 1;
      if (hd > 2.3 || front < -0.1) continue;
      if (ctx.rng() > 0.45 + 0.5 * iq) continue;
      ctx.px[i].contestBlock = hd < 1.2 && d.data.ratings.block > 70 && ctx.rng() < 0.35;
      ctx.px[i].contestAt = ctx.time + Math.max(0, releaseIn - 0.4 + reaction * 0.5);
    }
  }
}

function gradeOf(fill: number, sp: ShotPlan, good: number): MeterGrade {
  const target = sp.targetP / sp.maxP;
  const e = fill - target;
  const half = sp.window / 2;
  if (Math.abs(e) <= half) return "perfect";
  if (Math.abs(e) <= half + good / sp.maxP) return e < 0 ? "slightlyEarly" : "slightlyLate";
  return e < 0 ? "early" : "late";
}

/** Per step while a shot action plays. Handles meter, pump fakes and the release. */
export function updateShot(ctx: Ctx, slot: number): void {
  const p = ctx.players[slot];
  const x = ctx.px[slot];
  const sp = x.shot;
  if (!sp.on || sp.released) return;
  const P = p.actionP;
  const fill = clamp(P / sp.maxP, 0, 1);
  p.meter.fill = fill;
  if (!sp.decided) {
    const it = ctx.intents[slot];
    if (!it.shootHeld) {
      const jumper = JUMPERS.has(sp.kind) && sp.kind !== "freeThrow";
      if (jumper && ctx.time - sp.startT < 0.12 && Math.hypot(p.vel.x, p.vel.z) < 2.6 && p.pos.y < 0.01) {
        sp.on = false;
        p.meter.active = false;
        p.meter.shownT = 99;
        setAction(ctx, slot, "pumpFake");
        return;
      }
      sp.grade = gradeOf(fill, sp, ctx.diff.goodWindow);
      sp.decided = true;
      sp.releaseP = clamp(P, sp.minP, sp.maxP);
    } else if (P >= sp.maxP) {
      sp.grade = "late";
      sp.decided = true;
      sp.releaseP = P;
    }
    if (sp.decided) {
      p.meter.grade = sp.grade;
      p.meter.active = false;
      p.meter.shownT = 0;
      emit(ctx, { type: "meter", slot, grade: sp.grade });
      if (sp.grade === "perfect") rumble(ctx, slot, 0.1, 0.45, 70);
    }
  }
  if (sp.decided && !sp.released && P >= sp.releaseP) releaseShot(ctx, slot);
}

/** Ball position while gathering a shot (hands carry it up). */
export function gatherBallPos(ctx: Ctx, p: PlayerState, out: THREE.Vector3): boolean {
  const x = ctx.px[p.slot];
  const sp = x.shot;
  if (!sp.on || sp.released) return false;
  const P = p.actionP;
  const h = p.height;
  const y0 = p.pos.y;
  const f = tA.set(Math.sin(p.facing), 0, Math.cos(p.facing));
  const r = tR.set(-Math.cos(p.facing), 0, Math.sin(p.facing));
  const hand = p.actionSide;
  const k0 = clamp(P / Math.max(0.2, sp.minP), 0, 1);
  const k = k0 * k0 * (3 - 2 * k0);
  // chest
  tC.set(p.pos.x + f.x * 0.3, y0 + h * 0.6, p.pos.z + f.z * 0.3);
  switch (p.action) {
    case "jumpShot":
    case "freeThrow":
      tD.set(p.pos.x + f.x * 0.12 + r.x * hand * 0.06, y0 + h * 1.13, p.pos.z + f.z * 0.12 + r.z * hand * 0.06);
      break;
    case "layup":
      tD.set(p.pos.x + f.x * 0.35 + r.x * hand * 0.18, y0 + p.reach - 0.12, p.pos.z + f.z * 0.35 + r.z * hand * 0.18);
      break;
    case "floater":
      tD.set(p.pos.x + f.x * 0.3, y0 + h * 1.1, p.pos.z + f.z * 0.3);
      break;
    case "hook":
      tD.set(p.pos.x + r.x * hand * 0.45, y0 + p.reach - 0.05, p.pos.z + r.z * hand * 0.45);
      break;
    case "dunk": {
      tD.set(p.pos.x + f.x * 0.3, y0 + p.reach + 0.02, p.pos.z + f.z * 0.3);
      if (P > 0.45) {
        const dir = dirOf(ctx, p.team);
        const kk = clamp((P - 0.45) / 0.15, 0, 1);
        tD.x += (dir * COURT.rimX - tD.x) * kk * 0.85;
        tD.z += (0 - tD.z) * kk * 0.85;
        tD.y += (COURT.rimHeight + 0.22 - tD.y) * kk;
      }
      break;
    }
    default:
      return false;
  }
  out.lerpVectors(tC, tD, k);
  return true;
}

export function releaseShot(ctx: Ctx, slot: number): void {
  const st = ctx.state;
  const ball = ctx.ball;
  const p = ctx.players[slot];
  const x = ctx.px[slot];
  const sp = x.shot;
  sp.released = true;
  p.meter.active = false;
  if (ball.holder !== slot) {
    sp.on = false;
    return;
  }
  if (isDunkKind(sp.kind)) {
    slam(ctx, slot);
    return;
  }
  const team = p.team;
  const dir = dirOf(ctx, team);
  const dist = distToBasket(p.pos.x, p.pos.z, dir);
  if (sp.kind !== "freeThrow") sp.points = shotValue(p.pos.x, p.pos.z, dir);
  const contest = sp.kind === "freeThrow" ? 0 : computeContest(ctx, slot);
  const grade = sp.user ? sp.grade : "none";
  const chance = makeChance(ctx, slot, sp.kind, dist, contest, grade);
  let make = ctx.rng() < chance;
  if (ctx.mode === "practice" && sp.user && grade === "perfect") make = true;

  const sh = fillShot(ctx, slot, sp.kind, sp.points, dist, contest, grade, chance, make);
  ball.mode = "shot";
  ball.holder = -1;
  p.hasBall = false;
  st.ballHandler = -1;
  st.lastTouch = slot;
  if (sp.kind === "freeThrow") stat(ctx, slot, "fta");
  else {
    stat(ctx, slot, "fga");
    if (sp.points === 3) stat(ctx, slot, "tpa");
  }
  planShot(ctx, slot, sp, make, grade, contest, dist);
  emit(ctx, {
    type: "shot", slot, team, kind: sh.kind, points: sh.points, dist, contest, timing: grade, chance, at: v3(sh.from),
  });
  if (sp.kind === "freeThrow") {
    const ft = st.freeThrow;
    if (ft && ft.index === ft.total) releaseLane(ctx);
  } else if (ctx.mode !== "practice") {
    shootingFoulCheck(ctx, slot, make, sp.points);
  }
}

function fillShot(ctx: Ctx, slot: number, kind: ShotKind, points: 1 | 2 | 3, dist: number, contest: number, grade: MeterGrade, chance: number, make: boolean) {
  const p = ctx.players[slot];
  const sh = ctx.shotObj;
  sh.shooter = slot;
  sh.team = p.team;
  sh.kind = kind;
  sh.points = points;
  sh.dist = dist;
  sh.from.copy(ctx.ball.pos);
  sh.target = dirOf(ctx, p.team);
  sh.contest = contest;
  sh.timing = grade;
  sh.chance = chance;
  sh.make = make;
  sh.swish = false;
  sh.blocked = false;
  sh.assister = -1;
  sh.airTime = 0;
  sh.releaseT = ctx.time;
  sh.touchedRim = false;
  ctx.ball.shot = sh;
  ctx.shotResolved = false;
  ctx.shotId++;
  ctx.reboundPending = false;
  ctx.frontEstablished = false;
  ctx.shotClockExpired = false;
  ctx.clockAtRelease = ctx.state.clock;
  ctx.seg.on = false;
  ctx.net.on = false;
  ctx.state.laneTimer.fill(0);
  return sh;
}

function shootingFoulCheck(ctx: Ctx, slot: number, make: boolean, points: 1 | 2 | 3): void {
  if (ctx.pendingFoul) return;
  const p = ctx.players[slot];
  const sp = ctx.px[slot].shot;
  const near = CLOSE.has(sp.kind) || sp.kind === "floater" || sp.kind === "hook" || isDunkKind(sp.kind);
  const base = p.team === 0 ? 5 : 0;
  let best = -1;
  let bv = 0;
  for (let i = base; i < base + 5; i++) {
    if (!ctx.px[i].active) continue;
    const d = ctx.players[i];
    const hd = horizDist(d.pos.x, d.pos.z, p.pos.x, p.pos.z);
    const gap = hd - (p.radius + d.radius);
    if (gap > 0.35) continue;
    const closeness = clamp(1 - gap / 0.35, 0, 1);
    const air = d.pos.y > 0.05 && (d.action === "contest" || d.action === "block");
    const tx = p.pos.x - d.pos.x;
    const tz = p.pos.z - d.pos.z;
    const l = Math.hypot(tx, tz) || 1;
    const closing = (d.vel.x * tx + d.vel.z * tz) / l;
    const act = air ? 1.5 : closing > 1.5 ? 1.3 : 0.7;
    const pf = (near ? 0.13 : 0.04) * closeness * act * foulMult(ctx, i);
    if (pf > bv) {
      bv = pf;
      best = i;
    }
  }
  if (best >= 0 && ctx.rng() < bv) {
    const shots = (make ? 1 : points) as 1 | 2 | 3;
    callFoul(ctx, best, slot, "shooting", shots);
    ctx.pendingFoul = { by: best, on: slot, shots };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Trajectories
// ---------------------------------------------------------------------------------------------------------------------
function planShot(ctx: Ctx, slot: number, sp: ShotPlan, make: boolean, grade: MeterGrade, contest: number, dist: number): void {
  const ball = ctx.ball;
  const sh = ctx.shotObj;
  const dir = sh.target;
  const C = tC.set(dir * COURT.rimX, COURT.rimHeight, 0);
  const u = tB.set(C.x - ball.pos.x, 0, C.z - ball.pos.z);
  const hl = Math.hypot(u.x, u.z) || 1;
  u.multiplyScalar(1 / hl);
  const perp = tR.set(-u.z, 0, u.x);
  const kind = sp.kind;
  const jumper = JUMPERS.has(kind);
  const close = CLOSE.has(kind);
  let apex: number;
  if (jumper) apex = COURT.rimHeight + 0.55 + hl * 0.105 + (kind === "fadeaway" ? 0.15 : 0);
  else if (kind === "floater") apex = COURT.rimHeight + 0.95 + 0.05 * hl;
  else if (kind === "hook") apex = COURT.rimHeight + 0.75;
  else apex = Math.max(ball.pos.y, COURT.rimHeight) + 0.32;
  const seg = ctx.seg;
  const p = ctx.players[slot];
  const rating = shotRating(p, kind, dist);
  const angled = Math.abs(ball.pos.z) > 0.35;
  if (make) {
    let swishP: number;
    if (jumper) swishP = grade === "perfect" ? 0.85 : grade === "slightlyEarly" || grade === "slightlyLate" ? 0.5 : 0.3 + (0.4 * rating) / 99;
    else swishP = kind === "floater" ? 0.4 : kind === "hook" ? 0.35 : 0.12;
    if (kind === "freeThrow") swishP = 0.55;
    let bankP = 0;
    if (close && angled) bankP = 0.55;
    else if (kind === "hook") bankP = 0.35;
    else if (kind === "floater") bankP = 0.15;
    else if (jumper && kind !== "freeThrow" && hl > 2.5 && hl < 6.5 && Math.abs(ball.pos.z) > 1.0) bankP = 0.1;
    const roll = ctx.rng();
    if (roll < swishP) {
      sh.swish = true;
      sh.airTime = launchApex(ball.pos, C, apex, ball.vel);
      seg.on = false;
    } else if (ctx.rng() < bankP / Math.max(0.01, 1 - swishP)) {
      const B = seg.pts[0].set(dir * (COURT.boardX - COURT.ballR), COURT.rimHeight + rnd(ctx, 0.33, 0.45), clamp(ball.pos.z * 0.16, -0.45, 0.45));
      const T0 = launchApex(ball.pos, B, Math.max(apex, B.y + 0.25), ball.vel);
      seg.pts[1].set(C.x, C.y - 0.16, C.z);
      seg.dur[0] = T0;
      seg.dur[1] = rnd(ctx, 0.25, 0.31);
      seg.ev[0] = 2;
      seg.ev[1] = 0;
      seg.n = 2;
      sh.airTime = T0 + seg.dur[1];
      startSeg(ctx);
    } else {
      const w = tD;
      const t = ctx.rng();
      if (t < 0.4) w.copy(u).multiplyScalar(-1);
      else if (t < 0.75) w.copy(u);
      else w.copy(perp).multiplyScalar(ctx.rng() < 0.5 ? 1 : -1);
      const K = seg.pts[0].set(C.x + w.x * 0.165, C.y + 0.085, C.z + w.z * 0.165);
      const T0 = launchApex(ball.pos, K, apex, ball.vel);
      seg.dur[0] = T0;
      seg.ev[0] = 1;
      if (ctx.rng() < 0.3) {
        seg.pts[1].set(C.x - w.x * 0.16, C.y + 0.08, C.z - w.z * 0.16);
        seg.dur[1] = rnd(ctx, 0.22, 0.3);
        seg.ev[1] = 1;
        seg.pts[2].set(C.x, C.y - 0.16, C.z);
        seg.dur[2] = rnd(ctx, 0.24, 0.3);
        seg.ev[2] = 0;
        seg.n = 3;
      } else {
        seg.pts[1].set(C.x, C.y - 0.16, C.z);
        seg.dur[1] = rnd(ctx, 0.28, 0.4);
        seg.ev[1] = 0;
        seg.n = 2;
      }
      sh.airTime = T0;
      startSeg(ctx);
    }
    return;
  }
  // misses play out with real rim / board physics
  sh.swish = false;
  const bad = grade === "early" || grade === "late";
  const air = (bad && ctx.rng() < 0.28) || (contest > 0.8 && hl > 5 && ctx.rng() < 0.12);
  const M = tD;
  if (air) {
    const t = ctx.rng();
    if (t < 0.5 || grade === "early") M.set(C.x - u.x * rnd(ctx, 0.55, 1.0), C.y - 0.1, C.z - u.z * rnd(ctx, 0.55, 1.0));
    else if (t < 0.8) M.set(C.x + u.x * 0.5 + perp.x * 0.15, C.y + 0.6, C.z + u.z * 0.5 + perp.z * 0.15);
    else {
      const s = ctx.rng() < 0.5 ? 1 : -1;
      M.set(C.x + perp.x * s * 0.62, C.y - 0.1, C.z + perp.z * s * 0.62);
    }
  } else {
    let front = 0.4;
    let back = 0.35;
    if (grade === "early" || grade === "slightlyEarly") {
      front = 0.65;
      back = 0.2;
    } else if (grade === "late" || grade === "slightlyLate") {
      front = 0.2;
      back = 0.6;
    }
    const t = ctx.rng();
    if ((close || kind === "hook") && angled && ctx.rng() < 0.4) {
      M.set(dir * (COURT.boardX - COURT.ballR), COURT.rimHeight + rnd(ctx, 0.5, 0.7), clamp(ball.pos.z * 0.2, -0.6, 0.6));
    } else if (t < front) {
      const o = rnd(ctx, 0.235, 0.285);
      M.set(C.x - u.x * o, C.y + 0.07, C.z - u.z * o);
    } else if (t < front + back) {
      const o = rnd(ctx, 0.215, 0.275);
      M.set(C.x + u.x * o, C.y + 0.06, C.z + u.z * o);
    } else {
      const o = rnd(ctx, 0.22, 0.27) * (ctx.rng() < 0.5 ? 1 : -1);
      M.set(C.x + perp.x * o + u.x * rnd(ctx, -0.05, 0.05), C.y + 0.06, C.z + perp.z * o);
    }
  }
  sh.airTime = launchApex(ball.pos, M, apex, ball.vel);
  seg.on = false;
}

function startSeg(ctx: Ctx): void {
  const seg = ctx.seg;
  seg.on = true;
  seg.i = 0;
  seg.left = seg.dur[0];
}

/** Dunk slam moment (dunk action P = 0.6). */
function slam(ctx: Ctx, slot: number): void {
  const st = ctx.state;
  const ball = ctx.ball;
  const p = ctx.players[slot];
  const sp = ctx.px[slot].shot;
  const dir = dirOf(ctx, p.team);
  const C = tC.set(dir * COURT.rimX, COURT.rimHeight, 0);
  const u = tB.set(C.x - p.pos.x, 0, -p.pos.z);
  const l = Math.hypot(u.x, u.z) || 1;
  u.multiplyScalar(1 / l);
  const dist = distToBasket(p.pos.x, p.pos.z, dir);
  const contest = computeContest(ctx, slot);
  const chance = makeChance(ctx, slot, sp.kind, dist, contest, "none");
  const make = ctx.rng() < chance;
  fillShot(ctx, slot, sp.kind, 2, dist, contest, "none", chance, make);
  ball.holder = -1;
  p.hasBall = false;
  st.ballHandler = -1;
  st.lastTouch = slot;
  stat(ctx, slot, "fga");
  emit(ctx, { type: "shot", slot, team: p.team, kind: sp.kind, points: 2, dist, contest, timing: "none", chance, at: v3(ball.pos) });

  // rim protector meets him at the top
  const base = p.team === 0 ? 5 : 0;
  for (let i = base; i < base + 5; i++) {
    if (!ctx.px[i].active) continue;
    const d = ctx.players[i];
    if (d.pos.y < 0.15 || (d.action !== "block" && d.action !== "contest")) continue;
    const hd = horizDist(d.pos.x, d.pos.z, C.x, C.z);
    if (hd > 1.6 || horizDist(d.pos.x, d.pos.z, p.pos.x, p.pos.z) > 1.3) continue;
    const top = d.reach + d.pos.y;
    if (top < COURT.rimHeight + 0.05) continue;
    const timing = 1 - Math.min(1, Math.abs(d.actionP - 0.5) * 2.2);
    const pb = (0.04 + (0.16 * d.data.ratings.block) / 99) * (0.4 + 0.6 * timing) * (1.25 - (p.data.ratings.dunk / 99) * 0.5) * (d.action === "contest" ? 0.5 : 1);
    if (ctx.rng() < pb) {
      ball.mode = "shot";
      ball.pos.set(p.pos.x + u.x * 0.3, p.pos.y + p.reach - 0.05, p.pos.z + u.z * 0.3);
      blockShot(ctx, i);
      return;
    }
  }
  ball.mode = "shot";
  if (make) {
    ball.pos.set(C.x - u.x * 0.05, C.y + 0.24, C.z - u.z * 0.05);
    ball.vel.set(u.x * 0.3, -4.6, u.z * 0.3);
    ball.spin.set(0, 0, 0);
    emit(ctx, { type: "dunk", slot, style: sp.style ?? "oneHand", side: dir, at: v3(ball.pos) });
    emit(ctx, { type: "shake", strength: sp.style === "windmill" || sp.style === "tomahawk" || sp.kind === "alleyOopDunk" ? 0.9 : 0.6 });
    emit(ctx, { type: "rim", side: dir, strength: 1, at: { x: C.x, y: C.y, z: C.z } });
    ctx.shotObj.touchedRim = true;
  } else {
    ball.pos.set(C.x - u.x * 0.22, C.y + 0.16, C.z - u.z * 0.22);
    ball.vel.set(-u.x * 2.4 + (ctx.rng() - 0.5) * 1.5, 3.4, -u.z * 2.4 + (ctx.rng() - 0.5) * 1.5);
    emit(ctx, { type: "rim", side: dir, strength: 1, at: { x: C.x, y: C.y, z: C.z } });
    emit(ctx, { type: "shake", strength: 0.35 });
    ctx.shotObj.touchedRim = true;
    ball.mode = "loose";
    registerMiss(ctx, false, false);
  }
  if (ctx.mode !== "practice") shootingFoulCheck(ctx, slot, make, 2);
}

// ---------------------------------------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------------------------------------
const BLOCK_MULT: Partial<Record<ShotKind, number>> = {
  three: 0.55, jumper: 0.75, pullUp: 0.75, stepBack: 0.6, fadeaway: 0.45, layup: 1, reverseLayup: 0.8, putback: 1,
  tip: 1, floater: 0.55, hook: 0.65, alleyOopLayup: 0.9,
};

/** Each step while a shot is in the air: airborne defenders can get a hand on it. */
export function checkBlocks(ctx: Ctx): void {
  const ball = ctx.ball;
  const sh = ctx.shotObj;
  if (ball.mode !== "shot" || ctx.shotResolved || sh.kind === "freeThrow" || ctx.pendingFoul) return;
  const tf = ctx.time - sh.releaseT;
  if (tf > 0.9) return;
  const base = sh.team === 0 ? 5 : 0;
  for (let i = base; i < base + 5; i++) {
    const x = ctx.px[i];
    if (!x.active || x.blockShot === ctx.shotId) continue;
    const d = ctx.players[i];
    if (d.pos.y < 0.05 || (d.action !== "block" && d.action !== "contest" && d.action !== "rebound")) continue;
    const f = tA.set(Math.sin(d.facing), 0, Math.cos(d.facing));
    const hx = d.pos.x + f.x * 0.18;
    const hy = d.pos.y + d.reach + 0.05;
    const hz = d.pos.z + f.z * 0.18;
    const dx = ball.pos.x - hx;
    const dz = ball.pos.z - hz;
    const dy = ball.pos.y > hy ? ball.pos.y - hy : Math.max(0, hy - 0.55 - ball.pos.y);
    const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
    const rad = 0.32 + (0.18 * d.data.ratings.block) / 99 + (d.action === "block" ? 0.1 : 0);
    if (dist > rad) continue;
    x.blockShot = ctx.shotId;
    const timing = 1 - Math.min(1, Math.abs(d.actionP - 0.5) * 2.2);
    const size = clamp(1 + (hy - ball.pos.y) * 0.6, 0.6, 1.4);
    const pb = (0.1 + (0.4 * d.data.ratings.block) / 99) * (0.45 + 0.55 * timing) * (BLOCK_MULT[sh.kind] ?? 0.7) * size *
      (d.action === "contest" ? 0.55 : d.action === "rebound" ? 0.4 : 1);
    if (ctx.rng() < pb) {
      blockShot(ctx, i);
      return;
    }
    const s = ctx.players[sh.shooter];
    if (tf < 0.25 && horizDist(d.pos.x, d.pos.z, s.pos.x, s.pos.z) < d.radius + s.radius + 0.3 && ctx.rng() < 0.16 * foulMult(ctx, i)) {
      const shots = (sh.make ? 1 : sh.points) as 1 | 2 | 3;
      callFoul(ctx, i, sh.shooter, "shooting", shots);
      ctx.pendingFoul = { by: i, on: sh.shooter, shots };
      return;
    }
  }
}

export function blockShot(ctx: Ctx, by: number): void {
  const st = ctx.state;
  const ball = ctx.ball;
  const sh = ctx.shotObj;
  const d = ctx.players[by];
  const dir = sh.target;
  const C = tC.set(dir * COURT.rimX, COURT.rimHeight, 0);
  const goaltend = ball.vel.y < 0 && ball.pos.y > COURT.rimHeight && horizDist(ball.pos.x, ball.pos.z, C.x, C.z) < 1.8 && !isDunkKind(sh.kind);
  const u = tB.set(C.x - sh.from.x, 0, C.z - sh.from.z);
  const l = Math.hypot(u.x, u.z) || 1;
  u.multiplyScalar(1 / l);
  ctx.seg.on = false;
  st.lastTouch = by;
  if (goaltend) {
    emit(ctx, { type: "block", by, on: sh.shooter, at: v3(ball.pos), goaltend: true });
    emit(ctx, { type: "whistle", reason: "violation" });
    emit(ctx, { type: "toast", text: "GOALTENDING", sub: d.data.last.toUpperCase(), tone: "neutral" });
    ball.vel.set(-u.x * 2, 1, -u.z * 2);
    ball.mode = "loose";
    sh.make = true;
    registerMake(ctx);
    return;
  }
  sh.blocked = true;
  sh.make = false;
  stat(ctx, by, "blk");
  emit(ctx, { type: "block", by, on: sh.shooter, at: v3(ball.pos), goaltend: false });
  const spike = ctx.rng() < 0.2 ? 1.8 : 1;
  const side = (ctx.rng() - 0.5) * 3;
  ball.vel.set((-u.x * rnd(ctx, 3, 5.5) - u.z * side) * spike, rnd(ctx, -0.5, 2.2), (-u.z * rnd(ctx, 3, 5.5) + u.x * side) * spike);
  ball.mode = "loose";
  ball.holder = -1;
  const home = d.team === 0;
  emit(ctx, { type: "crowd", reaction: home ? "roar" : "ooh", strength: home ? 0.9 : 0.5 });
  emit(ctx, { type: "shake", strength: 0.3 });
  st.hype = clamp(st.hype + (home ? 0.12 : 0.04), 0, 1);
  if (home || st.clutch) emit(ctx, { type: "crowdHype", level: st.hype, reason: "block" });
  rumble(ctx, by, 0.5, 0.5, 200);
  rumble(ctx, sh.shooter, 0.4, 0.3, 160);
  registerMiss(ctx, false, true);
}

/** Jump height used by sim-play for the jump actions it starts. */
export function jumpFor(p: PlayerState, a: Action): number {
  const v = vertOf(p);
  switch (a) {
    case "block": return v * 0.95;
    case "contest": return v * 0.55;
    case "rebound": return v * 0.85;
    case "jumpBall": return v;
    default: return 0;
  }
}

export { airY };
