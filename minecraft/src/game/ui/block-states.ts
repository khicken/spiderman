import type { BlockDef, BlockState } from "../contracts";
import { stateOf } from "../contracts";
import { blockByName } from "../blocks/registry";
import { WATERLOGGABLE } from "../blocks/waterlog";

type Fail = (m: string) => never;
type Props = Record<string, string>;

const H: Record<string, number> = { south: 0, west: 1, north: 2, east: 3 };
const F: Record<string, number> = { east: 0, west: 1, up: 2, down: 3, south: 4, north: 5 };
const H_FACE = [4, 1, 5, 0];
const HV = ["north", "south", "west", "east"];
const FV = [...HV, "up", "down"];
const B = ["true", "false"];
const nums = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const on = (v: string | undefined) => v === "true";

interface Fam {
  props: Record<string, string[]>;
  def: Props;
  // meta, or [block name, meta] when the state is a separate block id here.
  enc: (p: Props, name: string) => number | [string, number];
}

const fam = (props: Fam["props"], def: Props, enc: Fam["enc"]): Fam => ({ props, def, enc });
const conn = { north: B, east: B, south: B, west: B };

const AXIS = new Set(["basalt", "polished_basalt", "quartz_pillar", "purpur_pillar", "hay_block", "bone_block", "deepslate", "infested_deepslate", "ochre_froglight", "verdant_froglight", "pearlescent_froglight", "muddy_mangrove_roots", "chain", "bamboo_block", "stripped_bamboo_block"]);
const ROD = new Set(["end_rod", "lightning_rod"]);
const FRONT6 = new Set(["dispenser", "dropper", "piston", "sticky_piston", "barrel", "crafter", "observer"]);
const TOWARD_H = new Set(["end_portal_frame", "lectern", "stonecutter", "grindstone", "bell", "decorated_pot", "vault", "calibrated_sculk_sensor", "anvil", "chipped_anvil", "damaged_anvil", "cocoa", "ladder", "tripwire_hook"]);
const FURNACES = new Set(["furnace", "blast_furnace", "smoker"]);
const FRONT_CUBES = new Set([...FURNACES, "carved_pumpkin", "jack_o_lantern", "loom", "beehive", "bee_nest", "chiseled_bookshelf"]);
// Our separate block ids for vanilla block states.
export const INTERNAL = /^(lit_|unlit_)|_upper$|^powered_(repeater|comparator)$|^inverted_daylight_detector$/;
const LIT = new Set(["redstone_lamp", "redstone_ore", "deepslate_redstone_ore"]);
const AGE: Record<string, number> = { wheat: 7, carrots: 7, potatoes: 7, beetroots: 3, nether_wart: 3, sweet_berry_bush: 3, melon_stem: 7, pumpkin_stem: 7, torchflower_crop: 1, pitcher_crop: 4, cactus: 15, sugar_cane: 15, frosted_ice: 3, chorus_flower: 5, bamboo: 1 };
const DEFAULT_FACE: Record<string, string> = { observer: "south", end_rod: "up", lightning_rod: "up", hopper: "down" };
const EXTRA: Record<string, Record<string, string[]>> = {
  piston: { extended: B }, sticky_piston: { extended: B }, observer: { powered: B }, dispenser: { triggered: B }, dropper: { triggered: B }, barrel: { open: B },
  crafter: { crafting: B, triggered: B }, lectern: { has_book: B, powered: B }, end_portal_frame: { eye: B }, bell: { attachment: ["floor", "ceiling", "single_wall", "double_wall"], powered: B },
  grindstone: { face: ["floor", "wall", "ceiling"] }, tripwire_hook: { attached: B, powered: B }, calibrated_sculk_sensor: { power: nums(0, 15), sculk_sensor_phase: ["inactive", "active", "cooldown"] },
  vault: { ominous: B, vault_state: ["inactive", "active", "unlocking", "ejecting"] }, decorated_pot: { cracked: B }, beehive: { honey_level: nums(0, 5) }, bee_nest: { honey_level: nums(0, 5) },
  chiseled_bookshelf: Object.fromEntries(nums(0, 5).map((i) => [`slot_${i}_occupied`, B])),
};

function familyOf(d: BlockDef): Fam | null {
  const n = d.name;
  const tags = d.tags ?? [];
  const wall = n.includes("wall_");
  switch (d.shape) {
    case "stairs": return fam({ facing: HV, half: ["top", "bottom"], shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] }, { facing: "north", half: "bottom" }, (p) => H[p.facing] | (p.half === "top" ? 4 : 0));
    case "slab": return fam({ type: ["top", "bottom", "double"] }, { type: "bottom" }, (p) => ({ bottom: 0, top: 1, double: 2 })[p.type]!);
    case "door": return fam({ facing: HV, half: ["upper", "lower"], hinge: ["left", "right"], open: B, powered: B }, { facing: "north", half: "lower", hinge: "left", open: "false" }, (p) =>
      p.half === "upper" ? 8 | (p.hinge === "right" ? 1 : 0) | (on(p.open) ? 4 : 0) : H[p.facing] | (on(p.open) ? 4 : 0));
    case "trapdoor": return fam({ facing: HV, half: ["top", "bottom"], open: B, powered: B }, { facing: "north", half: "bottom", open: "false" }, (p) => H[p.facing] | (on(p.open) ? 4 : 0) | (p.half === "top" ? 8 : 0));
    case "fence_gate": return fam({ facing: HV, open: B, in_wall: B, powered: B }, { facing: "north", open: "false" }, (p) => H[p.facing] | (on(p.open) ? 4 : 0));
    case "bed": return fam({ facing: HV, part: ["head", "foot"], occupied: B }, { facing: "north", part: "foot" }, (p) => H[p.facing] | (p.part === "head" ? 4 : 0));
    case "fence":
    case "pane": return fam(conn, {}, () => 0);
    case "wall": return fam({ up: B, north: ["none", "low", "tall"], east: ["none", "low", "tall"], south: ["none", "low", "tall"], west: ["none", "low", "tall"] }, {}, () => 0);
    case "chest": return fam({ facing: HV, type: ["single", "left", "right"] }, { facing: "north", type: "single" }, (p) => H_FACE[H[p.facing]] | (p.type === "left" ? 8 : 0));
    case "hopper": return fam({ facing: ["down", ...HV], enabled: B }, { facing: "down" }, (p) => F[p.facing]);
    case "snow_layer": return fam({ layers: nums(1, 8) }, { layers: "1" }, (p) => Number(p.layers) - 1);
    case "redstone_wire": return fam({ power: nums(0, 15), north: ["none", "side", "up"], east: ["none", "side", "up"], south: ["none", "side", "up"], west: ["none", "side", "up"] }, { power: "0" }, (p) => Number(p.power));
    case "fluid": return fam({ level: nums(0, 15) }, { level: "0" }, (p) => Math.min(8, Number(p.level)));
    case "lantern": return fam({ hanging: B }, { hanging: "false" }, (p) => (on(p.hanging) ? 1 : 0));
    case "campfire": return fam({ facing: HV, lit: B, signal_fire: B }, { facing: "north", lit: "true" }, (p) => H[p.facing] | (on(p.lit) ? 0 : 4));
    case "repeater": {
      const base = n.replace(/^powered_/, "");
      return fam({ facing: HV, delay: nums(1, 4), locked: B, powered: B }, { facing: "north", delay: "1", powered: "false" }, (p) => [on(p.powered) ? `powered_${base}` : base, H[p.facing] | ((Number(p.delay) - 1) << 2)]);
    }
    case "comparator": {
      const base = n.replace(/^powered_/, "");
      return fam({ facing: HV, mode: ["compare", "subtract"], powered: B }, { facing: "north", powered: "false" }, (p) => [on(p.powered) ? `powered_${base}` : base, H[p.facing]]);
    }
    case "lever":
    case "button": return fam({ face: ["floor", "wall", "ceiling"], facing: HV, powered: B }, { face: "wall", facing: "north", powered: "false" }, (p) => (p.face === "floor" ? 2 : p.face === "ceiling" ? 3 : H_FACE[H[p.facing]]) | (on(p.powered) ? 8 : 0));
    case "torch": {
      const redstone = n.includes("redstone");
      const base = n.replace(/^unlit_/, "");
      const props: Fam["props"] = wall ? { facing: HV } : {};
      if (redstone) props.lit = B;
      return fam(props, { facing: "north", lit: "true" }, (p) => [redstone && !on(p.lit) ? `unlit_${base}` : base, wall ? H[p.facing] + 1 : 0]);
    }
    case "crop": return fam({ age: nums(0, AGE[n] ?? 7) }, { age: "0" }, (p) => Number(p.age));
    case "sign":
      return wall ? fam({ facing: HV }, { facing: "north" }, (p) => H[p.facing]) : fam({ rotation: nums(0, 15) }, { rotation: "0" }, (p) => Number(p.rotation));
  }
  if (tags.includes("logs") || AXIS.has(n)) return fam({ axis: ["x", "y", "z"] }, { axis: "y" }, (p) => ({ y: 0, x: 1, z: 2 })[p.axis]!);
  if (ROD.has(n)) return fam({ facing: FV, ...(n === "lightning_rod" ? { powered: B } : {}) }, { facing: "up" }, (p) => (p.facing === "up" || p.facing === "down" ? 0 : p.facing === "east" || p.facing === "west" ? 1 : 2));
  if (FRONT6.has(n) || n.endsWith("shulker_box") || n.endsWith("amethyst_bud") || n === "amethyst_cluster") return fam({ facing: FV, ...EXTRA[n] }, { facing: DEFAULT_FACE[n] ?? (FRONT6.has(n) ? "north" : "up") }, (p) => F[p.facing]);
  if (FRONT_CUBES.has(n) || n.endsWith("glazed_terracotta")) return fam({ facing: HV, ...(FURNACES.has(n) ? { lit: B } : {}), ...EXTRA[n] }, { facing: "north", lit: "false" }, (p) => [on(p.lit) ? `lit_${n}` : n, H_FACE[H[p.facing]]]);
  if (TOWARD_H.has(n) || (wall && (n.endsWith("_banner") || n.endsWith("_head") || n.endsWith("_skull") || n.endsWith("_fan") || n.endsWith("hanging_sign")))) {
    const extra = { ...EXTRA[n], ...(n === "cocoa" ? { age: nums(0, 2) } : {}) };
    return fam({ facing: HV, ...extra }, { facing: "north" }, (p) => H[p.facing]);
  }
  if (n.endsWith("_banner") || n.endsWith("_head") || n.endsWith("_skull") || (tags.includes("hanging_signs") && !wall)) return fam({ rotation: nums(0, 15) }, { rotation: "0" }, (p) => Number(p.rotation));
  if (n === "cactus" || n === "sugar_cane") return fam({ age: nums(0, 15) }, { age: "0" }, (p) => Number(p.age));
  if (tags.includes("leaves")) return fam({ persistent: B, distance: nums(1, 7) }, { persistent: "false" }, (p) => (on(p.persistent) ? 1 : 0));
  if (tags.includes("candles")) return fam({ candles: nums(1, 4), lit: B }, { candles: "1", lit: "false" }, (p) => (Number(p.candles) - 1) | (on(p.lit) ? 4 : 0));
  if (tags.includes("candle_cakes")) return fam({ lit: B }, { lit: "false" }, (p) => (on(p.lit) ? 1 : 0));
  if (n === "respawn_anchor") return fam({ charges: nums(0, 4) }, { charges: "0" }, (p) => Number(p.charges));
  if (LIT.has(n) || n.endsWith("copper_bulb")) return fam({ lit: B, ...(n.endsWith("copper_bulb") ? { powered: B } : {}) }, { lit: "false" }, (p) => [on(p.lit) ? `lit_${n}` : n, 0]);
  if (blockByName(`${n}_upper`)) return fam({ half: ["upper", "lower"] }, { half: "lower" }, (p) => [p.half === "upper" ? `${n}_upper` : n, 0]);
  if (n === "daylight_detector") return fam({ inverted: B, power: nums(0, 15) }, { inverted: "false" }, (p) => [on(p.inverted) ? `inverted_${n}` : n, 0]);
  if (d.shape === "rail") return fam({ shape: ["north_south", "east_west", "ascending_east", "ascending_west", "ascending_north", "ascending_south", "south_east", "south_west", "north_west", "north_east"], ...(n === "rail" ? {} : { powered: B }) }, {}, () => 0);
  if (d.shape === "pressure_plate") return fam(n.includes("weighted") ? { power: nums(0, 15) } : { powered: B }, {}, () => 0);
  return null;
}

export interface ParsedBlock {
  def: BlockDef;
  state: BlockState;
  waterlogged: boolean | undefined;
  props: Props; // only the properties the player typed
}

/** Vanilla BlockStateParser: "minecraft:oak_stairs[facing=east,half=top]". */
export function parseBlockState(input: string, fail: Fail): ParsedBlock {
  const m = /^((?:minecraft:)?[a-z0-9_]+)(\[.*)?$/.exec(input.toLowerCase());
  if (!m) return fail(`Unknown block type '${input}'`);
  const name = m[1].replace(/^minecraft:/, "");
  const full = `minecraft:${name}`;
  const def = blockByName(name);
  if (!def || INTERNAL.test(name)) return fail(`Unknown block type '${full}'`);
  const props: Props = {};
  if (m[2]) {
    if (!m[2].endsWith("]")) return fail("Expected closing ] for block state properties");
    const body = m[2].slice(1, -1).trim();
    for (const kv of body ? body.split(",") : []) {
      const [k, v] = kv.split("=").map((x) => x?.trim());
      if (!k) return fail(`Expected value for property '' on block ${full}`);
      if (k in props) return fail(`Property '${k}' can only be set once for block ${full}`);
      if (v === undefined || v === "") return fail(`Expected value for property '${k}' on block ${full}`);
      props[k] = v;
    }
  }
  const f = familyOf(def);
  const allowed: Record<string, string[]> = { ...(f?.props ?? {}) };
  if (WATERLOGGABLE[def.id]) allowed.waterlogged = B;
  for (const [k, v] of Object.entries(props)) {
    if (!allowed[k]) return fail(`Block ${full} does not have property '${k}'`);
    if (!allowed[k].includes(v)) return fail(`Block ${full} does not accept '${v}' for ${k} property`);
  }
  let state = stateOf(def.id, 0);
  if (f) {
    const r = f.enc({ ...f.def, ...props }, def.name);
    const [bn, meta] = typeof r === "number" ? [def.name, r] : r;
    const bd = blockByName(bn) ?? def;
    state = stateOf(bd.id, meta & 15);
  }
  return { def, state, waterlogged: props.waterlogged === undefined ? undefined : on(props.waterlogged), props };
}

/** Property names and values for suggestions after "name[". */
export function blockStateProps(name: string): Record<string, string[]> {
  const def = blockByName(name.replace(/^minecraft:/, ""));
  if (!def) return {};
  const out = { ...(familyOf(def)?.props ?? {}) };
  if (WATERLOGGABLE[def.id]) out.waterlogged = B;
  return out;
}
