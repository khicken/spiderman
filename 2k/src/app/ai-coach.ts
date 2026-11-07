import type { Position, TeamSide } from "./contracts";
import type { Ctx } from "./ai-core";
import { dbg } from "./ai-core";

// HOOPS bench coach: substitutions by fatigue and foul trouble, starters back when rested, best five in crunch time,
// and timeouts to stop runs or set up a late possession.

const POS_I: Record<Position, number> = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };

function fit(a: { pos: Position; pos2?: Position }, slotPos: Position): number {
  const t = POS_I[slotPos];
  let dd = Math.abs(POS_I[a.pos] - t);
  if (a.pos2) dd = Math.min(dd, Math.abs(POS_I[a.pos2] - t) + 0.3);
  return 8 - dd * 3.5;
}

/** Personal fouls that send a player to the bench in this period (6 = out). */
function foulLimit(period: number, clock: number, periodLength: number): number {
  if (period >= 4) return clock < periodLength * 0.5 ? 6 : 5;
  return period + 1;
}

function onFloorOrPending(ctx: Ctx, t: TeamSide, ri: number): boolean {
  const team = ctx.sim.teams[t];
  if (team.lineup.includes(ri)) return true;
  for (const ps of team.pendingSubs) if (ps.rosterIndex === ri) return true;
  return false;
}

function slotPending(ctx: Ctx, t: TeamSide, slot: number): boolean {
  for (const ps of ctx.sim.teams[t].pendingSubs) if (ps.slot === slot) return true;
  return false;
}

function bestBench(ctx: Ctx, t: TeamSide, slotPos: Position, minEnergy: number, starterOnly: boolean): number {
  const { sim } = ctx;
  const team = sim.teams[t];
  const st = sim.state;
  let best = -1;
  let bv = -1e9;
  const lim = foulLimit(st.period, st.clock, st.periodLength);
  for (let ri = 0; ri < team.data.players.length; ri++) {
    if (team.fouledOut[ri] || onFloorOrPending(ctx, t, ri)) continue;
    const pd = team.data.players[ri];
    if (pd.out || (starterOnly && !pd.starter)) continue;
    const e = team.energy[ri] ?? 1;
    if (e < minEnergy) continue;
    if ((team.fouls[ri] ?? 0) >= lim) continue;
    const v = pd.ratings.overall + fit(pd, slotPos) + e * 10;
    if (v > bv) {
      bv = v;
      best = ri;
    }
  }
  return best;
}

function subs(ctx: Ctx, t: TeamSide, manage: boolean): void {
  const { sim, mem, settings } = ctx;
  const b = ctx.brains[t];
  const team = sim.teams[t];
  const st = sim.state;
  const lim = foulLimit(st.period, st.clock, st.periodLength);
  const crunch = st.period >= 4 && st.clock < Math.min(150, st.periodLength * 0.35);
  for (let k = 0; k < 5; k++) {
    const slot = t * 5 + k;
    if (slotPending(ctx, t, slot)) continue;
    const p = sim.players[slot];
    const ri = p.rosterIndex;
    const out = team.fouledOut[ri] || p.fouls >= 6;
    if (!manage && !out) continue;
    if (slot === sim.userSlot && !out && !settings.autoSubs) continue;
    const stint = ctx.time - mem[slot].onSince;
    const starter = p.data.starter;
    const trouble = settings.fouls && p.fouls >= lim && !crunch;
    const tiredLine = crunch ? 0.22 : starter ? 0.4 : 0.34;
    const tired = settings.fatigue && p.stamina < tiredLine;
    let ri2 = -1;
    let why = "";
    if (out) {
      ri2 = bestBench(ctx, t, p.data.pos, 0, false);
      why = "out";
    } else if (b.subBudget <= 0) continue;
    else if ((trouble && stint > 45) || (tired && stint > (starter ? 120 : 180))) {
      ri2 = bestBench(ctx, t, p.data.pos, 0.72, false);
      why = tired ? "tired" : "fouls";
    } else if (!starter && stint > 240) {
      const c = bestBench(ctx, t, p.data.pos, crunch ? 0.55 : 0.85, true);
      if (c >= 0 && team.data.players[c].ratings.overall > p.data.ratings.overall + 1) ri2 = c;
      why = "starterBack";
    } else if (crunch && stint > 30) {
      const c = bestBench(ctx, t, p.data.pos, 0.55, false);
      if (c >= 0 && team.data.players[c].ratings.overall > p.data.ratings.overall + 4) ri2 = c;
      why = "crunch";
    }
    if (ri2 >= 0 && ri2 !== ri && sim.substitute(t, slot, ri2)) {
      dbg("sub_" + why);
      if (!out) b.subBudget--;
    }
  }
}

export function coach(ctx: Ctx, dt: number): void {
  const { sim, settings } = ctx;
  const st = sim.state;
  if (sim.mode === "practice" || st.phase === "pregame" || st.phase === "final") return;
  for (let t = 0 as TeamSide; t <= 1; t = (t + 1) as TeamSide) {
    const b = ctx.brains[t];
    b.subT -= dt;
    // coaches sub in small waves: refill the budget slowly
    b.subBudget = Math.min(2, b.subBudget + dt / 110);
    if (b.subT <= 0) {
      b.subT = 1.25;
      subs(ctx, t, b.cpu || settings.autoSubs);
    }
    // timeouts: CPU teams only
    if (!b.cpu) continue;
    b.toCd -= dt;
    if (b.toCd > 0) continue;
    const opp = 1 - t;
    const lead = st.score[t] - st.score[opp];
    const left = st.timeouts[t];
    if (left <= 0) continue;
    const runLine = 8 + Math.round((1 - b.iq) * 4);
    const stopRun = st.run[opp] >= runLine && st.run[opp] > b.runAtTO && (left > 2 || st.period >= 4);
    const late = st.period >= 4 && st.clock < 24 && lead <= 0 && lead >= -3 && st.possession === t &&
      (st.phase === "inbound" || st.phase === "dead") && !b.toThisPossession;
    let avg = 0;
    for (let k = 0; k < 5; k++) avg += sim.players[t * 5 + k].stamina;
    const gassed = settings.fatigue && avg / 5 < 0.36 && st.phase === "dead" && left > 3 && b.gassedPeriod !== st.period;
    if (stopRun || late || gassed) {
      if (sim.callTimeout(t)) {
        dbg(stopRun ? "to_run" : late ? "to_late" : "to_gassed");
        b.toCd = 40;
        b.runAtTO = st.run[opp];
        b.afterTimeout = true;
        b.toThisPossession = true;
        if (gassed) b.gassedPeriod = st.period;
      } else b.toCd = 0.5;
    }
  }
}
