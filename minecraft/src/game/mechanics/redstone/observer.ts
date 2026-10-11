import { idOf, metaOf, stateOf, type BlockBehavior, type BlockState, type Face, type GameCtx } from "../../contracts";
import { DX, DY, DZ, lookNearest, notifyFront, OPP, posKey, schedule, setState, ticked } from "./util";

// Meta bits 0-2: the Face the observer looks at. Bit 3: powered. Output leaves the back.
const front = (s: BlockState) => (metaOf(s) & 7) as Face;
const back = (s: BlockState) => OPP[metaOf(s) & 7] as Face;
const isOn = (s: BlockState) => (metaOf(s) & 8) !== 0;

const seen = new WeakMap<object, Map<string, BlockState>>();
function seenFor(ctx: GameCtx) {
  let m = seen.get(ctx.world);
  if (!m) seen.set(ctx.world, (m = new Map()));
  return m;
}

function remember(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const f = front(s);
  seenFor(ctx).set(posKey(x, y, z), ctx.world.getBlock(x + DX[f], y + DY[f], z + DZ[f]));
}

// A piston move counts as a change, which makes flying machines work.
export function observerMoved(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  remember(ctx, x, y, z, s);
  if (!isOn(s)) schedule(ctx, x, y, z, 2);
}

const observerPower = (_c: GameCtx, _x: number, _y: number, _z: number, s: BlockState, toward: Face) => (isOn(s) && toward === back(s) ? 15 : 0);

export const OBSERVER_BEHAVIOR: BlockBehavior = {
  place: (ctx, _x, _y, _z, info, def) => stateOf(idOf(def), lookNearest(ctx, info)),
  onPlaced(ctx, x, y, z, s) {
    remember(ctx, x, y, z, s);
  },
  onRemoved(ctx, x, y, z, s) {
    seenFor(ctx).delete(posKey(x, y, z));
    if (isOn(s)) notifyFront(ctx, x, y, z, back(s));
  },
  neighborChanged(ctx, x, y, z, s, fx, fy, fz) {
    const f = front(s);
    const ax = x + DX[f], ay = y + DY[f], az = z + DZ[f];
    if (fx !== ax || fy !== ay || fz !== az) return;
    const m = seenFor(ctx);
    const k = posKey(x, y, z);
    const now = ctx.world.getBlock(ax, ay, az);
    const was = m.get(k);
    m.set(k, now);
    if (was === undefined || was === now) return;
    if (!isOn(s)) schedule(ctx, x, y, z, 2);
  },
  scheduledTick(ctx, x, y, z, s) {
    ticked(ctx, x, y, z);
    if (isOn(s)) setState(ctx, x, y, z, stateOf(idOf(s), metaOf(s) & 7));
    else {
      setState(ctx, x, y, z, stateOf(idOf(s), metaOf(s) | 8));
      schedule(ctx, x, y, z, 2);
    }
    notifyFront(ctx, x, y, z, back(s));
  },
  power: observerPower,
  strongPower: observerPower,
};
