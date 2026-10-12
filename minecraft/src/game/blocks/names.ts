export const WOOD_TYPES = [
  "oak",
  "spruce",
  "birch",
  "jungle",
  "acacia",
  "dark_oak",
  "mangrove",
  "cherry",
  "bamboo",
  "crimson",
  "warped",
] as const;
export type WoodType = (typeof WOOD_TYPES)[number];

export const COLORS = [
  "white",
  "orange",
  "magenta",
  "light_blue",
  "yellow",
  "lime",
  "pink",
  "gray",
  "light_gray",
  "cyan",
  "purple",
  "blue",
  "brown",
  "green",
  "red",
  "black",
] as const;
export type Color = (typeof COLORS)[number];

export const SMALL_FLOWERS = [
  "dandelion",
  "poppy",
  "blue_orchid",
  "allium",
  "azure_bluet",
  "red_tulip",
  "orange_tulip",
  "white_tulip",
  "pink_tulip",
  "oxeye_daisy",
  "cornflower",
  "lily_of_the_valley",
  "wither_rose",
  "torchflower",
] as const;

export const TALL_FLOWERS = ["sunflower", "lilac", "rose_bush", "peony", "pitcher_plant"] as const;

export const FLOWERS = [...SMALL_FLOWERS, ...TALL_FLOWERS] as const;

export const CORALS = ["tube", "brain", "bubble", "fire", "horn"] as const;

export const COPPER_STAGES = ["", "exposed_", "weathered_", "oxidized_"] as const;

// Crop textures change with age, which BlockTextures cannot hold. Index is the age shown.
export const CROP_STAGE_TEXTURES: Record<string, string[]> = {
  wheat: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `wheat_stage${i}`),
  carrots: [0, 0, 1, 1, 2, 2, 2, 3].map((i) => `carrots_stage${i}`),
  potatoes: [0, 0, 1, 1, 2, 2, 2, 3].map((i) => `potatoes_stage${i}`),
  beetroots: [0, 1, 2, 3].map((i) => `beetroots_stage${i}`),
  nether_wart: [0, 1, 1, 2].map((i) => `nether_wart_stage${i}`),
  torchflower_crop: [0, 1].map((i) => `torchflower_crop_stage${i}`),
  pitcher_crop: [0, 1, 2, 3, 4].map((i) => `pitcher_crop_bottom_stage_${i}`),
  pitcher_crop_upper: [0, 1, 2, 3, 4].map((i) => `pitcher_crop_top_stage_${i}`),
  sweet_berry_bush: [0, 1, 2, 3].map((i) => `sweet_berry_bush_stage${i}`),
  cocoa: [0, 1, 2].map((i) => `cocoa_stage${i}`),
  melon_stem: ["melon_stem"],
  pumpkin_stem: ["pumpkin_stem"],
};
