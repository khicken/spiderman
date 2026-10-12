import * as THREE from "three";
import type { BlockState, Entity, GameCtx, MobDef } from "../../contracts";
import { AIR, MIN_Y, idOf } from "../../contracts";
import { IS_FLUID, OPAQUE, SOLID, blockByName, blockDef } from "../../blocks/registry";
import { applyPhysics, brightnessCurve, canSee, canSeeSky, clearPath, idleLook, lightAt, meleeAttack, playerTargetable } from "../ai";
import { attackerOf, chase, hurtAmount, idle, num, particles, sound, targetInfo } from "./brain";
import { endermanModel } from "./looks-overworld";
import { END, MONSTER_BIOMES } from "./spawns";

const HOLDABLE = [
  "grass_block", "dirt", "coarse_dirt", "podzol", "rooted_dirt", "mycelium", "sand", "red_sand", "gravel", "clay", "pumpkin",
  "carved_pumpkin", "melon", "tnt", "cactus", "brown_mushroom", "red_mushroom", "crimson_fungus", "warped_fungus", "crimson_nylium",
  "warped_nylium", "crimson_roots", "warped_roots", "moss_block", "mud", "muddy_mangrove_roots", "dandelion", "poppy", "blue_orchid",
  "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy", "cornflower", "lily_of_the_valley",
  "wither_rose", "torchflower",
];
let holdable: Set<number> | null = null;
const canHold = (s: BlockState) => {
  if (!holdable) holdable = new Set(HOLDABLE.map((n) => blockByName(n)?.id ?? -1).filter((i) => i > 0));
  return holdable.has(idOf(s));
};

function wetAt(ctx: GameCtx, e: Entity): boolean {
  const p = e.body.pos;
  if (e.body.inWater) return true;
  if (ctx.time.rain < 0.2 || ctx.world.dim !== "overworld") return false;
  if (ctx.world.getBiome(p.x, p.z).precipitation !== "rain") return false;
  return canSeeSky(ctx, p.x, p.y + e.body.height, p.z);
}

function teleportTo(e: Entity, ctx: GameCtx, x: number, y: number, z: number): boolean {
  const w = ctx.world;
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  let by = Math.floor(y);
  if (!w.isLoaded(bx, bz)) return false;
  for (let i = 0; i < 64 && by > MIN_Y && !SOLID[idOf(w.getBlock(bx, by - 1, bz))]; i++) by--;
  const below = w.getBlock(bx, by - 1, bz);
  if (!SOLID[idOf(below)] || IS_FLUID[idOf(below)]) return false;
  for (let k = 0; k < 3; k++) {
    const s = w.getBlock(bx, by + k, bz);
    if (SOLID[idOf(s)] || IS_FLUID[idOf(s)]) return false;
  }
  const p = e.body.pos;
  particles(ctx, "portal", p.x, p.y + 1.5, p.z, 32);
  ctx.emit({ type: "sound", name: "entity.enderman.teleport", x: p.x, y: p.y, z: p.z });
  p.set(bx + 0.5, by, bz + 0.5);
  e.body.vel.set(0, 0, 0);
  e.body.fallDistance = 0;
  e.data._fall = 0;
  clearPath(e);
  particles(ctx, "portal", p.x, p.y + 1.5, p.z, 32);
  sound(ctx, e, "entity.enderman.teleport");
  return true;
}

export function teleportRandom(e: Entity, ctx: GameCtx, tries = 16): boolean {
  const p = e.body.pos;
  for (let i = 0; i < tries; i++) {
    if (teleportTo(e, ctx, p.x + (ctx.random() - 0.5) * 64, p.y + Math.floor(ctx.random() * 64) - 32, p.z + (ctx.random() - 0.5) * 64)) return true;
  }
  return false;
}

const v = new THREE.Vector3();

function teleportTowards(e: Entity, ctx: GameCtx, target: THREE.Vector3): boolean {
  v.set(e.body.pos.x - target.x, e.body.pos.y + 1.45 - (target.y + 1.62), e.body.pos.z - target.z).normalize();
  const p = e.body.pos;
  return teleportTo(e, ctx, p.x + (ctx.random() - 0.5) * 8 - v.x * 16, p.y + Math.floor(ctx.random() * 16) - 8 - v.y * 16, p.z + (ctx.random() - 0.5) * 8 - v.z * 16);
}

const look = new THREE.Vector3();
const to = new THREE.Vector3();

export function playerStares(e: Entity, ctx: GameCtx): boolean {
  if (ctx.inventory.slots[36]?.item === "carved_pumpkin") return false;
  look.copy(ctx.player.lookDir()).normalize();
  const eye = ctx.player.eye();
  to.set(e.body.pos.x - eye.x, e.body.pos.y + 2.55 - eye.y, e.body.pos.z - eye.z);
  const d = to.length();
  if (d > 64 || d < 1e-3) return false;
  to.multiplyScalar(1 / d);
  if (look.dot(to) <= 1 - 0.025 / d) return false;
  return canSee(ctx, e, eye.x, eye.y, eye.z);
}

function anger(e: Entity, ctx: GameCtx): void {
  if (!e.data.angry) sound(ctx, e, "entity.enderman.stare", 2.5);
  e.data.angry = true;
  e.data._target = "player";
  e.data._anger = 400 + Math.floor(ctx.random() * 380);
}

function takeBlock(e: Entity, ctx: GameCtx): void {
  if (e.data.carried || !ctx.rules.mobGriefing || ctx.random() >= 0.05) return;
  const p = e.body.pos;
  const x = Math.floor(p.x - 2 + ctx.random() * 4);
  const y = Math.floor(p.y + ctx.random() * 3);
  const z = Math.floor(p.z - 2 + ctx.random() * 4);
  const s = ctx.world.getBlock(x, y, z);
  if (!canHold(s) || !canSeeBlock(ctx, e, x, y, z)) return;
  ctx.world.setBlock(x, y, z, AIR);
  e.data.carried = s;
  e.data.persistent = true;
}

function canSeeBlock(ctx: GameCtx, e: Entity, x: number, y: number, z: number): boolean {
  const p = e.body.pos;
  look.set(x + 0.5 - p.x, y + 0.5 - (p.y + 2.55), z + 0.5 - p.z);
  const d = look.length();
  look.multiplyScalar(1 / d);
  to.set(p.x, p.y + 2.55, p.z);
  const h = ctx.world.raycast(to, look, d + 1, false);
  return !!h && h.x === x && h.y === y && h.z === z;
}

function placeBlock(e: Entity, ctx: GameCtx): void {
  const s = e.data.carried as BlockState | undefined;
  if (!s || !ctx.rules.mobGriefing || ctx.random() >= 1 / 2000) return;
  const p = e.body.pos;
  const x = Math.floor(p.x - 1 + ctx.random() * 2);
  const y = Math.floor(p.y + ctx.random() * 2);
  const z = Math.floor(p.z - 1 + ctx.random() * 2);
  const w = ctx.world;
  const below = w.getBlock(x, y - 1, z);
  if (w.getBlock(x, y, z) !== AIR || !OPAQUE[idOf(below)] || blockDef(below).name === "bedrock") return;
  const beh = ctx.behaviors[blockDef(s).name];
  if (beh?.canSurvive && !beh.canSurvive(ctx, x, y, z, s)) return;
  w.setBlock(x, y, z, s);
  e.data.carried = 0;
}

function tick(e: Entity, ctx: GameCtx): void {
  const hurt = hurtAmount(e);
  const p = e.body.pos;
  if (hurt > 0) {
    const by = attackerOf(e);
    if (by === "player" && playerTargetable(ctx)) anger(e, ctx);
    else if (typeof by === "number") e.data._target = by;
    if (ctx.random() < 0.9) teleportRandom(e, ctx, 64);
  }
  if (wetAt(ctx, e)) {
    ctx.entities.damage(e.id, 1, "drown");
    if (ctx.random() < 0.5) teleportRandom(e, ctx);
  }
  let t = e.data._target as "player" | number | undefined;
  if (t === "player" && !playerTargetable(ctx)) t = e.data._target = undefined;
  if (t === undefined && playerTargetable(ctx) && (e.age + e.id) % 5 === 0 && playerStares(e, ctx)) anger(e, ctx);
  t = e.data._target as typeof t;
  const info = targetInfo(ctx, t);
  if (t !== undefined && !info) e.data._target = t = undefined;
  if (info) {
    const d2 = info.pos.distanceToSquared(p);
    const left = num(e, "_anger") - 1;
    e.data._anger = left;
    const seen = t === "player" && playerStares(e, ctx);
    if (seen) e.data._anger = Math.max(left, 100);
    if (d2 > 64 * 64 || (left <= 0 && !seen)) {
      e.data._target = undefined;
      e.data.angry = false;
    } else {
      if (seen && d2 < 16) teleportRandom(e, ctx);
      else if (d2 > 256 && num(e, "_tpT") + 1 >= 30) {
        e.data._tpT = 0;
        teleportTowards(e, ctx, info.pos);
      } else e.data._tpT = num(e, "_tpT") + 1;
      chase(e, ctx, t, 0.3 * 1.0);
      meleeAttack(e, ctx, 7);
    }
  } else {
    e.data.angry = false;
    idle(e, ctx, 0.3);
    idleLook(e, ctx);
    takeBlock(e, ctx);
    placeBlock(e, ctx);
    if (ctx.world.dim === "overworld" && e.age % 20 === 0) {
      const br = brightnessCurve(lightAt(ctx, p.x, p.y + 2.5, p.z));
      if (br > 0.5 && canSeeSky(ctx, p.x, p.y + 2.5, p.z) && ctx.random() * 30 < (br - 0.4) * 2 * 20) teleportRandom(e, ctx);
    }
  }
  const amb = num(e, "_amb") + 1;
  if (ctx.random() * 1000 < amb) {
    e.data._amb = -80;
    sound(ctx, e, e.data.angry ? "entity.enderman.scream" : "entity.enderman.ambient");
  } else e.data._amb = amb;
  if (ctx.random() < 0.3) particles(ctx, "portal", p.x + (ctx.random() - 0.5) * 0.6, p.y + ctx.random() * 2.9, p.z + (ctx.random() - 0.5) * 0.6, 1);
  applyPhysics(e, ctx);
  if (num(e, "_swing") > 0) e.data._swing = num(e, "_swing") - 1;
}

export const ENDERMAN: MobDef = {
  type: "enderman",
  displayName: "Enderman",
  category: "hostile",
  width: 0.6,
  height: 2.9,
  maxHealth: 40,
  speed: 0.3,
  attackDamage: 7,
  xp: [5, 5],
  drops: [{ item: "ender_pearl", count: [0, 1] }],
  sounds: { ambient: "entity.enderman.ambient", hurt: "entity.enderman.hurt", death: "entity.enderman.death" },
  spawn: { dims: ["overworld", "nether", "end"], biomes: [...MONSTER_BIOMES, "nether_wastes", "soul_sand_valley", "warped_forest", ...END], light: "dark", group: [1, 4], weight: 10 },
  createModel: endermanModel,
  tick,
  onDeath(e, ctx) {
    const s = e.data.carried as BlockState | undefined;
    if (!s) return;
    const name = blockDef(s).name;
    ctx.entities.dropItem({ item: name, count: 1 }, e.body.pos.x, e.body.pos.y + 1, e.body.pos.z);
  },
};
