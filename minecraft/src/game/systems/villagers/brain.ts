import type { Entity, GameCtx, ItemStack } from "../../contracts";
import { metaOf } from "../../contracts";
import { blockByName } from "../../blocks/registry";
import { clearPath, idleLook, lookAt, moveTo, panic, playerDistSq, randomSpot, wander, yawTo } from "../../entities/ai";
import { isBaby } from "../../entities/geom";
import type { MerchantTrade } from "../../items/menus-merchant";
import { LEVEL_XP, rollLevelTrades, restockTrades, villagerType, type PriceCtx } from "./trades";
import { nearestPoi, poiValid, posKey, requestArea } from "./poi";

const HX = [0, -1, 0, 1];
const HZ = [1, 0, -1, 0];
const near: Entity[] = [];
type P3 = [number, number, number];

export const EMPLOYABLE = ["farmer", "librarian", "armorer", "butcher", "cartographer", "cleric", "fisherman", "fletcher", "leatherworker", "mason", "shepherd", "toolsmith", "weaponsmith"];
const SCARY = new Set(["zombie", "husk", "drowned", "zombie_villager", "pillager", "vindicator", "evoker", "vex", "ravager", "illusioner", "zoglin"]);
const ZOMBIES = new Set(["zombie", "husk", "drowned", "zombie_villager"]);
const FOOD: Record<string, number> = { bread: 4, potato: 1, carrot: 1, beetroot: 1 };
const WANTED = new Set(["bread", "potato", "carrot", "beetroot", "wheat", "wheat_seeds", "beetroot_seeds"]);
const CROPS: Record<string, { max: number; seed: string; drops: [string, number, number][] }> = {
  wheat: { max: 7, seed: "wheat_seeds", drops: [["wheat", 1, 1], ["wheat_seeds", 0, 3]] },
  carrots: { max: 7, seed: "carrot", drops: [["carrot", 1, 4]] },
  potatoes: { max: 7, seed: "potato", drops: [["potato", 1, 4]] },
  beetroots: { max: 3, seed: "beetroot_seeds", drops: [["beetroot", 1, 1], ["beetroot_seeds", 0, 3]] },
};
const WORK_SOUND: Record<string, string> = { farmer: "block.composter.fill", librarian: "item.book.page_turn", armorer: "block.blastfurnace.fire_crackle", butcher: "block.smoker.smoke", cartographer: "ui.cartography_table.take_result", cleric: "block.brewing_stand.brew", fisherman: "block.barrel.open", fletcher: "ui.button.click", leatherworker: "item.armor.equip_leather", mason: "ui.stonecutter.take_result", shepherd: "ui.loom.take_result", toolsmith: "block.smithing_table.use", weaponsmith: "block.grindstone.use" };

const num = (e: Entity, k: string, d = 0) => (typeof e.data[k] === "number" ? (e.data[k] as number) : d);
const p3 = (v: unknown): P3 | null => (Array.isArray(v) && v.length === 3 ? (v as P3) : null);
const at = (p: P3) => ({ x: p[0], y: p[1], z: p[2] });

function sound(ctx: GameCtx, e: Entity, name: string, volume = 1) {
  const p = e.body.pos;
  ctx.emit({ type: "sound", name, x: p.x, y: p.y + 1, z: p.z, volume });
}

function happy(ctx: GameCtx, e: Entity) {
  const p = e.body.pos;
  ctx.emit({ type: "particles", kind: "dust", x: p.x, y: p.y + 1.2, z: p.z, count: 8, color: 0x55ff55 });
}

const employed = (e: Entity) => EMPLOYABLE.includes(e.data.profession as string);

function claimed(ctx: GameCtx, field: "job" | "bed", self: Entity): Set<string> {
  const out = new Set<string>();
  for (const o of ctx.entities.all()) {
    if (o === self || o.dead || o.type !== "villager") continue;
    const p = p3(o.data[field]);
    if (p) out.add(posKey(p[0], p[1], p[2]));
  }
  return out;
}

export function heroLevel(ctx: GameCtx): number {
  return ctx.player.effects.find((f) => f.id === "hero_of_the_village")?.amplifier ?? -1;
}

export function reputation(e: Entity): number {
  return num(e, "repTrade") + (e.data.cured ? 125 : 0) - num(e, "repHit");
}

export function priceCtx(e: Entity, ctx: GameCtx): PriceCtx {
  return e.type === "villager" ? { rep: reputation(e), hero: heroLevel(ctx) } : { rep: 0, hero: -1 };
}

export function initVillager(e: Entity, ctx: GameCtx) {
  e.data.persistent = true;
  if (typeof e.data.profession !== "string") e.data.profession = !isBaby(e) && ctx.random() < 0.05 ? "nitwit" : "none";
  e.data.level = Math.max(1, Math.min(5, num(e, "level", 1)));
  e.data.xp = num(e, "xp", LEVEL_XP[(e.data.level as number) - 1]);
  if (typeof e.data.villagerType !== "string") e.data.villagerType = villagerType(ctx.world.getBiome(Math.floor(e.body.pos.x), Math.floor(e.body.pos.z)).name);
  if (employed(e) && !Array.isArray(e.data.trades)) {
    const list: MerchantTrade[] = [];
    for (let l = 1; l <= (e.data.level as number); l++) list.push(...rollLevelTrades(e.data.profession as string, l, ctx.random, e.data.villagerType as string));
    e.data.trades = list;
  }
  e.data._init = true;
}

export function onTraded(e: Entity, ctx: GameCtx, t: MerchantTrade) {
  if (e.type !== "villager") return;
  e.data.repTrade = Math.min(25, num(e, "repTrade") + 2);
  e.data.xp = num(e, "xp") + t.xp;
  const lvl = num(e, "level", 1);
  if (lvl < 5 && (e.data.xp as number) >= LEVEL_XP[lvl]) e.data.levelUp = true;
}

function levelUp(e: Entity, ctx: GameCtx) {
  e.data.levelUp = false;
  const lvl = num(e, "level", 1);
  if (lvl >= 5 || !employed(e)) return;
  e.data.level = lvl + 1;
  const list = (e.data.trades as MerchantTrade[]) ?? [];
  list.push(...rollLevelTrades(e.data.profession as string, lvl + 1, ctx.random, e.data.villagerType as string));
  e.data.trades = list;
  const regen = e.effects.find((f) => f.id === "regeneration");
  if (regen) regen.ticks = Math.max(regen.ticks, 200);
  else e.effects.push({ id: "regeneration", amplifier: 0, ticks: 200 });
  happy(ctx, e);
  sound(ctx, e, "entity.villager.celebrate");
  if (num(e, "xp") >= LEVEL_XP[lvl + 1] && lvl + 1 < 5) e.data.levelUp = true;
}

function loseJob(e: Entity) {
  e.data.job = undefined;
  if (num(e, "level", 1) <= 1 && num(e, "xp") <= 0) {
    e.data.profession = "none";
    e.data.trades = undefined;
  }
}

function jobTick(e: Entity, ctx: GameCtx) {
  const job = p3(e.data.job);
  const prof = e.data.profession as string;
  if (job && !poiValid(ctx, at(job), prof)) loseJob(e);
  if (p3(e.data.job) || isBaby(e) || prof === "nitwit") return;
  const p = e.body.pos;
  requestArea(ctx, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), 48);
  const site = nearestPoi(ctx, employed(e) ? prof : null, p.x, p.y, p.z, 48, claimed(ctx, "job", e));
  if (!site) return;
  e.data.job = [site.x, site.y, site.z];
  if (!employed(e)) {
    e.data.profession = site.kind;
    e.data.trades = rollLevelTrades(site.kind, 1, ctx.random, e.data.villagerType as string);
    e.data.level = 1;
    e.data.xp = 0;
    happy(ctx, e);
    ctx.emit({ type: "sound", name: WORK_SOUND[site.kind] ?? "entity.villager.ambient", x: site.x + 0.5, y: site.y + 0.5, z: site.z + 0.5 });
  }
}

function bedTick(e: Entity, ctx: GameCtx) {
  const bed = p3(e.data.bed);
  if (bed && !poiValid(ctx, at(bed), "bed")) e.data.bed = undefined;
  if (p3(e.data.bed)) return;
  const p = e.body.pos;
  requestArea(ctx, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), 48);
  const b = nearestPoi(ctx, "bed", p.x, p.y, p.z, 48, claimed(ctx, "bed", e));
  if (b) e.data.bed = [b.x, b.y, b.z];
}

function freeBed(e: Entity, ctx: GameCtx): boolean {
  const p = e.body.pos;
  const taken = claimed(ctx, "bed", e);
  const own = p3(e.data.bed);
  if (own) taken.add(posKey(own[0], own[1], own[2]));
  return !!nearestPoi(ctx, "bed", p.x, p.y, p.z, 48, taken);
}

function inv(e: Entity): ItemStack[] {
  if (!Array.isArray(e.data.inv)) e.data.inv = [];
  return e.data.inv as ItemStack[];
}

function addInv(e: Entity, s: ItemStack): number {
  const list = inv(e);
  let left = s.count;
  for (const c of list) {
    if (c.item !== s.item || c.count >= 64) continue;
    const n = Math.min(left, 64 - c.count);
    c.count += n;
    left -= n;
  }
  while (left > 0 && list.length < 8) {
    const n = Math.min(64, left);
    list.push({ item: s.item, count: n });
    left -= n;
  }
  return left;
}

function takeInv(e: Entity, item: string, n: number): boolean {
  const list = inv(e);
  const have = list.reduce((a, c) => a + (c.item === item ? c.count : 0), 0);
  if (have < n) return false;
  for (const c of list) {
    if (c.item !== item || n <= 0) continue;
    const k = Math.min(n, c.count);
    c.count -= k;
    n -= k;
  }
  e.data.inv = list.filter((c) => c.count > 0);
  return true;
}

const foodValue = (e: Entity) => inv(e).reduce((a, c) => a + (FOOD[c.item] ?? 0) * c.count, 0);

function eatFood(e: Entity, points: number) {
  for (const item of ["bread", "potato", "carrot", "beetroot"]) {
    while (points > 0 && takeInv(e, item, 1)) points -= FOOD[item];
  }
}

function pickupTick(e: Entity, ctx: GameCtx) {
  const p = e.body.pos;
  ctx.entities.near(p.x, p.y + 0.5, p.z, 1.6, near);
  for (const o of near) {
    if (o.type !== "item" || o.dead || o.data._remove || num(o, "pickupDelay") > 0) continue;
    const s = o.data.stack as ItemStack | undefined;
    if (!s || !WANTED.has(s.item)) continue;
    if ((s.item === "wheat" || s.item.endsWith("_seeds")) && e.data.profession !== "farmer") continue;
    const left = addInv(e, s);
    if (left === s.count) continue;
    if (left > 0) s.count = left;
    else o.data._remove = true;
    sound(ctx, e, "entity.item.pickup", 0.2);
  }
  near.length = 0;
}

function breedTick(e: Entity, ctx: GameCtx): boolean {
  if (isBaby(e) || num(e, "breedCd") > 0 || foodValue(e) < 12) return false;
  const p = e.body.pos;
  let mate = typeof e.data._mate === "number" ? ctx.entities.get(e.data._mate as number) : undefined;
  if (!mate || mate.dead) {
    mate = undefined;
    if (e.age % 20 !== 0) return false;
    ctx.entities.near(p.x, p.y, p.z, 8, near);
    for (const o of near) {
      if (o !== e && o.type === "villager" && !o.dead && !isBaby(o) && num(o, "breedCd") <= 0 && foodValue(o) >= 12) {
        mate = o;
        break;
      }
    }
    near.length = 0;
    if (!mate) return false;
    if (!freeBed(e, ctx)) {
      ctx.emit({ type: "particles", kind: "angry", x: p.x, y: p.y + 2, z: p.z, count: 3 });
      e.data.breedCd = 600;
      return false;
    }
    e.data._mate = mate.id;
    mate.data._mate = e.id;
  }
  const mp = mate.body.pos;
  lookAt(e, mp.x, mp.y + 1.6, mp.z);
  if ((mp.x - p.x) ** 2 + (mp.z - p.z) ** 2 > 2.25) {
    moveTo(e, ctx, mp.x, mp.y, mp.z, 0.25);
    e.data._breedT = 0;
    return true;
  }
  clearPath(e);
  const t = num(e, "_breedT") + 1;
  e.data._breedT = t;
  if (t % 10 === 0) ctx.emit({ type: "particles", kind: "heart", x: p.x, y: p.y + 2.1, z: p.z, count: 1 });
  if (t >= 275 && e.id < mate.id) {
    for (const x of [e, mate]) {
      eatFood(x, 12);
      x.data.breedCd = 6000;
      x.data._mate = undefined;
      x.data._breedT = 0;
    }
    const baby = ctx.entities.spawn("villager", p.x, p.y, p.z, { grow: -24000, profession: "none" });
    if (baby) ctx.emit({ type: "particles", kind: "heart", x: p.x, y: p.y + 1, z: p.z, count: 7 });
  }
  return true;
}

function harvestTick(e: Entity, ctx: GameCtx): boolean {
  if (e.data.profession !== "farmer") return false;
  const w = ctx.world;
  let target = p3(e.data._crop);
  if (!target && e.age % 40 === 0) {
    const bx = Math.floor(e.body.pos.x), by = Math.floor(e.body.pos.y), bz = Math.floor(e.body.pos.z);
    for (let i = 0; i < 24 && !target; i++) {
      const x = bx + Math.floor(ctx.random() * 13) - 6, z = bz + Math.floor(ctx.random() * 13) - 6;
      for (let y = by - 1; y <= by + 1; y++) {
        const s = w.getBlock(x, y, z);
        const def = s ? mobCrop(s) : null;
        if (def && metaOf(s) >= def.max) target = [x, y, z];
        else if (!s && hasSeed(e) && farmland(ctx, x, y - 1, z)) target = [x, y, z];
        if (target) break;
      }
    }
    if (target) e.data._crop = target;
  }
  if (!target) return false;
  const [x, y, z] = target;
  const p = e.body.pos;
  if ((x + 0.5 - p.x) ** 2 + (z + 0.5 - p.z) ** 2 > 2.6) {
    if (!moveTo(e, ctx, x + 0.5, y, z + 0.5, 0.25)) e.data._crop = undefined;
    return true;
  }
  e.data._crop = undefined;
  const s = w.getBlock(x, y, z);
  const def = mobCrop(s);
  if (def && metaOf(s) >= def.max) {
    w.setBlock(x, y, z, 0);
    for (const [item, lo, hi] of def.drops) {
      const n = lo + Math.floor(ctx.random() * (hi - lo + 1));
      if (n > 0) addInv(e, { item, count: n });
    }
    ctx.emit({ type: "sound", name: "block.crop.break", x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  }
  if (!w.getBlock(x, y, z) && farmland(ctx, x, y - 1, z)) {
    for (const [name, c] of Object.entries(CROPS)) {
      if (!takeInv(e, c.seed, 1)) continue;
      const id = blockIdOf(name);
      if (id >= 0) w.setBlock(x, y, z, id, 1);
      ctx.emit({ type: "sound", name: "item.crop.plant", x: x + 0.5, y: y + 0.5, z: z + 0.5 });
      break;
    }
  }
  return true;
}

let cropIds: Map<number, string> | null = null;
let nameIds: Map<string, number> | null = null;
let farmId = -1;
function loadIds() {
  if (cropIds) return;
  cropIds = new Map();
  nameIds = new Map();
  for (const n of [...Object.keys(CROPS), "farmland"]) {
    const d = blockByName(n);
    if (!d) continue;
    nameIds.set(n, d.id);
    if (n === "farmland") farmId = d.id;
    else cropIds.set(d.id, n);
  }
}
function mobCrop(s: number) {
  loadIds();
  const n = cropIds!.get(s & 0xfff);
  return n ? CROPS[n] : null;
}
function blockIdOf(n: string) {
  loadIds();
  return nameIds!.get(n) ?? -1;
}
function farmland(ctx: GameCtx, x: number, y: number, z: number) {
  loadIds();
  return (ctx.world.getBlock(x, y, z) & 0xfff) === farmId;
}
const hasSeed = (e: Entity) => inv(e).some((c) => Object.values(CROPS).some((d) => d.seed === c.item));

function canRestock(e: Entity, ctx: GameCtx): boolean {
  const list = e.data.trades as MerchantTrade[] | undefined;
  if (!list?.some((t) => t.uses > 0)) return false;
  if (num(e, "restockDay", -1) !== ctx.time.day) {
    e.data.restockDay = ctx.time.day;
    e.data.restocks = 0;
  }
  const n = num(e, "restocks");
  return n === 0 || (n < 2 && ctx.time.tick > num(e, "lastRestock") + 2400);
}

function workTick(e: Entity, ctx: GameCtx, job: P3): boolean {
  const p = e.body.pos;
  const d2 = (job[0] + 0.5 - p.x) ** 2 + (job[2] + 0.5 - p.z) ** 2;
  if (harvestTick(e, ctx)) return true;
  if (d2 > 4) {
    if (moveTo(e, ctx, job[0] + 0.5, job[1], job[2] + 0.5, 0.25)) return true;
    return false;
  }
  clearPath(e);
  lookAt(e, job[0] + 0.5, job[1] + 0.5, job[2] + 0.5);
  if (canRestock(e, ctx)) {
    restockTrades(e.data.trades as MerchantTrade[]);
    e.data.restocks = num(e, "restocks") + 1;
    e.data.lastRestock = ctx.time.tick;
    ctx.emit({ type: "sound", name: WORK_SOUND[e.data.profession as string] ?? "entity.villager.work_farmer", x: job[0] + 0.5, y: job[1] + 0.5, z: job[2] + 0.5 });
  } else if (ctx.random() < 1 / 300) ctx.emit({ type: "sound", name: WORK_SOUND[e.data.profession as string] ?? "entity.villager.ambient", x: job[0] + 0.5, y: job[1] + 0.5, z: job[2] + 0.5, volume: 0.6 });
  if (e.data.profession === "farmer" && foodValue(e) < 12 && takeInv(e, "wheat", 3)) addInv(e, { item: "bread", count: 1 });
  return true;
}

function bedFoot(ctx: GameCtx, bed: P3): { x: number; z: number; dx: number; dz: number } {
  const h = metaOf(ctx.world.getBlock(bed[0], bed[1], bed[2])) & 3;
  return { x: bed[0] - HX[h], z: bed[2] - HZ[h], dx: HX[h], dz: HZ[h] };
}

function wake(e: Entity) {
  e.data.sleeping = false;
}

function sleepTick(e: Entity, ctx: GameCtx, bed: P3 | null, night: boolean): boolean {
  if (!e.data.sleeping) return false;
  if (!night || !bed || !poiValid(ctx, at(bed), "bed") || (e.data._panic as number) > 0) {
    wake(e);
    return false;
  }
  const f = bedFoot(ctx, bed);
  clearPath(e);
  e.body.pos.set(f.x + 0.5 - f.dx * 0.4, bed[1] + 0.5625, f.z + 0.5 - f.dz * 0.4);
  e.body.vel.set(0, 0, 0);
  e.yaw = e.headYaw = yawTo(-f.dx, -f.dz);
  e.pitch = 0;
  return true;
}

function golemTick(e: Entity, ctx: GameCtx) {
  if ((e.data._panic as number) <= 0 || num(e, "_golemCd") > 0 || e.age % 20 !== 0) return;
  const p = e.body.pos;
  ctx.entities.near(p.x, p.y, p.z, 16, near);
  let scared = 0;
  let golem = false;
  for (const o of near) {
    if (o.type === "iron_golem" && !o.dead) golem = true;
    if (o.type === "villager" && !o.dead && (o.data._panic as number) > 0 && o.body.pos.distanceToSquared(p) < 100) scared++;
  }
  const group = near.filter((o) => o.type === "villager");
  near.length = 0;
  for (const v of group) v.data._golemCd = 600;
  if (golem || scared < 3) return;
  const spot = randomSpot(ctx, e, 8, 6);
  if (!spot) return;
  ctx.entities.spawn("iron_golem", spot.x, spot.y, spot.z, {});
}

function threatTick(e: Entity, ctx: GameCtx) {
  if (e.age % 10 !== 0) return;
  const p = e.body.pos;
  ctx.entities.near(p.x, p.y, p.z, 8, near);
  const threat = near.find((o) => SCARY.has(o.type) && !o.dead);
  near.length = 0;
  if (!threat) return;
  e.data._panic = Math.max(num(e, "_panic"), 40);
  e.data._fromX = threat.body.pos.x;
  e.data._fromZ = threat.body.pos.z;
  if (e.data.sleeping) wake(e);
}

function hurtTick(e: Entity) {
  const last = num(e, "_hp", e.health);
  e.data._hp = e.health;
  if (e.health < last && e.data._hurtBy === "player") {
    e.data.repHit = Math.min(200, num(e, "repHit") + 25);
    wake(e);
  }
}

function dailyTick(e: Entity, ctx: GameCtx) {
  if (num(e, "repDay", -1) === ctx.time.day) return;
  if (e.data.repDay !== undefined) {
    e.data.repHit = Math.max(0, num(e, "repHit") - 20);
    e.data.repTrade = Math.max(0, num(e, "repTrade") - 2);
  }
  e.data.repDay = ctx.time.day;
}

export function villagerTick(e: Entity, ctx: GameCtx) {
  if (!e.data._init) initVillager(e, ctx);
  dailyTick(e, ctx);
  hurtTick(e);
  if (num(e, "_golemCd") > 0) e.data._golemCd = num(e, "_golemCd") - 1;
  if (num(e, "breedCd") > 0) e.data.breedCd = num(e, "breedCd") - 1;
  const shake = num(e, "_shake");
  if (shake > 0) e.data._shake = shake - 1;
  if (e.data.levelUp && !e.data._trading) {
    const t = num(e, "_levelT") + 1;
    e.data._levelT = t;
    if (t >= 40) {
      e.data._levelT = 0;
      levelUp(e, ctx);
    }
  }
  if ((e.age + e.id) % 100 === 0) jobTick(e, ctx);
  if ((e.age + e.id) % 200 === 50) bedTick(e, ctx);
  if ((e.age + e.id) % 10 === 0) pickupTick(e, ctx);
  threatTick(e, ctx);
  golemTick(e, ctx);
  const t = ((ctx.time.dayTime % 24000) + 24000) % 24000;
  const night = t >= 12000;
  const bed = p3(e.data.bed);
  if (sleepTick(e, ctx, bed, night)) return;
  if (panic(e, ctx, 1)) return;
  if (e.data._trading) {
    if (playerDistSq(ctx, e) > 64) e.data._trading = false;
    clearPath(e);
    const pp = ctx.player.body.pos;
    lookAt(e, pp.x, pp.y + 1.62, pp.z);
    return;
  }
  const speed = num(e, "_speed", 0.5) * 0.5;
  if (night && bed) {
    const f = bedFoot(ctx, bed);
    const p = e.body.pos;
    if ((f.x + 0.5 - p.x) ** 2 + (f.z + 0.5 - p.z) ** 2 < 2.5 || (bed[0] + 0.5 - p.x) ** 2 + (bed[2] + 0.5 - p.z) ** 2 < 2.5) {
      e.data.sleeping = true;
      sleepTick(e, ctx, bed, night);
      return;
    }
    if (moveTo(e, ctx, bed[0] + 0.5, bed[1], bed[2] + 0.5, speed)) return;
  }
  if (breedTick(e, ctx)) return;
  const job = p3(e.data.job);
  if (!night && t >= 2000 && t < 9000 && job && employed(e) && !isBaby(e) && workTick(e, ctx, job)) return;
  if (!night && t >= 9000 && t < 11000 && (e.age + e.id) % 40 === 0) {
    const p = e.body.pos;
    const bell = nearestPoi(ctx, "bell", p.x, p.y, p.z, 48);
    if (bell && (bell.x - p.x) ** 2 + (bell.z - p.z) ** 2 > 36) e.data._meet = [bell.x, bell.y, bell.z];
    else e.data._meet = undefined;
  }
  const meet = p3(e.data._meet);
  if (meet && !night && moveTo(e, ctx, meet[0] + 0.5, meet[1], meet[2] + 0.5, speed)) return;
  if (!wander(e, ctx, speed, night ? 1 / 600 : 1 / 120)) idleLook(e, ctx);
  if (ctx.inventory.held()?.item === "emerald" && playerDistSq(ctx, e) < 64) {
    const pp = ctx.player.body.pos;
    lookAt(e, pp.x, pp.y + 1.62, pp.z);
  }
}

export function villagerSnapshot(e: Entity): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["profession", "level", "xp", "trades", "repTrade", "repHit", "cured", "name"]) if (e.data[k] !== undefined) out[k] = e.data[k];
  return out;
}

export function villagerDeath(e: Entity, ctx: GameCtx) {
  const by = e.data._hurtBy;
  const killer = typeof by === "number" ? ctx.entities.get(by) : undefined;
  if (!killer || !ZOMBIES.has(killer.type)) return;
  const d = ctx.rules.difficulty;
  if (d === "easy" || d === "peaceful" || (d === "normal" && ctx.random() < 0.5)) return;
  const p = e.body.pos;
  const z = ctx.entities.spawn("zombie_villager", p.x, p.y, p.z, { villager: villagerSnapshot(e), profession: e.data.profession, persistent: true, baby: isBaby(e) || undefined });
  if (!z) return;
  z.yaw = e.yaw;
  e.data._remove = true;
  ctx.emit({ type: "sound", name: "entity.zombie.infect", x: p.x, y: p.y + 1, z: p.z });
}
