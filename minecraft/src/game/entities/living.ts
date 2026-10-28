import type { DropEntry, Entity, GameCtx, ItemStack, MobDef } from "../contracts";
import { MIN_Y, idOf } from "../contracts";
import { OPAQUE, SOLID, blockDef } from "../blocks/registry";
import { inPowderSnow, isWater, rainAt } from "./ai";
import { fluidState } from "../blocks/waterlog";
import { isBaby } from "./geom";

const COOKED: Record<string, string> = {
  beef: "cooked_beef",
  porkchop: "cooked_porkchop",
  chicken: "cooked_chicken",
  mutton: "cooked_mutton",
  rabbit: "cooked_rabbit",
  cod: "cooked_cod",
  salmon: "cooked_salmon",
};

export function rollDrops(drops: DropEntry[], ctx: GameCtx, looting: number, burning: boolean): ItemStack[] {
  const out: ItemStack[] = [];
  const r = ctx.random;
  const groups = new Map<string, DropEntry | null>();
  for (const d of drops) {
    if (d.group !== undefined) {
      if (!groups.has(d.group)) {
        let roll = r();
        groups.set(d.group, drops.find((g) => g.group === d.group && (roll -= g.chance ?? 0) < 0) ?? null);
      }
      if (groups.get(d.group) !== d) continue;
    }
    const chance = d.group !== undefined ? 1 : d.chance ?? 1;
    if (chance < 1 && r() >= chance + 0.01 * looting) continue;
    const [a, b] = d.count ?? [1, 1];
    let n = a + Math.floor(r() * (b - a + 1));
    if (chance >= 1 && looting > 0) n += Math.floor(r() * (looting + 1));
    if (n <= 0) continue;
    const item = burning ? COOKED[d.item] ?? d.item : d.item;
    out.push({ item, count: n });
  }
  return out;
}

function pitch(e: Entity, ctx: GameCtx) {
  return (ctx.random() - ctx.random()) * 0.2 + (isBaby(e) ? 1.5 : 1);
}

export function hurtSound(e: Entity, ctx: GameCtx, def: MobDef) {
  const name = def.sounds?.hurt ?? "entity.generic.hurt";
  if (!name) return;
  const p = e.body.pos;
  ctx.emit({ type: "sound", name, x: p.x, y: p.y, z: p.z, volume: 1, pitch: pitch(e, ctx) });
}

export function deathSound(e: Entity, ctx: GameCtx, def: MobDef) {
  const name = def.sounds?.death ?? "entity.generic.death";
  if (!name) return;
  const p = e.body.pos;
  ctx.emit({ type: "sound", name, x: p.x, y: p.y, z: p.z, volume: 1, pitch: pitch(e, ctx) });
}

export function ambientTick(e: Entity, ctx: GameCtx, def: MobDef) {
  const snd = def.sounds?.ambient;
  if (!snd || def.type === "enderman") return;
  const t = (e.data._amb as number) ?? -Math.floor(ctx.random() * 80);
  if (Math.floor(ctx.random() * 1000) < t) {
    e.data._amb = -((e.data.ambientInterval as number) ?? 80);
    if (e.data.silent) return;
    const p = e.body.pos;
    ctx.emit({ type: "sound", name: snd, x: p.x, y: p.y + e.body.height * 0.85, z: p.z, volume: 1, pitch: pitch(e, ctx) });
  } else e.data._amb = t + 1;
}

export function stepSounds(e: Entity, ctx: GameCtx, def: MobDef) {
  const b = e.body;
  if (!b.onGround || e.data.silent) return;
  const dx = b.pos.x - (e.data._px as number);
  const dz = b.pos.z - (e.data._pz as number);
  const d = ((e.data._stepd as number) ?? 0) + Math.hypot(dx, dz) * 0.6;
  if (d < 1) {
    e.data._stepd = d;
    return;
  }
  e.data._stepd = 0;
  const below = ctx.world.getBlock(Math.floor(b.pos.x), Math.floor(b.pos.y - 0.2), Math.floor(b.pos.z));
  const name = def.sounds?.step ?? `block.${blockDef(below).sound}.step`;
  ctx.emit({ type: "sound", name, x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 0.15, pitch: 1 });
}

export function baseTick(e: Entity, ctx: GameCtx, def: MobDef) {
  const b = e.body;
  const ents = ctx.entities;
  if (b.pos.y < MIN_Y - 64) {
    ents.damage(e.id, 4, "void");
    if (e.dead) return;
  }
  fireTick(e, ctx);
  breathe(e, ctx, def);
  const ex = Math.floor(b.pos.x), ey = Math.floor(b.pos.y + b.height * 0.85), ez = Math.floor(b.pos.z);
  const eyeId = idOf(ctx.world.getBlock(ex, ey, ez));
  if (SOLID[eyeId] && OPAQUE[eyeId] && !b.noClip) ents.damage(e.id, 1, "suffocate");
  effects(e, ctx);
  grow(e, def);
  const love = (e.data._love as number) ?? 0;
  if (love > 0) {
    e.data._love = love - 1;
    if (love % 10 === 0) ctx.emit({ type: "particles", kind: "heart", x: b.pos.x, y: b.pos.y + b.height + 0.2, z: b.pos.z, count: 1 });
  }
  const cd = (e.data.breedCd as number) ?? 0;
  if (cd > 0) e.data.breedCd = cd - 1;
  if (e.data._byPlayer) e.data._byPlayer = (e.data._byPlayer as number) - 1;
}

// Vanilla on-fire state: fire-immune mobs never show flames.
export function isBurning(e: Entity) {
  return e.data.fireImmune !== true && ((e.data._fire as number) ?? 0) > 0;
}

// Vanilla Entity.baseTick fire, lavaHurt, and the move() extinguish check.
function fireTick(e: Entity, ctx: GameCtx) {
  const b = e.body;
  const immune = e.data.fireImmune === true;
  let fire = (e.data._fire as number) ?? 0;
  if (b.inLava && !immune) {
    fire = Math.max(fire, 300);
    const hp = e.health;
    ctx.entities.damage(e.id, 4, "lava");
    if (e.health < hp) ctx.emit({ type: "sound", name: "entity.generic.burn", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 0.4, pitch: 2 + ctx.random() * 0.4 });
  }
  if (fire > 0) {
    if (immune) fire = Math.max(0, fire - 4);
    else {
      if (fire % 20 === 0 && !b.inLava) ctx.entities.damage(e.id, 1, "fire");
      fire--;
    }
  }
  if (fire > 0 && !immune && (b.inWater || rainAt(ctx, b.pos.x, b.pos.y, b.pos.z) || rainAt(ctx, b.pos.x, b.pos.y + b.height, b.pos.z) || inPowderSnow(e, ctx))) {
    fire = 0;
    ctx.emit({ type: "sound", name: "entity.generic.extinguish_fire", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 0.7, pitch: 1.6 + (ctx.random() - ctx.random()) * 0.4 });
  }
  e.data._fire = fire;
}

function breathe(e: Entity, ctx: GameCtx, def: MobDef) {
  const b = e.body;
  let air = (e.data._air as number) ?? 300;
  const waterMob = def.category === "water" || e.data.waterBreathing === true;
  if (e.data.amphibious) {
    e.data._air = 300;
    return;
  }
  if (waterMob) {
    if (!b.inWater) {
      air--;
      if (air <= -20) {
        air = 0;
        ctx.entities.damage(e.id, 2, "drown");
      }
    } else air = 300;
  } else {
    const eye = fluidState(ctx.world, Math.floor(b.pos.x), Math.floor(b.pos.y + b.height * 0.85), Math.floor(b.pos.z));
    if (isWater(eye)) {
      air--;
      if (air <= -20) {
        air = 0;
        ctx.entities.damage(e.id, 2, "drown");
      }
    } else air = Math.min(300, air + 4);
  }
  e.data._air = air;
}

function effects(e: Entity, ctx: GameCtx) {
  if (!e.effects.length) return;
  for (let i = e.effects.length - 1; i >= 0; i--) {
    const f = e.effects[i];
    const amp = f.amplifier;
    if (f.id === "regeneration" && e.age % Math.max(1, 50 >> amp) === 0 && e.health < e.maxHealth) e.health = Math.min(e.maxHealth, e.health + 1);
    else if (f.id === "poison" && e.age % Math.max(1, 25 >> amp) === 0 && e.health > 1) ctx.entities.damage(e.id, 1, "magic");
    else if (f.id === "wither" && e.age % Math.max(1, 40 >> amp) === 0) ctx.entities.damage(e.id, 1, "wither");
    else if (f.id === "instant_health") e.health = Math.min(e.maxHealth, e.health + (4 << amp));
    else if (f.id === "instant_damage") ctx.entities.damage(e.id, 6 << amp, "magic");
    if (f.id === "instant_health" || f.id === "instant_damage" || --f.ticks <= 0) e.effects.splice(i, 1);
  }
}

function grow(e: Entity, def: MobDef) {
  const g = e.data.grow as number | undefined;
  if (g === undefined || g >= 0) return;
  const n = g + 1;
  e.data.grow = n;
  if (n >= 0) {
    delete e.data.grow;
    e.body.width = def.width;
    e.body.height = def.height;
  }
}

export function ageUp(e: Entity, def: MobDef, ticks: number) {
  const g = e.data.grow as number | undefined;
  if (g === undefined || g >= 0) return;
  e.data.grow = Math.min(-1, g + ticks);
  grow(e, def);
}
