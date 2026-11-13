import type * as THREE from "three";
import type { Entity, GameCtx, PlayerApi } from "../contracts";

// What the multiplayer layer lends game code for player-vs-player combat. Absent in single player.
export interface PvpHook {
  // The nearest other player along a look ray, within maxDist.
  pick(eye: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { id: number; dist: number } | null;
  // The local player swung at another player. s: attack strength, crit: a falling hit.
  attack(id: number, claim: { s: number; crit: boolean }): void;
  // The local player's sword sweep around a mob it hit (feet position, width, height); the host hurts players beside it.
  sweep?(box: { x: number; y: number; z: number; w: number; h: number }, s: number): void;
  // Host only. Players other than ctx.player that a projectile shot by ctx.player may hit; empty when PvP is off.
  targets?(ctx: GameCtx): PlayerApi[];
  // Host only. A projectile shot by ctx.player hit another player. push is the knockback velocity; arrow carries fire, potion and spectral effects.
  shot?(ctx: GameCtx, target: PlayerApi, amount: number, source: "arrow" | "trident", from: { x: number; y: number; z: number }, push?: { x: number; z: number }, arrow?: Entity): void;
}

export const pvpHook = (ctx: GameCtx): PvpHook | undefined => (ctx as GameCtx & { pvp?: PvpHook }).pvp;

export function setPvpHook(ctx: GameCtx, hook: PvpHook | null) {
  const c = ctx as GameCtx & { pvp?: PvpHook };
  if (hook) c.pvp = hook;
  else delete c.pvp;
}
