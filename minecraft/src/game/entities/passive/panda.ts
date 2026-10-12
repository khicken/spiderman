import type { Entity, GameCtx, ItemStack, MobDef } from "../../contracts";
import { clearPath, idleLook, lookAt, meleeAttack, moveTo, panic, targetPos, wander, type Target } from "../ai";
import { isBaby } from "../geom";
import { rig, wrap, setRot, look, quadLegs, type VPart } from "../rig";
import { skin, type Pix } from "./paint";
import { breedTick, feed, followParent, num, sound, temptTick, type AnimalOpts } from "./common";
import { quadruped } from "./farm";

const GENES = ["normal", "lazy", "worried", "playful", "brown", "weak", "aggressive"] as const;
type Gene = (typeof GENES)[number];
const RECESSIVE = new Set<Gene>(["brown", "weak"]);
const near: Entity[] = [];

function randomGene(ctx: GameCtx): Gene {
  const i = Math.floor(ctx.random() * 16);
  if (i === 0) return "lazy";
  if (i === 1) return "worried";
  if (i === 2) return "playful";
  if (i === 4) return "aggressive";
  if (i < 9) return "weak";
  if (i < 11) return "brown";
  return "normal";
}

export function pandaVariant(main: Gene, hidden: Gene): Gene {
  if (RECESSIVE.has(main)) return main === hidden ? main : "normal";
  return main;
}

function paintPanda(p: Pix, gene: Gene) {
  const brown = gene === "brown";
  const W = brown ? [0xc8b29a, 0xbca68e, 0xd2bea6] : [0xf2f2f2, 0xe8e8e8, 0xfafafa];
  const K = brown ? [0x5e3e2a, 0x543626, 0x684632] : [0x222224, 0x1a1a1c, 0x2a2a2c];
  const head = p.fillCuboid(0, 6, 13, 10, 9, W);
  const f = head.front;
  const drop = gene === "worried" ? 1 : 0;
  p.map(f[0], f[1] + 3, [".KK.......KK.", ".KKK.....KKK.", ".KKK.....KKK.", drop ? ".KKK.....KKK." : "..KK.....KK.."], { K: K[0] });
  const eyeY = f[1] + 4 + (gene === "lazy" ? 1 : 0);
  const pupil = gene === "aggressive" ? 0xc02020 : 0x0a0a0a;
  const shine = gene === "lazy" ? K[0] : 0xffffff;
  p.px(f[0] + 2, eyeY, pupil);
  p.px(f[0] + 3, eyeY, shine);
  p.px(f[0] + 10, eyeY, pupil);
  p.px(f[0] + 9, eyeY, shine);
  if (gene === "aggressive") {
    p.rect([f[0] + 1, f[1] + 2, 4, 1], K[2]);
    p.rect([f[0] + 8, f[1] + 2, 4, 1], K[2]);
  }
  if (gene === "weak") {
    p.px(f[0] + 2, eyeY + 1, 0x80c0f0);
    p.px(f[0] + 10, eyeY + 1, 0x80c0f0);
  }
  const nose = p.fillCuboid(45, 16, 7, 5, 2, W);
  p.rect([nose.front[0] + 2, nose.front[1], 3, 2], 0x101010);
  if (gene === "playful") p.rect([nose.front[0] + 3, nose.front[1] + 3, 2, 2], 0xe07080);
  p.fillCuboid(52, 25, 5, 4, 1, K);
  const body = p.fillCuboid(0, 25, 19, 26, 13, W);
  for (const r of [body.right, body.left, body.front, body.back]) p.noise([r[0], r[1], r[2], 8], K);
  p.noise(body.top, K);
  p.fillCuboid(40, 0, 6, 9, 6, K);
}

function pandaModel() {
  const parts = quadruped(
    9,
    { name: "head", pivot: [0, 11.5, -17], box: [-6.5, -5, -4, 13, 10, 9], uv: [0, 6] },
    { name: "body", pivot: [0, 14, 0], box: [-9.5, -13, -6.5, 19, 26, 13], uv: [0, 25], rot: [Math.PI / 2, 0, 0] },
    [40, 0],
    6,
    5.5,
    9,
    -9,
    [
      { name: "nose", parent: "head", pivot: [0, 0, 0], box: [-3.5, 0, -6, 7, 5, 2], uv: [45, 16] },
      { name: "left_ear", parent: "head", pivot: [0, 0, 0], box: [3.5, -8, -1, 5, 4, 1], uv: [52, 25] },
      { name: "right_ear", parent: "head", pivot: [0, 0, 0], box: [-8.5, -8, -1, 5, 4, 1], uv: [52, 25] },
    ],
  );
  const paint = (k: string) => skin(k, 64, 64, (p) => paintPanda(p, k.slice(6) as Gene));
  const r = rig(paint("panda_normal"), parts);
  const base = r.p.body.position.clone();
  const headBase = r.p.head.position.clone();
  const legs = ["left_front_leg", "right_front_leg"].map((n) => [r.p[n], r.p[n].position.clone()] as const);
  const hind = ["left_hind_leg", "right_hind_leg"].map((n) => [r.p[n], r.p[n].position.clone()] as const);
  return wrap(
    r,
    (a) => {
      const e = a.e;
      r.root.rotation.set(0, 0, 0);
      r.root.position.set(0, 0, 0);
      r.p.body.position.copy(base);
      r.p.head.position.copy(headBase);
      for (const [o, p0] of legs) o.position.copy(p0);
      for (const [o, p0] of hind) o.position.copy(p0);
      quadLegs(r, a, 1.4);
      look(r.p.head, a);
      if (num(e, "_sit") > 0 || num(e, "_eat") > 0) {
        setRot(r.p.body, Math.PI / 2 - 1.2, 0, 0);
        r.p.body.position.set(base.x, base.y + 0.375, base.z + 0.25);
        r.p.head.position.set(headBase.x, headBase.y + 0.95, headBase.z + 0.85);
        for (const [o, p0] of legs) o.position.set(p0.x, p0.y + 0.8, p0.z + 0.4);
        for (const [o, p0] of hind) o.position.set(p0.x, p0.y - 0.375, p0.z - 0.2);
        setRot(r.p.left_front_leg, -1.3 + (num(e, "_eat") > 0 ? Math.sin(a.age * 0.5) * 0.15 : 0), 0, 0);
        setRot(r.p.right_front_leg, -1.3, 0, 0);
        setRot(r.p.left_hind_leg, -1.4, 0, 0.2);
        setRot(r.p.right_hind_leg, -1.4, 0, -0.2);
        look(r.p.head, a, -0.4 + (num(e, "_eat") > 0 ? Math.sin(a.age * 0.6) * 0.1 : 0));
      }
      if (num(e, "_lie") > 0) {
        r.root.rotation.z = Math.PI;
        r.root.position.y = 1.25;
        setRot(r.p.left_front_leg, 0.3 + Math.sin(a.age * 0.1) * 0.2, 0, 0);
        setRot(r.p.right_front_leg, 0.3 - Math.sin(a.age * 0.1) * 0.2, 0, 0);
      }
      const roll = num(e, "_roll");
      if (roll > 0) {
        r.root.rotation.x = -((32 - roll + a.pt) / 32) * Math.PI * 2;
        r.root.position.y = Math.abs(Math.sin(r.root.rotation.x)) * 0.5;
      }
      if (num(e, "_sneeze") > 0) look(r.p.head, a, -0.3 * Math.sin(num(e, "_sneeze") * 0.3));
    },
    { head: [], variant: (e) => `panda_${(e.data.variant as string) ?? "normal"}`, variantSkin: paint },
  );
}

const FOOD = ["bamboo"];
const opts: AnimalOpts = {
  food: FOOD,
  breed(a, b, baby, ctx) {
    const pickA = ctx.random() < 0.5 ? a.data.mainGene : a.data.hiddenGene;
    const pickB = ctx.random() < 0.5 ? b.data.mainGene : b.data.hiddenGene;
    let main = pickA as Gene;
    if (ctx.random() < 1 / 32) main = randomGene(ctx);
    baby.data.mainGene = main;
    baby.data.hiddenGene = pickB;
    baby.data.variant = pandaVariant(main, pickB as Gene);
  },
};

function grabFood(e: Entity, ctx: GameCtx) {
  const p = e.body.pos;
  ctx.entities.near(p.x, p.y, p.z, 6, near);
  let item: Entity | null = null;
  for (const o of near) {
    const s = o.data.stack as ItemStack | undefined;
    if (o.type === "item" && !o.data._remove && s && (s.item === "bamboo" || s.item === "cake")) {
      item = o;
      break;
    }
  }
  near.length = 0;
  if (!item) return false;
  const ip = item.body.pos;
  const dx = ip.x - p.x, dz = ip.z - p.z;
  if (dx * dx + dz * dz < 2.5) {
    const s = item.data.stack as ItemStack;
    if (s.count > 1) s.count--;
    else item.data._remove = true;
    clearPath(e);
    e.data._eat = 100 + Math.floor(ctx.random() * 100);
    return true;
  }
  moveTo(e, ctx, ip.x, ip.y, ip.z, num(e, "_speed", 0.15) * 1.2);
  return true;
}

export const PANDA: MobDef = {
  type: "panda",
  displayName: "Panda",
  category: "passive",
  width: 1.3,
  height: 1.25,
  maxHealth: 20,
  speed: 0.15,
  attackDamage: 6,
  xp: [1, 3],
  drops: [{ item: "bamboo", count: [0, 2] }],
  sounds: { ambient: "entity.panda.ambient", hurt: "entity.panda.hurt", death: "entity.panda.death", step: "entity.panda.step" },
  spawn: { dims: ["overworld"], biomes: ["bamboo_jungle", "jungle"], light: "grass", group: [1, 2], weight: 80 },
  createModel: pandaModel,
  tick(e, ctx) {
    if (!e.data.mainGene) {
      e.data.mainGene = randomGene(ctx);
      e.data.hiddenGene = randomGene(ctx);
      e.data.variant = pandaVariant(e.data.mainGene as Gene, e.data.hiddenGene as Gene);
    }
    const gene = e.data.variant as Gene;
    if (gene === "weak" && e.maxHealth !== 10) {
      e.maxHealth = 10;
      e.health = Math.min(e.health, 10);
    }
    e.data._speed = gene === "lazy" ? 0.07 : 0.15;
    if (gene === "worried") e.data.ambientInterval = ctx.time.thunder > 0.5 ? 40 : 80;
    for (const k of ["_eat", "_sit", "_lie", "_roll", "_sneeze"]) if (num(e, k) > 0) e.data[k] = num(e, k) - 1;
    const sneeze = num(e, "_sneeze");
    if (sneeze === 1) {
      sound(ctx, e, "entity.panda.sneeze");
      const p = e.body.pos;
      ctx.emit({ type: "particles", kind: "splash", x: p.x, y: p.y + 0.8, z: p.z - 0.5, count: 6 });
      if (ctx.random() < 1 / 700) ctx.entities.dropItem({ item: "slime_ball", count: 1 }, p.x, p.y + 0.5, p.z);
    }
    if (sneeze === 0 && (isBaby(e) || gene === "weak") && ctx.random() < (gene === "weak" ? 1 / 500 : 1 / 6000)) {
      e.data._sneeze = 20;
      sound(ctx, e, "entity.panda.pre_sneeze");
    }
    if (num(e, "_eat") > 0) {
      clearPath(e);
      if (e.age % 20 === 0) sound(ctx, e, "entity.panda.eat", 0.6);
      if (num(e, "_panic") <= 0) return;
      e.data._eat = 0;
    }
    if (num(e, "_roll") > 0) {
      clearPath(e);
      const s = Math.sin(e.yaw), c = Math.cos(e.yaw);
      e.data._mvx = -s * 0.05;
      e.data._mvz = -c * 0.05;
      return;
    }
    if (num(e, "_lie") > 0 || num(e, "_sit") > 0) {
      clearPath(e);
      if (num(e, "_panic") <= 0 && e.data._target === undefined) return;
      e.data._lie = 0;
      e.data._sit = 0;
    }
    if (gene === "aggressive") {
      const t = e.data._hurtBy as Target;
      const tp = targetPos(ctx, t);
      if (tp && (t !== "player" || (ctx.player.gameMode !== "creative" && ctx.player.gameMode !== "spectator"))) {
        e.data._target = t;
        e.data._panic = 0;
        lookAt(e, tp.x, tp.y + 1, tp.z);
        moveTo(e, ctx, tp.x, tp.y, tp.z, 0.15 * 1.2);
        meleeAttack(e, ctx, 6);
        if (e.age % 100 === 0 && ctx.random() < 0.3) {
          e.data._hurtBy = undefined;
          e.data._target = undefined;
        }
        return;
      }
      e.data._target = undefined;
    }
    if (gene === "worried" && ctx.time.thunder > 0.5) {
      clearPath(e);
      idleLook(e, ctx);
      return;
    }
    if (panic(e, ctx, 2)) return;
    if (breedTick(e, ctx, opts)) return;
    if (grabFood(e, ctx)) return;
    if (temptTick(e, ctx, FOOD, 1)) return;
    if (followParent(e, ctx)) return;
    if (e.body.onGround) {
      if ((gene === "playful" || isBaby(e)) && ctx.random() < 1 / 400) {
        e.data._roll = 32;
        sound(ctx, e, "entity.panda.cant_breed", 0.4);
        return;
      }
      if (gene === "lazy" && ctx.random() < 1 / 300) {
        e.data._lie = 100 + Math.floor(ctx.random() * 200);
        return;
      }
      if (ctx.random() < 1 / 1200) {
        e.data._sit = 60 + Math.floor(ctx.random() * 100);
        return;
      }
    }
    if (!wander(e, ctx, num(e, "_speed", 0.15))) idleLook(e, ctx);
  },
  onInteract(e, ctx, held) {
    if (held?.item !== "bamboo") return false;
    if (!isBaby(e) && num(e, "_eat") <= 0 && ((e.data.breedCd as number) ?? 0) > 0) {
      ctx.inventory.removeHeld(ctx.player.gameMode === "creative" ? 0 : 1);
      e.data._eat = 100;
      return true;
    }
    return feed(e, ctx, PANDA, held, opts);
  },
};
