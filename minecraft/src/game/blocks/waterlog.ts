import type { BlockState, WorldApi } from "../contracts";
import { stateOf } from "../contracts";
import { BLOCKS, IS_FLUID, blockId } from "./registry";

// Waterlogging lives outside the 4-bit meta: a per-chunk sparse set of waterlogged cells (ChunkData.waterlogged),
// plus blocks that always hold water (kelp, seagrass) like vanilla's LiquidBlockContainer plants.
export const WATER_ID = blockId("water");
export const WATER_SOURCE: BlockState = stateOf(WATER_ID, 0);

export const WATERLOGGABLE = new Uint8Array(4096);
export const IMPLICIT_WATER = new Uint8Array(4096);

const NAMES = new Set([
  "ladder", "chain", "lantern", "soul_lantern", "chest", "trapped_chest", "ender_chest", "iron_bars", "glass_pane", "sea_pickle",
  "conduit", "campfire", "soul_campfire", "scaffolding", "lightning_rod", "pointed_dripstone", "small_amethyst_bud",
  "medium_amethyst_bud", "large_amethyst_bud", "amethyst_cluster", "small_dripleaf", "small_dripleaf_upper", "big_dripleaf",
  "big_dripleaf_stem", "glow_lichen", "sculk_vein", "sculk_sensor", "calibrated_sculk_sensor", "sculk_shrieker", "hanging_roots",
  "mangrove_propagule", "mangrove_roots", "heavy_core", "decorated_pot", "light", "copper_grate", "exposed_copper_grate",
  "weathered_copper_grate", "oxidized_copper_grate", "waxed_copper_grate", "waxed_exposed_copper_grate",
  "waxed_weathered_copper_grate", "waxed_oxidized_copper_grate", "rail", "powered_rail", "detector_rail", "activator_rail",
]);
const SHAPES = new Set(["slab", "stairs", "fence", "wall", "pane", "trapdoor", "sign", "rail", "ladder", "chain", "lantern", "chest"]);
for (const d of BLOCKS) {
  const t = d.tags ?? [];
  if (
    NAMES.has(d.name) || SHAPES.has(d.shape) || t.includes("hanging_signs") || t.includes("candles") ||
    /_hanging_sign$|^(dead_)?\w+_coral(_fan|_wall_fan)?$|_candle$|^candle$/.test(d.name)
  ) WATERLOGGABLE[d.id] = 1;
}
for (const n of ["kelp", "kelp_plant", "seagrass", "tall_seagrass", "tall_seagrass_upper"]) {
  const id = blockId(n);
  if (id) IMPLICIT_WATER[id] = 1;
}
const SLAB = new Uint8Array(4096);
for (const d of BLOCKS) if (d.shape === "slab") SLAB[d.id] = 1;
WATERLOGGABLE[0] = 0;
WATERLOGGABLE[WATER_ID] = 0;

// Double slabs are full blocks and drop their water, like vanilla.
export const canHoldWater = (s: BlockState): boolean => {
  const id = s & 0xfff;
  if (!WATERLOGGABLE[id]) return false;
  return !(SLAB[id] && s >>> 12 === 2);
};

export const isWaterlogged = (w: WorldApi, x: number, y: number, z: number, s: BlockState = w.getBlock(x, y, z)): boolean => {
  const id = s & 0xfff;
  return IMPLICIT_WATER[id] === 1 || (WATERLOGGABLE[id] === 1 && !!w.isWaterlogged?.(x, y, z));
};

export function fluidState(w: WorldApi, x: number, y: number, z: number): BlockState {
  const s = w.getBlock(x, y, z);
  const id = s & 0xfff;
  if (IS_FLUID[id]) return s;
  if (IMPLICIT_WATER[id] || (WATERLOGGABLE[id] && w.isWaterlogged?.(x, y, z))) return WATER_SOURCE;
  return 0;
}
