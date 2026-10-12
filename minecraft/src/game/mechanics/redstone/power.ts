import { AIR, idOf, type Face, type GameCtx } from "../../contracts";
import { CONDUCTOR, DX, DY, DZ, nameOf, OPP } from "./util";

// "toward" is always the direction from the source block to the block that receives the power.

let wireSignals = true;
export const wiresSignal = () => wireSignals;
export function setWireSignals(on: boolean) {
  wireSignals = on;
}

export function weakOut(ctx: GameCtx, x: number, y: number, z: number, toward: Face): number {
  const s = ctx.world.getBlock(x, y, z);
  if (s === AIR) return 0;
  const b = ctx.behaviors[nameOf(s)];
  return b?.power ? b.power(ctx, x, y, z, s, toward) : 0;
}

export function strongOut(ctx: GameCtx, x: number, y: number, z: number, toward: Face): number {
  const s = ctx.world.getBlock(x, y, z);
  if (s === AIR) return 0;
  const b = ctx.behaviors[nameOf(s)];
  return b?.strongPower ? b.strongPower(ctx, x, y, z, s, toward) : 0;
}

export function strongPowerTo(ctx: GameCtx, x: number, y: number, z: number): number {
  let best = 0;
  for (let f = 0; f < 6; f++) {
    const p = strongOut(ctx, x + DX[f], y + DY[f], z + DZ[f], OPP[f] as Face);
    if (p > best && (best = p) >= 15) return 15;
  }
  return best;
}

export function signalFrom(ctx: GameCtx, x: number, y: number, z: number, toward: Face): number {
  const s = ctx.world.getBlock(x, y, z);
  if (s === AIR) return 0;
  const own = weakOut(ctx, x, y, z, toward);
  if (CONDUCTOR[idOf(s)] && own < 15) return Math.max(own, strongPowerTo(ctx, x, y, z));
  return own;
}

export const signalInto = (ctx: GameCtx, x: number, y: number, z: number, f: Face) =>
  signalFrom(ctx, x + DX[f], y + DY[f], z + DZ[f], OPP[f] as Face);

export function receivedPower(ctx: GameCtx, x: number, y: number, z: number, except = -1): number {
  let best = 0;
  for (let f = 0; f < 6; f++) {
    if (f === except) continue;
    const p = signalInto(ctx, x, y, z, f as Face);
    if (p > best && (best = p) >= 15) return 15;
  }
  return best;
}

export function isPowered(ctx: GameCtx, x: number, y: number, z: number, except = -1): boolean {
  for (let f = 0; f < 6; f++) if (f !== except && signalInto(ctx, x, y, z, f as Face) > 0) return true;
  return false;
}
