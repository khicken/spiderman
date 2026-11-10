import type { CoachView, FoulKind, HudSnapshot, TeamSide, TurnoverKind } from "./contracts";
import type { Act } from "./ui-glyphs";
import type { PromptBit } from "./tutorial-steps";

// v2 onboarding: what to tell the player right now. Pure functions of the HUD snapshot (+ CoachView when game.ts sends
// it). The HUD owns timing: one prompt at a time, a cooldown between changes, a cap per prompt per game.

export type Prompt = { id: string; parts: PromptBit[]; urgent?: boolean };

export type PromptMemo = {
  gainedAt: number; // performance.now() when the user's team last gained the ball
  lostAt: number; // ... last lost it
  side: TeamSide | -1; // possession seen at the last call
};

export function newPromptMemo(): PromptMemo {
  return { gainedAt: -1e9, lostAt: -1e9, side: -1 };
}

/** The best prompt for this moment, or null. */
export function pickPrompt(h: HudSnapshot, c: CoachView | undefined, memo: PromptMemo, now: number): Prompt | null {
  const ut = h.userTeam;
  if (ut === -1 || !h.user || h.cinematic || h.replay) return null;
  if (h.possession !== memo.side) {
    if (h.possession === ut) memo.gainedAt = now;
    else if (h.possession !== -1) memo.lostAt = now;
    memo.side = h.possession;
  }
  const userFt = h.freeThrow && h.user && h.freeThrow.name === h.user.last && h.phase === "freeThrow";
  if (userFt) return { id: "ft", parts: ["Free throw: hold ", { a: "shoot" }, ", let go at the gold notch"] };
  if (h.phase !== "live") return null;
  const offense = h.possession === ut;
  if (offense) {
    const hasBall = c ? c.hasBall : h.user.hasBall;
    if (!hasBall) return null;
    if (h.shotClockOn && h.shotClock <= 6 && h.shotClock > 0) return { id: "clock", parts: ["Shot clock! Get a shot up ", { a: "shoot" }], urgent: true };
    if (c) {
      if (c.gathering) return null;
      if (!c.frontcourt) {
        const side = c.attackScreenX > 0.15 ? "right ▶" : c.attackScreenX < -0.15 ? "◀ left" : "";
        return { id: "bring", parts: ["Bring it up: push ", { a: "move" }, side ? ` toward the ${side} basket` : " past half court"] };
      }
      if (c.distBasket < 3.6) return { id: "layup", parts: ["Hold ", { a: "shoot" }, " for a layup or dunk"] };
      if (c.openness > 0.68 && c.shotChance > 0.36 && c.distBasket < 8.2) return { id: "open", parts: ["You're open! Hold ", { a: "shoot" }] };
      if (c.bestMate >= 0) return { id: "mate", parts: ["Teammate open: ", { a: "pass" }, " to pass"] };
      if (c.distBasket < 8 && c.openness < 0.3) return { id: "move", parts: ["Covered. Flick ", { a: "dribble" }, " to shake him"] };
      return null;
    }
    if (now - memo.gainedAt < 3500) return { id: "ball", parts: ["Your ball: drive with ", { a: "move" }, ", hold ", { a: "shoot" }, " to shoot"] };
    return null;
  }
  if (h.possession === -1) return null;
  if (c) {
    if (c.ballMode === "loose") return { id: "reb", parts: [{ a: "block" }, " Go get the rebound"] };
    if (c.markShooting && c.markDist >= 0 && c.markDist < 3) return { id: "block", parts: [{ a: "block" }, " Block!"], urgent: true };
    if (c.markDist > 6) return { id: "switch", parts: ["Too far from your man. ", { a: "switch" }, " switch to the ball"] };
    if (c.markDist >= 0 && c.markDist < 2 && c.ballDist < 1.6) return { id: "steal", parts: ["On the ball: ", { a: "steal" }, " steal, ", { a: "block" }, " contest"] };
    if (now - memo.lostAt < 4500) return { id: "def", parts: ["Defense: stay between YOUR MAN and the rim · hold ", { a: "intense" }] };
    return null;
  }
  if (now - memo.lostAt < 4000) return { id: "def", parts: ["Defense: stay between YOUR MAN and the rim · ", { a: "switch" }, " switch"] };
  return null;
}

/** 2 to 4 buttons that matter right now, for the always-on action bar. */
export function actionsFor(h: HudSnapshot, c: CoachView | undefined): [Act, string][] {
  const ut = h.userTeam;
  if (ut === -1 || !h.user) return [];
  if (h.freeThrow && h.phase === "freeThrow") return h.freeThrow.name === h.user.last ? [["shoot", "Hold + release"]] : [];
  if (h.phase === "inbound" || h.phase === "dead" || h.phase === "timeout" || h.phase === "periodBreak" || h.phase === "final" || h.phase === "tipoff") return [];
  if (h.possession === ut) {
    const hasBall = c ? c.hasBall : h.user.hasBall;
    if (!hasBall) return [["move", "Move"], ["sprint", "Sprint"]];
    const near = c && c.distBasket < 3.6;
    return [["shoot", near ? "Layup / dunk" : "Shoot (hold)"], ["pass", "Pass"], ["dribble", "Dribble move"], ["sprint", "Sprint"]];
  }
  if (c && c.ballMode === "loose") return [["block", "Rebound"], ["switch", "Switch"]];
  return [["switch", "Switch"], ["steal", "Steal"], ["block", "Block / contest"], ["intense", "Intense D"]];
}

// ---------------------------------------------------------------------------------------------------------------------
// Why the whistle blew
// ---------------------------------------------------------------------------------------------------------------------
export const TOV_TITLE: Record<TurnoverKind, string> = {
  steal: "STOLEN", badPass: "BAD PASS", outOfBounds: "OUT OF BOUNDS", travel: "TRAVELING", shotClock: "SHOT CLOCK VIOLATION",
  backcourt: "BACKCOURT VIOLATION", eightSeconds: "8 SECOND VIOLATION", threeSeconds: "3 SECONDS IN THE KEY",
  offensiveFoul: "OFFENSIVE FOUL", fiveSeconds: "5 SECOND VIOLATION",
};

/** [what happened, what to do instead]. The second line shows only when the user's team made the mistake. */
export const TOV_WHY: Record<TurnoverKind, [string, string]> = {
  steal: ["The defense took it.", "Protect the ball: pass when a defender closes in."],
  badPass: ["The pass never got there.", "Pass to the man the open chevron points at."],
  outOfBounds: ["The ball carrier stepped out.", "Watch the sidelines and the baseline."],
  travel: ["Too many steps without a dribble.", "Keep moving with the dribble, or pass."],
  shotClock: ["No shot hit the rim in 24 seconds.", "Get a shot up before the shot clock turns red."],
  backcourt: ["The ball went back over half court.", "Once you cross the line, stay on your attacking side."],
  eightSeconds: ["The ball stayed in the backcourt 8 seconds.", "Bring it past half court quickly: sprint if you must."],
  threeSeconds: ["A player stood in the painted lane over 3 seconds.", "Cut through the lane, don't park in it."],
  offensiveFoul: ["The offense ran into a set defender.", "Drive around defenders, not through them."],
  fiveSeconds: ["The inbound took over 5 seconds.", "Pass it in quickly."],
};

export const FOUL_TITLE: Record<FoulKind, string> = {
  shooting: "SHOOTING FOUL", reach: "REACH-IN FOUL", blocking: "BLOCKING FOUL", charge: "CHARGE", offensive: "OFFENSIVE FOUL",
  loose: "LOOSE BALL FOUL", away: "FOUL",
};

/** [what happened, how to avoid it when the user's team fouled]. */
export const FOUL_WHY: Record<FoulKind, [string, string]> = {
  shooting: ["Contact on the shooter.", "Jump straight up with block, or just contest with your hands up."],
  reach: ["Reached in on the dribbler.", "Steal only when the dribbler is in front of you, not from behind."],
  blocking: ["The defender moved into the driver late.", "Get your feet set earlier, or slide instead of stepping in."],
  charge: ["The driver ran into a set defender.", "Drive around the defender, or pull up."],
  offensive: ["Pushing off or a moving screen.", "Drive without the off arm, hold screens still."],
  loose: ["Contact chasing a loose ball.", "Go for the ball, not the man."],
  away: ["Contact away from the ball.", "Stay with your man without grabbing."],
};
