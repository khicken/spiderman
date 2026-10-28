import * as THREE from "three";
import type { Body, Entity, GameCtx } from "../contracts";
import { AIR, MIN_Y, MAX_Y, SET_NOTIFY, SET_NO_DROP, idOf, metaOf } from "../contracts";
import { IS_FLUID, OPAQUE, blockByName, blockDef } from "../blocks/registry";
import { computeDrops } from "../items/drops";

export interface ExplodeOpts {
  fire?: boolean;
  breakBlocks?: boolean; // default true
  damage?: boolean; // default true
  knockback?: number; // multiplier, default 1
  source?: Entity | "player";
  wind?: boolean; // wind burst: toggles doors, levers, buttons; gust particles
  kind?: "block" | "mob" | "tnt"; // picks the *ExplosionDropDecay rule, default block
}

const ray = new THREE.Vector3();
const org = new THREE.Vector3();
const scratch: Entity[] = [];
const hitSet = new Set<number>();
const hitList: number[] = [];

const pack = (x: number, y: number, z: number) => (y - MIN_Y) * 67108864 + (x & 8191) * 8192 + (z & 8191);

let ids: { tnt: number; fire: number } | null = null;
function tntId() {
  if (!ids) ids = { tnt: blockByName("tnt")?.id ?? -1, fire: blockByName("fire")?.id ?? -1 };
  return ids;
}

function resistance(state: number) {
  const id = idOf(state);
  if (IS_FLUID[id]) return 100;
  const d = blockDef(state);
  return d.hardness < 0 ? Math.max(d.blastResistance, 3600000) : d.blastResistance;
}

function collectBlocks(ctx: GameCtx, x: number, y: number, z: number, power: number) {
  hitSet.clear();
  hitList.length = 0;
  const w = ctx.world;
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 16; j++)
      for (let k = 0; k < 16; k++) {
        if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
        let dx = (i / 15) * 2 - 1;
        let dy = (j / 15) * 2 - 1;
        let dz = (k / 15) * 2 - 1;
        const len = Math.hypot(dx, dy, dz);
        dx /= len;
        dy /= len;
        dz /= len;
        let f = power * (0.7 + ctx.random() * 0.6);
        let px = x, py = y, pz = z;
        for (; f > 0; f -= 0.22500001) {
          const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
          if (by < MIN_Y || by > MAX_Y) break;
          const s = w.getBlock(bx, by, bz);
          if (s !== AIR) f -= (resistance(s) + 0.3) * 0.3;
          if (f > 0 && s !== AIR && !IS_FLUID[idOf(s)]) {
            const key = pack(bx, by, bz);
            if (!hitSet.has(key)) {
              hitSet.add(key);
              hitList.push(bx, by, bz);
            }
          }
          px += dx * 0.3;
          py += dy * 0.3;
          pz += dz * 0.3;
        }
      }
}

export function exposure(ctx: GameCtx, x: number, y: number, z: number, b: Body) {
  const hw = b.width / 2;
  const minX = b.pos.x - hw, minY = b.pos.y, minZ = b.pos.z - hw;
  const sx = 1 / (b.width * 2 + 1);
  const sy = 1 / (b.height * 2 + 1);
  const sz = 1 / (b.width * 2 + 1);
  const ox = (1 - Math.floor(1 / sx) * sx) / 2;
  const oz = (1 - Math.floor(1 / sz) * sz) / 2;
  let seen = 0;
  let total = 0;
  for (let a = 0; a <= 1; a += sx)
    for (let c = 0; c <= 1; c += sy)
      for (let d = 0; d <= 1; d += sz) {
        org.set(minX + b.width * a + ox, minY + b.height * c, minZ + b.width * d + oz);
        ray.set(x - org.x, y - org.y, z - org.z);
        const len = ray.length();
        total++;
        if (len < 1e-4) {
          seen++;
          continue;
        }
        ray.multiplyScalar(1 / len);
        const hit = ctx.world.raycast(org, ray, len, false);
        if (!hit || hit.dist >= len - 1e-3) seen++;
      }
  return total ? seen / total : 0;
}

const WIND_TOGGLE = /(?<!iron)_door$|(?<!iron)_trapdoor$|_fence_gate$|^lever$|_button$|^bell$/;

export function explodeAt(ctx: GameCtx, x: number, y: number, z: number, power: number, o: ExplodeOpts = {}) {
  const r = ctx.random;
  const wind = o.wind === true;
  const breakBlocks = o.breakBlocks !== false && !wind;
  const doDamage = o.damage !== false && !wind;
  const kbMul = o.knockback ?? 1;
  collectBlocks(ctx, x, y, z, power);
  hurtEntities(ctx, x, y, z, power, doDamage, kbMul, o.source);
  if (wind) toggleBlocks(ctx);
  else if (breakBlocks) destroyBlocks(ctx, power, o.fire === true, dropDecay(ctx, o.kind ?? "block"));
  if (wind) {
    ctx.emit({ type: "particles", kind: "gust", x, y, z, count: power > 2 ? 12 : 6 });
    ctx.emit({ type: "sound", name: "entity.wind_charge.wind_burst", x, y, z, volume: 1, pitch: 0.9 + r() * 0.2 });
    return;
  }
  ctx.emit({ type: "particles", kind: "explosion", x, y, z, count: power >= 2 && breakBlocks ? 16 : 1 });
  ctx.emit({ type: "sound", name: "entity.generic.explode", x, y, z, volume: 4, pitch: (1 + (r() - r()) * 0.2) * 0.7 });
  ctx.emit({ type: "explosion", x, y, z, power });
}

function hurtEntities(ctx: GameCtx, x: number, y: number, z: number, power: number, doDamage: boolean, kbMul: number, source: Entity | "player" | undefined) {
  const reach = power * 2;
  ctx.entities.near(x, y, z, reach + 2, scratch);
  const list = scratch.slice();
  scratch.length = 0;
  for (const e of list) {
    if (e.dead || e.data._remove) continue;
    if (e === source && wind(e)) continue;
    const b = e.body;
    const dist = Math.hypot(b.pos.x - x, b.pos.y - y, b.pos.z - z) / reach;
    if (dist > 1) continue;
    const eyeY = e.type === "tnt" ? b.pos.y : b.pos.y + b.height * 0.85;
    let dx = b.pos.x - x, dy = eyeY - y, dz = b.pos.z - z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) continue;
    dx /= len;
    dy /= len;
    dz /= len;
    const impact = (1 - dist) * exposure(ctx, x, y, z, b);
    if (doDamage) {
      const dmg = Math.floor(((impact * impact + impact) / 2) * 7 * reach + 1);
      ctx.entities.damage(e.id, dmg, "explosion", source);
    }
    if (e.dead && e.type !== "item") continue;
    const k = impact * kbMul * (1 - ((e.data.kbResist as number) ?? 0));
    b.vel.x += dx * k;
    b.vel.y += dy * k;
    b.vel.z += dz * k;
    if (kbMul !== 1) b.fallDistance = 0;
  }
  const everyone = (ctx as GameCtx & { playersAll?: () => GameCtx["player"][] }).playersAll?.() ?? [ctx.player];
  for (const p of everyone) hurtPlayer(ctx, p, x, y, z, reach, doDamage, kbMul, source);
}

function hurtPlayer(ctx: GameCtx, p: GameCtx["player"], x: number, y: number, z: number, reach: number, doDamage: boolean, kbMul: number, source: Entity | "player" | undefined) {
  if (p.dead || p.gameMode === "spectator" || (p.gameMode === "creative" && p.flying)) return;
  const pb = p.body;
  const dist = Math.hypot(pb.pos.x - x, pb.pos.y - y, pb.pos.z - z) / reach;
  if (dist > 1) return;
  let dx = pb.pos.x - x, dy = pb.pos.y + 1.62 - y, dz = pb.pos.z - z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  dx /= len;
  dy /= len;
  dz /= len;
  const impact = (1 - dist) * exposure(ctx, x, y, z, pb);
  if (doDamage) {
    const dmg = Math.floor(((impact * impact + impact) / 2) * 7 * reach + 1);
    if (p.gameMode !== "creative") {
      p.damageFrom = { x, y, z };
      p.damage(dmg, "explosion", source && source !== "player" ? source : undefined);
    }
  }
  const blastProt = blastProtection((p as { inv?: GameCtx["inventory"] }).inv ?? ctx.inventory);
  const k = impact * kbMul * (1 - blastProt);
  pb.vel.x += dx * k;
  pb.vel.y += dy * k;
  pb.vel.z += dz * k;
  if (kbMul !== 1) pb.fallDistance = 0;
}

function wind(e: Entity) {
  return e.type === "wind_charge";
}

function blastProtection(inv: GameCtx["inventory"]) {
  let lvl = 0;
  for (let i = 36; i < 40; i++) lvl = Math.max(lvl, inv.slots[i]?.ench?.blast_protection ?? 0);
  return Math.min(1, lvl * 0.15);
}

function dropDecay(ctx: GameCtx, kind: "block" | "mob" | "tnt"): boolean {
  if (kind === "tnt") return ctx.rules.tntExplosionDropDecay === true;
  return (kind === "mob" ? ctx.rules.mobExplosionDropDecay : ctx.rules.blockExplosionDropDecay) !== false;
}

function destroyBlocks(ctx: GameCtx, power: number, fire: boolean, decay: boolean) {
  const w = ctx.world;
  const { tnt, fire: fireId } = tntId();
  const n = hitList.length / 3;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(ctx.random() * (i + 1));
    for (let a = 0; a < 3; a++) {
      const t = hitList[i * 3 + a];
      hitList[i * 3 + a] = hitList[j * 3 + a];
      hitList[j * 3 + a] = t;
    }
  }
  for (let i = 0; i < n; i++) {
    const x = hitList[i * 3], y = hitList[i * 3 + 1], z = hitList[i * 3 + 2];
    const s = w.getBlock(x, y, z);
    if (s === AIR) continue;
    if (idOf(s) === tnt) {
      w.setBlock(x, y, z, AIR, SET_NOTIFY | SET_NO_DROP);
      const fuse = Math.floor(ctx.random() * 20) + 10;
      ctx.entities.spawn("tnt", x + 0.5, y, z + 0.5, { fuse });
      continue;
    }
    const def = blockDef(s);
    if (def.hardness < 0) continue;
    if ((!decay || ctx.random() < 1 / power) && ctx.rules.doTileDrops !== false) {
      const tool = def.tool && def.tool !== "shears" ? { item: `netherite_${def.tool}`, count: 1 } : null;
      for (const st of computeDrops(s, tool, ctx.random)) ctx.entities.dropItem(st, x + 0.5, y + 0.5, z + 0.5);
    }
    w.setBlock(x, y, z, AIR, SET_NOTIFY | SET_NO_DROP);
  }
  if (fire && fireId > 0) {
    for (let i = 0; i < n; i++) {
      if (ctx.random() >= 1 / 3) continue;
      const x = hitList[i * 3], y = hitList[i * 3 + 1], z = hitList[i * 3 + 2];
      if (w.getBlock(x, y, z) === AIR && OPAQUE[idOf(w.getBlock(x, y - 1, z))]) w.setBlock(x, y, z, fireId);
    }
  }
}

const toggled = new Set<number>();

function toggleBlocks(ctx: GameCtx) {
  const w = ctx.world;
  toggled.clear();
  for (let i = 0; i < hitList.length; i += 3) {
    const x = hitList[i];
    let y = hitList[i + 1];
    const z = hitList[i + 2];
    let s = w.getBlock(x, y, z);
    const def = blockDef(s);
    if (def.shape === "door" && metaOf(s) & 8) {
      y -= 1;
      s = w.getBlock(x, y, z);
    }
    const name = blockDef(s).name;
    if (WIND_TOGGLE.test(name)) {
      const key = pack(x, y, z);
      if (toggled.has(key)) continue;
      toggled.add(key);
      ctx.behaviors[name]?.use?.(ctx, x, y, z, s, null);
    } else if (name.endsWith("candle") || name.endsWith("_candle")) {
      ctx.behaviors[name]?.use?.(ctx, x, y, z, s, { item: "wind_charge", count: 1, data: { extinguish: true } });
    }
  }
}

// Mob explosions (creeper, ghast fireball) leave blocks alone when mobGriefing is off.
export function mobExplode(ctx: GameCtx, e: Entity, x: number, y: number, z: number, power: number, fire = false) {
  const grief = ctx.rules.mobGriefing;
  explodeAt(ctx, x, y, z, power, { fire: fire && grief, breakBlocks: grief, source: e, kind: "mob" });
}

export function windBurst(ctx: GameCtx, x: number, y: number, z: number, breeze: boolean, source?: Entity | "player") {
  explodeAt(ctx, x, y, z, breeze ? 3 : 1.2, { wind: true, knockback: breeze ? 1 : 1.22, source });
}
