import { woodType } from "./wood";
import { b, PLANT, pillar, silk, tex, variants, type BlockSpec, type Props } from "./spec";

// Pale garden content (Java 1.21.4/1.21.5). Appended after every other family, so existing save ids do not move.

const RESIN_BRICKS: Props = { hardness: 1.5, blastResistance: 6, tool: "pickaxe", toolTier: 0, sound: "resin_bricks" };
const FLOWER: Props = { ...PLANT, flammable: true, tags: ["flowers", "small_flowers", "sword_efficient"] };

export const PALE_GARDEN_BLOCKS: BlockSpec[] = [
  ...woodType("pale_oak"),
  b("pale_moss_block", { hardness: 0.1, blastResistance: 0.1, tool: "hoe", sound: "grass", flammable: true, tags: ["dirt"] }),
  b("pale_moss_carpet", { shape: "carpet", opaque: false, hardness: 0.1, blastResistance: 0.1, tool: "hoe", sound: "grass", flammable: true, textures: tex("pale_moss_carpet") }),
  // Meta 0 is the tip (texture pale_hanging_moss_tip), meta 1 a middle piece with more moss below.
  b("pale_hanging_moss", { ...PLANT, replaceable: true, flammable: true, tool: "shears", textures: tex("pale_hanging_moss_tip"), tags: ["replaceable_plants", "sword_efficient"] }),
  b("closed_eyeblossom", FLOWER),
  b("open_eyeblossom", { ...FLOWER, emissiveTexture: true }),
  b("resin_clump", { ...PLANT, shape: "vine", replaceable: true, hardness: 0, blastResistance: 0, sound: "resin" }),
  b("resin_block", { hardness: 0, blastResistance: 0, sound: "resin" }),
  b("resin_bricks", RESIN_BRICKS),
  ...variants("resin_brick", tex("resin_bricks"), RESIN_BRICKS, ["stairs", "slab", "wall"]),
  b("chiseled_resin_bricks", RESIN_BRICKS),
  // Meta: bits 0-1 axis (0 y, 1 x, 2 z), bits 2-3 state (0 uprooted, 1 dormant, 2 awake). Block entity "creaking_heart".
  b("creaking_heart", {
    hardness: 10, blastResistance: 10, tool: "axe", sound: "creaking_heart",
    textures: pillar("creaking_heart", "creaking_heart_top"),
    ...silk([{ item: "resin_clump", count: [1, 3] }]),
  }),
];
