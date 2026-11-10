import * as THREE from "three";
import type { Dir, DribbleMove, PlayerIntent, PlayerState, TeamSide } from "./contracts";
import { COURT, distToBasket, shotValue } from "./contracts";
import type { Ctx, PlayKind, SlotMem, TeamBrain } from "./ai-core";
import {
  HALF_U, SPACING, aiRandom, SPOT, chance, clamp, creator, dist2, gauss, isBig, isGuard, keepIn, lobThreat, rand, rimFloor,
  scorerValue, segDist, shooter3, slasher, spot, steer, toWorld, uOf,
} from "./ai-core";

// HOOPS offense: play calls (fast break, early offense, high and side pick and roll, horns, motion, isolation, post up,
// last shot), off-ball spacing to real spots, cuts, screens on call, ball-handler reads, inbounds and shot release.

const RIM = new THREE.Vector3();
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const segTo = [0];
const MATES: number[] = [];
const TAKEN: boolean[] = SPACING.map(() => false);
const SPOT_POS: THREE.Vector3[] = SPACING.map(() => new THREE.Vector3());
const SHOT_ACTIONS = new Set(["jumpShot", "layup", "dunk", "floater", "hook"]);

// ---------------------------------------------------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------------------------------------------------
function nearestDefender(ctx: Ctx, slot: number, maxD = 99): number {
  const p = ctx.sim.players[slot];
  const base = p.team === 0 ? 5 : 0;
  let best = -1;
  let bd = maxD;
  for (let i = base; i < base + 5; i++) {
    const q = ctx.sim.players[i];
    const dd = dist2(p.pos.x, p.pos.z, q.pos.x, q.pos.z);
    if (dd < bd) {
      bd = dd;
      best = i;
    }
  }
  return best;
}

function nearestDefDist(ctx: Ctx, slot: number): number {
  const p = ctx.sim.players[slot];
  const base = p.team === 0 ? 5 : 0;
  let bd = 99;
  for (let i = base; i < base + 5; i++) {
    const q = ctx.sim.players[i];
    bd = Math.min(bd, dist2(p.pos.x, p.pos.z, q.pos.x, q.pos.z));
  }
  return bd;
}

/** 0 smothered .. 1 wide open. */
export function openness(ctx: Ctx, slot: number): number {
  const own = clamp((nearestDefDist(ctx, slot) - 0.9) / 2.6, 0, 1);
  const simO = ctx.sim.players[slot].openness;
  return simO > 0 ? (own + simO) * 0.5 : own;
}

/** Defenders sitting in the passing lane, 0 clean .. >1 likely picked off. */
function laneRisk(ctx: Ctx, from: PlayerState, to: PlayerState, lob: boolean): number {
  const base = from.team === 0 ? 5 : 0;
  const len = dist2(from.pos.x, from.pos.z, to.pos.x, to.pos.z);
  let risk = 0;
  for (let i = base; i < base + 5; i++) {
    const q = ctx.sim.players[i];
    const sd = segDist(q.pos.x, q.pos.z, from.pos.x, from.pos.z, to.pos.x, to.pos.z, segTo);
    const tt = segTo[0];
    if (tt < 0.08) continue;
    const w = 0.7 + len * 0.035;
    let k = clamp(1 - sd / w, 0, 1) * (0.55 + q.data.ratings.steal / 160);
    if (lob && tt < 0.82) k *= 0.25;
    if (tt > 0.92) k *= 0.6; // the man on the receiver: contested catch, not a pick
    risk += k;
  }
  if (len > 13) risk += (len - 13) * 0.05;
  return risk;
}

/** How clear the path to the rim is: min lateral gap of any defender ahead, meters. */
function driveLane(ctx: Ctx, p: PlayerState, d: Dir, side: number): number {
  toWorld(d, 0.5, side * 0.5, A);
  const base = p.team === 0 ? 5 : 0;
  const pu = uOf(d, p.pos.x);
  let gap = 4;
  for (let i = base; i < base + 5; i++) {
    const q = ctx.sim.players[i];
    if (uOf(d, q.pos.x) > pu + 0.4) continue; // behind me
    const sd = segDist(q.pos.x, q.pos.z, p.pos.x, p.pos.z, A.x, A.z, segTo);
    gap = Math.min(gap, sd + (segTo[0] > 0.7 ? 0.5 : 0));
  }
  return gap;
}

function timeLeft(ctx: Ctx): number {
  const s = ctx.sim.state;
  return s.shotClockOn ? Math.min(s.shotClock, s.clock) : s.clock;
}

function lead(ctx: Ctx, t: TeamSide): number {
  const s = ctx.sim.state.score;
  return s[t] - s[1 - t];
}

// ---------------------------------------------------------------------------------------------------------------------
// Possession start
// ---------------------------------------------------------------------------------------------------------------------
export function onOwnPossession(ctx: Ctx, b: TeamBrain, transition: boolean): void {
  const { sim, mem } = ctx;
  let best = b.side * 5;
  let bv = -1e9;
  for (let k = 0; k < 5; k++) {
    const p = sim.players[b.side * 5 + k];
    const v = scorerValue(p);
    if (v > bv) {
      bv = v;
      best = p.slot;
    }
  }
  b.star = best;
  b.play = "none";
  b.playT = 0;
  b.phase = 0;
  b.possT = 0;
  b.passes = 0;
  b.transition = transition ? 6 : 0;
  b.screener = -1;
  b.screenFor = -1;
  b.screenSet = false;
  b.screenUsed = false;
  b.offScreener = -1;
  b.offTarget = -1;
  b.postSlot = -1;
  b.motionT = rand(2.5, 4);
  b.toThisPossession = false;
  for (let k = 0; k < 5; k++) {
    const m = mem[b.side * 5 + k];
    m.role = "space";
    m.roleT = 0;
    m.spotIdx = -1;
    m.spotT = 0;
    m.cutT = 0;
    m.driving = false;
    m.combo = "none";
    m.holdT = 0;
  }
}

export function onCatch(ctx: Ctx, b: TeamBrain, slot: number): void {
  const m = ctx.mem[slot];
  m.catchT = 0;
  m.holdT = 0;
  m.driving = false;
  m.combo = "none";
  m.think = rand(0.06, 0.14) + (1 - b.iq) * 0.22;
  if (m.role === "cut" || m.role === "curl" || m.role === "roll" || m.role === "rimRun" || m.role === "fill") m.role = "space";
  if (b.play === "iso" && slot === b.star) b.phase = 1;
  if (b.play === "post" && slot === b.postSlot) b.phase = 1;
}

export function onOwnPass(ctx: Ctx, b: TeamBrain, from: number, to: number): void {
  const { sim, mem } = ctx;
  if (sim.players[from].team === b.side) b.passes++;
  if (from === sim.userSlot || sim.players[from].team !== b.side) return;
  const m = mem[from];
  m.driving = false;
  m.shooting = false;
  // give and go / basket cut after the pass
  const d = sim.dir(b.side);
  const p = sim.players[from];
  const r = distToBasket(p.pos.x, p.pos.z, d);
  if (r < 10 && r > 3.5 && driveLane(ctx, p, d, Math.sign(p.pos.z) || 1) > 1.0 && chance(0.35 + b.iq * 0.3)) {
    m.role = "cut";
    m.cutT = 1.5;
    m.roleT = 0;
  } else if (m.role === "handler" || m.role === "space") {
    m.role = "space";
    m.spotIdx = -1;
  }
  void to;
}

/** The human asked for a screen: send the best screener. */
export function onScreenCall(ctx: Ctx, b: TeamBrain, handler: number): void {
  const { sim, mem } = ctx;
  sim.mates(handler, MATES);
  const h = sim.players[handler];
  let best = -1;
  let bv = 1e9;
  for (const s of MATES) {
    if (s === sim.userSlot) continue;
    const p = sim.players[s];
    const v = dist2(p.pos.x, p.pos.z, h.pos.x, h.pos.z) - (isBig(p) ? 3.5 : 0) - p.data.ratings.strength / 30;
    if (v < bv) {
      bv = v;
      best = s;
    }
  }
  if (best < 0) return;
  b.play = "userScreen";
  b.playT = 0;
  b.phase = 0;
  startBallScreen(ctx, b, best, handler, h.pos.z > 1.5 ? -1 : h.pos.z < -1.5 ? 1 : h.vel.z >= 0 ? 1 : -1);
  mem[best].role = "screen";
}

function startBallScreen(ctx: Ctx, b: TeamBrain, screener: number, handler: number, side: number): void {
  b.screener = screener;
  b.screenFor = handler;
  b.screenSet = false;
  b.screenUsed = false;
  b.screenT = 0;
  b.playSide = side;
  ctx.mem[screener].role = "screen";
  ctx.mem[screener].roleT = 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Play calling
// ---------------------------------------------------------------------------------------------------------------------
function bestBig(ctx: Ctx, t: TeamSide, exclude: number, exclude2 = -1): number {
  let best = -1;
  let bv = -1e9;
  for (let k = 0; k < 5; k++) {
    const s = t * 5 + k;
    if (s === exclude || s === exclude2 || s === ctx.sim.userSlot) continue;
    const p = ctx.sim.players[s];
    const v = p.height * 10 + (isBig(p) ? 6 : 0) + p.data.ratings.strength * 0.05;
    if (v > bv) {
      bv = v;
      best = s;
    }
  }
  return best;
}

function bestPost(ctx: Ctx, t: TeamSide, exclude: number): number {
  let best = -1;
  let bv = -1e9;
  for (let k = 0; k < 5; k++) {
    const s = t * 5 + k;
    if (s === exclude || s === ctx.sim.userSlot) continue;
    const p = ctx.sim.players[s];
    const v = p.data.ratings.postScoring + p.data.ratings.strength * 0.2;
    if (v > bv) {
      bv = v;
      best = s;
    }
  }
  return best;
}

function choosePlay(ctx: Ctx, b: TeamBrain, t: TeamSide, holder: number): PlayKind {
  const { sim } = ctx;
  const st = sim.state;
  const tl = timeLeft(ctx);
  const h = sim.players[holder];
  const star = sim.players[b.star];
  // last shot of a period: hold, then go to the star
  if ((!st.shotClockOn || st.clock <= st.shotClock + 0.5) && st.clock < 24 && st.clock > 8.5) return "lastShot";
  if (st.period >= 4 && st.clock < 120 && lead(ctx, t) > 0 && st.shotClock > 13 && b.possT < 6) return "hold";
  const pr = bestPost(ctx, t, holder);
  const post = pr >= 0 ? sim.players[pr].data.ratings.postScoring : 0;
  let bigs = 0;
  for (let k = 0; k < 5; k++) if (isBig(sim.players[t * 5 + k])) bigs++;
  const late = tl < 9 || st.clutch || b.afterTimeout;
  const w: [PlayKind, number][] = [
    ["pnr", 3 + creator(h) * 2.5],
    ["sidePnr", 1.4 + creator(h)],
    ["horns", bigs >= 2 ? 1.6 : 0.3],
    ["motion", 2.2],
    ["iso", (star.data.ratings.overall >= 85 ? 1.1 + (star.data.ratings.overall - 85) * 0.15 : 0.4) * (late ? 2.2 : 1) + star.onFire * 2],
    ["post", post >= 78 ? 1 + (post - 78) * 0.12 : 0.2],
  ];
  if (b.lastPlay !== "none") for (const e of w) if (e[0] === b.lastPlay) e[1] *= 0.55; // vary the calls
  let sum = 0;
  for (const e of w) sum += e[1];
  let r = aiRandom() * sum;
  for (const e of w) {
    r -= e[1];
    if (r <= 0) return e[0];
  }
  return "motion";
}

function setupPlay(ctx: Ctx, b: TeamBrain, t: TeamSide, holder: number, play: PlayKind): void {
  const { sim, mem } = ctx;
  b.play = play;
  b.lastPlay = play;
  b.playT = 0;
  b.phase = 0;
  b.screener = -1;
  b.screenSet = false;
  b.screenUsed = false;
  b.offScreener = -1;
  b.offTarget = -1;
  b.postSlot = -1;
  b.afterTimeout = false;
  const h = sim.players[holder];
  b.playSide = h.pos.z > 0.8 ? 1 : h.pos.z < -0.8 ? -1 : chance(0.5) ? 1 : -1;
  for (let k = 0; k < 5; k++) {
    const s = t * 5 + k;
    if (s === holder) continue;
    mem[s].role = "space";
    mem[s].spotIdx = -1;
  }
  mem[holder].role = "handler";
  if (play === "pnr" || play === "sidePnr") {
    const sc = bestBig(ctx, t, holder);
    if (sc >= 0) startBallScreen(ctx, b, sc, holder, play === "sidePnr" ? -b.playSide : b.playSide);
  } else if (play === "horns") {
    const b1 = bestBig(ctx, t, holder);
    const b2 = bestBig(ctx, t, holder, b1);
    if (b1 >= 0) mem[b1].role = "idle";
    if (b2 >= 0) mem[b2].role = "idle";
    b.screener = b1;
    b.offScreener = b2;
  } else if (play === "post") {
    b.postSlot = bestPost(ctx, t, holder);
    if (b.postSlot >= 0) mem[b.postSlot].role = "post";
  } else if (play === "iso") {
    if (b.star !== holder && b.star !== sim.userSlot) mem[b.star].role = "receive";
    else b.phase = 1;
  }
}

/** Team-level play state machine (CPU-run possessions). */
function runPlay(ctx: Ctx, b: TeamBrain, t: TeamSide, d: Dir, holder: number, dt: number): void {
  const { sim, mem } = ctx;
  const st = sim.state;
  b.playT += dt;
  const h = sim.players[holder];
  const hu = uOf(d, h.pos.x);
  // transition reads
  if (b.transition > 0) {
    b.transition -= dt;
    if (b.play === "none" || b.play === "fastBreak" || b.play === "early") {
      let ahead = 0;
      let back = 0;
      for (let i = 0; i < 10; i++) {
        const p = sim.players[i];
        const u = uOf(d, p.pos.x);
        if (p.team === t ? u < hu + 1.5 : u < hu - 0.3) p.team === t ? ahead++ : back++;
      }
      if (hu > 6.5 && ahead > back && back <= 3) {
        if (b.play !== "fastBreak") {
          b.play = "fastBreak";
          b.playT = 0;
          assignBreak(ctx, b, t, d, holder);
        }
        return;
      }
      if (b.play === "fastBreak" && (b.playT > 4.5 || hu < 4.5)) b.transition = 0;
    }
  }
  if (b.play === "fastBreak" && b.transition > 0) return;
  // bring it up: early offense until the handler is set in the frontcourt
  if (hu > 10.2 && b.play !== "lastShot" && b.play !== "hold") {
    if (b.play !== "early") {
      b.play = "early";
      b.playT = 0;
      for (let k = 0; k < 5; k++) {
        const s = t * 5 + k;
        if (s !== holder) {
          mem[s].role = "space";
        }
      }
      mem[holder].role = "handler";
    }
    return;
  }
  if (b.play === "none" || b.play === "early" || b.play === "fastBreak") {
    setupPlay(ctx, b, t, holder, choosePlay(ctx, b, t, holder));
    return;
  }
  // clock management holds
  if (b.play === "lastShot") {
    if (st.clock < 8 + b.iq * 1.5 || (st.shotClockOn && st.shotClock < st.clock - 0.5 && st.shotClock < 8)) {
      setupPlay(ctx, b, t, holder, chance(0.6) ? "iso" : "pnr");
    }
    return;
  }
  if (b.play === "hold") {
    if (st.shotClock < 11 + rand(-1, 1) * (1 - b.iq) || timeLeft(ctx) < 11) setupPlay(ctx, b, t, holder, chance(0.5) ? "pnr" : "iso");
    return;
  }
  // horns: bigs to the elbows, then the ball side elbow comes to screen
  if (b.play === "horns" && b.phase === 0) {
    const ready = b.playT > 1.5;
    if (ready && b.screener >= 0) {
      const s1 = sim.players[b.screener];
      const side = Math.sign(s1.pos.z) || 1;
      b.phase = 1;
      startBallScreen(ctx, b, b.screener, holder, side);
      if (b.offScreener >= 0) {
        const o = mem[b.offScreener];
        const op = sim.players[b.offScreener];
        o.role = shooter3(op) > 0.45 ? "pop" : "roll";
        o.roleT = -0.8; // delay the second big's action
      }
    }
  }
  // the screen is used: roller dives, popper flares
  updateBallScreen(ctx, b, d, dt);
  // motion: an off-ball screen every few seconds
  if (b.play === "motion" || (b.playT > 7 && b.play !== "iso" && b.play !== "post")) {
    if (b.play !== "motion" && b.screener < 0) {
      b.play = "motion";
      b.playT = 0;
    }
    b.motionT -= dt;
    if (b.motionT <= 0 && b.offScreener < 0) {
      b.motionT = rand(3, 5);
      const sc = bestBig(ctx, t, holder);
      let tgt = -1;
      let tv = -1e9;
      for (let k = 0; k < 5; k++) {
        const s = t * 5 + k;
        if (s === holder || s === sc || s === sim.userSlot) continue;
        const v = shooter3(sim.players[s]) * 2 + rand(0, 1);
        if (v > tv) {
          tv = v;
          tgt = s;
        }
      }
      if (sc >= 0 && tgt >= 0 && mem[sc].role === "space" && mem[tgt].role === "space") {
        b.offScreener = sc;
        b.offTarget = tgt;
        mem[sc].role = "offScreen";
        mem[sc].roleT = 0;
      }
    }
  }
  if (b.play === "iso" && b.playT > 7.5) {
    b.play = "motion";
    b.playT = 0;
  }
  if (b.play === "post" && (b.playT > 7 || (b.postSlot >= 0 && b.phase === 1 && holder !== b.postSlot))) {
    b.play = "motion";
    b.playT = 0;
    if (b.postSlot >= 0) mem[b.postSlot].role = "space";
  }
}

function assignBreak(ctx: Ctx, b: TeamBrain, t: TeamSide, d: Dir, holder: number): void {
  const { sim, mem } = ctx;
  let rimRun = -1;
  let rv = -1e9;
  for (let k = 0; k < 5; k++) {
    const s = t * 5 + k;
    if (s === holder || s === sim.userSlot) continue;
    const p = sim.players[s];
    const v = -uOf(d, p.pos.x) * 1.2 + (isBig(p) ? 2 : 0) + p.data.ratings.speed * 0.03;
    if (v > rv) {
      rv = v;
      rimRun = s;
    }
  }
  let trail = -1;
  let tv = -1e9;
  for (let k = 0; k < 5; k++) {
    const s = t * 5 + k;
    if (s === holder || s === rimRun || s === sim.userSlot) continue;
    const v = uOf(d, sim.players[s].pos.x) + (isBig(sim.players[s]) ? 3 : 0);
    if (v > tv) {
      tv = v;
      trail = s;
    }
  }
  let fillSide = Math.sign(sim.players[holder].pos.z) >= 0 ? -1 : 1;
  for (let k = 0; k < 5; k++) {
    const s = t * 5 + k;
    if (s === holder) continue;
    const m = mem[s];
    m.roleT = 0;
    if (s === rimRun) m.role = "rimRun";
    else if (s === trail) m.role = "trail";
    else {
      m.role = "fill";
      m.driveSide = fillSide;
      fillSide = -fillSide;
    }
  }
  mem[holder].role = "handler";
}

function updateBallScreen(ctx: Ctx, b: TeamBrain, d: Dir, dt: number): void {
  const { sim, mem } = ctx;
  if (b.screener < 0 || b.screenFor < 0) return;
  const sm = mem[b.screener];
  if (sm.role !== "screen") return;
  b.screenT += dt;
  const h = sim.players[b.screenFor];
  const scr = sim.players[b.screener];
  if (b.screenSet) {
    const away = dist2(h.pos.x, h.pos.z, b.screenSpot.x, b.screenSpot.z);
    const past = uOf(d, h.pos.x) < uOf(d, b.screenSpot.x) - 0.3;
    if ((b.screenT > 0.55 && (away > 2.2 || past)) || b.screenT > 2.6 || !h.hasBall) {
      b.screenUsed = true;
      sm.role = shooter3(scr) > 0.55 || (scr.data.ratings.three > 74 && chance(0.6)) ? "pop" : "roll";
      sm.roleT = 0;
      b.screener = -1;
    }
  } else if (b.screenT > 3.8) {
    sm.role = "roll";
    sm.roleT = 0;
    b.screener = -1;
  }
}

/** Where the ball screener stands: on the play side hip of the handler's defender. */
function screenSpotFor(ctx: Ctx, b: TeamBrain, d: Dir, out: THREE.Vector3): THREE.Vector3 {
  const { sim } = ctx;
  const h = sim.players[b.screenFor];
  rimFloor(d, RIM);
  const def = nearestDefender(ctx, b.screenFor, 3.2);
  A.subVectors(RIM, h.pos).setY(0).normalize(); // handler -> rim
  if (def >= 0) out.copy(sim.players[def].pos).setY(0);
  else out.copy(h.pos).addScaledVector(A, 1.1);
  // perpendicular toward the play side (world z sign)
  B.set(-A.z, 0, A.x);
  if (B.z * b.playSide < 0) B.multiplyScalar(-1);
  out.addScaledVector(B, 0.62).addScaledVector(A, -0.12);
  return keepIn(out, 0.6);
}

// ---------------------------------------------------------------------------------------------------------------------
// Off-ball targets
// ---------------------------------------------------------------------------------------------------------------------
function solveSpacing(ctx: Ctx, b: TeamBrain, t: TeamSide, d: Dir, holder: number, dt: number, clearSide: number): void {
  const { sim, mem } = ctx;
  for (let i = 0; i < SPACING.length; i++) {
    TAKEN[i] = false;
    const sp = SPACING[i];
    spot(d, sp.name, sp.side, SPOT_POS[i]);
  }
  // exclusion: the ball (and where the driver is headed) and every non-spacer
  const hx = holder >= 0 ? sim.players[holder].pos.x + sim.players[holder].vel.x * 0.7 : sim.ball.pos.x;
  const hz = holder >= 0 ? sim.players[holder].pos.z + sim.players[holder].vel.z * 0.7 : sim.ball.pos.z;
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < 5; k++) {
      const s = t * 5 + k;
      const m = mem[s];
      if (s === holder || s === sim.userSlot || m.role !== "space") continue;
      const p = sim.players[s];
      m.spotT -= pass === 0 ? dt : 0;
      // pass 0: keep valid current spots; pass 1: assign the rest
      if (pass === 0) {
        if (m.spotIdx >= 0 && m.spotT > 0 && !TAKEN[m.spotIdx]) {
          const sp = SPOT_POS[m.spotIdx];
          if (dist2(sp.x, sp.z, hx, hz) > 3.2) {
            TAKEN[m.spotIdx] = true;
            continue;
          }
        }
        m.spotIdx = -1;
        continue;
      }
      if (m.spotIdx >= 0) continue;
      let best = -1;
      let bc = 1e9;
      const big = isBig(p) && shooter3(p) < 0.45 ? 1 : 0;
      const sh = shooter3(p);
      for (let i = 0; i < SPACING.length; i++) {
        if (TAKEN[i]) continue;
        const sp = SPACING[i];
        const P = SPOT_POS[i];
        let c = dist2(p.pos.x, p.pos.z, P.x, P.z) * 0.32;
        if (dist2(P.x, P.z, hx, hz) < 3.6) c += 8;
        for (let j = 0; j < 10; j++) {
          if (j === s) continue;
          const q = sim.players[j];
          if (q.team !== t) continue;
          const isSpacer = mem[j].role === "space" && j !== holder && j !== sim.userSlot;
          if (isSpacer) continue;
          const tx = j === sim.userSlot || j === holder ? q.pos.x : mem[j].target.x;
          const tz = j === sim.userSlot || j === holder ? q.pos.z : mem[j].target.z;
          if (dist2(P.x, P.z, tx, tz) < 2.6) c += 6;
        }
        c -= big ? sp.big * 1.1 : sp.shooter * sh * 0.9 + (sp.big > 0 ? -1.5 : 0);
        if (clearSide !== 0 && sp.side === clearSide && sp.name !== "corner") c += 5;
        if (c < bc) {
          bc = c;
          best = i;
        }
      }
      if (best >= 0) {
        TAKEN[best] = true;
        m.spotIdx = best;
        m.spotT = rand(1.1, 1.8);
      }
    }
  }
}

function offBall(ctx: Ctx, b: TeamBrain, t: TeamSide, d: Dir, s: number, holder: number, dt: number): void {
  const { sim, mem } = ctx;
  const p = sim.players[s];
  const it = sim.intents[s];
  const m = mem[s];
  m.roleT += dt;
  m.tight = false;
  m.faceOn = true;
  m.face.copy(sim.ball.pos).setY(0);
  it.cut = false;
  it.post = false;
  it.target = -1;
  let urg = 0.5;
  const hs = holder >= 0 ? sim.players[holder] : null;
  const pu = uOf(d, p.pos.x);
  const myV = p.pos.z;
  const side = Math.sign(myV) || 1;

  switch (m.role) {
    case "screen": {
      if (b.screener !== s) {
        m.role = "space";
        break;
      }
      if (!b.screenSet) {
        screenSpotFor(ctx, b, d, m.target);
        const dd = dist2(p.pos.x, p.pos.z, m.target.x, m.target.z);
        urg = dd > 3 ? 0.85 : 0.55;
        m.tight = true;
        if (dd < 0.45) {
          b.screenSet = true;
          b.screenT = 0;
          b.screenSpot.copy(m.target);
        }
      } else {
        m.target.copy(b.screenSpot);
        m.tight = true;
        urg = 0.2;
      }
      it.target = b.screenFor;
      if (hs) m.face.copy(hs.pos);
      break;
    }
    case "roll": {
      if (m.roleT < 0) {
        m.target.copy(p.pos);
        break;
      }
      toWorld(d, 0.7, clamp(myV * 0.25, -0.8, 0.8), m.target);
      it.cut = true;
      urg = 0.95;
      if (m.roleT > 2.4) m.role = "space";
      break;
    }
    case "pop": {
      if (m.roleT < 0) {
        m.target.copy(p.pos);
        break;
      }
      const sp = shooter3(p) > 0.5 ? SPOT.slot : SPOT.elbow;
      toWorld(d, sp[0], sp[1] * side, m.target);
      urg = 0.7;
      if (m.roleT > 2.2) m.role = "space";
      break;
    }
    case "cut": {
      m.cutT -= dt;
      toWorld(d, 0.8, -side * 0.5, m.target);
      it.cut = true;
      urg = 1;
      if (m.cutT <= 0 || distToBasket(p.pos.x, p.pos.z, d) < 1.1) {
        m.role = "space";
        m.spotIdx = -1;
      }
      break;
    }
    case "offScreen": {
      if (b.offTarget < 0 || b.offScreener !== s) {
        m.role = "space";
        break;
      }
      const tgt = sim.players[b.offTarget];
      const def = nearestDefender(ctx, b.offTarget, 3.5);
      if (def >= 0) {
        const dp = sim.players[def].pos;
        A.subVectors(sim.ball.pos, dp).setY(0);
        const l = A.length();
        m.target.copy(dp).addScaledVector(A, l > 0.1 ? -0.6 / l : 0);
      } else m.target.copy(tgt.pos);
      m.tight = true;
      urg = 0.7;
      it.target = b.offTarget;
      if (dist2(p.pos.x, p.pos.z, m.target.x, m.target.z) < 0.5 || m.roleT > 3) {
        mem[b.offTarget].role = "curl";
        mem[b.offTarget].roleT = 0;
        m.role = chance(0.5) ? "roll" : "space";
        m.roleT = -0.5;
        b.offScreener = -1;
      }
      break;
    }
    case "curl": {
      toWorld(d, 5.4, clamp(myV, -1, 1) * 2.2, m.target);
      it.cut = true;
      urg = 1;
      if (m.roleT > 1.8) {
        m.role = "space";
        m.spotIdx = -1;
        b.offTarget = -1;
      }
      break;
    }
    case "post": {
      spot(d, "block", b.playSide, m.target);
      it.post = true;
      urg = 0.7;
      break;
    }
    case "receive": {
      // star coming to get the ball for an iso
      spot(d, "wing", b.playSide, m.target);
      if (hs && dist2(hs.pos.x, hs.pos.z, m.target.x, m.target.z) < 4) spot(d, "slot", -b.playSide, m.target);
      it.cut = m.roleT < 1.2;
      urg = 0.85;
      if (m.roleT > 4.5) m.role = "space";
      break;
    }
    case "idle": {
      // horns setup: bigs to the elbows
      spot(d, "elbow", s === b.screener ? b.playSide : -b.playSide, m.target);
      urg = 0.75;
      break;
    }
    case "rimRun": {
      toWorld(d, 0.9, side * 0.6, m.target);
      it.cut = true;
      urg = 1;
      if (b.play !== "fastBreak") m.role = "space";
      break;
    }
    case "fill": {
      const hu = hs ? uOf(d, hs.pos.x) : pu;
      if (shooter3(p) > 0.5) {
        if (hu > 6) toWorld(d, Math.max(0.4, Math.min(pu, hu - 2)), m.driveSide * 6.9, m.target);
        else spot(d, "corner", m.driveSide, m.target);
      } else {
        toWorld(d, Math.max(1.2, hu - 3), m.driveSide * (hu > 5 ? 5.6 : 2.4), m.target);
        it.cut = hu < 7;
      }
      urg = 1;
      if (b.play !== "fastBreak") m.role = "space";
      break;
    }
    case "trail": {
      toWorld(d, 7.6, hs ? -Math.sign(hs.pos.z || 1) * 1.6 : 0, m.target);
      urg = 0.7;
      if (b.play !== "fastBreak") m.role = "space";
      break;
    }
    default:
      m.role = "space";
  }

  if (m.role === "space") {
    if (m.spotIdx >= 0) m.target.copy(SPOT_POS[m.spotIdx]);
    else m.target.copy(p.pos);
    urg = dist2(p.pos.x, p.pos.z, m.target.x, m.target.z) > 4 ? 0.8 : 0.45;
    // cutting reads, checked about once a second
    m.cutT -= dt;
    if (m.cutT < -1 && holder >= 0) {
      m.cutT = rand(-0.2, 0.4);
      const r = distToBasket(p.pos.x, p.pos.z, d);
      const def = nearestDefender(ctx, s, 4);
      if (r > 4 && r < 9.5 && def >= 0) {
        const dp = sim.players[def].pos;
        const dDef = dist2(dp.x, dp.z, p.pos.x, p.pos.z);
        const hb = sim.players[holder].pos;
        const denying = dist2(dp.x, dp.z, hb.x, hb.z) < dist2(p.pos.x, p.pos.z, hb.x, hb.z) - 0.5 && dDef < 1.9;
        const sleeping = dDef > 3.2 && driveLane(ctx, p, d, side) > 1.0;
        if ((denying || sleeping) && chance(0.22 + b.iq * 0.4)) {
          m.role = "cut";
          m.cutT = 1.4;
          m.roleT = 0;
        }
      }
    }
  }
  // never loiter in the backcourt: sprint up and fill the floor ahead of the ball
  if (pu > HALF_U - 1.5 && m.role !== "trail") urg = 1;
  // three-second awareness for every off-ball role (transition rim runs included): after ~1.5 s in the lane,
  // clear out to the short corner / dunker spot outside the paint
  const lt = sim.state.laneTimer[s];
  if (lt > 1.5) {
    if (m.role === "rimRun" || m.role === "cut" || m.role === "roll" || m.role === "fill" || m.role === "post") {
      m.role = "space";
      m.spotIdx = -1;
    }
    toWorld(d, lt > 2.2 ? 2.4 : 1.6, (Math.sign(p.pos.z) || side) * 3.4, m.target);
    urg = 1;
    it.cut = false;
    it.post = false;
  } else if (m.role === "space" && m.spotIdx < 0 && Math.abs(p.pos.z) < 2.6 && pu < 5.6) {
    // a spacer without a spot never parks in the paint
    toWorld(d, Math.max(pu, 1.6), (Math.sign(p.pos.z) || side) * 3.4, m.target);
  }
  keepIn(m.target, 0.3);
  m.urgency = urg;
  steer(p, it, m, sim.players);
  void t;
}

// ---------------------------------------------------------------------------------------------------------------------
// Shooting: hold, then release near the meter's sweet spot with rating-based noise
// ---------------------------------------------------------------------------------------------------------------------
export function startShot(ctx: Ctx, b: TeamBrain, s: number, it: PlayerIntent, m: SlotMem): void {
  it.cmd = "shoot";
  it.shootHeld = true;
  m.shooting = true;
  m.shootT = 0;
  m.releaseAt = -1;
  m.driving = false;
  m.combo = "none";
  void b;
}

export function shotTick(ctx: Ctx, b: TeamBrain, s: number, it: PlayerIntent, m: SlotMem, dt: number, ftRating = -1): void {
  const p = ctx.sim.players[s];
  m.shootT += dt;
  if (!m.shooting) {
    it.shootHeld = false;
    return;
  }
  it.shootHeld = true;
  const mt = p.meter;
  if (mt.active && m.releaseAt < 0) {
    const d = ctx.sim.dir(p.team);
    const r = distToBasket(p.pos.x, p.pos.z, d);
    const rt = p.data.ratings;
    const skill = ftRating >= 0 ? ftRating : r > COURT.threeR - 0.3 ? rt.three : r > 4.5 ? rt.mid : Math.max(rt.close, rt.layup);
    const sigma = clamp(1.55 - skill / 72, 0.22, 1.25) * (1.2 - b.iq * 0.4);
    m.releaseAt = clamp(mt.target + gauss() * mt.window * sigma, 0.2, 0.99);
  }
  let release = false;
  if (mt.active) release = mt.fill >= m.releaseAt;
  else if (m.shootT > 0.3) {
    // the sim does not run a meter for this shot: release at the top of the jump
    release = SHOT_ACTIONS.has(p.action) ? p.actionP >= 0.5 : m.shootT > 0.65;
  }
  if (m.shootT > 1.8) release = true;
  if (release) {
    it.shootHeld = false;
    m.shooting = false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Ball handler
// ---------------------------------------------------------------------------------------------------------------------
const passOut = { slot: -1, value: -1, kind: "pass" as "pass" | "bouncePass" | "lobPass" };

function evalPasses(ctx: Ctx, b: TeamBrain, d: Dir, s: number): typeof passOut {
  const { sim, mem } = ctx;
  const p = sim.players[s];
  passOut.slot = -1;
  passOut.value = -1;
  passOut.kind = "pass";
  const front = uOf(d, p.pos.x) < HALF_U;
  sim.mates(s, MATES);
  for (const q of MATES) {
    const mp = sim.players[q];
    if (mp.stunned > 0) continue;
    const qu = uOf(d, mp.pos.x);
    if (front && qu > HALF_U - 0.25) continue; // backcourt violation
    const len = dist2(p.pos.x, p.pos.z, mp.pos.x, mp.pos.z);
    if (len < 1.6 || len > 22) continue;
    const qr = distToBasket(mp.pos.x, mp.pos.z, d);
    const pts = qu < HALF_U ? shotValue(mp.pos.x, mp.pos.z, d) : 2;
    const open = openness(ctx, q);
    let ev = qu < HALF_U ? sim.shotChance(q) * pts : 0.4;
    ev *= 0.55 + open * 0.45;
    const mm = mem[q];
    let lob = false;
    if ((mm.role === "cut" || mm.role === "roll" || mm.role === "rimRun" || sim.intents[q].cut) && qr < 4.5) {
      ev += 0.3 * open;
      if (b.lobCd <= 0 && lobThreat(mp) > 0.5 && open > 0.55 && len > 3.5 && len < 11 && qr < 3.2) lob = true;
    }
    if (b.play === "iso" && b.phase === 0 && q === b.star) ev += 0.45;
    if (b.play === "post" && b.phase === 0 && q === b.postSlot) {
      // post entry when he has position (defender not fronting)
      ev += 0.35;
    }
    if (isBig(p) && isGuard(mp) && (uOf(d, p.pos.x) > 8 || b.transition > 0)) ev += 0.4; // outlet / reset to the guard
    if (q === sim.userSlot) ev += 0.08; // the human likes the ball
    const risk = laneRisk(ctx, p, mp, lob);
    const v = ev - risk * 1.25 - (len > 12 ? (len - 12) * 0.03 : 0);
    if (v > passOut.value) {
      passOut.value = v;
      passOut.slot = q;
      passOut.kind = lob ? "lobPass" : len < 7.5 && risk > 0.25 && risk < 0.8 ? "bouncePass" : "pass";
    }
  }
  return passOut;
}

/** Nearest defender roughly in front of the handler (between him and the rim). */
function frontDefender(ctx: Ctx, p: PlayerState, d: Dir, out: { slot: number; dist: number; lat: number }): void {
  rimFloor(d, RIM);
  A.subVectors(RIM, p.pos).setY(0).normalize();
  const base = p.team === 0 ? 5 : 0;
  out.slot = -1;
  out.dist = 99;
  out.lat = 0;
  for (let i = base; i < base + 5; i++) {
    const q = ctx.sim.players[i];
    const dx = q.pos.x - p.pos.x;
    const dz = q.pos.z - p.pos.z;
    const fwd = dx * A.x + dz * A.z;
    if (fwd < -0.2) continue;
    const dd = Math.sqrt(dx * dx + dz * dz);
    if (dd < out.dist) {
      out.dist = dd;
      out.slot = i;
      out.lat = dx * -A.z + dz * A.x; // + = defender on the left of the line to the rim (world frame)
    }
  }
}
const fd = { slot: -1, dist: 99, lat: 0 };

function dribbleMove(it: PlayerIntent, m: SlotMem, move: DribbleMove, ax: number, az: number): void {
  it.cmd = "dribbleMove";
  it.move2 = move;
  it.aim.set(ax, 0, az);
  const l = it.aim.length();
  if (l > 1e-3) it.aim.multiplyScalar(1 / l);
}

function handler(ctx: Ctx, b: TeamBrain, t: TeamSide, d: Dir, s: number, dt: number): void {
  const { sim } = ctx;
  const p = sim.players[s];
  const it = sim.intents[s];
  const m = ctx.mem[s];
  const st = sim.state;
  const rt = p.data.ratings;
  rimFloor(d, RIM);
  it.cut = false;
  it.target = -1;
  it.post = false;
  m.holdT += dt;
  m.catchT += dt;
  m.moveCd -= dt;
  m.passCd -= dt;
  m.faceOn = false;
  m.tight = false;
  const r = distToBasket(p.pos.x, p.pos.z, d);
  const pu = uOf(d, p.pos.x);
  const tl = timeLeft(ctx);

  if (m.shooting) {
    // jumpers stop; drives keep going into the layup
    if (r > 3.2) m.target.copy(p.pos);
    m.urgency = 0.3;
    steer(p, it, m, null);
    shotTick(ctx, b, s, it, m, dt);
    return;
  }
  it.shootHeld = false;

  // ---- default movement from the play
  let urg = 0.45;
  if (b.play === "fastBreak") {
    toWorld(d, 0.4, clamp(p.pos.z * 0.3, -0.8, 0.8), m.target);
    urg = 1;
    m.driving = r < 9;
  } else if (pu > HALF_U - 0.4) {
    toWorld(d, 9.2, clamp(p.pos.z, -4.5, 4.5), m.target);
    urg = st.backcourtTimer > 4.5 || b.transition > 0 ? 1 : 0.65;
  } else if (b.play === "post" && b.postSlot === s) {
    it.post = true;
    toWorld(d, 0.6, p.pos.z * 0.6, m.target);
    urg = 0.25;
  } else if (b.screener >= 0 && b.screenFor === s) {
    const sp = b.screenSet ? b.screenSpot : ctx.mem[b.screener].target;
    if (!b.screenSet || b.screenT < 0.2) {
      // wait above the screen
      A.subVectors(p.pos, sp).setY(0);
      const l = A.length();
      m.target.copy(sp).addScaledVector(A, l > 0.1 ? 1.5 / l : 0);
      if (!b.screenSet) {
        const setup = b.play === "sidePnr" ? "wing" : "top";
        spot(d, setup, b.play === "sidePnr" ? -b.playSide : -b.playSide * 0.2, m.target);
      }
      urg = 0.45;
    } else {
      // come off the screener's shoulder, then downhill
      A.subVectors(RIM, sp).setY(0).normalize();
      B.set(-A.z, 0, A.x);
      if (B.z * b.playSide < 0) B.multiplyScalar(-1);
      m.target.copy(sp).addScaledVector(B, 1.25).addScaledVector(A, 1.4);
      urg = 0.85;
    }
  } else if (b.play === "iso" && s === b.star) {
    if (m.holdT < 0.4) m.target.copy(p.pos);
    urg = 0.3;
  } else if (b.play === "post" && b.phase === 0) {
    spot(d, "wing", b.playSide, m.target);
    urg = 0.5;
  } else if (b.play === "horns" && b.phase === 0) {
    spot(d, "top", 0, m.target);
  } else if (b.play === "lastShot" || b.play === "hold") {
    spot(d, "top", 0, m.target);
    A.set(Math.sin(sim.time * 0.8) * 0.8, 0, 0);
    m.target.add(A);
    urg = 0.35;
  } else if (m.holdT < 0.2 || m.target.distanceToSquared(p.pos) > 36) {
    m.target.copy(p.pos);
  }

  if (m.driving) {
    m.driveT += dt;
    toWorld(d, 0.35, m.driveSide * 0.55, m.target);
    urg = 1;
    if (m.driveT > 2.8 || (m.driveT > 0.6 && p.vel.lengthSq() < 1.2 && r > 3)) {
      m.driving = false;
      m.think = Math.min(m.think, 0.05);
    }
  }

  // ---- combos (move -> shot / move -> drive)
  if (m.combo !== "none") {
    m.comboT -= dt;
    if (m.comboT <= 0) {
      const c = m.combo;
      m.combo = "none";
      if (c === "shoot" && pu < HALF_U && (openness(ctx, s) > 0.3 || timeLeft(ctx) < 6)) {
        startShot(ctx, b, s, it, m);
        m.target.copy(p.pos);
        steer(p, it, m, null);
        return;
      }
      if (c === "drive") {
        m.driving = true;
        m.driveT = 0;
      }
    }
  }

  m.think -= dt;
  const finishR = rt.dunk > 70 && rt.vertical > 60 ? 2.3 : 1.9;
  if (m.driving && r < finishR && pu < HALF_U) {
    startShot(ctx, b, s, it, m);
    m.urgency = 1;
    steer(p, it, m, null);
    return;
  }

  if (m.think <= 0 && m.combo === "none") {
    m.think = (m.driving ? rand(0.06, 0.1) : rand(0.11, 0.2)) + (1 - b.iq) * 0.2;
    decide(ctx, b, t, d, s, p, it, m, r, pu, tl);
  }
  if (!m.shooting) {
    m.urgency = m.driving ? 1 : urg;
    keepIn(m.target, 0.5);
    steer(p, it, m, null);
  } else {
    steer(p, it, m, null);
  }
}

function decide(
  ctx: Ctx, b: TeamBrain, t: TeamSide, d: Dir, s: number, p: PlayerState, it: PlayerIntent, m: SlotMem,
  r: number, pu: number, tl: number,
): void {
  const { sim } = ctx;
  const st = sim.state;
  const rt = p.data.ratings;
  const front = pu < HALF_U;
  const pts = front ? shotValue(p.pos.x, p.pos.z, d) : 3;
  const sc = front ? sim.shotChance(s) : 0.01;
  const myOpen = openness(ctx, s);
  const ev = sc * pts * (0.6 + myOpen * 0.4);
  const noise = (1 - b.iq) * gauss() * 0.14;

  // ---- what is a good shot right now
  let want = 0.88 + noise;
  // late clock: the bar for an acceptable shot drops steadily below 8 s
  const pressure = tl < 8 ? (8 - tl) / 8 : 0;
  want -= pressure * 0.85;
  if (pts === 3) want += (1 - shooter3(p)) * 0.55 + (rt.three < 66 ? 0.6 : 0);
  if (r < 2.6) want -= 0.18;
  // long twos only when they are clean, unless he is a real midrange scorer
  if (r > 4.5 && pts === 2) want += 0.06 - clamp((rt.mid - 66) / 22, 0, 1) * 0.3;
  // short paint (floater / short jumper range): touch players take it
  else if (r > 2.6 && pts === 2) want -= clamp((Math.max(rt.mid, rt.close) - 62) / 30, 0, 1) * 0.16;
  // usage: one player cannot launch 25 threes; the cap scales with how much of the game has been played
  if (pts === 3) {
    const tpa = sim.teams[p.team].box[p.rosterIndex].tpa;
    const qlen = ctx.settings.quarterMinutes * 60;
    const played = clamp(((Math.min(st.period, 4) - 1) * qlen + (qlen - st.clock)) / (4 * qlen), 0, 1);
    const cap = 1 + (3 + clamp((rt.three - 68) / 24, 0, 1) * 7) * played;
    if (tpa > cap) want += 0.12 + (tpa - cap) * 0.08;
  }
  if (s === b.star) want -= 0.07;
  // usage: the team's scorers look for their own shot more
  want -= clamp((p.data.season.ppg - 12) / 18, 0, 1) * 0.12;
  const isoAttack = b.play === "iso" && s === b.star;
  if (isoAttack) want -= 0.12 + clamp((m.holdT - 2) * 0.1, 0, 0.25);
  if (p.onFire > 0.5) want -= 0.12;
  if (p.onFire < -0.5) want += 0.1;
  if ((b.play === "hold" || b.play === "lastShot") && tl > 7.5) want += 0.8;
  if (b.play === "early" && b.possT < 3 && pts === 3 && shooter3(p) > 0.75) want -= 0.08; // transition three
  const trail = -lead(ctx, t);
  if (st.period >= 4 && st.clock < 14 && trail === 3 && pts === 2) want += 1.2;
  if (b.transition > 0 && b.play === "fastBreak" && r > 3.5) want += 0.3; // attack, do not settle
  if (m.catchT < 0.45 && pts === 3) want -= 0.05; // rhythm catch and shoot
  // a hand in the face: with clock left, swing it or attack instead of settling for a contested jumper
  if (r > 4.5 && tl > 14) want += (1 - myOpen) * 0.3;
  // late clock with a hand up from deep: attack the closeout instead of jacking it
  else if (pts === 3 && tl > 2.2 && myOpen < 0.45) want += 0.1;
  // patience: one small term, early in the clock only, so a set gets a couple of swings (layups stay open)
  const halfcourt = b.play !== "fastBreak" && b.transition <= 0;
  const patience = clamp((tl - 12) / 9, 0, 1);
  if (halfcourt) want += patience * (r < 2.2 ? 0.02 : myOpen > 0.75 && pts === 3 ? 0.04 : 0.12);
  // the set ends in an attack: after ~3 swings or 8 s the ball stops moving and somebody goes
  const setDone = halfcourt && (b.passes >= 3 || b.possT > 9);
  if (setDone) want -= 0.05 + clamp((b.passes - 3) * 0.05, 0, 0.18);
  const setPending = b.screener >= 0 && b.screenFor === s && !b.screenUsed && tl > 8;
  if (setPending) want += 0.25;
  if (!front) want = 99;

  // ---- options
  const pass = evalPasses(ctx, b, d, s);
  const side = p.pos.z >= 0 ? -1 : 1;
  const laneMid = driveLane(ctx, p, d, side * 0.3);
  const laneBase = driveLane(ctx, p, d, -side);
  const lane = Math.max(laneMid, laneBase);
  const driveSide = laneMid >= laneBase ? side * 0.3 : -side;
  const driveV = front || b.play === "fastBreak" ? slasher(p) * clamp((lane - 0.3) / 1.3, 0, 1) * (r < 9.5 ? 1.25 : 0.6) : 0;
  frontDefender(ctx, p, d, fd);

  // forced: shot clock / period clock running out
  if (tl < 1.7 && front) {
    startShot(ctx, b, s, it, m);
    return;
  }
  if (tl < 2.6 && !front && st.clock < 2.6) {
    startShot(ctx, b, s, it, m); // heave
    return;
  }
  // post up: back him down, then go to work
  if (b.play === "post" && s === b.postSlot && r < 5) {
    let doubled = 0;
    const base = p.team === 0 ? 5 : 0;
    for (let i = base; i < base + 5; i++) if (dist2(sim.players[i].pos.x, sim.players[i].pos.z, p.pos.x, p.pos.z) < 2.2) doubled++;
    if (doubled >= 2 && pass.slot >= 0 && pass.value > 0.6) {
      doPass(ctx, it, m, pass.slot, pass.kind);
      return;
    }
    if (m.holdT > rand(1.2, 2.6) || r < 2.2) {
      startShot(ctx, b, s, it, m);
      return;
    }
    return;
  }
  // iso size-up: a couple of moves before attacking
  const sizing = b.play === "iso" && s === b.star && m.holdT < 1.4 + (1 - b.iq) * 0.6 && tl > 6;
  if (sizing) {
    if (fd.slot >= 0 && fd.dist < 2.2 && m.moveCd <= 0 && chance(0.5)) {
      const mv: DribbleMove = rt.handle > 84 && chance(0.5) ? (chance(0.5) ? "between" : "behindBack") : "crossover";
      A.set(-(RIM.z - p.pos.z), 0, RIM.x - p.pos.x).normalize().multiplyScalar(fd.lat > 0 ? -1 : 1);
      dribbleMove(it, m, mv, A.x, A.z);
      m.moveCd = rand(0.5, 0.9);
    }
    return;
  }

  // late clock, no clean look from deep: put it on the floor (rim, floater or pull-up) instead of a contested heave
  if (tl < 6 && tl > 1.9 && !m.driving && front && pts === 3 && myOpen < 0.5 && ev < want) {
    m.driving = true;
    m.driveT = 0;
    m.driveSide = driveSide;
    return;
  }
  // stop short on a drive: pull-up or floater when help sits in front of the rim
  if (m.driving && front && r > 2.7 && r < 5.6 && fd.slot >= 0 && fd.dist < 2.3 && m.moveCd < 0.6) {
    const touch = Math.max(rt.mid, (rt.close + rt.layup) / 2);
    if (chance(0.06 + clamp((touch - 58) / 35, 0, 1) * 0.22)) {
      m.driving = false;
      it.sprint = 0;
      startShot(ctx, b, s, it, m);
      m.target.copy(p.pos);
      return;
    }
  }
  // shoot
  if (ev >= want && (!m.driving || r < 3.6) && m.moveCd < 0.6) {
    // floater over a rim protector
    startShot(ctx, b, s, it, m);
    if (r > 3) m.target.copy(p.pos);
    return;
  }
  // pass
  const passBar = Math.max(ev, driveV * 0.9) + 0.08 + (setPending ? 0.25 : 0) - (m.holdT > 2.6 ? 0.25 : 0) - (b.play === "motion" && m.holdT > 1.6 ? 0.15 : 0)
    + (setDone ? 0.15 + clamp((b.passes - 3) * 0.08, 0, 0.4) + (s === b.star ? 0.15 : 0) : 0);
  if (pass.slot >= 0 && m.passCd <= 0 && pass.value > passBar && pass.value > 0.55) {
    doPass(ctx, it, m, pass.slot, pass.kind);
    return;
  }
  // pump fake a flying closeout
  if (fd.slot >= 0 && m.catchT < 0.8 && pts === 3 && m.fakeT <= 0) {
    const q = sim.players[fd.slot];
    const closing = (p.pos.x - q.pos.x) * q.vel.x + (p.pos.z - q.pos.z) * q.vel.z;
    if (closing > 3.2 * fd.dist && fd.dist < 2.6 && chance(0.25 + b.iq * 0.35)) {
      it.cmd = "pumpFake";
      m.fakeT = 2;
      m.combo = "drive";
      m.comboT = 0.42;
      m.driveSide = fd.lat > 0 ? -1 : 1;
      return;
    }
  }
  m.fakeT -= 0.1;
  // drive
  const driveBar = 0.5 - (s === b.star ? 0.08 : 0) - (isoAttack ? 0.15 : 0) + (halfcourt ? patience * 0.1 : 0) + (setPending ? 0.3 : 0) - (tl < 8 ? 0.22 : 0)
    - (setDone ? 0.16 + (s === b.star ? 0.12 : 0) : 0);
  if (!m.driving && driveV > driveBar && r < 10.5 && (front || b.play === "fastBreak")) {
    m.driving = true;
    m.driveT = 0;
    m.driveSide = driveSide;
    return;
  }
  // dribble moves to shake the man
  if (fd.slot >= 0 && fd.dist < 1.9 && m.moveCd <= 0 && front && !setPending && (m.holdT > 0.8 || m.driving)) {
    const handle = rt.handle / 100;
    if (chance(0.06 + handle * 0.16)) {
      A.set(-(RIM.z - p.pos.z), 0, RIM.x - p.pos.x).normalize(); // lateral (left of the line to the rim)
      const away = fd.lat > 0 ? -1 : 1;
      const shot = Math.max(rt.three, rt.mid) >= 80;
      if (shot && fd.dist < 1.5 && r > 5.8 && r < 8.6 && chance(0.45)) {
        rimFloor(d, B);
        dribbleMove(it, m, "stepBack", p.pos.x - B.x, p.pos.z - B.z);
        m.combo = "shoot";
        m.comboT = 0.46;
      } else if (m.driving && fd.dist < 1.1 && chance(0.6)) {
        dribbleMove(it, m, "spin", A.x * away, A.z * away);
        m.combo = "drive";
        m.comboT = 0.5;
        m.driveSide = away;
      } else if (fd.dist > 1.6 && chance(0.4)) {
        dribbleMove(it, m, "hesitation", RIM.x - p.pos.x, RIM.z - p.pos.z);
        m.combo = "drive";
        m.comboT = 0.4;
        m.driveSide = away;
      } else {
        const mv: DribbleMove = handle > 0.86 && chance(0.35) ? "behindBack" : handle > 0.8 && chance(0.3) ? "between" : "crossover";
        dribbleMove(it, m, mv, A.x * away, A.z * away);
        m.combo = slasher(p) > 0.4 ? "drive" : "none";
        m.comboT = 0.36;
        m.driveSide = away;
      }
      m.driving = false;
      m.moveCd = rand(1.0, 2.0) * (1.25 - handle * 0.5);
      return;
    }
  }
  // the set is over and nothing came open: put it on the floor rather than swing it again
  if (setDone && !m.driving && front && m.holdT > 2.2 && tl > 3 && r < 10.5) {
    m.driving = true;
    m.driveT = 0;
    m.driveSide = driveSide;
    return;
  }
  // stuck with the ball too long: move it
  if (m.holdT > 4.2 && pass.slot >= 0 && pass.value > 0.2 && tl > 4) {
    doPass(ctx, it, m, pass.slot, pass.kind);
  }
}

function doPass(ctx: Ctx, it: PlayerIntent, m: SlotMem, to: number, kind: "pass" | "bouncePass" | "lobPass"): void {
  if (kind === "lobPass") ctx.brains[ctx.sim.players[to].team].lobCd = rand(260, 520);
  it.cmd = kind;
  it.target = to;
  it.aim.set(0, 0, 0);
  m.passCd = 0.7;
  m.driving = false;
  m.holdT = 0;
  void ctx;
}

// ---------------------------------------------------------------------------------------------------------------------
// Per-step team offense
// ---------------------------------------------------------------------------------------------------------------------
export function attack(ctx: Ctx, t: TeamSide, dt: number): void {
  const { sim, mem } = ctx;
  const b = ctx.brains[t];
  const d = sim.dir(t);
  b.possT += dt;
  b.lobCd -= dt;
  const ball = sim.ball;
  const holder = ball.holder >= 0 && sim.players[ball.holder].team === t ? ball.holder : -1;
  const userHas = holder >= 0 && holder === sim.userSlot;

  if (holder >= 0 && !userHas) {
    runPlay(ctx, b, t, d, holder, dt);
  } else if (userHas) {
    // the human runs the show: teammates space, cut, run the break and screen on call
    b.playT += dt;
    const h = sim.players[holder];
    const hu = uOf(d, h.pos.x);
    if (b.play === "userScreen") {
      updateBallScreen(ctx, b, d, dt);
      if (b.screener < 0 && b.playT > 4.5) b.play = "userFree";
    } else if (b.transition > 0 && hu > 7 && b.possT < 5) {
      b.transition -= dt;
      if (b.play !== "fastBreak") {
        b.play = "fastBreak";
        b.playT = 0;
        assignBreak(ctx, b, t, d, holder);
      }
    } else if (b.play !== "userFree") {
      b.play = "userFree";
      for (let k = 0; k < 5; k++) {
        const m = mem[t * 5 + k];
        if (m.role === "fill" || m.role === "rimRun" || m.role === "trail" || m.role === "handler") m.role = "space";
      }
    }
  }
  const clearSide = b.play === "iso" && b.phase === 1 && holder >= 0 ? (Math.sign(sim.players[holder].pos.z) || 1) : 0;
  solveSpacing(ctx, b, t, d, holder, dt, clearSide);
  for (let k = 0; k < 5; k++) {
    const s = t * 5 + k;
    if (s === sim.userSlot) continue;
    const it = sim.intents[s];
    it.mark = -1;
    it.handsUp = false;
    it.intense = false;
    if (s === holder) handler(ctx, b, t, d, s, dt);
    else {
      const m = mem[s];
      if (m.shooting) shotTick(ctx, b, s, it, m, dt);
      else it.shootHeld = false;
      if (m.role === "handler") m.role = "space";
      offBall(ctx, b, t, d, s, holder, dt);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Inbounds
// ---------------------------------------------------------------------------------------------------------------------
export function inbound(ctx: Ctx, t: TeamSide, dt: number): void {
  const { sim, mem } = ctx;
  const b = ctx.brains[t];
  const ib = sim.state.inbound;
  if (!ib) return;
  const d = sim.dir(t);
  b.play = "inbound";
  const passer = ib.passer;
  const spotP = ib.spot;
  // a frontcourt throw-in may not go back over the half-court line
  const frontIn = spotP.x * d > -0.5;
  // primary receiver: the human, else the best ball handler
  let prim = -1;
  let pv = -1e9;
  for (let k = 0; k < 5; k++) {
    const s = t * 5 + k;
    if (s === passer) continue;
    const p = sim.players[s];
    const v = (s === sim.userSlot ? 50 : 0) + creator(p) * 10 + (isGuard(p) ? 4 : 0);
    if (v > pv) {
      pv = v;
      prim = s;
    }
  }
  solveSpacing(ctx, b, t, d, -1, dt, 0);
  for (let k = 0; k < 5; k++) {
    const s = t * 5 + k;
    if (s === sim.userSlot) continue;
    const p = sim.players[s];
    const it = sim.intents[s];
    const m = mem[s];
    it.shootHeld = false;
    it.mark = -1;
    it.cut = false;
    it.post = false;
    it.target = -1;
    m.shooting = false;
    m.faceOn = true;
    m.face.copy(sim.ball.pos).setY(0);
    m.tight = false;
    if (s === passer) {
      m.routineT += dt;
      m.target.copy(p.pos);
      m.urgency = 0;
      steer(p, it, m, null);
      it.move.set(0, 0, 0);
      const wait = ib.afterMake ? 0.3 : 0.6;
      if (m.routineT > wait + rand(0, 0.3) && m.passCd <= 0) {
        let best = -1;
        let bv = -1e9;
        for (let j = 0; j < 5; j++) {
          const q = t * 5 + j;
          if (q === passer) continue;
          const mp = sim.players[q];
          const len = dist2(p.pos.x, p.pos.z, mp.pos.x, mp.pos.z);
          if (len > 13 || Math.abs(mp.pos.x) > COURT.halfL || Math.abs(mp.pos.z) > COURT.halfW) continue;
          if (frontIn && mp.pos.x * d < 1.2) continue;
          const v = openness(ctx, q) * 2 + (q === prim ? 0.9 : 0) - laneRisk(ctx, p, mp, false) * 1.5 - Math.max(0, len - 7) * 0.08;
          if (v > bv) {
            bv = v;
            best = q;
          }
        }
        if (best >= 0 && (bv > 0.6 || ib.timer > 3 || m.routineT > 3)) {
          it.cmd = "pass";
          it.target = best;
          m.passCd = 0.6;
        }
      }
      m.passCd -= dt;
      continue;
    }
    m.routineT = 0;
    if (s === prim) {
      // V-cut toward the ball to get open
      A.set(-spotP.x, 0, -spotP.z).setY(0);
      const l = A.length();
      if (l > 0.1) A.multiplyScalar(1 / l);
      const phase = Math.sin(sim.time * 2.2 + s) > 0 ? 1 : -1;
      B.set(-A.z, 0, A.x);
      m.target.copy(spotP).addScaledVector(A, 3.2).addScaledVector(B, phase * 1.6);
      m.urgency = 0.85;
      it.cut = true;
    } else if (ib.afterMake) {
      // run the floor: wings and bigs head straight for their frontcourt spots
      if (m.spotIdx >= 0) m.target.copy(SPOT_POS[m.spotIdx]);
      else toWorld(d, 6, (k - 2) * 2.5, m.target);
      m.urgency = 0.9;
    } else {
      if (m.spotIdx >= 0) m.target.copy(SPOT_POS[m.spotIdx]);
      m.urgency = 0.6;
    }
    if (frontIn && m.target.x * d < 2) m.target.x = d * 2;
    keepIn(m.target, 0.4);
    steer(p, it, m, sim.players);
  }
}
