import * as THREE from "three";
import type { GameEvent, InputFrame, MatchSetup, PlayerState, Settings, Sim, TeamRuntime, TeamSide, V3 } from "./contracts";
import { COURT, DIFFICULTY } from "./contracts";
import { starterIndices } from "./data";
import type { Ctx, PlayerX, ShotPlan } from "./sim-core";
import { clamp, hashStr, makeRng, sideOf } from "./sim-core";
import { looseBall, physics, placeHeld, shotFlight, tipTo, tossFlight } from "./sim-ball";
import { control } from "./sim-control";
import { passFlight, startPass } from "./sim-pass";
import { collide, derived, movePlayers, processCommands } from "./sim-play";
import {
  beginTip, callTimeout, checkViolations, practiceReset, resetShotClock, setPossession, setUser, substitute, takeBall,
  updateClocks, updateDead, updateFT, updateInbound, updateTip,
} from "./sim-rules";
import { checkBlocks, estimateChance, startShot } from "./sim-shot";
import { newBallState, newGameState, newIntent, newPlayerState, newStatLine } from "./state";

// HOOPS game sim: full 5v5 rules, ball physics, shots, passes, fouls, clocks, box score. Pure logic over a fixed
// step; deterministic for a given seed and input sequence. Owner: sim builder.
//
// Implementation map: sim-core (shared state + helpers), sim-rules (flow, clocks, fouls, violations, FT, subs),
// sim-shot (shot choice, meter, make chance, trajectories, blocks), sim-ball (ball placement + physics + rebounds),
// sim-pass (passes, alley-oops, interceptions), sim-play (commands, movement, moves, steals, collisions),
// sim-control (human input).

/** createSim accepts an optional seed for reproducible games (tests, replays). */
export type SimSetup = MatchSetup & { seed?: number };

function newShotPlan(): ShotPlan {
  return {
    on: false, kind: "jumper", points: 2, minP: 0.45, maxP: 0.8, targetP: 0.625, releaseP: 0.625, decided: false,
    released: false, grade: "none", user: false, startT: 0, finish: new THREE.Vector3(), from: new THREE.Vector3(),
    alley: false, style: null, window: 0.1, contest0: 0,
  };
}

function newPlayerX(): PlayerX {
  return {
    active: true, shot: newShotPlan(), passing: false, passKind: "chest", passTarget: -1, burst: new THREE.Vector3(),
    stealCd: 0, blockCd: 0, moveCd: 0, chargeT: 0, slowT: 0, squeakCd: 0, bumpCd: 0, screenCd: 0, lastMove: null,
    lastMoveT: -9, catchT: -9, catchFrom: -1, dribbles: 0, offRebT: -9, spot: new THREE.Vector3(), spotOn: false,
    spotFace: 0, jumpH: 0, air: new THREE.Vector3(), streak: 0, contestAt: -1, contestBlock: false, blockShot: -1,
    interceptPass: -1, prevP: 0, oopAt: -1, heldT: 0, spinBase: 0, prevMoveT: -9, screenT: 0,
  };
}

export function createSim(setup: SimSetup): Sim {
  const seed = setup.seed ?? (hashStr(setup.home.abbr + setup.away.abbr) ^ (Date.now() >>> 0));
  const settings: Settings = { ...setup.settings };
  const teams = [setup.home, setup.away].map((data, side) => {
    const lineup = starterIndices(data);
    const n = data.players.length;
    const t: TeamRuntime = {
      side: side as TeamSide, data, lineup,
      energy: new Array(n).fill(1), fouls: new Array(n).fill(0), fouledOut: new Array(n).fill(false),
      box: Array.from({ length: n }, newStatLine), totals: newStatLine(), pendingSubs: [],
    };
    return t;
  }) as [TeamRuntime, TeamRuntime];
  const players: PlayerState[] = Array.from({ length: 10 }, (_, slot) => {
    const side = sideOf(slot);
    const t = teams[side];
    const ri = t.lineup[slot % 5] ?? 0;
    const p = newPlayerState(slot, side, ri, t.data.players[ri]);
    p.facing = side === 0 ? Math.PI / 2 : -Math.PI / 2;
    return p;
  });
  const state = newGameState(clamp(Math.round(settings.quarterMinutes), 1, 12));
  const ball = newBallState();
  const userTeam = setup.userTeam;
  const ctx: Ctx = {
    setup, settings, diff: DIFFICULTY[settings.difficulty], mode: setup.mode, state, ball, players,
    intents: Array.from({ length: 10 }, newIntent), teams, px: Array.from({ length: 10 }, newPlayerX), userTeam,
    userSlot: userTeam === -1 ? -1 : userTeam * 5, time: 0, events: [], pending: [], rng: makeRng(seed),
    restart: null, afterTimeout: null, deadExtra: 0, tipT: 0, tipTossed: false, tipWinner: 0, tipJumpers: [4, 9], tipLockT: -9, tipLockTeam: 0,
    frontEstablished: false, reboundPending: false, reboundTeam: 0, shotId: 0, passId: 0, periodEndPending: false,
    shotClockExpired: false, pendingFoul: null, ftDelay: 0, ftWait: 0, ftResolved: false, callForBall: -1, callLob: false,
    passLoose: null, pokeBy: -1, pokeFrom: -1, looseT: 0, shotResolved: true, rimEvT: -9, boardEvT: -9, bounceEvT: -9,
    crowdT: 0, lastHypeRun: [0, 0], inboundPassed: false, practiceT: 0, lastPossession: -1, clockAtRelease: 0,
    inbPasser: -1, buzzed: false, net: { on: false, side: 1 },
    seg: {
      on: false, i: 0, n: 0, left: 0, pts: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
      dur: [0, 0, 0, 0], ev: [0, 0, 0, 0],
    },
    shotObj: {
      shooter: -1, team: 0, kind: "jumper", points: 2, dist: 0, from: new THREE.Vector3(), target: 1, contest: 0,
      timing: "none", chance: 0, make: false, swish: false, blocked: false, assister: -1, airTime: 0, releaseT: -9,
      touchedRim: false,
    },
    passObj: { from: -1, to: -1, kind: "chest", flight: 0, t: 0, start: new THREE.Vector3(), end: new THREE.Vector3() },
    bounceSeg: { on: false, left: 0, end: new THREE.Vector3(), t2: 0 },
    prevBall: new THREE.Vector3(),
  };
  const practice = setup.mode === "practice";
  const ut: TeamSide = userTeam === -1 ? 0 : userTeam;

  // opening positions: tip-off circle, or a shootaround for practice
  if (practice) {
    state.possession = ut;
    state.clock = state.periodLength;
    for (let s = 0; s < 10; s++) {
      const p = players[s];
      if (sideOf(s) !== ut) {
        ctx.px[s].active = false;
        p.pos.set(3 + (s % 5) * 0.95, 0, -(COURT.halfW + 2.4));
        p.facing = 0;
      } else {
        const d = state.attackDir[ut];
        const k = s % 5;
        const spots: [number, number][] = [[7.4, 0], [6.2, -4.8], [1.0, 6.4], [3.6, 3.0], [1.2, -2.2]];
        p.pos.set(d * (COURT.rimX - spots[k][0]), 0, spots[k][1]);
        p.facing = d > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
    }
  } else {
    beginTip(ctx);
    state.phase = "pregame";
  }
  ctx.events.length = 0;

  const tmpPos = new THREE.Vector3();

  function practiceUpdate(dt: number) {
    state.clockRunning = false;
    if (state.phase !== "live") return;
    state.possession = ut;
    const h = ball.holder;
    if (h >= 0 && h !== ctx.userSlot && sideOf(h) === ut && (ball.mode === "held" || ball.mode === "dribble")) {
      ctx.practiceT += dt;
      if (ctx.practiceT > 0.35 && !ctx.px[h].passing) startPass(ctx, h, ctx.userSlot, "chest");
    } else if (h < 0 && (ball.mode === "loose" || ball.mode === "dead")) {
      ctx.practiceT += dt;
      if (ctx.practiceT > 4) {
        ctx.practiceT = 0;
        practiceReset(ctx);
      }
    } else ctx.practiceT = 0;
  }

  function stepBall(dt: number) {
    if (state.phase === "tipoff") {
      tossFlight(ctx, dt);
      return;
    }
    switch (ball.mode) {
      case "held":
      case "dribble":
        if (ball.holder >= 0) placeHeld(ctx, dt);
        else ball.mode = "loose";
        break;
      case "dead":
        if (ball.holder >= 0) placeHeld(ctx, dt);
        else physics(ctx, dt);
        break;
      case "pass":
        passFlight(ctx, dt);
        break;
      case "shot":
        checkBlocks(ctx);
        if (ball.mode === "shot") shotFlight(ctx, dt);
        else physics(ctx, dt);
        break;
      case "loose":
        physics(ctx, dt);
        looseBall(ctx, dt);
        break;
    }
  }

  const sim: Sim & { seed: number } = {
    seed, state, ball, players, intents: ctx.intents, teams,
    get userTeam() {
      return ctx.userTeam;
    },
    get userSlot() {
      return ctx.userSlot;
    },
    get time() {
      return ctx.time;
    },
    get difficulty() {
      return ctx.settings.difficulty;
    },
    mode: setup.mode,
    dir(team: TeamSide) {
      return state.attackDir[team];
    },
    shotChance(slot: number) {
      if (slot < 0 || slot > 9) return 0;
      return estimateChance(ctx, slot);
    },
    mates(slot: number, out: number[]) {
      out.length = 0;
      const base = slot < 5 ? 0 : 5;
      for (let i = base; i < base + 5; i++) if (i !== slot) out.push(i);
      return out;
    },
    begin() {
      if (practice) {
        practiceReset(ctx);
        return;
      }
      if (state.phase === "pregame") beginTip(ctx);
    },
    control(frame: InputFrame) {
      const ev = ctx.events;
      ctx.events = ctx.pending;
      control(ctx, frame);
      ctx.events = ev;
    },
    step(dt: number): GameEvent[] {
      ctx.events.length = 0;
      if (ctx.pending.length) {
        for (const e of ctx.pending) ctx.events.push(e);
        ctx.pending.length = 0;
      }
      ctx.time += dt;
      const ph = state.phase;
      if (ph === "pregame" || ph === "final") {
        movePlayers(ctx, dt);
        collide(ctx);
        if (ball.holder >= 0) placeHeld(ctx, dt);
        else if (ph === "final") physics(ctx, dt);
        derived(ctx, dt);
        return ctx.events;
      }
      processCommands(ctx);
      switch (state.phase) {
        case "tipoff": updateTip(ctx, dt, tipTo); break;
        case "dead": case "timeout": case "periodBreak": updateDead(ctx, dt); break;
        case "inbound": updateInbound(ctx, dt, (c, from, to, kind) => { startPass(c, from, to, kind); }); break;
        case "freeThrow": updateFT(ctx, dt, (c, slot) => { startShot(c, slot, "freeThrow"); }); break;
        default: break;
      }
      movePlayers(ctx, dt);
      collide(ctx);
      stepBall(dt);
      if (practice) practiceUpdate(dt);
      updateClocks(ctx, dt);
      checkViolations(ctx, dt);
      // the free-throw banner belongs to the trip to the line only
      if (state.freeThrow && (state.phase === "live" || state.phase === "inbound")) state.freeThrow = null;
      derived(ctx, dt);
      return ctx.events;
    },
    substitute(team: TeamSide, slot: number, rosterIndex: number) {
      return substitute(ctx, team, slot, rosterIndex);
    },
    callTimeout(team: TeamSide) {
      return callTimeout(ctx, team);
    },
    setSettings(s: Settings) {
      ctx.settings = { ...s };
      ctx.diff = DIFFICULTY[s.difficulty];
    },
    debugGive(slot: number, at?: V3) {
      if (slot < 0 || slot > 9) return;
      const p = players[slot];
      if (at) {
        p.pos.set(at.x, 0, at.z);
        p.vel.set(0, 0, 0);
      }
      for (const x of ctx.px) {
        x.spotOn = false;
        x.passing = false;
        x.shot.on = false;
      }
      state.phase = "live";
      state.deadReason = null;
      state.freeThrow = null;
      state.inbound = null;
      ctx.restart = null;
      ctx.reboundPending = false;
      ctx.pendingFoul = null;
      ctx.periodEndPending = false;
      ctx.net.on = false;
      if (state.possession !== p.team) setPossession(ctx, p.team);
      else resetShotClock(ctx, 24);
      takeBall(ctx, slot);
      if (!practice && state.clock > 0) state.clockRunning = true;
      if (ctx.userTeam === p.team) setUser(ctx, slot);
      tmpPos.copy(p.pos);
    },
    dispose() {
      ctx.events.length = 0;
      for (const t of teams) t.pendingSubs.length = 0;
    },
  };
  return sim;
}

/** Same as createSim with a fixed seed (tests, replays). */
export function createSimSeeded(setup: MatchSetup, seed: number): Sim {
  return createSim({ ...setup, seed });
}
