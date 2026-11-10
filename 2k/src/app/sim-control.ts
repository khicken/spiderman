import * as THREE from "three";
import type { DribbleMove, InputFrame } from "./contracts";
import type { Ctx } from "./sim-core";
import { clamp, horizDist, sideOf, toBasket } from "./sim-core";
import { setUser } from "./sim-rules";

// Human input -> intents[userSlot]. Contextual buttons (offense vs defense), switching, icon passes, dribble moves
// from the flick direction. Never clears a pending command: only presses write cmd. Owner: sim builder.
//
// v2 feel:
// - Shot timing is measured from the real button edges (InputFrame.shoot.held), not from the render frame that saw
//   them: the gather is back-dated to the press and the release moment is press + held. Frame jitter (33 ms at 30 fps)
//   no longer eats half of the perfect window.
// - Defensive assist: an idle stick on defense hands the user's feet to the AI (intent.assist = 1) so a new player
//   never leaves his man wide open; holding intense D (Q / LT) locks on to the man (assist = 2, 50/50 with the stick).
//   Any stick input above 0.2 gives full control back on the same frame.
// - No auto-switch on defense (genre default): the user keeps one man. K switches to the defender nearest the ball
//   and makes that player his new defensive home. Each time his team goes back on defense, control returns to the
//   home defender, so YOU and YOUR MAN stay the same players all game.

const tB = new THREE.Vector3();
const mates: number[] = [];

const ASSIST_IDLE = 0.35; // s of idle stick before the AI guards for the user
const STICK_ON = 0.2; // stick magnitude that counts as "the human is steering"
const SWITCH_CD = 1.5;
const AUTO_SWITCH = false; // jump to the on-ball defender on every catch (off: the user keeps his man)
const PRESS_LAG_MAX = 0.1; // never back-date a press by more than this (a press buffered behind a move)

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

/** The defender on the new ball handler (the one the AI has marking him), else the nearest one. */
function defenderOnBall(ctx: Ctx, holder: number): number {
  const team = ctx.userTeam;
  if (team === -1) return -1;
  let best = -1;
  let bd = 1e9;
  for (let s = team * 5; s < team * 5 + 5; s++) {
    if (!ctx.px[s].active) continue;
    const q = ctx.players[s];
    const h = ctx.players[holder];
    let d = horizDist(q.pos.x, q.pos.z, h.pos.x, h.pos.z);
    if (q.mark === holder) d -= 2.5;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

export function control(ctx: Ctx, f: InputFrame): void {
  const team = ctx.userTeam;
  if (team === -1) return;
  const st = ctx.state;
  const ball = ctx.ball;
  const fdt = clamp(ctx.time - ctx.ctlT, 0, 0.1);
  ctx.ctlT = ctx.time;
  if (f.any && (st.phase === "timeout" || st.phase === "periodBreak")) st.deadTimer = Math.min(st.deadTimer, 0.3);
  // dead ball before free throws: any button skips the walk to the line (like the pregame intro)
  if (f.any && st.phase === "dead" && ctx.restart && (ctx.restart.k === "ft" || ctx.restart.k === "ftResume")) {
    st.deadTimer = Math.min(st.deadTimer, 0.05);
    ctx.deadExtra = Math.max(ctx.deadExtra, 0.9);
  }
  // a CPU free throw: any button and he shoots now
  if (f.any && st.phase === "freeThrow" && st.freeThrow && st.freeThrow.shooter !== ctx.userSlot) ctx.ftWait = Math.max(ctx.ftWait, 0.5);
  if (ctx.userSlot < 0 || sideOf(ctx.userSlot) !== team || !ctx.px[ctx.userSlot].active) {
    ctx.userSlot = team * 5;
    ctx.events.push({ type: "userSwitch", slot: ctx.userSlot });
  }
  const offense = st.possession === team;
  const playing = st.phase === "live" || st.phase === "inbound";
  ctx.switchCd = Math.max(0, ctx.switchCd - fdt);
  if (!offense && f.switchP.pressed && playing) {
    switchToBall(ctx);
    ctx.switchCd = SWITCH_CD;
    ctx.defHome = ctx.userSlot;
  }
  // back on defense: return to the home defender (first time: keep whoever he has now)
  if (!offense && (ctx.wasOffense || ctx.defHome < 0)) {
    if (ctx.defHome < 0 || sideOf(ctx.defHome) !== team || !ctx.px[ctx.defHome].active) ctx.defHome = ctx.userSlot;
    else if (ctx.defHome !== ctx.userSlot) setUser(ctx, ctx.defHome);
  }
  ctx.wasOffense = offense;

  const stickMag = Math.hypot(f.moveWorld.x, f.moveWorld.z);
  const steering = stickMag > STICK_ON;
  ctx.stickIdleT = steering ? 0 : ctx.stickIdleT + fdt;

  // auto-switch is off by default (see header); the helper stays for a future setting
  const holder = ball.holder;
  if (AUTO_SWITCH && !offense && playing && holder >= 0 && holder !== ctx.lastHolderSeen && sideOf(holder) !== team &&
    (ball.mode === "held" || ball.mode === "dribble") && ctx.switchCd <= 0 && ctx.stickIdleT > 1.5) {
    const on = defenderOnBall(ctx, holder);
    if (on >= 0 && on !== ctx.userSlot) {
      setUser(ctx, on);
      ctx.switchCd = SWITCH_CD;
    }
  }
  ctx.lastHolderSeen = holder;

  const s = ctx.userSlot;
  const it = ctx.intents[s];
  for (let i = team * 5; i < team * 5 + 5; i++) if (i !== s) ctx.intents[i].assist = 0;
  it.move.set(f.moveWorld.x, 0, f.moveWorld.z);
  it.sprint = f.sprint;
  it.faceTarget = null;
  it.post = offense && f.post.down;
  it.intense = !offense && f.intense.down;
  it.handsUp = !offense && f.handsUp;
  it.cut = offense && f.sprint > 0.5 && ball.holder !== s;
  if (stickMag * stickMag > 0.04) it.aim.copy(f.moveWorld).setY(0);
  else it.aim.set(0, 0, 0);
  // defensive assist (see header)
  const userHas = ball.holder === s;
  if (!offense && playing && !userHas) {
    if (f.intense.down) {
      it.assist = 2;
      it.aim.copy(f.moveWorld).setY(0); // raw stick, the AI blends it with the lock-on
    } else it.assist = ctx.stickIdleT > ASSIST_IDLE ? 1 : 0;
  } else it.assist = 0;

  // shot button: exact edges from the input timestamps
  const sx = ctx.px[s].shot;
  if (f.shoot.pressed) ctx.shootPressT = ctx.time - clamp(f.shoot.held, 0, PRESS_LAG_MAX);
  if (f.shoot.released && sx.on && sx.user && !sx.decided && !sx.released) {
    sx.userRelT = ctx.shootPressT >= 0 ? ctx.shootPressT + f.shoot.held : ctx.time;
  }
  it.shootHeld = f.shoot.down;

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
        ctx.px[s].cmdAge = 0;
      } else if (f.screen.pressed) it.cmd = "callScreen";
    } else if (ball.mode === "pass" && ball.pass && ball.pass.to === s && (f.pass.pressed || f.bounce.pressed || f.lob.pressed)) {
      // one-touch: a pass pressed while the ball is on its way to me fires on the catch, to the stick direction
      it.cmd = f.lob.pressed ? "lobPass" : f.bounce.pressed ? "bouncePass" : "pass";
      it.target = -1;
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
