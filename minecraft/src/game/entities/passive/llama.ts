import * as THREE from "three";
import type { Entity, GameCtx, MobDef, MobModel } from "../../contracts";
import { clearPath, distSq, lookAt, moveTo, playerTargetable, wander, type Target } from "../ai";
import { isBaby, segmentBody } from "../geom";
import { rig, wrap, quadLegs, look, type VPart } from "../rig";
import { shootVel, targetInfo } from "../hostile/brain";
import { isRidden, mountPlayer, dismountPlayer, openMount, registerMountInv, type MountInv } from "../riding";
import { skin, shade, type Pix } from "./paint";
import { DYE_RGB, animalAI, dyeOf, feed, num, sound, useItem, type AnimalOpts, type Dye } from "./common";
import { dropContents } from "../vehicles/boat";

const COATS: Record<string, number> = { creamy: 0xd8c39a, white: 0xe9e6dc, brown: 0x8a5e3c, gray: 0x8e8983 };
const VARIANTS = Object.keys(COATS);
const near: Entity[] = [];

function paintLlama(p: Pix, coat: string, decor: string) {
  const c = COATS[coat] ?? COATS.creamy;
  const B = [c, shade(c, 0.93), shade(c, 1.05), shade(c, 0.88)];
  const snout = p.fillCuboid(0, 0, 4, 4, 9, B);
  p.rect([snout.front[0] + 1, snout.front[1] + 1, 2, 1], shade(c, 0.55));
  p.rect([snout.front[0], snout.front[1] + 3, 4, 1], shade(c, 0.7));
  const head = p.fillCuboid(0, 14, 8, 18, 6, B);
  p.px(head.front[0], head.front[1] + 1, 0x1a1410);
  p.px(head.front[0] + 7, head.front[1] + 1, 0x1a1410);
  p.px(head.right[0] + 4, head.right[1] + 1, 0x1a1410);
  p.px(head.left[0] + 1, head.left[1] + 1, 0x1a1410);
  p.fillCuboid(30, 0, 3, 3, 2, B);
  const body = p.fillCuboid(40, 0, 12, 18, 10, B);
  p.fillCuboid(40, 30, 4, 14, 4, B);
  p.rect([40, 30 + 4 + 12, 16, 2], shade(c, 0.7));
  const W = [0x8a5a2e, 0x7a4e26, 0x9a6634];
  for (const v of [30, 44]) {
    const f = p.fillCuboid(90, v, 8, 8, 3, W);
    p.rect([f.right[0], f.right[1] + 3, 3, 1], 0x3a2614);
    p.rect([f.front[0], f.front[1] + 3, 8, 1], 0x3a2614);
    p.rect([f.front[0] + 3, f.front[1] + 3, 2, 2], 0xb0b0b0);
  }
  if (decor === "none") return;
  const trader = decor === "trader";
  const base = trader ? 0x3c44aa : DYE_RGB[decor as Dye] ?? 0xffffff;
  const trim = trader ? 0xe8b830 : shade(base, 0.75);
  const D = [base, shade(base, 0.92)];
  p.noise(body.front, D);
  for (const r of [body.right, body.left, body.back]) {
    p.noise([r[0], r[1], r[2], 7], D);
    p.rect([r[0], r[1] + 7, r[2], 1], trim);
  }
  p.rect([body.front[0], body.front[1], 12, 1], trim);
  p.rect([body.front[0], body.front[1] + 17, 12, 1], trim);
  for (let x = 0; x < 12; x += 3) p.px(body.front[0] + x + 1, body.front[1] + 8, trim);
  if (trader) {
    p.rect([head.front[0], head.front[1] + 7, 8, 2], base);
    p.rect([head.front[0] + 3, head.front[1] + 7, 2, 2], trim);
  }
}

function llamaModel(trader: boolean): MobModel {
  const leg = (name: string, x: number, z: number, mirror = false): VPart => ({ name, pivot: [x, 10, z], box: [-2, 0, -2, 4, 14, 4], uv: [40, 30], mirror });
  const parts: VPart[] = [
    { name: "head", pivot: [0, 7, -6], box: [-4, -16, -6, 8, 18, 6], uv: [0, 14] },
    { name: "snout", parent: "head", pivot: [0, 0, 0], box: [-2, -14, -10, 4, 4, 9], uv: [0, 0] },
    { name: "right_ear", parent: "head", pivot: [0, 0, 0], box: [-4, -19, -4, 3, 3, 2], uv: [30, 0] },
    { name: "left_ear", parent: "head", pivot: [0, 0, 0], box: [1, -19, -4, 3, 3, 2], uv: [30, 0], mirror: true },
    { name: "body", pivot: [0, 5, 2], box: [-6, -10, -7, 12, 18, 10], uv: [40, 0], rot: [Math.PI / 2, 0, 0] },
    leg("right_hind_leg", -3.5, 6),
    leg("left_hind_leg", 3.5, 6, true),
    leg("right_front_leg", -3.5, -5),
    leg("left_front_leg", 3.5, -5, true),
    { name: "right_chest", pivot: [-8.5, 3, 3], box: [-3, 0, 0, 8, 8, 3], uv: [90, 30], rot: [0, Math.PI / 2, 0] },
    { name: "left_chest", pivot: [5.5, 3, 3], box: [-3, 0, 0, 8, 8, 3], uv: [90, 44], rot: [0, Math.PI / 2, 0] },
  ];
  const key = (e: Entity) => `llama_${(e.data.variant as string) ?? "creamy"}_${(e.data.decor as string) ?? (trader ? "trader" : "none")}`;
  const paint = (k: string) => {
    const [, coat, ...rest] = k.split("_");
    const decor = rest.join("_");
    return skin(k, 128, 64, (p) => paintLlama(p, coat, decor));
  };
  const r = rig(paint(trader ? "llama_creamy_trader" : "llama_creamy_none"), parts);
  return wrap(
    r,
    (a) => {
      quadLegs(r, a);
      look(r.p.head, a);
      r.p.right_chest.visible = r.p.left_chest.visible = a.e.data.chest === true;
    },
    { variant: key, variantSkin: paint, babyHead: 1.4 },
  );
}

function spit(e: Entity, ctx: GameCtx, t: Target) {
  const i = targetInfo(ctx, t);
  if (!i) return;
  const b = e.body;
  const sx = b.pos.x - Math.sin(e.yaw) * 0.6, sy = b.pos.y + b.height * 0.85, sz = b.pos.z - Math.cos(e.yaw) * 0.6;
  const s = ctx.entities.spawn("llama_spit", sx, sy, sz, { owner: e.id });
  if (!s) return;
  const dx = i.pos.x - sx, dz = i.pos.z - sz;
  const dy = i.pos.y + i.height * 0.33 - sy;
  shootVel(ctx, s.body.vel, dx, dy + Math.hypot(dx, dz) * 0.2, dz, 1.5, 10);
  sound(ctx, e, "entity.llama.spit");
}

// Vanilla Llama.setOffspringAttributes: strength 1..max parent, 3% chance of one more; health averaged like horses.
const llamaOpts: AnimalOpts = {
  food: ["hay_block"],
  tempt: 1.25,
  breed(a, b, baby, ctx) {
    baby.data.variant = ctx.random() < 0.5 ? a.data.variant : b.data.variant;
    let s = Math.floor(ctx.random() * Math.max(num(a, "strength", 1), num(b, "strength", 1))) + 1;
    if (ctx.random() < 0.03) s++;
    baby.data.strength = Math.min(5, s);
    baby.data.hp = Math.round((num(a, "hp", 22) + num(b, "hp", 22) + 15 + ctx.random() * 15) / 3);
    baby.health = baby.data.hp as number;
  },
};
const MAX_TEMPER = 30;
const CARAVAN_MAX = 10;
const isLlama = (o: Entity) => o.type === "llama" || o.type === "trader_llama";

function headOf(ctx: GameCtx, e: Entity) {
  const id = e.data.caravanHead;
  return typeof id === "number" ? ctx.entities.get(id) : undefined;
}

function inCaravan(ctx: GameCtx, e: Entity) {
  return e.data.leash !== undefined || !!headOf(ctx, e);
}

// Llamas from the leashed one back to e, or 99 when the chain does not reach a leashed llama.
function chainLength(ctx: GameCtx, e: Entity) {
  let n = 1;
  for (let o: Entity | undefined = e; o; o = headOf(ctx, o), n++) {
    if (o.data.leash !== undefined) return n;
    if (n > CARAVAN_MAX) break;
  }
  return 99;
}

function hasFollower(ctx: GameCtx, o: Entity) {
  const p = o.body.pos;
  ctx.entities.near(p.x, p.y, p.z, 12, near);
  const r = near.some((x) => x !== o && !x.dead && x.data.caravanHead === o.id);
  near.length = 0;
  return r;
}

// Vanilla LlamaFollowCaravanGoal: an unleashed llama joins the tail of a leashed caravan within 9 blocks and walks to 2 blocks behind it.
function caravanTick(e: Entity, ctx: GameCtx) {
  if (e.data.leash !== undefined) {
    e.data.caravanHead = undefined;
    return false;
  }
  let head = headOf(ctx, e);
  if (head && (head.dead || !inCaravan(ctx, head) || distSq(head.body.pos, e.body.pos) > 676)) {
    e.data.caravanHead = undefined;
    head = undefined;
  }
  if (!head && e.age % 10 === 0) {
    const p = e.body.pos;
    ctx.entities.near(p.x, p.y, p.z, 9, near);
    const cands = near.filter((o) => o !== e && isLlama(o) && !o.dead && Math.abs(o.body.pos.y - p.y) <= 4 && inCaravan(ctx, o));
    near.length = 0;
    cands.sort((a, b) => (a.data.leash !== undefined ? 1 : 0) - (b.data.leash !== undefined ? 1 : 0) || distSq(a.body.pos, p) - distSq(b.body.pos, p));
    for (const o of cands) {
      if (hasFollower(ctx, o) || chainLength(ctx, o) >= CARAVAN_MAX) continue;
      let loop = false;
      for (let x: Entity | undefined = o, i = 0; x && i <= CARAVAN_MAX; x = headOf(ctx, x), i++) if (x === e) loop = true;
      if (loop) continue;
      e.data.caravanHead = o.id;
      head = o;
      break;
    }
  }
  if (!head) return false;
  followAt(e, ctx, head, 2.1);
  return true;
}

function followAt(e: Entity, ctx: GameCtx, head: Entity, speed: number) {
  const h = head.body.pos, p = e.body.pos;
  const d = Math.sqrt(distSq(h, p));
  lookAt(e, h.x, h.y + head.body.height * 0.85, h.z);
  if (d <= 2) {
    clearPath(e);
    return;
  }
  if (e.age % 5 !== 0) return;
  const k = (d - 2) / d;
  moveTo(e, ctx, p.x + (h.x - p.x) * k, h.y, p.z + (h.z - p.z) * k, num(e, "_speed", 0.175) * speed);
}

function setChest(e: Entity) {
  e.data.chest = true;
  e.data.be = { x: 0, y: 0, z: 0, type: "chest", items: new Array(3 * num(e, "strength", 1)).fill(null), data: { customName: e.data.name ?? (e.type === "trader_llama" ? "Trader Llama" : "Llama") } };
}
const HEAL: Record<string, number> = { wheat: 2, hay_block: 10 };

function llamaDef(trader: boolean): MobDef {
  const type = trader ? "trader_llama" : "llama";
  const def: MobDef = {
    type,
    displayName: trader ? "Trader Llama" : "Llama",
    category: "neutral",
    width: 0.9,
    height: 1.87,
    maxHealth: 30,
    speed: 0.175,
    xp: [1, 3],
    drops: [{ item: "leather", count: [0, 2] }],
    sounds: { ambient: "entity.llama.ambient", hurt: "entity.llama.hurt", death: "entity.llama.death", step: "entity.llama.step" },
    spawn: trader
      ? undefined
      : { dims: ["overworld"], biomes: ["savanna", "savanna_plateau", "windswept_hills", "windswept_gravelly_hills", "windswept_forest"], light: "grass", group: [4, 6], weight: 5 },
    seat: 0.95,
    createModel: () => llamaModel(trader),
    tick(e, ctx) {
      if (e.data.hp === undefined || e.data.strength === undefined) {
        const r = ctx.random;
        e.data.hp ??= 15 + Math.floor(r() * 8) + Math.floor(r() * 9);
        e.data.strength ??= 1 + Math.floor(r() * (r() < 0.04 ? 5 : 3));
        e.data.variant ??= VARIANTS[Math.floor(r() * VARIANTS.length)];
        e.health = Math.min(e.health, e.data.hp as number);
      }
      e.maxHealth = e.data.hp as number;
      // Vanilla RunAroundLikeCrazyGoal: each tick a 1 in 50 roll, then tame when random(30) < temper.
      if (isRidden(ctx, e) && !e.data.tamed) {
        wander(e, ctx, num(e, "_speed", 0.175) * 1.2, 1 / 20, 6);
        if (ctx.random() < 1 / 50) {
          const temper = num(e, "temper");
          if (temper > 0 && Math.floor(ctx.random() * MAX_TEMPER) < temper) {
            e.data.tamed = true;
            e.data.owner = "player";
            e.data.persistent = true;
            ctx.emit({ type: "particles", kind: "heart", x: e.body.pos.x, y: e.body.pos.y + 2, z: e.body.pos.z, count: 7 });
          } else {
            e.data.temper = Math.min(MAX_TEMPER, temper + 5);
            dismountPlayer(ctx);
            sound(ctx, e, "entity.llama.angry");
          }
        }
        return;
      }
      let t = e.data._target as Target;
      const traderId = trader ? (e.data.leash as { entity?: number } | undefined)?.entity : undefined;
      if (t === undefined && typeof traderId === "number") {
        const tr = ctx.entities.get(traderId);
        if (tr && !tr.dead && num(tr, "_defend") > 0) t = "player";
      }
      if (t === undefined && e.age % 20 === 0 && ctx.random() < 0.1) {
        const p = e.body.pos;
        ctx.entities.near(p.x, p.y, p.z, 16, near);
        const w = near.find((o) => o.type === "wolf" && !o.dead && !o.data.owner);
        near.length = 0;
        if (w) t = w.id;
      }
      if (t === "player" && !playerTargetable(ctx)) t = undefined;
      const i = t !== undefined ? targetInfo(ctx, t) : null;
      if (i) {
        e.data._target = t;
        lookAt(e, i.pos.x, i.pos.y + i.height * 0.85, i.pos.z);
        const d2 = i.pos.distanceToSquared(e.body.pos);
        if (d2 > 100) moveTo(e, ctx, i.pos.x, i.pos.y, i.pos.z, num(e, "_speed", 0.175) * 1.25);
        else clearPath(e);
        if (d2 < 400 && e.age >= num(e, "_atk")) {
          e.data._atk = e.age + 40;
          spit(e, ctx, t);
          e.data._target = undefined;
        }
        return;
      }
      e.data._target = undefined;
      if (!isBaby(e) && caravanTick(e, ctx)) return;
      if (typeof traderId === "number") {
        const tr = ctx.entities.get(traderId);
        if (tr && !tr.dead && distSq(tr.body.pos, e.body.pos) > 16) {
          followAt(e, ctx, tr, 2.1);
          return;
        }
      }
      animalAI(e, ctx, llamaOpts);
    },
    onInteract(e, ctx, held) {
      const p = e.body.pos;
      if (ctx.player.sneaking && !isRidden(ctx, e) && openMount(ctx, e)) return true;
      if (held && HEAL[held.item] && e.health < e.maxHealth && !(held.item === "hay_block" && !isBaby(e) && e.data.tamed && num(e, "breedCd") <= 0)) {
        useItem(ctx);
        e.health = Math.min(e.maxHealth, e.health + HEAL[held.item]);
        if (!e.data.tamed) e.data.temper = Math.min(MAX_TEMPER, num(e, "temper") + (held.item === "wheat" ? 3 : 6));
        sound(ctx, e, "entity.llama.eat");
        return true;
      }
      if (held?.item.endsWith("_carpet") && e.data.tamed && !isBaby(e) && !e.data.decor) {
        const dye = dyeOf(held.item.replace("_carpet", "_dye"));
        if (!dye) return false;
        e.data.decor = dye;
        useItem(ctx);
        sound(ctx, e, "entity.llama.swag");
        return true;
      }
      if (held?.item === "chest" && e.data.tamed && !e.data.chest && !isBaby(e)) {
        setChest(e);
        useItem(ctx);
        sound(ctx, e, "entity.llama.chest", 1, (ctx.random() - ctx.random()) * 0.2 + 1);
        return true;
      }
      if (feed(e, ctx, def, held, llamaOpts)) return true;
      if (!held && !isBaby(e) && !ctx.player.sneaking) return mountPlayer(ctx, e);
      return false;
    },
    onDeath(e, ctx) {
      const p = e.body.pos;
      if (e.data.decor) ctx.entities.dropItem({ item: `${e.data.decor}_carpet`, count: 1 }, p.x, p.y + 1, p.z);
      if (e.data.chest) {
        ctx.entities.dropItem({ item: "chest", count: 1 }, p.x, p.y + 0.5, p.z);
        dropContents(e, ctx);
      }
    },
  };
  return def;
}

const llamaInv: MountInv = {
  canOpen: (e) => e.data.tamed === true && !isBaby(e),
  armor: "llama_armor",
  isArmor: (item) => item.endsWith("_carpet"),
  getArmor: (e) => (e.data.decor ? { item: `${e.data.decor}_carpet`, count: 1 } : null),
  setArmor(e, s, ctx) {
    const dye = s ? dyeOf(s.item.replace("_carpet", "_dye")) : undefined;
    if (dye && dye !== e.data.decor) sound(ctx, e, "entity.llama.swag");
    e.data.decor = dye ?? undefined;
  },
};
registerMountInv("llama", llamaInv);
registerMountInv("trader_llama", llamaInv);

export const LLAMA = llamaDef(false);
export const TRADER_LLAMA = llamaDef(true);

const spitList: Entity[] = [];
const rayO = new THREE.Vector3();
const rayD = new THREE.Vector3();

function spitModel(): MobModel {
  const p = skin("llama_spit", 16, 16, (x) => x.fillCuboid(0, 0, 2, 2, 2, [0xf0f0e8, 0xd8d8cc, 0xffffff]));
  const r = rig(p, [{ name: "ball", pivot: [0, 22, 0], box: [-1, -1, -1, 2, 2, 2], uv: [0, 0] }]);
  return wrap(r, () => {}, { head: [] });
}

export const LLAMA_SPIT: MobDef = {
  type: "llama_spit",
  displayName: "Llama Spit",
  category: "misc",
  width: 0.25,
  height: 0.25,
  maxHealth: 1,
  speed: 0,
  sounds: { hurt: "", death: "" },
  createModel: spitModel,
  tick(e, ctx) {
    e.data._pa = e.age;
    e.data.noFall = true;
    e.data.amphibious = true;
    e.data.invulnerable = true;
    const b = e.body;
    const v = b.vel;
    const len = v.length();
    if (len > 1e-4) {
      rayO.set(b.pos.x, b.pos.y + 0.125, b.pos.z);
      rayD.copy(v).multiplyScalar(1 / len);
      const blockHit = ctx.world.raycast(rayO, rayD, len, false);
      const maxT = blockHit ? blockHit.dist / len : 1;
      const owner = e.data.owner as number | undefined;
      let hitT = maxT;
      let hit: Entity | "player" | null = null;
      if (owner !== undefined && ctx.player.vehicle !== owner && !ctx.player.dead) {
        const t = segmentBody(rayO.x, rayO.y, rayO.z, v.x, v.y, v.z, ctx.player.body, 0.1);
        if (t >= 0 && t <= hitT) {
          hitT = t;
          hit = "player";
        }
      }
      ctx.entities.near(b.pos.x, b.pos.y, b.pos.z, len + 2, spitList);
      for (const o of spitList) {
        if (o === e || o.id === owner || o.dead || o.type === "llama_spit" || o.type === "item" || o.type === "xp_orb") continue;
        const t = segmentBody(rayO.x, rayO.y, rayO.z, v.x, v.y, v.z, o.body, 0.1);
        if (t >= 0 && t <= hitT) {
          hitT = t;
          hit = o;
        }
      }
      spitList.length = 0;
      const src = owner !== undefined ? ctx.entities.get(owner) : undefined;
      if (hit === "player") {
        ctx.player.damage(1, "mob", src);
        e.data._remove = true;
        return;
      }
      if (hit) {
        ctx.entities.damage(hit.id, 1, "mob", src);
        e.data._remove = true;
        return;
      }
      if (blockHit) {
        e.data._remove = true;
        return;
      }
      b.pos.add(v);
    }
    v.multiplyScalar(0.99);
    v.y -= 0.06;
    if (e.age > 100 || b.inWater) e.data._remove = true;
  },
};
