import type { GameCtx, PlayerApi } from "../contracts";
import { fitsHeight, fluidAt } from "./physics";
import { EYE_SNEAK, EYE_STAND, HEIGHT_SNEAK, HEIGHT_STAND } from "./stats";
import type { PlayerState } from "./state";

export type Pose = NonNullable<PlayerApi["pose"]>;

export const HEIGHT_SWIM = 0.6;
export const EYE_SWIM = 0.4;

const HEIGHT: Record<Pose, number> = { standing: HEIGHT_STAND, crouching: HEIGHT_SNEAK, swimming: HEIGHT_SWIM, fall_flying: HEIGHT_SWIM, spin_attack: HEIGHT_SWIM, sleeping: 0.2 };
const EYE: Record<Pose, number> = { standing: EYE_STAND, crouching: EYE_SNEAK, swimming: EYE_SWIM, fall_flying: EYE_SWIM, spin_attack: EYE_SWIM, sleeping: 0.2 };

// Vanilla Player.updateSwimming.
export function updateSwimming(p: PlayerState, ctx: GameCtx): void {
  const b = p.body;
  if (p.flying || p.vehicle) p.swimming = false;
  else if (p.swimming) p.swimming = p.sprinting && b.inWater;
  else {
    const e = p.eye();
    const under = fluidAt(ctx.world, e.x, e.y - 0.11111111, e.z) === "water";
    const feet = fluidAt(ctx.world, b.pos.x, b.pos.y, b.pos.z) === "water";
    p.swimming = p.sprinting && under && feet;
  }
}

// Vanilla Player.updatePlayerPose: fall back to crouching, then to the 0.6 block pose (crawling) when the wanted pose does not fit.
export function updatePose(p: PlayerState, ctx: GameCtx, sneakKey: boolean): Pose {
  const b = p.body;
  const free = (pose: Pose) => p.gameMode === "spectator" || fitsHeight(ctx.world, b, HEIGHT[pose]);
  let want: Pose = p.sleeping ? "sleeping" : p.fallFlying ? "fall_flying" : p.swimming ? "swimming" : p.spinTicks > 0 ? "spin_attack" : sneakKey && !p.flying ? "crouching" : "standing";
  if (!p.vehicle && !free(want)) want = free("crouching") ? "crouching" : "swimming";
  p.pose = want;
  b.height = HEIGHT[want];
  p.eyeHeight += (EYE[want] - p.eyeHeight) * 0.5;
  if (want === "sleeping") p.eyeHeight = 0.2;
  return want;
}

// Crouching or crawling slows input to 30%.
export const movingSlowly = (p: PlayerState) => p.pose === "crouching" || (p.pose === "swimming" && !p.body.inWater);
