import type { Rules } from "../contracts";

// Vanilla 1.21.0 game rules with their defaults.
export const GAMERULES: Record<string, boolean | number> = {
  announceAdvancements: true,
  blockExplosionDropDecay: true,
  commandBlockOutput: true,
  commandModificationBlockLimit: 32768,
  disableElytraMovementCheck: false,
  disableRaids: false,
  doDaylightCycle: true,
  doEntityDrops: true,
  doFireTick: true,
  doImmediateRespawn: false,
  doInsomnia: true,
  doLimitedCrafting: false,
  doMobLoot: true,
  doMobSpawning: true,
  doPatrolSpawning: true,
  doTileDrops: true,
  doTraderSpawning: true,
  doVinesSpread: true,
  doWardenSpawning: true,
  doWeatherCycle: true,
  drowningDamage: true,
  enderPearlsVanishOnDeath: true,
  fallDamage: true,
  fireDamage: true,
  forgiveDeadPlayers: true,
  freezeDamage: true,
  globalSoundEvents: true,
  keepInventory: false,
  lavaSourceConversion: false,
  logAdminCommands: true,
  maxCommandChainLength: 65536,
  maxCommandForkCount: 65536,
  maxEntityCramming: 24,
  mobExplosionDropDecay: true,
  mobGriefing: true,
  naturalRegeneration: true,
  playersSleepingPercentage: 100,
  projectilesCanBreakBlocks: true,
  randomTickSpeed: 3,
  reducedDebugInfo: false,
  sendCommandFeedback: true,
  showDeathMessages: true,
  snowAccumulationHeight: 1,
  spawnChunkRadius: 2,
  spawnRadius: 10,
  spectatorsGenerateChunks: true,
  tntExplosionDropDecay: false,
  universalAnger: false,
  waterSourceConversion: true,
};

const MIN: Record<string, number> = { spawnChunkRadius: 0 };
const MAX: Record<string, number> = { spawnChunkRadius: 32 };
export const ruleMin = (name: string) => MIN[name] ?? -2147483648;
export const ruleMax = (name: string) => MAX[name] ?? 2147483647;

export const RULE_NAMES = Object.keys(GAMERULES).sort();

// Worlds saved before a rule existed fall back to its default.
export function getRule(rules: Rules, name: string): boolean | number {
  const v = (rules as unknown as Record<string, unknown>)[name];
  return typeof v === typeof GAMERULES[name] ? (v as boolean | number) : GAMERULES[name];
}

export function setRule(rules: Rules, name: string, v: boolean | number) {
  (rules as unknown as Record<string, unknown>)[name] = v;
}
