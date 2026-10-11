import type { Entity, GameCtx, MobDef } from "../../contracts";
import { applyPhysics, canSeePlayer, knockBody, playerTargetable, rotlerp, walkToward, yawTo } from "../ai";
import { bodiesTouch } from "../geom";
import { diffId, discard, hurtAmount, naturalSpawn, num, particles, sound, targetInfo, updateTarget } from "./brain";
import { slimeModel } from "./looks-overworld";
import { SWAMPS } from "./spawns";

function setSize(e: Entity, size: number, heal: boolean): void {
  e.data.size = size;
  e.body.width = 0.52 * size;
  e.body.height = 0.52 * size;
  e.maxHealth = size * size;
  if (heal) e.health = e.maxHealth;
}

function init(e: Entity, ctx: GameCtx, magma: boolean): void {
  if (e.data._init) return;
  e.data._init = true;
  e.data.noFall = true;
  if (magma) e.data.fireImmune = true;
  if (e.data.sized) {
    setSize(e, num(e, "size", 1), false);
    return;
  }
  e.data.sized = true;
  let size = num(e, "size");
  if (size <= 0) {
    let i = Math.floor(ctx.random() * 3);
    if (i < 2 && ctx.random() < 0.5 * diffId(ctx) / 3 + 0.1) i++;
    size = 1 << i;
  }
  setSize(e, size, true);
  if (magma) e.data.armor = 3 * size;
}

function slimeTick(magma: boolean) {
  const prefix = magma ? "entity.magma_cube" : "entity.slime";
  return (e: Entity, ctx: GameCtx) => {
    init(e, ctx, magma);
    if (naturalSpawn(e) && !magma) {
      const y = e.body.pos.y;
      if (y < 51 || y > 69) return discard(e);
    }
    const size = num(e, "size", 1);
    const hurt = hurtAmount(e);
    const b = e.body;
    const wasGround = !!e.data._ground;
    e.data.squishPrev = num(e, "squish");
    const t = updateTarget(e, ctx, { range: 16 }, hurt);
    const info = targetInfo(ctx, t);
    if (info) e.yaw = rotlerp(e.yaw, yawTo(info.pos.x - b.pos.x, info.pos.z - b.pos.z), 10 * Math.PI / 180);
    else if (ctx.random() < 0.05) e.data._wantYaw = ctx.random() * Math.PI * 2;
    if (!info && e.data._wantYaw !== undefined) e.yaw = rotlerp(e.yaw, e.data._wantYaw as number, 10 * Math.PI / 180);
    e.headYaw = e.yaw;
    const speed = 0.2 + 0.1 * size;
    const fx = b.pos.x - Math.sin(e.yaw) * 4;
    const fz = b.pos.z - Math.cos(e.yaw) * 4;
    if (b.onGround) {
      let delay = num(e, "_jumpDelay", 10) - 1;
      if (delay <= 0) {
        delay = Math.floor(ctx.random() * 20) + 10;
        if (info) delay = Math.floor(delay / 3);
        if (magma) delay = Math.floor(delay / 4) + 1;
        b.vel.y = magma ? 0.42 + size * 0.1 : 0.42;
        walkToward(e, ctx, fx, fz, speed * (magma ? 2 : 1));
        sound(ctx, e, size > 1 ? prefix + ".jump" : prefix + ".jump_small", 0.4 * size);
      }
      e.data._jumpDelay = delay;
    } else walkToward(e, ctx, fx, fz, speed);
    if (b.inWater) b.vel.y = Math.max(b.vel.y, 0.08);
    applyPhysics(e, ctx);
    let target = num(e, "_tsq");
    if (b.onGround && !wasGround) {
      particles(ctx, magma ? "flame" : "dust", b.pos.x, b.pos.y, b.pos.z, size * 8, magma ? undefined : 0x7ec85a);
      sound(ctx, e, size > 1 ? prefix + ".squish" : prefix + ".squish_small", 0.4 * size, ((ctx.random() - ctx.random()) * 0.2 + 1) / 0.8);
      target = -0.5;
    } else if (!b.onGround && wasGround) target = 1;
    target *= 0.6;
    e.data._tsq = target;
    e.data.squish = num(e, "squish") + (target - num(e, "squish")) * 0.5;
    e.data._ground = b.onGround;
    const deals = magma || size > 1;
    if (deals && info && t === "player" && playerTargetable(ctx) && num(e, "_hitCd") <= e.age && bodiesTouch(b, ctx.player.body, 0.1, 0, 0.1) && canSeePlayer(ctx, e)) {
      e.data._hitCd = e.age + 10;
      const dmg = magma ? size + 2 : size;
      ctx.player.damage(dmg, "mob", e);
      knockBody(ctx.player.body, ctx.player.body.pos.x - b.pos.x, ctx.player.body.pos.z - b.pos.z, 0.4);
      sound(ctx, e, prefix + ".attack", 1, (ctx.random() - ctx.random()) * 0.2 + 1);
    }
  };
}

function split(e: Entity, ctx: GameCtx): void {
  const size = num(e, "size", 1);
  if (size <= 1 || e.data._remove) return;
  const n = 2 + Math.floor(ctx.random() * 3);
  const half = size / 2;
  for (let k = 0; k < n; k++) {
    const ox = ((k % 2) - 0.5) * size / 4;
    const oz = (Math.floor(k / 2) - 0.5) * size / 4;
    const c = ctx.entities.spawn(e.type, e.body.pos.x + ox, e.body.pos.y + 0.5, e.body.pos.z + oz, { size: half, persistent: e.data.persistent });
    if (c) c.yaw = ctx.random() * Math.PI * 2;
  }
}

export const SLIMES: MobDef[] = [
  {
    type: "slime",
    displayName: "Slime",
    category: "hostile",
    width: 0.52,
    height: 0.52,
    maxHealth: 1,
    speed: 0.3,
    sounds: { hurt: "entity.slime.hurt", death: "entity.slime.death" },
    spawn: { dims: ["overworld"], biomes: SWAMPS, light: "dark", group: [1, 1], weight: 100 },
    createModel: () => slimeModel(false),
    tick: slimeTick(false),
    onDeath(e, ctx) {
      const size = num(e, "size", 1);
      if (size === 1) {
        const n = Math.floor(ctx.random() * 3);
        if (n > 0) ctx.entities.dropItem({ item: "slime_ball", count: n }, e.body.pos.x, e.body.pos.y + 0.3, e.body.pos.z);
      }
      ctx.entities.dropXp(size, e.body.pos.x, e.body.pos.y + 0.3, e.body.pos.z);
      split(e, ctx);
    },
  },
  {
    type: "magma_cube",
    displayName: "Magma Cube",
    category: "hostile",
    width: 0.52,
    height: 0.52,
    maxHealth: 1,
    speed: 0.3,
    sounds: { hurt: "entity.magma_cube.hurt", death: "entity.magma_cube.death" },
    spawn: { dims: ["nether"], biomes: ["basalt_deltas"], light: "dark", group: [2, 5], weight: 100 },
    createModel: () => slimeModel(true),
    tick: slimeTick(true),
    onDeath(e, ctx) {
      const size = num(e, "size", 1);
      if (size > 1 && ctx.random() < 0.25) ctx.entities.dropItem({ item: "magma_cream", count: 1 }, e.body.pos.x, e.body.pos.y + 0.3, e.body.pos.z);
      ctx.entities.dropXp(size, e.body.pos.x, e.body.pos.y + 0.3, e.body.pos.z);
      split(e, ctx);
    },
  },
];

export { setSize as setSlimeSize };
