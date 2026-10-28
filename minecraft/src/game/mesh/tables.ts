import type { BlockDef, BlockTextures, Shape } from "../contracts";
import { BLOCKS } from "../blocks/registry";
import { textureLayer } from "../textures/index";

const SHAPE_NAMES: Shape[] = [
  "air", "cube", "cross", "crop", "slab", "stairs", "fluid", "torch", "door", "trapdoor", "fence", "fence_gate",
  "wall", "pane", "ladder", "carpet", "snow_layer", "farmland", "path", "rail", "redstone_wire", "repeater",
  "comparator", "button", "lever", "pressure_plate", "bed", "chest", "cactus", "cake", "sign", "lantern", "chain",
  "anvil", "enchanting_table", "cauldron", "hopper", "flower_pot", "vine", "portal", "end_portal_frame", "lectern",
  "campfire", "custom",
];
export const SH = Object.fromEntries(SHAPE_NAMES.map((s, i) => [s, i])) as Record<Shape, number>;

export const enum K {
  Leaves = 1,
  Grass = 2, // top tinted, side drawn with a tinted overlay
  Snowy = 4, // side turns to grass_block_snow under snow
  SnowCover = 8,
  Lit = 16,
  OffsetXZ = 32,
  OffsetY = 64,
  WallMount = 128,
}

export const NONE = 0xffff;
export const MAX_ID = BLOCKS.length;
export const SHAPE = new Uint8Array(4096);
export const LAYER = new Uint8Array(4096); // 0 opaque, 1 cutout, 2 translucent
export const FULL = new Uint8Array(4096); // opaque full cube: hides the faces next to it
export const AOCC = new Uint8Array(4096); // full collision cube: casts ambient occlusion
export const STURDY = new Uint8Array(4096); // fences, walls and panes connect to it
export const TINT = new Uint8Array(4096); // 0 none, 1 grass, 2 foliage, 3 water, 4 birch, 5 spruce, 6 redstone, 7 stem, 8 lily pad
export const EMIT = new Uint8Array(4096);
export const KIND = new Uint8Array(4096);
export const FLUID_GROUP = new Uint8Array(4096); // 1 water, 2 lava
// Texture layer per (id, meta, face). Cubes are already rotated by meta; other shapes hold canonical faces.
export const TEX = new Uint16Array(MAX_ID * 96);

const MISSING = textureLayer("\u0000missing");
const memo = new Map<string, number>();
export function layerOf(key: string): number {
  let l = memo.get(key);
  if (l === undefined) {
    l = textureLayer(key);
    memo.set(key, l);
  }
  return l;
}
export const hasLayer = (key: string) => layerOf(key) !== MISSING;
export const layerOr = (key: string, fallback: number) => (hasLayer(key) ? layerOf(key) : fallback);

function resolve(t: BlockTextures, face: number): string | undefined {
  switch (face) {
    case 2: return t.top ?? t.end ?? t.all ?? t.side;
    case 3: return t.bottom ?? t.end ?? t.top ?? t.all ?? t.side;
    case 5: return t.north ?? t.front ?? t.side ?? t.all ?? t.top;
    case 4: return t.south ?? t.side ?? t.all ?? t.top;
    case 0: return t.east ?? t.side ?? t.all ?? t.top;
    default: return t.west ?? t.side ?? t.all ?? t.top;
  }
}

const RING = [5, 0, 4, 1];
const RING_IDX = [1, 3, -1, -1, 2, 0];

// World face seen on a cube whose front (canonical north) points to `front`.
function facingToCanonical(front: number, wf: number): number {
  if (front === 2) return [0, 1, 4, 5, 2, 3][wf];
  if (front === 3) return [0, 1, 5, 4, 3, 2][wf];
  if (wf === 2 || wf === 3) return wf;
  const steps = RING_IDX[front];
  return RING[(RING_IDX[wf] - steps + 4) & 3];
}

function axisToCanonical(axis: number, wf: number): number {
  if (axis === 1) return [2, 3, 0, 1, 4, 5][wf];
  if (axis === 2) return [0, 1, 4, 5, 2, 3][wf];
  return wf;
}

const STAGES: Record<string, number[]> = {
  wheat: [0, 1, 2, 3, 4, 5, 6, 7],
  carrots: [0, 0, 1, 1, 2, 2, 2, 3],
  potatoes: [0, 0, 1, 1, 2, 2, 2, 3],
  beetroots: [0, 1, 2, 3],
  nether_wart: [0, 1, 1, 2],
  torchflower_crop: [0, 1],
  pitcher_crop: [0, 1, 2, 3, 4],
  pitcher_crop_upper: [0, 1, 2, 3, 4],
  sweet_berry_bush: [0, 1, 2, 3],
  cocoa: [0, 1, 2],
  respawn_anchor: [0, 1, 2, 3, 4],
  suspicious_sand: [0, 1, 2, 3],
  suspicious_gravel: [0, 1, 2, 3],
};

function stageKey(name: string, key: string, meta: number): string {
  const st = STAGES[name];
  if (!st) return key;
  const m = /^(.*?)(\d+)$/.exec(key);
  if (!m) return key;
  return m[1] + st[Math.min(meta, st.length - 1)];
}

const TINTS: Record<string, number> = { grass: 1, foliage: 2, water: 3, birch: 4, spruce: 5, redstone: 6, stem: 7 };
const OFFSET_XYZ = new Set(["short_grass", "fern"]);
const OFFSET_XZ = new Set(["tall_grass", "tall_grass_upper", "large_fern", "large_fern_upper", "bamboo", "pointed_dripstone", "mangrove_propagule", "hanging_roots", "warped_roots", "crimson_roots", "nether_sprouts"]);
const PILLAR_NAMES = /(_log|_wood|_stem|_hyphae|pillar|basalt|bone_block|hay_block|^deepslate$|froglight|bamboo_block|muddy_mangrove_roots)$/;

// Pistons and observers keep the back in `bottom` and use the vanilla up/down faces.
function resolveFacing(d: BlockDef, cf: number, meta: number): string | undefined {
  const t = d.textures;
  const on = (meta & 8) !== 0;
  if (d.name === "piston" || d.name === "sticky_piston") {
    if (cf === 5) return on ? t.top ?? t.front : t.front;
    return cf === 4 ? t.bottom : t.side;
  }
  if (d.name === "observer") {
    if (cf === 5) return t.front;
    if (cf === 4) return on && hasLayer("observer_back_on") ? "observer_back_on" : t.bottom;
    return cf === 2 || cf === 3 ? t.top : t.side;
  }
  return resolve(t, cf);
}

const H_FACE = [4, 1, 5, 0];

function vaultKey(cf: number, meta: number): string {
  const om = meta & 8 ? "_ominous" : "";
  if (cf === 2) return `vault_top${om}`;
  if (cf === 3) return `vault_bottom${om}`;
  return `vault_${cf === 5 ? "front" : "side"}_${meta & 4 ? "on" : "off"}${om}`;
}

function trialKey(cf: number, meta: number): string {
  const om = meta & 8 ? "_ominous" : "";
  const st = meta & 3;
  if (cf === 3) return "trial_spawner_bottom";
  if (cf === 2 && st === 2) return `trial_spawner_top_ejecting_reward${om}`;
  return `trial_spawner_${cf === 2 ? "top" : "side"}_${st ? "active" : "inactive"}${om}`;
}

function fillTex(d: BlockDef) {
  const t = d.textures;
  const facing = d.shape === "cube" && !!t.front;
  const pillar = d.shape === "cube" && !t.front && (!!t.end || PILLAR_NAMES.test(d.name));
  for (let meta = 0; meta < 16; meta++) {
    for (let wf = 0; wf < 6; wf++) {
      let cf = wf;
      if (facing && (meta & 7) < 6) cf = facingToCanonical(meta & 7, wf);
      else if (pillar && meta < 3) cf = axisToCanonical(meta, wf);
      let key = (facing ? resolveFacing(d, cf, meta) : resolve(t, cf)) ?? d.name;
      key = stageKey(d.name, key, meta);
      if (d.name === "farmland" && meta === 7 && cf === 2 && hasLayer("farmland_moist")) key = "farmland_moist";
      if (d.name === "chiseled_bookshelf" && meta & 8 && cf === 5) key = "chiseled_bookshelf_occupied";
      if (d.name === "respawn_anchor" && meta > 0 && cf === 2) key = "respawn_anchor_top";
      if ((d.name === "beehive" || d.name === "bee_nest") && meta & 8 && cf === 5) key = `${d.name}_front_honey`;
      if (d.name === "vault") key = vaultKey(facingToCanonical(H_FACE[meta & 3], wf), meta);
      if (d.name === "trial_spawner") key = trialKey(cf, meta);
      TEX[(d.id * 16 + meta) * 6 + wf] = layerOf(key);
    }
  }
}

for (const d of BLOCKS) {
  const id = d.id;
  SHAPE[id] = SH[d.shape] ?? SH.custom;
  LAYER[id] = d.layer === "opaque" ? 0 : d.layer === "cutout" ? 1 : 2;
  const cube = d.shape === "cube";
  FULL[id] = cube && d.opaque ? 1 : 0;
  AOCC[id] = cube && d.solid ? 1 : 0;
  const leaves = d.tags?.includes("leaves") ?? false;
  STURDY[id] = cube && d.solid && !leaves && !/pumpkin|melon|barrier|jack_o_lantern/.test(d.name) ? 1 : 0;
  TINT[id] = d.name === "lily_pad" ? 8 : d.tint ? TINTS[d.tint] ?? 0 : 0;
  EMIT[id] = d.lightEmission;
  FLUID_GROUP[id] = d.shape === "fluid" ? (d.name === "lava" ? 2 : 1) : 0;
  let k = 0;
  if (leaves) k |= K.Leaves;
  if (d.name === "grass_block") k |= K.Grass | K.Snowy;
  if (d.name === "mycelium" || d.name === "podzol") k |= K.Snowy;
  if (d.name === "snow" || d.name === "snow_block" || d.name === "powder_snow") k |= K.SnowCover;
  if (d.lightEmission > 0 || /_on$|^powered_|^lit_/.test(d.name) || /_on$/.test(d.textures.top ?? "")) k |= K.Lit;
  if (OFFSET_XYZ.has(d.name)) k |= K.OffsetXZ | K.OffsetY;
  else if (OFFSET_XZ.has(d.name) || (d.shape === "cross" && (d.tags?.includes("flowers") ?? false))) k |= K.OffsetXZ;
  if (d.name.includes("wall_")) k |= K.WallMount;
  KIND[id] = k;
  fillTex(d);
}

export const GRASS_OVERLAY = hasLayer("grass_block_side_overlay") ? layerOf("grass_block_side_overlay") : NONE;
export const GRASS_SNOW = layerOr("grass_block_snow", layerOf("snow"));

export const blockName = (id: number) => (BLOCKS[id] ?? BLOCKS[0]).name;
export const blockTex = (id: number) => (BLOCKS[id] ?? BLOCKS[0]).textures;
export const texAt = (id: number, meta: number, face: number) => TEX[(id * 16 + meta) * 6 + face];

const idByName = new Map(BLOCKS.map((d) => [d.name, d.id]));
export const idOfName = (n: string) => idByName.get(n) ?? 0;

export const REDSTONE_LINK = new Uint8Array(4096);
for (const d of BLOCKS) {
  if (/redstone_torch|redstone_wall_torch|redstone_block|^lever$|_button$|_pressure_plate$|^observer$|^target$|daylight_detector|trapped_chest|^lectern$|tripwire_hook|sculk_sensor|detector_rail|redstone_wire/.test(d.name)) REDSTONE_LINK[d.id] = 1;
}
