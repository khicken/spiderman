import { setMobLists } from "./registry";
import { HOSTILE_MOBS } from "./hostile";
import { PASSIVE_MOBS } from "./passive";
import { GROUP_A } from "./passive/group-a";
import { GROUP_B } from "./passive/group-b";
import { GROUP_C } from "./hostile/group-c";
import { GROUP_D } from "./hostile/group-d";
import { VEHICLES } from "./vehicles";
import { EYE_OF_ENDER } from "../systems/end/eye";
import { HANGING_MOBS } from "./decor/hanging";
import { LIGHTNING_BOLT } from "../systems/features/lightning";
import { ARMOR_STAND } from "../systems/features/armor-stand";

setMobLists((defs) => {
  for (const d of PASSIVE_MOBS) defs.set(d.type, d);
  for (const d of HOSTILE_MOBS) defs.set(d.type, d);
  for (const d of [...GROUP_A, ...GROUP_B, ...GROUP_C, ...GROUP_D, ...VEHICLES]) defs.set(d.type, d);
  defs.set(EYE_OF_ENDER.type, EYE_OF_ENDER);
  for (const d of HANGING_MOBS) defs.set(d.type, d);
  defs.set(LIGHTNING_BOLT.type, LIGHTNING_BOLT);
  if (!defs.has(ARMOR_STAND.type)) defs.set(ARMOR_STAND.type, ARMOR_STAND);
});
