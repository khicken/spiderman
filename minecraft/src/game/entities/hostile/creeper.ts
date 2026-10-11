import type { Entity, GameCtx, MobDef } from "../../contracts";
import { applyPhysics, canSee, clearPath, idleLook, lookAt } from "../ai";
import { mobExplode } from "../explosion";
import { avoid, chase, discard, hurtAmount, idle, num, sound, targetInfo, updateTarget } from "./brain";
import { creeperModel } from "./looks-overworld";
import { MONSTER_BIOMES } from "./spawns";

export const FUSE = 30;

function explode(e: Entity, ctx: GameCtx): void {
  const p = e.body.pos;
  const power = e.data.powered ? 6 : 3;
  mobExplode(ctx, e, p.x, p.y, p.z, power);
  discard(e);
}

function tick(e: Entity, ctx: GameCtx): void {
  const hurt = hurtAmount(e);
  e.data.swellPrev = num(e, "swell");
  const speed = 0.25;
  const t = updateTarget(e, ctx, { range: 16 }, hurt);
  let dir = -1;
  if (e.data.ignited) dir = 1;
  else if (t !== undefined) {
    const i = targetInfo(ctx, t)!;
    const d2 = i.pos.distanceToSquared(e.body.pos);
    const swelling = num(e, "swell") > 0;
    if ((swelling && d2 < 49) || d2 < 9) dir = canSee(ctx, e, i.pos.x, i.pos.y + i.height * 0.85, i.pos.z) ? 1 : -1;
  }
  if (dir > 0 || num(e, "swell") > 0) {
    clearPath(e);
    const i = targetInfo(ctx, t);
    if (i) lookAt(e, i.pos.x, i.pos.y + i.height * 0.85, i.pos.z);
  } else if (!avoid(e, ctx, ["cat", "ocelot"], 6, speed)) {
    if (t !== undefined) chase(e, ctx, t, speed);
    else {
      idle(e, ctx, speed * 0.8);
      idleLook(e, ctx);
    }
  }
  let s = num(e, "swell");
  if (dir > 0 && s === 0) sound(ctx, e, "entity.creeper.primed", 1, 0.5);
  s = Math.max(0, s + dir);
  e.data.swell = s;
  if (s >= FUSE) {
    e.data.swell = FUSE;
    explode(e, ctx);
    return;
  }
  applyPhysics(e, ctx);
}

export const CREEPER: MobDef = {
  type: "creeper",
  displayName: "Creeper",
  category: "hostile",
  width: 0.6,
  height: 1.7,
  maxHealth: 20,
  speed: 0.25,
  xp: [5, 5],
  drops: [{ item: "gunpowder", count: [0, 2] }],
  sounds: { hurt: "entity.creeper.hurt", death: "entity.creeper.death" },
  spawn: { dims: ["overworld"], biomes: MONSTER_BIOMES, light: "dark", group: [4, 4], weight: 100 },
  createModel: creeperModel,
  tick,
  onDeath(e, ctx) {
    const by = e.data._killer ?? e.data._hurtBy;
    if (typeof by === "number" && ["skeleton", "stray", "bogged"].includes(ctx.entities.get(by)?.type ?? "")) {
      const discs = ["13", "cat", "blocks", "chirp", "far", "mall", "mellohi", "stal", "strad", "ward", "11", "wait"];
      ctx.entities.dropItem({ item: "music_disc_" + discs[Math.floor(ctx.random() * discs.length)], count: 1 }, e.body.pos.x, e.body.pos.y + 0.5, e.body.pos.z);
    }
  },
  onInteract(e, ctx, held) {
    if (held?.item !== "flint_and_steel" && held?.item !== "fire_charge") return false;
    e.data.ignited = true;
    ctx.emit({ type: "sound", name: held.item === "fire_charge" ? "item.firecharge.use" : "item.flintandsteel.use", x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z });
    if (held.item === "fire_charge") ctx.inventory.removeHeld(1);
    else ctx.inventory.damageHeld(1);
    return true;
  },
};
