import * as THREE from "three";
import type { PassKind } from "./contracts";
import { COURT, distToBasket } from "./contracts";
import type { Ctx } from "./sim-core";
import {
  busy, canDunk, clamp, dirOf, emit, horizDist, integrate, isUser, launchTime, setAction, sideOf, stealMult, toBasket,
  v3, yawTo,
} from "./sim-core";
import { bestReceiver, gainControl, setUser } from "./sim-rules";
import { physics } from "./sim-ball";

// Passing: target choice, release, flight (chest / bounce / lob / alley-oop), homing, catches and interceptions.
// Owner: sim builder.

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tE = new THREE.Vector3();

/** Teammate the pass goes to: stick direction first, otherwise the best open man. */
export function choosePassTarget(ctx: Ctx, from: number, aim: THREE.Vector3 | null): number {
  const p = ctx.players[from];
  if (aim && aim.x * aim.x + aim.z * aim.z > 0.04) {
    const al = Math.hypot(aim.x, aim.z);
    let best = -1;
    let bv = -1e9;
    for (let s = p.team * 5; s < p.team * 5 + 5; s++) {
      if (s === from || !ctx.px[s].active) continue;
      const q = ctx.players[s];
      const dx = q.pos.x - p.pos.x;
      const dz = q.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const dot = (dx * aim.x + dz * aim.z) / (d * al);
      if (dot < 0.3) continue;
      const v = dot * 2.2 - d * 0.025 + q.openness * 0.3;
      if (v > bv) {
        bv = v;
        best = s;
      }
    }
    if (best >= 0) return best;
  }
  return bestReceiver(ctx, from);
}

/** Can `to` finish a lob at the rim right now? */
export function oopReady(ctx: Ctx, to: number): boolean {
  const q = ctx.players[to];
  const dir = dirOf(ctx, q.team);
  const d = distToBasket(q.pos.x, q.pos.z, dir);
  if (d > 9 || d < 1.2) return false;
  toBasket(ctx, q, tA);
  const along = q.vel.x * tA.x + q.vel.z * tA.z;
  const r = q.data.ratings;
  return (along > 1.8 || ctx.intents[to].cut) && (canDunk(q) || r.layup >= 62);
}

export function startPass(ctx: Ctx, from: number, to: number, kind: PassKind): boolean {
  const ball = ctx.ball;
  const p = ctx.players[from];
  const x = ctx.px[from];
  if (ball.holder !== from || x.passing || x.shot.on || p.stunned > 0) return false;
  if (to < 0 || to === from || sideOf(to) !== p.team || !ctx.px[to].active) return false;
  x.passing = true;
  x.passTarget = to;
  x.passKind = kind;
  const st = ctx.state;
  setAction(ctx, from, st.phase === "inbound" ? "inbound" : "pass", st.phase === "inbound" ? 0.45 : 0.32 - (p.data.ratings.passing / 99) * 0.06);
  if (ball.mode === "dribble") ball.mode = "held";
  const q = ctx.players[to];
  p.facing = yawTo(p.pos.x, p.pos.z, q.pos.x, q.pos.z);
  return true;
}

/** The ball leaves the passer's hands (pass action P = 0.4). */
export function releasePass(ctx: Ctx, from: number): void {
  const st = ctx.state;
  const ball = ctx.ball;
  const p = ctx.players[from];
  const x = ctx.px[from];
  x.passing = false;
  const to = x.passTarget;
  if (ball.holder !== from) return;
  if (to < 0 || to === from || !ctx.px[to].active) return;
  const q = ctx.players[to];
  let kind = x.passKind;
  const r = p.data.ratings;
  const speed = 9.5 + (r.passing / 99) * 4.5;
  const start = tA.copy(ball.pos);
  let dist = horizDist(start.x, start.z, q.pos.x, q.pos.z);
  if (kind === "chest" && dist > 11) kind = "overhead";
  if (kind === "lob" && oopReady(ctx, to)) kind = "alleyOop";
  let T: number;
  const end = tE;
  ctx.passId++;
  if (kind === "alleyOop") {
    const dir = dirOf(ctx, q.team);
    const rim = dir * COURT.rimX;
    toBasket(ctx, q, tB);
    end.set(rim - tB.x * 0.5, COURT.rimHeight + 0.32, -tB.z * 0.5);
    dist = horizDist(start.x, start.z, end.x, end.z);
    T = clamp(0.75 + dist * 0.025, 0.8, 1.2);
    const qx = ctx.px[to];
    qx.oopAt = ctx.time + T - 0.52;
  } else {
    const lead = kind === "lob" ? 0.9 : 0.8;
    T = kind === "lob" ? 0.55 + dist * 0.045 : kind === "bounce" ? dist / (speed * 0.8) : kind === "overhead" ? dist / (speed * 0.95) + 0.08 : Math.max(0.14, dist / speed);
    end.set(q.pos.x + q.vel.x * T * lead, q.pos.y + q.height * (kind === "lob" ? 0.9 : 0.62), q.pos.z + q.vel.z * T * lead);
    if (Math.abs(q.pos.z) < COURT.halfW) end.z = clamp(end.z, -COURT.halfW + 0.3, COURT.halfW - 0.3);
    if (Math.abs(q.pos.x) < COURT.halfL) end.x = clamp(end.x, -COURT.halfL + 0.3, COURT.halfL - 0.3);
    dist = horizDist(start.x, start.z, end.x, end.z);
    T = kind === "lob" ? 0.55 + dist * 0.045 : kind === "bounce" ? dist / (speed * 0.8) : kind === "overhead" ? dist / (speed * 0.95) + 0.08 : Math.max(0.14, dist / speed);
    const err = 0.012 + (1 - r.passing / 99) * 0.045 + (dist > 12 ? 0.035 : 0) + (kind === "lob" ? 0.02 : 0) + (p.pos.y > 0.2 ? 0.04 : 0);
    if (ctx.rng() < err) {
      const a = ctx.rng() * Math.PI * 2;
      const m = 1.4 + ctx.rng() * 1.2;
      end.x += Math.cos(a) * m;
      end.z += Math.sin(a) * m;
    }
  }
  const pi = ctx.passObj;
  pi.from = from;
  pi.to = to;
  pi.kind = kind;
  pi.flight = T;
  pi.t = 0;
  pi.start.copy(start);
  pi.end.copy(end);
  ball.pass = pi;
  ball.mode = "pass";
  ball.holder = -1;
  p.hasBall = false;
  st.ballHandler = -1;
  st.lastTouch = from;
  if (kind === "bounce") {
    const t1 = T * 0.58;
    tB.lerpVectors(start, end, 0.58).setY(COURT.ballR);
    launchTime(start, tB, t1, ball.vel);
    ctx.bounceSeg.on = true;
    ctx.bounceSeg.left = t1;
    ctx.bounceSeg.end.copy(end);
    ctx.bounceSeg.t2 = T - t1;
  } else {
    ctx.bounceSeg.on = false;
    launchTime(start, end, T, ball.vel);
  }
  ball.spin.set(0, 0, 0);
  emit(ctx, { type: "pass", from, to, kind });
  if (st.phase === "inbound") {
    ctx.inboundPassed = true;
    x.spotOn = false;
  }
  // practice and the tutorial keep the user on one player: the receiver kicks it back (practiceUpdate)
  if (isUser(ctx, from) && ctx.mode !== "practice") setUser(ctx, to);
}

export function passFlight(ctx: Ctx, dt: number): void {
  const ball = ctx.ball;
  const pi = ball.pass;
  if (!pi) {
    ball.mode = "loose";
    return;
  }
  pi.t += dt;
  const q = ctx.players[pi.to];
  const bs = ctx.bounceSeg;
  if (bs.on) {
    integrate(ball.pos, ball.vel, Math.min(dt, bs.left));
    bs.left -= dt;
    if (bs.left <= 0) {
      ball.pos.y = COURT.ballR;
      bs.on = false;
      emit(ctx, { type: "bounce", at: v3(ball.pos), strength: 0.45 });
      launchTime(ball.pos, bs.end, Math.max(0.08, bs.t2), ball.vel);
    }
  } else {
    const rem = pi.flight - pi.t;
    if (rem > 0.04 && pi.kind !== "alleyOop" && q.stunned <= 0) {
      tB.set(q.pos.x + q.vel.x * rem * 0.6, q.pos.y + q.height * (pi.kind === "lob" ? 0.9 : 0.62), q.pos.z + q.vel.z * rem * 0.6);
      if (horizDist(tB.x, tB.z, pi.end.x, pi.end.z) < 2.6) {
        pi.end.lerp(tB, 0.2);
        launchTime(ball.pos, pi.end, rem, ball.vel);
      }
    }
    physics(ctx, dt);
    if (ball.mode !== "pass") return;
  }
  if (intercept(ctx)) return;
  // catch
  if (pi.t > 0.05 && q.stunned <= 0) {
    const oop = pi.kind === "alleyOop";
    const hy = oop ? q.pos.y + q.reach - 0.1 : q.pos.y + q.height * 0.62;
    const dx = ball.pos.x - q.pos.x;
    const dz = ball.pos.z - q.pos.z;
    const dy = Math.max(0, Math.abs(ball.pos.y - hy) - 0.35);
    const d = Math.sqrt(dx * dx + dz * dz + dy * dy);
    const radius = oop ? 0.75 : q.radius + 0.3 + (isUser(ctx, pi.to) ? 0.25 : 0);
    if (d < radius) {
      emit(ctx, { type: "catch", slot: pi.to, at: v3(ball.pos) });
      gainControl(ctx, pi.to, "catch");
      const sp = Math.hypot(q.vel.x, q.vel.z);
      if (!oop && ctx.ball.holder === pi.to && (sp > 2.6 || ctx.intents[pi.to].move.lengthSq() > 0.3) && ctx.state.phase === "live") {
        ctx.ball.mode = "dribble";
      }
      return;
    }
  }
  if (pi.t > pi.flight + 0.3) {
    ctx.passLoose = { passer: pi.from, team: sideOf(pi.from), deflector: -1 };
    ball.mode = "loose";
    ball.pass = null;
  }
}

function intercept(ctx: Ctx): boolean {
  const ball = ctx.ball;
  const pi = ball.pass;
  if (!pi || pi.t < 0.05) return false;
  const team = sideOf(pi.from);
  const base = team === 0 ? 5 : 0;
  const passer = ctx.players[pi.from];
  for (let i = base; i < base + 5; i++) {
    const x = ctx.px[i];
    if (!x.active || x.interceptPass === ctx.passId) continue;
    const d = ctx.players[i];
    if (d.stunned > 0) continue;
    const stealing = d.action === "steal";
    const top = d.reach + d.pos.y + (stealing ? 0.15 : 0);
    if (ball.pos.y > top || ball.pos.y < 0.15) continue;
    const hd = horizDist(d.pos.x, d.pos.z, ball.pos.x, ball.pos.z);
    const reach = d.radius + 0.15 + (stealing ? 0.45 : 0) + (d.data.ratings.steal / 99) * 0.12;
    if (hd > reach) continue;
    // only a defender the ball is still travelling toward can get a hand on it
    const ahead = (d.pos.x - ball.pos.x) * ball.vel.x + (d.pos.z - ball.pos.z) * ball.vel.z;
    if (ahead < 0 && hd > d.radius) continue;
    if (horizDist(passer.pos.x, passer.pos.z, ball.pos.x, ball.pos.z) < 1.0) continue;
    x.interceptPass = ctx.passId;
    const kindF = pi.kind === "lob" || pi.kind === "alleyOop" ? 0.5 : pi.kind === "bounce" ? 0.8 : pi.kind === "overhead" ? 0.85 : 1;
    const speed = Math.hypot(ball.vel.x, ball.vel.z);
    const pr = (0.006 + (0.033 * d.data.ratings.steal) / 99) * kindF * (1.15 - (passer.data.ratings.passing / 99) * 0.35) *
      stealMult(ctx, d.team) * (stealing ? 2.6 : 1) * (ctx.state.phase === "inbound" ? 0.6 : 1) * clamp(1.4 - speed * 0.05, 0.7, 1.2);
    if (ctx.rng() >= pr) continue;
    ctx.passLoose = { passer: pi.from, team, deflector: i };
    if (!busy(d)) setAction(ctx, i, "steal");
    if (ctx.rng() < 0.55) {
      gainControl(ctx, i, "steal");
    } else {
      emit(ctx, { type: "deflection", by: i, at: v3(ball.pos) });
      const a = (ctx.rng() - 0.5) * 2.4;
      ball.vel.set(ball.vel.x * 0.25 + Math.cos(a) * 2, 1.2 + ctx.rng() * 1.5, ball.vel.z * 0.25 + Math.sin(a) * 2);
      ball.mode = "loose";
      ball.pass = null;
      ctx.bounceSeg.on = false;
      ctx.state.lastTouch = i;
      ctx.px[pi.to].oopAt = -1;
    }
    return true;
  }
  return false;
}
