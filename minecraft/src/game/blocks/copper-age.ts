import { COPPER_STAGES } from "./names";
import { b, NO_ITEM, tex, type BlockSpec, type Props } from "./spec";

const THIN: Props = { opaque: false, layer: "cutout" };
const tagsFor = (waxed: boolean, extra: string[]) => [waxed ? "waxed_copper" : "oxidizable", ...extra];

function stage(s: string, waxed: boolean): BlockSpec[] {
  const w = waxed ? "waxed_" : "";
  return [
    b(`${w}${s}copper_golem_statue`, {
      ...THIN, shape: "custom", hardness: 3, blastResistance: 6, tool: "pickaxe", sound: "copper",
      textures: tex(`${s}copper_golem_statue`), tags: tagsFor(waxed, ["copper_golem_statues"]),
    }),
    b(`${w}${s}copper_lantern`, {
      ...THIN, shape: "lantern", hardness: 3.5, blastResistance: 3.5, tool: "pickaxe", toolTier: 0, lightEmission: 15, sound: "lantern",
      textures: tex(`${s}copper_lantern`), tags: tagsFor(waxed, ["lanterns"]),
    }),
    b(`${w}${s}copper_bars`, {
      ...THIN, shape: "pane", hardness: 5, blastResistance: 6, tool: "pickaxe", toolTier: 0, sound: "copper",
      textures: { side: `${s}copper_bars`, top: `${s}copper_bars` }, tags: tagsFor(waxed, ["bars"]),
    }),
    b(`${w}${s}copper_chain`, {
      ...THIN, shape: "chain", hardness: 5, blastResistance: 6, tool: "pickaxe", toolTier: 0, sound: "chain",
      textures: tex(`${s}copper_chain`), tags: tagsFor(waxed, ["chains"]),
    }),
  ];
}

const TORCH: Props = { shape: "torch", solid: false, ...THIN, hardness: 0, blastResistance: 0, sound: "wood", lightEmission: 14 };

export const COPPER_AGE_BLOCKS: BlockSpec[] = [
  b("copper_torch", TORCH),
  b("copper_wall_torch", { ...TORCH, ...NO_ITEM, drops: "copper_torch", textures: tex("copper_torch") }),
  ...COPPER_STAGES.flatMap((s) => stage(s, false)),
  ...COPPER_STAGES.flatMap((s) => stage(s, true)),
];
