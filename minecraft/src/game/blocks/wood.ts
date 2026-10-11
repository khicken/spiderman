import type { SoundGroup, Tint } from "../contracts";
import { WOOD_TYPES, type WoodType } from "./names";
import { b, NO_ITEM, pillar, PLANT, silk, slab, stairs, tex, type BlockSpec, type Props } from "./spec";

const NETHER = (w: WoodType) => w === "crimson" || w === "warped";

const sound = (w: WoodType): SoundGroup => (w === "cherry" ? "cherry_wood" : w === "bamboo" ? "bamboo_wood" : "wood");

const leafTint = (w: WoodType): Tint => (w === "birch" ? "birch" : w === "spruce" ? "spruce" : w === "cherry" ? null : "foliage");

const sapling = (w: WoodType) => (w === "mangrove" ? "mangrove_propagule" : `${w}_sapling`);

function logs(w: WoodType, mat: Props): BlockSpec[] {
  const tags = ["logs", ...(NETHER(w) ? [] : ["logs_that_burn"])];
  if (w === "bamboo") {
    return [
      b("bamboo_block", { ...mat, textures: pillar("bamboo_block", "bamboo_block_top"), tags }),
      b("stripped_bamboo_block", { ...mat, textures: pillar("stripped_bamboo_block", "stripped_bamboo_block_top"), tags }),
    ];
  }
  const log = NETHER(w) ? `${w}_stem` : `${w}_log`;
  const wood = NETHER(w) ? `${w}_hyphae` : `${w}_wood`;
  return [
    b(log, { ...mat, textures: pillar(log, `${log}_top`), tags }),
    b(`stripped_${log}`, { ...mat, textures: pillar(`stripped_${log}`, `stripped_${log}_top`), tags }),
    b(wood, { ...mat, textures: tex(log), tags }),
    b(`stripped_${wood}`, { ...mat, textures: tex(`stripped_${log}`), tags }),
  ];
}

function leaves(w: WoodType): BlockSpec[] {
  if (NETHER(w) || w === "bamboo") return [];
  const drops = [
    ...(w === "mangrove" ? [] : [{ item: sapling(w), chance: w === "jungle" ? 0.025 : 0.05 }]),
    { item: "stick", count: [1, 2] as [number, number], chance: 0.02 },
    ...(w === "oak" || w === "dark_oak" ? [{ item: "apple", chance: 0.005 }] : []),
  ];
  return [leaf(`${w}_leaves`, leafTint(w), drops)];
}

export function leaf(name: string, tint: Tint, drops: BlockSpec["drops"]): BlockSpec {
  return b(name, {
    layer: "cutout", opaque: false, lightFilter: 1, hardness: 0.2, blastResistance: 0.2, tool: "hoe", sound: "grass",
    flammable: true, tint, ...silk(drops), tags: ["leaves", "sword_efficient"],
  });
}

function sapl(w: WoodType): BlockSpec[] {
  if (w === "bamboo") return [];
  if (NETHER(w)) return [b(`${w}_fungus`, { ...PLANT, tags: ["fungi"] })];
  return [b(sapling(w), { ...PLANT, tags: ["saplings"] })];
}

function woodType(w: WoodType): BlockSpec[] {
  const s = sound(w);
  const fl = !NETHER(w);
  const log: Props = { hardness: 2, blastResistance: 2, tool: "axe", sound: s, flammable: fl };
  const plank: Props = { hardness: 2, blastResistance: 3, tool: "axe", sound: s, flammable: fl };
  const planks = `${w}_planks`;
  const pt = tex(planks);
  const thin: Props = { opaque: false, ...plank };
  const out: BlockSpec[] = [
    ...logs(w, log),
    b(planks, { ...plank, tags: ["planks"] }),
    stairs(`${w}_stairs`, pt, { ...plank, tags: ["wooden_stairs"] }),
    slab(`${w}_slab`, pt, { ...plank, tags: ["wooden_slabs"] }),
  ];
  if (w === "bamboo") {
    out.push(
      b("bamboo_mosaic", plank),
      stairs("bamboo_mosaic_stairs", tex("bamboo_mosaic"), plank),
      slab("bamboo_mosaic_slab", tex("bamboo_mosaic"), plank),
    );
  }
  out.push(
    b(`${w}_fence`, { ...thin, shape: "fence", textures: pt, tags: ["fences", "wooden_fences"] }),
    b(`${w}_fence_gate`, { ...thin, shape: "fence_gate", textures: pt, tags: ["fence_gates"] }),
    b(`${w}_door`, {
      ...thin, hardness: 3, blastResistance: 3, shape: "door", layer: "cutout",
      textures: { top: `${w}_door_top`, bottom: `${w}_door_bottom` }, tags: ["doors", "wooden_doors"],
    }),
    b(`${w}_trapdoor`, { ...thin, hardness: 3, blastResistance: 3, shape: "trapdoor", layer: "cutout", textures: tex(`${w}_trapdoor`), tags: ["trapdoors", "wooden_trapdoors"] }),
    b(`${w}_button`, { ...thin, solid: false, hardness: 0.5, blastResistance: 0.5, shape: "button", textures: pt, tags: ["buttons", "wooden_buttons"] }),
    b(`${w}_pressure_plate`, { ...thin, solid: false, hardness: 0.5, blastResistance: 0.5, shape: "pressure_plate", textures: pt, tags: ["pressure_plates", "wooden_pressure_plates"] }),
    b(`${w}_sign`, { ...thin, solid: false, hardness: 1, blastResistance: 1, shape: "sign", textures: pt, tags: ["signs", "standing_signs"] }),
    b(`${w}_wall_sign`, { ...thin, solid: false, hardness: 1, blastResistance: 1, shape: "sign", textures: pt, ...NO_ITEM, drops: `${w}_sign`, tags: ["signs", "wall_signs"] }),
    b(`${w}_hanging_sign`, { ...thin, solid: false, hardness: 1, blastResistance: 1, shape: "custom", textures: tex(`stripped_${logName(w)}`), tags: ["hanging_signs"] }),
    b(`${w}_wall_hanging_sign`, {
      ...thin, solid: false, hardness: 1, blastResistance: 1, shape: "custom", ...NO_ITEM, drops: `${w}_hanging_sign`,
      textures: tex(`stripped_${logName(w)}`), tags: ["hanging_signs", "wall_hanging_signs"],
    }),
    ...leaves(w),
    ...sapl(w),
  );
  return out;
}

const logName = (w: WoodType) => (w === "bamboo" ? "bamboo_block" : NETHER(w) ? `${w}_stem` : `${w}_log`);

const extras: BlockSpec[] = [
  leaf("azalea_leaves", null, [{ item: "azalea", chance: 0.05 }, { item: "stick", count: [1, 2], chance: 0.02 }]),
  leaf("flowering_azalea_leaves", null, [{ item: "flowering_azalea", chance: 0.05 }, { item: "stick", count: [1, 2], chance: 0.02 }]),
  b("mangrove_roots", { layer: "cutout", opaque: false, lightFilter: 1, hardness: 0.7, blastResistance: 0.7, tool: "axe", sound: "wood", flammable: true, textures: pillar("mangrove_roots_side", "mangrove_roots_top") }),
  b("muddy_mangrove_roots", { hardness: 0.7, blastResistance: 0.7, tool: "shovel", sound: "mud", textures: pillar("muddy_mangrove_roots_side", "muddy_mangrove_roots_top") }),
];

export const WOOD_BLOCKS: BlockSpec[] = [...WOOD_TYPES.flatMap(woodType), ...extras];
