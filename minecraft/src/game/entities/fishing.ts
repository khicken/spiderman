import * as THREE from "three";
import type { Entity, GameCtx, ItemStack } from "../contracts";
import { IS_FLUID, blockByName, blockDef } from "../blocks/registry";
import { idOf, metaOf } from "../contracts";
import { segmentBody } from "./geom";
import { isMob } from "./registry";
import { advTrigger } from "../systems/advancements/bus";

const scratch: Entity[] = [];
const origin = new THREE.Vector3();
const dir = new THREE.Vector3();

const ench = (s: ItemStack | null | undefined, id: string) => s?.ench?.[id] ?? 0;
const rodStack = (ctx: GameCtx) => {
  const inv = ctx.inventory;
  const main = inv.slots[inv.selected];
  if (main?.item === "fishing_rod") return main;
  const off = inv.slots[40];
  return off?.item === "fishing_rod" ? off : null;
};

function waterAt(ctx: GameCtx, x: number, y: number, z: number): number {
  const s = ctx.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  const id = idOf(s);
  if (!IS_FLUID[id] || id === LAVA) return 0;
  const m = metaOf(s);
  return m === 0 || m >= 8 ? 8 / 9 : (8 - m) / 9;
}

const LAVA = blockByName("lava")?.id ?? -1;

// Vanilla FishingHook constructor: launched from the eye along the look, speed about 0.6.
export function castBobber(ctx: GameCtx): Entity | null {
  const p = ctx.player;
  const hx = -Math.sin(p.yaw), hz = -Math.cos(p.yaw);
  const e = p.eye();
  const x = e.x + hx * 0.3, y = e.y, z = e.z + hz * 0.3;
  let vx = hx, vy = Math.max(-5, Math.min(5, Math.tan(p.pitch))), vz = hz;
  const len = Math.hypot(vx, vy, vz);
  const tri = () => 0.6 / len + (ctx.random() - ctx.random()) * 0.5 * 0.0103365;
  vx *= tri();
  vy *= tri();
  vz *= tri();
  const b = ctx.entities.spawn("fishing_bobber", x, y, z, { owner: "player", vel: [vx, vy, vz] });
  if (!b) return null;
  const rod = rodStack(ctx);
  b.data.lure = ench(rod, "lure");
  b.data.luck = ench(rod, "luck_of_the_sea") + (p.effects.find((f) => f.id === "luck") ? 1 : 0);
  return b;
}

export function tickBobber(e: Entity, ctx: GameCtx): void {
  const b = e.body;
  const p = ctx.player;
  const rod = rodStack(ctx);
  const dx = p.body.pos.x - b.pos.x, dy = p.body.pos.y - b.pos.y, dz = p.body.pos.z - b.pos.z;
  if (p.dead || !rod || dx * dx + dy * dy + dz * dz > 1024) {
    e.data._remove = true;
    return;
  }
  const hooked = typeof e.data.hooked === "number" ? ctx.entities.get(e.data.hooked) : undefined;
  if (hooked) {
    if (hooked.dead) e.data.hooked = undefined;
    else {
      b.pos.set(hooked.body.pos.x, hooked.body.pos.y + hooked.body.height * 0.8, hooked.body.pos.z);
      return;
    }
  }
  const h = waterAt(ctx, b.pos.x, b.pos.y, b.pos.z);
  const inWater = h > 0 && b.pos.y - Math.floor(b.pos.y) <= h;
  if (inWater) {
    e.data.state = "bobbing";
    const surface = Math.floor(b.pos.y) + h;
    let d0 = b.pos.y + b.vel.y - surface;
    if (Math.abs(d0) < 0.01) d0 += Math.sign(d0) * 0.1;
    b.vel.set(b.vel.x * 0.9, b.vel.y - d0 * ctx.random() * 0.2, b.vel.z * 0.9);
    catching(e, ctx, surface);
  } else {
    if (e.data.state === "bobbing") e.data.state = "flying";
    if (!e.data.inGround && e.data.state !== "bobbing") hitEntity(e, ctx);
    if (!e.data.inGround) b.vel.y -= 0.03;
  }
  if (e.data.inGround) {
    b.vel.set(0, 0, 0);
    return;
  }
  const len = b.vel.length();
  if (len > 1e-6) {
    origin.copy(b.pos);
    dir.copy(b.vel).divideScalar(len);
    const hit = ctx.world.raycast(origin, dir, len, false);
    if (hit && blockDef(hit.state).solid) {
      b.pos.copy(hit.point).addScaledVector(dir, -0.05);
      b.vel.set(0, 0, 0);
      e.data.inGround = true;
      return;
    }
  }
  b.pos.add(b.vel);
  b.vel.multiplyScalar(0.92);
}

function hitEntity(e: Entity, ctx: GameCtx): void {
  const b = e.body;
  ctx.entities.near(b.pos.x, b.pos.y, b.pos.z, b.vel.length() + 2, scratch);
  for (const o of scratch) {
    if (o === e || o.dead || !isMob(o.type)) continue;
    const t = segmentBody(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, o.body, 0.3);
    if (t >= 0 && t <= 1) {
      e.data.hooked = o.id;
      ctx.entities.damage(o.id, 0, "player", "player");
      break;
    }
  }
  scratch.length = 0;
}

function openWater(ctx: GameCtx, x: number, y: number, z: number): boolean {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  for (let yy = -1; yy <= 2; yy++)
    for (let xx = -2; xx <= 2; xx++)
      for (let zz = -2; zz <= 2; zz++) {
        const s = ctx.world.getBlock(bx + xx, by + yy, bz + zz);
        if (yy <= 0 ? !(IS_FLUID[idOf(s)] && metaOf(s) === 0) : s !== 0) return false;
      }
  return true;
}

// Vanilla FishingHook.catchingFish: lure wait, fish approach, then a 20-40 tick bite window.
function catching(e: Entity, ctx: GameCtx, surface: number): void {
  const b = e.body;
  const r = ctx.random;
  const sky = ctx.world.getSkyLight(Math.floor(b.pos.x), Math.floor(b.pos.y) + 1, Math.floor(b.pos.z)) >= 15;
  let step = 1;
  if (r() < 0.25 && ctx.time.rain > 0.2 && sky) step++;
  if (r() < 0.5 && !sky) step--;
  let nibble = Number(e.data.nibble ?? 0);
  let hooked = Number(e.data.hookIn ?? 0);
  let lured = e.data.luredIn as number | undefined;
  if (nibble > 0) {
    nibble--;
    if (nibble <= 0) {
      e.data.luredIn = undefined;
      e.data.hookIn = 0;
    }
    e.data.nibble = nibble;
    if (nibble > 0) b.vel.y -= 0.2 * r() * r();
    return;
  }
  if (hooked > 0) {
    hooked -= step;
    e.data.hookIn = hooked;
    const angle = Number(e.data.fishAngle ?? 0) + (r() - r()) * 0.4;
    e.data.fishAngle = angle;
    if (hooked > 0) {
      const dist = hooked * 0.1;
      const fx = b.pos.x + Math.sin(angle) * dist, fz = b.pos.z + Math.cos(angle) * dist;
      if (r() < 0.15) ctx.emit({ type: "particles", kind: "bubble", x: fx, y: surface - 0.1, z: fz, count: 1 });
      ctx.emit({ type: "particles", kind: "splash", x: fx, y: surface, z: fz, count: 1 });
    } else {
      ctx.emit({ type: "sound", name: "entity.fishing_bobber.splash", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 0.25, pitch: 1 + (r() - r()) * 0.4 });
      ctx.emit({ type: "particles", kind: "bubble", x: b.pos.x, y: surface, z: b.pos.z, count: 8 });
      ctx.emit({ type: "particles", kind: "splash", x: b.pos.x, y: surface, z: b.pos.z, count: 10 });
      b.vel.y -= 0.4 * (r() * 0.5 + 0.5);
      e.data.nibble = 20 + Math.floor(r() * 21);
    }
    return;
  }
  if (lured === undefined) lured = 100 + Math.floor(r() * 501) - Number(e.data.lure ?? 0) * 100;
  lured -= step;
  if (lured <= 0) {
    e.data.fishAngle = r() * Math.PI * 2;
    e.data.hookIn = 20 + Math.floor(r() * 61);
    e.data.luredIn = undefined;
    return;
  }
  e.data.luredIn = lured;
}

type Roll = [string, number, (ctx: GameCtx) => ItemStack];
const one = (item: string) => () => ({ item, count: 1 });
const damaged = (item: string, max: number) => (ctx: GameCtx) => ({ item, count: 1, damage: Math.floor(max * (0.1 + ctx.random() * 0.8)) });

const FISH: Roll[] = [["cod", 60, one("cod")], ["salmon", 25, one("salmon")], ["tropical_fish", 2, one("tropical_fish")], ["pufferfish", 13, one("pufferfish")]];
const JUNK: Roll[] = [
  ["lily_pad", 17, one("lily_pad")], ["leather_boots", 10, damaged("leather_boots", 65)], ["leather", 10, one("leather")], ["bone", 10, one("bone")],
  ["potion", 10, () => ({ item: "potion", count: 1, data: { potion: "water" } })], ["string", 5, one("string")], ["fishing_rod", 2, damaged("fishing_rod", 64)],
  ["bowl", 10, one("bowl")], ["stick", 5, one("stick")], ["ink_sac", 1, () => ({ item: "ink_sac", count: 10 })], ["tripwire_hook", 10, one("tripwire_hook")], ["rotten_flesh", 10, one("rotten_flesh")],
];
const BOOK_ENCH = ["protection", "sharpness", "efficiency", "unbreaking", "power", "fortune", "looting", "feather_falling", "respiration", "mending", "lure", "luck_of_the_sea"];
const TREASURE: Roll[] = [
  ["bow", 1, (ctx) => ({ item: "bow", count: 1, damage: Math.floor(384 * ctx.random() * 0.25), ench: { power: 1 + Math.floor(ctx.random() * 4), unbreaking: 1 + Math.floor(ctx.random() * 3) } })],
  ["enchanted_book", 1, (ctx) => ({ item: "enchanted_book", count: 1, ench: { [BOOK_ENCH[Math.floor(ctx.random() * BOOK_ENCH.length)]]: 1 + Math.floor(ctx.random() * 3) } })],
  ["fishing_rod", 1, (ctx) => ({ item: "fishing_rod", count: 1, damage: Math.floor(64 * ctx.random() * 0.25), ench: { lure: 1 + Math.floor(ctx.random() * 3), luck_of_the_sea: 1 + Math.floor(ctx.random() * 3) } })],
  ["name_tag", 1, one("name_tag")], ["nautilus_shell", 1, one("nautilus_shell")], ["saddle", 1, one("saddle")],
];

function pick(list: Roll[], ctx: GameCtx): ItemStack {
  let total = 0;
  for (const r of list) total += r[1];
  let k = ctx.random() * total;
  for (const r of list) if ((k -= r[1]) < 0) return r[2](ctx);
  return list[0][2](ctx);
}

// Vanilla gameplay/fishing: junk 10 - 2 luck, treasure 5 + 2 luck (open water only), fish 85 - luck.
export function fishingLoot(ctx: GameCtx, luck: number, open: boolean): { stack: ItemStack; xp: number } {
  const junk = Math.max(0, 10 - 2 * luck), treasure = open ? 5 + 2 * luck : 0, fish = Math.max(0, 85 - luck);
  const k = ctx.random() * (junk + treasure + fish);
  const stack = k < fish ? pick(FISH, ctx) : k < fish + junk ? pick(JUNK, ctx) : pick(TREASURE, ctx);
  return { stack, xp: 1 + Math.floor(ctx.random() * 6) };
}

// Reel in. Returns rod damage like vanilla retrieve(): 1 catch, 5 hooked mob, 2 in the ground.
export function reelBobber(e: Entity, ctx: GameCtx): number {
  const p = ctx.player;
  const b = e.body;
  e.data._remove = true;
  const hooked = typeof e.data.hooked === "number" ? ctx.entities.get(e.data.hooked) : undefined;
  if (hooked && !hooked.dead) {
    hooked.body.vel.x += (p.body.pos.x - hooked.body.pos.x) * 0.1;
    hooked.body.vel.y += (p.body.pos.y - hooked.body.pos.y) * 0.1;
    hooked.body.vel.z += (p.body.pos.z - hooked.body.pos.z) * 0.1;
    return 5;
  }
  if (Number(e.data.nibble ?? 0) > 0) {
    const loot = fishingLoot(ctx, Number(e.data.luck ?? 0), openWater(ctx, b.pos.x, b.pos.y, b.pos.z));
    const dx = p.body.pos.x - b.pos.x, dy = p.body.pos.y - b.pos.y, dz = p.body.pos.z - b.pos.z;
    const d = Math.hypot(dx, dy, dz);
    const item = ctx.entities.spawn("item", b.pos.x, b.pos.y, b.pos.z, { stack: loot.stack, pickupDelay: 0 });
    advTrigger({ t: "fished", item: loot.stack.item });
    item?.body.vel.set(dx * 0.1, dy * 0.1 + Math.sqrt(d) * 0.08, dz * 0.1);
    ctx.entities.dropXp(loot.xp, p.body.pos.x, p.body.pos.y + 0.5, p.body.pos.z + 0.5);
    return 1;
  }
  return e.data.inGround ? 2 : 0;
}
