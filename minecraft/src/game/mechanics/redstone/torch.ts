import { Face, idOf, metaOf, stateOf, type BlockBehavior, type BlockState, type GameCtx } from "../../contracts";
import { signalFrom } from "./power";
import { breakBlock, DX, DY, DZ, F2H, H2F, id, notifyDeep, OPP, posKey, schedule, setState, sound, sturdyFace, supportsCenter, ticked } from "./util";

const LIT = id("redstone_torch");
const LIT_WALL = id("redstone_wall_torch");
const OFF = id("unlit_redstone_torch");
const OFF_WALL = id("unlit_redstone_wall_torch");

const isLit = (s: BlockState) => idOf(s) === LIT || idOf(s) === LIT_WALL;
// Meta 0 stands on the block below. Meta 1-4 hangs on a wall and points along Horizontal meta - 1.
const supportDir = (s: BlockState): Face => (metaOf(s) === 0 ? Face.Down : (OPP[H2F[(metaOf(s) - 1) & 3]] as Face));
const withLit = (s: BlockState, lit: boolean) =>
  stateOf(metaOf(s) === 0 ? (lit ? LIT : OFF) : lit ? LIT_WALL : OFF_WALL, metaOf(s));

function canSurvive(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): boolean {
  const d = supportDir(s);
  const below = ctx.world.getBlock(x + DX[d], y + DY[d], z + DZ[d]);
  return d === Face.Down ? supportsCenter(below) : sturdyFace(below, OPP[d] as Face);
}

function hasSignal(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): boolean {
  const d = supportDir(s);
  return signalFrom(ctx, x + DX[d], y + DY[d], z + DZ[d], OPP[d] as Face) > 0;
}

const toggles = new Map<string, number[]>();
function tooFrequent(ctx: GameCtx, x: number, y: number, z: number, record: boolean): boolean {
  const k = posKey(x, y, z);
  const now = ctx.time.tick;
  const list = (toggles.get(k) ?? []).filter((t) => now - t <= 60);
  if (record) list.push(now);
  if (list.length) toggles.set(k, list);
  else toggles.delete(k);
  return list.length >= 8;
}

function torchPower(_ctx: GameCtx, _x: number, _y: number, _z: number, s: BlockState, toward: Face): number {
  return isLit(s) && toward !== supportDir(s) ? 15 : 0;
}

export const TORCH_BEHAVIOR: BlockBehavior = {
  place(ctx, x, y, z, info) {
    let s: BlockState;
    if (info.face === Face.Up) s = stateOf(LIT, 0);
    else if (info.face === Face.Down) return null;
    else s = stateOf(LIT_WALL, F2H[info.face] + 1);
    if (canSurvive(ctx, x, y, z, s)) return s;
    // A wall click with no sturdy wall still allows a standing torch, like vanilla.
    s = stateOf(LIT, 0);
    return canSurvive(ctx, x, y, z, s) ? s : null;
  },
  canSurvive,
  onPlaced(ctx, x, y, z, s) {
    notifyDeep(ctx, x, y, z);
    if (isLit(s) === hasSignal(ctx, x, y, z, s)) schedule(ctx, x, y, z, 2);
  },
  onRemoved(ctx, x, y, z) {
    notifyDeep(ctx, x, y, z);
  },
  neighborChanged(ctx, x, y, z, s) {
    if (!canSurvive(ctx, x, y, z, s)) return breakBlock(ctx, x, y, z);
    if (isLit(s) === hasSignal(ctx, x, y, z, s)) schedule(ctx, x, y, z, 2);
  },
  scheduledTick(ctx, x, y, z, s) {
    ticked(ctx, x, y, z);
    const powered = hasSignal(ctx, x, y, z, s);
    if (isLit(s) && powered) {
      setState(ctx, x, y, z, withLit(s, false));
      notifyDeep(ctx, x, y, z);
      if (tooFrequent(ctx, x, y, z, true)) {
        sound(ctx, "block.redstone_torch.burnout", x, y, z, 0.5, 2.6 + (ctx.random() - ctx.random()) * 0.8);
        ctx.emit({ type: "particles", kind: "smoke", x: x + 0.5, y: y + 0.7, z: z + 0.5, count: 5 });
        schedule(ctx, x, y, z, 160);
      }
    } else if (!isLit(s) && !powered && !tooFrequent(ctx, x, y, z, false)) {
      setState(ctx, x, y, z, withLit(s, true));
      notifyDeep(ctx, x, y, z);
    }
  },
  power: torchPower,
  strongPower: (ctx, x, y, z, s, toward) => (toward === Face.Up ? torchPower(ctx, x, y, z, s, toward) : 0),
};

export const TORCH_NAMES = ["redstone_torch", "redstone_wall_torch", "unlit_redstone_torch", "unlit_redstone_wall_torch"];
