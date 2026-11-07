import * as THREE from "three";
import type { Dir, PlayerState } from "./contracts";
import { COURT, inBounds } from "./contracts";
import type { Ctx } from "./sim-core";
import {
  G, busy, clamp, emit, foulMult, horizDist, integrate, isMoveAction, isShotAction, launchTime, setAction, sideOf, v3, vertOf,
} from "./sim-core";
import { gatherBallPos, jumpFor } from "./sim-shot";
import { foulStop, gainControl, outOfBounds, registerMake, registerMiss, tipped } from "./sim-rules";

// Ball: where it sits in the hands, dribble cycle, flight physics (gravity, rim torus, backboard, floor), the net,
// scripted made-shot paths, loose balls and rebounds. Owner: sim builder.

const R = COURT.ballR;
const RIM_R = COURT.rimRadius + COURT.rimTube; // ring tube center radius
const RIM_HIT = COURT.ballR + COURT.rimTube;
const f = new THREE.Vector3();
const r = new THREE.Vector3();
const hA = new THREE.Vector3();
const hB = new THREE.Vector3();
const fl = new THREE.Vector3();
const tmp = new THREE.Vector3();

function hand(p: PlayerState, side: number, out: THREE.Vector3, low = 1): THREE.Vector3 {
  return out.set(
    p.pos.x + r.x * side * 0.28 + f.x * 0.22,
    p.pos.y + p.height * 0.47 * low,
    p.pos.z + r.z * side * 0.28 + f.z * 0.22,
  );
}

function curveY(hy: number, s: number, down: boolean): number {
  // down: leaves the hand fast; up: slows into the hand
  const k = down ? s * (0.55 + 0.45 * s) : 1 - (1 - s) * (1 - s);
  return down ? hy + (R - hy) * k : R + (hy - R) * k;
}

/** Ball position when someone holds or dribbles it. */
export function placeHeld(ctx: Ctx, dt: number): void {
  const ball = ctx.ball;
  const p = ctx.players[ball.holder];
  if (!p) return;
  const x = ctx.px[ball.holder];
  ctx.prevBall.copy(ball.pos);
  f.set(Math.sin(p.facing), 0, Math.cos(p.facing));
  r.set(-Math.cos(p.facing), 0, Math.sin(p.facing));
  const h = p.height;
  const y0 = p.pos.y;
  const side = ball.dribbleHand;
  const st = ctx.state;
  if (gatherBallPos(ctx, p, ball.pos)) {
    // shot gather
  } else if (st.phase === "inbound" && st.inbound && st.inbound.passer === p.slot && !x.passing) {
    ball.pos.set(p.pos.x + f.x * 0.22, y0 + h * 1.06, p.pos.z + f.z * 0.22);
  } else if ((p.action === "pass" || p.action === "inbound") && x.passing) {
    const k = clamp(p.actionP / 0.4, 0, 1);
    const high = x.passKind === "lob" || x.passKind === "alleyOop" || x.passKind === "inbound";
    const low = x.passKind === "bounce";
    ball.pos.set(
      p.pos.x + f.x * (0.3 + 0.25 * k),
      y0 + h * (high ? 0.65 + 0.4 * k : low ? 0.6 - 0.12 * k : 0.64),
      p.pos.z + f.z * (0.3 + 0.25 * k),
    );
  } else if (p.action === "pumpFake") {
    const k = Math.sin(clamp(p.actionP, 0, 1) * Math.PI);
    ball.pos.set(p.pos.x + f.x * 0.22, y0 + h * (0.62 + 0.42 * k), p.pos.z + f.z * 0.22);
  } else if (p.action === "rebound" || p.action === "jumpBall") {
    const k = clamp((p.actionP - 0.3) / 0.6, 0, 1);
    ball.pos.set(p.pos.x + f.x * 0.25, y0 + p.reach - 0.1 - (p.reach - 0.1 - h * 0.62) * k, p.pos.z + f.z * 0.25);
  } else if (ball.mode === "dribble" && isMoveAction(p.action) && p.action !== "spin" && p.action !== "hesitation" && p.action !== "stepBack") {
    const P = p.actionP;
    const old = P < 0.5 ? side : -side;
    hand(p, old, hA);
    hand(p, -old, hB);
    const ahead = p.action === "crossover" ? 0.42 : p.action === "between" ? 0.04 : -0.3;
    fl.set(p.pos.x + f.x * ahead, R, p.pos.z + f.z * ahead);
    if (P < 0.5) {
      const s = P / 0.5;
      ball.pos.lerpVectors(hA, fl, s);
      ball.pos.y = curveY(hA.y, s, true);
    } else {
      const s = (P - 0.5) / 0.5;
      ball.pos.lerpVectors(fl, hB, s);
      ball.pos.y = curveY(hB.y, s, false);
    }
  } else if (ball.mode === "dribble" && p.action === "spin") {
    ball.pos.set(p.pos.x + r.x * side * 0.34, y0 + h * 0.52, p.pos.z + r.z * side * 0.34);
  } else if (ball.mode === "dribble") {
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const post = ctx.intents[p.slot].post;
    const pressure = p.crouch > 0.45;
    const hz = post ? 1.5 : p.action === "hesitation" ? 1.25 : Math.min(2.7, 1.75 + speed * 0.11 + (pressure ? 0.25 : 0));
    const prev = ball.dribblePhase;
    ball.dribblePhase = (ball.dribblePhase + dt * hz) % 1;
    const low = post ? 0.78 : pressure ? 0.85 : 1;
    if (post) {
      hA.set(p.pos.x + r.x * side * 0.33 - f.x * 0.05, y0 + h * 0.42, p.pos.z + r.z * side * 0.33 - f.z * 0.05);
      fl.set(p.pos.x + r.x * side * 0.36, R, p.pos.z + r.z * side * 0.36);
    } else {
      hand(p, side, hA, low);
      const ahead = 0.32 + Math.min(speed, 8) * 0.07;
      fl.set(p.pos.x + r.x * side * 0.3 + f.x * ahead, R, p.pos.z + r.z * side * 0.3 + f.z * ahead);
    }
    const ph = ball.dribblePhase;
    if (ph < 0.5) {
      const s = ph / 0.5;
      ball.pos.lerpVectors(hA, fl, s);
      ball.pos.y = curveY(hA.y, s, true);
    } else {
      const s = (ph - 0.5) / 0.5;
      ball.pos.lerpVectors(fl, hA, s);
      ball.pos.y = curveY(hA.y, s, false);
    }
    if (prev < 0.5 && ball.dribblePhase >= 0.5) {
      x.dribbles++;
      emit(ctx, { type: "dribble", slot: p.slot, at: v3(ball.pos), strength: clamp(0.45 + speed * 0.07, 0, 1) });
    }
  } else {
    // triple threat / post hold / catch
    const post = ctx.intents[p.slot].post;
    if (post) ball.pos.set(p.pos.x + r.x * side * 0.3 - f.x * 0.05, y0 + h * 0.5, p.pos.z + r.z * side * 0.3 - f.z * 0.05);
    else ball.pos.set(p.pos.x + f.x * 0.3 + r.x * side * 0.12, y0 + h * 0.56, p.pos.z + f.z * 0.3 + r.z * side * 0.12);
  }
  if (dt > 0) {
    ball.vel.set((ball.pos.x - ctx.prevBall.x) / dt, (ball.pos.y - ctx.prevBall.y) / dt, (ball.pos.z - ctx.prevBall.z) / dt);
    if (ball.vel.lengthSq() > 400) ball.vel.setLength(20);
  }
  ball.spin.set(r.x * 10 * Math.sign(ball.vel.y || 1), 0, r.z * 10 * Math.sign(ball.vel.y || 1));
  ball.side = 0;
  ball.inNet = 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------------------------------------------------
function rimContact(ctx: Ctx, s: Dir, strength: number): void {
  const ball = ctx.ball;
  ball.lastRim = ctx.time;
  if (ctx.time - ctx.rimEvT > 0.07) {
    ctx.rimEvT = ctx.time;
    emit(ctx, { type: "rim", side: s, strength: clamp(strength / 5, 0.1, 1), at: { x: s * COURT.rimX, y: COURT.rimHeight, z: 0 } });
  }
  if (ball.mode === "shot" || ctx.reboundPending || ctx.state.phase === "freeThrow") ctx.shotObj.touchedRim = true;
  if (ball.mode === "shot" && !ctx.shotResolved && !ctx.shotObj.make) {
    ball.mode = "loose";
    registerMiss(ctx, false, false);
  } else if (ball.mode === "shot" && ctx.shotResolved) ball.mode = "loose";
  ball.spin.set((ctx.rng() - 0.5) * 30, (ctx.rng() - 0.5) * 20, (ctx.rng() - 0.5) * 30);
}

function boardContact(ctx: Ctx, s: Dir, strength: number): void {
  const ball = ctx.ball;
  if (ctx.time - ctx.boardEvT > 0.08) {
    ctx.boardEvT = ctx.time;
    emit(ctx, { type: "backboard", side: s, strength: clamp(strength / 6, 0.1, 1), at: v3(ball.pos) });
  }
  if (ball.mode === "shot" && !ctx.shotResolved && !ctx.shotObj.make) {
    ball.mode = "loose";
    registerMiss(ctx, false, false);
  }
}

function collideRim(ctx: Ctx, s: Dir): void {
  const ball = ctx.ball;
  const p = ball.pos;
  const v = ball.vel;
  const cx = s * COURT.rimX;
  const cy = COURT.rimHeight;
  const dx = p.x - cx;
  const dz = p.z;
  const hd = Math.sqrt(dx * dx + dz * dz);
  if (hd > RIM_R + 0.4 || Math.abs(p.y - cy) > 0.4) return;
  // a ball that is not a make never drops through: it spins out (in-and-out)
  const allowIn = (ball.mode === "shot" && ctx.shotObj.make) || ctx.net.on;
  if (!allowIn && hd < COURT.rimRadius - R * 0.55 && p.y < cy + 0.06 && p.y > cy - 0.3 && v.y < 0) {
    let ux = hd > 0.01 ? dx / hd : 1;
    let uz = hd > 0.01 ? dz / hd : 0;
    if (hd <= 0.01) {
      const a = ctx.rng() * Math.PI * 2;
      ux = Math.cos(a);
      uz = Math.sin(a);
    }
    p.set(cx + ux * (COURT.rimRadius - R * 0.5), cy + 0.08, uz * (COURT.rimRadius - R * 0.5));
    v.set(ux * 1.7, Math.max(1.3, -v.y * 0.35), uz * 1.7);
    rimContact(ctx, s, 2.5);
    return;
  }
  const qx = hd > 1e-5 ? cx + (dx / hd) * RIM_R : cx + RIM_R;
  const qz = hd > 1e-5 ? (dz / hd) * RIM_R : 0;
  let nx = p.x - qx;
  let ny = p.y - cy;
  let nz = p.z - qz;
  const d = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (d >= RIM_HIT || d < 1e-6) return;
  nx /= d;
  ny /= d;
  nz /= d;
  p.set(qx + nx * RIM_HIT, cy + ny * RIM_HIT, qz + nz * RIM_HIT);
  const vn = v.x * nx + v.y * ny + v.z * nz;
  if (vn < 0) {
    const e = COURT.ballRestitutionRim;
    v.x -= (1 + e) * vn * nx;
    v.y -= (1 + e) * vn * ny;
    v.z -= (1 + e) * vn * nz;
    const vn2 = v.x * nx + v.y * ny + v.z * nz;
    v.x = nx * vn2 + (v.x - nx * vn2) * 0.86;
    v.y = ny * vn2 + (v.y - ny * vn2) * 0.86;
    v.z = nz * vn2 + (v.z - nz * vn2) * 0.86;
    rimContact(ctx, s, -vn);
  }
}

function collideBoard(ctx: Ctx, s: Dir): void {
  const ball = ctx.ball;
  const p = ball.pos;
  const v = ball.vel;
  const sx = s * p.x;
  if (sx < COURT.boardX - R || sx > COURT.boardX + COURT.boardThick + R * 0.5) return;
  if (Math.abs(p.z) > COURT.boardW / 2 + R * 0.3) return;
  if (p.y < COURT.boardBottom - R * 0.3 || p.y > COURT.boardBottom + COURT.boardH + R * 0.3) return;
  if (s * v.x <= 0) return;
  const imp = Math.abs(v.x);
  p.x = s * (COURT.boardX - R);
  v.x = -v.x * COURT.ballRestitutionBoard;
  v.y *= 0.92;
  v.z *= 0.92;
  boardContact(ctx, s, imp);
}

function collideFloor(ctx: Ctx, dt: number): void {
  const ball = ctx.ball;
  const p = ball.pos;
  const v = ball.vel;
  if (p.y > R) return;
  p.y = R;
  if (v.y < 0) {
    const imp = -v.y;
    v.y = imp > 0.35 ? imp * COURT.ballRestitutionFloor : 0;
    v.x *= 0.9;
    v.z *= 0.9;
    if (imp > 0.7 && ctx.time - ctx.bounceEvT > 0.05) {
      ctx.bounceEvT = ctx.time;
      emit(ctx, { type: "bounce", at: v3(p), strength: clamp(imp / 7, 0.05, 1) });
    }
    onFloor(ctx);
  }
  if (v.y === 0) {
    const k = Math.max(0, 1 - 1.1 * dt);
    v.x *= k;
    v.z *= k;
    if (v.x * v.x + v.z * v.z < 0.0025) v.x = v.z = 0;
    ball.spin.set(v.z / R, 0, -v.x / R);
  }
}

function onFloor(ctx: Ctx): void {
  const ball = ctx.ball;
  const st = ctx.state;
  if (ball.mode === "shot") {
    if (!ctx.shotResolved) {
      const sh = ctx.shotObj;
      ball.mode = "loose";
      if (sh.make) registerMake(ctx);
      else registerMiss(ctx, !sh.touchedRim && !sh.blocked, false);
    } else ball.mode = "loose";
  }
  if (ball.mode === "pass") {
    const pi = ball.pass;
    if (pi && !ctx.bounceSeg.on) {
      ctx.passLoose = { passer: pi.from, team: sideOf(pi.from), deflector: -1 };
      ball.mode = "loose";
      ball.pass = null;
    }
  }
  if ((ball.mode === "loose" || ball.mode === "pass") && (st.phase === "live" || st.phase === "inbound") && !inBounds(ball.pos.x, ball.pos.z)) {
    outOfBounds(ctx, ball.pos.x, ball.pos.z);
  }
}

/** Free flight with collisions (loose, missed shots, dead bounces). */
export function physics(ctx: Ctx, dt: number): void {
  const ball = ctx.ball;
  const sp = ball.vel.length();
  const n = sp > 6 ? 3 : sp > 3 ? 2 : 1;
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const prevY = ball.pos.y;
    integrate(ball.pos, ball.vel, h);
    const s: Dir = ball.pos.x >= 0 ? 1 : -1;
    const ghost = ball.mode === "shot" && ctx.shotObj.make && !ctx.shotResolved;
    if (!ghost && !ctx.net.on) {
      collideBoard(ctx, s);
      collideRim(ctx, s);
    }
    collideFloor(ctx, h);
    makeCheck(ctx, prevY, s);
    net(ctx, h);
  }
  // stands and walls stop the ball
  const lx = COURT.halfL + 3.5;
  const lz = COURT.halfW + 3;
  if (Math.abs(ball.pos.x) > lx) {
    ball.pos.x = Math.sign(ball.pos.x) * lx;
    ball.vel.x *= -0.3;
  }
  if (Math.abs(ball.pos.z) > lz) {
    ball.pos.z = Math.sign(ball.pos.z) * lz;
    ball.vel.z *= -0.3;
  }
  ball.side = Math.abs(Math.abs(ball.pos.x) - COURT.rimX) < 2.5 && ball.pos.y > 1.5 ? (ball.pos.x > 0 ? 1 : -1) : ctx.net.on ? ctx.net.side : 0;
}

/** A made shot drops through the rim plane inside the ring. */
function makeCheck(ctx: Ctx, prevY: number, s: Dir): void {
  const ball = ctx.ball;
  if (ball.mode !== "shot" || ctx.shotResolved || !ctx.shotObj.make) return;
  const y = COURT.rimHeight - 0.05;
  if (!(prevY >= y && ball.pos.y < y)) return;
  if (horizDist(ball.pos.x, ball.pos.z, s * COURT.rimX, 0) > COURT.rimRadius) return;
  const sh = ctx.shotObj;
  ctx.net.on = true;
  ctx.net.side = s;
  ball.vel.x *= 0.25;
  ball.vel.z *= 0.25;
  if (sh.swish) emit(ctx, { type: "swish", side: s });
  else emit(ctx, { type: "net", side: s, strength: clamp(0.4 + Math.abs(ball.vel.y) / 10, 0, 1) });
  registerMake(ctx);
  if (ball.mode === "shot") ball.mode = "loose";
}

function net(ctx: Ctx, dt: number): void {
  const ball = ctx.ball;
  if (!ctx.net.on) {
    ball.inNet = 0;
    return;
  }
  const cx = ctx.net.side * COURT.rimX;
  const depth = COURT.rimHeight - ball.pos.y;
  ball.inNet = clamp(depth / COURT.netLength, 0, 1);
  const k = 1 - Math.exp(-14 * dt);
  ball.vel.x += ((cx - ball.pos.x) * 5 - ball.vel.x) * k;
  ball.vel.z += (-ball.pos.z * 5 - ball.vel.z) * k;
  if (ball.vel.y < -3.0) ball.vel.y += (-3.0 - ball.vel.y) * k * 1.5;
  if (depth > COURT.netLength + 0.05) {
    ctx.net.on = false;
    ball.inNet = 0;
    ball.vel.y = Math.min(ball.vel.y, -2.2);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Shot flight (made shots follow a scripted path; misses use physics)
// ---------------------------------------------------------------------------------------------------------------------
export function shotFlight(ctx: Ctx, dt: number): void {
  const ball = ctx.ball;
  const seg = ctx.seg;
  if (!seg.on) {
    physics(ctx, dt);
    return;
  }
  let rem = dt;
  while (rem > 1e-9 && seg.on) {
    const prevY = ball.pos.y;
    const step = Math.min(rem, seg.left);
    integrate(ball.pos, ball.vel, step);
    seg.left -= step;
    rem -= step;
    makeCheck(ctx, prevY, ctx.shotObj.target);
    if (seg.left <= 1e-9) {
      ball.pos.copy(seg.pts[seg.i]);
      const ev = seg.ev[seg.i];
      const s = ctx.shotObj.target;
      if (ev === 1) {
        ctx.shotObj.touchedRim = true;
        ball.lastRim = ctx.time;
        emit(ctx, { type: "rim", side: s, strength: seg.i === 0 ? 0.35 + ctx.rng() * 0.3 : 0.2, at: { x: s * COURT.rimX, y: COURT.rimHeight, z: 0 } });
      } else if (ev === 2) {
        emit(ctx, { type: "backboard", side: s, strength: 0.4 + ctx.rng() * 0.3, at: v3(ball.pos) });
      }
      seg.i++;
      if (seg.i < seg.n) {
        launchTime(ball.pos, seg.pts[seg.i], seg.dur[seg.i], ball.vel);
        seg.left = seg.dur[seg.i];
      } else seg.on = false;
    }
  }
  if (rem > 1e-9) physics(ctx, rem);
  ball.side = ctx.shotObj.target;
}

// ---------------------------------------------------------------------------------------------------------------------
// Loose balls and rebounds
// ---------------------------------------------------------------------------------------------------------------------
const cand: number[] = [];
const weight: number[] = [];

export function looseBall(ctx: Ctx, dt: number): void {
  const ball = ctx.ball;
  const st = ctx.state;
  if (ball.mode !== "loose") return;
  if (st.phase === "inbound" && ctx.inboundPassed) {
    st.phase = "live";
    st.inbound = null;
    if (ctx.mode !== "practice" && st.clock > 0) st.clockRunning = true;
  }
  if (st.phase !== "live") return;
  ctx.looseT += dt;
  const practice = ctx.mode === "practice";
  // reflex rebound jumps: time the jump so the hands meet the ball
  for (let s = 0; s < 10; s++) {
    const x = ctx.px[s];
    if (!x.active || (practice && sideOf(s) !== ctx.userTeam)) continue;
    const p = ctx.players[s];
    if (busy(p) || p.pos.y > 0.01 || p.stunned > 0) continue;
    const top = p.reach + vertOf(p) * 0.6;
    if (ball.pos.y < top - 0.3 || ball.pos.y > 4.6) continue;
    const vy = ball.vel.y;
    const disc = vy * vy + 2 * G * (ball.pos.y - top);
    if (disc < 0) continue;
    const t = (vy + Math.sqrt(disc)) / G;
    if (t < 0.22 || t > 0.5) continue;
    const bx = ball.pos.x + ball.vel.x * t;
    const bz = ball.pos.z + ball.vel.z * t;
    if (horizDist(p.pos.x + p.vel.x * t, p.pos.z + p.vel.z * t, bx, bz) > 1.0) continue;
    setAction(ctx, s, "rebound");
    x.jumpH = jumpFor(p, "rebound");
  }
  if (ctx.time - ball.lastRim < 0.1) return;
  cand.length = 0;
  weight.length = 0;
  let total = 0;
  for (let s = 0; s < 10; s++) {
    const x = ctx.px[s];
    if (!x.active || (practice && sideOf(s) !== ctx.userTeam)) continue;
    const p = ctx.players[s];
    if (p.stunned > 0 || (x.shot.on && !x.shot.released) || (isShotAction(p.action) && p.pos.y > 0.05)) continue;
    if (ctx.time < ctx.tipLockT && p.team !== ctx.tipLockTeam) continue;
    const hd = horizDist(p.pos.x, p.pos.z, ball.pos.x, ball.pos.z);
    const top = p.reach + p.pos.y + (p.action === "rebound" ? 0.12 : 0);
    // offensive crashers fight through bodies: they need the ball closer before they can secure it
    const grab = ctx.reboundPending && p.team === ctx.reboundTeam ? 0.2 : 0.42;
    if (hd > p.radius + grab || ball.pos.y > top) continue;
    const rt = ctx.reboundPending ? (p.team === ctx.reboundTeam ? p.data.ratings.offReb : p.data.ratings.defReb) : (p.data.ratings.iq + p.data.ratings.speed) / 2;
    let w = 1 + rt * 0.025 + (p.height - 1.9) * 2 + (p.radius + 0.42 - hd) * 2;
    if (ctx.reboundPending && p.team !== ctx.reboundTeam) w *= 1.9; // inside position belongs to the defense
    if (p.action === "boxOut") w *= 1.6;
    if (ctx.reboundPending && p.team === ctx.reboundTeam && sealed(ctx, s)) w *= 0.45; // boxed out
    w = Math.max(0.1, w);
    cand.push(s);
    weight.push(w);
    total += w;
  }
  if (cand.length === 0) return;
  let pick = cand[0];
  if (cand.length > 1) {
    let roll = ctx.rng() * total;
    for (let i = 0; i < cand.length; i++) {
      roll -= weight[i];
      if (roll <= 0) {
        pick = cand[i];
        break;
      }
    }
  }
  const p = ctx.players[pick];
  // battle on the boards: an opponent fighting for the same ball sometimes gets whistled for a loose-ball foul
  if (ctx.reboundPending && ctx.settings.fouls && ctx.mode !== "practice") {
    for (const o of cand) {
      if (o === pick || sideOf(o) === p.team) continue;
      const q = ctx.players[o];
      if (horizDist(q.pos.x, q.pos.z, p.pos.x, p.pos.z) > 0.95) continue;
      if (ctx.rng() < 0.12 * foulMult(ctx, o)) {
        foulStop(ctx, o, pick, "loose", p.pos.x, p.pos.z);
        return;
      }
      break;
    }
  }
  gainControl(ctx, pick, "loose");
  if (ctx.ball.holder === pick && p.pos.y > 0.05) setAction(ctx, pick, "rebound", Math.max(0.35, p.actionDur - p.actionT));
}

/** True when an opponent stands between this player and the rim he is crashing (a box-out seal). */
function sealed(ctx: Ctx, s: number): boolean {
  const p = ctx.players[s];
  const rx = (ctx.ball.shot ? ctx.ball.shot.target : Math.sign(p.pos.x) || 1) * COURT.rimX;
  const tx = rx - p.pos.x;
  const tz = -p.pos.z;
  const tl = Math.hypot(tx, tz) || 1;
  const base = p.team === 0 ? 5 : 0;
  for (let i = base; i < base + 5; i++) {
    if (!ctx.px[i].active) continue;
    const q = ctx.players[i];
    const dx = q.pos.x - p.pos.x;
    const dz = q.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.1 && (dx * tx + dz * tz) / (d * tl + 1e-6) > 0.35) return true;
  }
  return false;
}

/** Jump-ball tap: winner taps the ball toward a teammate. */
export function tipTo(ctx: Ctx, jumperSlot: number, toSlot: number): void {
  const ball = ctx.ball;
  const q = ctx.players[toSlot];
  tmp.set(q.pos.x, 1.2, q.pos.z);
  launchTime(ball.pos, tmp, 0.6, ball.vel);
  ball.mode = "loose";
  ball.holder = -1;
  // the tap goes to a teammate: opponents cannot grab it until it has reached him
  ctx.tipLockT = ctx.time + 0.8;
  ctx.tipLockTeam = sideOf(jumperSlot);
  tipped(ctx, jumperSlot);
}

/** Tip-off: ball follows the toss with no collisions. */
export function tossFlight(ctx: Ctx, dt: number): void {
  if (!ctx.tipTossed) return;
  integrate(ctx.ball.pos, ctx.ball.vel, dt);
}
