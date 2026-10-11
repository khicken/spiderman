import type { Entity, MobDef } from "../../contracts";
import { rig, wrap, setRot, type VPart } from "../rig";
import { skin, shade, type Pix } from "./paint";
import { animalAI, feed, num, sound, useItem, type AnimalOpts } from "./common";
import { isBaby } from "../geom";

const COATS: Record<string, [number, number]> = {
  white: [0xe8e4dc, 0xcfc8bc],
  creamy: [0xc9a26d, 0x8e6a3e],
  chestnut: [0x9a5a2e, 0x5a3418],
  brown: [0x6e4a2c, 0x3a2414],
  black: [0x2c2522, 0x141110],
  gray: [0x8a8580, 0x4a4643],
  dark_brown: [0x4a3020, 0x241810],
  donkey: [0x8a7b6a, 0x4e4438],
};

function paintHorse(p: Pix, coat: string, donkey: boolean) {
  const [c, mane] = COATS[coat] ?? COATS.brown;
  const B = [c, shade(c, 0.94), shade(c, 1.05)];
  const M = [mane, shade(mane, 0.9)];
  p.fillCuboid(0, 32, 10, 10, 22, B);
  p.fillCuboid(0, 35, 4, 12, 7, B);
  const head = p.fillCuboid(0, 13, 6, 5, 7, B);
  p.px(head.right[0] + 2, head.right[1] + 1, 0x101010);
  p.px(head.left[0] + 4, head.left[1] + 1, 0x101010);
  const mouth = p.fillCuboid(0, 25, 4, 5, 5, donkey ? [0xc8bba8, 0xbcae9a] : B);
  p.rect([mouth.front[0], mouth.front[1] + 1, 1, 1], 0x202020);
  p.rect([mouth.front[0] + 3, mouth.front[1] + 1, 1, 1], 0x202020);
  p.fillCuboid(56, 36, 2, 16, 2, M);
  p.fillCuboid(42, 36, 3, 14, 4, M);
  const leg = p.fillCuboid(48, 21, 4, 11, 4, B);
  p.rect([48, leg.front[1] + 9, 16, 2], donkey ? 0x3a342c : 0x4a4038);
  p.fillCuboid(19, 16, 2, 3, 0, B);
  if (donkey) p.fillCuboid(26, 0, 2, 7, 1, B);
}

function horseModel(donkey: boolean) {
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
  if (donkey) {
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
  const key = (e: Entity) => (donkey ? "horse_donkey" : `horse_${(e.data.variant as string) ?? "brown"}`);
  const paint = (k: string) => skin(k, 64, 64, (p) => paintHorse(p, k.slice(6), k === "horse_donkey"));
  const r = rig(paint(donkey ? "horse_donkey" : "horse_brown"), parts);
  return wrap(
    r,
    (a) => {
      const s = Math.cos(a.phase * 0.6662) * 0.8 * a.walk;
      setRot(r.p.left_hind_leg, s, 0, 0);
      setRot(r.p.right_hind_leg, -s, 0, 0);
      setRot(r.p.left_front_leg, -s, 0, 0);
      setRot(r.p.right_front_leg, s, 0, 0);
      const eat = num(a.e, "_eat") > 0 ? 1 : 0;
      setRot(r.p.head_parts, Math.PI / 6 + a.pitch + eat * 2.18, a.yaw, 0);
      setRot(r.p.tail, Math.PI / 6 + a.walk * 0.8 + Math.cos(a.age * 0.1) * 0.05, 0, 0);
    },
    { scale: donkey ? 0.87 : 1.1, head: ["head_parts"], babyHead: 1.3, variant: key, variantSkin: paint },
  );
}

const FOOD = ["golden_carrot", "golden_apple", "enchanted_golden_apple"];
const HEAL: Record<string, number> = { wheat: 2, sugar: 1, hay_block: 20, apple: 3, golden_carrot: 4, golden_apple: 10, enchanted_golden_apple: 10 };
const horseOpts: AnimalOpts = {
  food: FOOD,
  panic: 1.2,
  breed(a, b, baby, ctx) {
    baby.data.variant = ctx.random() < 0.5 ? a.data.variant : b.data.variant;
    baby.data.hp = ((a.data.hp as number) + (b.data.hp as number)) / 2;
  },
};

function horseDef(donkey: boolean): MobDef {
  const name = donkey ? "donkey" : "horse";
  const def: MobDef = {
    type: name,
    displayName: donkey ? "Donkey" : "Horse",
    category: "passive",
    width: donkey ? 1.3964844 : 1.3964844,
    height: donkey ? 1.5 : 1.6,
    maxHealth: donkey ? 15 : 22,
    speed: donkey ? 0.175 : 0.225,
    xp: [1, 3],
    drops: [{ item: "leather", count: [0, 2] }],
    sounds: { ambient: `entity.${name}.ambient`, hurt: `entity.${name}.hurt`, death: `entity.${name}.death`, step: donkey ? "entity.donkey.step" : "entity.horse.step" },
    spawn: { dims: ["overworld"], biomes: donkey ? ["plains", "sunflower_plains", "savanna", "meadow"] : ["plains", "sunflower_plains", "savanna", "savanna_plateau"], light: "grass", group: donkey ? [1, 3] : [2, 6], weight: donkey ? 1 : 5 },
    createModel: () => horseModel(donkey),
    tick(e, ctx) {
      if (e.data.hp === undefined) {
        const r = ctx.random;
        e.data.hp = donkey ? 15 + Math.floor(r() * 16) : 15 + Math.floor(r() * 8) + Math.floor(r() * 9);
        e.health = Math.min(e.health, e.data.hp as number);
        if (!donkey) e.data.variant = Object.keys(COATS)[Math.floor(r() * 7)];
      }
      e.maxHealth = e.data.hp as number;
      const eat = num(e, "_eat");
      if (eat > 0) {
        e.data._eat = eat - 1;
        if (num(e, "_panic") <= 0) return;
      } else if (!isBaby(e) && e.body.onGround && ctx.random() < 1 / 300) e.data._eat = 30;
      animalAI(e, ctx, horseOpts);
    },
    onInteract(e, ctx, held) {
      if (held && HEAL[held.item] !== undefined && e.health < e.maxHealth && !FOOD.includes(held.item)) {
        useItem(ctx);
        e.health = Math.min(e.maxHealth, e.health + HEAL[held.item]);
        sound(ctx, e, `entity.${name}.eat`);
        return true;
      }
      return feed(e, ctx, def, held, horseOpts);
    },
  };
  return def;
}

export const HORSE = horseDef(false);
export const DONKEY = horseDef(true);
