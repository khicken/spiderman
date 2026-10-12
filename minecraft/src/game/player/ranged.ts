import type { Effect, Entity, GameCtx, ItemStack } from "../contracts";
import { castBobber, reelBobber } from "../entities/fishing";
import { segmentBody } from "../entities/geom";
import { isMob } from "../entities/registry";
import { fluidAt } from "./physics";
import { POTIONS, ench } from "./stats";
import type { PlayerState } from "./state";
import { damageSlot } from "./survival";
import type { Hand } from "./use";

const ARROWS = ["arrow", "spectral_arrow", "tipped_arrow"];
const near: Entity[] = [];

type Shoot = (p: PlayerState, ctx: GameCtx, type: string, speed: number, inaccuracy: number, data: Record<string, unknown>, yawOffset?: number, pitchOffset?: number) => Entity | null;

const slotOf = (ctx: GameCtx, h: Hand) => (h === "main" ? ctx.inventory.selected : 40);
const creative = (p: PlayerState) => p.gameMode === "creative";
const sound = (ctx: GameCtx, p: PlayerState, name: string, volume = 1, pitch = 1) =>
  ctx.emit({ type: "sound", name, x: p.body.pos.x, y: p.body.pos.y, z: p.body.pos.z, volume, pitch });

export function findAmmo(p: PlayerState, ctx: GameCtx, rockets: boolean): number {
  const inv = ctx.inventory.slots;
  const ok = (s: ItemStack | null | undefined) => !!s && (ARROWS.includes(s.item) || (rockets && s.item === "firework_rocket"));
  if (ok(inv[40])) return 40;
  if (ok(inv[ctx.inventory.selected])) return ctx.inventory.selected;
  for (let i = 0; i < 36; i++) if (inv[i] && ARROWS.includes(inv[i]!.item)) return i;
  return creative(p) ? -2 : -1;
}

function takeAmmo(p: PlayerState, ctx: GameCtx, rockets: boolean, keep: boolean): ItemStack {
  const i = findAmmo(p, ctx, rockets);
  if (i < 0) return { item: "arrow", count: 1 };
  const s = ctx.inventory.slots[i]!;
  if (!creative(p) && !keep) ctx.inventory.setSlot(i, s.count > 1 ? { ...s, count: s.count - 1 } : null);
  return { ...s, count: 1 };
}

// Tipped arrows carry the potion at one eighth of its duration.
function arrowEffects(s: ItemStack): Effect[] | undefined {
  if (s.item !== "tipped_arrow") return undefined;
  const list = POTIONS[String(s.data?.potion ?? "")];
  return list?.map(([id, sec, amp]) => ({ id, amplifier: amp, ticks: Math.max(1, Math.round((sec * 20) / 8)) }));
}

export const bowPower = (ticks: number) => {
  const f = ticks / 20;
  return Math.min(1, (f * f + f * 2) / 3);
};

export function releaseBow(p: PlayerState, ctx: GameCtx, h: Hand, stack: ItemStack, ticks: number, shoot: Shoot): void {
  const f = bowPower(ticks);
  if (f < 0.1) return;
  const infinity = ench(stack, "infinity") > 0;
  const arrow = takeAmmo(p, ctx, false, infinity && arrow0(p, ctx) === "arrow");
  const power = ench(stack, "power");
  shoot(p, ctx, arrow.item === "spectral_arrow" ? "spectral_arrow" : "arrow", f * 3, 1, {
    damage: 2 + (power > 0 ? power * 0.5 + 0.5 : 0),
    crit: f === 1,
    punch: ench(stack, "punch"),
    fire: ench(stack, "flame") > 0,
    item: arrow.item,
    potion: arrow.data?.potion,
    effects: arrowEffects(arrow),
    pickup: creative(p) || (infinity && arrow.item === "arrow") ? 2 : 1,
  });
  if (!creative(p)) damageSlot(ctx, slotOf(ctx, h), 1);
  sound(ctx, p, "entity.arrow.shoot", 1, 1 / (ctx.random() * 0.4 + 1.2) + f * 0.5);
}

function arrow0(p: PlayerState, ctx: GameCtx): string {
  const i = findAmmo(p, ctx, false);
  return i < 0 ? "arrow" : ctx.inventory.slots[i]!.item;
}

export const crossbowCharge = (stack: ItemStack) => Math.max(0, 25 - 5 * ench(stack, "quick_charge"));

export function loadCrossbow(p: PlayerState, ctx: GameCtx, h: Hand, stack: ItemStack): void {
  const multi = ench(stack, "multishot") > 0;
  const first = takeAmmo(p, ctx, true, false);
  const projectiles = multi ? [first.item, first.item, first.item] : [first.item];
  const charged = { ...stack, data: { ...stack.data, charged: true, projectile: first.item, projectiles, potion: first.data?.potion, explosions: first.data?.explosions, flight: first.data?.flight } };
  ctx.inventory.setSlot(slotOf(ctx, h), charged);
  sound(ctx, p, "item.crossbow.loading_end", 1, 1 / (ctx.random() * 0.5 + 1) + 0.2);
}

export function shootCrossbow(p: PlayerState, ctx: GameCtx, h: Hand, stack: ItemStack, shoot: Shoot): void {
  const data = stack.data ?? {};
  const list = Array.isArray(data.projectiles) ? (data.projectiles as string[]) : [String(data.projectile ?? "arrow")];
  const offsets = list.length === 3 ? [0, -10, 10] : [0];
  const pierce = ench(stack, "piercing");
  list.forEach((item, k) => {
    const o = offsets[k] ?? 0;
    const pitch = 1 / (ctx.random() * 0.5 + 1.8) + (k === 0 ? 0.63 : k === 1 ? 0.53 : 0.73);
    if (item === "firework_rocket") {
      shoot(p, ctx, "firework_rocket", 1.6, 1, { shotAtAngle: true, explosions: data.explosions, flight: data.flight }, o);
    } else {
      const tipped = item === "tipped_arrow" ? arrowEffects({ item, count: 1, data: { potion: data.potion } }) : undefined;
      shoot(p, ctx, item === "spectral_arrow" ? "spectral_arrow" : "arrow", 3.15, 1, {
        damage: 2, crit: true, item, potion: data.potion, effects: tipped, pierce, pickup: k === 0 && !creative(p) ? 1 : 2, fromCrossbow: true,
      }, o);
    }
    sound(ctx, p, "item.crossbow.shoot", 1, pitch);
  });
  ctx.inventory.setSlot(slotOf(ctx, h), { ...stack, data: { ...data, charged: false, projectile: undefined, projectiles: undefined, potion: undefined, explosions: undefined, flight: undefined } });
  if (!creative(p)) damageSlot(ctx, slotOf(ctx, h), list.length === 3 ? 3 : 1);
}

const wet = (p: PlayerState, ctx: GameCtx) => {
  const b = p.body;
  if (b.inWater || fluidAt(ctx.world, b.pos.x, b.pos.y, b.pos.z) === "water") return true;
  const x = Math.floor(b.pos.x), y = Math.floor(b.pos.y + b.height), z = Math.floor(b.pos.z);
  return ctx.time.rain > 0.2 && ctx.world.getSkyLight(x, y, z) >= 15 && ctx.world.getBiome(x, z).precipitation === "rain";
};

export const canRiptide = (p: PlayerState, ctx: GameCtx, stack: ItemStack) => ench(stack, "riptide") <= 0 || wet(p, ctx);

// Vanilla TridentItem.releaseUsing: throw at 2.5, or launch the player with Riptide.
export function releaseTrident(p: PlayerState, ctx: GameCtx, h: Hand, stack: ItemStack, ticks: number, shoot: Shoot): void {
  if (ticks < 10) return;
  const rip = ench(stack, "riptide");
  if (rip > 0) {
    if (!wet(p, ctx)) return;
    const c = Math.cos(p.pitch);
    const f5 = 3 * ((1 + rip) / 4);
    const b = p.body;
    b.vel.x += -Math.sin(p.yaw) * c * f5;
    b.vel.y += Math.sin(p.pitch) * f5;
    b.vel.z += -Math.cos(p.yaw) * c * f5;
    p.spinTicks = 20;
    if (b.onGround) b.pos.y += 1.1999999;
    b.fallDistance = 0;
    sound(ctx, p, `item.trident.riptide_${Math.min(3, rip)}`);
    if (!creative(p)) damageSlot(ctx, slotOf(ctx, h), 1);
    return;
  }
  const slot = slotOf(ctx, h);
  if (!creative(p)) damageSlot(ctx, slot, 1);
  const cur = ctx.inventory.slots[slot];
  if (!cur || cur.item !== "trident") return;
  const e = shoot(p, ctx, "trident", 2.5, 1, { item: { ...cur }, damage: 8, slot, pickup: creative(p) ? 2 : 1 });
  if (e && !creative(p)) ctx.inventory.setSlot(slot, null);
  sound(ctx, p, "item.trident.throw");
}

export function tickSpin(p: PlayerState, ctx: GameCtx): void {
  if (p.spinTicks <= 0) return;
  p.spinTicks--;
  const b = p.body;
  ctx.entities.near(b.pos.x, b.pos.y + 0.3, b.pos.z, 2.5, near);
  for (const o of near) {
    if (o.dead || !isMob(o.type)) continue;
    if (segmentBody(b.pos.x, b.pos.y + 0.3, b.pos.z, b.vel.x, b.vel.y, b.vel.z, o.body, 0.6) < 0) continue;
    ctx.entities.damage(o.id, 8, "trident", "player");
    b.vel.multiplyScalar(-0.2);
    p.spinTicks = 0;
    break;
  }
  near.length = 0;
  if (b.onGround && p.spinTicks < 15) p.spinTicks = 0;
}

export function useFishingRod(p: PlayerState, ctx: GameCtx, h: Hand): void {
  const id = Number(p.itemCooldowns.bobber ?? 0);
  const cur = id ? ctx.entities.get(id) : undefined;
  if (cur && !cur.dead && !cur.data._remove) {
    const dmg = reelBobber(cur, ctx);
    p.itemCooldowns.bobber = 0;
    sound(ctx, p, "entity.fishing_bobber.retrieve", 1, 0.4 / (ctx.random() * 0.4 + 0.8));
    if (dmg > 0 && !creative(p)) damageSlot(ctx, slotOf(ctx, h), dmg);
    return;
  }
  const e = castBobber(ctx);
  if (e) p.itemCooldowns.bobber = e.id;
  sound(ctx, p, "entity.fishing_bobber.throw", 0.5, 0.4 / (ctx.random() * 0.4 + 0.8));
}

export function boostRocket(p: PlayerState, ctx: GameCtx, stack: ItemStack): boolean {
  if (!p.fallFlying) return false;
  const b = p.body;
  return !!ctx.entities.spawn("firework_rocket", b.pos.x, b.pos.y + 0.3, b.pos.z, { ...stack.data, attached: "player", owner: "player" });
}
