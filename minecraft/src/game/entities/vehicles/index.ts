import type { MobDef } from "../../contracts";
import { BOAT, CHEST_BOAT } from "./boat";
import { MINECARTS } from "./minecart";

export const VEHICLES: MobDef[] = [BOAT, CHEST_BOAT, ...MINECARTS];
