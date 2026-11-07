import * as THREE from "three";
import type { DribbleMove, InputFrame } from "./contracts";
import type { Ctx } from "./sim-core";
import { horizDist, sideOf, toBasket } from "./sim-core";
import { setUser } from "./sim-rules";

// Human input -> intents[userSlot]. Contextual buttons (offense vs defense), switching, icon passes, dribble moves
// from the flick direction. Never clears a pending command: only presses write cmd. Owner: sim builder.

const tB = new THREE.Vector3();
const mates: number[] = [];

export function pickMove(ctx: Ctx, slot: number, fx: number, fz: number): DribbleMove {
  const p = ctx.players[slot];
  toBasket(ctx, p, tB);
  const l = Math.hypot(fx, fz) || 1;
  const ux = fx / l;
  const uz = fz / l;
  const fwd = ux * tB.x + uz * tB.z;
  const lat = ux * -tB.z + uz * tB.x; // + toward the right hand when facing the basket
  const hand = ctx.ball.dribbleHand;
  if (fwd < -0.7) return "stepBack";
  if (fwd < -0.2) return "behindBack";
  if (fwd > 0.7) return "spin";
  if (lat * hand < 0) return Math.hypot(p.vel.x, p.vel.z) < 1.5 ? "between" : "crossover";
  return "hesitation";
}

function switchToBall(ctx: Ctx): void {
  const b = ctx.ball.pos;
  const team = ctx.userTeam;
  if (team === -1) return;
  let best = -1;
  let bd = 1e9;
  for (let s = team * 5; s < team * 5 + 5; s++) {
    if (s === ctx.userSlot || !ctx.px[s].active) continue;
    const q = ctx.players[s];
    const d = horizDist(q.pos.x, q.pos.z, b.x, b.z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  if (best >= 0) setUser(ctx, best);
}

export function control(ctx: Ctx, f: InputFrame): void {
  const team = ctx.userTeam;
  if (team === -1) return;
  const st = ctx.state;
  const ball = ctx.ball;
  if (f.any && (st.phase === "timeout" || st.phase === "periodBreak")) st.deadTimer = Math.min(st.deadTimer, 0.3);
  if (ctx.userSlot < 0 || sideOf(ctx.userSlot) !== team || !ctx.px[ctx.userSlot].active) {
    ctx.userSlot = team * 5;
    ctx.events.push({ type: "userSwitch", slot: ctx.userSlot });
  }
  const offense = st.possession === team;
  if (!offense && f.switchP.pressed && (st.phase === "live" || st.phase === "inbound")) switchToBall(ctx);

  const s = ctx.userSlot;
  const it = ctx.intents[s];
  it.move.set(f.moveWorld.x, 0, f.moveWorld.z);
  it.sprint = f.sprint;
  it.faceTarget = null;
  it.shootHeld = f.shoot.down;
  it.post = offense && f.post.down;
  it.intense = !offense && f.intense.down;
  it.handsUp = !offense && f.handsUp;
  it.cut = offense && f.sprint > 0.5 && ball.holder !== s;
  if (f.moveWorld.x * f.moveWorld.x + f.moveWorld.z * f.moveWorld.z > 0.04) it.aim.copy(f.moveWorld).setY(0);
  else it.aim.set(0, 0, 0);

  const ft = st.phase === "freeThrow" && !!st.freeThrow && st.freeThrow.shooter === s;
  const has = ball.holder === s && (ball.mode === "held" || ball.mode === "dribble");
  if (ft) {
    if (f.shoot.pressed) it.cmd = "shoot";
    return;
  }
  if (offense) {
    if (has) {
      if (f.iconPick >= 0) {
        mates.length = 0;
        for (let i = team * 5; i < team * 5 + 5; i++) if (i !== s) mates.push(i);
        const t = mates[f.iconPick];
        if (t !== undefined) {
          it.cmd = "pass";
          it.target = t;
        }
      } else if (f.shoot.pressed) it.cmd = "shoot";
      else if (f.pass.pressed) {
        it.cmd = "pass";
        it.target = -1;
      } else if (f.bounce.pressed) {
        it.cmd = "bouncePass";
        it.target = -1;
      } else if (f.lob.pressed) {
        it.cmd = "lobPass";
        it.target = -1;
      } else if (f.flick && f.flickWorld.x * f.flickWorld.x + f.flickWorld.z * f.flickWorld.z > 0.01) {
        it.cmd = "dribbleMove";
        it.move2 = pickMove(ctx, s, f.flickWorld.x, f.flickWorld.z);
        it.aim.copy(f.flickWorld).setY(0);
      } else if (f.screen.pressed) it.cmd = "callScreen";
    } else {
      if (f.pass.pressed || f.bounce.pressed) {
        ctx.callForBall = s;
        ctx.callLob = false;
      } else if (f.lob.pressed) {
        ctx.callForBall = s;
        ctx.callLob = true;
      }
      if (f.shoot.pressed && ball.mode === "pass" && ball.pass && ball.pass.to === s) it.cmd = "shoot";
    }
    return;
  }
  if (st.phase !== "live" && st.phase !== "freeThrow") return;
  if (f.steal.pressed) it.cmd = "steal";
  else if (f.block.pressed) it.cmd = "block";
  else if (f.charge.pressed) it.cmd = "takeCharge";
}
