import type { CameraRig, CoachView, ScreenPoint, SimView, V3 } from "./contracts";
import { COURT, distToBasket } from "./contracts";

// v2 onboarding: builds the CoachView the HUD reads for coach prompts, the action bar, the attack arrow and the
// tutorial checks. game.ts calls fillCoachView() in pushHud() (10 Hz) and puts the result on HudSnapshot.coach.
// No allocations: scratch objects live at module level.

const SHOT_ACTIONS = new Set(["jumpShot", "layup", "dunk", "floater", "hook"]);
const sp: ScreenPoint = { x: 0, y: 0, on: false };
const sb: ScreenPoint = { x: 0, y: 0, on: false };
const w: V3 = { x: 0, y: 0, z: 0 };

export function newCoachView(): CoachView {
  return {
    attackDir: [1, -1], attackScreenX: 1, ballMode: "dead", hasBall: false, userX: 0, userZ: 0, speed: 0, sprinting: false,
    distBasket: 99, frontcourt: false, openness: 0, shotChance: 0, gathering: false, markSlot: -1, markDist: -1,
    markShooting: false, ballDist: 99, ballX: 0, ballZ: 0, bestMate: -1, screenX: 0.5, screenY: 0.5, onScreen: true,
    spotDist: -1,
  };
}

/**
 * Fill `out` from the live view. `spot` is the tutorial floor target (Game.setCoachSpot), null for none.
 * Returns a fresh shallow copy so React sees a new object (called at HUD rate only).
 */
export function fillCoachView(view: SimView, rig: CameraRig, spot: V3 | null, out: CoachView): CoachView {
  const st = view.state;
  out.attackDir[0] = st.attackDir[0];
  out.attackDir[1] = st.attackDir[1];
  out.ballMode = view.ball.mode;
  out.ballX = view.ball.pos.x;
  out.ballZ = view.ball.pos.z;
  const us = view.userSlot;
  const u = us >= 0 ? view.players[us] : null;
  if (!u) {
    out.hasBall = false;
    out.markSlot = -1;
    out.markDist = -1;
    out.spotDist = -1;
    out.bestMate = -1;
    return { ...out, attackDir: [out.attackDir[0], out.attackDir[1]] };
  }
  const dir = view.dir(u.team);
  out.hasBall = view.ball.holder === us && (view.ball.mode === "held" || view.ball.mode === "dribble");
  out.userX = u.pos.x;
  out.userZ = u.pos.z;
  out.speed = Math.hypot(u.vel.x, u.vel.z);
  // the ball handler's action stays "dribble" at any speed, so his sprint shows only in his speed
  out.sprinting = u.action === "sprint" || (out.hasBall && out.speed > 5);
  out.distBasket = distToBasket(u.pos.x, u.pos.z, dir);
  out.frontcourt = u.pos.x * dir > 0;
  out.openness = u.openness;
  out.shotChance = out.hasBall ? view.shotChance(us) : 0;
  out.gathering = u.meter.active;
  out.ballDist = Math.hypot(view.ball.pos.x - u.pos.x, view.ball.pos.z - u.pos.z);
  const m = u.mark;
  out.markSlot = m;
  if (m >= 0 && m < 10) {
    const p = view.players[m];
    out.markDist = Math.hypot(p.pos.x - u.pos.x, p.pos.z - u.pos.z);
    out.markShooting = SHOT_ACTIONS.has(p.action) && p.actionP < 0.65;
  } else {
    out.markDist = -1;
    out.markShooting = false;
  }
  out.bestMate = -1;
  if (out.hasBall) {
    let best = 0.6;
    const base = u.team * 5;
    for (let s = base; s < base + 5; s++) {
      if (s === us) continue;
      const o = view.players[s].openness;
      if (o > best) {
        best = o;
        out.bestMate = s;
      }
    }
  }
  // screen-space direction toward the attacked basket (camera angles vary, so project both points)
  w.x = u.pos.x;
  w.y = 0;
  w.z = u.pos.z;
  rig.toScreen(w, sp);
  out.screenX = sp.x;
  out.screenY = sp.y;
  out.onScreen = sp.on;
  w.x = dir * COURT.rimX;
  w.y = 0;
  w.z = 0;
  rig.toScreen(w, sb);
  const dx = sb.x - sp.x;
  out.attackScreenX = Math.max(-1, Math.min(1, dx * 4));
  out.spotDist = spot ? Math.hypot(spot.x - u.pos.x, spot.z - u.pos.z) : -1;
  return { ...out, attackDir: [out.attackDir[0], out.attackDir[1]] };
}
