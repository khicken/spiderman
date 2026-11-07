import type { Ctx } from "./ai-core";
import { COURT } from "./contracts";
import { clamp, rand, steer, toWorld } from "./ai-core";
import { shotTick, startShot } from "./ai-offense";

// HOOPS dead-ball situations: free-throw lane lineups and the shooter's routine, tip-off and idle phases.

const LANE_V = COURT.laneW / 2 + 0.38;
const LANE_U = [0.75, 1.7, 2.65];
const rank: number[] = [0, 0, 0, 0, 0];

/** Order the 5 players of a team by height (desc) into `rank`, skipping `skip`. Returns count. */
function bySize(ctx: Ctx, t: number, skip: number): number {
  let n = 0;
  for (let k = 0; k < 5; k++) {
    const s = t * 5 + k;
    if (s !== skip) rank[n++] = s;
  }
  for (let i = 1; i < n; i++) {
    const v = rank[i];
    let j = i - 1;
    while (j >= 0 && ctx.sim.players[rank[j]].height < ctx.sim.players[v].height) {
      rank[j + 1] = rank[j];
      j--;
    }
    rank[j + 1] = v;
  }
  return n;
}

export function freeThrows(ctx: Ctx, dt: number): void {
  const { sim, mem } = ctx;
  const ft = sim.state.freeThrow;
  if (!ft) return;
  const d = sim.dir(ft.team);
  for (let t = 0; t < 2; t++) {
    const shooting = t === ft.team;
    const n = bySize(ctx, t, ft.shooter);
    for (let i = 0; i < n; i++) {
      const s = rank[i];
      if (s === sim.userSlot) continue;
      const m = mem[s];
      const p = sim.players[s];
      const it = sim.intents[s];
      it.cut = false;
      it.post = false;
      it.handsUp = false;
      it.intense = false;
      it.target = -1;
      if (!m.shooting) it.shootHeld = false;
      m.faceOn = true;
      toWorld(d, 0, 0, m.face);
      m.tight = true;
      if (!ft.live) {
        // non-final attempt: lane spots are not required, stand loose near the arc
        toWorld(d, 6.2 + (i % 2) * 1.1, (i % 2 === 0 ? 1 : -1) * (2.2 + i * 0.9), m.target);
      } else if (shooting) {
        // offense takes the second spot on each side, the rest stay back
        if (i < 2) toWorld(d, LANE_U[1], i === 0 ? LANE_V : -LANE_V, m.target);
        else toWorld(d, 8.6, i === 2 ? 3.4 : -3.4, m.target);
      } else {
        if (i < 2) toWorld(d, LANE_U[0], i === 0 ? -LANE_V : LANE_V, m.target);
        else if (i === 2) toWorld(d, LANE_U[2], LANE_V, m.target);
        else toWorld(d, 7.8, 0.8, m.target);
      }
      m.urgency = 0.4;
      steer(p, it, m, null);
    }
  }
  // shooter routine
  const s = ft.shooter;
  if (s === sim.userSlot) return;
  const p = sim.players[s];
  const it = sim.intents[s];
  const m = mem[s];
  const b = ctx.brains[ft.team];
  toWorld(d, COURT.ftDist + 0.25, 0, m.target);
  m.faceOn = true;
  toWorld(d, 0, 0, m.face);
  m.urgency = 0.3;
  m.tight = true;
  steer(p, it, m, null);
  if (sim.ball.holder !== s) {
    m.routineT = 0;
    if (m.shooting) shotTick(ctx, b, s, it, m, dt, p.data.ratings.ft);
    return;
  }
  if (m.shooting) {
    shotTick(ctx, b, s, it, m, dt, p.data.ratings.ft);
    return;
  }
  m.routineT += dt;
  if (m.routineT > 1.05 + clamp((100 - p.data.ratings.iq) / 200, 0, 0.3) + rand(0, 0.02)) {
    startShot(ctx, b, s, it, m);
    m.routineT = -99;
  }
}

/** Stand still and watch the ball: tip-off, timeouts, breaks, pregame, final, whistles. */
export function idle(ctx: Ctx, faceBall: boolean): void {
  const { sim, mem } = ctx;
  for (let s = 0; s < 10; s++) {
    if (s === sim.userSlot) continue;
    const it = sim.intents[s];
    const m = mem[s];
    it.move.set(0, 0, 0);
    it.sprint = 0;
    it.shootHeld = false;
    it.handsUp = false;
    it.intense = false;
    it.post = false;
    it.cut = false;
    it.target = -1;
    m.shooting = false;
    m.driving = false;
    m.combo = "none";
    if (faceBall) {
      m.face.copy(sim.ball.pos).setY(0);
      it.faceTarget = m.face;
    } else it.faceTarget = null;
  }
}
