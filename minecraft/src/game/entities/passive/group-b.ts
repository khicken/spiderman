import type { MobDef } from "../../contracts";
import { ALLAY } from "./allay";
import { BEE } from "./bee";
import { CAMEL } from "./camel";
import { LLAMA, LLAMA_SPIT, TRADER_LLAMA } from "./llama";
import { SNIFFER } from "./sniffer";
import { SNOW_GOLEM } from "./snow-golem";
import { WANDERING_TRADER } from "./trader";

export const GROUP_B: MobDef[] = [BEE, LLAMA, TRADER_LLAMA, LLAMA_SPIT, WANDERING_TRADER, CAMEL, SNIFFER, ALLAY, SNOW_GOLEM];
