import type * as THREE from "three";
import type { DamageSource, Entity, GameCtx, PlayerApi } from "../contracts";
import type { MotionState } from "./motion";

export interface UseState {
  item: string;
  hand: "main" | "off";
  ticks: number;
  total: number; // ticks to finish, or 72000 for charge items
  kind: "eat" | "drink" | "bow" | "crossbow" | "trident" | "shield" | "spyglass" | "horn" | "brush";
}

export interface PlayerState extends PlayerApi {
  ctx: () => GameCtx;
  motion: MotionState;
  prevPos: THREE.Vector3;
  prevYaw: number;
  prevPitch: number;
  bodyYaw: number;
  prevBodyYaw: number;
  absorption: number;
  fireTicks: number;
  frozenTicks: number;
  invulnerable: number;
  lastHurt: number;
  hurtTime: number;
  hurtDir: number;
  foodTimer: number;
  lastFall: number;
  lastSource: DamageSource;
  lastAttacker: string | undefined;
  deathMessage: string;
  swingTime: number;
  swinging: boolean;
  swingOff: boolean; // the last swing used the offhand
  attackAnim: number;
  prevAttackAnim: number;
  attackTicker: number;
  using: UseState | null;
  blocking: boolean;
  crossbowLoaded: boolean;
  itemCooldowns: Record<string, number>;
  walkDist: number;
  prevWalkDist: number;
  bob: number;
  prevBob: number;
  moveDist: number;
  nextStep: number;
  eyeHeight: number;
  prevEyeHeight: number;
  fovMod: number;
  prevFovMod: number;
  sprintCooldown: number;
  ticks: number;
  deathTime: number;
  lastLevelUp: number;
  wasInWater: boolean;
  sensitivity: number;
  invertY: boolean;
  fov: number;
  addEffect(id: string, amplifier: number, ticks: number): void;
  hasEffect(id: string): number; // amplifier + 1, 0 when absent
  removeEffect(id: string): void;
  swing(): void;
  attackedBy: Entity | undefined;
  swimming: boolean;
  fallFlying: boolean;
  fallFlyTicks: number;
  spinTicks: number; // riptide spin attack
  shieldCooldown: number; // ticks the shield stays disabled after an axe hit
  totemTicks: number; // totem animation, counts down from 40
  prevJump: boolean;
  lastDeath: { x: number; y: number; z: number; dim: string } | null;
  remote?: { damage(amount: number, source: DamageSource, attacker?: Entity): void; exhaust(v: number): void }; // multiplayer client: the host owns health and hunger
}

export const effectLevel = (p: { effects: { id: string; amplifier: number }[] }, id: string): number => {
  for (const e of p.effects) if (e.id === id) return e.amplifier + 1;
  return 0;
};
