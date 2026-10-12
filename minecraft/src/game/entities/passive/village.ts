import type { Entity, MobDef } from "../../contracts";
import { moveTo, meleeAttack, targetPos, wander, idleLook, lookAt, distSq, type Target } from "../ai";
import { initVillager, villagerDeath, villagerTick } from "../../systems/villagers/brain";
import { isBaby } from "../geom";
import { rig, wrap, setRot, look, type VPart } from "../rig";
import { mobDef } from "../registry";
import { skin, eyes, type Pix } from "./paint";
import { sound, num, useItem } from "./common";

const HALF_PI = Math.PI / 2;
const near: Entity[] = [];

// ---------- Villager ----------

export const PROFESSIONS = ["none", "farmer", "librarian", "armorer", "butcher", "cartographer", "cleric", "fisherman", "fletcher", "leatherworker", "mason", "shepherd", "toolsmith", "weaponsmith", "nitwit"] as const;
type Prof = (typeof PROFESSIONS)[number];

const LOOK: Record<Prof, { robe: number; apron?: number; hat?: number; rim?: number; trim?: number }> = {
  none: { robe: 0x6b4a2b },
  farmer: { robe: 0x6b4a2b, apron: 0x9a7a4a, hat: 0xd8c060, rim: 0xd8c060 },
  librarian: { robe: 0x7a2a22, apron: 0xe8e0c8, hat: 0xb03828 },
  armorer: { robe: 0x5a4030, apron: 0x2e2e2e, hat: 0x3a3a3a },
  butcher: { robe: 0x6b4a2b, apron: 0xf0f0f0, trim: 0xb02020 },
  cartographer: { robe: 0x3a5a2a, apron: 0xe8e0c8, trim: 0xd8b040 },
  cleric: { robe: 0x7a2f8a, trim: 0xd8b040 },
  fisherman: { robe: 0x6b4a2b, apron: 0xd0c090, hat: 0xc8b070, rim: 0xc8b070 },
  fletcher: { robe: 0x6b4a2b, apron: 0xc8b890, hat: 0x4a7a26 },
  leatherworker: { robe: 0x6b4a2b, apron: 0x8a5a30, trim: 0x5a3a20 },
  mason: { robe: 0x6b4a2b, apron: 0x707070 },
  shepherd: { robe: 0x6b4a2b, apron: 0xd8d0b8, hat: 0x6a4a2a },
  toolsmith: { robe: 0x6b4a2b, apron: 0x303030, trim: 0x8a8a8a },
  weaponsmith: { robe: 0x6b4a2b, apron: 0x303030, hat: 0x202020 },
  nitwit: { robe: 0x3a6a2a },
};

function shadeOf(c: number, f: number) {
  return (Math.min(255, Math.round(((c >> 16) & 255) * f)) << 16) | (Math.min(255, Math.round(((c >> 8) & 255) * f)) << 8) | Math.min(255, Math.round((c & 255) * f));
}

function paintVillager(p: Pix, prof: Prof) {
  const L = LOOK[prof];
  const SKIN = [0xbd8b72, 0xb48068, 0xc4937a];
  const head = p.fillCuboid(0, 0, 8, 10, 8, SKIN);
  const f = head.front;
  p.rect([f[0] + 1, f[1] + 3, 6, 1], 0x4d3424);
  eyes(p, f[0] + 1, f[1] + 4, 4, 0xffffff, 0x2a8a3a, false);
  p.rect([f[0] + 2, f[1] + 8, 4, 1], 0x8a5a48);
  p.noise(head.top, [0x4d3424, 0x553a28]);
  p.fillCuboid(24, 0, 2, 4, 2, [0xa8775f, 0x9e6e57]);
  p.rect([32, 0, 32, 18], 0, 0);
  if (L.hat) {
    const hat = p.cuboid(32, 0, 8, 10, 8);
    p.noise(hat.top, [L.hat, shadeOf(L.hat, 0.9)]);
    for (const r of [hat.right, hat.front, hat.left, hat.back]) p.noise([r[0], r[1], r[2], 2], [L.hat, shadeOf(L.hat, 0.9)]);
  }
  p.rect([30, 47, 34, 17], 0, 0);
  if (L.rim) {
    const rim = p.cuboid(30, 47, 16, 16, 1);
    for (const r of [rim.front, rim.back]) {
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
          if (d < 8 && d > 3.5) p.px(r[0] + x, r[1] + y, (x + y) % 3 ? L.rim : shadeOf(L.rim, 0.85));
        }
    }
  }
  const R = [L.robe, shadeOf(L.robe, 0.92), shadeOf(L.robe, 1.06)];
  p.fillCuboid(16, 20, 8, 12, 6, R);
  const jacket = p.fillCuboid(0, 38, 8, 18, 6, R);
  if (L.apron) p.noise([jacket.front[0] + 1, jacket.front[1] + 2, 6, 14], [L.apron, shadeOf(L.apron, 0.93)]);
  if (L.trim) {
    p.rect([jacket.front[0], jacket.front[1], 8, 1], L.trim);
    p.rect([jacket.front[0] + 3, jacket.front[1] + 1, 2, 16], L.trim);
  }
  const arm = p.fillCuboid(44, 22, 4, 8, 4, R);
  p.noise([arm.right[0], arm.right[1] + 6, 16, 2], SKIN);
  p.fillCuboid(40, 38, 8, 4, 4, SKIN);
  const leg = p.fillCuboid(0, 22, 4, 12, 4, [shadeOf(L.robe, 0.7), shadeOf(L.robe, 0.65)]);
  p.rect([0, leg.front[1] + 11, 16, 1], 0x3a2a1a);
}

const villagerKey = (e: Entity) => `villager_${(e.data.profession as string) ?? "none"}`;
const villagerSkin = (k: string) => skin(k, 64, 64, (p) => paintVillager(p, k.slice(9) as Prof));

function villagerModel() {
  const parts: VPart[] = [
    { name: "head", pivot: [0, 0, 0], box: [-4, -10, -4, 8, 10, 8], uv: [0, 0] },
    { name: "hat", parent: "head", pivot: [0, 0, 0], box: [-4, -10, -4, 8, 10, 8], uv: [32, 0], inflate: 0.51 },
    { name: "hat_rim", parent: "hat", pivot: [0, 0, 0], box: [-8, -8, -6, 16, 16, 1], uv: [30, 47], rot: [-HALF_PI, 0, 0] },
    { name: "nose", parent: "head", pivot: [0, -2, 0], box: [-1, -1, -6, 2, 4, 2], uv: [24, 0] },
    { name: "body", pivot: [0, 0, 0], box: [-4, 0, -3, 8, 12, 6], uv: [16, 20] },
    { name: "jacket", parent: "body", pivot: [0, 0, 0], box: [-4, 0, -3, 8, 18, 6], uv: [0, 38], inflate: 0.5 },
    { name: "arms", pivot: [0, 3, -1], box: [-4, 2, -2, 8, 4, 4], uv: [40, 38], rot: [-0.75, 0, 0] },
    { name: "right_arm_x", parent: "arms", pivot: [0, 0, 0], box: [-8, -2, -2, 4, 8, 4], uv: [44, 22] },
    { name: "left_arm_x", parent: "arms", pivot: [0, 0, 0], box: [4, -2, -2, 4, 8, 4], uv: [44, 22], mirror: true },
    { name: "right_leg", pivot: [-2, 12, 0], box: [-2, 0, -2, 4, 12, 4], uv: [0, 22] },
    { name: "left_leg", pivot: [2, 12, 0], box: [-2, 0, -2, 4, 12, 4], uv: [0, 22], mirror: true },
  ];
  const r = rig(villagerSkin("villager_none"), parts);
  const rootY = r.root.position.y;
  return wrap(
    r,
    (a) => {
      const lying = !!a.e.data.sleeping;
      r.root.rotation.x = lying ? HALF_PI : 0;
      r.root.position.y = rootY + (lying ? 0.3 : 0);
      const shake = num(a.e, "_shake");
      if (lying) setRot(r.p.head, 0, 0, 0);
      else if (shake > 0) setRot(r.p.head, a.pitch, a.yaw, 0.3 * Math.sin((shake - a.pt) * 0.45));
      else look(r.p.head, a);
      const s = Math.cos(a.phase * 0.6662) * 1.4 * a.walk * 0.5;
      setRot(r.p.right_leg, s, 0, 0);
      setRot(r.p.left_leg, -s, 0, 0);
    },
    { scale: 0.9375, variant: villagerKey, variantSkin: villagerSkin },
  );
}

export const VILLAGER: MobDef = {
  type: "villager",
  displayName: "Villager",
  category: "passive",
  width: 0.6,
  height: 1.95,
  maxHealth: 20,
  speed: 0.5,
  sounds: { ambient: "entity.villager.ambient", hurt: "entity.villager.hurt", death: "entity.villager.death" },
  createModel: villagerModel,
  tick: villagerTick,
  onDeath: villagerDeath,
  onInteract(e, ctx, held) {
    if (held?.item === "villager_spawn_egg" || held?.item === "name_tag") return false;
    if (!e.data._init) initVillager(e, ctx);
    const trades = e.data.trades as unknown[] | undefined;
    if (isBaby(e) || !trades || !trades.length || e.data.sleeping) {
      e.data._shake = 40;
      sound(ctx, e, "entity.villager.no");
      return true;
    }
    e.data._trading = true;
    sound(ctx, e, "entity.villager.trade");
    ctx.inventory.open("villager", { x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z, entityId: e.id });
    return true;
  },
};

// ---------- Iron golem ----------

function paintGolem(p: Pix, cracks: number) {
  const I = [0xd8d0c4, 0xcdc4b7, 0xe0d9ce, 0xc2b9ab];
  const V = [0x4c7a2c, 0x3a6020, 0x5a8a34];
  const head = p.fillCuboid(0, 0, 8, 10, 8, I);
  const f = head.front;
  p.rect([f[0] + 1, f[1] + 3, 6, 1], 0x9c9284);
  p.rect([f[0] + 1, f[1] + 4, 2, 1], 0x8a1010);
  p.rect([f[0] + 5, f[1] + 4, 2, 1], 0x8a1010);
  p.fillCuboid(24, 0, 2, 4, 2, [0xb8ab9c, 0xaea19c]);
  p.fillCuboid(0, 40, 18, 12, 11, I);
  p.fillCuboid(0, 70, 9, 5, 6, I);
  p.fillCuboid(60, 21, 4, 30, 6, I);
  p.fillCuboid(60, 58, 4, 30, 6, I);
  p.fillCuboid(37, 0, 6, 16, 5, I);
  p.fillCuboid(60, 0, 6, 16, 5, I);
  for (let i = 0; i < 70; i++) {
    const zones: [number, number, number, number][] = [[0, 51, 58, 12], [60, 27, 20, 30], [60, 64, 20, 30], [0, 8, 32, 4]];
    const z = zones[i % zones.length];
    const x = z[0] + Math.floor(p.rand() * z[2]);
    const y = z[1] + Math.floor(p.rand() * z[3]);
    for (let k = 0; k < 3; k++) p.px(x, y + k, V[(i + k) % 3]);
  }
  for (let i = 0; i < cracks * 40; i++) {
    const x = Math.floor(p.rand() * 100), y = 40 + Math.floor(p.rand() * 50);
    p.px(x, y, 0x6e665c);
    p.px(x + 1, y + 1, 0x6e665c);
  }
}

const tri = (x: number, p: number) => (Math.abs((((x % p) + p) % p) - p * 0.5) - p * 0.25) / (p * 0.25);
const golemKey = (e: Entity) => `iron_golem_${e.health > 75 ? 0 : e.health > 50 ? 1 : e.health > 25 ? 2 : 3}`;
const golemSkin = (k: string) => skin(k, 128, 128, (p) => paintGolem(p, Number(k.slice(11))));

function golemModel() {
  const parts: VPart[] = [
    { name: "head", pivot: [0, -7, -2], box: [-4, -12, -5.5, 8, 10, 8], uv: [0, 0] },
    { name: "nose", parent: "head", pivot: [0, 0, 0], box: [-1, -5, -7.5, 2, 4, 2], uv: [24, 0] },
    { name: "body", pivot: [0, -7, 0], box: [-9, -2, -6, 18, 12, 11], uv: [0, 40] },
    { name: "waist", parent: "body", pivot: [0, 0, 0], box: [-4.5, 10, -3, 9, 5, 6], uv: [0, 70], inflate: 0.5 },
    { name: "right_arm", pivot: [0, -7, 0], box: [-13, -2.5, -3, 4, 30, 6], uv: [60, 21] },
    { name: "left_arm", pivot: [0, -7, 0], box: [9, -2.5, -3, 4, 30, 6], uv: [60, 58] },
    { name: "right_leg", pivot: [-4, 11, 0], box: [-3.5, -3, -3, 6, 16, 5], uv: [37, 0] },
    { name: "left_leg", pivot: [5, 11, 0], box: [-3.5, -3, -3, 6, 16, 5], uv: [60, 0], mirror: true },
  ];
  const r = rig(golemSkin("iron_golem_0"), parts);
  return wrap(
    r,
    (a) => {
      look(r.p.head, a);
      setRot(r.p.right_leg, -1.5 * tri(a.phase, 13) * a.walk, 0, 0);
      setRot(r.p.left_leg, 1.5 * tri(a.phase, 13) * a.walk, 0, 0);
      const at = num(a.e, "swing");
      if (at > 0) {
        const t = 10 - at + a.pt;
        setRot(r.p.right_arm, -2 + 1.5 * tri(t, 10), 0, 0);
        setRot(r.p.left_arm, -2 + 1.5 * tri(t, 10), 0, 0);
      } else {
        setRot(r.p.right_arm, (-0.2 + 1.5 * tri(a.phase, 13)) * a.walk, 0, 0);
        setRot(r.p.left_arm, (-0.2 - 1.5 * tri(a.phase, 13)) * a.walk, 0, 0);
      }
    },
    { variant: golemKey, variantSkin: golemSkin },
  );
}

export const IRON_GOLEM: MobDef = {
  type: "iron_golem",
  displayName: "Iron Golem",
  category: "neutral",
  width: 1.4,
  height: 2.7,
  maxHealth: 100,
  speed: 0.25,
  attackDamage: 15,
  drops: [
    { item: "iron_ingot", count: [3, 5] },
    { item: "poppy", count: [0, 2] },
  ],
  sounds: { hurt: "entity.iron_golem.hurt", death: "entity.iron_golem.death", step: "entity.iron_golem.step" },
  createModel: golemModel,
  tick(e, ctx) {
    e.data.noFall = true;
    e.data.kbResist = 1;
    e.data.persistent = true;
    const speed = num(e, "_speed", 0.25);
    let t = e.data._target as Target;
    if (t === "player" && (e.data.playerCreated || ctx.player.gameMode === "creative" || ctx.player.gameMode === "spectator")) t = e.data._target = undefined;
    if (t === undefined && e.age % 10 === 0) {
      const p = e.body.pos;
      ctx.entities.near(p.x, p.y, p.z, 10, near);
      for (const o of near) {
        if (o.dead || o.type === "creeper") continue;
        const d = o.type === "item" ? undefined : o;
        if (d && isHostile(o)) {
          e.data._target = t = o.id;
          break;
        }
      }
      near.length = 0;
    }
    const tp = targetPos(ctx, t);
    if (tp) {
      if (distSq(tp, e.body.pos) > 32 * 32) {
        e.data._target = undefined;
        return;
      }
      lookAt(e, tp.x, tp.y + 1, tp.z);
      moveTo(e, ctx, tp.x, tp.y, tp.z, speed);
      const dmg = 7.5 + ctx.random() * 15;
      if (meleeAttack(e, ctx, dmg)) {
        e.data.swing = 10;
        sound(ctx, e, "entity.iron_golem.attack", 1, 1);
        if (t === "player") ctx.player.body.vel.y += 0.4;
        else if (typeof t === "number") {
          const o = ctx.entities.get(t);
          if (o) o.body.vel.y += 0.4;
        }
      }
      return;
    }
    e.data._target = undefined;
    if (!wander(e, ctx, speed * 0.6)) idleLook(e, ctx);
  },
  onInteract(e, ctx, held) {
    if (held?.item !== "iron_ingot" || e.health >= e.maxHealth) return false;
    useItem(ctx);
    e.health = Math.min(e.maxHealth, e.health + 25);
    sound(ctx, e, "entity.iron_golem.repair", 1, 1 + (ctx.random() - ctx.random()) * 0.2);
    return true;
  },
};

function isHostile(o: Entity) {
  return mobDef(o.type)?.category === "hostile";
}
