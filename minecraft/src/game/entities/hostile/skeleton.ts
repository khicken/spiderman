import { equipMob } from "../armor-layer";
import type { Entity, GameCtx, MobDef } from "../../contracts";
import { applyPhysics, canSee, clearPath, idleLook, lookAt, meleeAttack, moveTo } from "../ai";
import { blockDef } from "../../blocks/registry";
import {
  addEffect, avoid, burnInDaylight, chase, diffId, hurtAmount, idle, naturalSpawn, discard, num, shootArrow, sound, strafe,
  targetInfo, updateTarget,
} from "./brain";
import { paintBogged, paintSkeletonSkin, paintStray, paintWitherSkeleton, undeadModel } from "./looks-undead";
import { MONSTER_BIOMES, SNOWY, SWAMPS } from "./spawns";

interface BowCfg {
  type: string;
  sound: string;
  arrow?: { effect: string; ticks: number };
  interval: [number, number];
}

function bowAttack(e: Entity, ctx: GameCtx, cfg: BowCfg, speed: number): void {
  const t = e.data._target as "player" | number;
  const info = targetInfo(ctx, t);
  if (!info) return;
  const b = e.body;
  const d2 = info.pos.distanceToSquared(b.pos);
  const see = canSee(ctx, e, info.pos.x, info.pos.y + info.height * 0.85, info.pos.z);
  let seeTime = num(e, "_see");
  if (see !== seeTime > 0) seeTime = 0;
  seeTime += see ? 1 : -1;
  e.data._see = seeTime;
  const maxSq = 15 * 15;
  let strafeT = num(e, "_strafeT", -1);
  if (d2 <= maxSq && seeTime >= 20) {
    clearPath(e);
    strafeT++;
  } else {
    moveTo(e, ctx, info.pos.x, info.pos.y, info.pos.z, speed);
    strafeT = -1;
  }
  if (strafeT >= 20) {
    if (ctx.random() < 0.3) e.data._cw = !e.data._cw;
    if (ctx.random() < 0.3) e.data._back = !e.data._back;
    strafeT = 0;
  }
  e.data._strafeT = strafeT;
  if (strafeT > -1) {
    if (d2 > maxSq * 0.75) e.data._back = false;
    else if (d2 < maxSq * 0.25) e.data._back = true;
    strafe(e, ctx, info.pos.x, info.pos.z, e.data._back ? -0.5 : 0.5, e.data._cw ? 0.5 : -0.5, speed);
  }
  lookAt(e, info.pos.x, info.pos.y + info.height * 0.85, info.pos.z);
  const using = num(e, "_draw");
  if (using > 0) {
    if (!see && seeTime < -60) e.data._draw = 0;
    else if (see) {
      e.data._draw = using + 1;
      if (using + 1 >= 20) {
        e.data._draw = 0;
        const power = Math.min(1, ((using + 1) / 20) ** 2 / 3 + ((using + 1) / 20) * 2 / 3);
        const extra = cfg.arrow ? { potion: cfg.arrow.effect, effects: [{ id: cfg.arrow.effect, ticks: cfg.arrow.ticks, amplifier: 0 }] } : {};
        shootArrow(e, ctx, t, power, extra);
        sound(ctx, e, cfg.sound + ".shoot", 1, 1 / (ctx.random() * 0.4 + 0.8));
        e.data._atkCd = diffId(ctx) === 3 ? cfg.interval[0] : cfg.interval[1];
      }
    } else e.data._draw = using + 1;
  } else {
    const cd = num(e, "_atkCd") - 1;
    e.data._atkCd = cd;
    if (cd <= 0 && seeTime >= -60) e.data._draw = 1;
  }
  e.data.aggressive = num(e, "_draw") > 0;
}

function skeletonTick(cfg: BowCfg & { burns: boolean; sword?: boolean; witherHit?: boolean }) {
  return (e: Entity, ctx: GameCtx) => {
    if (cfg.type === "skeleton" || cfg.type === "stray" || cfg.type === "bogged") equipMob(e, ctx);
    if (naturalSpawn(e)) {
      const p = e.body.pos;
      if (cfg.type === "wither_skeleton" || cfg.type === "stray") {
        const floor = blockDef(ctx.world.getBlock(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z))).name;
        if (cfg.type === "wither_skeleton" && floor !== "nether_bricks") return discard(e);
        if (cfg.type === "stray" && ctx.world.getSkyLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) < 15) return discard(e);
      }
    }
    const hurt = hurtAmount(e);
    const speed = 0.25;
    if (cfg.burns) burnInDaylight(e, ctx);
    if (!cfg.sword && avoid(e, ctx, ["wolf"], 6, speed)) {
      applyPhysics(e, ctx);
      return;
    }
    const t = updateTarget(e, ctx, { range: 16 }, hurt);
    if (t !== undefined) {
      if (cfg.sword || e.data.held === "") {
        chase(e, ctx, t, speed * 1.2);
        e.data.aggressive = true;
        if (meleeAttack(e, ctx, cfg.sword ? 8 : 2)) {
          if (cfg.witherHit && t === "player") addEffect(ctx.player.effects, "wither", 200);
          if (cfg.witherHit && typeof t === "number") {
            const o = ctx.entities.get(t);
            if (o) addEffect(o.effects, "wither", 200);
          }
        }
      } else bowAttack(e, ctx, cfg, speed);
    } else {
      e.data._draw = 0;
      e.data.aggressive = false;
      idle(e, ctx, speed);
      idleLook(e, ctx);
    }
    applyPhysics(e, ctx);
    if (num(e, "_swing") > 0) e.data._swing = num(e, "_swing") - 1;
  };
}

const SOUNDS = (s: string) => ({ ambient: s + ".ambient", hurt: s + ".hurt", death: s + ".death", step: s + ".step" });
const BONES: MobDef["drops"] = [{ item: "bone", count: [0, 2] }, { item: "arrow", count: [0, 2] }];

function equipmentDrop(e: Entity, ctx: GameCtx, item: string): void {
  const held = (e.data.held as string | undefined) ?? item;
  if (held && ctx.random() < 0.085) ctx.entities.dropItem({ item: held, count: 1, damage: Math.floor(ctx.random() * 300) }, e.body.pos.x, e.body.pos.y + 0.5, e.body.pos.z);
}

const witherTick = skeletonTick({ type: "wither_skeleton", sound: "entity.wither_skeleton", interval: [20, 40], burns: false, sword: true, witherHit: true });

function tippedDrop(e: Entity, ctx: GameCtx, potion: string): void {
  if (ctx.random() < 0.5) ctx.entities.dropItem({ item: "tipped_arrow", count: 1, data: { potion } }, e.body.pos.x, e.body.pos.y + 0.5, e.body.pos.z);
}

export const SKELETONS: MobDef[] = [
  {
    type: "skeleton",
    displayName: "Skeleton",
    category: "hostile",
    width: 0.6,
    height: 1.99,
    maxHealth: 20,
    speed: 0.25,
    xp: [5, 5],
    drops: BONES,
    sounds: SOUNDS("entity.skeleton"),
    spawn: { dims: ["overworld", "nether"], biomes: [...MONSTER_BIOMES, "soul_sand_valley"], light: "dark", group: [4, 4], weight: 100 },
    createModel: () => undeadModel({ key: "skeleton", paint: paintSkeletonSkin, parts: "skeleton", arms: "bow", held: "bow" }),
    tick: skeletonTick({ type: "skeleton", sound: "entity.skeleton", interval: [20, 40], burns: true }),
    onDeath: (e, ctx) => equipmentDrop(e, ctx, "bow"),
  },
  {
    type: "stray",
    displayName: "Stray",
    category: "hostile",
    width: 0.6,
    height: 1.99,
    maxHealth: 20,
    speed: 0.25,
    xp: [5, 5],
    drops: BONES,
    sounds: SOUNDS("entity.stray"),
    spawn: { dims: ["overworld"], biomes: SNOWY, light: "dark", group: [4, 4], weight: 80 },
    createModel: () => undeadModel({ key: "stray", paint: paintStray, parts: "skeleton", arms: "bow", held: "bow" }),
    tick: skeletonTick({ type: "stray", sound: "entity.stray", interval: [20, 40], burns: true, arrow: { effect: "slowness", ticks: 600 } }),
    onDeath: (e, ctx) => {
      equipmentDrop(e, ctx, "bow");
      tippedDrop(e, ctx, "slowness");
    },
  },
  {
    type: "bogged",
    displayName: "Bogged",
    category: "hostile",
    width: 0.6,
    height: 1.99,
    maxHealth: 16,
    speed: 0.25,
    xp: [5, 5],
    drops: BONES,
    sounds: SOUNDS("entity.bogged"),
    spawn: { dims: ["overworld"], biomes: SWAMPS, light: "dark", group: [4, 4], weight: 50 },
    createModel: () => undeadModel({ key: "bogged", paint: paintBogged, parts: "skeleton", arms: "bow", held: "bow" }),
    tick: skeletonTick({ type: "bogged", sound: "entity.bogged", interval: [50, 70], burns: true, arrow: { effect: "poison", ticks: 80 } }),
    onDeath: (e, ctx) => {
      equipmentDrop(e, ctx, "bow");
      tippedDrop(e, ctx, "poison");
    },
    onInteract(e, ctx, held) {
      if (held?.item !== "shears" || e.data.sheared) return false;
      e.data.sheared = true;
      sound(ctx, e, "entity.bogged.shear");
      const p = e.body.pos;
      for (let i = 0; i < 2; i++) ctx.entities.dropItem({ item: ctx.random() < 0.5 ? "red_mushroom" : "brown_mushroom", count: 1 }, p.x, p.y + 1.7, p.z);
      ctx.inventory.damageHeld(1);
      return true;
    },
  },
  {
    type: "wither_skeleton",
    displayName: "Wither Skeleton",
    category: "hostile",
    width: 0.7,
    height: 2.4,
    maxHealth: 20,
    speed: 0.25,
    attackDamage: 8,
    xp: [5, 5],
    drops: [{ item: "coal", count: [0, 1], chance: 1 / 3 }, { item: "bone", count: [0, 2] }, { item: "wither_skeleton_skull", count: [1, 1], chance: 0.025 }],
    sounds: SOUNDS("entity.wither_skeleton"),
    spawn: { dims: ["nether"], biomes: ["nether_wastes", "soul_sand_valley", "crimson_forest", "warped_forest", "basalt_deltas"], light: "dark", group: [2, 5], weight: 8 },
    createModel: () => undeadModel({ key: "wither_skeleton", paint: paintWitherSkeleton, parts: "skeleton", arms: "sword", held: "stone_sword", scale: 1.2 }),
    tick: (e, ctx) => {
      e.data.fireImmune = true;
      witherTick(e, ctx);
    },
    onDeath: (e, ctx) => equipmentDrop(e, ctx, "stone_sword"),
  },
];
