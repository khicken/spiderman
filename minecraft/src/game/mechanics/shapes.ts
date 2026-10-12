import type { Aabb, BlockState, WorldApi } from "../contracts";
import { AIR, idOf, metaOf } from "../contracts";
import { BLOCKS, blockDef, OPAQUE, SOLID } from "../blocks/registry";
import { HX, HZ } from "./util";
import { chestPartnerH } from "./chest";

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Aabb => ({
  minX: x0 / 16, minY: y0 / 16, minZ: z0 / 16, maxX: x1 / 16, maxY: y1 / 16, maxZ: z1 / 16,
});

// Rotates a box defined for facing south (h 0) to Horizontal h, clockwise seen from above.
function rotH(b: Aabb, h: number): Aabb {
  let r = { ...b };
  for (let i = 0; i < (h & 3); i++) {
    r = { minX: 1 - r.maxZ, maxX: 1 - r.minZ, minZ: r.minX, maxZ: r.maxX, minY: r.minY, maxY: r.maxY };
  }
  return r;
}
const rot4 = (bs: Aabb[]): Aabb[][] => [0, 1, 2, 3].map((h) => bs.map((b) => rotH(b, h)));

function faceBoxes(up: Aabb[], down: Aabb[], south: Aabb[]): Aabb[][] {
  const r = rot4(south);
  return [r[3], r[1], up, down, r[0], r[2]];
}

const NONE: Aabb[] = [];
const FULL: Aabb[] = [box(0, 0, 0, 16, 16, 16)];
const SLAB = [[box(0, 0, 0, 16, 8, 16)], [box(0, 8, 0, 16, 16, 16)], FULL];
const CARPET = [box(0, 0, 0, 16, 1, 16)];
const FARMLAND = [box(0, 0, 0, 16, 15, 16)];
const CACTUS_COL = [box(1, 0, 1, 15, 15, 15)];
const CACTUS_OUT = [box(1, 0, 1, 15, 16, 15)];
const BED = [box(0, 0, 0, 16, 9, 16)];
const CHEST = [box(1, 0, 1, 15, 14, 15)];
const ENCHANT = [box(0, 0, 0, 16, 12, 16)];
const CAMPFIRE = [box(0, 0, 0, 16, 7, 16)];
const FLOWER_POT = [box(5, 0, 5, 11, 6, 11)];
const STANDING_TORCH = [box(6, 0, 6, 10, 10, 10)];
const WALL_TORCH = rot4([box(5.5, 3, 0, 10.5, 13, 5)]);
const LANTERN = [[box(5, 0, 5, 11, 7, 11), box(6, 7, 6, 10, 9, 10)], [box(5, 1, 5, 11, 8, 11), box(6, 8, 6, 10, 10, 10)]];
const CHAIN = [[box(6.5, 0, 6.5, 9.5, 16, 9.5)], [box(0, 6.5, 6.5, 16, 9.5, 9.5)], [box(6.5, 6.5, 0, 9.5, 9.5, 16)]];
const ANVIL_X = [box(2, 0, 2, 14, 4, 14), box(3, 4, 4, 13, 5, 12), box(4, 5, 6, 12, 10, 10), box(0, 10, 3, 16, 16, 13)];
const ANVIL_Z = [box(2, 0, 2, 14, 4, 14), box(4, 4, 3, 12, 5, 13), box(6, 5, 4, 10, 10, 12), box(3, 10, 0, 13, 16, 16)];
const CAULDRON = [box(0, 0, 0, 16, 4, 16), box(0, 4, 0, 2, 16, 16), box(14, 4, 0, 16, 16, 16), box(2, 4, 0, 14, 16, 2), box(2, 4, 14, 14, 16, 16)];
const COMPOSTER = [box(0, 0, 0, 16, 2, 16), box(0, 2, 0, 2, 16, 16), box(14, 2, 0, 16, 16, 16), box(2, 2, 0, 14, 16, 2), box(2, 2, 14, 14, 16, 16)];
const HOPPER_TOP = [box(0, 10, 0, 16, 11, 16), box(0, 11, 0, 2, 16, 16), box(14, 11, 0, 16, 16, 16), box(2, 11, 0, 14, 16, 2), box(2, 11, 14, 14, 16, 16), box(4, 4, 4, 12, 10, 12)];
const HOPPER_SPOUT = [box(12, 4, 6, 16, 8, 10), box(0, 4, 6, 4, 8, 10), box(6, 0, 6, 10, 4, 10), box(6, 0, 6, 10, 4, 10), box(6, 4, 12, 10, 8, 16), box(6, 4, 0, 10, 8, 4)];
const HOPPER = HOPPER_SPOUT.map((s) => [...HOPPER_TOP, s]);
const LECTERN = [box(0, 0, 0, 16, 2, 16), box(4, 2, 4, 12, 14, 12), box(0, 12, 0, 16, 15, 16)];
const FRAME = [box(0, 0, 0, 16, 13, 16)];
const FRAME_EYE = [box(0, 0, 0, 16, 13, 16), box(4, 13, 4, 12, 16, 12)];
const PORTAL = [[box(0, 0, 6, 16, 16, 10)], [box(6, 0, 0, 10, 16, 16)]];
const END_PORTAL = [box(0, 6, 0, 16, 12, 16)];
const RAIL_FLAT = [box(0, 0, 0, 16, 2, 16)];
const RAIL_ASC = [box(0, 0, 0, 16, 8, 16)];
const REDSTONE = [box(0, 0, 0, 16, 1, 16)];
const DIODE = [box(0, 0, 0, 16, 2, 16)];
const PLATE = [[box(1, 0, 1, 15, 1, 15)], [box(1, 0, 1, 15, 0.5, 15)]];
const STANDING_SIGN = [box(4, 0, 4, 12, 16, 12)];
const WALL_SIGN = rot4([box(0, 4.5, 0, 16, 12.5, 2)]);
const HANGING_SIGN = [box(1, 0, 7, 15, 10, 9)];
const WALL_HANGING_SIGN = rot4([box(0, 14, 6, 16, 16, 10), box(1, 0, 7, 15, 10, 9)]);
const LADDER = rot4([box(0, 0, 0, 16, 16, 3)]);
const DOOR = rot4([box(0, 0, 0, 16, 16, 3)]);
const TRAP_BOTTOM = [box(0, 0, 0, 16, 3, 16)];
const TRAP_TOP = [box(0, 13, 0, 16, 16, 16)];
// Redstone meta 6 and 7 are floor and ceiling turned along x.
const BUTTON = [0, 1].map((p) => [
  ...faceBoxes([box(5, 0, 6, 11, 2 - p, 10)], [box(5, 14 + p, 6, 11, 16, 10)], [box(5, 6, 0, 11, 10, 2 - p)]),
  [box(6, 0, 5, 10, 2 - p, 11)], [box(6, 14 + p, 5, 10, 16, 11)],
]);
const LEVER = [...faceBoxes([box(5, 0, 4, 11, 6, 12)], [box(5, 10, 4, 11, 16, 12)], [box(5, 4, 0, 11, 12, 6)]), [box(4, 0, 5, 12, 6, 11)], [box(4, 10, 5, 12, 16, 11)]];
const SKULL = [box(4, 0, 4, 12, 8, 12)];
const WALL_SKULL = rot4([box(4, 4, 0, 12, 12, 8)]);
const BANNER = [box(4, 0, 4, 12, 16, 12)];
const WALL_BANNER = rot4([box(0, 0, 0, 16, 12.5, 2)]);
const SMALL_FLOWER = [box(5, 0, 5, 11, 10, 11)];
const PLANT = [box(2, 0, 2, 14, 13, 14)];
const SAPLING = [box(2, 0, 2, 14, 12, 14)];
const MUSHROOM = [box(5, 0, 5, 11, 6, 11)];
const BAMBOO = [box(6.5, 0, 6.5, 9.5, 16, 9.5)];
const SOUL_SAND = [box(0, 0, 0, 16, 14, 16)];
const HONEY = [box(1, 0, 1, 15, 15, 15)];
const STONECUTTER = [box(0, 0, 0, 16, 9, 16)];
const DAYLIGHT = [box(0, 0, 0, 16, 6, 16)];
const SCULK_SENSOR = [box(0, 0, 0, 16, 8, 16)];
const BREWING = [box(1, 0, 1, 15, 2, 15), box(7, 0, 7, 9, 14, 9)];
const CONDUIT = [box(5, 5, 5, 11, 11, 11)];
const TURTLE_EGG = [box(3, 0, 3, 12, 7, 12)];
const DRAGON_EGG = [box(1, 0, 1, 15, 16, 15)];
const DECORATED_POT = [box(1, 0, 1, 15, 16, 15)];
const VINE_FACE = [box(0, 0, 15, 16, 16, 16), box(0, 0, 0, 1, 16, 16), box(0, 0, 0, 16, 16, 1), box(15, 0, 0, 16, 16, 16)];
const VINE_UP = box(0, 15, 0, 16, 16, 16);
const CAKE = [0, 1, 2, 3, 4, 5, 6].map((b) => [box(1 + b * 2, 0, 1, 15, 8, 15)]);
const CANDLE_CAKE = [box(1, 0, 1, 15, 8, 15), box(7, 8, 7, 9, 14, 9)];
const SNOW = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((l) => (l === 0 ? NONE : [box(0, 0, 0, 16, l * 2, 16)]));
const CROP_AGE = [0, 1, 2, 3, 4, 5, 6, 7].map((a) => [box(0, 0, 0, 16, (a + 1) * 2, 16)]);
const BEET_AGE = [0, 1, 2, 3].map((a) => [box(0, 0, 0, 16, (a + 1) * 2, 16)]);
const WART_AGE = [5, 8, 11, 14].map((h) => [box(0, 0, 0, 16, h, 16)]);
const COCOA = [0, 1, 2].map((a) => rot4([box(8 - (2 + a), 12 - (5 + 2 * a), 15 - (4 + 2 * a), 8 + (2 + a), 12, 15)]));
const GRINDSTONE = [box(2, 0, 2, 14, 16, 14)];
const CANDLES = [
  [[7, 7, 6]], [[5, 7, 6], [9, 6, 5]], [[7, 8, 6], [5, 5, 5], [9, 5, 3]], [[5, 5, 6], [9, 5, 5], [5, 9, 5], [9, 9, 3]],
].map((l) => l.map(([x, z, h]) => box(x, 0, z, x + 2, h, z + 2)));
const PICKLES = [
  [[6, 6, 6]], [[3, 3, 6], [9, 8, 4]], [[6, 10, 6], [2, 2, 4], [10, 4, 6]], [[2, 2, 6], [10, 2, 4], [2, 10, 4], [10, 10, 6]],
].map((l) => l.map(([x, z, h]) => box(x, 0, z, x + 4, h, z + 4)));
const TURTLE_EGGS = [TURTLE_EGG, [box(1, 0, 1, 15, 7, 15)]];
const HOOK = rot4([box(5, 0, 0, 11, 10, 6)]);
const PISTON_HEAD = faceBoxes(
  [box(0, 12, 0, 16, 16, 16), box(6, 0, 6, 10, 12, 10)],
  [box(0, 0, 0, 16, 4, 16), box(6, 4, 6, 10, 16, 10)],
  [box(0, 0, 12, 16, 16, 16), box(6, 6, 0, 10, 10, 12)],
);
const BELL = [box(4, 0, 4, 12, 16, 12)];

// Stairs from quadrant masks: bit 0 x-low z-low, 1 x-high z-low, 2 x-low z-high, 3 x-high z-high.
const HALF_MASK = [0b1100, 0b0101, 0b0011, 0b1010];
const STAIRS: Aabb[][][] = [0, 1].map((top) => {
  const out: Aabb[][] = [];
  for (let mask = 0; mask < 16; mask++) {
    const y0 = top ? 0 : 8;
    const list: Aabb[] = [top ? box(0, 8, 0, 16, 16, 16) : box(0, 0, 0, 16, 8, 16)];
    let rest = mask;
    for (const [m, b] of [
      [0b0011, box(0, y0, 0, 16, y0 + 8, 8)],
      [0b1100, box(0, y0, 8, 16, y0 + 8, 16)],
      [0b0101, box(0, y0, 0, 8, y0 + 8, 16)],
      [0b1010, box(8, y0, 0, 16, y0 + 8, 16)],
    ] as [number, Aabb][]) {
      if ((rest & m) === m) {
        list.push(b);
        rest &= ~m;
      }
    }
    for (let q = 0; q < 4; q++) {
      if (!(rest & (1 << q))) continue;
      const x = (q & 1) * 8;
      const z = (q >> 1) * 8;
      list.push(box(x, y0, z, x + 8, y0 + 8, z + 8));
    }
    out.push(list);
  }
  return out;
});

// Connection masks: bit h for Horizontal h (1 south, 2 west, 4 north, 8 east).
function crossShapes(post: number, arm: number, height: number, armHeight: number, alwaysPost: boolean): Aabb[][] {
  const p0 = 8 - post, p1 = 8 + post, a0 = 8 - arm, a1 = 8 + arm;
  const arms = [box(a0, 0, 8, a1, armHeight, 16), box(0, 0, a0, 8, armHeight, a1), box(a0, 0, 0, a1, armHeight, 8), box(8, 0, a0, 16, armHeight, a1)];
  const out: Aabb[][] = [];
  for (let m = 0; m < 16; m++) {
    const l: Aabb[] = [];
    if (alwaysPost || m === 0) l.push(box(p0, 0, p0, p1, height, p1));
    for (let h = 0; h < 4; h++) if (m & (1 << h)) l.push(arms[h]);
    out.push(l);
  }
  return out;
}
const FENCE_OUT = crossShapes(2, 2, 16, 16, true);
const FENCE_COL = crossShapes(2, 2, 24, 24, true);
const PANE = crossShapes(1, 1, 16, 16, false);
const WALL_OUT = crossShapes(4, 3, 16, 14, true);
const WALL_OUT_NOPOST = crossShapes(4, 3, 16, 14, false);
const WALL_COL = crossShapes(4, 3, 24, 24, true);
const GATE_CLOSED_OUT = [[box(0, 0, 6, 16, 16, 10)], [box(6, 0, 0, 10, 16, 16)]];
const GATE_CLOSED_COL = [[box(0, 0, 6, 16, 24, 10)], [box(6, 0, 0, 10, 24, 16)]];

const name = (s: BlockState) => blockDef(s).name;

function connectsSolid(s: BlockState): boolean {
  const d = blockDef(s);
  return OPAQUE[d.id] === 1 && SOLID[d.id] === 1 && d.shape === "cube" && !d.name.endsWith("leaves") && d.name !== "barrier";
}

function gateFacesAlong(s: BlockState, h: number): boolean {
  return blockDef(s).shape === "fence_gate" && ((metaOf(s) & 3) & 1) !== (h & 1);
}

function connections(world: WorldApi, x: number, y: number, z: number, s: BlockState): number {
  const shape = blockDef(s).shape;
  const isNetherFence = name(s) === "nether_brick_fence";
  let m = 0;
  for (let h = 0; h < 4; h++) {
    const n = world.getBlock(x + HX[h], y, z + HZ[h]);
    const nd = blockDef(n);
    let c = connectsSolid(n);
    if (shape === "fence") c ||= (nd.shape === "fence" && (nd.name === "nether_brick_fence") === isNetherFence) || gateFacesAlong(n, h);
    else if (shape === "pane") c ||= nd.shape === "pane" || nd.shape === "wall";
    else if (shape === "wall") c ||= nd.shape === "wall" || nd.shape === "pane" || gateFacesAlong(n, h);
    if (c) m |= 1 << h;
  }
  return m;
}

function stairMask(s: BlockState, world: WorldApi | null, x: number, y: number, z: number): number {
  const m = metaOf(s);
  const f = m & 3;
  const half = m & 4;
  const base = HALF_MASK[f];
  if (!world) return base;
  const isStair = (t: BlockState) => blockDef(t).shape === "stairs" && (metaOf(t) & 4) === half;
  const canTake = (h: number) => {
    const o = world.getBlock(x + HX[h], y, z + HZ[h]);
    return !isStair(o) || (metaOf(o) & 3) !== f;
  };
  const front = world.getBlock(x + HX[f], y, z + HZ[f]);
  if (isStair(front)) {
    const d1 = metaOf(front) & 3;
    if ((d1 & 1) !== (f & 1) && canTake((d1 + 2) & 3)) return base & HALF_MASK[d1];
  }
  const b = (f + 2) & 3;
  const back = world.getBlock(x + HX[b], y, z + HZ[b]);
  if (isStair(back)) {
    const d2 = metaOf(back) & 3;
    if ((d2 & 1) !== (f & 1) && canTake(d2)) return base | HALF_MASK[d2];
  }
  return base;
}

// Upper door halves keep the hinge (bit 0); facing and open come from the lower half.
function doorIndex(s: BlockState, world: WorldApi | null, x: number, y: number, z: number): number {
  const m = metaOf(s);
  let lower = m, upper = m;
  if (m & 8) {
    const b = world ? world.getBlock(x, y - 1, z) : AIR;
    lower = idOf(b) === idOf(s) ? metaOf(b) : 0;
  } else {
    const t = world ? world.getBlock(x, y + 1, z) : AIR;
    upper = idOf(t) === idOf(s) ? metaOf(t) : 8;
  }
  return ((lower & 3) + (lower & 4 ? (upper & 1 ? 3 : 1) : 0)) & 3;
}

function chestBoxes(s: BlockState, world: WorldApi | null, x: number, y: number, z: number): Aabb[] {
  if (!world || name(s) === "ender_chest") return CHEST;
  const h = chestPartnerH(world, x, y, z, s);
  if (h >= 0) {
    const b = { ...CHEST[0] };
    if (h === 0) b.maxZ = 1;
    else if (h === 1) b.minX = 0;
    else if (h === 2) b.minZ = 0;
    else b.maxX = 1;
    return [b];
  }
  return CHEST;
}

function vineBoxes(s: BlockState, world: WorldApi | null, x: number, y: number, z: number): Aabb[] {
  const m = metaOf(s);
  const l: Aabb[] = [];
  for (let i = 0; i < 4; i++) if (m & (1 << i)) l.push(VINE_FACE[i]);
  if (world && SOLID[idOf(world.getBlock(x, y + 1, z))]) l.push(VINE_UP);
  return l.length ? l : [VINE_FACE[0]];
}

function crossBoxes(s: BlockState): Aabb[] {
  const d = blockDef(s);
  const n = d.name;
  if (d.tags?.includes("small_flowers")) return SMALL_FLOWER;
  if (d.tags?.includes("saplings") || d.tags?.includes("fungi")) return SAPLING;
  if (d.tags?.includes("mushrooms")) return MUSHROOM;
  if (n === "bamboo") return BAMBOO;
  if (n === "fire" || n === "soul_fire" || n === "cobweb") return NONE;
  if (n.endsWith("_stem") && (n.startsWith("melon") || n.startsWith("pumpkin") || n.startsWith("attached"))) return [box(6, 0, 6, 10, 2 + metaOf(s) * 2, 10)];
  if (n === "torchflower_crop") return [box(5, 0, 5, 11, 6 + metaOf(s) * 4, 11)];
  return PLANT;
}

// Collision boxes for solid blocks, outline boxes for the rest. Fences and walls collide 1.5 high.
export function shapeBoxes(s: BlockState, world: WorldApi | null, x: number, y: number, z: number): Aabb[] {
  return boxesFor(s, world, x, y, z, true);
}

export function outlineBoxes(s: BlockState, world: WorldApi | null, x: number, y: number, z: number): Aabb[] {
  return boxesFor(s, world, x, y, z, false);
}

export function defaultBoxes(s: BlockState): Aabb[] {
  return boxesFor(s, null, 0, 0, 0, true);
}

function boxesFor(s: BlockState, world: WorldApi | null, x: number, y: number, z: number, collision: boolean): Aabb[] {
  if (s === AIR) return NONE;
  const d = blockDef(s);
  const m = metaOf(s);
  const col = collision && d.solid;
  switch (d.shape) {
    case "air":
    case "fluid":
      return NONE;
    case "cube":
      if (d.name === "soul_sand" || d.name === "mud") return col ? SOUL_SAND : FULL;
      if (d.name === "honey_block") return col ? HONEY : FULL;
      if (d.name === "powder_snow") return FULL;
      return FULL;
    case "slab":
      return SLAB[m > 2 ? 0 : m];
    case "stairs":
      return STAIRS[(m >> 2) & 1][stairMask(s, world, x, y, z)];
    case "cross":
      return crossBoxes(s);
    case "crop":
      if (d.name === "beetroots") return BEET_AGE[m & 3];
      if (d.name === "nether_wart") return WART_AGE[m & 3];
      return CROP_AGE[m & 7];
    case "torch":
      return m === 0 || d.name === "torch" || d.name === "soul_torch" || d.name === "redstone_torch" || d.name === "unlit_redstone_torch"
        ? STANDING_TORCH
        : WALL_TORCH[(m - 1) & 3];
    case "door":
      return DOOR[doorIndex(s, world, x, y, z)];
    case "trapdoor":
      if (m & 4) return DOOR[m & 3];
      return m & 8 ? TRAP_TOP : TRAP_BOTTOM;
    case "fence": {
      const c = world ? connections(world, x, y, z, s) : 0;
      return col ? FENCE_COL[c] : FENCE_OUT[c];
    }
    case "pane":
      return PANE[world ? connections(world, x, y, z, s) : 0];
    case "wall": {
      const c = world ? connections(world, x, y, z, s) : 0;
      if (col) return WALL_COL[c];
      const straight = c === 5 || c === 10;
      const above = world ? world.getBlock(x, y + 1, z) : AIR;
      return straight && above === AIR ? WALL_OUT_NOPOST[c] : WALL_OUT[c];
    }
    case "fence_gate": {
      const axis = m & 1;
      if (m & 4) return col ? NONE : GATE_CLOSED_OUT[axis];
      return col ? GATE_CLOSED_COL[axis] : GATE_CLOSED_OUT[axis];
    }
    case "ladder":
      return LADDER[m & 3];
    case "carpet":
      return CARPET;
    case "snow_layer":
      return col ? SNOW[m & 7] : SNOW[(m & 7) + 1];
    case "farmland":
    case "path":
      return FARMLAND;
    case "rail":
      return (m & 7) >= 2 && (m & 7) <= 5 ? RAIL_ASC : RAIL_FLAT;
    case "redstone_wire":
      return REDSTONE;
    case "repeater":
    case "comparator":
      return DIODE;
    case "button":
      return BUTTON[(m >> 3) & 1][m & 7];
    case "lever":
      return LEVER[m & 7];
    case "pressure_plate":
      return PLATE[m > 0 ? 1 : 0];
    case "bed":
      return BED;
    case "chest":
      return chestBoxes(s, world, x, y, z);
    case "cactus":
      return col ? CACTUS_COL : CACTUS_OUT;
    case "cake":
      return d.name === "cake" ? CAKE[Math.min(m, 6)] : CANDLE_CAKE;
    case "sign":
      return d.name.includes("wall") ? WALL_SIGN[m & 3] : STANDING_SIGN;
    case "lantern":
      return LANTERN[m & 1];
    case "chain":
      return CHAIN[m > 2 ? 0 : m];
    case "anvil":
      return m & 1 ? ANVIL_X : ANVIL_Z;
    case "enchanting_table":
      return ENCHANT;
    case "cauldron":
      return d.name === "composter" ? COMPOSTER : CAULDRON;
    case "hopper":
      return HOPPER[m > 5 ? 3 : m];
    case "flower_pot":
      return FLOWER_POT;
    case "vine":
      return vineBoxes(s, world, x, y, z);
    case "portal":
      return PORTAL[m === 2 ? 1 : 0];
    case "end_portal_frame":
      return m & 4 ? FRAME_EYE : FRAME;
    case "lectern":
      return LECTERN;
    case "campfire":
      return CAMPFIRE;
    case "custom":
      return customBoxes(s, collision);
    default:
      return FULL;
  }
}

function customBoxes(s: BlockState, collision: boolean): Aabb[] {
  const d = blockDef(s);
  const n = d.name;
  const m = metaOf(s);
  if (n.endsWith("_wall_hanging_sign")) return WALL_HANGING_SIGN[m & 3];
  if (n.endsWith("_hanging_sign")) return HANGING_SIGN;
  if (n.endsWith("_wall_banner")) return WALL_BANNER[m & 3];
  if (n.endsWith("_banner")) return BANNER;
  if (n.includes("_wall_skull") || n.includes("_wall_head")) return WALL_SKULL[m & 3];
  if (d.tags?.includes("skulls")) return SKULL;
  if (d.tags?.includes("candles")) return CANDLES[m & 3];
  if (n === "end_portal" || n === "end_gateway") return n === "end_portal" ? END_PORTAL : FULL;
  if (n === "cocoa") return COCOA[Math.min(2, m >> 2)][m & 3];
  if (n === "stonecutter") return STONECUTTER;
  if (n === "daylight_detector" || n === "inverted_daylight_detector") return DAYLIGHT;
  if (n === "sculk_sensor" || n === "calibrated_sculk_sensor") return SCULK_SENSOR;
  if (n === "brewing_stand") return BREWING;
  if (n === "conduit") return CONDUIT;
  if (n === "turtle_egg") return TURTLE_EGGS[(m & 3) ? 1 : 0];
  if (n === "sniffer_egg") return [box(1, 0, 2, 15, 16, 14)];
  if (n === "dragon_egg") return DRAGON_EGG;
  if (n === "decorated_pot") return DECORATED_POT;
  if (n === "sea_pickle") return PICKLES[m & 3];
  if (n === "grindstone") return GRINDSTONE;
  if (n === "bell") return BELL;
  if (n === "big_dripleaf") return [box(0, 11, 0, 16, 15, 16)];
  if (n === "tripwire") return [box(0, 1, 0, 16, 2.5, 16)];
  if (n === "tripwire_hook") return HOOK[m & 3];
  if (n === "piston_head" || n === "sticky_piston_head") return PISTON_HEAD[m > 5 ? 2 : m];
  if (n === "heavy_core") return [box(4, 0, 4, 12, 8, 12)];
  if (n === "moving_piston") return collision ? FULL : NONE;
  if (n === "sculk_shrieker") return [box(0, 0, 0, 16, 8, 16)];
  return collision && !d.solid ? PLANT : FULL;
}

export const isFullCube = (s: BlockState): boolean => {
  const d = blockDef(s);
  return d.shape === "cube" && d.name !== "soul_sand" && d.name !== "mud" && d.name !== "honey_block";
};

export const HAS_CUSTOM_BOXES = BLOCKS.filter((b) => b.shape !== "cube" || !isFullCube(b.id)).map((b) => b.name);
