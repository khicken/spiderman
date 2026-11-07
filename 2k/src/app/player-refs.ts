import * as THREE from "three";
import type { GameEvent, PlayerData, PlayerState, SimView, TeamSide } from "./contracts";
import { COURT } from "./contracts";
import type { RefSignal } from "./player-anim";
import { newPlayerState } from "./state";

// Three-person officiating crew: lead (baseline), center (far sideline at the free throw line extended) and trail
// (near sideline behind the play). They keep their angles on the ball, rotate on possession changes and signal calls.

const RATINGS = {
  overall: 50, close: 50, mid: 50, three: 50, ft: 50, layup: 50, dunk: 30, passing: 50, handle: 40, postScoring: 30,
  perimeterD: 40, interiorD: 40, steal: 30, block: 30, offReb: 30, defReb: 30, speed: 55, accel: 55, strength: 50,
  vertical: 40, stamina: 80, iq: 90,
};

export function refData(i: number): PlayerData {
  return {
    id: `ref-${i}`, first: "", last: ["Ortega", "Mbeki", "Larsen"][i % 3], jersey: [12, 27, 41][i % 3], pos: "C",
    heightIn: [74, 76, 72][i % 3], weightLb: [205, 215, 190][i % 3], age: 44, hand: "R", skin: [0.15, 0.7, 0.45][i % 3],
    hair: i === 1 ? "bald" : "short", beard: i === 2, headband: false, archetype: "official", starter: false,
    ratings: { ...RATINGS }, season: { ppg: 0, rpg: 0, apg: 0, fgPct: 0, tpPct: 0, ftPct: 0 },
  };
}

export interface Refs {
  readonly states: PlayerState[];
  readonly signal: RefSignal[];
  readonly signalT: number[];
  update(dt: number, view: SimView): void;
  handle(events: readonly GameEvent[]): void;
}

const _t = new THREE.Vector3();
const _d = new THREE.Vector3();

export function createRefs(): Refs {
  const states = [0, 1, 2].map((i) => {
    const p = newPlayerState(-1, 0 as TeamSide, 0, refData(i));
    p.pos.set([-8, 0, 8][i], 0, [-(COURT.halfW + 0.5), COURT.halfW + 0.5, -(COURT.halfW + 0.5)][i]);
    return p;
  });
  const signal: RefSignal[] = ["none", "none", "none"];
  const signalT = [0, 0, 0];
  const signalDur = [0, 0, 0];
  let dir = 1;
  let view: SimView | null = null;
  let threeRef = -1;

  function nearest(x: number, z: number): number {
    let best = 0;
    let bd = 1e9;
    for (let i = 0; i < 3; i++) {
      const d = (states[i].pos.x - x) ** 2 + (states[i].pos.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
  function sig(i: number, s: RefSignal, dur: number) {
    signal[i] = s;
    signalT[i] = 0;
    signalDur[i] = dur;
  }

  return {
    states, signal, signalT,
    handle(events) {
      for (const e of events) {
        switch (e.type) {
          case "foul":
            sig(nearest(e.at.x, e.at.z), "foul", 1.7);
            break;
          case "shot":
            if (e.points === 3) {
              threeRef = nearest(e.at.x, e.at.z);
              sig(threeRef, "three", 1.5);
            }
            break;
          case "make":
            if (e.points === 3) sig(threeRef >= 0 ? threeRef : nearest(e.at.x, e.at.z), "threeMade", 1.7);
            threeRef = -1;
            break;
          case "miss":
            threeRef = -1;
            break;
          case "timeout":
            sig(2, "timeout", 1.6);
            break;
          case "whistle":
            if (e.reason === "violation" || e.reason === "outOfBounds" || e.reason === "jumpBall") {
              const b = view?.ball.pos;
              sig(b ? nearest(b.x, b.z) : 0, "whistle", 1.1);
            }
            break;
          default:
            break;
        }
      }
    },
    update(dt, v) {
      view = v;
      const st = v.state;
      const ball = v.ball.pos;
      if (st.possession === 0 || st.possession === 1) dir = v.dir(st.possession);
      const bx = ball.x;
      const tip = st.phase === "tipoff" || st.phase === "pregame";
      for (let i = 0; i < 3; i++) {
        const p = states[i];
        if (signal[i] !== "none") {
          signalT[i] += dt;
          if (signalT[i] > signalDur[i]) signal[i] = "none";
        }
        if (tip) {
          if (i === 0) _t.set(0.2, 0, -1.6);
          else if (i === 1) _t.set(-1.5, 0, COURT.halfW + 0.5);
          else _t.set(1.5, 0, -(COURT.halfW + 0.5));
        } else if (i === 0) {
          // lead: on the baseline, ball side of the lane but never under the rim
          const z = THREE.MathUtils.clamp(ball.z * 0.45 + 1.4, -4.8, 4.8);
          _t.set(dir * (COURT.halfL + 0.85), 0, Math.abs(z) < 1.1 ? 1.1 * Math.sign(z || 1) : z);
        } else if (i === 1) {
          // center: far sideline around the free throw line extended, sliding with the ball
          const x = dir * THREE.MathUtils.clamp(bx * dir * 0.55 + 3.8, -2, COURT.ftLineX + 1.2);
          _t.set(x, 0, COURT.halfW + 0.55);
        } else {
          // trail: near sideline, well behind the ball. The broadcast rig sits behind this sideline and trucks with the
          // ball, so a trail a few steps back would stand right in the middle of the shot: keep him ~7.5 m back
          const x = dir * THREE.MathUtils.clamp(bx * dir - 7.5, -COURT.halfL + 1.5, COURT.halfL * 0.45);
          _t.set(x, 0, -(COURT.halfW + 0.55));
        }
        _d.subVectors(_t, p.pos).setY(0);
        const dist = _d.length();
        const maxV = dist > 6 ? 6.8 : dist > 2 ? 4.5 : 2.4;
        const want = Math.min(maxV, dist * 2.2);
        if (dist > 0.001) _d.multiplyScalar(want / dist);
        p.vel.lerp(_d, Math.min(1, dt * 5));
        p.pos.addScaledVector(p.vel, dt);
        p.pos.y = 0;
        const sp = Math.hypot(p.vel.x, p.vel.z);
        // face the ball, but turn toward the run when sprinting the floor
        let fx = ball.x - p.pos.x;
        let fz = ball.z - p.pos.z;
        if (sp > 5) {
          fx = fx * 0.3 + p.vel.x;
          fz = fz * 0.3 + p.vel.z;
        }
        const yaw = Math.atan2(fx, fz);
        let dy = yaw - p.facing;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const turn = THREE.MathUtils.clamp(dy * 6, -7, 7);
        p.turnRate = turn;
        p.facing += turn * dt;
        p.lookAt.copy(ball);
        const a = sp > 4.5 ? "sprint" : sp > 0.6 ? "run" : "idle";
        if (p.action !== a) {
          p.action = a;
          p.actionT = 0;
        }
        p.actionT += dt;
        p.crouch = 0;
      }
    },
  };
}
