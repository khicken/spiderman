import { COPPER_STAGES } from "./names";
import { b, slab, stairs, tex, type BlockSpec, type Props } from "./spec";

const COPPER: Props = { hardness: 3, blastResistance: 6, tool: "pickaxe", toolTier: 1, sound: "copper" };
const BULB_LIGHT = [15, 12, 8, 4];

function stage(s: string, i: number, waxed: boolean): BlockSpec[] {
  const w = waxed ? "waxed_" : "";
  const block = s === "" ? "copper_block" : `${s}copper`;
  const tags = waxed ? ["waxed_copper"] : ["oxidizable"];
  const mat: Props = { ...COPPER, tags };
  const cut = tex(`${s}cut_copper`);
  return [
    b(waxed ? `waxed_${block}` : block, { ...mat, textures: tex(block) }),
    b(`${w}${s}cut_copper`, { ...mat, textures: cut }),
    stairs(`${w}${s}cut_copper_stairs`, cut, mat),
    slab(`${w}${s}cut_copper_slab`, cut, mat),
    b(`${w}${s}chiseled_copper`, { ...mat, textures: tex(`${s}chiseled_copper`) }),
    b(`${w}${s}copper_grate`, { ...mat, opaque: false, layer: "cutout", textures: tex(`${s}copper_grate`) }),
    b(`${w}${s}copper_bulb`, { ...mat, textures: tex(`${s}copper_bulb`) }),
    b(`lit_${w}${s}copper_bulb`, { ...mat, lightEmission: BULB_LIGHT[i], item: `${w}${s}copper_bulb`, drops: `${w}${s}copper_bulb`, textures: tex(`${s}copper_bulb_lit`), emissiveTexture: true }),
    b(`${w}${s}copper_door`, {
      ...mat, shape: "door", opaque: false, layer: "cutout",
      textures: { top: `${s}copper_door_top`, bottom: `${s}copper_door_bottom` }, tags: [...tags, "doors"],
    }),
    b(`${w}${s}copper_trapdoor`, { ...mat, shape: "trapdoor", opaque: false, layer: "cutout", textures: tex(`${s}copper_trapdoor`), tags: [...tags, "trapdoors"] }),
  ];
}

export const COPPER_BLOCKS: BlockSpec[] = [
  ...COPPER_STAGES.flatMap((s, i) => stage(s, i, false)),
  ...COPPER_STAGES.flatMap((s, i) => stage(s, i, true)),
  b("lightning_rod", { ...COPPER, shape: "chain", opaque: false, layer: "cutout", textures: tex("lightning_rod") }),
];
