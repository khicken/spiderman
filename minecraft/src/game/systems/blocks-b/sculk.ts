import type { BlockBehavior, BlockState, Entity, GameCtx, GameEvent } from "../../contracts";
import { AIR, Face, SET_NOTIFY, idOf, metaOf, stateOf } from "../../contracts";
import { blockDef, blockByName, IS_FLUID, OPAQUE, SOLID } from "../../blocks/registry";
import { mobDef } from "../../entities/registry";
import { signalInto } from "../../mechanics/redstone";
import { notifyNeighbors } from "../../mechanics/redstone/util";
import { type BlockCache, Kind, KIND } from "./cache";

const SENSOR = blockByName("sculk_sensor")?.id ?? -1;
const CALIBRATED = blockByName("calibrated_sculk_sensor")?.id ?? -1;
const SHRIEKER = blockByName("sculk_shrieker")?.id ?? -1;
const SCULK = blockByName("sculk")?.id ?? -1;
const ACTIVE = 4;
const COOLDOWN = 8;
const BACK_FACE = [Face.North, Face.East, Face.South, Face.West];
const SHRIEK_TICKS = 90; // shrieker meta: bit 0 can summon, bit 1 shrieking
const WARNING_DECAY = 12000;
const NON_LIVING = new Set(["item", "xp_orb", "arrow", "spectral_arrow", "trident", "falling_block", "tnt", "snowball", "egg", "ender_pearl", "potion", "experience_bottle", "end_crystal", "area_effect_cloud", "wind_charge", "fireball", "small_fireball", "eye_of_ender", "firework_rocket", "lightning_bolt", "item_frame", "painting", "armor_stand", "boat", "minecart", "warden"]);

const isCalibrated = (s: BlockState) => idOf(s) === CALIBRATED;

function soundFrequency(name: string): number {
  if (name.endsWith(".death") || name.includes("explode")) return 15;
  if (name.includes("teleport") || name.includes("lightning")) return 14;
  if (name.startsWith("item.bucket.empty")) return 13;
  if (name.startsWith("item.bucket.fill")) return 12;
  if (name.endsWith(".open") || name.startsWith("block.note_block") || name.endsWith("click_on") || name.includes("primed")) return 10;
  if (name.endsWith(".close") || name.endsWith("click_off")) return 9;
  if (name === "entity.generic.eat" || name === "entity.generic.drink") return 8;
  if (name.endsWith(".hurt")) return 7;
  if (name.includes("shear") || name.endsWith(".saddle")) return 6;
  if (name.endsWith(".shoot") || name.includes(".throw")) return 3;
  if (name.endsWith(".hit") || name.includes("splash")) return 2;
  return 0;
}

interface Pending {
  x: number;
  y: number;
  z: number;
  freq: number;
  dist: number;
  at: number;
  player: boolean;
}

export function createSculk(cache: BlockCache) {
  const pending: Pending[] = [];
  const near: Entity[] = [];
  const seen = new Set<number>();
  const state = { warning: 0, sinceWarn: 0, cooldown: 0 };
  let stepDist = 0;
  let lastX = NaN, lastZ = NaN, wasGround = true, lastFall = 0;
  let orbCleanup: [number, number, number] | null = null;

  function occluded(ctx: GameCtx, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    const n = Math.floor(len * 2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const s = ctx.world.getBlock(Math.floor(ax + dx * t), Math.floor(ay + dy * t), Math.floor(az + dz * t));
      if (s && blockDef(s).tags?.includes("wool")) return true;
    }
    return false;
  }

  function vibrate(ctx: GameCtx, x: number, y: number, z: number, freq: number, player: boolean, force = true) {
    if (freq <= 0) return;
    cache.each(Math.floor(x), Math.floor(y), Math.floor(z), 17, Kind.Sensor, (sx, sy, sz, s) => {
      const cal = isCalibrated(s);
      const range = cal ? 16 : 8;
      const dist = Math.hypot(sx + 0.5 - x, sy + 0.5 - y, sz + 0.5 - z);
      if (dist > range || dist < 0.5 || metaOf(s) & (ACTIVE | COOLDOWN)) return;
      if (cal) {
        const filter = signalInto(ctx, sx, sy, sz, BACK_FACE[metaOf(s) & 3]);
        if (filter > 0 && filter !== freq) return;
      }
      if (occluded(ctx, x, y, z, sx + 0.5, sy + 0.5, sz + 0.5)) return;
      const old = pending.find((p) => p.x === sx && p.y === sy && p.z === sz);
      if (old) {
        if (old.dist <= dist) return;
        old.freq = freq;
        old.dist = dist;
        old.player = player;
        return;
      }
      pending.push({ x: sx, y: sy, z: sz, freq, dist, at: ctx.time.tick + Math.max(1, Math.floor(dist)), player });
    }, force);
  }

  function activate(ctx: GameCtx, p: Pending) {
    const w = ctx.world;
    const s = w.getBlock(p.x, p.y, p.z);
    if (KIND[idOf(s)] !== Kind.Sensor || metaOf(s) & (ACTIVE | COOLDOWN)) return;
    const range = isCalibrated(s) ? 16 : 8;
    const be = w.getBlockEntity(p.x, p.y, p.z) ?? { x: p.x, y: p.y, z: p.z, type: "sculk_sensor", data: {} };
    be.data = { ...(be.data ?? {}), power: Math.max(1, 15 - Math.floor((p.dist / range) * 15)), freq: p.freq };
    w.setBlockEntity(be, p.x, p.y, p.z);
    w.setBlock(p.x, p.y, p.z, stateOf(idOf(s), metaOf(s) | ACTIVE), SET_NOTIFY);
    notifyNeighbors(ctx, p.x, p.y - 1, p.z);
    w.scheduleTick(p.x, p.y, p.z, isCalibrated(s) ? 10 : 30);
    ctx.emit({ type: "sound", name: "block.sculk_sensor.clicking", x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5, pitch: 0.8 + ctx.random() * 0.4 });
    ctx.emit({ type: "particles", kind: "dust", x: p.x + 0.5, y: p.y + 1, z: p.z + 0.5, count: 4, color: 0x22c0d0 });
    if (p.player) cache.each(p.x, p.y, p.z, 8, Kind.Shrieker, (hx, hy, hz, hs) => shriek(ctx, hx, hy, hz, hs), true);
  }

  function findWardenSpot(ctx: GameCtx, x: number, y: number, z: number): [number, number, number] | null {
    const w = ctx.world;
    for (let i = 0; i < 20; i++) {
      const tx = x + Math.floor(ctx.random() * 11) - 5, tz = z + Math.floor(ctx.random() * 11) - 5;
      for (let ty = y + 6; ty >= y - 6; ty--) {
        const floor = w.getBlock(tx, ty - 1, tz);
        if (!SOLID[idOf(floor)] || !OPAQUE[idOf(floor)]) continue;
        let ok = true;
        for (let h = 0; h < 3 && ok; h++) {
          const b = w.getBlock(tx, ty + h, tz);
          if (b !== AIR && (SOLID[idOf(b)] || IS_FLUID[idOf(b)])) ok = false;
        }
        if (ok) return [tx, ty, tz];
      }
    }
    return null;
  }

  function shriek(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
    const m = metaOf(s);
    if (m & 2 || state.cooldown > 0) return;
    const w = ctx.world;
    w.setBlock(x, y, z, stateOf(idOf(s), m | 2), SET_NOTIFY);
    w.scheduleTick(x, y, z, SHRIEK_TICKS);
    state.cooldown = 200;
    ctx.emit({ type: "sound", name: "block.sculk_shrieker.shriek", x: x + 0.5, y: y + 0.5, z: z + 0.5, volume: 2 });
    ctx.emit({ type: "particles", kind: "gust", x: x + 0.5, y: y + 1.2, z: z + 0.5, count: 6, color: 0x2a5a68 });
    if (!(m & 1)) return;
    state.warning = Math.min(4, state.warning + 1);
    state.sinceWarn = 0;
    const pp = ctx.player.body.pos;
    if (Math.hypot(pp.x - x, pp.y - y, pp.z - z) <= 40 && ctx.player.gameMode !== "creative" && ctx.player.gameMode !== "spectator") {
      const p = ctx.player as typeof ctx.player & { addEffect?: (id: string, amp: number, ticks: number) => void };
      if (p.addEffect) p.addEffect("darkness", 0, 260);
      else ctx.player.effects.push({ id: "darkness", amplifier: 0, ticks: 260 });
    }
    const warn = ["entity.warden.nearby_close", "entity.warden.nearby_closer", "entity.warden.nearby_closest"][state.warning - 1];
    if (warn) ctx.emit({ type: "sound", name: warn, x: pp.x, y: pp.y, z: pp.z });
    if (state.warning < 4 || !mobDef("warden") || ctx.rules.difficulty === "peaceful" || ctx.rules.doWardenSpawning === false) return;
    for (const e of ctx.entities.all()) if (e.type === "warden" && !e.dead && e.body.pos.distanceTo(pp) < 48) return;
    const spot = findWardenSpot(ctx, x, y, z);
    if (!spot) return;
    ctx.entities.spawn("warden", spot[0] + 0.5, spot[1], spot[2] + 0.5, { emerge: 134 });
    ctx.emit({ type: "sound", name: "entity.warden.emerge", x: spot[0] + 0.5, y: spot[1], z: spot[2] + 0.5, volume: 3 });
    state.warning = 0;
  }

  const growable = (s: BlockState) => {
    const d = blockDef(s);
    if (!d.opaque || !d.solid || d.shape !== "cube" || d.hardness < 0 || d.hardness > 5 || KIND[d.id]) return false;
    if (d.id === SCULK || d.name === "obsidian" || d.name === "crying_obsidian" || d.name === "reinforced_deepslate") return false;
    return true;
  };

  function ground(ctx: GameCtx, x: number, y: number, z: number): number {
    for (let dy = 1; dy >= -3; dy--) {
      const s = ctx.world.getBlock(x, y + dy, z);
      if (SOLID[idOf(s)] && OPAQUE[idOf(s)] && !SOLID[idOf(ctx.world.getBlock(x, y + dy + 1, z))]) return y + dy;
    }
    return NaN;
  }

  function spread(ctx: GameCtx, x: number, y: number, z: number, cx: number, cz: number, charge: number) {
    const w = ctx.world;
    let px = Math.floor(x), pz = Math.floor(z), py = Math.floor(y);
    for (let step = 0; step < 120 && charge > 0; step++) {
      const gy = ground(ctx, px, py, pz);
      if (Number.isFinite(gy)) {
        py = gy;
        const s = w.getBlock(px, gy, pz);
        if (growable(s)) {
          w.setBlock(px, gy, pz, stateOf(SCULK), SET_NOTIFY);
          ctx.emit({ type: "particles", kind: "block", x: px + 0.5, y: gy + 1, z: pz + 0.5, count: 3, state: stateOf(SCULK) });
          charge--;
        } else if (idOf(s) === SCULK && w.getBlock(px, gy + 1, pz) === AIR && Math.hypot(px - cx, pz - cz) >= 4 && ctx.random() < 0.1) {
          w.setBlock(px, gy + 1, pz, ctx.random() < 0.9 ? stateOf(SENSOR) : stateOf(SHRIEKER), SET_NOTIFY);
          charge -= 3;
        }
      }
      const d = Math.floor(ctx.random() * 4);
      px += d === 0 ? 1 : d === 1 ? -1 : 0;
      pz += d === 2 ? 1 : d === 3 ? -1 : 0;
    }
    ctx.emit({ type: "sound", name: "block.sculk.spread", x, y, z });
  }

  function onDeath(ctx: GameCtx, type: string, x: number, y: number, z: number) {
    let done = false;
    cache.each(Math.floor(x), Math.floor(y), Math.floor(z), 8, Kind.Catalyst, (cx, cy, cz) => {
      if (done) return;
      done = true;
      const xp = mobDef(type)?.xp;
      const charge = xp ? Math.round((xp[0] + xp[1]) / 2) : type === "player" ? 7 : 0;
      if (charge <= 0) return;
      ctx.emit({ type: "sound", name: "block.sculk_catalyst.bloom", x: cx + 0.5, y: cy + 0.5, z: cz + 0.5, volume: 2 });
      ctx.emit({ type: "particles", kind: "dust", x: cx + 0.5, y: cy + 1.1, z: cz + 0.5, count: 10, color: 0x0e7e8e });
      spread(ctx, x, y, z, cx, cz, charge);
      orbCleanup = [x, y, z];
    }, true);
  }

  function playerVibrations(ctx: GameCtx) {
    const p = ctx.player;
    const b = p.body;
    if (p.gameMode === "spectator") return;
    if (!Number.isNaN(lastX) && b.onGround && !p.sneaking) {
      stepDist += Math.hypot(b.pos.x - lastX, b.pos.z - lastZ);
      if (stepDist >= 1.2) {
        stepDist = 0;
        vibrate(ctx, b.pos.x, b.pos.y + 0.1, b.pos.z, 1, true, false);
        const under = ctx.world.getBlock(Math.floor(b.pos.x), Math.floor(b.pos.y - 0.2), Math.floor(b.pos.z));
        if (idOf(under) === SHRIEKER) shriek(ctx, Math.floor(b.pos.x), Math.floor(b.pos.y - 0.2), Math.floor(b.pos.z), under);
      }
    }
    if (b.onGround && !wasGround && lastFall > 0.5 && !p.sneaking) vibrate(ctx, b.pos.x, b.pos.y, b.pos.z, 2, true, false);
    wasGround = b.onGround;
    lastFall = b.fallDistance;
    lastX = b.pos.x;
    lastZ = b.pos.z;
  }

  function mobVibrations(ctx: GameCtx) {
    const pp = ctx.player.body.pos;
    seen.clear();
    cache.each(Math.floor(pp.x), Math.floor(pp.y), Math.floor(pp.z), 48, Kind.Sensor, (sx, sy, sz, s) => {
      if (metaOf(s) & (ACTIVE | COOLDOWN)) return;
      ctx.entities.near(sx + 0.5, sy + 0.5, sz + 0.5, isCalibrated(s) ? 16 : 8, near);
      for (const e of near) {
        if (seen.has(e.id) || e.dead || NON_LIVING.has(e.type)) continue;
        const v = e.body.vel;
        if (!e.body.onGround || v.x * v.x + v.z * v.z < 0.0004) continue;
        seen.add(e.id);
        vibrate(ctx, e.body.pos.x, e.body.pos.y + 0.1, e.body.pos.z, 1, false, false);
      }
      near.length = 0;
    });
  }

  const sensorBehavior: BlockBehavior = {
    scheduledTick(ctx, x, y, z, s) {
      const m = metaOf(s);
      if (m & ACTIVE) {
        ctx.world.setBlock(x, y, z, stateOf(idOf(s), (m & ~ACTIVE) | COOLDOWN), SET_NOTIFY);
        notifyNeighbors(ctx, x, y - 1, z);
        ctx.world.scheduleTick(x, y, z, 10);
      } else if (m & COOLDOWN) ctx.world.setBlock(x, y, z, stateOf(idOf(s), m & ~COOLDOWN), SET_NOTIFY);
    },
    power(ctx, x, y, z, s, toward) {
      if (!(metaOf(s) & ACTIVE)) return 0;
      if (isCalibrated(s) && toward === BACK_FACE[metaOf(s) & 3]) return 0;
      return Number(ctx.world.getBlockEntity(x, y, z)?.data?.power ?? 15);
    },
    strongPower(ctx, x, y, z, s, toward) {
      if (toward !== Face.Down || !(metaOf(s) & ACTIVE)) return 0;
      return Number(ctx.world.getBlockEntity(x, y, z)?.data?.power ?? 15);
    },
    comparatorOutput(ctx, x, y, z, s) {
      return metaOf(s) & ACTIVE ? Number(ctx.world.getBlockEntity(x, y, z)?.data?.freq ?? 0) : 0;
    },
  };

  const shriekerBehavior: BlockBehavior = {
    scheduledTick(ctx, x, y, z, s) {
      if (metaOf(s) & 2) ctx.world.setBlock(x, y, z, stateOf(idOf(s), metaOf(s) & ~2), SET_NOTIFY);
    },
  };

  return {
    state,
    behaviors: {
      sculk_sensor: sensorBehavior,
      calibrated_sculk_sensor: sensorBehavior,
      sculk_shrieker: shriekerBehavior,
    } as Record<string, BlockBehavior>,
    vibrate,
    tick(ctx: GameCtx) {
      if (state.cooldown > 0) state.cooldown--;
      if (state.warning > 0 && ++state.sinceWarn >= WARNING_DECAY) {
        state.warning--;
        state.sinceWarn = 0;
      }
      if (orbCleanup) {
        const [x, y, z] = orbCleanup;
        orbCleanup = null;
        ctx.entities.near(x, y, z, 2.5, near);
        for (const e of near) if (e.type === "xp_orb" && e.age < 10) e.dead = true;
        near.length = 0;
      }
      playerVibrations(ctx);
      if (ctx.time.tick % 5 === 0) mobVibrations(ctx);
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].at > ctx.time.tick) continue;
        const p = pending.splice(i, 1)[0];
        activate(ctx, p);
      }
    },
    onEvent(ctx: GameCtx, e: GameEvent) {
      const pp = ctx.player.body.pos;
      if (e.type === "block_changed") {
        const a = idOf(e.from), b = idOf(e.to);
        if (KIND[a] === Kind.Sensor || KIND[b] === Kind.Sensor || a === SHRIEKER || b === SHRIEKER) return;
        if ((IS_FLUID[a] || a === 0) && (IS_FLUID[b] || b === 0) && (metaOf(e.from) !== 0 || metaOf(e.to) !== 0)) return;
        const freq = a === 0 || IS_FLUID[a] ? 13 : b === 0 || IS_FLUID[b] ? 12 : 11;
        const player = Math.hypot(pp.x - e.x, pp.y - e.y, pp.z - e.z) < 7;
        vibrate(ctx, e.x + 0.5, e.y + 0.5, e.z + 0.5, freq, player);
      } else if (e.type === "sound" && e.x !== undefined && e.y !== undefined && e.z !== undefined) {
        if (e.name.startsWith("block.sculk") || e.name.startsWith("entity.warden")) return;
        if (e.name.endsWith(".death")) {
          const type = e.name.slice(7, -6);
          onDeath(ctx, type, e.x, e.y, e.z);
        }
        const player = Math.hypot(pp.x - e.x, pp.y - e.y, pp.z - e.z) < 3;
        vibrate(ctx, e.x, e.y, e.z, soundFrequency(e.name), player);
      } else if (e.type === "explosion") vibrate(ctx, e.x, e.y, e.z, 15, false);
    },
    save: () => ({ warning: state.warning, sinceWarn: state.sinceWarn }),
    load(d: unknown) {
      const o = (d ?? {}) as { warning?: number; sinceWarn?: number };
      state.warning = o.warning ?? 0;
      state.sinceWarn = o.sinceWarn ?? 0;
    },
    reset() {
      pending.length = 0;
      lastX = NaN;
    },
  };
}
