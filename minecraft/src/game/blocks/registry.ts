import type { BlockDef, BlockState } from "../contracts";
import { idOf } from "../contracts";
import { BLOCK_DATA, type BlockSpec } from "./data";

// Ids follow BLOCK_DATA order, so save files depend on it. Append new blocks at the end.
const DEFAULTS: Omit<BlockDef, "id" | "name" | "displayName"> = {
  shape: "cube",
  textures: {},
  layer: "opaque",
  solid: true,
  opaque: true,
  lightEmission: 0,
  lightFilter: 15,
  hardness: 1,
  blastResistance: 1,
  sound: "stone",
};

const titleCase = (n: string) => n.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

export const BLOCKS: BlockDef[] = BLOCK_DATA.map((spec: BlockSpec, id) => {
  const d: BlockDef = { ...DEFAULTS, displayName: titleCase(spec.name), ...spec, id };
  if (!d.textures.all && !d.textures.side && !d.textures.top && d.shape !== "air") d.textures = { all: d.name };
  if (!d.opaque && spec.lightFilter === undefined) d.lightFilter = d.layer === "translucent" ? 1 : 0;
  return d;
});

const BY_NAME = new Map(BLOCKS.map((b) => [b.name, b]));
const warned = new Set<string>();

export function blockId(name: string): number {
  const b = BY_NAME.get(name);
  if (b) return b.id;
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`unknown block: ${name}`);
  }
  return 0;
}

export const hasBlock = (name: string) => BY_NAME.has(name);
export const blockDef = (s: BlockState): BlockDef => BLOCKS[idOf(s)] ?? BLOCKS[0];
export const blockByName = (name: string): BlockDef | undefined => BY_NAME.get(name);

// Hot-path tables indexed by block id.
export const OPAQUE = new Uint8Array(4096);
export const SOLID = new Uint8Array(4096);
export const LIGHT_EMIT = new Uint8Array(4096);
export const LIGHT_FILTER = new Uint8Array(4096);
export const IS_FLUID = new Uint8Array(4096);
for (const b of BLOCKS) {
  OPAQUE[b.id] = b.opaque ? 1 : 0;
  SOLID[b.id] = b.solid ? 1 : 0;
  LIGHT_EMIT[b.id] = b.lightEmission;
  LIGHT_FILTER[b.id] = b.opaque ? 15 : b.lightFilter;
  IS_FLUID[b.id] = b.shape === "fluid" ? 1 : 0;
}

// Light by full state (id | meta << 12): lit candles, unlit campfires and active sculk sensors depend on meta.
export const STATE_EMIT = new Uint8Array(65536);
for (let s = 0; s < 65536; s++) STATE_EMIT[s] = LIGHT_EMIT[s & 0xfff];
for (const b of BLOCKS) {
  const tags = b.tags ?? [];
  for (let m = 0; m < 16; m++) {
    const s = b.id | (m << 12);
    if (tags.includes("candles")) STATE_EMIT[s] = m & 4 ? 3 * ((m & 3) + 1) : 0;
    else if (tags.includes("candle_cakes")) STATE_EMIT[s] = m & 1 ? 3 : 0;
    else if (b.shape === "campfire") STATE_EMIT[s] = m & 4 ? 0 : b.lightEmission;
    else if (b.name === "sculk_sensor" || b.name === "calibrated_sculk_sensor") STATE_EMIT[s] = m & 4 ? 1 : 0;
    else if (b.name === "respawn_anchor") STATE_EMIT[s] = [0, 3, 7, 11, 15][Math.min(m, 4)];
  }
}

export const hasTag = (s: BlockState, tag: string) => blockDef(s).tags?.includes(tag) ?? false;
