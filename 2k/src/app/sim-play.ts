import * as THREE from "three";
import type { Action, DribbleMove, PlayerState, TeamSide } from "./contracts";
import { ACTION_DUR, COURT, SIM_DT, inRestricted } from "./contracts";
import type { Ctx } from "./sim-core";
import {
  airY, busy, clamp, defaultMark, dirOf, emit, foulMult, horizDist, isJumpAction, isMoveAction, isShotAction, isUser,
  lastName, rumble, setAction, sideOf, stealMult, toast, toBasket, toneOf, v3, wrapAngle, yawTo,
} from "./sim-core";
import { foulStop, gainControl, hype } from "./sim-rules";
import { jumpFor, startShot, updateShot } from "./sim-shot";
import { choosePassTarget, oopReady, releasePass, startPass } from "./sim-pass";

// Players: commands from intents, locomotion, one-shot actions and their key moments, dribble moves, steals,
// take-charge, collisions, screens, stamina and derived values (openness, crouch, hands). Owner: sim builder.

const tB = new THREE.Vector3();
const tF = new THREE.Vector3();
const tR = new THREE.Vector3();
const vD = new THREE.Vector3();
const dv = new THREE.Vector3();

// ---------------------------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------------------------
export function processCommands(ctx: Ctx): void {
  const st = ctx.state;
  const ball = ctx.ball;
  for (let s = 0; s < 10; s++) {
    const it = ctx.intents[s];
    const cmd = it.cmd;
    if (cmd === "none") continue;
    let keep = false;
    const x = ctx.px[s];
    const p = ctx.players[s];
    if (!x.active || p.stunned > 0) {
      it.cmd = "none";
      continue;
    }
    const live = st.phase === "live";
    const offense = st.possession === p.team;
    switch (cmd) {
      case "shoot":
        if (st.phase === "freeThrow") {
          if (st.freeThrow && st.freeThrow.shooter === s && ctx.ftDelay <= 0) startShot(ctx, s, "freeThrow");
        } else if (live && ball.holder === s) {
          if (busy(p) && isMoveAction(p.action) && p.actionP < 0.35) keep = true;
          else startShot(ctx, s);
        } else if (live && ball.mode === "pass" && ball.pass && ball.pass.to === s) keep = true;
        break;
      case "pass":
      case "bouncePass":
      case "lobPass": {
        const inb = st.phase === "inbound" && !!st.inbound && st.inbound.passer === s && !ctx.inboundPassed;
        if (ball.holder === s && (live || inb) && !x.shot.on) {
          const target = it.target >= 0 && it.target !== s && sideOf(it.target) === p.team ? it.target : choosePassTarget(ctx, s, it.aim);
          if (target >= 0) {
            const kind = cmd === "bouncePass" ? "bounce" : cmd === "lobPass" ? (oopReady(ctx, target) ? "alleyOop" : "lob") : inb ? "inbound" : "chest";
            startPass(ctx, s, target, kind);
          }
        } else if (live && ball.mode === "pass" && ball.pass && ball.pass.to === s && isUser(ctx, s)) keep = true; // one-touch
        break;
      }
      case "dribbleMove":
        // buffered: a flick during the previous move (or a catch / pump fake) fires as soon as it can, so moves chain
        if (live && ball.holder === s && it.move2 && !startMove(ctx, s, it.move2)) {
          x.cmdAge += SIM_DT;
          if (x.cmdAge < 0.32 && busy(p) && !x.shot.on && !x.passing) keep = true;
        }
        break;
      case "pumpFake":
        if (live && ball.holder === s && !x.shot.on && !x.passing && !busy(p)) {
          setAction(ctx, s, "pumpFake");
          ball.mode = "held";
        }
        break;
      case "callScreen":
        if (ball.holder === s && offense) emit(ctx, { type: "screenCall", slot: s });
        break;
      case "steal":
        if (live && !offense) startSteal(ctx, s);
        break;
      case "block":
        if ((live || st.phase === "freeThrow") && !offense) startJump(ctx, s, "block");
        break;
      case "takeCharge":
        if (live && !offense) {
          x.chargeT = 0.9;
          p.vel.multiplyScalar(0.3);
        }
        break;
      default:
        break;
    }
    if (!keep) it.cmd = "none";
  }
  // human asked a teammate for the ball
  if (ctx.callForBall >= 0 && st.phase === "live") {
    const h = ball.holder;
    const c = ctx.callForBall;
    if (h >= 0 && h !== c && sideOf(h) === sideOf(c) && (ball.mode === "held" || ball.mode === "dribble") && !isUser(ctx, h)) {
      const lob = ctx.callLob;
      startPass(ctx, h, c, lob ? (oopReady(ctx, c) ? "alleyOop" : "lob") : "chest");
    }
    ctx.callForBall = -1;
  }
}

export function startJump(ctx: Ctx, s: number, a: Action): void {
  const p = ctx.players[s];
  const x = ctx.px[s];
  if (p.pos.y > 0.01 || p.stunned > 0) return;
  if (busy(p) && !(p.action === "defend" || p.action === "catch")) return;
  if (a === "block") {
    if (x.blockCd > 0) return;
    x.blockCd = 1.0;
  }
  setAction(ctx, s, a);
  x.jumpH = jumpFor(p, a);
  // lunge toward the ball
  const b = ctx.ball.pos;
  const dx = b.x - p.pos.x;
  const dz = b.z - p.pos.z;
  const d = Math.hypot(dx, dz);
  x.air.set(p.vel.x * 0.55, 0, p.vel.z * 0.55);
  if (d > 0.2 && d < 3) x.air.addScaledVector(tB.set(dx / d, 0, dz / d), Math.min(1.6, d));
  p.handsUp = 1;
}

function startSteal(ctx: Ctx, s: number): void {
  const p = ctx.players[s];
  const x = ctx.px[s];
  if (x.stealCd > 0 || p.pos.y > 0.01) return;
  if (busy(p) && p.action !== "catch") return;
  setAction(ctx, s, "steal");
  x.stealCd = 0.7;
  const b = ctx.ball.pos;
  p.facing = yawTo(p.pos.x, p.pos.z, b.x, b.z);
}

const MOVE_DUR: Record<DribbleMove, number> = {
  crossover: ACTION_DUR.crossover, behindBack: ACTION_DUR.behindBack, spin: ACTION_DUR.spin, stepBack: ACTION_DUR.stepBack,
  hesitation: ACTION_DUR.hesitation, between: ACTION_DUR.between,
};

export function startMove(ctx: Ctx, s: number, move: DribbleMove): boolean {
  const p = ctx.players[s];
  const x = ctx.px[s];
  const ball = ctx.ball;
  if (x.shot.on || x.passing || p.pos.y > 0.01) return false;
  const chain = isMoveAction(p.action) && p.actionP > 0.45;
  const fake = p.action === "pumpFake" && p.actionP > 0.4;
  if (busy(p) && !chain && !fake && p.action !== "catch") return false;
  if (ball.mode === "held") {
    ball.mode = "dribble";
    ball.dribblePhase = 0;
  }
  const r = p.data.ratings;
  setAction(ctx, s, move, MOVE_DUR[move] * (1.08 - (r.handle / 99) * 0.16));
  toBasket(ctx, p, tB);
  const rx = -tB.z;
  const rz = tB.x;
  const power = 2.6 + (r.handle / 99) * 2.0;
  const hand = ball.dribbleHand;
  const it = ctx.intents[s];
  const aimLat = it.aim.x * rx + it.aim.z * rz;
  switch (move) {
    case "crossover":
    case "between": {
      const nh = -hand;
      p.actionSide = nh as -1 | 1;
      x.burst.set(rx * nh * power * 0.9 + tB.x * 0.8, 0, rz * nh * power * 0.9 + tB.z * 0.8);
      break;
    }
    case "behindBack": {
      const nh = -hand;
      p.actionSide = nh as -1 | 1;
      x.burst.set(rx * nh * power * 0.8 + tB.x * 0.5, 0, rz * nh * power * 0.8 + tB.z * 0.5);
      break;
    }
    case "spin": {
      const side = aimLat !== 0 ? (aimLat > 0 ? 1 : -1) : hand;
      p.actionSide = side as -1 | 1;
      const c = Math.cos(0.95);
      const sn = Math.sin(0.95) * side;
      x.burst.set((tB.x * c + rx * sn) * power, 0, (tB.z * c + rz * sn) * power);
      x.spinBase = p.facing;
      break;
    }
    case "stepBack":
      p.actionSide = hand;
      x.burst.set(-tB.x * power * 1.05, 0, -tB.z * power * 1.05);
      break;
    case "hesitation":
      p.actionSide = hand;
      x.burst.set(tB.x * power * 1.2, 0, tB.z * power * 1.2);
      break;
  }
  x.lastMove = move;
  x.prevMoveT = x.lastMoveT;
  x.lastMoveT = ctx.time;
  p.stamina = Math.max(0.05, p.stamina - 0.005);
  x.plantT = 0;
  emit(ctx, { type: "dribbleMove", slot: s, move });
  return true;
}

/** Dribble move key moment (P = 0.5): can the move break the defender's ankles? */
function moveBite(ctx: Ctx, s: number): void {
  const p = ctx.players[s];
  const x = ctx.px[s];
  toBasket(ctx, p, tB);
  const base = p.team === 0 ? 5 : 0;
  let d = -1;
  let bd = 1.9;
  for (let i = base; i < base + 5; i++) {
    if (!ctx.px[i].active) continue;
    const q = ctx.players[i];
    const hd = horizDist(p.pos.x, p.pos.z, q.pos.x, q.pos.z);
    const front = ((q.pos.x - p.pos.x) * tB.x + (q.pos.z - p.pos.z) * tB.z) / (hd || 1);
    if (hd < bd && front > 0.15 && q.stunned <= 0) {
      bd = hd;
      d = i;
    }
  }
  if (d < 0) return;
  const q = ctx.players[d];
  const bl = Math.hypot(x.burst.x, x.burst.z) || 1;
  const lean = -(q.vel.x * x.burst.x + q.vel.z * x.burst.z) / bl; // defender moving against the move
  const handle = p.data.ratings.handle / 99;
  const user = ctx.userTeam !== -1 && p.team === ctx.userTeam;
  const combo = x.prevMoveT > 0 && x.lastMoveT - x.prevMoveT < 0.9 ? 1.6 : 1;
  const chance = 0.05 * handle * handle * (user ? ctx.diff.ankleBreak : 1) * (lean > 1.2 ? 2.2 : 1) *
    (1.3 - q.data.ratings.perimeterD / 99) * combo * (q.data.ratings.perimeterD > 85 ? 0.7 : 1);
  if (ctx.rng() < chance) {
    q.stunned = 1.4;
    setAction(ctx, d, "fall");
    q.vel.multiplyScalar(0.2);
    emit(ctx, { type: "ankleBreaker", by: s, victim: d });
    emit(ctx, { type: "crowd", reaction: "gasp", strength: 0.9 });
    emit(ctx, { type: "crowdHype", level: clamp(ctx.state.hype + 0.2, 0, 1), reason: "ankleBreaker" });
    emit(ctx, { type: "shake", strength: 0.25 });
    hype(ctx, 0.18);
    toast(ctx, "ANKLES", `${lastName(ctx, s).toUpperCase()} DROPS ${lastName(ctx, d).toUpperCase()}`, "hot");
    rumble(ctx, s, 0.5, 0.7, 260);
  } else if (lean > 0.6 || ctx.rng() < 0.35 * handle) {
    ctx.px[d].slowT = Math.max(ctx.px[d].slowT, 0.35 + 0.25 * handle);
  }
}

/** Steal key moment (P = 0.4). */
function resolveSteal(ctx: Ctx, s: number): void {
  const ball = ctx.ball;
  const st = ctx.state;
  if (st.phase !== "live") return;
  const d = ctx.players[s];
  const x = ctx.px[s];
  if (ball.holder < 0 || sideOf(ball.holder) === d.team || (ball.mode !== "held" && ball.mode !== "dribble")) return;
  const h = ctx.players[ball.holder];
  tF.set(Math.sin(d.facing), 0, Math.cos(d.facing));
  const hx = d.pos.x + tF.x * 0.55;
  const hz = d.pos.z + tF.z * 0.55;
  const reach = horizDist(hx, hz, ball.pos.x, ball.pos.z);
  if (reach > 0.75 + (d.data.ratings.steal / 99) * 0.2 || ball.pos.y > d.reach) {
    x.slowT = Math.max(x.slowT, 0.22);
    return;
  }
  const dB = horizDist(d.pos.x, d.pos.z, ball.pos.x, ball.pos.z);
  const dH = horizDist(d.pos.x, d.pos.z, h.pos.x, h.pos.z);
  const expo = dB < dH - 0.05 ? 1 : 0.35;
  const modeF = ball.mode === "held" ? (h.action === "postUp" ? 0.5 : 0.45) : isMoveAction(h.action) ? 1.25 : 1;
  tR.set(Math.sin(h.facing), 0, Math.cos(h.facing));
  const behind = ((d.pos.x - h.pos.x) * tR.x + (d.pos.z - h.pos.z) * tR.z) / (dH || 1) < -0.3;
  const sr = d.data.ratings.steal / 99;
  const hr = h.data.ratings.handle / 99;
  const pSteal = clamp((0.035 + 0.18 * sr - 0.15 * hr + 0.1 * expo) * modeF * stealMult(ctx, d.team) * (behind ? 1.2 : 1), 0.01, 0.32);
  const contact = dH < d.radius + h.radius + 0.12;
  const pFoul = ctx.settings.fouls ? (0.05 + (behind ? 0.18 : 0) + (contact ? 0.08 : 0) + (expo < 0.5 ? 0.06 : 0)) * foulMult(ctx, s) : 0;
  const roll = ctx.rng();
  if (roll < pSteal) {
    ctx.pokeBy = s;
    ctx.pokeFrom = ball.holder;
    rumble(ctx, ball.holder, 0.5, 0.4, 180);
    if (ctx.rng() < 0.55) {
      gainControl(ctx, s, "steal");
    } else {
      const from = ball.holder;
      const ux = ball.pos.x - h.pos.x;
      const uz = ball.pos.z - h.pos.z;
      const l = Math.hypot(ux, uz) || 1;
      const sp = 2 + ctx.rng() * 2;
      ball.vel.set((ux / l) * sp + tF.x, 1.4 + ctx.rng(), (uz / l) * sp + tF.z);
      ball.mode = "loose";
      ball.holder = -1;
      h.hasBall = false;
      st.ballHandler = -1;
      st.lastTouch = s;
      ctx.px[from].slowT = 0.3;
      emit(ctx, { type: "deflection", by: s, at: v3(ball.pos) });
    }
  } else if (roll < pSteal + pFoul) {
    foulStop(ctx, s, ball.holder, "reach", h.pos.x, h.pos.z);
  } else {
    x.slowT = Math.max(x.slowT, 0.2);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------------------------------------------------
function locked(a: Action): boolean {
  return isShotAction(a) || a === "pumpFake" || a === "block" || a === "contest" || a === "rebound" || a === "jumpBall" ||
    a === "steal" || a === "fall" || a === "pass" || a === "inbound" || isMoveAction(a);
}

function speedTarget(ctx: Ctx, p: PlayerState): number {
  const it = ctx.intents[p.slot];
  const x = ctx.px[p.slot];
  const st = ctx.state;
  const base = p.maxSpeed * (0.78 + 0.22 * p.stamina);
  let m = 0.6 + 0.4 * clamp(it.sprint, 0, 1);
  const defense = st.possession !== -1 && st.possession !== p.team && st.phase === "live";
  if (p.hasBall) m *= 0.93;
  if (defense && it.sprint < 0.5) m = it.intense ? 0.72 : 0.66;
  if (p.hasBall && it.post) m = 0.36;
  if (x.slowT > 0) m *= 0.45;
  if (p.action === "catch") m *= 0.85;
  if (st.phase !== "live" && st.phase !== "inbound") m = Math.min(m, 0.55);
  return base * m;
}

export function movePlayers(ctx: Ctx, dt: number): void {
  const st = ctx.state;
  const ball = ctx.ball;
  for (let s = 0; s < 10; s++) {
    const p = ctx.players[s];
    const x = ctx.px[s];
    const it = ctx.intents[s];
    p.user = isUser(ctx, s);
    if (!x.active) {
      p.vel.set(0, 0, 0);
      p.action = "idle";
      p.actionDur = 0;
      continue;
    }
    x.stealCd = Math.max(0, x.stealCd - dt);
    x.blockCd = Math.max(0, x.blockCd - dt);
    x.chargeT = Math.max(0, x.chargeT - dt);
    x.slowT = Math.max(0, x.slowT - dt);
    x.squeakCd = Math.max(0, x.squeakCd - dt);
    x.bumpCd = Math.max(0, x.bumpCd - dt);
    x.screenCd = Math.max(0, x.screenCd - dt);
    x.screenT = Math.max(0, x.screenT - dt);
    p.mark = it.mark >= 0 ? it.mark : defaultMark(s);
    if (p.hasBall) x.heldT += dt;

    // reflexes scheduled by sim (contests, alley-oop takeoff)
    if (x.contestAt >= 0 && ctx.time >= x.contestAt) {
      x.contestAt = -1;
      if (st.phase === "live" && (ball.mode === "shot" || (ball.holder >= 0 && ctx.px[ball.holder].shot.on))) startJump(ctx, s, x.contestBlock ? "block" : "contest");
    }
    if (x.oopAt >= 0 && ctx.time >= x.oopAt) {
      x.oopAt = -1;
      if (ball.mode === "pass" && ball.pass && ball.pass.to === s && !busy(p) && p.pos.y < 0.01) startOop(ctx, s);
    }

    // desired velocity
    const a = p.action;
    const P = p.actionP;
    let airborne = false;
    let free = false; // feet driven by the intent (not an action, spot or stun): gets the carve / plant model
    if (p.stunned > 0) {
      p.stunned = Math.max(0, p.stunned - dt);
      vD.set(0, 0, 0);
    } else if (x.spotOn) {
      const dx = x.spot.x - p.pos.x;
      const dz = x.spot.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      const sp = Math.min(p.maxSpeed * 0.6, d * 3);
      if (d > 0.04) vD.set((dx / d) * sp, 0, (dz / d) * sp);
      else vD.set(0, 0, 0);
    } else if (busy(p) && locked(a)) {
      airborne = p.pos.y > 0.001 || (isJumpAction(a) && airY(a, P, x.jumpH) > 0);
      if (isShotAction(a)) {
        const sp = x.shot;
        if (a === "layup" || a === "dunk") {
          const relT = (sp.on ? Math.max(sp.releaseP || 0.6, 0.55) : 0.6) * p.actionDur;
          const left = Math.max(0.1, relT - p.actionT);
          const dx = sp.finish.x - p.pos.x;
          const dz = sp.finish.z - p.pos.z;
          const d = Math.hypot(dx, dz);
          const v = Math.min(7.8, d / left);
          if (p.actionT < relT && d > 0.05) vD.set((dx / d) * v, 0, (dz / d) * v);
          else vD.set(0, 0, 0);
          airborne = false;
        } else if (a === "jumpShot" && sp.kind === "fadeaway") {
          toBasket(ctx, p, tB);
          vD.set(-tB.x * 1.3, 0, -tB.z * 1.3);
        } else if (a === "freeThrow") vD.set(0, 0, 0);
        else vD.copy(p.vel).multiplyScalar(Math.exp(-9 * dt));
      } else if (a === "steal") {
        tF.set(Math.sin(p.facing), 0, Math.cos(p.facing));
        vD.copy(tF).multiplyScalar(P < 0.5 ? 1.6 : 0.4);
      } else if (isMoveAction(a)) {
        vD.copy(it.move).setY(0);
        const ml = vD.length();
        if (ml > 1) vD.multiplyScalar(1 / ml);
        vD.multiplyScalar(speedTarget(ctx, p) * 0.6);
        const decay = Math.max(0, 1 - P);
        if (a === "stepBack") {
          if (P > 0.2 && P < 0.7) vD.copy(x.burst);
          else vD.multiplyScalar(0.2);
        } else if (a === "hesitation") {
          if (P < 0.45) vD.multiplyScalar(0.25);
          else vD.addScaledVector(x.burst, decay);
        } else vD.addScaledVector(x.burst, 0.35 + 0.65 * decay);
      } else if (a === "pass" || a === "inbound") {
        vD.copy(it.move).setY(0).multiplyScalar(speedTarget(ctx, p) * 0.4);
      } else vD.set(0, 0, 0);
    } else {
      free = true;
      vD.copy(it.move).setY(0);
      const ml = vD.length();
      if (ml > 1) vD.multiplyScalar(1 / ml);
      vD.multiplyScalar(speedTarget(ctx, p));
      if (x.chargeT > 0) vD.multiplyScalar(0.15);
      fallbackChase(ctx, s, vD);
      if (p.hasBall && ball.mode === "held" && st.phase === "live" && it.move.lengthSq() > 0.12 && !x.shot.on && !x.passing) {
        ball.mode = "dribble";
        ball.dribblePhase = 0;
      }
    }

    // CPU handlers respect the half-court line once the frontcourt is established (momentum would carry them over)
    const guardLine = ctx.frontEstablished && p.hasBall && !p.user && st.phase === "live" && st.possession === p.team;
    const fdir = guardLine ? dirOf(ctx, p.team) : 0;
    if (guardLine && p.pos.x * fdir < 1.5 && vD.x * fdir < 0) vD.x = 0;
    if (airborne) {
      p.vel.set(x.air.x, 0, x.air.z);
    } else if (free && carves(ctx, p)) {
      locomote(ctx, s, dt);
    } else {
      x.plantT = 0;
      const acc = p.user ? 28 + (p.data.ratings.accel / 99) * 14 : 16 + (p.data.ratings.accel / 99) * 14;
      dv.set(vD.x - p.vel.x, 0, vD.z - p.vel.z);
      const reverse = vD.x * p.vel.x + vD.z * p.vel.z < 0;
      const lim = acc * (reverse ? 1.5 : 1) * dt;
      const dl = dv.length();
      if (dl > lim) dv.multiplyScalar(lim / dl);
      const before = Math.hypot(p.vel.x, p.vel.z);
      p.vel.x += dv.x;
      p.vel.z += dv.z;
      x.air.set(p.vel.x, 0, p.vel.z);
      if (before > 3.6 && reverse && x.squeakCd <= 0) {
        x.squeakCd = 0.45;
        emit(ctx, { type: "squeak", slot: s, at: v3(p.pos), strength: clamp(before / 8, 0.2, 1) });
      }
    }
    p.vel.y = 0;
    if (guardLine && p.pos.x * fdir < 0.6 && p.vel.x * fdir < 0) p.vel.x *= Math.max(0, (p.pos.x * fdir - 0.2) / 0.4);
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    // CPU players stay on the floor during play; only the human can step out of bounds
    const inPlay = (st.phase === "live" || st.phase === "inbound") && !p.user && !x.spotOn;
    // a human without the ball (defender / off-ball) may drift at most ~1 m off the floor, never into the seats
    const live = st.phase === "live" || st.phase === "inbound";
    const out = p.user && live && !p.hasBall ? 0.9 : 1.8;
    const lx = inPlay ? COURT.halfL - p.radius : COURT.halfL + out;
    const lz = inPlay ? COURT.halfW - p.radius : COURT.halfW + out;
    if (inPlay && (Math.abs(p.pos.x) > lx || Math.abs(p.pos.z) > lz)) {
      if (Math.abs(p.pos.x) > lx && p.pos.x * p.vel.x > 0) p.vel.x *= 0.2;
      if (Math.abs(p.pos.z) > lz && p.pos.z * p.vel.z > 0) p.vel.z *= 0.2;
      const k = 1 - Math.exp(-10 * dt);
      p.pos.x += (clamp(p.pos.x, -lx, lx) - p.pos.x) * k;
      p.pos.z += (clamp(p.pos.z, -lz, lz) - p.pos.z) * k;
    } else {
      p.pos.x = clamp(p.pos.x, -lx, lx);
      p.pos.z = clamp(p.pos.z, -lz, lz);
    }

    // actions
    advanceAction(ctx, s, dt);
    p.pos.y = isJumpAction(p.action) && p.actionDur > 0 ? airY(p.action, p.actionP, x.jumpH) : 0;
    face(ctx, s, dt);
    pose(ctx, s, dt);
  }
}

/**
 * Ball handlers and the human on offense run on a momentum model instead of a capped vector chase: quick starts,
 * a hard stop when the stick lets go, speed-limited carving turns, and a plant-and-cut on a reversal at speed
 * (brief hard decel to 45 %, then re-accel the new way). Defenders keep the vector model: lateral slides need
 * instant reversals.
 */
function carves(ctx: Ctx, p: PlayerState): boolean {
  const st = ctx.state;
  if (p.hasBall) return true;
  return p.user && (st.possession === p.team || st.phase !== "live");
}

function locomote(ctx: Ctx, s: number, dt: number): void {
  const p = ctx.players[s];
  const x = ctx.px[s];
  const ar = p.data.ratings.accel / 99;
  const user = p.user;
  const accStart = user ? 26 + ar * 12 : 18 + ar * 12;
  const decStop = user ? 34 : 26;
  const decRun = user ? 26 : 18;
  const sp = Math.hypot(p.vel.x, p.vel.z);
  const tsp = Math.hypot(vD.x, vD.z);
  if (x.plantT > 0) {
    // planted: kill speed toward plantV along the new direction
    x.plantT -= dt;
    const k = tsp > 1e-3 ? x.plantV / tsp : 0;
    dv.set(vD.x * k - p.vel.x, 0, vD.z * k - p.vel.z);
    const lim = 75 * dt;
    const dl = dv.length();
    if (dl > lim) dv.multiplyScalar(lim / dl);
    p.vel.x += dv.x;
    p.vel.z += dv.z;
    x.air.set(p.vel.x, 0, p.vel.z);
    return;
  }
  if (tsp < 0.05) {
    // stick released: hard stop
    x.stopT += dt;
    const ns = Math.max(0, sp - decStop * dt);
    if (sp > 1e-4) p.vel.multiplyScalar(ns / sp);
    else p.vel.set(0, 0, 0);
    x.air.set(p.vel.x, 0, p.vel.z);
    return;
  }
  x.stopT = 0;
  if (sp < 1.2) {
    // from (almost) standing: explode toward the stick
    dv.set(vD.x - p.vel.x, 0, vD.z - p.vel.z);
    const lim = accStart * dt;
    const dl = dv.length();
    if (dl > lim) dv.multiplyScalar(lim / dl);
    p.vel.x += dv.x;
    p.vel.z += dv.z;
    x.air.set(p.vel.x, 0, p.vel.z);
    return;
  }
  const cosT = (p.vel.x * vD.x + p.vel.z * vD.z) / (sp * tsp);
  if (cosT < -0.17 && sp > 4) {
    // reversal (> 100 deg) at speed: plant and cut
    x.plantT = 0.12;
    x.plantV = sp * 0.45;
    if (x.squeakCd <= 0) {
      x.squeakCd = 0.35;
      emit(ctx, { type: "squeak", slot: s, at: v3(p.pos), strength: clamp(sp / 8, 0.3, 1) });
    }
    return;
  }
  const a0 = Math.atan2(p.vel.z, p.vel.x);
  const a1 = Math.atan2(vD.z, vD.x);
  const turnK = clamp((sp - 2) / 5.5, 0, 1);
  const omega = (16 + (p.hasBall ? -8.5 : -7) * turnK) * (0.85 + 0.3 * ar);
  const d = wrapAngle(a1 - a0);
  const step = clamp(d, -omega * dt, omega * dt);
  const a = a0 + step;
  let ns = sp;
  if (tsp > sp) ns = Math.min(tsp, sp + accStart * (1 - 0.35 * turnK) * dt);
  else ns = Math.max(tsp, sp - decRun * dt);
  // a sharp carve bleeds a little speed
  ns *= 1 - Math.abs(step) * 0.18;
  p.vel.set(Math.cos(a) * ns, 0, Math.sin(a) * ns);
  x.air.set(p.vel.x, 0, p.vel.z);
  if (sp > 5 && Math.abs(d) > 1.2 && x.squeakCd <= 0) {
    x.squeakCd = 0.5;
    emit(ctx, { type: "squeak", slot: s, at: v3(p.pos), strength: clamp(sp / 9, 0.2, 0.8) });
  }
}

/** No AI move on a loose ball (practice rebounder or a stuck CPU): nearest man chases it. */
function fallbackChase(ctx: Ctx, s: number, out: THREE.Vector3): void {
  const ball = ctx.ball;
  if (ball.mode !== "loose" || ctx.state.phase !== "live" || isUser(ctx, s)) return;
  const practice = ctx.mode === "practice";
  if (practice && sideOf(s) !== ctx.userTeam) return;
  if (!practice && (ctx.looseT < 0.8 || out.lengthSq() > 0.25)) return;
  const team = sideOf(s);
  let best = -1;
  let bd = 1e9;
  for (let i = team * 5; i < team * 5 + 5; i++) {
    if (!ctx.px[i].active || isUser(ctx, i)) continue;
    const q = ctx.players[i];
    const d = horizDist(q.pos.x, q.pos.z, ball.pos.x, ball.pos.z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  if (best !== s) return;
  const p = ctx.players[s];
  const dx = ball.pos.x - p.pos.x;
  const dz = ball.pos.z - p.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const sp = p.maxSpeed * 0.85;
  out.set((dx / d) * sp, 0, (dz / d) * sp);
}

function startOop(ctx: Ctx, s: number): void {
  const ball = ctx.ball;
  const p = ctx.players[s];
  const x = ctx.px[s];
  const dunk = p.data.ratings.dunk >= 55 && p.reach + 0.45 + (p.data.ratings.vertical - 25) * (0.5 / 74) >= COURT.rimHeight + 0.18;
  const sp = x.shot;
  sp.on = true;
  sp.kind = dunk ? "alleyOopDunk" : "alleyOopLayup";
  sp.points = 2;
  sp.minP = dunk ? 0.6 : 0.55;
  sp.targetP = 0.6;
  sp.maxP = dunk ? 0.6 : 0.75;
  sp.decided = true;
  sp.releaseP = dunk ? 0.6 : 0.62;
  sp.released = false;
  sp.grade = "none";
  sp.user = false;
  sp.startT = ctx.time;
  sp.alley = true;
  sp.style = dunk ? (ctx.rng() < 0.5 ? "twoHand" : "oneHand") : null;
  p.dunkStyle = sp.style;
  const pi = ball.pass;
  if (pi) sp.finish.set(pi.end.x - (pi.end.x - p.pos.x) * 0.12, 0, pi.end.z - (pi.end.z - p.pos.z) * 0.12);
  else sp.finish.set(p.pos.x, 0, p.pos.z);
  sp.from.set(p.pos.x, 0, p.pos.z);
  setAction(ctx, s, dunk ? "dunk" : "layup");
  x.jumpH = 0.45 + (p.data.ratings.vertical - 25) * (0.5 / 74);
  emit(ctx, { type: "shotStart", slot: s, kind: sp.kind });
}

function advanceAction(ctx: Ctx, s: number, dt: number): void {
  const p = ctx.players[s];
  const x = ctx.px[s];
  const ball = ctx.ball;
  if (p.actionDur > 0) {
    const prev = x.prevP;
    p.actionT += dt;
    const P = Math.min(1, p.actionT / p.actionDur);
    p.actionP = P;
    const a = p.action;
    if ((a === "pass" || a === "inbound") && x.passing && prev < 0.4 && P >= 0.4) releasePass(ctx, s);
    else if ((a === "crossover" || a === "between" || a === "behindBack") && prev < 0.5 && P >= 0.5) {
      if (ball.holder === s) {
        ball.dribbleHand = (ball.dribbleHand === 1 ? -1 : 1);
        x.dribbles++;
        emit(ctx, { type: "dribble", slot: s, at: v3(ball.pos), strength: 0.7 });
      }
      moveBite(ctx, s);
    } else if ((a === "spin" || a === "stepBack" || a === "hesitation") && prev < 0.5 && P >= 0.5) moveBite(ctx, s);
    else if (a === "steal" && prev < 0.4 && P >= 0.4) resolveSteal(ctx, s);
    if (a === "spin") p.facing = wrapAngle(x.spinBase + p.actionSide * Math.PI * 2 * (P * P * (3 - 2 * P)));
    if (x.shot.on && isShotAction(a)) {
      if (x.shot.alley && ball.holder !== s && P >= x.shot.releaseP) {
        x.shot.on = false;
      } else updateShot(ctx, s);
    }
    x.prevP = P;
    if (p.actionT >= p.actionDur) {
      if (isMoveAction(a) && ball.holder === s && ball.mode === "dribble") ball.dribblePhase = 0;
      if (x.shot.on && x.shot.released) x.shot.on = false;
      if (x.shot.on && !x.shot.released && isShotAction(a)) {
        x.shot.on = false;
        p.meter.active = false;
      }
      if (a === "fall" && p.stunned > 0) {
        p.actionT = p.actionDur;
        return;
      }
      p.actionDur = 0;
      p.actionT = 0;
      p.action = loopAction(ctx, p);
      p.actionP = 0;
    }
    return;
  }
  const want = loopAction(ctx, p);
  if (want !== p.action) p.action = want;
  p.actionT += dt;
  const speed = Math.hypot(p.vel.x, p.vel.z);
  const cad = p.action === "dribble" || p.action === "run" || p.action === "sprint" || p.action === "walk" ? 0.75 + speed * 0.22 : 0.5;
  p.actionP = (p.actionP + dt * cad) % 1;
}

function loopAction(ctx: Ctx, p: PlayerState): Action {
  const st = ctx.state;
  const ball = ctx.ball;
  const x = ctx.px[p.slot];
  const it = ctx.intents[p.slot];
  const speed = Math.hypot(p.vel.x, p.vel.z);
  if (p.hasBall) {
    if (it.post) return "postUp";
    if (st.phase === "inbound" && st.inbound && st.inbound.passer === p.slot) return "inbound";
    if (ball.mode === "dribble") return "dribble";
    return speed > 0.4 ? "walk" : "idle";
  }
  const live = st.phase === "live";
  if (live && x.screenT > 0) return "screen";
  if (live && st.possession !== -1 && st.possession !== p.team) {
    if ((ball.mode === "shot" || (ball.mode === "loose" && ctx.reboundPending)) && boxingOut(ctx, p)) return "boxOut";
    if (speed > 5.2 && it.sprint > 0.5) return "sprint";
    const m = ctx.players[p.mark];
    if (m && horizDist(p.pos.x, p.pos.z, m.pos.x, m.pos.z) < 5 && speed < 4.5) return "defend";
  }
  if (live && st.possession === p.team && it.post) return "postUp";
  if (speed > 5.4) return "sprint";
  if (speed > 1.8) return "run";
  if (speed > 0.3) return "walk";
  return p.stamina < 0.3 ? "tired" : "idle";
}

function boxingOut(ctx: Ctx, p: PlayerState): boolean {
  const dir = dirOf(ctx, (1 - p.team) as TeamSide);
  const rimX = dir * COURT.rimX;
  if (horizDist(p.pos.x, p.pos.z, rimX, 0) > 5) return false;
  const m = ctx.players[p.mark];
  if (!m) return false;
  const d = horizDist(p.pos.x, p.pos.z, m.pos.x, m.pos.z);
  if (d > 1.4) return false;
  return horizDist(p.pos.x, p.pos.z, rimX, 0) < horizDist(m.pos.x, m.pos.z, rimX, 0);
}

function face(ctx: Ctx, s: number, dt: number): void {
  const p = ctx.players[s];
  const x = ctx.px[s];
  const it = ctx.intents[s];
  const st = ctx.state;
  const ball = ctx.ball;
  if (p.action === "spin" && p.actionDur > 0) {
    p.turnRate = 0;
    return;
  }
  const speed = Math.hypot(p.vel.x, p.vel.z);
  const dir = dirOf(ctx, p.team);
  let target = p.facing;
  if (p.stunned > 0) {
    p.turnRate = 0;
    return;
  }
  if (x.spotOn && horizDist(p.pos.x, p.pos.z, x.spot.x, x.spot.z) < 0.5) target = x.spotFace;
  else if (isShotAction(p.action) || p.action === "pumpFake") target = yawTo(p.pos.x, p.pos.z, dir * COURT.rimX, 0);
  else if (it.faceTarget) target = yawTo(p.pos.x, p.pos.z, it.faceTarget.x, it.faceTarget.z);
  else if (p.hasBall) {
    if (it.post) {
      const def = ctx.players[defaultMark(s)];
      target = yawTo(p.pos.x, p.pos.z, p.pos.x - dir * 3, p.pos.z) + (def ? 0 : 0);
    } else target = speed > 1.8 ? Math.atan2(p.vel.x, p.vel.z) : yawTo(p.pos.x, p.pos.z, dir * COURT.rimX, 0);
  } else if (st.possession !== -1 && st.possession !== p.team && st.phase === "live") {
    if (speed > 4.5 && it.sprint > 0.5) target = Math.atan2(p.vel.x, p.vel.z);
    else {
      const m = ctx.players[p.mark];
      const onBall = ball.holder >= 0 && p.mark === ball.holder;
      target = onBall || !m ? yawTo(p.pos.x, p.pos.z, ball.pos.x, ball.pos.z) : yawTo(p.pos.x, p.pos.z, (m.pos.x + ball.pos.x) / 2, (m.pos.z + ball.pos.z) / 2);
    }
  } else if (speed > 1.5) target = Math.atan2(p.vel.x, p.vel.z);
  else if (x.spotOn) target = x.spotFace;
  else target = yawTo(p.pos.x, p.pos.z, ball.pos.x, ball.pos.z);
  const d = wrapAngle(target - p.facing);
  const max = (speed > 5 ? 9 : 15) * dt;
  const step = clamp(d, -max, max);
  p.facing = wrapAngle(p.facing + step);
  p.turnRate = dt > 0 ? step / dt : 0;
}

function pose(ctx: Ctx, s: number, dt: number): void {
  const p = ctx.players[s];
  const x = ctx.px[s];
  const it = ctx.intents[s];
  const st = ctx.state;
  const ball = ctx.ball;
  const defense = st.phase === "live" && st.possession !== -1 && st.possession !== p.team;
  let crouch = 0.1;
  let hands = 0;
  if (defense) {
    const m = ctx.players[p.mark];
    const near = !!m && horizDist(p.pos.x, p.pos.z, m.pos.x, m.pos.z) < 4;
    crouch = it.intense ? 1 : near ? 0.7 : 0.3;
    hands = it.handsUp ? 1 : near && m && m.hasBall ? 0.35 : 0;
    if (x.chargeT > 0) crouch = 1;
  } else if (p.hasBall) {
    crouch = ball.mode === "held" ? 0.5 : 0.35;
    const opp = ctx.players[defaultMark(s)];
    if (opp && horizDist(p.pos.x, p.pos.z, opp.pos.x, opp.pos.z) < 1.4) crouch += 0.15;
  }
  if (p.action === "contest" || p.action === "block") hands = 1;
  if (x.plantT > 0) crouch = Math.max(crouch, 0.65); // sit into the plant
  const k = 1 - Math.exp(-8 * dt);
  p.crouch += (crouch - p.crouch) * k;
  p.handsUp += (hands - p.handsUp) * k;
  if (isShotAction(p.action) || p.action === "pumpFake") p.lookAt.set(dirOf(ctx, p.team) * COURT.rimX, COURT.rimHeight, 0);
  else p.lookAt.copy(ball.pos);
}

// ---------------------------------------------------------------------------------------------------------------------
// Collisions, screens, charges
// ---------------------------------------------------------------------------------------------------------------------
export function collide(ctx: Ctx): void {
  const st = ctx.state;
  const ball = ctx.ball;
  for (let i = 0; i < 10; i++) {
    if (!ctx.px[i].active) continue;
    for (let j = i + 1; j < 10; j++) {
      if (!ctx.px[j].active) continue;
      const a = ctx.players[i];
      const b = ctx.players[j];
      if (a.pos.y > 0.45 || b.pos.y > 0.45) continue;
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      let d = Math.sqrt(dx * dx + dz * dz);
      const minD = a.radius + b.radius;
      if (d >= minD) continue;
      let nx: number;
      let nz: number;
      if (d < 1e-5) {
        // exactly stacked: split them along a fixed per-pair axis
        const ang = (i * 7 + j * 13) * 0.7;
        nx = Math.cos(ang);
        nz = Math.sin(ang);
        d = 0;
      } else {
        nx = dx / d;
        nz = dz / d;
      }
      const ma = a.data.weightLb * (0.7 + (0.6 * a.data.ratings.strength) / 99) * (ctx.px[i].chargeT > 0 ? 1.6 : 1);
      const mb = b.data.weightLb * (0.7 + (0.6 * b.data.ratings.strength) / 99) * (ctx.px[j].chargeT > 0 ? 1.6 : 1);
      const wa = mb / (ma + mb);
      const wb = ma / (ma + mb);
      const ov = minD - d;
      a.pos.x -= nx * ov * wa;
      a.pos.z -= nz * ov * wa;
      b.pos.x += nx * ov * wb;
      b.pos.z += nz * ov * wb;
      const rv = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
      if (rv >= 0) continue;
      a.vel.x += nx * rv * wa;
      a.vel.z += nz * rv * wa;
      b.vel.x -= nx * rv * wb;
      b.vel.z -= nz * rv * wb;
      const xa = ctx.px[i];
      const xb = ctx.px[j];
      if (-rv > 2.0 && xa.bumpCd <= 0 && xb.bumpCd <= 0) {
        xa.bumpCd = xb.bumpCd = 0.4;
        emit(ctx, { type: "bump", a: i, b: j, strength: clamp(-rv / 6, 0, 1), at: { x: (a.pos.x + b.pos.x) / 2, y: 1.2, z: (a.pos.z + b.pos.z) / 2 } });
        if (a.user || b.user) rumble(ctx, a.user ? i : j, 0.25, 0.2, 90);
      }
      if (st.phase !== "live" || a.team === b.team) continue;
      const h = ball.holder === i ? a : ball.holder === j ? b : null;
      if (h && ball.mode === "dribble") {
        const dd = h === a ? b : a;
        drive(ctx, h, dd, -rv);
        if (ctx.state.phase !== "live") return;
      }
    }
  }
  screens(ctx);
}

/** Ball handler runs into a defender: charge, block, bump. */
function drive(ctx: Ctx, h: PlayerState, d: PlayerState, closing: number): void {
  const dx = d.pos.x - h.pos.x;
  const dz = d.pos.z - h.pos.z;
  const l = Math.hypot(dx, dz) || 1;
  const into = (h.vel.x * dx + h.vel.z * dz) / l;
  const dSpeed = Math.hypot(d.vel.x, d.vel.z);
  const xd = ctx.px[d.slot];
  const dir = dirOf(ctx, h.team);
  if (into < 1.2 && closing < 2.4) return;
  if (ctx.settings.fouls && xd.chargeT > 0 && dSpeed < 1.3 && !inRestricted(d.pos.x, d.pos.z, dir) && into > 2.2) {
    d.stunned = 1.0;
    setAction(ctx, d.slot, "fall");
    xd.chargeT = 0;
    emit(ctx, { type: "crowd", reaction: d.team === 0 ? "roar" : "boo", strength: 0.7 });
    foulStop(ctx, h.slot, d.slot, "charge", h.pos.x, h.pos.z);
    return;
  }
  // a set defender (feet planted, squared up, outside the restricted area) draws the charge some of the time
  if (ctx.settings.fouls && dSpeed < 0.8 && into > 2.5 && !inRestricted(d.pos.x, d.pos.z, dir) && d.pos.y < 0.05) {
    const squared = -(Math.sin(d.facing) * dx + Math.cos(d.facing) * dz) / l;
    if (squared > 0.6 && ctx.rng() < 0.3 * (0.6 + d.data.ratings.iq / 250)) {
      d.stunned = 0.9;
      setAction(ctx, d.slot, "fall");
      emit(ctx, { type: "crowd", reaction: d.team === 0 ? "roar" : "boo", strength: 0.6 });
      foulStop(ctx, h.slot, d.slot, "charge", h.pos.x, h.pos.z);
      return;
    }
  }
  const toward = -(d.vel.x * dx + d.vel.z * dz) / l;
  if (ctx.settings.fouls && dSpeed > 2.2 && toward > 1.5 && ctx.rng() < 0.18 * foulMult(ctx, d.slot)) {
    foulStop(ctx, d.slot, h.slot, "blocking", h.pos.x, h.pos.z);
    return;
  }
  ctx.px[h.slot].slowT = Math.max(ctx.px[h.slot].slowT, 0.25);
  const strip = 0.03 * (1 - h.data.ratings.handle / 99) * stealMult(ctx, d.team);
  if (ctx.rng() < strip) {
    const ball = ctx.ball;
    ctx.pokeBy = d.slot;
    ctx.pokeFrom = h.slot;
    ball.vel.set(-dx / l * 1.5 + (ctx.rng() - 0.5) * 2, 1.2, -dz / l * 1.5 + (ctx.rng() - 0.5) * 2);
    ball.mode = "loose";
    ball.holder = -1;
    h.hasBall = false;
    ctx.state.ballHandler = -1;
    ctx.state.lastTouch = d.slot;
    emit(ctx, { type: "deflection", by: d.slot, at: v3(ball.pos) });
  }
}

/** Off-ball offense standing still that catches the ball handler's defender sets a screen. */
function screens(ctx: Ctx): void {
  const st = ctx.state;
  const ball = ctx.ball;
  if (st.phase !== "live" || st.possession === -1 || ball.holder < 0) return;
  const team = st.possession;
  const h = ctx.players[ball.holder];
  if (h.team !== team) return;
  for (let s = team * 5; s < team * 5 + 5; s++) {
    if (s === ball.holder || !ctx.px[s].active) continue;
    const sc = ctx.players[s];
    const xs = ctx.px[s];
    if (xs.screenCd > 0 || Math.hypot(sc.vel.x, sc.vel.z) > 0.9) continue;
    if (horizDist(sc.pos.x, sc.pos.z, h.pos.x, h.pos.z) > 4.5) continue;
    const base = team === 0 ? 5 : 0;
    for (let i = base; i < base + 5; i++) {
      if (!ctx.px[i].active) continue;
      const d = ctx.players[i];
      const guardsBall = d.mark === ball.holder || horizDist(d.pos.x, d.pos.z, h.pos.x, h.pos.z) < 2.2;
      if (!guardsBall) continue;
      const gap = horizDist(d.pos.x, d.pos.z, sc.pos.x, sc.pos.z) - (d.radius + sc.radius);
      if (gap > 0.08) continue;
      const toward = ((sc.pos.x - d.pos.x) * d.vel.x + (sc.pos.z - d.pos.z) * d.vel.z) / (horizDist(d.pos.x, d.pos.z, sc.pos.x, sc.pos.z) || 1);
      if (toward < 0.6) continue;
      xs.screenCd = 2.5;
      xs.screenT = 1.2;
      const xd = ctx.px[i];
      xd.slowT = Math.max(xd.slowT, 0.55 * (1.3 - d.data.ratings.perimeterD / 99) * (sc.data.ratings.strength / 80));
      d.vel.multiplyScalar(0.3);
      emit(ctx, { type: "screen", screener: s, for: ball.holder, at: v3(sc.pos) });
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Stamina, openness, crowd
// ---------------------------------------------------------------------------------------------------------------------
export function derived(ctx: Ctx, dt: number): void {
  const st = ctx.state;
  const fatigue = ctx.settings.fatigue && ctx.mode !== "practice";
  const live = st.phase === "live" || st.phase === "inbound";
  for (let s = 0; s < 10; s++) {
    const p = ctx.players[s];
    const x = ctx.px[s];
    if (!x.active) continue;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (!fatigue) p.stamina = 1;
    else if (live) {
      const it = ctx.intents[s];
      const drain = (0.002 + speed * speed * 0.00042 + (it.intense ? 0.005 : 0) + (isJumpAction(p.action) && p.actionDur > 0 ? 0.01 : 0)) *
        (1.5 - (p.data.ratings.stamina / 99) * 0.8);
      p.stamina -= drain * dt;
      if (speed < 1.2) p.stamina += 0.004 * dt;
    } else p.stamina += 0.012 * dt;
    p.stamina = clamp(p.stamina, 0.05, 1);
    ctx.teams[p.team].energy[p.rosterIndex] = p.stamina;
    // openness
    let nd = 9;
    const base = p.team === 0 ? 5 : 0;
    for (let i = base; i < base + 5; i++) {
      if (!ctx.px[i].active) continue;
      const q = ctx.players[i];
      const d = horizDist(p.pos.x, p.pos.z, q.pos.x, q.pos.z);
      if (d < nd) nd = d;
    }
    p.openness = clamp((nd - 0.9) / 3.2, 0, 1);
    if (p.meter.shownT < 99) p.meter.shownT += dt;
  }
  for (const t of ctx.teams) {
    for (let i = 0; i < t.energy.length; i++) {
      if (t.lineup.includes(i)) continue;
      t.energy[i] = Math.min(1, t.energy[i] + dt * (st.phase === "timeout" || st.phase === "periodBreak" ? 0.03 : 0.011));
    }
  }
  // crowd
  const base = 0.25 + (st.clutch ? 0.35 : 0);
  st.hype += (base - st.hype) * dt * 0.04;
  if (st.phase === "live" && st.possession === 1 && (st.clutch || st.hype > 0.55) && ctx.time - ctx.crowdT > 9) {
    ctx.crowdT = ctx.time;
    emit(ctx, { type: "crowd", reaction: "defense", strength: clamp(st.hype + 0.1, 0, 1) });
  }
}

export { toneOf };
