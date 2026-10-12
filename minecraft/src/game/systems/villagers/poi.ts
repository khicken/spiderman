import type { GameCtx, GameEvent } from "../../contracts";
import { idOf, metaOf } from "../../contracts";
import { BLOCKS, blockDef } from "../../blocks/registry";

export const JOB_SITES: Record<string, string> = {
  composter: "farmer", lectern: "librarian", blast_furnace: "armorer", lit_blast_furnace: "armorer", smoker: "butcher", lit_smoker: "butcher",
  cartography_table: "cartographer", brewing_stand: "cleric", barrel: "fisherman", fletching_table: "fletcher", cauldron: "leatherworker",
  water_cauldron: "leatherworker", lava_cauldron: "leatherworker", powder_snow_cauldron: "leatherworker", stonecutter: "mason", loom: "shepherd",
  smithing_table: "toolsmith", grindstone: "weaponsmith",
};

export type PoiKind = string; // a profession, "bed" or "bell"
export interface Poi {
  x: number;
  y: number;
  z: number;
  kind: PoiKind;
}

const KIND: (PoiKind | undefined)[] = [];
for (const b of BLOCKS) {
  if (JOB_SITES[b.name]) KIND[b.id] = JOB_SITES[b.name];
  else if (b.name === "bell") KIND[b.id] = "bell";
}

function kindOf(state: number): PoiKind | undefined {
  const k = KIND[idOf(state)];
  if (k) return k;
  return blockDef(state).shape === "bed" && metaOf(state) & 4 ? "bed" : undefined;
}

export const posKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

const pois = new Map<string, Poi>();
const scanned = new Map<string, number>();
const queue: [number, number, number][] = [];
const RESCAN = 2400;

export function clearPois() {
  pois.clear();
  scanned.clear();
  queue.length = 0;
}

// Ask for the chunks within r of a point. Scans run at one chunk band per tick.
export function requestArea(ctx: GameCtx, x: number, y: number, z: number, r: number) {
  const band = Math.floor(y / 16);
  for (let cx = (x - r) >> 4; cx <= (x + r) >> 4; cx++)
    for (let cz = (z - r) >> 4; cz <= (z + r) >> 4; cz++) {
      const k = `${cx},${cz},${band}`;
      const at = scanned.get(k);
      if (at !== undefined && ctx.time.tick - at < RESCAN) continue;
      scanned.set(k, ctx.time.tick);
      queue.push([cx, cz, band]);
    }
}

export function tickScan(ctx: GameCtx) {
  const job = queue.shift();
  if (!job) return;
  const [cx, cz, band] = job;
  const w = ctx.world;
  if (!w.isLoaded(cx * 16, cz * 16)) {
    scanned.delete(`${cx},${cz},${band}`);
    return;
  }
  for (let y = band * 16 - 16; y < band * 16 + 32; y++)
    for (let z = cz * 16; z < cz * 16 + 16; z++)
      for (let x = cx * 16; x < cx * 16 + 16; x++) {
        const s = w.getBlock(x, y, z);
        if (s === 0) continue;
        const k = kindOf(s);
        if (k) pois.set(posKey(x, y, z), { x, y, z, kind: k });
      }
}

export function poiEvent(e: GameEvent) {
  if (e.type !== "block_changed") return;
  const k = posKey(e.x, e.y, e.z);
  const kind = kindOf(e.to);
  if (kind) pois.set(k, { x: e.x, y: e.y, z: e.z, kind });
  else pois.delete(k);
}

export function poiValid(ctx: GameCtx, p: { x: number; y: number; z: number }, kind: PoiKind): boolean {
  return kindOf(ctx.world.getBlock(p.x, p.y, p.z)) === kind;
}

export function nearestPoi(ctx: GameCtx, kind: PoiKind | null, x: number, y: number, z: number, r: number, taken?: Set<string>): Poi | null {
  let best: Poi | null = null;
  let bd = r * r;
  for (const [k, p] of pois) {
    if (kind ? p.kind !== kind : p.kind === "bed" || p.kind === "bell") continue;
    if (taken?.has(k)) continue;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2;
    if (d >= bd) continue;
    if (!poiValid(ctx, p, p.kind)) {
      pois.delete(k);
      continue;
    }
    bd = d;
    best = p;
  }
  return best;
}
