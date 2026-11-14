import type { MobDef } from "../../contracts";
import { HAPPY_GHAST_DEF } from "./happy-ghast";
import { COPPER_GOLEM_DEF } from "./copper-golem";
import { NAUTILUS_DEF } from "./nautilus";
import { CREAKING_DEF } from "../hostile/creaking";
import { GIANT_DEF } from "../hostile/giant";
import { CAMEL_HUSK_DEF } from "../hostile/camel-husk";
import { PARCHED_DEF } from "../hostile/parched";
import { ZOMBIE_NAUTILUS_DEF } from "../hostile/zombie-nautilus";

// Mobs added in Java 1.21.2 to 1.21.11, plus the giant.
export const GROUP_E: MobDef[] = [
  HAPPY_GHAST_DEF, COPPER_GOLEM_DEF, NAUTILUS_DEF, CREAKING_DEF, GIANT_DEF, CAMEL_HUSK_DEF, PARCHED_DEF, ZOMBIE_NAUTILUS_DEF,
];
