import type { BlockBehavior } from "../contracts";
import { BLOCKS } from "../blocks/registry";
import { BASE_BEHAVIORS } from "./base";
import { wrapUse } from "./interact";
import { mergeBuild } from "./golem-build";
import { BUBBLE_BEHAVIORS, chainBehavior } from "./bubble";
import { mergeRedstone, REDSTONE_BEHAVIORS } from "./redstone";

export { defaultBoxes, outlineBoxes, shapeBoxes } from "./shapes";
export { growTree } from "./trees";
export { findPortal, lightPortal } from "./portal";

function build(): Record<string, BlockBehavior> {
  const base: Record<string, BlockBehavior> = { ...BASE_BEHAVIORS };
  for (const [name, r] of Object.entries(REDSTONE_BEHAVIORS)) base[name] = { ...base[name], ...r };
  const merged = mergeBuild(mergeRedstone(base));
  for (const [name, r] of Object.entries(BUBBLE_BEHAVIORS)) merged[name] = chainBehavior(merged[name], r);
  for (const b of BLOCKS) if (b.shape !== "air") merged[b.name] = { ...merged[b.name], use: wrapUse(merged[b.name]?.use) };
  return merged;
}

// Every block gets an entry, because held items (bone meal, flint and steel, tools) act on any block.
export const BEHAVIORS: Record<string, BlockBehavior> = build();
