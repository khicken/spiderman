import type { ItemDef } from "../contracts";
import { FOOD_ITEMS } from "./data-food";
import { GEAR_ITEMS } from "./data-gear";
import { MISC_ITEMS } from "./data-misc";
import { GHAST_ITEMS } from "./data-ghast";

export type ItemSpec = Partial<Omit<ItemDef, "id">> & { name: string };

export const ITEM_DATA: ItemSpec[] = [...GEAR_ITEMS, ...FOOD_ITEMS, ...MISC_ITEMS, ...GHAST_ITEMS];
