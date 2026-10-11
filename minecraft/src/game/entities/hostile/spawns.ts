import { BIOMES } from "../../worldgen/biomes";

const overworld = BIOMES.filter((b) => b.dim === "overworld").map((b) => b.name);

export const MONSTER_BIOMES = overworld.filter((n) => n !== "mushroom_fields" && n !== "deep_dark");
export const DESERT = ["desert"];
export const SNOWY = ["snowy_plains", "ice_spikes", "frozen_river", "frozen_ocean", "deep_frozen_ocean"].filter((n) => overworld.includes(n));
export const SWAMPS = ["swamp", "mangrove_swamp"];
export const RIVERS = ["river", "frozen_river"];
export const OCEANS = overworld.filter((n) => n.endsWith("ocean"));
export const SAVANNA_BADLANDS = overworld.filter((n) => n.startsWith("savanna") || n.endsWith("badlands"));
export const END = BIOMES.filter((b) => b.dim === "end").map((b) => b.name);
