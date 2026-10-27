import type { Entity, GameCtx, MobDef } from "../../contracts";
import { rig, wrap, setRot, overlay, syncOverlay, type VPart } from "../rig";
import { skin, shade, type Pix } from "./paint";
import { animalAI, feed, num, sound, useItem, type AnimalOpts } from "./common";
import { isBaby } from "../geom";
import { wander, clearPath } from "../ai";
import { blockJumpFactor } from "../../player/physics";
import { rider, mountPlayer, steer, dismountPlayer } from "../riding";

type Kind = "horse" | "donkey" | "mule" | "skeleton_horse" | "zombie_horse";

const COATS: Record<string, [number, number]> = {
  white: [0xe8e4dc, 0xcfc8bc],
  creamy: [0xc9a26d, 0x8e6a3e],
  chestnut: [0x9a5a2e, 0x5a3418],
  brown: [0x6e4a2c, 0x3a2414],
  black: [0x2c2522, 0x141110],
  gray: [0x8a8580, 0x4a4643],
  dark_brown: [0x4a3020, 0x241810],
  donkey: [0x8a7b6a, 0x4e4438],
  mule: [0x4a2a18, 0x24140a],
  skeleton_horse: [0xd8d6c4, 0xb8b6a0],
  zombie_horse: [0x4c6e44, 0x2e4a2a],
};

function paintHorse(p: Pix, coat: string, eared: boolean) {
  const [c, mane] = COATS[coat] ?? COATS.brown;
  const skel = coat === "skeleton_horse";
  const B = [c, shade(c, 0.94), shade(c, 1.05)];
  const M = [mane, shade(mane, 0.9)];
  const body = p.fillCuboid(0, 32, 10, 10, 22, B);
  if (skel) for (let i = 0; i < 6; i++) p.rect([body.right[0] + 3 + i * 3, body.right[1] + 2, 1, 6], 0x8a8878);
  if (skel) for (let i = 0; i < 6; i++) p.rect([body.left[0] + 3 + i * 3, body.left[1] + 2, 1, 6], 0x8a8878);
  p.fillCuboid(0, 35, 4, 12, 7, B);
  const head = p.fillCuboid(0, 13, 6, 5, 7, B);
  const eye = skel ? 0x3a3a30 : coat === "zombie_horse" ? 0x9a1010 : 0x101010;
  p.px(head.right[0] + 2, head.right[1] + 1, eye);
  p.px(head.left[0] + 4, head.left[1] + 1, eye);
  const muzzle = coat === "donkey" ? [0xc8bba8, 0xbcae9a] : coat === "mule" ? [0x8a6a52, 0x7a5c46] : B;
  const mouth = p.fillCuboid(0, 25, 4, 5, 5, muzzle);
  p.rect([mouth.front[0], mouth.front[1] + 1, 1, 1], 0x202020);
  p.rect([mouth.front[0] + 3, mouth.front[1] + 1, 1, 1], 0x202020);
  p.fillCuboid(56, 36, 2, 16, 2, M);
  p.fillCuboid(42, 36, 3, 14, 4, M);
  const leg = p.fillCuboid(48, 21, 4, 11, 4, B);
  p.rect([48, leg.front[1] + 9, 16, 2], eared ? 0x3a342c : skel ? 0xa8a690 : 0x4a4038);
  p.fillCuboid(19, 16, 2, 3, 0, B);
  if (eared) p.fillCuboid(26, 0, 2, 7, 1, B);
}

function paintSaddle(p: Pix) {
  const L = [0x6b4423, 0x5e3a1d, 0x7a4f2a];
  const f = p.cuboid(26, 0, 10, 9, 9);
  p.noise(f.top, L);
  p.rect([f.top[0] + 3, f.top[1] + 2, 4, 5], 0x8a5a30);
  for (const s of [f.front, f.back]) p.noise([s[0], s[1], 10, 2], L);
  for (const s of [f.right, f.left]) {
    p.noise([s[0], s[1], 9, 2], L);
    p.rect([s[0] + 4, s[1] + 2, 1, 6], 0x3a2a1a);
    p.rect([s[0] + 3, s[1] + 8, 3, 1], 0xb0b0b0);
  }
}

const ARMOR_COLOR: Record<string, number> = { leather_horse_armor: 0xa06540, iron_horse_armor: 0xd8d8d8, golden_horse_armor: 0xf2cd3c, diamond_horse_armor: 0x4aedd9 };

// Horse armor in gray, tinted per material through the overlay's base color.
function paintArmor(p: Pix) {
  const G = [0xffffff, 0xe8e8e8, 0xd0d0d0];
  const D = [0x9a9a9a, 0x8a8a8a];
  const body = p.fillCuboid(0, 32, 10, 10, 22, G);
  for (const s of [body.right, body.left]) {
    p.noise([s[0], s[1] + 8, s[2], 2], D);
    p.noise([s[0] + 10, s[1], 2, s[3]], D);
  }
  p.fillCuboid(0, 35, 4, 12, 7, G);
  const head = p.fillCuboid(0, 13, 6, 5, 7, G);
  p.rect([head.right[0] + 2, head.right[1] + 1, 1, 1], 0);
  p.rect([head.left[0] + 4, head.left[1] + 1, 1, 1], 0);
  p.fillCuboid(0, 25, 4, 5, 5, D);
  const leg = p.fillCuboid(48, 21, 4, 11, 4, G);
  p.noise([48, leg.front[1] + 9, 16, 2], D);
}

function paintChests(p: Pix) {
  const W = [0x8a5a2e, 0x7a4e26, 0x9a6634];
  for (const u of [26, 44]) {
    const f = p.fillCuboid(u, 21, 3, 8, 8, W);
    p.rect([f.right[0], f.right[1] + 3, 3, 1], 0x3a2614);
    p.rect([f.left[0], f.left[1] + 3, 3, 1], 0x3a2614);
  }
}

function horseModel(kind: Kind) {
  const eared = kind === "donkey" || kind === "mule";
  const leg = (name: string, x: number, z: number, bx: number, bz: number, mirror: boolean): VPart => ({ name, pivot: [x, 14, z], box: [bx, -1.01, bz, 4, 11, 4], uv: [48, 21], mirror });
  const parts: VPart[] = [
    { name: "body", pivot: [0, 11, 5], box: [-5, -8, -17, 10, 10, 22], uv: [0, 32], inflate: 0.05 },
    { name: "tail", parent: "body", pivot: [0, -5, 2], box: [-1.5, 0, 0, 3, 14, 4], uv: [42, 36], rot: [Math.PI / 6, 0, 0] },
    { name: "head_parts", pivot: [0, 4, -12], box: [-2.05, -6, -2, 4, 12, 7], uv: [0, 35], rot: [Math.PI / 6, 0, 0] },
    { name: "head", parent: "head_parts", pivot: [0, 0, 0], box: [-3, -11, -2, 6, 5, 7], uv: [0, 13] },
    { name: "mane", parent: "head_parts", pivot: [0, 0, 0], box: [-1, -11, 5.01, 2, 16, 2], uv: [56, 36] },
    { name: "upper_mouth", parent: "head_parts", pivot: [0, 0, 0], box: [-2, -11, -7, 4, 5, 5], uv: [0, 25] },
    leg("left_hind_leg", 4, 7, -3, -1, true),
    leg("right_hind_leg", -4, 7, -1, -1, false),
    leg("left_front_leg", 4, -12, -3, -1.9, true),
    leg("right_front_leg", -4, -12, -1, -1.9, false),
  ];
  if (eared) {
    parts.push(
      { name: "left_ear", parent: "head_parts", pivot: [1.25, -10, 4], box: [-1, -7, 0, 2, 7, 1], uv: [26, 0], rot: [Math.PI / 12, 0, Math.PI / 12] },
      { name: "right_ear", parent: "head_parts", pivot: [-1.25, -10, 4], box: [-1, -7, 0, 2, 7, 1], uv: [26, 0], rot: [Math.PI / 12, 0, -Math.PI / 12], mirror: true },
    );
  } else {
    parts.push(
      { name: "left_ear", parent: "head_parts", pivot: [0, 0, 0], box: [0.55, -13, 4, 2, 3, 0], uv: [19, 16] },
      { name: "right_ear", parent: "head_parts", pivot: [0, 0, 0], box: [-2.55, -13, 4, 2, 3, 0], uv: [19, 16] },
    );
  }
  const key = (e: Entity) => (kind === "horse" ? `horse_${(e.data.variant as string) ?? "brown"}` : `horse_${kind}`);
  const paint = (k: string) => skin(k, 64, 64, (p) => paintHorse(p, k.slice(6), k === "horse_donkey" || k === "horse_mule"));
  const r = rig(paint(kind === "horse" ? "horse_brown" : `horse_${kind}`), parts);
  const saddle = overlay(r, skin("horse_saddle", 64, 64, paintSaddle), [{ name: "body", pivot: [0, 11, 5], box: [-5, -8, -9, 10, 9, 9], uv: [26, 0], inflate: 0.5 }]);
  const armorList: VPart[] = [
        { name: "body", pivot: [0, 11, 5], box: [-5, -8, -17, 10, 10, 22], uv: [0, 32], inflate: 0.12 },
        { name: "head_parts", pivot: [0, 4, -12], box: [-2.05, -6, -2, 4, 12, 7], uv: [0, 35], inflate: 0.12, rot: [Math.PI / 6, 0, 0] },
        { name: "head", parent: "head_parts", pivot: [0, 0, 0], box: [-3, -11, -2, 6, 5, 7], uv: [0, 13], inflate: 0.12 },
        { name: "upper_mouth", parent: "head_parts", pivot: [0, 0, 0], box: [-2, -11, -7, 4, 5, 5], uv: [0, 25], inflate: 0.12 },
        leg("left_hind_leg", 4, 7, -3, -1, true),
        leg("right_hind_leg", -4, 7, -1, -1, false),
        leg("left_front_leg", 4, -12, -3, -1.9, true),
        leg("right_front_leg", -4, -12, -1, -1.9, false),
      ];
  const armorParts = armorList.map((p): VPart => (p.name.endsWith("_leg") ? { ...p, inflate: 0.12 } : p));
  const armor = kind === "horse" ? overlay(r, skin("horse_armor_gray", 64, 64, paintArmor), armorParts) : null;
  const chests = kind === "donkey" || kind === "mule"
    ? overlay(r, skin("horse_chests", 64, 64, paintChests), [
        { name: "left_chest", pivot: [6.5, 5, -2], box: [-1.5, 0, 0, 3, 8, 8], uv: [26, 21] },
        { name: "right_chest", pivot: [-6.5, 5, -2], box: [-1.5, 0, 0, 3, 8, 8], uv: [44, 21] },
      ])
    : null;
  let armorItem = "";
  return wrap(
    r,
    (a) => {
      const s = Math.cos(a.phase * 0.6662) * 0.8 * a.walk;
      setRot(r.p.left_hind_leg, s, 0, 0);
      setRot(r.p.right_hind_leg, -s, 0, 0);
      setRot(r.p.left_front_leg, -s, 0, 0);
      setRot(r.p.right_front_leg, s, 0, 0);
      const eat = num(a.e, "_eat") > 0 ? 1 : 0;
      const rear = num(a.e, "_rear") > 0 ? 1 : 0;
      setRot(r.p.head_parts, Math.PI / 6 + a.pitch + eat * 2.18 - rear * 0.5, a.yaw, 0);
      setRot(r.p.tail, Math.PI / 6 + a.walk * 0.8 + Math.cos(a.age * 0.1) * 0.05, 0, 0);
      if (rear) {
        setRot(r.p.body, -Math.PI / 4, 0, 0);
        setRot(r.p.left_front_leg, -0.9 + Math.sin(a.age * 0.6) * 0.4, 0, 0);
        setRot(r.p.right_front_leg, -0.9 - Math.sin(a.age * 0.6) * 0.4, 0, 0);
      }
      saddle.root.visible = a.e.data.saddle === true;
      if (chests) chests.root.visible = a.e.data.chest === true;
      if (armor) {
        const item = (a.e.data.armor as string | undefined) ?? "";
        armor.root.visible = !!ARMOR_COLOR[item];
        if (item !== armorItem && ARMOR_COLOR[item]) {
          armor.root.traverse((o) => {
            const m = (o as { material?: { userData: Record<string, unknown> } }).material;
            if (m) m.userData.base = ARMOR_COLOR[item];
          });
        }
        armorItem = item;
        syncOverlay(r);
      }
    },
    { scale: eared ? (kind === "mule" ? 0.92 : 0.87) : 1.1, head: ["head_parts"], babyHead: 1.3, variant: key, variantSkin: paint },
  );
}

const FOOD = ["golden_carrot", "golden_apple", "enchanted_golden_apple"];
const HEAL: Record<string, number> = { wheat: 2, sugar: 1, hay_block: 20, apple: 3, golden_carrot: 4, golden_apple: 10, enchanted_golden_apple: 10 };
const TEMPER: Record<string, number> = { wheat: 3, sugar: 3, apple: 3, golden_carrot: 5, golden_apple: 10, enchanted_golden_apple: 10 };

function breedOpts(kind: Kind): AnimalOpts {
  return {
    food: FOOD,
    panic: 1.2,
    noBreed: kind === "mule" || kind === "skeleton_horse" || kind === "zombie_horse",
    mates: kind === "horse" ? ["donkey"] : kind === "donkey" ? ["horse"] : undefined,
    babyOf: (a, b) => (a.type === b.type ? a.type : "mule"),
    breed(a, b, baby, ctx) {
      if (a.type === b.type) baby.data.variant = ctx.random() < 0.5 ? a.data.variant : b.data.variant;
      const avg = (k: string) => (num(a, k) + num(b, k) + ((k === "hp" ? 15 + ctx.random() * 15 : k === "spd" ? 0.1125 + ctx.random() * 0.225 : 0.4 + ctx.random() * 0.6))) / 3;
      baby.data.hp = avg("hp");
      baby.data.spd = avg("spd");
      baby.data.jmp = avg("jmp");
    },
  };
}

function rollStats(e: Entity, ctx: GameCtx, kind: Kind) {
  const r = ctx.random;
  if (kind === "horse") {
    e.data.hp = 15 + Math.floor(r() * 8) + Math.floor(r() * 9);
    e.data.spd = (0.45 + r() * 0.3 + r() * 0.3 + r() * 0.3) * 0.25;
    e.data.jmp = 0.4 + r() * 0.2 + r() * 0.2 + r() * 0.2;
    if (!e.data.variant) e.data.variant = Object.keys(COATS)[Math.floor(r() * 7)];
  } else if (kind === "donkey" || kind === "mule") {
    e.data.hp = 15 + Math.floor(r() * 16);
    e.data.spd = 0.175;
    e.data.jmp = 0.5;
  } else {
    e.data.hp = kind === "skeleton_horse" ? 15 : 25;
    e.data.spd = 0.2;
    e.data.jmp = 0.4 + r() * 0.6;
  }
  e.health = Math.min(e.health, e.data.hp as number);
}

function ridden(e: Entity, ctx: GameCtx, kind: Kind) {
  const ctl = rider(ctx, e)!;
  if (!e.data.tame) {
    wander(e, ctx, num(e, "_speed") * 1.2, 1 / 20, 6);
    if (ctx.random() < 1 / 50) {
      const temper = num(e, "temper");
      if (temper > 0 && Math.floor(ctx.random() * 100) < temper) {
        e.data.tame = true;
        e.data.owner = "player";
        e.data.persistent = true;
        const p = e.body.pos;
        ctx.emit({ type: "particles", kind: "heart", x: p.x, y: p.y + e.body.height, z: p.z, count: 7 });
      } else {
        e.data.temper = Math.min(100, temper + 5);
        e.data._rear = 20;
        dismountPlayer(ctx);
        sound(ctx, e, `entity.${kind}.angry`);
      }
    }
    return;
  }
  clearPath(e);
  if (!e.data.saddle) {
    e.yaw = ctl.yaw;
    e.headYaw = ctl.yaw;
    return;
  }
  const b = e.body;
  steer(e, ctx, ctl, num(e, "spd", 0.225));
  if (ctl.jumpCharge > 0 && b.onGround) {
    const v = num(e, "jmp", 0.7) * ctl.jumpCharge * blockJumpFactor(ctx.world, b);
    b.vel.y = v;
    if (ctl.forward > 0) {
      b.vel.x += -0.4 * Math.sin(e.yaw) * ctl.jumpCharge;
      b.vel.z += -0.4 * Math.cos(e.yaw) * ctl.jumpCharge;
    }
    sound(ctx, e, kind === "horse" ? "entity.horse.jump" : `entity.${kind}.jump`, 0.4);
  }
  if (b.onGround && (ctl.forward !== 0 || ctl.strafe !== 0) && e.age % 10 === 0 && kind === "horse" && num(e, "spd") > 0.25) sound(ctx, e, "entity.horse.gallop", 0.15);
}

function horseDef(kind: Kind): MobDef {
  const eared = kind === "donkey" || kind === "mule";
  const undead = kind === "skeleton_horse" || kind === "zombie_horse";
  const opts = breedOpts(kind);
  const names: Record<Kind, string> = { horse: "Horse", donkey: "Donkey", mule: "Mule", skeleton_horse: "Skeleton Horse", zombie_horse: "Zombie Horse" };
  const def: MobDef = {
    type: kind,
    displayName: names[kind],
    category: "passive",
    width: 1.3964844,
    height: eared ? (kind === "mule" ? 1.6 : 1.5) : 1.6,
    maxHealth: kind === "horse" ? 22 : kind === "zombie_horse" ? 25 : 15,
    speed: kind === "horse" ? 0.225 : eared ? 0.175 : 0.2,
    xp: [1, 3],
    drops: kind === "skeleton_horse" ? [{ item: "bone", count: [0, 2] }] : kind === "zombie_horse" ? [{ item: "rotten_flesh", count: [0, 2] }] : [{ item: "leather", count: [0, 2] }],
    sounds: { ambient: `entity.${kind}.ambient`, hurt: `entity.${kind}.hurt`, death: `entity.${kind}.death`, step: eared ? "entity.donkey.step" : undead ? `entity.${kind}.step` : "entity.horse.step" },
    spawn: kind === "horse" || kind === "donkey"
      ? { dims: ["overworld"], biomes: kind === "donkey" ? ["plains", "sunflower_plains", "savanna", "meadow"] : ["plains", "sunflower_plains", "savanna", "savanna_plateau"], light: "grass", group: kind === "donkey" ? [1, 3] : [2, 6], weight: kind === "donkey" ? 1 : 5 }
      : undefined,
    seat: eared ? 0.4 : 0.72,
    createModel: () => horseModel(kind),
    tick(e, ctx) {
      if (e.data.hp === undefined) rollStats(e, ctx, kind);
      e.body.stepHeight = 1;
      e.maxHealth = e.data.hp as number;
      if (undead) e.data.undead = true;
      if (kind === "skeleton_horse") e.data.waterBreathing = true;
      const rear = num(e, "_rear");
      if (rear > 0) e.data._rear = rear - 1;
      if (rider(ctx, e)) {
        ridden(e, ctx, kind);
        return;
      }
      const eat = num(e, "_eat");
      if (eat > 0) {
        e.data._eat = eat - 1;
        if (num(e, "_panic") <= 0) return;
      } else if (!isBaby(e) && e.body.onGround && ctx.random() < 1 / 300) e.data._eat = 30;
      animalAI(e, ctx, opts);
    },
    onInteract(e, ctx, held) {
      const item = held?.item;
      if (item && HEAL[item] !== undefined && (e.health < e.maxHealth || (!e.data.tame && TEMPER[item])) && !(FOOD.includes(item) && e.data.tame && e.health >= e.maxHealth)) {
        if (undead) return false;
        useItem(ctx);
        e.health = Math.min(e.maxHealth, e.health + HEAL[item]);
        if (!e.data.tame) e.data.temper = Math.min(100, num(e, "temper") + (TEMPER[item] ?? 0));
        sound(ctx, e, `entity.${kind}.eat`);
        return true;
      }
      if (e.data.tame && feed(e, ctx, def, held, opts)) return true;
      if (isBaby(e)) return false;
      if (item === "saddle" && e.data.tame && !e.data.saddle) {
        e.data.saddle = true;
        useItem(ctx);
        sound(ctx, e, "entity.horse.saddle", 0.5, 1);
        return true;
      }
      if (kind === "horse" && item?.endsWith("_horse_armor") && e.data.tame && !isBaby(e)) {
        if (e.data.armor) ctx.entities.dropItem({ item: e.data.armor as string, count: 1 }, e.body.pos.x, e.body.pos.y + 1, e.body.pos.z);
        e.data.armor = item;
        useItem(ctx);
        sound(ctx, e, "entity.horse.armor", 0.5, 1);
        return true;
      }
      if ((kind === "donkey" || kind === "mule") && item === "chest" && e.data.tame && !e.data.chest && !isBaby(e)) {
        e.data.chest = true;
        useItem(ctx);
        sound(ctx, e, `entity.${kind}.chest`, 1, 1);
        return true;
      }
      if (undead && !e.data.tame) return false;
      if (item && item !== "saddle" && item !== "lead" && !item.endsWith("horse_armor") && HEAL[item] === undefined && !e.data.tame) return false;
      return mountPlayer(ctx, e);
    },
  };
  return def;
}

export const HORSE = horseDef("horse");
export const DONKEY = horseDef("donkey");
export const MULE = horseDef("mule");
export const SKELETON_HORSE = horseDef("skeleton_horse");
export const ZOMBIE_HORSE = horseDef("zombie_horse");
