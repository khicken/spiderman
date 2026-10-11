import type { BlockDef, BlockTextures } from "../contracts";

export type BlockSpec = Partial<Omit<BlockDef, "id">> & { name: string };
export type Props = Omit<BlockSpec, "name">;

export const b = (name: string, p: Props = {}): BlockSpec => ({ name, ...p });
export const tex = (all: string): BlockTextures => ({ all });
export const pillar = (side: string, end: string): BlockTextures => ({ side, end });
export const tsb = (top: string, side: string, bottom: string): BlockTextures => ({ top, side, bottom });

export const STONE: Props = { hardness: 1.5, blastResistance: 6, tool: "pickaxe", toolTier: 0 };
export const SLAB_STONE: Props = { ...STONE, hardness: 2 };
export const PLANT: Props = {
  shape: "cross",
  layer: "cutout",
  solid: false,
  opaque: false,
  hardness: 0,
  blastResistance: 0,
  sound: "plant",
};
export const GLASS: Props = { layer: "cutout", opaque: false, hardness: 0.3, blastResistance: 0.3, sound: "glass", drops: null, silkDrops: true };
export const NO_ITEM: Props = { item: null };

const withTags = (p: Props, extra: string[]): Props => ({ ...p, tags: [...(p.tags ?? []), ...extra] });

export const stairs = (name: string, textures: BlockTextures, mat: Props): BlockSpec => ({
  ...withTags(mat, ["stairs"]),
  name,
  shape: "stairs",
  opaque: false,
  textures,
});

export const slab = (name: string, textures: BlockTextures, mat: Props): BlockSpec => ({
  ...withTags(mat, ["slabs"]),
  name,
  shape: "slab",
  opaque: false,
  textures,
});

export const wall = (name: string, textures: BlockTextures, mat: Props): BlockSpec => ({
  ...withTags(mat, ["walls"]),
  name,
  shape: "wall",
  opaque: false,
  textures,
});

export type Variant = "stairs" | "slab" | "wall";

export function variants(prefix: string, textures: BlockTextures, mat: Props, kinds: Variant[], slabMat: Props = mat): BlockSpec[] {
  const out: BlockSpec[] = [];
  if (kinds.includes("stairs")) out.push(stairs(`${prefix}_stairs`, textures, mat));
  if (kinds.includes("slab")) out.push(slab(`${prefix}_slab`, textures, slabMat));
  if (kinds.includes("wall")) out.push(wall(`${prefix}_wall`, textures, mat));
  return out;
}

export const silk = (drops: BlockSpec["drops"], p: Props = {}): Props => ({ drops, silkDrops: true, ...p });
