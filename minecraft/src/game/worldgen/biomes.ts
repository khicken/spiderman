import type { BiomeDef, Dim } from "../contracts";

type Spec = [name: string, dim: Dim, temp: number, downfall: number, grass: number, foliage: number, water: number, sky: number, precip: BiomeDef["precipitation"]];

// Colors are the vanilla values at sea level. Biome ids are saved in chunks, so append only.
const SPECS: Spec[] = [
  ["plains", "overworld", 0.8, 0.4, 0x91bd59, 0x77ab2f, 0x3f76e4, 0x78a7ff, "rain"],
  ["sunflower_plains", "overworld", 0.8, 0.4, 0x91bd59, 0x77ab2f, 0x3f76e4, 0x78a7ff, "rain"],
  ["forest", "overworld", 0.7, 0.8, 0x79c05a, 0x59ae30, 0x3f76e4, 0x79a6ff, "rain"],
  ["flower_forest", "overworld", 0.7, 0.8, 0x79c05a, 0x59ae30, 0x3f76e4, 0x79a6ff, "rain"],
  ["birch_forest", "overworld", 0.6, 0.6, 0x88bb67, 0x6ba941, 0x3f76e4, 0x7aa5ff, "rain"],
  ["dark_forest", "overworld", 0.7, 0.8, 0x507a32, 0x59ae30, 0x3f76e4, 0x79a6ff, "rain"],
  ["taiga", "overworld", 0.25, 0.8, 0x86b783, 0x68a464, 0x3f76e4, 0x7da3ff, "rain"],
  ["snowy_taiga", "overworld", -0.5, 0.4, 0x80b497, 0x60a17b, 0x3d57d6, 0x839eff, "snow"],
  ["old_growth_pine_taiga", "overworld", 0.3, 0.8, 0x86b87f, 0x68a55f, 0x3f76e4, 0x7ca3ff, "rain"],
  ["snowy_plains", "overworld", 0.0, 0.5, 0x80b497, 0x60a17b, 0x3f76e4, 0x7fa1ff, "snow"],
  ["ice_spikes", "overworld", 0.0, 0.5, 0x80b497, 0x60a17b, 0x3f76e4, 0x7fa1ff, "snow"],
  ["desert", "overworld", 2.0, 0.0, 0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff, "none"],
  ["savanna", "overworld", 2.0, 0.0, 0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff, "none"],
  ["badlands", "overworld", 2.0, 0.0, 0x90814d, 0x9e814d, 0x3f76e4, 0x6eb1ff, "none"],
  ["jungle", "overworld", 0.95, 0.9, 0x59c93c, 0x30bb0b, 0x3f76e4, 0x77a8ff, "rain"],
  ["bamboo_jungle", "overworld", 0.95, 0.9, 0x59c93c, 0x30bb0b, 0x3f76e4, 0x77a8ff, "rain"],
  ["swamp", "overworld", 0.8, 0.9, 0x6a7039, 0x6a7039, 0x617b64, 0x78a7ff, "rain"],
  ["mangrove_swamp", "overworld", 0.8, 0.9, 0x6a7039, 0x8db127, 0x3a7a6a, 0x78a7ff, "rain"],
  ["cherry_grove", "overworld", 0.5, 0.8, 0xb6db61, 0xb6db61, 0x5db7ef, 0x7ba4ff, "rain"],
  ["meadow", "overworld", 0.5, 0.8, 0x83bb6d, 0x63a948, 0x0e4ecf, 0x7ba4ff, "rain"],
  ["windswept_hills", "overworld", 0.2, 0.3, 0x8ab689, 0x6da36b, 0x3f76e4, 0x7da2ff, "rain"],
  ["stony_peaks", "overworld", 1.0, 0.3, 0x9abe4b, 0x82ac1e, 0x3f76e4, 0x76a8ff, "rain"],
  ["jagged_peaks", "overworld", -0.7, 0.9, 0x80b497, 0x60a17b, 0x3f76e4, 0x85a0ff, "snow"],
  ["frozen_peaks", "overworld", -0.7, 0.9, 0x80b497, 0x60a17b, 0x3f76e4, 0x85a0ff, "snow"],
  ["snowy_slopes", "overworld", -0.3, 0.9, 0x80b497, 0x60a17b, 0x3f76e4, 0x83a0ff, "snow"],
  ["grove", "overworld", -0.2, 0.8, 0x80b497, 0x60a17b, 0x3f76e4, 0x81a0ff, "snow"],
  ["beach", "overworld", 0.8, 0.4, 0x91bd59, 0x77ab2f, 0x3f76e4, 0x78a7ff, "rain"],
  ["snowy_beach", "overworld", 0.05, 0.3, 0x80b497, 0x60a17b, 0x3d57d6, 0x7fa1ff, "snow"],
  ["stony_shore", "overworld", 0.2, 0.3, 0x8ab689, 0x6da36b, 0x3f76e4, 0x7da2ff, "rain"],
  ["river", "overworld", 0.5, 0.5, 0x8eb971, 0x71a74d, 0x3f76e4, 0x7ba4ff, "rain"],
  ["frozen_river", "overworld", 0.0, 0.5, 0x80b497, 0x60a17b, 0x3938c9, 0x7fa1ff, "snow"],
  ["ocean", "overworld", 0.5, 0.5, 0x8eb971, 0x71a74d, 0x3f76e4, 0x7ba4ff, "rain"],
  ["deep_ocean", "overworld", 0.5, 0.5, 0x8eb971, 0x71a74d, 0x3f76e4, 0x7ba4ff, "rain"],
  ["warm_ocean", "overworld", 0.5, 0.5, 0x8eb971, 0x71a74d, 0x43d5ee, 0x7ba4ff, "rain"],
  ["lukewarm_ocean", "overworld", 0.5, 0.5, 0x8eb971, 0x71a74d, 0x45adf2, 0x7ba4ff, "rain"],
  ["cold_ocean", "overworld", 0.5, 0.5, 0x8eb971, 0x71a74d, 0x3d57d6, 0x7ba4ff, "rain"],
  ["frozen_ocean", "overworld", 0.0, 0.5, 0x80b497, 0x60a17b, 0x3938c9, 0x7fa1ff, "snow"],
  ["mushroom_fields", "overworld", 0.9, 1.0, 0x55c93f, 0x2bbb0f, 0x3f76e4, 0x77a8ff, "rain"],
  ["dripstone_caves", "overworld", 0.8, 0.4, 0x91bd59, 0x77ab2f, 0x3f76e4, 0x78a7ff, "rain"],
  ["lush_caves", "overworld", 0.5, 0.5, 0x8eb971, 0x71a74d, 0x3f76e4, 0x7ba4ff, "rain"],
  ["deep_dark", "overworld", 0.8, 0.4, 0x91bd59, 0x77ab2f, 0x3f76e4, 0x78a7ff, "rain"],
  ["nether_wastes", "nether", 2.0, 0.0, 0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff, "none"],
  ["crimson_forest", "nether", 2.0, 0.0, 0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff, "none"],
  ["warped_forest", "nether", 2.0, 0.0, 0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff, "none"],
  ["soul_sand_valley", "nether", 2.0, 0.0, 0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff, "none"],
  ["basalt_deltas", "nether", 2.0, 0.0, 0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff, "none"],
  ["the_end", "end", 0.5, 0.5, 0x8eb971, 0x71a74d, 0x3f76e4, 0x000000, "none"],
  ["end_highlands", "end", 0.5, 0.5, 0x8eb971, 0x71a74d, 0x3f76e4, 0x000000, "none"],
  ["old_growth_birch_forest", "overworld", 0.6, 0.6, 0x88bb67, 0x6ba941, 0x3f76e4, 0x7aa5ff, "rain"],
  ["old_growth_spruce_taiga", "overworld", 0.25, 0.8, 0x86b783, 0x68a464, 0x3f76e4, 0x7da3ff, "rain"],
  ["windswept_forest", "overworld", 0.2, 0.3, 0x8ab689, 0x6da36b, 0x3f76e4, 0x7da2ff, "rain"],
  ["windswept_gravelly_hills", "overworld", 0.2, 0.3, 0x8ab689, 0x6da36b, 0x3f76e4, 0x7da2ff, "rain"],
  ["windswept_savanna", "overworld", 2.0, 0.0, 0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff, "none"],
  ["savanna_plateau", "overworld", 2.0, 0.0, 0xbfb755, 0xaea42a, 0x3f76e4, 0x6eb1ff, "none"],
  ["eroded_badlands", "overworld", 2.0, 0.0, 0x90814d, 0x9e814d, 0x3f76e4, 0x6eb1ff, "none"],
  ["wooded_badlands", "overworld", 2.0, 0.0, 0x90814d, 0x9e814d, 0x3f76e4, 0x6eb1ff, "none"],
  ["sparse_jungle", "overworld", 0.95, 0.8, 0x64c73f, 0x3eb80f, 0x3f76e4, 0x77a8ff, "rain"],
  ["deep_lukewarm_ocean", "overworld", 0.5, 0.5, 0x8eb971, 0x71a74d, 0x45adf2, 0x7ba4ff, "rain"],
  ["deep_cold_ocean", "overworld", 0.5, 0.5, 0x8eb971, 0x71a74d, 0x3d57d6, 0x7ba4ff, "rain"],
  ["deep_frozen_ocean", "overworld", 0.5, 0.5, 0x8eb971, 0x71a74d, 0x3938c9, 0x7ba4ff, "rain"],
  ["small_end_islands", "end", 0.5, 0.5, 0x8eb971, 0x71a74d, 0x3f76e4, 0x000000, "none"],
  ["end_midlands", "end", 0.5, 0.5, 0x8eb971, 0x71a74d, 0x3f76e4, 0x000000, "none"],
  ["end_barrens", "end", 0.5, 0.5, 0x8eb971, 0x71a74d, 0x3f76e4, 0x000000, "none"],
];

const NETHER_FOG: Record<string, number> = {
  nether_wastes: 0x330808,
  crimson_forest: 0x330303,
  warped_forest: 0x1a051a,
  soul_sand_valley: 0x1b4745,
  basalt_deltas: 0x685f70,
};

const titleCase = (n: string) => n.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

export const BIOMES: BiomeDef[] = SPECS.map(([name, dim, temperature, downfall, grassColor, foliageColor, waterColor, skyColor, precipitation], id) => ({
  id,
  name,
  displayName: titleCase(name),
  dim,
  temperature,
  downfall,
  grassColor,
  foliageColor,
  waterColor,
  skyColor,
  fogColor: dim === "nether" ? NETHER_FOG[name] : dim === "end" ? 0x0a080c : 0xc0d8ff,
  precipitation,
}));

const BY_NAME = new Map(BIOMES.map((b) => [b.name, b]));
export const biomeId = (name: string) => BY_NAME.get(name)?.id ?? 0;
export const biomeByName = (name: string) => BY_NAME.get(name) ?? BIOMES[0];
