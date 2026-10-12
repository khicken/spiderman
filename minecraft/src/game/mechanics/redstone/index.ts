import type { BlockBehavior } from "../../contracts";
import { BLOCKS } from "../../blocks/registry";
import { BULB_NAMES, COPPER_BULB_BEHAVIOR, LAMP_BEHAVIOR, NOTE_BLOCK_BEHAVIOR, TNT_BEHAVIOR } from "./consumers";
import { COMPARATOR_BEHAVIOR, REPEATER_BEHAVIOR } from "./diode";
import { CRAFTER_BEHAVIOR, DISPENSER_BEHAVIOR, DROPPER_BEHAVIOR, HOPPER_BEHAVIOR } from "./machines";
import { OBSERVER_BEHAVIOR } from "./observer";
import { HEAD_BEHAVIOR, PISTON_BEHAVIOR } from "./piston";
import {
  buttonBehavior, DAYLIGHT_BEHAVIOR, LEVER_BEHAVIOR, LIGHTNING_ROD_BEHAVIOR, plateBehavior, REDSTONE_BLOCK_BEHAVIOR, TARGET_BEHAVIOR,
} from "./sources";
import { TORCH_BEHAVIOR, TORCH_NAMES } from "./torch";
import { WIRE_BEHAVIOR } from "./wire";

export const REDSTONE_BEHAVIORS: Record<string, BlockBehavior> = {
  redstone_wire: WIRE_BEHAVIOR,
  repeater: REPEATER_BEHAVIOR,
  powered_repeater: REPEATER_BEHAVIOR,
  comparator: COMPARATOR_BEHAVIOR,
  powered_comparator: COMPARATOR_BEHAVIOR,
  lever: LEVER_BEHAVIOR,
  target: TARGET_BEHAVIOR,
  daylight_detector: DAYLIGHT_BEHAVIOR,
  inverted_daylight_detector: DAYLIGHT_BEHAVIOR,
  redstone_block: REDSTONE_BLOCK_BEHAVIOR,
  lightning_rod: LIGHTNING_ROD_BEHAVIOR,
  observer: OBSERVER_BEHAVIOR,
  redstone_lamp: LAMP_BEHAVIOR,
  lit_redstone_lamp: LAMP_BEHAVIOR,
  note_block: NOTE_BLOCK_BEHAVIOR,
  tnt: TNT_BEHAVIOR,
  piston: PISTON_BEHAVIOR,
  sticky_piston: PISTON_BEHAVIOR,
  piston_head: HEAD_BEHAVIOR,
  sticky_piston_head: HEAD_BEHAVIOR,
  dispenser: DISPENSER_BEHAVIOR,
  dropper: DROPPER_BEHAVIOR,
  crafter: CRAFTER_BEHAVIOR,
  hopper: HOPPER_BEHAVIOR,
};
for (const n of TORCH_NAMES) REDSTONE_BEHAVIORS[n] = TORCH_BEHAVIOR;
for (const n of BULB_NAMES) REDSTONE_BEHAVIORS[n] = COPPER_BULB_BEHAVIOR;
for (const b of BLOCKS) {
  if (b.shape === "button") REDSTONE_BEHAVIORS[b.name] = buttonBehavior(b.name);
  else if (b.shape === "pressure_plate") REDSTONE_BEHAVIORS[b.name] = plateBehavior(b.name);
}

export { isPowered, receivedPower, strongPowerTo, signalFrom, signalInto } from "./power";
export { REDSTONE_EXTRAS, mergeRedstone } from "./extras";
export { analogOutput, containerChanged } from "./inventory";
export { crafterCraft } from "./machines";
export { hitTarget, strikeLightningRod, daylightPower } from "./sources";
export { primeTnt, playNote } from "./consumers";
export { wireSides } from "./wire";
export { isPushable, PUSH_LIMIT } from "./piston";
