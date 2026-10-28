import type { MobDef } from "../../contracts";
import { ARMADILLO_DEF } from "./armadillo";
import { BREEZE } from "./breeze";
import { CREEPER } from "./creeper";
import { END_MOBS } from "./dragon";
import { ENDERMAN } from "./enderman";
import { NETHER_MOBS } from "./nether";
import { PHANTOM } from "./phantom";
import { ILLAGERS } from "./pillager";
import { ILLUSIONER } from "./illusioner";
import { PUFFERFISH } from "./pufferfish";
import { BUGS } from "./silverfish";
import { SKELETONS } from "./skeleton";
import { SLIMES } from "./slime";
import { SPIDERS } from "./spider";
import { WITCH_MOBS } from "./witch";
import { ZOMBIES } from "./zombie";

export const HOSTILE_MOBS: MobDef[] = [
  ...ZOMBIES,
  ...SKELETONS,
  CREEPER,
  ...SPIDERS,
  ENDERMAN,
  ...SLIMES,
  PHANTOM,
  ...BUGS,
  ...WITCH_MOBS,
  ...NETHER_MOBS,
  ...END_MOBS,
  BREEZE,
  ARMADILLO_DEF,
  ...ILLAGERS,
  ILLUSIONER,
  PUFFERFISH,
];

export { createHostileWorld, isSlimeChunk, type HostileWorld } from "./world";
export { applyPotion, POTIONS } from "./witch";
export { infestedBase } from "./silverfish";
export { barterLoot } from "./nether";
