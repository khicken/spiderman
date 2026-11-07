import * as THREE from "three";
import type { Action, GameEvent, InputFrame, MatchSetup, Sim, TeamRuntime, TeamSide, V3 } from "./contracts";
import { COURT, DIFFICULTY, basketPos, distToBasket, shotValue } from "./contracts";
import { starterIndices } from "./data";
import { assignPlayer, newBallState, newGameState, newIntent, newPlayerState, newStatLine } from "./state";

// A fake Sim for lab pages: players jog around half-court spots, the ball handler dribbles, someone shoots every few
// seconds, possession flips after each shot. Implements the full Sim interface so camera, players, arena, fx, audio,
// ui and ai labs can run before the real sim exists. Not used by the real game.

const SPOTS: [number, number][] = [
  [-7.6, 0], // PG top of the key (x measured from the basket toward midcourt, z across)
  [-5.4, -5.6], // SG wing
  [-1.2, 6.8], // SF corner
  [-3.4, 2.4], // PF elbow
  [-0.9, -2.0], // C block
];

export function createMockSim(setup: MatchSetup): Sim {
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
  const players = Array.from({ length: 10 }, (_, slot) => {
    const side = (slot < 5 ? 0 : 1) as TeamSide;
    const t = teams[side];
    const ri = t.lineup[slot % 5] ?? 0;
    return newPlayerState(slot, side, ri, t.data.players[ri]);
  });
  const intents = Array.from({ length: 10 }, newIntent);
  const state = newGameState(setup.settings.quarterMinutes);
  const ball = newBallState();
  const events: GameEvent[] = [];
  const tmp = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  let time = 0;
  let shotTimer = 4;
  let userTeam = setup.userTeam;
  let userSlot = userTeam === -1 ? -1 : userTeam * 5;
  let flightT = 0;
  let flightDur = 1;
  const from = new THREE.Vector3();
  const rim = new THREE.Vector3();

  state.phase = "live";
  state.possession = 0;
  state.clockRunning = true;
  ball.holder = 0;
  ball.mode = "dribble";

  const v3 = (v: THREE.Vector3): V3 => ({ x: v.x, y: v.y, z: v.z });
  const dir = (t: TeamSide) => state.attackDir[t];

  function spot(p: (typeof players)[number], out: THREE.Vector3) {
    const off = state.possession === p.team;
    const d = dir(state.possession === -1 ? 0 : (state.possession as TeamSide));
    const [sx, sz] = SPOTS[p.slot % 5];
    const bx = d * COURT.rimX;
    out.set(bx + d * sx, 0, sz);
    if (!off) {
      // defender between his man and the basket
      out.x = bx + d * sx * 0.75;
      out.z = sz * 0.8;
    }
    out.x += Math.sin(time * 0.7 + p.slot) * 0.8;
    out.z += Math.cos(time * 0.5 + p.slot * 1.7) * 0.8;
    return out;
  }

  function setAction(p: (typeof players)[number], a: Action, dur = 0) {
    if (p.action === a) return;
    p.action = a;
    p.actionT = 0;
    p.actionDur = dur;
  }

  const sim: Sim = {
    state, ball, players, intents, teams,
    get userTeam() {
      return userTeam;
    },
    get userSlot() {
      return userSlot;
    },
    get time() {
      return time;
    },
    difficulty: setup.settings.difficulty,
    mode: setup.mode,
    dir,
    shotChance(slot) {
      const p = players[slot];
      const d = distToBasket(p.pos.x, p.pos.z, dir(p.team));
      return Math.max(0.05, 0.7 - d * 0.045) + DIFFICULTY[setup.settings.difficulty].userShot * (p.team === userTeam ? 1 : 0);
    },
    mates(slot, out) {
      out.length = 0;
      const base = slot < 5 ? 0 : 5;
      for (let i = base; i < base + 5; i++) if (i !== slot) out.push(i);
      return out;
    },
    begin() {
      state.phase = "live";
    },
    control(frame: InputFrame) {
      if (userSlot < 0) return;
      const it = intents[userSlot];
      it.move.copy(frame.moveWorld);
      it.sprint = frame.sprint;
      it.shootHeld = frame.shoot.down;
      if (frame.switchP.pressed && userTeam !== -1) {
        userSlot = userTeam * 5 + ((userSlot % 5) + 1) % 5;
        events.push({ type: "userSwitch", slot: userSlot });
      }
    },
    step(dt) {
      events.length = 0;
      time += dt;
      if (state.clockRunning) {
        state.clock = Math.max(0, state.clock - dt);
        state.shotClock = Math.max(0, state.shotClock - dt);
      }
      for (const p of players) {
        p.user = p.slot === userSlot;
        const it = intents[p.slot];
        if (p.user && it.move.lengthSq() > 0.01) {
          tgt.copy(p.pos).addScaledVector(it.move, 3);
        } else spot(p, tgt);
        tmp.subVectors(tgt, p.pos).setY(0);
        const dist = tmp.length();
        const speed = Math.min(p.maxSpeed * (p.user && it.sprint > 0.5 ? 1 : 0.6), dist * 2.5);
        if (dist > 0.01) tmp.multiplyScalar(speed / dist);
        p.vel.lerp(tmp, Math.min(1, dt * 6));
        p.pos.addScaledVector(p.vel, dt);
        p.pos.x = THREE.MathUtils.clamp(p.pos.x, -COURT.halfL, COURT.halfL);
        p.pos.z = THREE.MathUtils.clamp(p.pos.z, -COURT.halfW, COURT.halfW);
        const sp = p.vel.length();
        if (sp > 0.3) p.facing = Math.atan2(p.vel.x, p.vel.z);
        p.hasBall = ball.holder === p.slot;
        const off = p.team === state.possession;
        p.crouch = off ? (p.hasBall ? 0.4 : 0.1) : 0.7;
        p.handsUp = !off && p.slot % 5 === 0 ? 0.6 : 0;
        p.lookAt.copy(ball.pos);
        if (p.action === "jumpShot") {
          if (p.actionT > p.actionDur) setAction(p, "idle");
        } else if (p.hasBall) setAction(p, "dribble");
        else if (!off) setAction(p, "defend");
        else setAction(p, sp > 5 ? "sprint" : sp > 0.4 ? "run" : "idle");
        p.actionT += dt;
        p.actionP = p.actionDur > 0 ? Math.min(1, p.actionT / p.actionDur) : (p.actionT * (0.8 + sp * 0.25)) % 1;
        p.stamina = Math.max(0.3, Math.min(1, p.stamina - sp * dt * 0.002 + dt * 0.004));
      }

      if (ball.mode === "dribble" && ball.holder >= 0) {
        const h = players[ball.holder];
        const prev = ball.dribblePhase;
        ball.dribblePhase = (ball.dribblePhase + dt * 2.2) % 1;
        if (prev < 0.5 && ball.dribblePhase >= 0.5) events.push({ type: "dribble", slot: h.slot, at: v3(ball.pos), strength: 0.7 });
        const side = ball.dribbleHand;
        const yaw = h.facing;
        const hx = Math.cos(yaw) * 0.32 * side + Math.sin(yaw) * 0.25;
        const hz = -Math.sin(yaw) * 0.32 * side + Math.cos(yaw) * 0.25;
        const yHand = h.height * 0.48;
        const s = Math.abs(ball.dribblePhase - 0.5) * 2; // 1 at hand, 0 at floor
        ball.pos.set(h.pos.x + hx, COURT.ballR + (yHand - COURT.ballR) * s * s * (3 - 2 * s), h.pos.z + hz);
        ball.spin.set(0, 0, 0);
        shotTimer -= dt;
        if (shotTimer <= 0) {
            const team = h.team;
          basketPos(dir(team), rim);
          from.copy(ball.pos).setY(h.height + 0.4);
          setAction(h, "jumpShot", 0.95);
          const dist = distToBasket(h.pos.x, h.pos.z, dir(team));
          flightDur = 0.7 + dist * 0.06;
          flightT = 0;
          const points = shotValue(h.pos.x, h.pos.z, dir(team));
          ball.mode = "shot";
          ball.holder = -1;
          state.ballHandler = -1;
          ball.shot = {
            shooter: h.slot, team, kind: points === 3 ? "three" : "jumper", points, dist, from: from.clone(), target: dir(team),
            contest: 0.3, timing: "none", chance: 0.5, make: Math.random() < 0.6, swish: Math.random() < 0.5, blocked: false,
            assister: -1, airTime: flightDur, releaseT: time, touchedRim: false,
          };
          events.push({ type: "shot", slot: h.slot, team, kind: ball.shot.kind, points, dist, contest: 0.3, timing: "none", chance: 0.5, at: v3(from) });
        }
      } else if (ball.mode === "shot" && ball.shot) {
        flightT += dt;
        const k = Math.min(1, flightT / flightDur);
        const apex = Math.max(from.y, rim.y) + 1.2 + ball.shot.dist * 0.12;
        ball.pos.lerpVectors(from, rim, k);
        ball.pos.y = (1 - k) * (1 - k) * from.y + 2 * (1 - k) * k * (2 * apex - (from.y + rim.y) / 2) + k * k * rim.y;
        if (!ball.shot.make) ball.pos.z += k * 0.25;
        ball.spin.set(0, 0, -20);
        ball.side = ball.shot.target;
        if (k >= 1) {
          const sh = ball.shot;
          if (sh.make) {
            state.score[sh.team] += sh.points;
            events.push(sh.swish ? { type: "swish", side: sh.target } : { type: "rim", side: sh.target, strength: 0.4, at: v3(rim) });
            events.push({ type: "make", slot: sh.shooter, team: sh.team, kind: sh.kind, points: sh.points, dist: sh.dist, swish: sh.swish, assist: -1, andOne: false, side: sh.target, at: v3(rim) });
            events.push({ type: "crowd", reaction: sh.points === 3 ? "roar" : "cheer", strength: 0.8 });
          } else {
            events.push({ type: "rim", side: sh.target, strength: 0.9, at: v3(rim) });
            events.push({ type: "miss", slot: sh.shooter, team: sh.team, kind: sh.kind, airball: false, side: sh.target });
            events.push({ type: "crowd", reaction: "aww", strength: 0.5 });
          }
          state.hype = Math.min(1, state.hype + (sh.make ? 0.15 : 0.03));
          const next = (1 - sh.team) as TeamSide;
          state.possession = next;
          state.shotClock = 24;
          const handler = next * 5;
          ball.mode = "dribble";
          ball.holder = handler;
          ball.shot = null;
          ball.side = 0;
          state.ballHandler = handler;
          if (userTeam !== -1) userSlot = next === userTeam ? handler : userTeam * 5;
          events.push({ type: "possession", team: next });
          shotTimer = 4 + Math.random() * 4;
        }
      }
      state.hype = Math.max(0.2, state.hype - dt * 0.02);
      return events;
    },
    substitute(team, slot, rosterIndex) {
      const t = teams[team];
      const p = players[slot];
      const data = t.data.players[rosterIndex];
      if (!data || t.lineup.includes(rosterIndex)) return false;
      t.lineup[slot % 5] = rosterIndex;
      assignPlayer(p, rosterIndex, data);
      events.push({ type: "substitution", team, slot, outId: "", inId: data.id });
      return true;
    },
    callTimeout(team) {
      if (state.timeouts[team] <= 0) return false;
      state.timeouts[team]--;
      events.push({ type: "timeout", team, remaining: state.timeouts[team] });
      return true;
    },
    setSettings() {},
    debugGive(slot) {
      ball.mode = "dribble";
      ball.holder = slot;
      state.possession = players[slot].team;
    },
    dispose() {},
  };
  for (const p of players) spot(p, p.pos);
  return sim;
}
