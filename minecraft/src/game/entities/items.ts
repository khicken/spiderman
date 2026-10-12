import type { Entity, GameCtx, ItemStack } from "../contracts";
import { idOf } from "../contracts";
import { blockByName, blockDef } from "../blocks/registry";
import { maxStack } from "../items/registry";
import { moveBody, blockBelow, type MoveOpts } from "../player/physics";
import { bodiesTouch } from "./geom";

export const ITEM_DESPAWN = 6000;
export const NO_PICKUP = 32767;
const FIRE_PROOF = /^netherite_|^ancient_debris$|^nether_star$/;

const opts: MoveOpts = { living: false };
const scratch: Entity[] = [];
let fireId = -2;
let soulFireId = -2;

function stackOf(e: Entity) {
  return e.data.stack as ItemStack;
}

export function sameStack(a: ItemStack, b: ItemStack) {
  return a.item === b.item && (a.damage ?? 0) === (b.damage ?? 0) && a.name === b.name && JSON.stringify(a.ench ?? null) === JSON.stringify(b.ench ?? null) && JSON.stringify(a.data ?? null) === JSON.stringify(b.data ?? null);
}

function move(e: Entity, ctx: GameCtx, gravity: number) {
  const b = e.body;
  const v = b.vel;
  if (b.inWater || b.inLava) {
    const k = b.inWater ? 0.99 : 0.95;
    v.x *= k;
    v.z *= k;
    if (v.y < 0.06) v.y += 5e-4;
  } else v.y -= gravity;
  opts.ctx = ctx;
  opts.entity = e;
  const wasGround = b.onGround;
  const vy = v.y;
  moveBody(ctx.world, b, opts);
  opts.ctx = undefined;
  opts.entity = null;
  const f = b.onGround ? (blockDef(blockBelow(ctx.world, b)).slipperiness ?? 0.6) * 0.98 : 0.98;
  v.x *= f;
  v.y *= 0.98;
  v.z *= f;
  return { landed: b.onGround && !wasGround, vy };
}

function inFire(e: Entity, ctx: GameCtx) {
  if (fireId === -2) {
    fireId = blockByName("fire")?.id ?? -1;
    soulFireId = blockByName("soul_fire")?.id ?? -1;
  }
  const p = e.body.pos;
  const id = idOf(ctx.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)));
  return id === fireId || id === soulFireId;
}

export function tickItem(e: Entity, ctx: GameCtx) {
  const s = stackOf(e);
  if (!s || s.count <= 0) {
    e.data._remove = true;
    return;
  }
  let delay = (e.data.pickupDelay as number) ?? 10;
  if (delay > 0 && delay !== NO_PICKUP) e.data.pickupDelay = --delay;
  const px = e.body.pos.x, py = e.body.pos.y, pz = e.body.pos.z;
  move(e, ctx, e.data.noGravity ? 0 : 0.04);
  const moved = Math.abs(e.body.pos.x - px) + Math.abs(e.body.pos.y - py) + Math.abs(e.body.pos.z - pz) > 1e-5;
  if ((e.body.inLava || inFire(e, ctx)) && !FIRE_PROOF.test(s.item)) {
    ctx.emit({ type: "sound", name: "entity.generic.burn", x: px, y: py, z: pz, volume: 0.4, pitch: 2 + ctx.random() * 0.4 });
    ctx.emit({ type: "particles", kind: "smoke", x: px, y: py + 0.2, z: pz, count: 4 });
    e.data._remove = true;
    return;
  }
  if (e.age % (moved ? 2 : 40) === 0) mergeNearby(e, ctx);
  if (e.data._remove) return;
  if (delay === 0) tryPickup(e, ctx);
  if (e.age >= ITEM_DESPAWN && !e.data.noDespawn) e.data._remove = true;
}

function mergeNearby(e: Entity, ctx: GameCtx) {
  const s = stackOf(e);
  const max = maxStack(s.item);
  if (s.count >= max) return;
  const p = e.body.pos;
  ctx.entities.near(p.x, p.y, p.z, 1.5, scratch);
  for (const o of scratch) {
    if (o === e || o.type !== "item" || o.dead || o.data._remove) continue;
    if (!bodiesTouch(e.body, o.body, 0.5, 0, 0.5)) continue;
    const os = stackOf(o);
    if (!os || !sameStack(s, os) || os.count >= max) continue;
    const into = os.count < s.count ? e : o;
    const from = into === e ? o : e;
    const a = stackOf(into);
    const b = stackOf(from);
    const n = Math.min(max - a.count, b.count);
    a.count += n;
    b.count -= n;
    into.data.pickupDelay = Math.max((into.data.pickupDelay as number) ?? 0, (from.data.pickupDelay as number) ?? 0);
    into.age = Math.min(into.age, from.age);
    if (b.count <= 0) from.data._remove = true;
    if (from === e) break;
  }
  scratch.length = 0;
}

function canCollect(ctx: GameCtx) {
  const p = ctx.player;
  return !p.dead && p.gameMode !== "spectator";
}

function tryPickup(e: Entity, ctx: GameCtx) {
  if (!canCollect(ctx) || !bodiesTouch(ctx.player.body, e.body, 1, 0.5, 1)) return;
  const owner = e.data.owner as string | undefined;
  if (owner && owner !== "player" && (e.data.pickupDelay as number) > 0) return;
  const s = stackOf(e);
  const before = s.count;
  const rest = ctx.inventory.add({ ...s });
  const left = rest ? rest.count : 0;
  if (left >= before) return;
  const r = ctx.random;
  ctx.emit({ type: "sound", name: "entity.item.pickup", x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z, volume: 0.2, pitch: ((r() - r()) * 0.7 + 1) * 2 });
  if (left > 0) s.count = left;
  else collect(e);
}

// The pickup flies the item into the player over 3 ticks before removal.
function collect(e: Entity) {
  e.dead = true;
  e.data._fly = 3;
}

export function tickCollected(e: Entity) {
  const t = ((e.data._fly as number) ?? 0) - 1;
  e.data._fly = t;
  if (t <= 0) e.data._remove = true;
}

// ---------- XP orbs ----------

const ORB_VALUES = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];

export function orbValue(amount: number) {
  for (const v of ORB_VALUES) if (amount >= v) return v;
  return 1;
}

export function orbIcon(value: number) {
  const t = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3];
  for (let i = 0; i < t.length; i++) if (value >= t[i]) return 10 - i;
  return 0;
}

let xpDelayUntil = 0;

export function tickOrb(e: Entity, ctx: GameCtx) {
  const b = e.body;
  const v = b.vel;
  if (b.inLava) {
    v.y = 0.2;
    v.x += (ctx.random() - ctx.random()) * 0.2;
    v.z += (ctx.random() - ctx.random()) * 0.2;
  }
  const p = ctx.player;
  if (canCollect(ctx)) {
    const dx = p.body.pos.x - b.pos.x;
    const dy = p.body.pos.y + 0.81 - b.pos.y;
    const dz = p.body.pos.z - b.pos.z;
    const d = Math.hypot(dx, dy, dz);
    const near = 1 - d / 8;
    if (near > 0 && d > 1e-4) {
      const k = (near * near * 0.1) / d;
      v.x += dx * k;
      v.y += dy * k;
      v.z += dz * k;
    }
  }
  const { landed, vy } = move(e, ctx, e.data.noGravity ? 0 : 0.03);
  if (landed && vy < -0.05) v.y = -vy * 0.9 * 0.3;
  if (canCollect(ctx) && bodiesTouch(p.body, b, 1, 0.5, 1) && ctx.time.tick >= xpDelayUntil) {
    xpDelayUntil = ctx.time.tick + 2;
    p.addXp((e.data.value as number) ?? 1);
    const r = ctx.random;
    ctx.emit({ type: "sound", name: "entity.experience_orb.pickup", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 0.1, pitch: (r() - r()) * 0.35 + 0.9 });
    e.dead = true;
    e.data._fly = 2;
    return;
  }
  if (e.age >= ITEM_DESPAWN) e.data._remove = true;
}
