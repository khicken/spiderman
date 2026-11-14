import type { ItemSpec } from "./data";
import { DYES } from "./data-misc";

export const HARNESSES = DYES.map((c) => `${c}_harness`);
export const isHarness = (item: string | undefined) => !!item && HARNESSES.includes(item);

export const GHAST_ITEMS: ItemSpec[] = HARNESSES.map((name) => ({ name, maxStack: 1 }));
