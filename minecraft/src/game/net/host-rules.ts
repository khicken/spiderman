// Pure checks the host runs on remote players: what a block edit costs, two-part blocks, moves, dimension changes.
import type { BlockState, Dim, ItemStack } from "../contracts";
import { MAX_Y, MIN_Y, idOf, metaOf } from "../contracts";
import { BLOCKS, blockByName } from "../blocks/registry";
import { itemDef } from "../items/registry";
import { guarded } from "./inv-guard";

const HX = [0, -1, 0, 1];
const HZ = [1, 0, -1, 0];
const WATER = ["water_bucket", "cod_bucket", "salmon_bucket", "pufferfish_bucket", "tropical_fish_bucket", "axolotl_bucket", "tadpole_bucket"];

// null: free. item: one item from the ledger or the cheap budget. take: one of these from the ledger only.
// fire: flint and steel or a fire charge. portal: only while building an arrival portal. never: no client may.
export type Cost = null | { item: string } | { take: string[] } | "fire" | "portal" | "never";

// The item a block comes from, for blocks that have none of their own: wall variants, upper halves, potted plants.
export function itemFor(b: string, from = ""): string | null {
  const def = blockByName(b);
  if (!def) return null;
  if (def.item !== null) return def.item ?? def.name;
  if (b.endsWith("_upper")) return itemFor(b.slice(0, -6), from);
  let n: string | null = null;
  if (b.startsWith("potted_")) n = from === "flower_pot" ? b.slice(7).replace("azalea_bush", "azalea") : "flower_pot";
  else if (b.endsWith("candle_cake")) n = from === "cake" ? b.slice(0, -5) : "cake";
  else if (b.includes("wall_")) n = b.replace(/^unlit_/, "").replace(/(^|_)wall_/, "$1");
  else if (b === "bamboo_sapling") n = "bamboo";
  else if (b === "big_dripleaf_stem") n = "big_dripleaf";
  else if (b.endsWith("_vines_plant")) n = b.slice(0, -6);
  return n && itemDef(n) ? n : null;
}

const TILL: Record<string, string[]> = {
  grass_block: ["farmland", "dirt_path"], dirt: ["farmland", "dirt_path", "mud"], dirt_path: ["farmland", "dirt"], farmland: ["dirt"],
  coarse_dirt: ["dirt", "dirt_path", "mud"], rooted_dirt: ["dirt", "dirt_path", "mud"], podzol: ["dirt_path"], mycelium: ["dirt_path"],
};
const STAGES = ["exposed_", "weathered_", "oxidized_"];
const unlit = (n: string) => n.replace(/^lit_/, "");

function copperStage(n: string): [string, number] | null {
  if (!n.includes("copper") || n.includes("waxed") || n.includes("ore") || n.startsWith("raw_")) return null;
  for (let i = STAGES.length - 1; i >= 0; i--) if (unlit(n).startsWith(STAGES[i])) return [n.replace(STAGES[i], ""), i + 1];
  return [n === "copper_block" ? "copper" : n, 0];
}

// Block changes in place that a client makes with a tool or by hand, which yield nothing new.
export function freeSwap(a: string, b: string): boolean {
  if (b === `stripped_${a}` || TILL[a]?.includes(b)) return true;
  if ((a === "pumpkin" && b === "carved_pumpkin") || (a === "sponge" && b === "wet_sponge") || (a === "wet_sponge" && b === "sponge")) return true;
  if ((a.startsWith("potted_") && b === "flower_pot") || (a.endsWith("candle_cake") && b === "cake")) return true;
  if (a.endsWith("_concrete_powder") && b === a.slice(0, -7)) return true;
  if (b === `${a}_plant` || b === `${a}_stem`) return true;
  if (a.startsWith("lit_") === b.startsWith("lit_") && (unlit(b) === `waxed_${unlit(a)}` || unlit(a) === `waxed_${unlit(b)}`)) return true;
  const ca = copperStage(a), cb = copperStage(b);
  return !!ca && !!cb && ca[0] === cb[0] && Math.abs(ca[1] - cb[1]) === 1;
}

// A second slab, snow layer or candle in the same block, or a new lava source.
function stacked(was: BlockState, now: BlockState): Cost {
  const d = BLOCKS[idOf(now)]!;
  const m0 = metaOf(was), m1 = metaOf(now);
  const item = itemFor(d.name);
  if (d.name === "lava") return m1 === 0 && m0 !== 0 ? { take: ["lava_bucket"] } : null;
  if (!item) return null;
  const up = d.shape === "slab" ? (m1 === 2 && m0 !== 2 ? 1 : 0) : d.shape === "snow_layer" ? m1 - m0 : d.tags?.includes("candles") ? (m1 & 3) - (m0 & 3) : 0;
  if (up > 1) return "never";
  return up === 1 ? { item } : null;
}

// What a client edit from `was` to `now` costs. wet: `was` holds water, so breaking it leaves a source.
export function placeCost(was: BlockState, now: BlockState, wet = false): Cost {
  const from = BLOCKS[idOf(was)], to = BLOCKS[idOf(now)];
  if (!to) return "never";
  if (idOf(now) === 0) return null;
  if (idOf(now) === idOf(was)) return stacked(was, now);
  const a = from?.name ?? "air", b = to.name;
  if (b === "water") return wet || a === "ice" || a === "frosted_ice" ? null : { take: WATER };
  if (b === "lava") return { take: ["lava_bucket"] };
  if (b === "powder_snow") return { take: ["powder_snow_bucket"] };
  if (b === "fire" || b === "soul_fire") return "fire";
  if (b === "nether_portal") return "portal";
  const item = itemFor(b, a);
  if (!item) return "never";
  if (idOf(was) === 0 || from?.replaceable || guarded(item)) return { item };
  return freeSwap(a, b) || itemFor(a) === item ? null : { item };
}

export interface Pair {
  x: number;
  y: number;
  z: number;
  id: number;
  mask: number;
  meta: number;
  tick: number;
}

// The other half that placing this half sets right after it: door halves, bed foot and head, a tall plant's halves.
export function partnerOf(s: BlockState, x: number, y: number, z: number, tick: number): Pair | null {
  const d = BLOCKS[idOf(s)];
  if (!d) return null;
  const id = idOf(s), m = metaOf(s);
  if (d.shape === "door") return { x, y: m & 8 ? y - 1 : y + 1, z, id, mask: 8, meta: m & 8 ? 0 : 8, tick };
  if (d.shape === "bed") {
    const h = m & 3, k = m & 4 ? -1 : 1;
    return { x: x + k * HX[h], y, z: z + k * HZ[h], id, mask: 7, meta: m ^ 4, tick };
  }
  const other = d.name.endsWith("_upper") ? blockByName(d.name.slice(0, -6)) : blockByName(`${d.name}_upper`);
  return other ? { x, y: d.name.endsWith("_upper") ? y - 1 : y + 1, z, id: other.id, mask: 0, meta: 0, tick } : null;
}

export function isPartner(p: Pair | null, s: BlockState, x: number, y: number, z: number, tick: number): boolean {
  return !!p && tick - p.tick <= 2 && p.x === x && p.y === y && p.z === z && p.id === idOf(s) && (metaOf(s) & p.mask) === p.meta;
}

// Horizontal and vertical distance a remote may cover between two moves.
export function moveOk(dx: number, dy: number, dz: number, ticks: number, fast: boolean): boolean {
  const limit = Math.max((ticks + 4) * (fast ? 6 : 4), 16);
  return Math.hypot(dx, dz) <= limit && Math.abs(dy) <= limit;
}

export type Portal = "nether_portal" | "end_portal" | null;

// The portal block a player at (x, y, z) stands in, allowing for a move or two of lag.
export function portalNear(get: (x: number, y: number, z: number) => BlockState, x: number, y: number, z: number): Portal {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  for (let dy = -1; dy <= 3; dy++)
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const n = BLOCKS[idOf(get(bx + dx, by + dy, bz + dz))]?.name;
        if (n === "nether_portal" || n === "end_portal") return n;
      }
  return null;
}

// Blocks a client may set for free right after it arrives: its arrival portal or the End platform.
export interface Arrival {
  tick: number;
  box: [number, number, number, number, number, number] | null;
  obsidian: number;
  portal: number;
  air: number;
}

// Where the portal leads, as the chunk the client may centre on (r chunks of slack) and the blocks it may build there.
// "any": the destination is the player's spawn, which the host does not track. null: this portal does not lead to `to`.
export function portalExit(from: Dim, to: Dim, portal: Portal, x: number, z: number, tick: number): { cx: number; cz: number; r: number; arrival: Arrival } | "any" | null {
  if (portal === "end_portal") {
    if (from === "end" && to === "overworld") return "any";
    if (from !== "overworld" || to !== "end") return null;
    return { cx: 6, cz: 0, r: 1, arrival: { tick, box: [98, 48, -2, 102, 51, 2], obsidian: 25, portal: 0, air: 75 } };
  }
  if (portal !== "nether_portal") return null;
  const scale = from === "overworld" && to === "nether" ? 1 / 8 : from === "nether" && to === "overworld" ? 8 : 0;
  if (!scale) return null;
  const tx = Math.floor(x * scale), tz = Math.floor(z * scale);
  const [y0, y1] = to === "nether" ? [31, 122] : [MIN_Y, MAX_Y];
  return { cx: tx >> 4, cz: tz >> 4, r: 2, arrival: { tick, box: [tx - 18, y0, tz - 18, tx + 18, y1, tz + 18], obsidian: 20, portal: 6, air: 18 } };
}

export function takeArrival(a: Arrival | null, s: BlockState, x: number, y: number, z: number, tick: number): boolean {
  if (!a?.box || tick - a.tick >= 200) return false;
  const [x0, y0, z0, x1, y1, z1] = a.box;
  if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) return false;
  const n = BLOCKS[idOf(s)]?.name;
  const k = idOf(s) === 0 ? "air" : n === "obsidian" ? "obsidian" : n === "nether_portal" ? "portal" : null;
  if (!k || a[k] <= 0) return false;
  a[k]--;
  return true;
}

// Runs fn with the off-hand stack in the selected slot, so held(), removeHeld() and damageHeld() act on the hand used.
export function withOffHand<T>(inv: { slots: (ItemStack | null)[]; selected: number }, fn: () => T): T {
  const s = inv.selected;
  [inv.slots[s], inv.slots[40]] = [inv.slots[40], inv.slots[s]];
  try {
    return fn();
  } finally {
    [inv.slots[s], inv.slots[40]] = [inv.slots[40], inv.slots[s]];
  }
}
