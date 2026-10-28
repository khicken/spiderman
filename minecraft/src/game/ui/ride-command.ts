import type { Entity, GameCtx } from "../contracts";
import { dismountMob, dismountPlayer } from "../entities/riding";
import { selectTargets, targetName, type Target } from "./selector";

function vehicleOf(ctx: GameCtx, t: Target): Entity | undefined {
  const id = t === "player" ? ctx.player.vehicle : t.data.mount;
  return typeof id === "number" ? ctx.entities.get(id) : undefined;
}

const select = (ctx: GameCtx, s: string | undefined, player: string, fail: (m: string) => never): Target => selectTargets(ctx, s, player, fail, { single: true })[0];
const nameOf = targetName;

// Vanilla RideCommand.
export function rideCommand(ctx: GameCtx, a: string[], player: string, fail: (m: string) => never): string[] {
  const target = select(ctx, a[0], player, fail);
  const name = nameOf(target, player);
  if (a[1] === "dismount") {
    const v = vehicleOf(ctx, target);
    if (!v) return fail(`${name} is not riding any vehicle`);
    if (target === "player") dismountPlayer(ctx);
    else dismountMob(target);
    return [`${name} stopped riding ${nameOf(v, player)}`];
  }
  if (a[1] !== "mount") return fail("Unknown or incomplete command, see below for error");
  const vehicle = select(ctx, a[2], player, fail);
  const cur = vehicleOf(ctx, target);
  if (cur) return fail(`${name} is already riding ${nameOf(cur, player)}`);
  if (vehicle === "player") return fail("Players can't be ridden");
  for (let x: Entity | undefined = vehicle, i = 0; x && i < 64; x = vehicleOf(ctx, x), i++) if (x === target) return fail("Can't mount entity on itself or any of its passengers");
  if (vehicle.dead) return fail(`${name} couldn't start riding ${nameOf(vehicle, player)}`);
  if (target === "player") {
    if (ctx.player.gameMode === "spectator") return fail(`${name} couldn't start riding ${nameOf(vehicle, player)}`);
    ctx.player.vehicle = vehicle.id;
    ctx.player.flying = false;
    vehicle.data._ctl = undefined;
  } else target.data.mount = vehicle.id;
  return [`${name} started riding ${nameOf(vehicle, player)}`];
}
