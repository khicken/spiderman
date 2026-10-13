import * as THREE from "three";
import type { Aabb, BlockDef, BlockState, Entity, GameCtx, ItemStack, PlaceInfo, RaycastHit } from "../contracts";
import { AIR, Face, MAX_Y, MIN_Y, idOf, metaOf, stateOf } from "../contracts";
import { blockByName, blockDef, blockId, hasBlock } from "../blocks/registry";
import { IMPLICIT_WATER, canHoldWater } from "../blocks/waterlog";
import { itemDef } from "../items/registry";
import type { InputApi } from "./input";
import { blockBoxes } from "./interact";
import { bodyBox, intersects } from "./physics";
import { POTIONS, STEW_EFFECTS, ench } from "./stats";
import { damageSlot, eat } from "./survival";
import type { PlayerState, UseState } from "./state";
import { boostRocket, canRiptide, crossbowCharge, findAmmo, loadCrossbow, releaseBow, releaseTrident, shootCrossbow, useFishingRod } from "./ranged";
import { collectBreath } from "../systems/brewing/effects";
import { advTrigger } from "../systems/advancements/bus";
import { advEntityUse } from "../systems/advancements/hooks";
import { tickBrush } from "../systems/features/archaeology";
import { useEmptyMap } from "../systems/features/maps";

export type Hand = "main" | "off";
const FACE_DIR: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const DRINKS = new Set(["potion", "milk_bucket", "honey_bottle", "ominous_bottle"]);
const CONTAINERS: Record<string, string> = {
  mushroom_stew: "bowl", rabbit_stew: "bowl", beetroot_soup: "bowl", suspicious_stew: "bowl",
  potion: "glass_bottle", honey_bottle: "glass_bottle", milk_bucket: "bucket",
};
const THROWN: Record<string, { type: string; speed: number; sound: string; cooldown?: number; pitchOffset?: number }> = {
  snowball: { type: "snowball", speed: 1.5, sound: "entity.snowball.throw" },
  egg: { type: "egg", speed: 1.5, sound: "entity.egg.throw" },
  ender_pearl: { type: "ender_pearl", speed: 1.5, sound: "entity.ender_pearl.throw", cooldown: 20 },
  wind_charge: { type: "wind_charge", speed: 1.5, sound: "entity.wind_charge.throw", cooldown: 10 },
  splash_potion: { type: "potion", speed: 0.5, sound: "entity.splash_potion.throw", pitchOffset: -20 },
  lingering_potion: { type: "potion", speed: 0.5, sound: "entity.lingering_potion.throw", pitchOffset: -20 },
  experience_bottle: { type: "experience_bottle", speed: 0.7, sound: "entity.experience_bottle.throw", pitchOffset: -20 },
  ender_eye: { type: "eye_of_ender", speed: 0.5, sound: "entity.ender_eye.launch" },
};
const ARMOR_SLOT = { head: 36, chest: 37, legs: 38, feet: 39 } as const;
const STRIPPABLE = /^(.*)_(log|wood|stem|hyphae|block)$/;
const TILLABLE = new Set(["grass_block", "dirt", "dirt_path"]);
const FLATTENABLE = new Set(["grass_block", "dirt", "podzol", "mycelium", "coarse_dirt", "rooted_dirt"]);
const COPPER_STAGES = ["exposed_", "weathered_", "oxidized_"];

const vel = new THREE.Vector3();
const dir = new THREE.Vector3();
const eyeV = new THREE.Vector3();
const near: Entity[] = [];
const pbox: Aabb = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
const ebox: Aabb = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
const cbox: Aabb = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
const NON_BLOCKING = new Set(["item", "xp_orb", "arrow", "spectral_arrow", "trident", "snowball", "egg", "ender_pearl", "potion", "experience_bottle", "fishing_bobber", "wind_charge", "eye_of_ender", "firework_rocket", "lightning_bolt"]);

const slotOf = (ctx: GameCtx, h: Hand) => (h === "main" ? ctx.inventory.selected : 40);
const stackOf = (ctx: GameCtx, h: Hand) => ctx.inventory.slots[slotOf(ctx, h)] ?? null;
const creative = (p: PlayerState) => p.gameMode === "creative";

function sound(ctx: GameCtx, name: string, x: number, y: number, z: number, volume = 1, pitch = 1) {
  ctx.emit({ type: "sound", name, x, y, z, volume, pitch });
}

function consume(p: PlayerState, ctx: GameCtx, h: Hand, n = 1) {
  if (creative(p)) return;
  const i = slotOf(ctx, h);
  const s = ctx.inventory.slots[i];
  if (!s) return;
  ctx.inventory.setSlot(i, s.count > n ? { ...s, count: s.count - n } : null);
}

function exchange(p: PlayerState, ctx: GameCtx, h: Hand, result: ItemStack) {
  if (creative(p)) {
    if (!ctx.inventory.slots.some((s) => s?.item === result.item)) ctx.inventory.add(result);
    return;
  }
  const i = slotOf(ctx, h);
  const s = ctx.inventory.slots[i];
  if (!s || s.count <= 1) {
    ctx.inventory.setSlot(i, result);
    return;
  }
  ctx.inventory.setSlot(i, { ...s, count: s.count - 1 });
  const rest = ctx.inventory.add(result);
  if (rest) ctx.entities.dropItem(rest, p.body.pos.x, p.body.pos.y + 1.3, p.body.pos.z);
}

const horizontalFacing = (yaw: number) => [2, 1, 0, 3][((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4];

function defaultPlace(def: BlockDef, info: PlaceInfo, s: BlockState): BlockState {
  const id = idOf(s);
  if (def.shape === "slab") return stateOf(id, info.face === Face.Down || (info.face !== Face.Up && info.hitY > 0.5) ? 1 : 0);
  if (def.shape === "stairs") {
    const top = info.face === Face.Down || (info.face !== Face.Up && info.hitY > 0.5);
    return stateOf(id, horizontalFacing(info.yaw) | (top ? 4 : 0));
  }
  if (def.textures.end || def.tags?.includes("logs")) {
    const axis = info.face === Face.East || info.face === Face.West ? 1 : info.face === Face.South || info.face === Face.North ? 2 : 0;
    return stateOf(id, axis);
  }
  return s;
}

function blocked(p: PlayerState, ctx: GameCtx, st: BlockState, x: number, y: number, z: number): boolean {
  if (!blockDef(st).solid) return false;
  const boxes = blockBoxes(ctx, st, x, y, z);
  if (!boxes.length) return false;
  if (p.gameMode !== "spectator") bodyBox(p.body, pbox);
  ctx.entities.near(x + 0.5, y + 0.5, z + 0.5, 3, near);
  for (const b of boxes) {
    cbox.minX = b.minX + x; cbox.maxX = b.maxX + x; cbox.minY = b.minY + y; cbox.maxY = b.maxY + y; cbox.minZ = b.minZ + z; cbox.maxZ = b.maxZ + z;
    if (p.gameMode !== "spectator" && intersects(cbox, pbox)) return true;
    for (const e of near) {
      if (e.dead || NON_BLOCKING.has(e.type)) continue;
      if (intersects(cbox, bodyBox(e.body, ebox))) return true;
    }
  }
  return false;
}

// Candles, sea pickles and turtle eggs keep a count of 1-4 in meta bits 0-1.
const STACKED = /(^|_)candle$|^sea_pickle$|^turtle_egg$/;

export function placeBlock(p: PlayerState, ctx: GameCtx, h: Hand, stack: ItemStack, hit: RaycastHit): boolean {
  if (p.gameMode === "adventure") return false;
  const it = itemDef(stack.item);
  const placed = blockByName(it?.block ?? stack.item);
  if (!placed || placed.shape === "air") return false;
  const w = ctx.world;
  const id = placed.id;
  let { x, y, z } = hit;
  const clicked = hit.state;
  let st: BlockState | null = null;
  const m = metaOf(clicked);
  if (placed.shape === "slab" && idOf(clicked) === id && ((m === 0 && hit.face === Face.Up) || (m === 1 && hit.face === Face.Down))) st = stateOf(id, 2);
  else if (placed.shape === "snow_layer" && idOf(clicked) === id && m < 7) st = stateOf(id, m + 1);
  else if (STACKED.test(placed.name) && idOf(clicked) === id && (m & 3) < 3) st = stateOf(id, m + 1);
  if (st === null) {
    if (!blockDef(clicked).replaceable || idOf(clicked) === id) {
      const d = FACE_DIR[hit.face];
      x += d[0]; y += d[1]; z += d[2];
    }
    const cur = w.getBlock(x, y, z);
    if (placed.shape === "slab" && idOf(cur) === id && metaOf(cur) !== 2) st = stateOf(id, 2);
    else if (placed.shape === "snow_layer" && idOf(cur) === id && metaOf(cur) < 7) st = stateOf(id, metaOf(cur) + 1);
    else if (cur !== AIR && !blockDef(cur).replaceable) return false;
  }
  if (y < MIN_Y || y > MAX_Y) return false;
  if (st === null) {
    const info: PlaceInfo = {
      face: hit.face,
      hitX: hit.point.x - hit.x,
      hitY: hit.point.y - hit.y,
      hitZ: hit.point.z - hit.z,
      yaw: p.yaw,
      pitch: p.pitch,
      sneaking: p.sneaking,
    };
    const beh = ctx.behaviors[placed.name];
    const def0 = stateOf(id);
    st = beh?.place ? beh.place(ctx, x, y, z, info, def0) : defaultPlace(placed, info, def0);
    if (st === null) return false;
  }
  const surv = ctx.behaviors[blockDef(st).name]?.canSurvive;
  if (surv && !surv(ctx, x, y, z, st)) return false;
  if (blocked(p, ctx, st, x, y, z)) return false;
  if (!w.setBlock(x, y, z, st)) return false;
  sound(ctx, `block.${blockDef(st).sound}.place`, x + 0.5, y + 0.5, z + 0.5, 1, 0.8);
  consume(p, ctx, h);
  advTrigger({ t: "placed_block", block: blockDef(st).name, x, y, z });
  return true;
}

function adjacent(hit: RaycastHit, out: [number, number, number]): [number, number, number] {
  const d = FACE_DIR[hit.face];
  if (blockDef(hit.state).replaceable) out.splice(0, 3, hit.x, hit.y, hit.z);
  else out.splice(0, 3, hit.x + d[0], hit.y + d[1], hit.z + d[2]);
  return out;
}
const cell: [number, number, number] = [0, 0, 0];

function convert(p: PlayerState, ctx: GameCtx, h: Hand, hit: RaycastHit, to: string, snd: string, damage = true): boolean {
  if (!hasBlock(to)) return false;
  advTrigger({ t: "item_used_on_block", item: stackOf(ctx, h)?.item ?? "", block: blockDef(hit.state).name, to, x: hit.x, y: hit.y, z: hit.z });
  ctx.world.setBlock(hit.x, hit.y, hit.z, stateOf(blockId(to), metaOf(hit.state)));
  sound(ctx, snd, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  if (damage) {
    if (!creative(p)) damageSlot(ctx, slotOf(ctx, h), 1);
  } else consume(p, ctx, h);
  return true;
}

function useOn(p: PlayerState, ctx: GameCtx, h: Hand, stack: ItemStack, hit: RaycastHit, triedBlock: boolean): boolean {
  const name = stack.item;
  const w = ctx.world;
  const def = blockDef(hit.state);
  const tool = itemDef(name)?.tool;
  const above = w.getBlock(hit.x, hit.y + 1, hit.z);
  if (!triedBlock && name === "bone_meal") {
    const beh = ctx.behaviors[def.name];
    if (beh?.use?.(ctx, hit.x, hit.y, hit.z, hit.state, stack)) return true;
  }
  if (p.gameMode === "adventure") return false;
  if (name.endsWith("_spawn_egg")) {
    adjacent(hit, cell);
    const e = ctx.entities.spawn(name.slice(0, -"_spawn_egg".length), cell[0] + 0.5, cell[1], cell[2] + 0.5);
    if (e) e.yaw = p.yaw + Math.PI;
    consume(p, ctx, h);
    return true;
  }
  if (name === "flint_and_steel" || name === "fire_charge") {
    adjacent(hit, cell);
    if (w.getBlock(cell[0], cell[1], cell[2]) !== AIR || !hasBlock("fire")) return false;
    const fire = stateOf(blockId(w.getBlock(cell[0], cell[1] - 1, cell[2]) !== AIR && blockDef(w.getBlock(cell[0], cell[1] - 1, cell[2])).tags?.includes("soul_fire_base_blocks") ? "soul_fire" : "fire"));
    w.setBlock(cell[0], cell[1], cell[2], fire);
    sound(ctx, name === "fire_charge" ? "item.firecharge.use" : "item.flintandsteel.use", cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5, 1, ctx.random() * 0.4 + 0.8);
    if (name === "fire_charge") consume(p, ctx, h);
    else if (!creative(p)) damageSlot(ctx, slotOf(ctx, h), 1);
    return true;
  }
  if (name === "water_bucket" || name === "lava_bucket" || name === "powder_snow_bucket" || (name.endsWith("_bucket") && name !== "milk_bucket" && name !== "bucket")) {
    const watery = name !== "lava_bucket" && name !== "powder_snow_bucket";
    if (watery && w.dim !== "nether" && canHoldWater(hit.state) && w.setWaterlogged?.(hit.x, hit.y, hit.z, true)) {
      if (name !== "water_bucket") ctx.entities.spawn(name.slice(0, -"_bucket".length), hit.x + 0.5, hit.y, hit.z + 0.5);
      sound(ctx, name !== "water_bucket" ? "item.bucket.empty_fish" : "item.bucket.empty", hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      if (!creative(p)) ctx.inventory.setSlot(slotOf(ctx, h), { item: "bucket", count: 1 });
      return true;
    }
    adjacent(hit, cell);
    const cur = w.getBlock(cell[0], cell[1], cell[2]);
    if (cur !== AIR && !blockDef(cur).replaceable) return false;
    const [cx, cy, cz] = cell;
    if (name === "powder_snow_bucket") {
      w.setBlock(cx, cy, cz, stateOf(blockId("powder_snow")));
      sound(ctx, "item.bucket.empty_powder_snow", cx + 0.5, cy + 0.5, cz + 0.5);
    } else if (name === "lava_bucket") {
      w.setBlock(cx, cy, cz, stateOf(blockId("lava")));
      sound(ctx, "item.bucket.empty_lava", cx + 0.5, cy + 0.5, cz + 0.5);
    } else if (w.dim === "nether") {
      sound(ctx, "block.fire.extinguish", cx + 0.5, cy + 0.5, cz + 0.5, 0.5, 2.6 + (ctx.random() - ctx.random()) * 0.8);
      ctx.emit({ type: "particles", kind: "smoke", x: cx + 0.5, y: cy + 0.5, z: cz + 0.5, count: 8 });
    } else {
      w.setBlock(cx, cy, cz, stateOf(blockId("water")));
      const fish = name !== "water_bucket";
      if (fish) ctx.entities.spawn(name.slice(0, -"_bucket".length), cx + 0.5, cy, cz + 0.5);
      sound(ctx, fish ? "item.bucket.empty_fish" : "item.bucket.empty", cx + 0.5, cy + 0.5, cz + 0.5);
    }
    if (!creative(p)) ctx.inventory.setSlot(slotOf(ctx, h), { item: "bucket", count: 1 });
    return true;
  }
  if (tool?.kind === "hoe" && hit.face !== Face.Down && above === AIR) {
    if (TILLABLE.has(def.name)) return convert(p, ctx, h, hit, "farmland", "item.hoe.till");
    if (def.name === "coarse_dirt" || def.name === "rooted_dirt") {
      if (def.name === "rooted_dirt") ctx.entities.dropItem({ item: "hanging_roots", count: 1 }, hit.x + 0.5, hit.y - 0.5, hit.z + 0.5);
      return convert(p, ctx, h, hit, "dirt", "item.hoe.till");
    }
  }
  if (tool?.kind === "shovel" && hit.face !== Face.Down && above === AIR && FLATTENABLE.has(def.name)) return convert(p, ctx, h, hit, "dirt_path", "item.shovel.flatten");
  if (tool?.kind === "axe") {
    if (def.name.startsWith("waxed_")) return convert(p, ctx, h, hit, def.name.slice(6), "item.axe.wax_off");
    for (let i = 0; i < 3; i++)
      if (def.name.startsWith(COPPER_STAGES[i])) {
        const base = def.name.slice(COPPER_STAGES[i].length);
        const to = i === 0 ? (hasBlock(base) ? base : `${base}_block`) : COPPER_STAGES[i - 1] + base;
        if (hasBlock(to)) return convert(p, ctx, h, hit, to, "item.axe.scrape");
      }
    if (STRIPPABLE.test(def.name) && !def.name.startsWith("stripped_") && hasBlock(`stripped_${def.name}`)) return convert(p, ctx, h, hit, `stripped_${def.name}`, "item.axe.strip");
  }
  if (name === "honeycomb" && (def.name.includes("copper") || def.name.includes("cut_copper")) && !def.name.startsWith("waxed_") && hasBlock(`waxed_${def.name}`))
    return convert(p, ctx, h, hit, `waxed_${def.name}`, "item.honeycomb.wax_on", false);
  if (name.endsWith("minecart") && def.shape === "rail") {
    ctx.entities.spawn(name, hit.x + 0.5, hit.y + 0.0625, hit.z + 0.5);
    consume(p, ctx, h);
    return true;
  }
  if (name === "armor_stand" || name === "item_frame" || name === "glow_item_frame" || name === "painting" || (name === "end_crystal" && (def.name === "obsidian" || def.name === "bedrock"))) {
    adjacent(hit, cell);
    const e = ctx.entities.spawn(name, cell[0] + 0.5, cell[1], cell[2] + 0.5, { face: hit.face, x: cell[0], y: cell[1], z: cell[2] });
    if (!e) return false;
    if (name === "armor_stand") e.yaw = p.yaw + Math.PI;
    consume(p, ctx, h);
    return true;
  }
  if (name === "firework_rocket") {
    ctx.entities.spawn("firework_rocket", hit.point.x, hit.point.y, hit.point.z, { ...stack.data });
    consume(p, ctx, h);
    return true;
  }
  return placeBlock(p, ctx, h, stack, hit);
}

export function shoot(p: PlayerState, ctx: GameCtx, type: string, speed: number, inaccuracy: number, data: Record<string, unknown>, yawOffset = 0, pitchOffset = 0): Entity | null {
  eyeV.copy(p.eye());
  const yaw = p.yaw + (yawOffset * Math.PI) / 180, pitch = p.pitch - (pitchOffset * Math.PI) / 180;
  dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const g = () => (ctx.random() + ctx.random() + ctx.random() - 1.5) * 0.0172275 * inaccuracy;
  dir.x += g(); dir.y += g(); dir.z += g();
  dir.normalize().multiplyScalar(speed);
  const b = p.body;
  vel.set(dir.x + b.vel.x, dir.y + (b.onGround ? 0 : b.vel.y), dir.z + b.vel.z);
  const e = ctx.entities.spawn(type, eyeV.x, eyeV.y - 0.1, eyeV.z, { owner: "player", ...data });
  if (e) {
    e.body.vel.copy(vel);
    e.yaw = p.yaw;
    e.pitch = p.pitch;
    e.data.owner = "player";
    if (type === "trident") advTrigger({ t: "shot", item: "trident" });
    else if (data.fromCrossbow || data.shotAtAngle) advTrigger({ t: "shot", item: "crossbow" });
    else if (type === "arrow" || type === "spectral_arrow") advTrigger({ t: "shot", item: "bow" });
  }
  return e;
}

function start(p: PlayerState, h: Hand, item: string, kind: UseState["kind"], total: number) {
  p.using = { item, hand: h, ticks: 0, total, kind };
}

function equipArmor(p: PlayerState, ctx: GameCtx, h: Hand, stack: ItemStack): boolean {
  const a = itemDef(stack.item)?.armor;
  const slot = a ? ARMOR_SLOT[a.slot] : stack.item === "elytra" ? 37 : stack.item === "carved_pumpkin" || stack.item.endsWith("_head") || stack.item.endsWith("_skull") || stack.item === "turtle_helmet" ? 36 : -1;
  if (slot < 0) return false;
  const cur = ctx.inventory.slots[slot];
  if (cur && ench(cur, "binding_curse") && !creative(p)) return false;
  ctx.inventory.setSlot(slot, stack);
  ctx.inventory.setSlot(slotOf(ctx, h), cur);
  const mat = stack.item.split("_")[0];
  const snd = stack.item === "elytra" ? "item.armor.equip_elytra" : ["leather", "iron", "golden", "diamond", "netherite", "chainmail", "turtle"].includes(mat)
    ? `item.armor.equip_${mat === "golden" ? "gold" : mat === "chainmail" ? "chain" : mat}` : "item.armor.equip_generic";
  sound(ctx, snd, p.body.pos.x, p.body.pos.y, p.body.pos.z);
  return true;
}

function fillBucket(p: PlayerState, ctx: GameCtx, h: Hand, stack: ItemStack): boolean {
  if (stack.item === "glass_bottle" && collectBreath(ctx)) {
    exchange(p, ctx, h, { item: "dragon_breath", count: 1 });
    return true;
  }
  eyeV.copy(p.eye());
  const reach = 4.5 + (creative(p) ? 0.5 : 0);
  let hit = ctx.world.raycast(eyeV, p.lookDir(), reach, true);
  // Vanilla buckets clip SOURCE_ONLY: flowing fluid does not stop the ray.
  for (let i = 0, gone = 0; stack.item === "bucket" && hit && i < 32; i++) {
    const d = blockDef(hit.state);
    if (d.shape !== "fluid" || metaOf(hit.state) === 0) break;
    const { x, y, z } = hit;
    gone += hit.dist + 0.05;
    eyeV.copy(p.eye()).addScaledVector(p.lookDir(), gone);
    hit = ctx.world.raycast(eyeV, p.lookDir(), reach - gone, true);
    while (hit && hit.x === x && hit.y === y && hit.z === z && gone < reach) {
      gone += 0.1;
      eyeV.copy(p.eye()).addScaledVector(p.lookDir(), gone);
      hit = ctx.world.raycast(eyeV, p.lookDir(), reach - gone, true);
    }
  }
  if (!hit) return false;
  const def = blockDef(hit.state);
  const source = def.shape === "fluid" && metaOf(hit.state) === 0;
  if (stack.item === "glass_bottle") {
    if (def.shape !== "fluid" || def.name === "lava") return false;
    sound(ctx, "item.bottle.fill", hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    exchange(p, ctx, h, { item: "potion", count: 1, data: { potion: "water" } });
    return true;
  }
  let result: string | null = null;
  let snd = "item.bucket.fill";
  if (stack.item === "bucket" && p.gameMode !== "adventure" && !IMPLICIT_WATER[hit.state & 0xfff] && ctx.world.isWaterlogged?.(hit.x, hit.y, hit.z)) {
    ctx.world.setWaterlogged?.(hit.x, hit.y, hit.z, false);
    sound(ctx, snd, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    exchange(p, ctx, h, { item: "water_bucket", count: 1 });
    return true;
  }
  if (source && def.name === "water") result = "water_bucket";
  else if (source && def.name === "lava") { result = "lava_bucket"; snd = "item.bucket.fill_lava"; }
  else if (def.name === "powder_snow") { result = "powder_snow_bucket"; snd = "item.bucket.fill_powder_snow"; }
  if (!result || p.gameMode === "adventure") return false;
  ctx.world.setBlock(hit.x, hit.y, hit.z, AIR);
  sound(ctx, snd, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  exchange(p, ctx, h, { item: result, count: 1 });
  return true;
}

function placeBoat(p: PlayerState, ctx: GameCtx, h: Hand, stack: ItemStack): boolean {
  eyeV.copy(p.eye());
  const hit = ctx.world.raycast(eyeV, p.lookDir(), 5, true);
  if (!hit) return false;
  const chest = stack.item.includes("chest_");
  const wood = stack.item.replace(/_chest_(boat|raft)$/, "").replace(/_(boat|raft)$/, "");
  const e = ctx.entities.spawn(chest ? "chest_boat" : "boat", hit.point.x, hit.point.y, hit.point.z, { wood });
  if (!e) return false;
  e.yaw = p.yaw;
  consume(p, ctx, h);
  return true;
}

function useInAir(p: PlayerState, ctx: GameCtx, h: Hand, stack: ItemStack): boolean {
  const name = stack.item;
  const def = itemDef(name);
  if ((p.itemCooldowns[name] ?? 0) > 0) return false;
  if (def?.food || DRINKS.has(name)) {
    const always = def?.food?.alwaysEat || DRINKS.has(name) || creative(p);
    if (!always && p.food >= 20) return false;
    start(p, h, name, DRINKS.has(name) ? "drink" : "eat", name === "honey_bottle" ? 40 : def?.food?.eatTicks ?? 32);
    return true;
  }
  if (name === "bow") {
    if (findAmmo(p, ctx, false) === -1 && !ench(stack, "infinity")) return false;
    start(p, h, name, "bow", 72000);
    return true;
  }
  if (name === "crossbow") {
    if (stack.data?.charged) {
      shootCrossbow(p, ctx, h, stack, shoot);
      return true;
    }
    if (findAmmo(p, ctx, true) === -1) return false;
    start(p, h, name, "crossbow", crossbowCharge(stack));
    return true;
  }
  if (name === "trident") {
    if ((stack.damage ?? 0) >= (itemDef("trident")?.durability ?? 250) - 1 || !canRiptide(p, ctx, stack)) return false;
    start(p, h, name, "trident", 72000);
    return true;
  }
  if (name === "firework_rocket") {
    if (!boostRocket(p, ctx, stack)) return false;
    consume(p, ctx, h);
    return true;
  }
  if (name === "shield") {
    start(p, h, name, "shield", 72000);
    return true;
  }
  if (name === "brush") {
    if (!p.target) return false;
    start(p, h, name, "brush", 200);
    return true;
  }
  if (name === "spyglass") {
    start(p, h, name, "spyglass", 1200);
    sound(ctx, "item.spyglass.use", p.body.pos.x, p.body.pos.y, p.body.pos.z);
    return true;
  }
  const t = THROWN[name];
  if (t) {
    if (name === "ender_eye") {
      if (ctx.world.dim !== "overworld") return false;
      const e = p.eye();
      ctx.entities.spawn("eye_of_ender", e.x, e.y - 0.1, e.z, { owner: "player" });
    } else shoot(p, ctx, t.type, t.speed, 1, { item: { ...stack, count: 1 }, potion: stack.data?.potion, lingering: name === "lingering_potion" || undefined }, 0, t.pitchOffset ?? 0);
    sound(ctx, t.sound, p.body.pos.x, p.body.pos.y, p.body.pos.z, 0.5, 0.4 / (ctx.random() * 0.4 + 0.8));
    if (t.cooldown) p.itemCooldowns[name] = t.cooldown;
    consume(p, ctx, h);
    return true;
  }
  if (name === "bucket" || name === "glass_bottle") return fillBucket(p, ctx, h, stack);
  if (name.endsWith("_boat") || name.endsWith("_raft")) return placeBoat(p, ctx, h, stack);
  if ((name === "carrot_on_a_stick" || name === "warped_fungus_on_a_stick") && p.vehicle != null) {
    const v = ctx.entities.get(p.vehicle);
    if (!v || v.type !== (name === "carrot_on_a_stick" ? "pig" : "strider") || !v.data.saddle || v.data._boost) return false;
    v.data._boostReq = true;
    if (!creative(p)) damageSlot(ctx, slotOf(ctx, h), name === "carrot_on_a_stick" ? 7 : 1);
    return true;
  }
  if (name === "map") return useEmptyMap(ctx, slotOf(ctx, h));
  if (name === "goat_horn") {
    sound(ctx, `item.goat_horn.sound.${Number(stack.data?.instrument ?? 0)}`, p.body.pos.x, p.body.pos.y, p.body.pos.z, 16);
    p.itemCooldowns[name] = 140;
    return true;
  }
  if (name === "fishing_rod") {
    useFishingRod(p, ctx, h);
    return true;
  }
  return equipArmor(p, ctx, h, stack);
}

export function useItem(p: PlayerState, ctx: GameCtx, h: Hand): boolean {
  const stack = stackOf(ctx, h);
  if (p.targetEntity) {
    if (ctx.entities.interact(p.targetEntity.id, stack)) {
      advEntityUse(ctx, ctx.entities.get(p.targetEntity.id), stack, slotOf(ctx, h));
      p.swing();
      return true;
    }
  } else if (p.target) {
    const hit = p.target;
    const beh = ctx.behaviors[blockDef(hit.state).name];
    const skip = p.sneaking && (!!ctx.inventory.held() || !!ctx.inventory.slots[40]);
    if (!skip && beh?.use && beh.use(ctx, hit.x, hit.y, hit.z, hit.state, stack)) {
      advTrigger({ t: "item_used_on_block", item: stack?.item ?? "", block: blockDef(hit.state).name, x: hit.x, y: hit.y, z: hit.z });
      p.swing();
      return true;
    }
    if (stack && useOn(p, ctx, h, stack, hit, !skip)) {
      p.swing();
      return true;
    }
  }
  if (!stack) return false;
  const kind = itemDef(stack.item);
  const swings = !!THROWN[stack.item] || stack.item === "bucket" || stack.item === "glass_bottle" || stack.item.endsWith("_boat") || stack.item === "fishing_rod" || (!!kind?.armor && !p.using);
  const ok = useInAir(p, ctx, h, stack);
  if (ok && swings) p.swing();
  return ok;
}

function chorusTeleport(p: PlayerState, ctx: GameCtx) {
  const b = p.body;
  for (let i = 0; i < 16; i++) {
    const x = b.pos.x + (ctx.random() - 0.5) * 16;
    const y = Math.max(MIN_Y, Math.min(MAX_Y, b.pos.y + Math.floor(ctx.random() * 16) - 8));
    const z = b.pos.z + (ctx.random() - 0.5) * 16;
    for (let yy = Math.floor(y); yy > MIN_Y; yy--) {
      const below = ctx.world.getBlock(Math.floor(x), yy - 1, Math.floor(z));
      if (!blockDef(below).solid) continue;
      if (ctx.world.getBlock(Math.floor(x), yy, Math.floor(z)) !== AIR || ctx.world.getBlock(Math.floor(x), yy + 1, Math.floor(z)) !== AIR) break;
      sound(ctx, "item.chorus_fruit.teleport", b.pos.x, b.pos.y, b.pos.z);
      p.teleport(x, yy, z);
      sound(ctx, "item.chorus_fruit.teleport", x, yy, z);
      return;
    }
  }
}

function finishUse(p: PlayerState, ctx: GameCtx, u: UseState) {
  const stack = stackOf(ctx, u.hand);
  if (!stack || stack.item !== u.item) return;
  const def = itemDef(u.item);
  const b = p.body;
  advTrigger({ t: "consumed_item", item: u.item });
  if (def?.food) {
    eat(p, def.food.hunger, def.food.saturation);
    for (const fx of def.food.effects ?? []) if (ctx.random() < fx.chance) p.addEffect(fx.effect, fx.amplifier, Math.round(fx.seconds * 20));
    sound(ctx, "entity.player.burp", b.pos.x, b.pos.y, b.pos.z, 0.5, ctx.random() * 0.1 + 0.9);
  }
  if (u.item === "milk_bucket") p.effects.length = 0;
  else if (u.item === "honey_bottle") p.removeEffect("poison");
  else if (u.item === "potion") for (const [id, sec, amp] of POTIONS[String(stack.data?.potion ?? "water")] ?? []) p.addEffect(id, amp, Math.round(sec * 20));
  else if (u.item === "suspicious_stew") {
    const fx = STEW_EFFECTS[String(stack.data?.flower ?? stack.data?.effect ?? "")];
    if (fx) p.addEffect(fx[0], 0, Math.round(fx[1] * 20));
  } else if (u.item === "chorus_fruit") {
    chorusTeleport(p, ctx);
    p.itemCooldowns.chorus_fruit = 20;
  } else if (u.item === "ominous_bottle") p.addEffect("bad_omen", Number(stack.data?.amplifier ?? 0), 120000);
  const container = CONTAINERS[u.item];
  if (container) exchange(p, ctx, u.hand, { item: container, count: 1 });
  else consume(p, ctx, u.hand);
}

function release(p: PlayerState, ctx: GameCtx, u: UseState) {
  const stack = stackOf(ctx, u.hand);
  if (!stack || stack.item !== u.item) return;
  const b = p.body;
  if (u.kind === "bow") releaseBow(p, ctx, u.hand, stack, u.ticks, shoot);
  else if (u.kind === "trident") releaseTrident(p, ctx, u.hand, stack, u.ticks, shoot);
}

export function tickUse(p: PlayerState, ctx: GameCtx, input: InputApi): void {
  for (const k in p.itemCooldowns) if (k !== "bobber" && p.itemCooldowns[k] > 0) p.itemCooldowns[k]--;
  const u = p.using;
  p.blocking = false;
  if (!u) return;
  const stack = stackOf(ctx, u.hand);
  if (!stack || stack.item !== u.item || p.dead || !input.enabled) {
    p.using = null;
    return;
  }
  if (!input.right) {
    release(p, ctx, u);
    p.using = null;
    return;
  }
  u.ticks++;
  const b = p.body;
  if (u.kind === "eat" || u.kind === "drink") {
    const remaining = u.total - u.ticks;
    if (u.ticks > Math.floor(u.total * 0.21875) && remaining % 4 === 0) {
      const eatSnd = u.kind === "drink" ? (u.item === "honey_bottle" ? "item.honey_bottle.drink" : "entity.generic.drink") : "entity.generic.eat";
      sound(ctx, eatSnd, b.pos.x, b.pos.y, b.pos.z, 0.5 + 0.5 * Math.floor(ctx.random() * 2), (ctx.random() - ctx.random()) * 0.2 + 1);
      if (u.kind === "eat") {
        const e = p.eye();
        const d = p.lookDir();
        ctx.emit({ type: "particles", kind: "dust", x: e.x + d.x * 0.5, y: e.y - 0.2, z: e.z + d.z * 0.5, count: 5 });
      }
    }
    if (u.ticks >= u.total) {
      finishUse(p, ctx, u);
      p.using = null;
    }
  } else if (u.kind === "crossbow") {
    if (u.ticks === Math.floor(u.total * 0.2)) sound(ctx, "item.crossbow.loading_start", b.pos.x, b.pos.y, b.pos.z, 0.5);
    if (u.ticks === Math.floor(u.total * 0.5)) sound(ctx, "item.crossbow.loading_middle", b.pos.x, b.pos.y, b.pos.z, 0.5);
    if (u.ticks === u.total) loadCrossbow(p, ctx, u.hand, stack);
  } else if (u.kind === "shield") p.blocking = u.ticks >= 5;
  else if (u.kind === "spyglass" && u.ticks >= u.total) p.using = null;
  else if (u.kind === "brush" && (!tickBrush(ctx, u.ticks, slotOf(ctx, u.hand)) || u.ticks >= u.total)) p.using = null;
}
