import { itemDef } from "./registry";
import { DYES, WOODS } from "./data-misc";

const BURNABLE_WOODS = WOODS.filter((w) => w !== "crimson" && w !== "warped");

// Burn time in ticks for block items, which the registry generates without fuelTicks.
export const FUEL: Record<string, number> = {
  coal_block: 16000,
  dried_kelp_block: 4001,
  bamboo_block: 300,
  stripped_bamboo_block: 300,
  bamboo_mosaic: 300,
  bamboo_mosaic_stairs: 300,
  bamboo_mosaic_slab: 150,
  scaffolding: 50,
  crafting_table: 300,
  chest: 300,
  trapped_chest: 300,
  bookshelf: 300,
  chiseled_bookshelf: 300,
  lectern: 300,
  jukebox: 300,
  note_block: 300,
  loom: 300,
  barrel: 300,
  cartography_table: 300,
  fletching_table: 300,
  smithing_table: 300,
  composter: 300,
  ladder: 300,
  daylight_detector: 300,
  mangrove_roots: 300,
  dead_bush: 100,
  azalea: 100,
  flowering_azalea: 100,
  mangrove_propagule: 100,
  wooden_hoe: 200,
};

for (const w of BURNABLE_WOODS) {
  const log = w === "bamboo" ? null : `${w}_log`;
  if (log) for (const n of [log, `stripped_${log}`, `${w}_wood`, `stripped_${w}_wood`]) FUEL[n] = 300;
  FUEL[`${w}_planks`] = 300;
  FUEL[`${w}_stairs`] = 300;
  FUEL[`${w}_slab`] = 150;
  FUEL[`${w}_fence`] = 300;
  FUEL[`${w}_fence_gate`] = 300;
  FUEL[`${w}_trapdoor`] = 300;
  FUEL[`${w}_pressure_plate`] = 300;
  FUEL[`${w}_button`] = 100;
  if (w !== "bamboo") FUEL[w === "mangrove" ? "mangrove_propagule" : `${w}_sapling`] = 100;
}
for (const c of DYES) {
  FUEL[`${c}_wool`] = 100;
  FUEL[`${c}_carpet`] = 67;
  FUEL[`${c}_banner`] = 300;
}
for (const t of ["wooden_sword", "wooden_shovel", "wooden_pickaxe", "wooden_axe", "wooden_hoe"]) FUEL[t] = 200;

export function fuelTicks(item: string): number {
  return itemDef(item)?.fuelTicks ?? FUEL[item] ?? 0;
}

export const isFuel = (item: string) => fuelTicks(item) > 0;
