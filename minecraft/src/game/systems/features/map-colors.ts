import type { BlockState } from "../../contracts";
import { BLOCKS } from "../../blocks/registry";
import { paintBlockTexture } from "../../textures/index";

// Vanilla MapColor base colors, index = MapColor.id (0 is NONE, transparent).
export const MAP_BASE = [
  0, 0x7fb238, 0xf7e9a3, 0xc7c7c7, 0xff0000, 0xa0a0ff, 0xa7a7a7, 0x007c00, 0xffffff, 0xa4a8b8, 0x976d4d, 0x707070, 0x4040ff, 0x8f7748, 0xfffcf5,
  0xd87f33, 0xb24cd8, 0x6699d8, 0xe5e533, 0x7fcc19, 0xf27fa5, 0x4c4c4c, 0x999999, 0x4c7f99, 0x7f3fb2, 0x334cb2, 0x664c33, 0x667f33, 0x993333, 0x191919,
  0xfaee4d, 0x5cdbd5, 0x4a80ff, 0x00d93a, 0x815631, 0x700200, 0xd1b1a1, 0x9f5224, 0x95576c, 0x706c8a, 0xba8524, 0x677535, 0xa04d4e, 0x392923, 0x876b62,
  0x575c5c, 0x7a4958, 0x4c3e5c, 0x4c3223, 0x4c522a, 0x8e3c2e, 0x251610, 0xbd3031, 0x943f61, 0x5c191d, 0x167e86, 0x3a8e8c, 0x562c3e, 0x14b485, 0x646464,
  0xd8af93, 0x7fa796,
];
export const SHADE = [180, 220, 255, 135];

const C = { GRASS: 1, SAND: 2, WOOL: 3, FIRE: 4, ICE: 5, METAL: 6, PLANT: 7, SNOW: 8, CLAY: 9, DIRT: 10, STONE: 11, WATER: 12, WOOD: 13, QUARTZ: 14, ORANGE: 15, PODZOL: 34, NETHER: 35, T_WHITE: 36, DEEPSLATE: 59, GOLD: 30, DIAMOND: 31, LAPIS: 32, EMERALD: 33, BLACK: 29, BROWN: 26, RED: 28, YELLOW: 18, PURPLE: 24, CRIMSON_NYLIUM: 52, CRIMSON_STEM: 53, WARPED_NYLIUM: 55, WARPED_STEM: 56, WARPED_WART: 58, GLOW_LICHEN: 61 };
const DYES = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];
const DYE_COLOR = [8, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
const WOODS: Record<string, number> = { oak: C.WOOD, spruce: C.PODZOL, birch: C.SAND, jungle: C.DIRT, acacia: C.ORANGE, dark_oak: C.BROWN, mangrove: C.RED, cherry: C.T_WHITE, bamboo: C.YELLOW, crimson: C.CRIMSON_STEM, warped: C.WARPED_STEM };

function byName(n: string, shape: string): number | undefined {
  if (n === "air" || n.endsWith("glass") || n.endsWith("glass_pane") || n === "barrier" || n === "light" || n === "structure_void") return 0;
  if (n === "water" || n === "bubble_column" || n.includes("kelp") || n.includes("seagrass")) return C.WATER;
  if (n === "lava" || n === "fire" || n === "soul_fire") return C.FIRE;
  if (n === "grass_block") return C.GRASS;
  if (n.endsWith("leaves") || n === "vine" || n === "lily_pad" || n === "cactus" || n === "sugar_cane" || n === "moss_block" || n === "moss_carpet" || n.includes("azalea")) return C.PLANT;
  for (let i = 0; i < 16; i++) {
    const d = DYES[i];
    if (!n.startsWith(`${d}_`)) continue;
    const rest = n.slice(d.length + 1);
    if (rest === "terracotta" || rest === "glazed_terracotta") return 36 + i;
    if (/^(wool|carpet|concrete|concrete_powder|bed|banner|shulker_box|candle)$/.test(rest)) return DYE_COLOR[i];
  }
  if (n === "terracotta") return C.ORANGE;
  if (n === "snow" || n === "snow_block" || n === "powder_snow") return C.SNOW;
  if (n.includes("ice")) return C.ICE;
  if (n === "red_sand" || n.includes("red_sandstone")) return C.ORANGE;
  if (n === "sand" || n.includes("sandstone") || n === "end_stone" || n.startsWith("end_stone") || n === "glowstone" || n === "suspicious_sand") return C.SAND;
  if (n === "podzol") return C.PODZOL;
  if (n === "mycelium") return C.PURPLE;
  if (n === "dirt" || n === "coarse_dirt" || n === "farmland" || n === "dirt_path" || n === "rooted_dirt") return C.DIRT;
  if (n.startsWith("deepslate") || n.includes("_deepslate") || n === "reinforced_deepslate") return C.DEEPSLATE;
  if (n === "clay") return C.CLAY;
  if (n === "netherrack" || n === "magma_block" || n.includes("nether_brick") || n === "nether_wart_block") return C.NETHER;
  if (n === "crimson_nylium") return C.CRIMSON_NYLIUM;
  if (n === "warped_nylium") return C.WARPED_NYLIUM;
  if (n === "warped_wart_block") return C.WARPED_WART;
  if (n === "gold_block") return C.GOLD;
  if (n === "diamond_block") return C.DIAMOND;
  if (n === "lapis_block") return C.LAPIS;
  if (n === "emerald_block") return C.EMERALD;
  if (n === "iron_block" || n.includes("anvil") || n === "iron_bars" || n === "heavy_weighted_pressure_plate") return C.METAL;
  if (n === "obsidian" || n === "crying_obsidian" || n === "coal_block") return C.BLACK;
  if (n === "soul_sand" || n === "soul_soil" || n === "dark_oak_log") return C.BROWN;
  if (n === "glow_lichen") return C.GLOW_LICHEN;
  if (n === "diorite" || n.startsWith("quartz") || n.endsWith("quartz_block")) return C.QUARTZ;
  for (const w in WOODS) if (n.startsWith(`${w}_`) && /(planks|log|wood|stem|hyphae|slab|stairs|fence|fence_gate|door|trapdoor|sign|pressure_plate|button)$/.test(n)) return WOODS[w];
  if (shape === "cross" || shape === "crop") return C.PLANT;
  if (n === "stone" || n === "cobblestone" || n.endsWith("_ore") || n === "gravel" || n === "andesite" || n.includes("stone_brick") || n === "smooth_stone" || n === "bedrock") return C.STONE;
  return undefined;
}

function nearest(r: number, g: number, b: number): number {
  let best = C.STONE, bd = Infinity;
  for (let i = 1; i < MAP_BASE.length; i++) {
    const c = MAP_BASE[i];
    const d = (((c >> 16) & 255) - r) ** 2 + (((c >> 8) & 255) - g) ** 2 + ((c & 255) - b) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

const cache = new Int16Array(4096).fill(-1);

// Map color index of a block: name rules for vanilla-known blocks, else the nearest palette color to its top texture.
export function mapColorOf(s: BlockState): number {
  const id = s & 0xfff;
  if (cache[id] >= 0) return cache[id];
  const def = BLOCKS[id];
  let c = def ? byName(def.name, def.shape) : 0;
  if (c === undefined && def) {
    const key = def.textures.top ?? def.textures.all ?? def.textures.side ?? def.name;
    const px = paintBlockTexture(key);
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      r += px[i];
      g += px[i + 1];
      b += px[i + 2];
      n++;
    }
    c = n ? nearest(r / n, g / n, b / n) : 0;
  }
  cache[id] = c ?? 0;
  return cache[id];
}
