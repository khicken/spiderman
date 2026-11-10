import type { DeadReason, FoulKind, PlayerState, TeamSide, TurnoverKind } from "./contracts";
import { COURT, inBounds, inPaint } from "./contracts";
import type { Ctx, Restart } from "./sim-core";
import {
  busy, clamp, dirOf, emit, horizDist, isShotAction, lastName, other, periodSeconds, rumble, setAction, sideOf, stat,
  teamName, toast, toneOf, v3, vertOf, yawTo,
} from "./sim-core";
import { assignPlayer } from "./state";

// Game flow: possession, scoring, dead balls and restarts, clocks, violations, fouls, free throws, tip-off,
// periods, timeouts and substitutions. Owner: sim builder.

const LATE = 120; // last two minutes of Q4 / OT: clock stops after made baskets

// ---------------------------------------------------------------------------------------------------------------------
// Possession, users, scoring
// ---------------------------------------------------------------------------------------------------------------------
export function setUser(ctx: Ctx, slot: number): void {
  if (ctx.userTeam === -1 || slot < 0 || sideOf(slot) !== ctx.userTeam || slot === ctx.userSlot) return;
  ctx.userSlot = slot;
  emit(ctx, { type: "userSwitch", slot });
}

export function resetShotClock(ctx: Ctx, v: number): void {
  const st = ctx.state;
  st.shotClock = v;
  st.shotClockOn = st.clock > v;
  ctx.shotClockExpired = false;
}

export function setPossession(ctx: Ctx, team: TeamSide): void {
  const st = ctx.state;
  if (st.possession === team) return;
  st.possession = team;
  resetShotClock(ctx, 24);
  st.backcourtTimer = 0;
  ctx.frontEstablished = false;
  st.laneTimer.fill(0);
  st.assistCandidate = -1;
  ctx.lastPossession = team;
  emit(ctx, { type: "possession", team });
}

export function score(ctx: Ctx, team: TeamSide, pts: number): void {
  const st = ctx.state;
  st.score[team] += pts;
  for (const t of [0, 1] as TeamSide[]) {
    const ps = st.periodScores[t];
    while (ps.length < st.period) ps.push(0);
  }
  st.periodScores[team][st.period - 1] += pts;
  for (let s = 0; s < 10; s++) {
    if (!ctx.px[s].active) continue;
    const p = ctx.players[s];
    const line = ctx.teams[p.team].box[p.rosterIndex];
    line.plusMinus += p.team === team ? pts : -pts;
  }
  const o = other(team);
  const prevRun = st.run[team];
  st.run[team] += pts;
  st.run[o] = 0;
  const run = st.run[team];
  if (run >= 8 && Math.floor(run / 4) > Math.floor(prevRun / 4) && run - ctx.lastHypeRun[team] >= 4) {
    ctx.lastHypeRun[team] = run;
    emit(ctx, { type: "crowdHype", level: clamp(0.5 + run * 0.03, 0, 1), reason: "run" });
    toast(ctx, `${run}-0 RUN`, teamName(ctx, team).toUpperCase(), toneOf(ctx, team));
  }
  if (run < 4) ctx.lastHypeRun[team] = 0;
  ctx.lastHypeRun[o] = 0;
  updateClutch(ctx);
}

export function updateClutch(ctx: Ctx): void {
  const st = ctx.state;
  const was = st.clutch;
  st.clutch = st.period >= 4 && st.clock <= LATE && Math.abs(st.score[0] - st.score[1]) <= 6 && st.phase !== "final";
  if (st.clutch && !was) emit(ctx, { type: "crowdHype", level: 0.85, reason: "clutch" });
}

export function hype(ctx: Ctx, add: number): void {
  ctx.state.hype = clamp(ctx.state.hype + add, 0, 1);
}

/** Streak bookkeeping: hot after 3 straight makes, cold after 4 straight misses. */
export function streak(ctx: Ctx, slot: number, made: boolean): void {
  const p = ctx.players[slot];
  const x = ctx.px[slot];
  const before = p.onFire;
  if (made) {
    x.streak = x.streak >= 0 ? x.streak + 1 : 1;
    p.onFire = clamp(x.streak >= 3 ? 0.5 + (x.streak - 3) * 0.25 : Math.max(0, p.onFire) + 0.15, -1, 1);
  } else {
    x.streak = x.streak <= 0 ? x.streak - 1 : -1;
    p.onFire = clamp(x.streak <= -4 ? -0.5 - (-x.streak - 4) * 0.25 : Math.min(0, p.onFire) - 0.12, -1, 1);
  }
  const lvl = (v: number) => (v >= 1 ? 2 : v >= 0.5 ? 1 : v <= -1 ? -2 : v <= -0.5 ? -1 : 0);
  const a = lvl(before);
  const b = lvl(p.onFire);
  if (a !== b) {
    emit(ctx, { type: "streak", slot, level: b });
    if (b === 2 && a < 2) toast(ctx, "ON FIRE", lastName(ctx, slot).toUpperCase(), "hot");
    else if (b === 1 && a < 1) toast(ctx, "HEATING UP", lastName(ctx, slot).toUpperCase(), "hot");
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Control of the ball
// ---------------------------------------------------------------------------------------------------------------------
export type GainHow = "catch" | "loose" | "steal" | "give";

export function gainControl(ctx: Ctx, slot: number, how: GainHow): void {
  const st = ctx.state;
  const ball = ctx.ball;
  const p = ctx.players[slot];
  const x = ctx.px[slot];
  const team = p.team;
  const was = st.possession;
  const practice = ctx.mode === "practice";

  if (st.phase === "inbound") {
    st.phase = "live";
    st.inbound = null;
    if (!practice && st.clock > 0) st.clockRunning = true;
  } else if (st.phase === "freeThrow") {
    st.phase = "live";
    st.freeThrow = null;
    if (!practice && st.clock > 0) st.clockRunning = true;
  } else if (st.phase === "live" && !st.clockRunning && !practice && st.clock > 0) {
    st.clockRunning = true;
  }

  let offReb = false;
  if (ctx.reboundPending) {
    ctx.reboundPending = false;
    offReb = team === ctx.reboundTeam;
    stat(ctx, slot, offReb ? "oreb" : "dreb");
    emit(ctx, { type: "rebound", slot, team, offensive: offReb, at: v3(ball.pos) });
    if (offReb) x.offRebT = ctx.time;
  }
  if (ctx.passLoose) {
    const pl = ctx.passLoose;
    ctx.passLoose = null;
    if (team !== pl.team) {
      if (pl.deflector >= 0 && sideOf(pl.deflector) === team) {
        stat(ctx, pl.deflector, "stl");
        emit(ctx, { type: "steal", by: pl.deflector, from: pl.passer, at: v3(ball.pos) });
        stealHype(ctx, pl.deflector);
      }
      turnover(ctx, pl.passer, pl.team, "badPass");
    }
  }
  if (ctx.pokeBy >= 0) {
    const by = ctx.pokeBy;
    ctx.pokeBy = -1;
    if (sideOf(by) === team && ctx.pokeFrom >= 0 && sideOf(ctx.pokeFrom) !== team) {
      stat(ctx, by, "stl");
      emit(ctx, { type: "steal", by, from: ctx.pokeFrom, at: v3(ball.pos) });
      stealHype(ctx, by);
      turnover(ctx, ctx.pokeFrom, sideOf(ctx.pokeFrom), "steal");
    }
  }

  const prevTouch = st.lastTouch;
  const lastTouchTeam = prevTouch >= 0 ? sideOf(prevTouch) : -1;
  if (was !== team) {
    setPossession(ctx, team);
  } else if (offReb) {
    if (ctx.shotObj.touchedRim) resetShotClock(ctx, 14);
    else if (ctx.shotClockExpired && !practice) {
      takeBall(ctx, slot);
      violation(ctx, team, "shotClock", slot, p.pos.x, p.pos.z);
      return;
    }
    ctx.frontEstablished = false;
  } else if (
    !practice && st.phase === "live" && ctx.frontEstablished && lastTouchTeam === team &&
    ball.pos.x * dirOf(ctx, team) < -0.05 && how !== "give"
  ) {
    takeBall(ctx, slot);
    violation(ctx, team, "backcourt", slot, p.pos.x, p.pos.z);
    return;
  }

  takeBall(ctx, slot);
  x.catchT = ctx.time;
  x.catchFrom = how === "catch" && prevTouch >= 0 && prevTouch !== slot && sideOf(prevTouch) === team ? prevTouch : -1;
  x.dribbles = 0;
  x.heldT = 0;
  if (x.catchFrom >= 0) st.assistCandidate = x.catchFrom;
  st.lastTouch = slot;
  if (!busy(p) && how !== "give") setAction(ctx, slot, "catch");
  if (ctx.userTeam === team && ctx.mode !== "practice") setUser(ctx, slot);
  // on a turnover the human keeps his player: control() returns him to his defensive home man
}

function stealHype(ctx: Ctx, by: number): void {
  hype(ctx, 0.08);
  emit(ctx, { type: "crowd", reaction: sideOf(by) === 0 ? "cheer" : "groan", strength: 0.6 });
  if (sideOf(by) === 0) emit(ctx, { type: "crowdHype", level: clamp(ctx.state.hype, 0, 1), reason: "steal" });
  rumble(ctx, by, 0.4, 0.5, 160);
}

/** Put the ball in a player's hands (no rules side effects). */
export function takeBall(ctx: Ctx, slot: number): void {
  const ball = ctx.ball;
  const p = ctx.players[slot];
  for (const q of ctx.players) q.hasBall = false;
  ball.mode = "held";
  ball.holder = slot;
  ball.pass = null;
  ball.shot = null;
  ball.dribblePhase = 0;
  ball.dribbleHand = p.data.hand === "L" ? -1 : 1;
  ctx.seg.on = false;
  ctx.bounceSeg.on = false;
  p.hasBall = true;
  ctx.state.ballHandler = slot;
  ctx.state.lastTouch = slot;
  ctx.looseT = 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Dead balls and restarts
// ---------------------------------------------------------------------------------------------------------------------
export function deadBall(ctx: Ctx, reason: DeadReason, timer: number, r: Restart, clockRuns = false): void {
  const st = ctx.state;
  const ball = ctx.ball;
  st.phase = "dead";
  st.deadReason = reason;
  st.deadTimer = timer;
  ctx.restart = r;
  ctx.deadExtra = 0;
  st.clockRunning = clockRuns && ctx.mode !== "practice" && st.clock > 0;
  if (ball.holder >= 0 && (ball.mode === "held" || ball.mode === "dribble")) {
    ball.mode = "dead";
  } else {
    ball.mode = "dead";
    ball.holder = -1;
    st.ballHandler = -1;
    for (const p of ctx.players) p.hasBall = false;
  }
  ball.pass = null;
  ctx.bounceSeg.on = false;
  ctx.callForBall = -1;
  st.laneTimer.fill(0);
  for (let s = 0; s < 10; s++) {
    const x = ctx.px[s];
    const p = ctx.players[s];
    x.passing = false;
    x.contestAt = -1;
    x.oopAt = -1;
    if (x.shot.on && !x.shot.released) {
      x.shot.on = false;
      p.meter.active = false;
      if (isShotAction(p.action)) setAction(ctx, s, "idle", 0);
    }
    x.spotOn = false;
  }
  prepareSpots(ctx, r);
}

/** Choose who walks to which spot for the coming restart. */
function prepareSpots(ctx: Ctx, r: Restart): void {
  if (r.k === "inbound") {
    ctx.inbPasser = chooseInbounder(ctx, r.team, r.x, r.z, r.afterMake);
    const x = ctx.px[ctx.inbPasser];
    x.spotOn = true;
    x.spot.set(r.x, 0, r.z);
    x.spotFace = yawTo(r.x, r.z, r.x * 0.85, 0);
  } else if (r.k === "ft") {
    ftSpots(ctx, r.shooter);
  } else if (r.k === "tip") {
    tipSpots(ctx);
  }
}

export function chooseInbounder(ctx: Ctx, team: TeamSide, x: number, z: number, afterMake: boolean): number {
  const handler = bestHandler(ctx, team, -1);
  let best = -1;
  let bd = 1e9;
  for (let s = team * 5; s < team * 5 + 5; s++) {
    if (!ctx.px[s].active || s === handler) continue;
    const p = ctx.players[s];
    let d = horizDist(p.pos.x, p.pos.z, x, z);
    if (afterMake) d -= (s % 5) * 1.5; // bigs take it out after makes
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best >= 0 ? best : team * 5 + 4;
}

export function bestHandler(ctx: Ctx, team: TeamSide, exclude: number): number {
  let best = -1;
  let bv = -1;
  for (let s = team * 5; s < team * 5 + 5; s++) {
    if (!ctx.px[s].active || s === exclude) continue;
    const r = ctx.players[s].data.ratings;
    const v = r.handle * 1.2 + r.passing + (s % 5 === 0 ? 45 : s % 5 === 1 ? 12 : 0); // the point guard brings it up
    if (v > bv) {
      bv = v;
      best = s;
    }
  }
  return best;
}

export function doRestart(ctx: Ctx, r: Restart | null): void {
  if (!r) return;
  switch (r.k) {
    case "inbound": beginInbound(ctx, r); break;
    case "ft": beginFT(ctx, r.shooter, r.total); break;
    case "tip": beginTip(ctx); break;
    case "nextPeriod": startNextPeriod(ctx); break;
    case "endPeriod": endPeriod(ctx); break;
    case "ftResume": resumeFT(ctx); break;
    case "inboundResume": resumeInbound(ctx); break;
    case "practice": practiceReset(ctx); break;
  }
}

/** Nearest legal throw-in spot (just out of bounds) for a play at (x, z). */
export function inboundSpot(x: number, z: number, out: { x: number; z: number }): { x: number; z: number } {
  const hl = COURT.halfL;
  const hw = COURT.halfW;
  if (Math.abs(x) >= hl - 0.05 && Math.abs(z) < hw) {
    out.x = Math.sign(x) * (hl + 0.35);
    let zz = clamp(z, -hw + 0.9, hw - 0.9);
    if (Math.abs(zz) < 1.4) zz = (zz >= 0 ? 1 : -1) * 1.4;
    out.z = zz;
  } else {
    out.x = clamp(x, -hl + 1.2, hl - 1.2);
    out.z = (z >= 0 ? 1 : -1) * (hw + 0.35);
  }
  return out;
}

const spotTmp = { x: 0, z: 0 };

export function beginInbound(ctx: Ctx, r: Extract<Restart, { k: "inbound" }>): void {
  const st = ctx.state;
  applySubs(ctx);
  let passer = ctx.inbPasser;
  if (passer < 0 || sideOf(passer) !== r.team || !ctx.px[passer].active) passer = chooseInbounder(ctx, r.team, r.x, r.z, r.afterMake);
  const p = ctx.players[passer];
  const x = ctx.px[passer];
  st.phase = "inbound";
  st.deadReason = null;
  p.pos.set(r.x, 0, r.z);
  p.vel.set(0, 0, 0);
  p.facing = yawTo(r.x, r.z, r.x * 0.85, 0);
  x.spotOn = true;
  x.spot.set(r.x, 0, r.z);
  x.spotFace = p.facing;
  setAction(ctx, passer, "inbound", 0);
  const ib = st.inbound ?? (st.inbound = { team: r.team, passer, spot: x.spot.clone(), timer: 0, afterMake: r.afterMake });
  ib.team = r.team;
  ib.passer = passer;
  ib.spot.set(r.x, 0, r.z);
  ib.timer = 0;
  ib.afterMake = r.afterMake;
  if (st.possession !== r.team) setPossession(ctx, r.team);
  resetShotClock(ctx, r.shotClock >= 0 ? r.shotClock : 24);
  st.backcourtTimer = 0;
  ctx.frontEstablished = r.x * dirOf(ctx, r.team) > 0;
  takeBall(ctx, passer);
  ctx.ball.mode = "held";
  ctx.inboundPassed = false;
  ctx.callForBall = -1;
  ctx.reboundPending = false;
  ctx.passLoose = null;
  ctx.pokeBy = -1;
  ctx.pendingFoul = null;
  ctx.periodEndPending = false;
  if (ctx.userTeam === r.team) setUser(ctx, bestHandler(ctx, r.team, passer));
  emit(ctx, { type: "inbound", team: r.team, passer });
}

function resumeInbound(ctx: Ctx): void {
  const ib = ctx.state.inbound;
  if (!ib) return;
  beginInbound(ctx, { k: "inbound", team: ib.team, x: ib.spot.x, z: ib.spot.z, afterMake: ib.afterMake, shotClock: ctx.state.shotClock });
}

export function updateInbound(ctx: Ctx, dt: number, startPass: (ctx: Ctx, from: number, to: number, kind: "inbound" | "lob") => void): void {
  const ib = ctx.state.inbound;
  if (!ib || ctx.inboundPassed) return;
  ib.timer += dt;
  const px = ctx.px[ib.passer];
  if (px.passing) return;
  if (ctx.callForBall >= 0 && sideOf(ctx.callForBall) === ib.team && ctx.callForBall !== ib.passer && ib.timer > 0.25) {
    startPass(ctx, ib.passer, ctx.callForBall, ctx.callLob ? "lob" : "inbound");
    ctx.callForBall = -1;
    return;
  }
  const auto = ctx.mode === "practice" ? 0.4 : ib.afterMake ? 0.75 : 1.5;
  if (ib.timer > auto) {
    const to = ctx.userTeam === ib.team ? ctx.userSlot : bestReceiver(ctx, ib.passer);
    if (to >= 0 && to !== ib.passer) startPass(ctx, ib.passer, to, "inbound");
  }
  if (ib.timer >= 5 && ctx.mode !== "practice") violation(ctx, ib.team, "fiveSeconds", ib.passer, ib.spot.x, ib.spot.z);
}

/** Most open teammate, preferring short safe passes. */
export function bestReceiver(ctx: Ctx, from: number): number {
  const p = ctx.players[from];
  let best = -1;
  let bv = -1e9;
  for (let s = p.team * 5; s < p.team * 5 + 5; s++) {
    if (s === from || !ctx.px[s].active) continue;
    const q = ctx.players[s];
    if (!inBounds(q.pos.x, q.pos.z, 0.2)) continue;
    const d = horizDist(p.pos.x, p.pos.z, q.pos.x, q.pos.z);
    const v = q.openness * 3 - Math.abs(d - 6) * 0.25 + (s % 5 === 0 ? 0.6 : 0);
    if (v > bv) {
      bv = v;
      best = s;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------------
// Turnovers, violations, out of bounds, fouls
// ---------------------------------------------------------------------------------------------------------------------
export function turnover(ctx: Ctx, slot: number, team: TeamSide, kind: TurnoverKind): void {
  if (slot >= 0) stat(ctx, slot, "tov");
  emit(ctx, { type: "turnover", slot, team, kind });
  emit(ctx, { type: "crowd", reaction: team === 0 ? "groan" : "cheer", strength: 0.45 });
}

const VIOLATION_TEXT: Partial<Record<TurnoverKind, string>> = {
  shotClock: "SHOT CLOCK VIOLATION", eightSeconds: "8 SECOND VIOLATION", backcourt: "BACKCOURT VIOLATION",
  threeSeconds: "3 SECONDS IN THE KEY", travel: "TRAVELING", fiveSeconds: "5 SECOND VIOLATION",
};

export function violation(ctx: Ctx, team: TeamSide, kind: TurnoverKind, slot: number, x: number, z: number): void {
  if (ctx.mode === "practice") return;
  emit(ctx, { type: "whistle", reason: "violation" });
  turnover(ctx, slot, team, kind);
  const txt = VIOLATION_TEXT[kind];
  if (txt) toast(ctx, txt, teamName(ctx, team).toUpperCase(), "neutral");
  inboundSpot(x, z, spotTmp);
  ctx.reboundPending = false;
  ctx.passLoose = null;
  ctx.pokeBy = -1;
  deadBall(ctx, "violation", 1.1, { k: "inbound", team: other(team), x: spotTmp.x, z: spotTmp.z, afterMake: false, shotClock: -1 });
}

export function outOfBounds(ctx: Ctx, x: number, z: number): void {
  const st = ctx.state;
  if (ctx.mode === "practice") {
    deadBall(ctx, "outOfBounds", 0.6, { k: "practice" });
    return;
  }
  const lt = st.lastTouch;
  const team: TeamSide = lt >= 0 ? sideOf(lt) : st.possession === -1 ? 0 : st.possession;
  const gets = other(team);
  emit(ctx, { type: "whistle", reason: "outOfBounds" });
  let shotClock = -1;
  if (gets === st.possession) {
    shotClock = ctx.reboundPending && ctx.shotObj.touchedRim ? 14 : Math.max(st.shotClock, 0.5);
  } else if (st.possession === team && !ctx.reboundPending) {
    turnover(ctx, lt, team, "outOfBounds");
  } else if (ctx.passLoose && ctx.passLoose.team === team) {
    turnover(ctx, ctx.passLoose.passer, team, "outOfBounds");
  }
  if (ctx.periodEndPending) {
    ctx.periodEndPending = false;
    deadBall(ctx, "outOfBounds", 1.0, { k: "endPeriod" });
    return;
  }
  ctx.reboundPending = false;
  ctx.passLoose = null;
  ctx.pokeBy = -1;
  inboundSpot(x, z, spotTmp);
  deadBall(ctx, "outOfBounds", 1.0, { k: "inbound", team: gets, x: spotTmp.x, z: spotTmp.z, afterMake: false, shotClock });
}

/** Personal + team foul bookkeeping and the whistle. Returns the number of free throws awarded. */
export function callFoul(ctx: Ctx, by: number, on: number, kind: FoulKind, shotsIn: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 {
  const st = ctx.state;
  const pb = ctx.players[by];
  const t = ctx.teams[pb.team];
  const offensive = kind === "charge" || kind === "offensive";
  pb.fouls++;
  t.fouls[pb.rosterIndex] = pb.fouls;
  stat(ctx, by, "pf");
  if (!offensive) {
    st.teamFouls[pb.team]++;
    const limit = st.period > 4 ? 4 : 5;
    st.bonus[other(pb.team)] = st.teamFouls[pb.team] >= limit;
  }
  let shots = shotsIn;
  if (!offensive && kind !== "shooting" && st.bonus[other(pb.team)]) shots = 2;
  const fouledOut = pb.fouls >= 6;
  emit(ctx, { type: "whistle", reason: "foul" });
  emit(ctx, {
    type: "foul", by, on, kind, shots, teamFouls: st.teamFouls[pb.team], bonus: st.bonus[other(pb.team)],
    personal: pb.fouls, fouledOut, at: v3(pb.pos),
  });
  emit(ctx, { type: "crowd", reaction: pb.team === 0 ? "boo" : "cheer", strength: 0.4 });
  rumble(ctx, on, 0.35, 0.3, 140);
  if (fouledOut && !t.fouledOut[pb.rosterIndex]) {
    t.fouledOut[pb.rosterIndex] = true;
    toast(ctx, `${pb.data.last.toUpperCase()} FOULS OUT`, "6 PERSONAL FOULS", toneOf(ctx, pb.team));
    queueForcedSub(ctx, by);
  }
  return shots;
}

/** Whistle + full restart for fouls that are not on a shot in the air. */
export function foulStop(ctx: Ctx, by: number, on: number, kind: FoulKind, x: number, z: number): void {
  const st = ctx.state;
  const offensive = kind === "charge" || kind === "offensive";
  const shots = callFoul(ctx, by, on, kind, 0);
  ctx.reboundPending = false;
  ctx.passLoose = null;
  ctx.pokeBy = -1;
  inboundSpot(x, z, spotTmp);
  if (offensive) {
    const team = sideOf(by);
    turnover(ctx, by, team, "offensiveFoul");
    toast(ctx, kind === "charge" ? "CHARGE" : "OFFENSIVE FOUL", lastName(ctx, by).toUpperCase(), toneOf(ctx, other(team)));
    deadBall(ctx, "foul", 1.25, { k: "inbound", team: other(team), x: spotTmp.x, z: spotTmp.z, afterMake: false, shotClock: -1 });
    return;
  }
  if (shots > 0) {
    deadBall(ctx, "foul", 1.25, { k: "ft", shooter: on, total: shots as 1 | 2 | 3 });
  } else {
    deadBall(ctx, "foul", 1.1, {
      k: "inbound", team: sideOf(on), x: spotTmp.x, z: spotTmp.z, afterMake: false, shotClock: Math.max(st.shotClock, 14),
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Shot results
// ---------------------------------------------------------------------------------------------------------------------
export function registerMake(ctx: Ctx): void {
  const sh = ctx.ball.shot;
  if (!sh || ctx.shotResolved) return;
  ctx.shotResolved = true;
  const st = ctx.state;
  const team = sh.team;
  const shooter = sh.shooter;
  const sx = ctx.px[shooter];
  const ft = sh.kind === "freeThrow";
  score(ctx, team, sh.points);
  stat(ctx, shooter, "pts", sh.points);
  let assist = -1;
  if (ft) stat(ctx, shooter, "ftm");
  else {
    stat(ctx, shooter, "fgm");
    if (sh.points === 3) stat(ctx, shooter, "tpm");
    if (sh.kind === "dunk" || sh.kind === "alleyOopDunk") stat(ctx, shooter, "dunks");
    // assist: a quick finish off the catch (no dribble move to create it, at most two gather dribbles)
    if (sx.catchFrom >= 0 && sideOf(sx.catchFrom) === team && ctx.time - sx.catchT < 2.6 && sx.dribbles <= 2 && sx.lastMoveT < sx.catchT) {
      assist = sx.catchFrom;
      stat(ctx, assist, "ast");
    }
  }
  sh.assister = assist;
  const andOne = !!ctx.pendingFoul && ctx.pendingFoul.on === shooter;
  const side = sh.target;
  emit(ctx, {
    type: "make", slot: shooter, team, kind: sh.kind, points: sh.points, dist: sh.dist, swish: sh.swish, assist, andOne,
    side, at: { x: side * COURT.rimX, y: COURT.rimHeight, z: 0 },
  });
  if (!ft) streak(ctx, shooter, true);
  const home = team === 0;
  const dunk = sh.kind === "dunk" || sh.kind === "alleyOopDunk";
  const three = sh.points === 3;
  const buzzer = ctx.periodEndPending && !ft;
  if (!ft || ctx.state.clutch) {
    emit(ctx, {
      type: "crowd",
      reaction: home ? (dunk || three || andOne || buzzer ? "roar" : "cheer") : dunk || three ? "groan" : "aww",
      strength: home ? (dunk || three ? 0.95 : 0.6) : 0.4,
    });
  }
  hype(ctx, dunk ? 0.22 : three ? 0.14 : andOne ? 0.16 : ft ? 0.01 : 0.05);
  if (sh.kind === "alleyOopDunk" || sh.kind === "alleyOopLayup") {
    emit(ctx, { type: "crowdHype", level: clamp(st.hype + 0.2, 0, 1), reason: "alleyOop" });
    toast(ctx, "ALLEY-OOP", `${lastName(ctx, assist >= 0 ? assist : shooter).toUpperCase()} TO ${lastName(ctx, shooter).toUpperCase()}`, toneOf(ctx, team));
  } else if (dunk) emit(ctx, { type: "crowdHype", level: clamp(st.hype + 0.15, 0, 1), reason: "dunk" });
  else if (three && (st.hype > 0.5 || st.clutch)) emit(ctx, { type: "crowdHype", level: st.hype, reason: "three" });
  if (andOne) {
    emit(ctx, { type: "crowdHype", level: clamp(st.hype + 0.1, 0, 1), reason: "andOne" });
    toast(ctx, "AND ONE", lastName(ctx, shooter).toUpperCase(), toneOf(ctx, team));
  }
  if (buzzer) {
    emit(ctx, { type: "crowdHype", level: 1, reason: "buzzerBeater" });
    toast(ctx, "BUZZER BEATER", `${lastName(ctx, shooter).toUpperCase()} · ${sh.points} PTS`, "hot");
    rumble(ctx, shooter, 0.8, 0.8, 450);
  }
  rumble(ctx, shooter, dunk ? 0.7 : 0.15, dunk ? 0.6 : 0.25, dunk ? 260 : 90);

  if (ctx.mode === "practice") {
    ctx.practiceT = 0;
    return;
  }
  if (ft) {
    ftResult(ctx, true);
    return;
  }
  if (ctx.pendingFoul) {
    const pf = ctx.pendingFoul;
    ctx.pendingFoul = null;
    deadBall(ctx, "foul", 1.3, { k: "ft", shooter: pf.on, total: 1 });
    return;
  }
  if (ctx.periodEndPending) {
    ctx.periodEndPending = false;
    deadBall(ctx, "made", 1.6, { k: "endPeriod" });
    return;
  }
  const late = st.period >= 4 && st.clock <= LATE;
  deadBall(ctx, "made", 0.7, {
    k: "inbound", team: other(team), x: side * (COURT.halfL + 0.35), z: ctx.rng() < 0.5 ? 1.7 : -1.7, afterMake: true, shotClock: -1,
  }, !late);
}

export function registerMiss(ctx: Ctx, airball: boolean, blocked: boolean): void {
  const sh = ctx.ball.shot;
  if (!sh || ctx.shotResolved) return;
  ctx.shotResolved = true;
  const team = sh.team;
  const ft = sh.kind === "freeThrow";
  emit(ctx, { type: "miss", slot: sh.shooter, team, kind: sh.kind, airball, side: sh.target });
  if (!ft) streak(ctx, sh.shooter, false);
  if (airball) emit(ctx, { type: "crowd", reaction: team === 0 ? "groan" : "ooh", strength: 0.6 });
  else if (!blocked) emit(ctx, { type: "crowd", reaction: team === 0 ? "aww" : "cheer", strength: team === 0 ? 0.45 : 0.3 });
  hype(ctx, 0.01);
  if (ctx.mode === "practice") {
    ctx.practiceT = 0;
    ctx.reboundPending = false;
    return;
  }
  if (ft) {
    ftResult(ctx, false);
    return;
  }
  ctx.reboundPending = true;
  ctx.reboundTeam = team;
  if (ctx.pendingFoul) {
    const pf = ctx.pendingFoul;
    ctx.pendingFoul = null;
    ctx.reboundPending = false;
    deadBall(ctx, "foul", 1.2, { k: "ft", shooter: pf.on, total: pf.shots === 0 ? 2 : pf.shots });
    return;
  }
  if (ctx.periodEndPending) {
    ctx.periodEndPending = false;
    ctx.reboundPending = false;
    deadBall(ctx, "periodEnd", 1.0, { k: "endPeriod" });
    return;
  }
  if (ctx.shotClockExpired && airball && !blocked) {
    emit(ctx, { type: "buzzer", kind: "shotClock" });
    violation(ctx, team, "shotClock", sh.shooter, ctx.ball.pos.x, ctx.ball.pos.z);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Free throws
// ---------------------------------------------------------------------------------------------------------------------
const FT_D = [2.25, 3.3, 4.35]; // lane spot distance in from the baseline (m)

export function ftSpots(ctx: Ctx, shooter: number): void {
  const team = sideOf(shooter);
  const d = dirOf(ctx, team);
  const lz = COURT.laneW / 2 + 0.42;
  const sx = ctx.px[shooter];
  sx.spotOn = true;
  sx.spot.set(d * (COURT.ftLineX - 0.28), 0, 0);
  sx.spotFace = d > 0 ? Math.PI / 2 : -Math.PI / 2;
  const off: number[] = [];
  const def: number[] = [];
  for (let s = 0; s < 10; s++) {
    if (s === shooter || !ctx.px[s].active) continue;
    (sideOf(s) === team ? off : def).push(s);
  }
  off.sort((a, b) => (b % 5) - (a % 5));
  def.sort((a, b) => (b % 5) - (a % 5));
  const bx = (fromBase: number) => d * (COURT.halfL - fromBase);
  const rim = d * COURT.rimX;
  const place = (s: number, x: number, z: number) => {
    const px = ctx.px[s];
    px.spotOn = true;
    px.spot.set(x, 0, z);
    px.spotFace = yawTo(x, z, rim, 0);
  };
  const offSpots: [number, number][] = [[bx(FT_D[1]), lz], [bx(FT_D[1]), -lz], [d * (COURT.rimX - 7.9), 4.6], [d * (COURT.rimX - 7.9), -4.6]];
  const defSpots: [number, number][] = [[bx(FT_D[0]), lz], [bx(FT_D[0]), -lz], [bx(FT_D[2]), lz], [bx(FT_D[2]), -lz], [d * (COURT.ftLineX - 2.4), 1.2]];
  off.forEach((s, i) => offSpots[i] && place(s, offSpots[i][0], offSpots[i][1]));
  def.forEach((s, i) => defSpots[i] && place(s, defSpots[i][0], defSpots[i][1]));
}

export function beginFT(ctx: Ctx, shooter: number, total: 1 | 2 | 3): void {
  const st = ctx.state;
  applySubs(ctx);
  const team = sideOf(shooter);
  st.phase = "freeThrow";
  st.deadReason = null;
  st.freeThrow = { shooter, team, index: 1, total, made: 0, live: total === 1 };
  st.clockRunning = false;
  if (st.possession !== team) setPossession(ctx, team);
  ftSpots(ctx, shooter);
  snapToSpots(ctx);
  takeBall(ctx, shooter);
  ctx.ftDelay = 0;
  ctx.ftWait = 0;
  ctx.reboundPending = false;
  if (ctx.userTeam === team) setUser(ctx, shooter);
  emit(ctx, { type: "freeThrowStart", slot: shooter, index: 1, total });
}

function resumeFT(ctx: Ctx): void {
  const ft = ctx.state.freeThrow;
  if (!ft) return;
  ctx.state.phase = "freeThrow";
  ctx.state.deadReason = null;
  ftSpots(ctx, ft.shooter);
  snapToSpots(ctx);
  takeBall(ctx, ft.shooter);
  ctx.ftDelay = 0;
  ctx.ftWait = 0;
  emit(ctx, { type: "freeThrowStart", slot: ft.shooter, index: ft.index, total: ft.total });
}

function ftResult(ctx: Ctx, made: boolean): void {
  const st = ctx.state;
  const ft = st.freeThrow;
  if (!ft) return;
  if (made) ft.made++;
  if (ft.index < ft.total) {
    ctx.ftDelay = 0.7;
    return;
  }
  // last attempt
  if (st.clock <= 0) {
    deadBall(ctx, made ? "made" : "periodEnd", 1.4, { k: "endPeriod" });
    st.freeThrow = null;
    return;
  }
  if (made) {
    const side = dirOf(ctx, ft.team);
    deadBall(ctx, "made", 0.8, {
      k: "inbound", team: other(ft.team), x: side * (COURT.halfL + 0.35), z: ctx.rng() < 0.5 ? 1.7 : -1.7, afterMake: true, shotClock: -1,
    });
    st.freeThrow = null;
  } else {
    st.phase = "live";
    st.freeThrow = null;
    ctx.reboundPending = true;
    ctx.reboundTeam = ft.team;
    for (const x of ctx.px) x.spotOn = false;
  }
}

export function updateFT(ctx: Ctx, dt: number, startShot: (ctx: Ctx, slot: number) => void): void {
  const st = ctx.state;
  const ft = st.freeThrow;
  if (!ft) return;
  if (ctx.ftDelay > 0) {
    ctx.ftDelay -= dt;
    if (ctx.ftDelay <= 0) {
      ft.index++;
      ft.live = ft.index === ft.total;
      ftSpots(ctx, ft.shooter);
      snapToSpots(ctx);
      takeBall(ctx, ft.shooter);
      ctx.ftWait = 0;
      emit(ctx, { type: "freeThrowStart", slot: ft.shooter, index: ft.index, total: ft.total });
    }
    return;
  }
  const sx = ctx.px[ft.shooter];
  if (!sx.shot.on && ctx.ball.holder === ft.shooter) {
    ctx.ftWait += dt;
    const human = ft.shooter === ctx.userSlot;
    if ((!human && ctx.ftWait > 0.55) || (human && ctx.ftWait > 15)) startShot(ctx, ft.shooter);
  }
}

/** Free-throw lane players stay on their spots until the last attempt leaves the shooter's hand. */
export function releaseLane(ctx: Ctx): void {
  for (const x of ctx.px) x.spotOn = false;
}

export function snapToSpots(ctx: Ctx): void {
  for (let s = 0; s < 10; s++) {
    const x = ctx.px[s];
    if (!x.spotOn) continue;
    const p = ctx.players[s];
    p.pos.set(x.spot.x, 0, x.spot.z);
    p.vel.set(0, 0, 0);
    p.facing = x.spotFace;
    if (!busy(p)) setAction(ctx, s, "idle", 0);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Tip-off / jump balls
// ---------------------------------------------------------------------------------------------------------------------
function jumper(ctx: Ctx, team: TeamSide): number {
  let best = team * 5 + 4;
  let bv = -1;
  for (let s = team * 5; s < team * 5 + 5; s++) {
    if (!ctx.px[s].active) continue;
    const p = ctx.players[s];
    const v = p.reach + vertOf(p) * 0.8;
    if (v > bv) {
      bv = v;
      best = s;
    }
  }
  return best;
}

function tipSpots(ctx: Ctx): void {
  const j0 = jumper(ctx, 0);
  const j1 = jumper(ctx, 1);
  ctx.tipJumpers = [j0, j1];
  for (const t of [0, 1] as TeamSide[]) {
    const d = dirOf(ctx, t);
    const j = t === 0 ? j0 : j1;
    const others: number[] = [];
    for (let s = t * 5; s < t * 5 + 5; s++) if (s !== j && ctx.px[s].active) others.push(s);
    // ring around the circle, the two teams interleaved so no two bodies share a spot
    // (team 0 at +-35 / +-145 deg from its attack direction, team 1 at +-75 / +-105 deg from its own)
    const R = 2.55;
    const angs = t === 0 ? [35, -35, 145, -145] : [75, -75, 105, -105];
    const spots: [number, number][] = angs.map((a) => {
      const r = (a * Math.PI) / 180;
      return [d * R * Math.cos(r), R * Math.sin(r)] as [number, number];
    });
    const jx = ctx.px[j];
    jx.spotOn = true;
    jx.spot.set(-d * 0.42, 0, 0);
    jx.spotFace = yawTo(-d * 0.42, 0, 0, 0);
    others.forEach((s, i) => {
      const x = ctx.px[s];
      const sp = spots[i] ?? spots[0];
      x.spotOn = true;
      x.spot.set(sp[0], 0, sp[1]);
      x.spotFace = yawTo(x.spot.x, x.spot.z, 0, 0);
    });
  }
}

export function beginTip(ctx: Ctx): void {
  const st = ctx.state;
  applySubs(ctx);
  st.phase = "tipoff";
  st.deadReason = null;
  st.clockRunning = false;
  ctx.tipT = 0;
  ctx.tipTossed = false;
  for (const x of ctx.px) x.spotOn = false;
  tipSpots(ctx);
  snapToSpots(ctx);
  const [j0, j1] = ctx.tipJumpers;
  const a = ctx.players[j0];
  const b = ctx.players[j1];
  const sa = a.reach + vertOf(a) + ctx.rng() * 0.32;
  const sb = b.reach + vertOf(b) + ctx.rng() * 0.32;
  ctx.tipWinner = sa >= sb ? 0 : 1;
  const ball = ctx.ball;
  for (const p of ctx.players) p.hasBall = false;
  ball.mode = "dead";
  ball.holder = -1;
  ball.shot = null;
  ball.pass = null;
  ball.pos.set(0, 1.45, 0);
  ball.vel.set(0, 0, 0);
  st.ballHandler = -1;
  ctx.reboundPending = false;
  if (st.period === 1 && st.possession === -1) emit(ctx, { type: "periodStart", period: 1 });
}

export function updateTip(ctx: Ctx, dt: number, tipTo: (ctx: Ctx, jumperSlot: number, toSlot: number) => void): void {
  ctx.tipT += dt;
  const ball = ctx.ball;
  if (!ctx.tipTossed) {
    ball.pos.set(0, 1.45 + Math.min(1, ctx.tipT / 1.3) * 0.35, 0);
    ball.vel.set(0, 0, 0);
    if (ctx.tipT >= 1.3) {
      ctx.tipTossed = true;
      ball.pos.set(0, 1.8, 0);
      ball.vel.set(0, 6.5, 0);
      emit(ctx, { type: "whistle", reason: "jumpBall" });
    }
    return;
  }
  const tossT = ctx.tipT - 1.3;
  for (const j of ctx.tipJumpers) {
    const p = ctx.players[j];
    if (p.action !== "jumpBall" && tossT > 0.22 && tossT < 0.5) {
      setAction(ctx, j, "jumpBall");
      ctx.px[j].jumpH = vertOf(p);
    }
  }
  const w = ctx.tipJumpers[ctx.tipWinner];
  const wp = ctx.players[w];
  const top = wp.reach + wp.pos.y + 0.1;
  if ((ball.vel.y < 0 && ball.pos.y <= top) || (ball.vel.y < 0 && ball.pos.y < 2.3)) {
    const to = bestHandler(ctx, ctx.tipWinner, w);
    tipTo(ctx, w, to);
  }
}

/** Called by the ball module the moment the winner taps the ball. */
export function tipped(ctx: Ctx, jumperSlot: number): void {
  const st = ctx.state;
  const team = sideOf(jumperSlot);
  for (const x of ctx.px) x.spotOn = false;
  st.phase = "live";
  if (ctx.mode !== "practice" && st.clock > 0) st.clockRunning = true;
  st.lastTouch = jumperSlot;
  if (st.period === 1 && st.firstPossession === -1) st.firstPossession = team;
  st.arrow = other(team);
  emit(ctx, { type: "tipoff", winner: team, jumper: jumperSlot });
  emit(ctx, { type: "crowd", reaction: "cheer", strength: 0.5 });
  setPossession(ctx, team);
}

// ---------------------------------------------------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------------------------------------------------
export function endPeriod(ctx: Ctx): void {
  const st = ctx.state;
  st.clock = 0;
  st.clockRunning = false;
  ctx.periodEndPending = false;
  const over = st.period >= 4 && st.score[0] !== st.score[1];
  if (!ctx.buzzed) emit(ctx, { type: "buzzer", kind: over ? "game" : "period" });
  ctx.buzzed = false;
  emit(ctx, { type: "periodEnd", period: st.period, score: [st.score[0], st.score[1]] });
  for (const x of ctx.px) {
    x.spotOn = false;
    x.passing = false;
  }
  if (ctx.ball.mode !== "dead") {
    ctx.ball.mode = "dead";
    if (ctx.ball.holder < 0) st.ballHandler = -1;
  }
  st.freeThrow = null;
  st.inbound = null;
  if (over) {
    st.phase = "final";
    st.winner = st.score[0] > st.score[1] ? 0 : 1;
    st.clutch = false;
    emit(ctx, { type: "gameEnd", score: [st.score[0], st.score[1]], winner: st.winner });
    emit(ctx, { type: "crowd", reaction: st.winner === 0 ? "roar" : "aww", strength: 1 });
    toast(ctx, "FINAL", `${ctx.teams[st.winner].data.city.toUpperCase()} WINS`, toneOf(ctx, st.winner));
    return;
  }
  st.phase = "periodBreak";
  st.deadReason = "periodEnd";
  // a broadcast break: the table, the crowd, a wide shot. Any button skips it (control()).
  st.deadTimer = st.period === 2 ? 7 : 5.5;
  ctx.restart = { k: "nextPeriod" };
  if (st.period === 2) emit(ctx, { type: "halftime" });
}

export function startNextPeriod(ctx: Ctx): void {
  const st = ctx.state;
  applySubs(ctx);
  st.period++;
  st.periodLength = periodSeconds(ctx.settings, st.period);
  st.clock = st.periodLength;
  st.teamFouls[0] = st.teamFouls[1] = 0;
  st.bonus[0] = st.bonus[1] = false;
  for (const t of [0, 1] as TeamSide[]) while (st.periodScores[t].length < st.period) st.periodScores[t].push(0);
  st.run[0] = st.run[1] = 0;
  if (st.period === 3) {
    st.attackDir[0] = st.attackDir[0] === 1 ? -1 : 1;
    st.attackDir[1] = st.attackDir[1] === 1 ? -1 : 1;
  }
  resetShotClock(ctx, 24);
  if (st.period > 4) {
    st.timeouts[0] = st.timeouts[1] = 2;
    emit(ctx, { type: "overtime", n: st.period - 4 });
    toast(ctx, st.period === 5 ? "OVERTIME" : `${st.period - 4}OT`, `${st.periodLength / 60}:00`, "neutral");
    emit(ctx, { type: "periodStart", period: st.period });
    beginTip(ctx);
    return;
  }
  emit(ctx, { type: "periodStart", period: st.period });
  const first: TeamSide = st.firstPossession === -1 ? 0 : st.firstPossession;
  const team: TeamSide = st.period === 4 ? first : other(first);
  const d = dirOf(ctx, team);
  st.possession = -1;
  beginInbound(ctx, { k: "inbound", team, x: -d * 1.2, z: -(COURT.halfW + 0.35), afterMake: false, shotClock: -1 });
}

// ---------------------------------------------------------------------------------------------------------------------
// Clocks and violations
// ---------------------------------------------------------------------------------------------------------------------
export function updateClocks(ctx: Ctx, dt: number): void {
  if (ctx.mode === "practice") return;
  const st = ctx.state;
  const ph = st.phase;
  if (st.clockRunning && (ph === "live" || ph === "dead" || ph === "inbound")) {
    const prev = st.clock;
    st.clock = Math.max(0, st.clock - dt);
    for (let s = 0; s < 10; s++) {
      if (!ctx.px[s].active) continue;
      const p = ctx.players[s];
      ctx.teams[p.team].box[p.rosterIndex].sec += prev - st.clock;
    }
    if (st.clock <= 0 && prev > 0) clockZero(ctx);
  }
  // Level-triggered safety net: a period must end whenever the game clock reads 0.0, not only on the edge.
  if (st.clock <= 0 && st.period > 0) periodAtZero(ctx);
  if (ph === "live" && st.clockRunning && st.possession !== -1 && st.shotClockOn) {
    const ball = ctx.ball;
    const frozen = ball.mode === "loose" && ctx.reboundPending && ctx.shotObj.touchedRim;
    if (!frozen && !ctx.shotClockExpired) {
      const prev = st.shotClock;
      st.shotClock = Math.max(0, st.shotClock - dt);
      if (st.shotClock <= 0 && prev > 0 && st.phase === "live") {
        if (ball.mode === "shot" || (ball.mode === "loose" && ctx.reboundPending)) {
          ctx.shotClockExpired = !ctx.shotObj.touchedRim;
          if (ctx.shotClockExpired) emit(ctx, { type: "buzzer", kind: "shotClock" });
        } else {
          emit(ctx, { type: "buzzer", kind: "shotClock" });
          const team = st.possession;
          const slot = ball.holder >= 0 ? ball.holder : st.lastTouch;
          violation(ctx, team, "shotClock", slot >= 0 && sideOf(slot) === team ? slot : -1, ball.pos.x, ball.pos.z);
        }
      }
    }
  }
  updateClutch(ctx);
}

function clockZero(ctx: Ctx): void {
  const st = ctx.state;
  st.clockRunning = false;
  if (st.phase === "live") {
    const ball = ctx.ball;
    if (ball.mode === "shot" && !ctx.shotResolved && ball.shot && ball.shot.releaseT <= ctx.time) {
      ctx.periodEndPending = true;
      ctx.buzzed = true;
      emit(ctx, { type: "buzzer", kind: st.period >= 4 && st.score[0] !== st.score[1] ? "game" : "period" });
    } else {
      endPeriod(ctx);
    }
  } else if (st.phase === "dead") {
    const k = ctx.restart?.k;
    if (k !== "ft" && k !== "ftResume" && k !== "endPeriod" && k !== "nextPeriod") ctx.restart = { k: "endPeriod" };
  } else if (st.phase === "inbound") {
    endPeriod(ctx);
  }
}

/** Runs every frame while the clock reads 0.0: ends a period that the edge trigger missed. */
function periodAtZero(ctx: Ctx): void {
  const st = ctx.state;
  st.clockRunning = false;
  const ph = st.phase;
  if (ph === "live") {
    const ball = ctx.ball;
    if (ball.mode === "shot" && !ctx.shotResolved) return; // shot in the air: let it land first
    endPeriod(ctx);
  } else if (ph === "dead") {
    const k = ctx.restart?.k;
    if (k !== "ft" && k !== "ftResume" && k !== "endPeriod" && k !== "nextPeriod") ctx.restart = { k: "endPeriod" };
  } else if (ph === "inbound") {
    endPeriod(ctx);
  }
}

export function checkViolations(ctx: Ctx, dt: number): void {
  if (ctx.mode === "practice") return;
  const st = ctx.state;
  if (st.phase !== "live") return;
  const team = st.possession;
  if (team === -1) return;
  const ball = ctx.ball;
  const dir = dirOf(ctx, team);
  const holding = ball.holder >= 0 && sideOf(ball.holder) === team && (ball.mode === "held" || ball.mode === "dribble");
  const control = holding || (ball.mode === "pass" && !!ball.pass && sideOf(ball.pass.from) === team);
  if (holding) {
    const h = ctx.players[ball.holder];
    if (!inBounds(h.pos.x, h.pos.z, -0.08)) {
      outOfBounds(ctx, h.pos.x, h.pos.z);
      return;
    }
  }
  if (control) {
    if (!ctx.frontEstablished) {
      if (holding && ctx.players[ball.holder].pos.x * dir > 0.05 && ball.pos.x * dir > 0.05) {
        ctx.frontEstablished = true;
        st.backcourtTimer = 0;
      } else {
        st.backcourtTimer += dt;
        if (st.backcourtTimer >= 8) {
          violation(ctx, team, "eightSeconds", ball.holder >= 0 ? ball.holder : st.lastTouch, ball.pos.x, ball.pos.z);
          return;
        }
      }
    } else if (holding && (ball.pos.x * dir < -0.05 && ctx.players[ball.holder].pos.x * dir < -0.05)) {
      violation(ctx, team, "backcourt", ball.holder, ball.pos.x, ball.pos.z);
      return;
    }
  }
  const counting = holding && ctx.frontEstablished;
  for (let s = team * 5; s < team * 5 + 5; s++) {
    const p = ctx.players[s];
    if (!ctx.px[s].active) continue;
    if (!inPaint(p.pos.x, p.pos.z, dir) || isShotAction(p.action) || (s === ball.holder && driving(ctx, p, dir))) {
      st.laneTimer[s] = 0;
      continue;
    }
    if (leavingLane(p, dir)) {
      st.laneTimer[s] = 0;
      continue;
    }
    if (!counting) continue; // pauses while the ball is in the air
    st.laneTimer[s] += dt;
    if (st.laneTimer[s] >= 3) {
      violation(ctx, team, "threeSeconds", s, p.pos.x, p.pos.z);
      return;
    }
  }
}

function leavingLane(p: PlayerState, dir: number): boolean {
  const outZ = Math.sign(p.pos.z || 1) * p.vel.z;
  return outZ > 1.0 || -dir * p.vel.x > 1.0;
}

function driving(ctx: Ctx, p: PlayerState, dir: number): boolean {
  const tx = dir * COURT.rimX - p.pos.x;
  const tz = -p.pos.z;
  const l = Math.hypot(tx, tz) || 1;
  return (p.vel.x * tx + p.vel.z * tz) / l > 1.2;
}

// ---------------------------------------------------------------------------------------------------------------------
// Flow per step
// ---------------------------------------------------------------------------------------------------------------------
export function updateDead(ctx: Ctx, dt: number): void {
  const st = ctx.state;
  if (st.phase === "dead") {
    st.deadTimer -= dt;
    applySubs(ctx);
    if (st.deadTimer <= 0) {
      let walking = false;
      for (let s = 0; s < 10; s++) {
        const x = ctx.px[s];
        if (!x.spotOn) continue;
        const p = ctx.players[s];
        if (horizDist(p.pos.x, p.pos.z, x.spot.x, x.spot.z) > 0.6) walking = true;
      }
      ctx.deadExtra += dt;
      if (!walking || ctx.deadExtra > 0.9) {
        snapToSpots(ctx);
        const r = ctx.restart;
        ctx.restart = null;
        doRestart(ctx, r);
      }
    }
  } else if (st.phase === "timeout" || st.phase === "periodBreak") {
    st.deadTimer -= dt;
    applySubs(ctx);
    for (const p of ctx.players) p.stamina = Math.min(1, p.stamina + dt * (st.phase === "timeout" ? 0.05 : 0.07));
    if (st.deadTimer <= 0) {
      if (st.phase === "timeout") {
        const r = ctx.afterTimeout;
        ctx.afterTimeout = null;
        st.phase = "dead";
        st.deadTimer = 0;
        ctx.restart = r;
        if (r) prepareSpots(ctx, r);
        snapToSpots(ctx);
        ctx.restart = null;
        doRestart(ctx, r);
      } else {
        const r = ctx.restart;
        ctx.restart = null;
        doRestart(ctx, r);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Timeouts and substitutions
// ---------------------------------------------------------------------------------------------------------------------
export function callTimeout(ctx: Ctx, team: TeamSide): boolean {
  const st = ctx.state;
  if (ctx.mode === "practice" || st.timeouts[team] <= 0) return false;
  const ball = ctx.ball;
  let after: Restart | null = null;
  if (st.phase === "live") {
    if (ball.holder < 0 || sideOf(ball.holder) !== team || (ball.mode !== "held" && ball.mode !== "dribble")) return false;
    const hx = ctx.px[ball.holder];
    if (hx.shot.on || hx.passing) return false;
    const d = dirOf(ctx, team);
    const late = st.period >= 4 && st.clock <= LATE;
    const x = late ? d * (COURT.halfL - 28 * 0.3048) : clamp(ball.pos.x, -COURT.halfL + 1.5, COURT.halfL - 1.5);
    after = { k: "inbound", team, x, z: -(COURT.halfW + 0.35), afterMake: false, shotClock: Math.max(st.shotClock, late ? 14 : 0.5) };
    ctx.inbPasser = chooseInbounder(ctx, team, x, -(COURT.halfW + 0.35), false);
  } else if (st.phase === "dead") {
    after = ctx.restart;
  } else if (st.phase === "inbound" && !ctx.inboundPassed && !ctx.px[st.inbound?.passer ?? 0].passing) {
    after = { k: "inboundResume" };
  } else if (st.phase === "freeThrow" && st.freeThrow && !ctx.px[st.freeThrow.shooter].shot.on && ctx.ftDelay <= 0) {
    after = { k: "ftResume" };
  } else return false;
  st.timeouts[team]--;
  emit(ctx, { type: "whistle", reason: "timeout" });
  emit(ctx, { type: "timeout", team, remaining: st.timeouts[team] });
  toast(ctx, "TIMEOUT", ctx.teams[team].data.name.toUpperCase(), toneOf(ctx, team));
  if (st.phase === "live") {
    deadBall(ctx, "timeout", 0, after as Restart);
    ctx.restart = null;
  }
  for (const x of ctx.px) {
    x.passing = false;
    if (x.shot.on && !x.shot.released) x.shot.on = false;
  }
  st.phase = "timeout";
  st.deadReason = "timeout";
  st.deadTimer = 4.5;
  st.clockRunning = false;
  ctx.afterTimeout = after;
  return true;
}

export function substitute(ctx: Ctx, team: TeamSide, slot: number, ri: number): boolean {
  const t = ctx.teams[team];
  if (slot < 0 || slot > 9 || sideOf(slot) !== team) return false;
  if (ri < 0 || ri >= t.data.players.length) return false;
  if (t.lineup.includes(ri) || t.fouledOut[ri] || t.data.players[ri].out) return false;
  if (t.pendingSubs.some((s) => s.rosterIndex === ri && s.slot !== slot)) return false;
  for (let i = t.pendingSubs.length - 1; i >= 0; i--) if (t.pendingSubs[i].slot === slot) t.pendingSubs.splice(i, 1);
  t.pendingSubs.push({ slot, rosterIndex: ri });
  const ph = ctx.state.phase;
  if (ph === "dead" || ph === "timeout" || ph === "periodBreak" || ph === "pregame") applySubs(ctx);
  return true;
}

export function applySubs(ctx: Ctx): void {
  for (const t of ctx.teams) {
    if (t.pendingSubs.length === 0) continue;
    for (const s of t.pendingSubs) {
      const p = ctx.players[s.slot];
      const old = p.rosterIndex;
      if (t.lineup.includes(s.rosterIndex) || t.fouledOut[s.rosterIndex]) continue;
      const data = t.data.players[s.rosterIndex];
      if (!data) continue;
      t.energy[old] = p.stamina;
      const outId = p.data.id;
      assignPlayer(p, s.rosterIndex, data);
      p.fouls = t.fouls[s.rosterIndex];
      p.stamina = t.energy[s.rosterIndex];
      p.onFire = 0;
      t.lineup[s.slot % 5] = s.rosterIndex;
      ctx.px[s.slot].streak = 0;
      emit(ctx, { type: "substitution", team: t.side, slot: s.slot, outId, inId: data.id });
    }
    t.pendingSubs.length = 0;
  }
}

export function queueForcedSub(ctx: Ctx, slot: number): void {
  const p = ctx.players[slot];
  const t = ctx.teams[p.team];
  let best = -1;
  let bv = -1e9;
  for (let i = 0; i < t.data.players.length; i++) {
    if (t.lineup.includes(i) || t.fouledOut[i] || t.data.players[i].out) continue;
    if (t.pendingSubs.some((s) => s.rosterIndex === i)) continue;
    const d = t.data.players[i];
    const v = d.ratings.overall * (0.6 + 0.4 * t.energy[i]) + (d.pos === p.data.pos || d.pos2 === p.data.pos ? 8 : 0);
    if (v > bv) {
      bv = v;
      best = i;
    }
  }
  if (best >= 0) substitute(ctx, p.team, slot, best);
}

export function practiceReset(ctx: Ctx): void {
  const st = ctx.state;
  st.phase = "live";
  st.deadReason = null;
  const u = ctx.userSlot >= 0 ? ctx.userSlot : (ctx.userTeam === -1 ? 0 : ctx.userTeam * 5);
  takeBall(ctx, u);
  st.possession = ctx.players[u].team;
}

export { LATE };
