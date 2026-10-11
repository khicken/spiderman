import { Face, idOf, metaOf, stateOf, type BlockBehavior, type BlockState, type Entity, type GameCtx } from "../../contracts";
import { BLOCKS } from "../../blocks/registry";
import { bellPowerChanged } from "./consumers";
import { isPowered } from "./power";
import { flag, id, nameOf, notifyNeighbors, schedule, setFlag, setState, sound, ticked } from "./util";

// Partial behaviors for blocks the mechanics module owns. mergeRedstone() chains them onto its behaviors.

function woodKind(name: string) {
  if (name.startsWith("cherry")) return "cherry_wood";
  if (name.startsWith("bamboo")) return "bamboo_wood";
  if (name.startsWith("crimson") || name.startsWith("warped")) return "nether_wood";
  return "wooden";
}

function openSound(name: string, kind: "door" | "trapdoor" | "fence_gate", open: boolean): string {
  const act = open ? "open" : "close";
  if (kind === "fence_gate") {
    const w = woodKind(name);
    return `block.${w === "wooden" ? "fence_gate" : `${w}_fence_gate`}.${act}`;
  }
  if (name.startsWith("iron_")) return `block.iron_${kind}.${act}`;
  if (name.includes("copper")) return `block.copper_${kind}.${act}`;
  return `block.${woodKind(name)}_${kind}.${act}`;
}

// Door meta: bits 0-1 facing, bit 2 open, bit 3 upper half. Either half's power opens both.
const DOOR_EXTRA: BlockBehavior = {
  neighborChanged(ctx, x, y, z, s) {
    const upper = (metaOf(s) & 8) !== 0;
    const ly = upper ? y - 1 : y;
    const lower = ctx.world.getBlock(x, ly, z);
    const top = ctx.world.getBlock(x, ly + 1, z);
    if (idOf(lower) !== idOf(s) || idOf(top) !== idOf(s)) return;
    const p = isPowered(ctx, x, ly, z) || isPowered(ctx, x, ly + 1, z);
    if (p === flag(ctx, x, ly, z)) return;
    setFlag(ctx, x, ly, z, p);
    if (((metaOf(lower) & 4) !== 0) === p) return;
    const set = (m: number) => (p ? m | 4 : m & ~4);
    setState(ctx, x, ly, z, stateOf(idOf(lower), set(metaOf(lower))));
    setState(ctx, x, ly + 1, z, stateOf(idOf(top), set(metaOf(top))));
    sound(ctx, openSound(nameOf(s), "door", p), x, ly, z, 1, 0.9 + ctx.random() * 0.1);
  },
};

function openableExtra(kind: "trapdoor" | "fence_gate"): BlockBehavior {
  return {
    neighborChanged(ctx, x, y, z, s) {
      const p = isPowered(ctx, x, y, z);
      if (p === flag(ctx, x, y, z)) return;
      setFlag(ctx, x, y, z, p);
      if (((metaOf(s) & 4) !== 0) === p) return;
      setState(ctx, x, y, z, stateOf(idOf(s), p ? metaOf(s) | 4 : metaOf(s) & ~4));
      sound(ctx, openSound(nameOf(s), kind, p), x, y, z, 1, 0.9 + ctx.random() * 0.1);
    },
  };
}

// Rail meta: bits 0-2 shape (0 north-south, 1 east-west, 2-5 ascending east, west, north, south), bit 3 powered.
const shapeOf = (s: BlockState) => metaOf(s) & 7;
const railOn = (s: BlockState) => (metaOf(s) & 8) !== 0;

function sameRailPowered(ctx: GameCtx, x: number, y: number, z: number, fwd: boolean, depth: number, shape: number, railId: number): boolean {
  const s = ctx.world.getBlock(x, y, z);
  if (idOf(s) !== railId) return false;
  const sh = shapeOf(s);
  if (shape === 1 && (sh === 0 || sh === 4 || sh === 5)) return false;
  if (shape === 0 && (sh === 1 || sh === 2 || sh === 3)) return false;
  if (!railOn(s)) return false;
  return isPowered(ctx, x, y, z) || findRailSignal(ctx, x, y, z, s, fwd, depth + 1, railId);
}

function findRailSignal(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, fwd: boolean, depth: number, railId: number): boolean {
  if (depth >= 8) return false;
  let shape = shapeOf(s);
  let down = true;
  switch (shape) {
    case 0: z += fwd ? 1 : -1; break;
    case 1: x += fwd ? -1 : 1; break;
    case 2: if (fwd) x--; else { x++; y++; down = false; } shape = 1; break;
    case 3: if (fwd) { x--; y++; down = false; } else x++; shape = 1; break;
    case 4: if (fwd) z++; else { z--; y++; down = false; } shape = 0; break;
    case 5: if (fwd) { z++; y++; down = false; } else z--; shape = 0; break;
  }
  return sameRailPowered(ctx, x, y, z, fwd, depth, shape, railId) || (down && sameRailPowered(ctx, x, y - 1, z, fwd, depth, shape, railId));
}

const poweredRailExtra: BlockBehavior = {
  neighborChanged(ctx, x, y, z, s) {
    const i = idOf(s);
    const p = isPowered(ctx, x, y, z) || findRailSignal(ctx, x, y, z, s, true, 0, i) || findRailSignal(ctx, x, y, z, s, false, 0, i);
    if (p === railOn(s)) return;
    setState(ctx, x, y, z, stateOf(i, (metaOf(s) & 7) | (p ? 8 : 0)));
    notifyNeighbors(ctx, x, y - 1, z);
    if (shapeOf(s) >= 2) notifyNeighbors(ctx, x, y + 1, z);
  },
};

const DETECTOR_RAIL = id("detector_rail");
const MINECARTS = new Set(["minecart", "chest_minecart", "hopper_minecart", "tnt_minecart", "furnace_minecart", "command_block_minecart", "spawner_minecart"]);
const scratch: Entity[] = [];

function cartOn(ctx: GameCtx, x: number, y: number, z: number): boolean {
  for (const e of ctx.entities.near(x + 0.5, y + 0.5, z + 0.5, 1, scratch)) {
    const p = e.body.pos;
    if (MINECARTS.has(e.type) && !e.dead && p.x > x + 0.2 && p.x < x + 0.8 && p.z > z + 0.2 && p.z < z + 0.8 && p.y >= y - 0.2 && p.y < y + 0.8) return true;
  }
  return false;
}

function detectorCheck(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const p = cartOn(ctx, x, y, z);
  if (p !== railOn(s)) {
    setState(ctx, x, y, z, stateOf(DETECTOR_RAIL, (metaOf(s) & 7) | (p ? 8 : 0)));
    notifyNeighbors(ctx, x, y - 1, z);
  }
  if (p) schedule(ctx, x, y, z, 20);
}

const detectorRailExtra: BlockBehavior = {
  entityInside(ctx, x, y, z, s, _b, e) {
    if (!railOn(s) && e && MINECARTS.has(e.type)) detectorCheck(ctx, x, y, z, s);
  },
  scheduledTick(ctx, x, y, z, s) {
    ticked(ctx, x, y, z);
    if (railOn(s)) detectorCheck(ctx, x, y, z, s);
  },
  power: (_c, _x, _y, _z, s) => (railOn(s) ? 15 : 0),
  strongPower: (_c, _x, _y, _z, s, toward) => (railOn(s) && toward === Face.Down ? 15 : 0),
};

export const REDSTONE_EXTRAS: Record<string, BlockBehavior> = {};
for (const b of BLOCKS) {
  if (b.shape === "door") REDSTONE_EXTRAS[b.name] = DOOR_EXTRA;
  else if (b.shape === "trapdoor") REDSTONE_EXTRAS[b.name] = openableExtra("trapdoor");
  else if (b.shape === "fence_gate") REDSTONE_EXTRAS[b.name] = openableExtra("fence_gate");
}
for (const n of ["powered_rail", "activator_rail"]) if (id(n) >= 0) REDSTONE_EXTRAS[n] = poweredRailExtra;
if (DETECTOR_RAIL >= 0) REDSTONE_EXTRAS.detector_rail = detectorRailExtra;
if (id("bell") >= 0) REDSTONE_EXTRAS.bell = { neighborChanged: (ctx, x, y, z) => bellPowerChanged(ctx, x, y, z) };

type Hook = keyof BlockBehavior;
const NUMERIC: Hook[] = ["power", "strongPower", "comparatorOutput"];

export function mergeRedstone(base: Record<string, BlockBehavior>, extras: Record<string, BlockBehavior> = REDSTONE_EXTRAS): Record<string, BlockBehavior> {
  const out: Record<string, BlockBehavior> = { ...base };
  for (const [name, extra] of Object.entries(extras)) {
    const b = base[name];
    if (!b) {
      out[name] = extra;
      continue;
    }
    const merged: Record<string, unknown> = { ...b };
    for (const k of Object.keys(extra) as Hook[]) {
      const e = extra[k] as ((...a: unknown[]) => unknown) | undefined;
      const o = b[k] as ((...a: unknown[]) => unknown) | undefined;
      if (!e) continue;
      if (!o) merged[k] = e;
      else if (NUMERIC.includes(k)) merged[k] = (...a: unknown[]) => Math.max(Number(o(...a)) || 0, Number(e(...a)) || 0);
      else if (k === "neighborChanged" || k === "scheduledTick" || k === "entityInside" || k === "onPlaced" || k === "onRemoved" || k === "randomTick")
        merged[k] = (...a: unknown[]) => {
          o(...a);
          const [ctx, x, y, z, s] = a as [GameCtx, number, number, number, BlockState];
          const cur = ctx.world.getBlock(x, y, z);
          if (idOf(cur) !== idOf(s)) return;
          a[4] = cur;
          e(...a);
        };
    }
    out[name] = merged as BlockBehavior;
  }
  return out;
}
