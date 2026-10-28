import { Face, idOf, metaOf, stateOf, type BlockBehavior, type BlockState, type GameCtx } from "../../contracts";
import { analogOutput } from "./inventory";
import { frameOutput } from "../../entities/item-frame";
import { signalFrom, strongOut } from "./power";
import { breakBlock, CONDUCTOR, DX, DY, DZ, F2H, H2F, id, lookHorizontal, notifyFront, OPP, schedule, setState, sound, sturdyTop, ticked } from "./util";

const REPEATER = id("repeater");
const REPEATER_ON = id("powered_repeater");
const COMPARATOR = id("comparator");
const COMPARATOR_ON = id("powered_comparator");
const WIRE = id("redstone_wire");
const REDSTONE_BLOCK = id("redstone_block");

const DIODE = new Uint8Array(4096);
for (const i of [REPEATER, REPEATER_ON, COMPARATOR, COMPARATOR_ON]) if (i >= 0) DIODE[i] = 1;
export const isDiode = (s: BlockState) => DIODE[idOf(s)] === 1;

// Meta bits 0-1 hold the vanilla facing: the side the input comes from. Output leaves the opposite side.
const inputDir = (s: BlockState): Face => H2F[metaOf(s) & 3];
export const outputDir = (s: BlockState): Face => OPP[inputDir(s)] as Face;
const repeaterDelay = (s: BlockState) => ((metaOf(s) >> 2) & 3) + 1;
const isSubtract = (s: BlockState) => (metaOf(s) & 4) !== 0;
const isOn = (s: BlockState) => idOf(s) === REPEATER_ON || idOf(s) === COMPARATOR_ON;

function rearInput(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): number {
  const d = inputDir(s);
  const bx = x + DX[d], by = y + DY[d], bz = z + DZ[d];
  const back = ctx.world.getBlock(bx, by, bz);
  const p = signalFrom(ctx, bx, by, bz, OPP[d] as Face);
  return idOf(back) === WIRE ? Math.max(p, metaOf(back)) : p;
}

function sideInput(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, diodesOnly: boolean): number {
  const d0 = inputDir(s);
  let best = 0;
  for (const d of [H2F[(F2H[d0] + 1) & 3], H2F[(F2H[d0] + 3) & 3]]) {
    const sx = x + DX[d], sz = z + DZ[d];
    const n = ctx.world.getBlock(sx, y, sz);
    let p = 0;
    if (diodesOnly) p = DIODE[idOf(n)] ? strongOut(ctx, sx, y, sz, OPP[d] as Face) : 0;
    else if (idOf(n) === REDSTONE_BLOCK) p = 15;
    else if (idOf(n) === WIRE) p = metaOf(n);
    else p = strongOut(ctx, sx, y, sz, OPP[d] as Face);
    if (p > best) best = p;
  }
  return best;
}

const canSurvive = (ctx: GameCtx, x: number, y: number, z: number) => sturdyTop(ctx.world.getBlock(x, y - 1, z));

function placeDiode(ctx: GameCtx, x: number, y: number, z: number, info: Parameters<NonNullable<BlockBehavior["place"]>>[4], def: BlockState) {
  if (!canSurvive(ctx, x, y, z)) return null;
  const look = lookHorizontal(ctx, info);
  return stateOf(idOf(def), F2H[OPP[look]]);
}

export const isLocked = (ctx: GameCtx, x: number, y: number, z: number, s: BlockState) => sideInput(ctx, x, y, z, s, true) > 0;

function repeaterCheck(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  if (isLocked(ctx, x, y, z, s)) return;
  if (isOn(s) !== rearInput(ctx, x, y, z, s) > 0) schedule(ctx, x, y, z, repeaterDelay(s) * 2);
}

const repeaterPower = (_c: GameCtx, _x: number, _y: number, _z: number, s: BlockState, toward: Face) =>
  idOf(s) === REPEATER_ON && toward === outputDir(s) ? 15 : 0;

export const REPEATER_BEHAVIOR: BlockBehavior = {
  place: placeDiode,
  canSurvive,
  onPlaced(ctx, x, y, z, s) {
    notifyFront(ctx, x, y, z, outputDir(s));
    if (!isOn(s) && rearInput(ctx, x, y, z, s) > 0) schedule(ctx, x, y, z, 1);
  },
  onRemoved(ctx, x, y, z, s) {
    notifyFront(ctx, x, y, z, outputDir(s));
  },
  use(ctx, x, y, z, s) {
    const m = metaOf(s);
    setState(ctx, x, y, z, stateOf(idOf(s), (m & 3) | ((((m >> 2) + 1) & 3) << 2)));
    return true;
  },
  neighborChanged(ctx, x, y, z, s) {
    if (!canSurvive(ctx, x, y, z)) return breakBlock(ctx, x, y, z);
    repeaterCheck(ctx, x, y, z, s);
  },
  scheduledTick(ctx, x, y, z, s) {
    ticked(ctx, x, y, z);
    if (isLocked(ctx, x, y, z, s)) return;
    const want = rearInput(ctx, x, y, z, s) > 0;
    const m = metaOf(s);
    if (isOn(s) && !want) {
      setState(ctx, x, y, z, stateOf(REPEATER, m));
      notifyFront(ctx, x, y, z, outputDir(s));
    } else if (!isOn(s)) {
      setState(ctx, x, y, z, stateOf(REPEATER_ON, m));
      notifyFront(ctx, x, y, z, outputDir(s));
      if (!want) schedule(ctx, x, y, z, repeaterDelay(s) * 2);
    }
  },
  power: repeaterPower,
  strongPower: repeaterPower,
};

function comparatorInput(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): number {
  let p = rearInput(ctx, x, y, z, s);
  const d = inputDir(s);
  let bx = x + DX[d], by = y + DY[d], bz = z + DZ[d];
  const a = analogOutput(ctx, bx, by, bz);
  if (a >= 0) return a;
  if (p < 15 && CONDUCTOR[idOf(ctx.world.getBlock(bx, by, bz))]) {
    bx += DX[d];
    by += DY[d];
    bz += DZ[d];
    const b = Math.max(analogOutput(ctx, bx, by, bz), frameOutput(ctx, bx, by, bz, d));
    if (b >= 0) p = b;
  }
  return p;
}

function comparatorSignal(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): number {
  const rear = comparatorInput(ctx, x, y, z, s);
  if (rear === 0) return 0;
  const side = sideInput(ctx, x, y, z, s, false);
  return side > rear ? 0 : isSubtract(s) ? rear - side : rear;
}

function shouldTurnOn(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): boolean {
  const rear = comparatorInput(ctx, x, y, z, s);
  if (rear === 0) return false;
  const side = sideInput(ctx, x, y, z, s, false);
  return rear > side || (rear === side && !isSubtract(s));
}

export function storedOutput(ctx: GameCtx, x: number, y: number, z: number): number {
  const v = ctx.world.getBlockEntity(x, y, z)?.data?.output;
  return typeof v === "number" ? v : 0;
}

function storeOutput(ctx: GameCtx, x: number, y: number, z: number, out: number) {
  const be = ctx.world.getBlockEntity(x, y, z);
  if (be && be.type === "comparator") {
    be.data = { ...be.data, output: out };
    ctx.world.setBlockEntity(be, x, y, z);
  } else ctx.world.setBlockEntity({ x, y, z, type: "comparator", data: { output: out } }, x, y, z);
}

function refresh(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const out = comparatorSignal(ctx, x, y, z, s);
  const old = storedOutput(ctx, x, y, z);
  storeOutput(ctx, x, y, z, out);
  if (old === out && isSubtract(s)) return;
  const on = shouldTurnOn(ctx, x, y, z, s);
  if (on !== isOn(s)) {
    setState(ctx, x, y, z, stateOf(on ? COMPARATOR_ON : COMPARATOR, metaOf(s)));
    storeOutput(ctx, x, y, z, out);
  }
  notifyFront(ctx, x, y, z, outputDir(s));
}

const comparatorPower = (ctx: GameCtx, x: number, y: number, z: number, s: BlockState, toward: Face) =>
  toward === outputDir(s) ? storedOutput(ctx, x, y, z) : 0;

export const COMPARATOR_BEHAVIOR: BlockBehavior = {
  place: placeDiode,
  canSurvive,
  onPlaced(ctx, x, y, z, s) {
    if (comparatorSignal(ctx, x, y, z, s) !== storedOutput(ctx, x, y, z) || shouldTurnOn(ctx, x, y, z, s) !== isOn(s)) schedule(ctx, x, y, z, 2);
    notifyFront(ctx, x, y, z, outputDir(s));
  },
  onRemoved(ctx, x, y, z, s) {
    const next = ctx.world.getBlock(x, y, z);
    if (!isDiode(next) || (idOf(next) !== COMPARATOR && idOf(next) !== COMPARATOR_ON)) ctx.world.setBlockEntity(null, x, y, z);
    notifyFront(ctx, x, y, z, outputDir(s));
  },
  use(ctx, x, y, z, s) {
    const sub = !isSubtract(s);
    const next = stateOf(idOf(s), (metaOf(s) & ~4) | (sub ? 4 : 0));
    sound(ctx, "block.comparator.click", x, y, z, 0.3, sub ? 0.55 : 0.5);
    setState(ctx, x, y, z, next);
    refresh(ctx, x, y, z, next);
    return true;
  },
  neighborChanged(ctx, x, y, z, s) {
    if (!canSurvive(ctx, x, y, z)) return breakBlock(ctx, x, y, z);
    if (comparatorSignal(ctx, x, y, z, s) !== storedOutput(ctx, x, y, z) || shouldTurnOn(ctx, x, y, z, s) !== isOn(s)) schedule(ctx, x, y, z, 2);
  },
  scheduledTick(ctx, x, y, z, s) {
    ticked(ctx, x, y, z);
    refresh(ctx, x, y, z, s);
  },
  power: comparatorPower,
  strongPower: comparatorPower,
};
