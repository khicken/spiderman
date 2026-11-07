import * as THREE from "three";
import type { AI, GameEvent, Settings, Sim, TeamSide } from "./contracts";
import { COURT } from "./contracts";
import type { Ctx } from "./ai-core";
import { PLAY_LABEL, brainSkill, setAiRng, clamp, keepIn, newSlotMem, newTeamBrain, steer, timeToHeight } from "./ai-core";
import { coach } from "./ai-coach";
import { defend, onPass, onPossession, onScreen, onShotStart, perceive, rebound, resetMarks, snapPerception } from "./ai-defense";
import { attack, inbound, onCatch, onOwnPass, onOwnPossession, onScreenCall, shotTick } from "./ai-offense";
import { freeThrows, idle } from "./ai-special";

// HOOPS team AI entry. Runs once per sim step before sim.step(): reads last step's events, updates both teams'
// perception, then writes intents for every slot except the human's. Offense and defense live in ai-offense.ts and
// ai-defense.ts, dead balls in ai-special.ts, the bench in ai-coach.ts.

export function createAI(sim: Sim, settings: Settings): AI {
  const brains = [newTeamBrain(0), newTeamBrain(1)] as Ctx["brains"];
  // seeded AI randomness: same sim seed -> same game (tests, bug repro)
  const seed = (sim as Sim & { seed?: number }).seed;
  setAiRng(typeof seed === "number" ? mulberry(seed ^ 0x9e3779b9) : Math.random);
  const ctx: Ctx = {
    sim,
    settings: { ...settings },
    mem: Array.from({ length: 10 }, (_, i) => newSlotMem(i)),
    brains,
    dt: 0,
    time: 0,
  };
  for (const b of brains) brainSkill(b, ctx.settings, sim.userTeam);
  snapPerception(ctx, brains[0]);
  snapPerception(ctx, brains[1]);
  for (const m of ctx.mem) m.lastId = sim.players[m.slot].data.id;

  let lastPoss: TeamSide | -1 = -1;
  let lastUser = sim.userSlot;
  let lastUserTeam = sim.userTeam;
  let lastPhase = sim.state.phase;
  let disposed = false;
  const landing = new THREE.Vector3();

  function teamOf(slot: number): TeamSide {
    return slot < 5 ? 0 : 1;
  }

  function possessionChanged(team: TeamSide, live: boolean) {
    onOwnPossession(ctx, brains[team], live);
    onPossession(ctx, brains[1 - team]);
  }

  function handle(events: readonly GameEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case "pass": {
          const t = teamOf(e.from);
          onOwnPass(ctx, brains[t], e.from, e.to);
          onPass(ctx, brains[1 - t], e.from, e.to);
          break;
        }
        case "catch":
          onCatch(ctx, brains[teamOf(e.slot)], e.slot);
          break;
        case "shotStart":
          onShotStart(ctx, brains[1 - teamOf(e.slot)], e.slot);
          break;
        case "screenCall":
          onScreenCall(ctx, brains[teamOf(e.slot)], e.slot);
          break;
        case "screen":
          onScreen(ctx, brains[1 - teamOf(e.screener)], e.screener, e.for);
          break;
        case "rebound":
          if (e.offensive) {
            const b = brains[e.team];
            b.play = "none";
            b.transition = 0;
            b.possT = 0;
            ctx.mem[e.slot].holdT = 0;
            ctx.mem[e.slot].catchT = 0;
          }
          break;
        case "timeout":
          brains[e.team].afterTimeout = true;
          brains[0].play = brains[1].play = "none";
          break;
        case "periodStart":
          resetMarks(brains[0]);
          resetMarks(brains[1]);
          brains[0].play = brains[1].play = "none";
          break;
        default:
          break;
      }
    }
  }

  function trackSlots() {
    for (let s = 0; s < 10; s++) {
      const m = ctx.mem[s];
      const id = sim.players[s].data.id;
      if (m.lastId !== id) {
        m.lastId = id;
        m.onSince = ctx.time;
      }
    }
    const us = sim.userSlot;
    if (us !== lastUser) {
      // a slot handed back to the AI starts clean
      if (lastUser >= 0) {
        const m = ctx.mem[lastUser];
        m.shooting = false;
        m.driving = false;
        m.combo = "none";
        m.role = "space";
        m.spotIdx = -1;
        m.think = 0.1;
        const it = sim.intents[lastUser];
        it.shootHeld = false;
      }
      lastUser = us;
    }
    if (sim.userTeam !== lastUserTeam) {
      lastUserTeam = sim.userTeam;
      for (const b of brains) brainSkill(b, ctx.settings, sim.userTeam);
    }
  }

  /** Where a loose ball comes down to catchable height. */
  function predictLanding() {
    const ball = sim.ball;
    let t = timeToHeight(ball.pos.y, ball.vel.y, 2.3);
    if (t < 0 || ball.pos.y < 2.3) t = 0.12;
    t = clamp(t, 0, 1.3);
    landing.set(ball.pos.x + ball.vel.x * t, 0, ball.pos.z + ball.vel.z * t);
    keepIn(landing, 0.3);
  }

  function live(dt: number) {
    const ball = sim.ball;
    const st = sim.state;
    if (ball.mode === "shot" && ball.shot) {
      const sh = ball.shot;
      landing.set(sh.target * COURT.rimX, 0, 0);
      rebound(ctx, landing, sh.team, true, dt);
      return;
    }
    if (ball.mode === "loose") {
      predictLanding();
      rebound(ctx, landing, st.possession, false, dt);
      return;
    }
    const poss = st.possession;
    if (poss === -1) {
      idle(ctx, true);
      return;
    }
    attack(ctx, poss, dt);
    if (sim.mode !== "practice") defend(ctx, (1 - poss) as TeamSide, dt);
    else idle(ctx, true);
    // the receiver meets the pass
    if (ball.mode === "pass" && ball.pass) {
      const to = ball.pass.to;
      if (to >= 0 && to !== sim.userSlot && sim.players[to].team === poss) {
        const m = ctx.mem[to];
        m.target.copy(ball.pass.end).setY(0);
        m.urgency = 0.6;
        m.tight = true;
        m.faceOn = true;
        m.face.copy(ball.pos).setY(0);
        steer(sim.players[to], sim.intents[to], m, null);
      }
    }
  }

  const ai: AI = {
    update(dt, events) {
      if (disposed) return;
      ctx.dt = dt;
      ctx.time = sim.time;
      trackSlots();
      handle(events);
      const st = sim.state;
      // possession changes (also when the sim emits no event for it)
      if (st.possession !== lastPoss) {
        if (st.possession !== -1) possessionChanged(st.possession, st.phase === "live");
        lastPoss = st.possession;
      }
      if (st.phase !== lastPhase) {
        if (st.phase === "tipoff" || st.phase === "periodBreak") {
          snapPerception(ctx, brains[0]);
          snapPerception(ctx, brains[1]);
        }
        lastPhase = st.phase;
      }
      perceive(ctx, brains[0], dt);
      perceive(ctx, brains[1], dt);

      switch (st.phase) {
        case "live":
          live(dt);
          break;
        case "inbound": {
          const ib = st.inbound;
          if (ib) {
            inbound(ctx, ib.team, dt);
            if (sim.mode !== "practice") defend(ctx, (1 - ib.team) as TeamSide, dt);
          } else idle(ctx, true);
          break;
        }
        case "freeThrow": {
          const ft = st.freeThrow;
          const ball = sim.ball;
          if (ft && ft.live && (ball.mode === "loose" || (ball.mode === "shot" && ball.holder < 0))) {
            if (ball.mode === "shot" && ball.shot) {
              landing.set(ball.shot.target * COURT.rimX, 0, 0);
              rebound(ctx, landing, ft.team, true, dt);
            } else {
              predictLanding();
              rebound(ctx, landing, ft.team, false, dt);
            }
            // the shooter still has to let go of the button
            const m = ctx.mem[ft.shooter];
            if (m.shooting && ft.shooter !== sim.userSlot) shotTick(ctx, brains[ft.team], ft.shooter, sim.intents[ft.shooter], m, dt);
          } else freeThrows(ctx, dt);
          break;
        }
        case "tipoff":
          idle(ctx, true);
          break;
        default:
          idle(ctx, st.phase === "dead");
          break;
      }
      coach(ctx, dt);
    },
    setSettings(s) {
      ctx.settings = { ...s };
      for (const b of brains) brainSkill(b, ctx.settings, sim.userTeam);
    },
    playName(team) {
      if (sim.state.possession !== team) return null;
      if (sim.state.phase === "freeThrow") return null;
      return PLAY_LABEL[brains[team].play];
    },
    dispose() {
      disposed = true;
    },
  };
  return ai;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
