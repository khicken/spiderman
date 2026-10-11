import * as THREE from "three";
import type { DamageSource, Entity, EntityApi, EntityHit, EntitySave, GameCtx, ItemStack, MobDef } from "../contracts";
import { makeBody } from "../player/physics";
import { mobDef, isMob } from "./registry";
import { segmentBody, isBaby } from "./geom";
import { applyPhysics, knockBody, alertPets } from "./ai";
import { tickItem, tickOrb, tickCollected, orbValue } from "./items";
import { tickArrow, tickThrown, tickWindCharge, tickFireball, deflect, PROJECTILES } from "./projectiles";
import { tickTnt, tickFallingBlock } from "./falling";
import { explodeAt } from "./explosion";
import { createSpawner, despawns } from "./spawning";
import { baseTick, rollDrops, deathSound, hurtSound, ambientTick, stepSounds } from "./living";
import { createViews } from "./visuals";

const MISC_SIZE: Record<string, [number, number]> = {
  item: [0.25, 0.25],
  xp_orb: [0.5, 0.5],
  arrow: [0.5, 0.5],
  spectral_arrow: [0.5, 0.5],
  trident: [0.5, 0.5],
  snowball: [0.25, 0.25],
  egg: [0.25, 0.25],
  ender_pearl: [0.25, 0.25],
  potion: [0.25, 0.25],
  experience_bottle: [0.25, 0.25],
  wind_charge: [0.3125, 0.3125],
  breeze_wind_charge: [0.3125, 0.3125],
  fireball: [1, 1],
  small_fireball: [0.3125, 0.3125],
  tnt: [0.98, 0.98],
  falling_block: [0.98, 0.98],
};

const MISC_TICK: Record<string, (e: Entity, ctx: GameCtx) => void> = {
  item: tickItem,
  xp_orb: tickOrb,
  arrow: tickArrow,
  spectral_arrow: tickArrow,
  trident: tickArrow,
  snowball: tickThrown,
  egg: tickThrown,
  ender_pearl: tickThrown,
  potion: tickThrown,
  experience_bottle: tickThrown,
  wind_charge: tickWindCharge,
  breeze_wind_charge: tickWindCharge,
  fireball: tickFireball,
  small_fireball: tickFireball,
  tnt: tickTnt,
  falling_block: tickFallingBlock,
};

const CELL = 16;
const cellKey = (cx: number, cz: number) => (cx & 0xffff) * 65536 + (cz & 0xffff);

type V3 = { x: number; y: number; z: number };

function readVel(data: Record<string, unknown>): V3 | null {
  const v = (data.vel ?? data.velocity ?? data.motion) as unknown;
  if (Array.isArray(v) && v.length >= 3) return { x: +v[0], y: +v[1], z: +v[2] };
  if (v && typeof v === "object" && "x" in v) return v as V3;
  if (typeof data.vx === "number") return { x: data.vx, y: (data.vy as number) ?? 0, z: (data.vz as number) ?? 0 };
  if (typeof data.yaw === "number" && typeof data.pitch === "number") {
    const speed = typeof data.speed === "number" ? data.speed : typeof data.power === "number" ? data.power * 3 : 1.5;
    const yaw = data.yaw, pitch = data.pitch;
    return { x: -Math.sin(yaw) * Math.cos(pitch) * speed, y: Math.sin(pitch) * speed, z: -Math.cos(yaw) * Math.cos(pitch) * speed };
  }
  return null;
}

function stripData(data: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k in data) if (k[0] !== "_" && data[k] !== undefined) out[k] = data[k];
  return out;
}

export function createEntities(getCtx: () => GameCtx): EntityApi {
  const list: Entity[] = [];
  const byId = new Map<number, Entity>();
  const grid = new Map<number, Entity[]>();
  const spare: Entity[][] = [];
  let nextId = 1;
  const spawner = createSpawner();
  const views = createViews(getCtx);
  const hitPoint = new THREE.Vector3();

  function gridAdd(e: Entity) {
    const k = cellKey(Math.floor(e.body.pos.x / CELL), Math.floor(e.body.pos.z / CELL));
    let cell = grid.get(k);
    if (!cell) {
      cell = spare.pop() ?? [];
      grid.set(k, cell);
    }
    cell.push(e);
  }

  function rebuildGrid() {
    for (const cell of grid.values()) {
      cell.length = 0;
      spare.push(cell);
    }
    grid.clear();
    for (const e of list) if (!e.data._remove) gridAdd(e);
  }

  function make(type: string, x: number, y: number, z: number, data: Record<string, unknown>, def: MobDef | undefined): Entity {
    const size = def ? [def.width, def.height] : MISC_SIZE[type] ?? [0.5, 0.5];
    const body = makeBody(size[0], size[1], def ? 0.6 : 0);
    body.pos.set(x, y, z);
    const ctx = getCtx();
    const yaw = typeof data.yaw === "number" && !def ? 0 : (data.yaw as number) ?? ctx.random() * Math.PI * 2;
    const maxHealth = def ? def.maxHealth : 5;
    const e: Entity = {
      id: nextId++,
      type,
      body,
      yaw,
      pitch: 0,
      headYaw: yaw,
      health: typeof data.health === "number" ? data.health : maxHealth,
      maxHealth,
      age: 0,
      dead: false,
      hurtTicks: 0,
      effects: Array.isArray(data.effects) ? (data.effects as Entity["effects"]) : [],
      data,
    };
    delete data.health;
    delete data.effects;
    if (def) delete data.yaw;
    if (def) {
      data._speed = def.speed;
      if (isBaby(e)) {
        body.width *= 0.5;
        body.height *= 0.5;
      }
    }
    return e;
  }

  function add(e: Entity) {
    list.push(e);
    byId.set(e.id, e);
    gridAdd(e);
    return e;
  }

  function spawn(type: string, x: number, y: number, z: number, data?: Record<string, unknown>): Entity | null {
    const d = data ? { ...data } : {};
    const def = mobDef(type);
    if (!def && !MISC_SIZE[type]) return null;
    const ctx = getCtx();
    if (def && def.category === "hostile" && ctx.rules.difficulty === "peaceful" && !d.persistent) return null;
    const e = make(type, x, y, z, d, def);
    if (!def) {
      const v = readVel(d);
      delete d.vel;
      delete d.velocity;
      delete d.motion;
      delete d.vx;
      delete d.vy;
      delete d.vz;
      delete d.yaw;
      delete d.pitch;
      if (v) e.body.vel.set(v.x, v.y, v.z);
      if (d.owner === undefined && d.shooter !== undefined) d.owner = d.shooter;
      delete d.shooter;
      if (type === "arrow" || type === "spectral_arrow") {
        if (d.pickup === undefined) d.pickup = d.owner === "player" ? (ctx.player.gameMode === "creative" ? 2 : 1) : 0;
      }
      if (PROJECTILES.has(type)) {
        e.body.noClip = true;
        const vv = e.body.vel;
        if (vv.lengthSq() > 0) {
          e.yaw = Math.atan2(-vv.x, -vv.z);
          e.pitch = Math.atan2(vv.y, Math.hypot(vv.x, vv.z));
        }
      }
      if (type === "item" && d.pickupDelay === undefined) d.pickupDelay = 10;
    }
    return add(e);
  }

  function dropItem(stack: ItemStack, x: number, y: number, z: number, velocity?: THREE.Vector3) {
    if (!stack || stack.count <= 0) return;
    const ctx = getCtx();
    const r = ctx.random;
    const e = spawn("item", x, y - 0.125, z, { stack: { ...stack }, pickupDelay: velocity ? 40 : 10 });
    if (!e) return;
    if (velocity) e.body.vel.copy(velocity);
    else e.body.vel.set(r() * 0.2 - 0.1, 0.2, r() * 0.2 - 0.1);
    e.yaw = r() * Math.PI * 2;
  }

  function dropXp(amount: number, x: number, y: number, z: number) {
    const r = getCtx().random;
    let left = Math.floor(amount);
    while (left > 0) {
      const v = orbValue(left);
      left -= v;
      const e = spawn("xp_orb", x, y, z, { value: v });
      if (e) e.body.vel.set((r() * 0.2 - 0.1) * 2, r() * 0.2 * 2, (r() * 0.2 - 0.1) * 2);
    }
  }

  function near(x: number, y: number, z: number, r: number, out: Entity[]) {
    out.length = 0;
    const c0x = Math.floor((x - r) / CELL), c1x = Math.floor((x + r) / CELL);
    const c0z = Math.floor((z - r) / CELL), c1z = Math.floor((z + r) / CELL);
    const r2 = r * r;
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cz = c0z; cz <= c1z; cz++) {
        const cell = grid.get(cellKey(cx, cz));
        if (!cell) continue;
        for (const e of cell) {
          if (e.data._remove) continue;
          const dx = e.body.pos.x - x, dy = e.body.pos.y + e.body.height / 2 - y, dz = e.body.pos.z - z;
          if (dx * dx + dy * dy + dz * dz <= r2) out.push(e);
        }
      }
    return out;
  }

  const rayList: Entity[] = [];
  function raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): EntityHit | null {
    const mx = origin.x + dir.x * maxDist * 0.5, my = origin.y + dir.y * maxDist * 0.5, mz = origin.z + dir.z * maxDist * 0.5;
    near(mx, my, mz, maxDist * 0.5 + 3, rayList);
    let best: Entity | null = null;
    let bestT = Infinity;
    for (const e of rayList) {
      if (e.dead || !(isMob(e.type) || e.type === "fireball" || e.type === "small_fireball")) continue;
      const t = segmentBody(origin.x, origin.y, origin.z, dir.x * maxDist, dir.y * maxDist, dir.z * maxDist, e.body, 0);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = e;
      }
    }
    rayList.length = 0;
    if (!best) return null;
    hitPoint.copy(dir).multiplyScalar(bestT * maxDist).add(origin);
    return { id: best.id, dist: bestT * maxDist, point: hitPoint.clone() };
  }

  function armorReduce(e: Entity, amount: number) {
    const armor = (e.data.armor as number) ?? 0;
    if (armor <= 0) return amount;
    const tough = (e.data.toughness as number) ?? 0;
    const eff = Math.min(20, Math.max(armor / 5, armor - amount / (2 + tough / 4)));
    return amount * (1 - eff / 25);
  }

  function damage(id: number, amount: number, source: DamageSource, attacker?: Entity | "player") {
    const e = byId.get(id);
    if (!e || e.dead) return;
    const ctx = getCtx();
    const def = mobDef(e.type);
    if (!def) {
      if (attacker === "player" && (e.type === "fireball" || e.type === "small_fireball")) deflect(e, ctx);
      else if (e.type === "item" || e.type === "xp_orb") {
        if ((source === "fire" || source === "lava") && /^netherite_|^ancient_debris$/.test((e.data.stack as ItemStack)?.item ?? "")) return;
        if (source === "explosion" && (e.data.stack as ItemStack)?.item === "nether_star") return;
        e.health -= amount;
        if (e.health <= 0) e.data._remove = true;
      }
      return;
    }
    if (e.data.invulnerable && source !== "void") return;
    if ((source === "fire" || source === "lava") && (e.data.fireImmune || e.effects.some((f) => f.id === "fire_resistance"))) return;
    if (source === "drown" && e.data.waterBreathing) return;
    const inv = (e.data._inv as number) ?? 0;
    const last = (e.data._lastHurt as number) ?? 0;
    let dealt = amount;
    let fresh = true;
    if (inv > 10) {
      if (amount <= last) return;
      dealt = amount - last;
      fresh = false;
    }
    e.data._lastHurt = amount;
    if (fresh) e.data._inv = 20;
    if (source !== "fall" && source !== "drown" && source !== "starve" && source !== "void" && source !== "magic" && source !== "wither") dealt = armorReduce(e, dealt);
    const res = e.effects.find((f) => f.id === "resistance");
    if (res) dealt *= Math.max(0, 1 - (res.amplifier + 1) * 0.2);
    e.health -= dealt;
    e.data._idle = 0;
    if (fresh) {
      e.hurtTicks = 10;
      hurtSound(e, ctx, def);
    }
    let ax: number | undefined, az: number | undefined;
    if (attacker === "player") {
      ax = ctx.player.body.pos.x;
      az = ctx.player.body.pos.z;
      e.data._byPlayer = 100;
    } else if (attacker) {
      ax = attacker.body.pos.x;
      az = attacker.body.pos.z;
    }
    if (ax !== undefined && az !== undefined && fresh) knockBody(e.body, e.body.pos.x - ax, e.body.pos.z - az, 0.4, (e.data.kbResist as number) ?? 0);
    if (attacker && amount >= 0) {
      e.data._fromX = ax;
      e.data._fromZ = az;
      if (def.category === "passive" || def.category === "water" || def.category === "ambient") e.data._panic = 60 + Math.floor(ctx.random() * 40);
      const tgt = attacker === "player" ? "player" : attacker.id;
      if (attacker !== e) {
        e.data._hurtBy = tgt;
        if (def.category === "neutral" || def.category === "hostile") e.data._target = tgt;
      }
      if (attacker === "player") alertPets(ctx, e.id);
    }
    if (e.health <= 0) kill(e, ctx, def, attacker);
  }

  function kill(e: Entity, ctx: GameCtx, def: MobDef, attacker?: Entity | "player") {
    e.health = 0;
    e.dead = true;
    e.data._death = 0;
    e.body.vel.x *= 0.2;
    e.body.vel.z *= 0.2;
    deathSound(e, ctx, def);
    def.onDeath?.(e, ctx);
    const byPlayer = attacker === "player" || ((e.data._byPlayer as number) ?? 0) > 0;
    e.data._xpDrop = byPlayer;
    if (!isBaby(e) && def.drops) {
      const looting = attacker === "player" ? ctx.inventory.held()?.ench?.looting ?? 0 : 0;
      for (const s of rollDrops(def.drops, ctx, looting, ((e.data._fire as number) ?? 0) > 0)) dropItem(s, e.body.pos.x, e.body.pos.y + 0.3, e.body.pos.z);
    }
    if (e.data.saddle) dropItem({ item: "saddle", count: 1 }, e.body.pos.x, e.body.pos.y + 0.3, e.body.pos.z);
    if (attacker && attacker !== "player" && attacker.data.owner === "player" && e.data.owner !== "player") e.data._xpDrop = true;
    if (e.data.name) ctx.emit({ type: "chat", text: `${e.data.name} died`, color: "#aaaaaa" });
  }

  function finishDeath(e: Entity, ctx: GameCtx, def: MobDef) {
    const p = e.body.pos;
    for (let i = 0; i < 4; i++) ctx.emit({ type: "particles", kind: "smoke", x: p.x + (ctx.random() - 0.5) * e.body.width, y: p.y + ctx.random() * e.body.height, z: p.z + (ctx.random() - 0.5) * e.body.width, count: 5 });
    if (e.data._xpDrop && def.xp && !isBaby(e)) {
      const [a, b] = def.xp;
      dropXp(a + Math.floor(ctx.random() * (b - a + 1)), p.x, p.y + 0.5, p.z);
    }
    e.data._remove = true;
  }

  function knockback(id: number, dx: number, dz: number, strength: number) {
    const e = byId.get(id);
    if (!e || e.dead) return;
    knockBody(e.body, dx, dz, strength, (e.data.kbResist as number) ?? 0);
  }

  function interact(id: number, held: ItemStack | null) {
    const e = byId.get(id);
    if (!e || e.dead) return false;
    const ctx = getCtx();
    if (held?.item === "name_tag" && held.name && isMob(e.type)) {
      e.data.name = held.name;
      e.data.persistent = true;
      if (ctx.player.gameMode !== "creative") ctx.inventory.removeHeld(1);
      return true;
    }
    const def = mobDef(e.type);
    return def?.onInteract?.(e, ctx, held) ?? false;
  }

  function isFrozen(e: Entity, ctx: GameCtx) {
    return !ctx.world.isLoaded(Math.floor(e.body.pos.x), Math.floor(e.body.pos.z));
  }

  function tickOne(e: Entity, ctx: GameCtx) {
    const b = e.body;
    e.data._px = b.pos.x;
    e.data._py = b.pos.y;
    e.data._pz = b.pos.z;
    e.data._pyaw = e.yaw;
    e.data._phy = e.headYaw;
    e.data._ppitch = e.pitch;
    e.age++;
    if (e.hurtTicks > 0) e.hurtTicks--;
    if (e.data._inv) e.data._inv = (e.data._inv as number) - 1;
    if (e.data.swing) e.data.swing = (e.data.swing as number) - 1;
    if (e.data._fly !== undefined) {
      tickCollected(e);
      return;
    }
    const def = mobDef(e.type);
    if (!def) {
      MISC_TICK[e.type]?.(e, ctx);
      return;
    }
    if (e.dead) {
      const t = ((e.data._death as number) ?? 0) + 1;
      e.data._death = t;
      if (b.vel.lengthSq() > 1e-6 || !b.onGround) applyPhysics(e, ctx);
      if (t >= 20) finishDeath(e, ctx, def);
      return;
    }
    if (def.category === "hostile" && ctx.rules.difficulty === "peaceful" && !e.data.persistent) {
      e.data._remove = true;
      return;
    }
    baseTick(e, ctx, def);
    if (e.dead) return;
    ambientTick(e, ctx, def);
    def.tick(e, ctx);
    if (e.data._pa !== e.age && !e.dead) applyPhysics(e, ctx);
    walkAnim(e);
    stepSounds(e, ctx, def);
    spawner.despawn(ctx, e, def);
  }

  function walkAnim(e: Entity) {
    const dx = e.body.pos.x - (e.data._px as number);
    const dz = e.body.pos.z - (e.data._pz as number);
    const dist = Math.min(1, Math.hypot(dx, dz) * 4);
    const s = (e.data._ws as number) ?? 0;
    e.data._wso = s;
    const ns = s + (dist - s) * 0.4;
    e.data._ws = ns;
    e.data._wp = ((e.data._wp as number) ?? 0) + ns;
  }

  function purge() {
    let j = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.data._remove) {
        byId.delete(e.id);
        e.dead = true;
        continue;
      }
      list[j++] = e;
    }
    list.length = j;
  }

  return {
    spawn,
    dropItem,
    dropXp,
    get: (id) => byId.get(id),
    all: () => list,
    near,
    raycast,
    damage,
    knockback,
    interact,
    explode(x, y, z, power, fire) {
      explodeAt(getCtx(), x, y, z, power, { fire });
    },
    count(category) {
      let n = 0;
      for (const e of list) if (!e.dead && mobDef(e.type)?.category === category) n++;
      return n;
    },
    tick(ctx) {
      const n = list.length;
      for (let i = 0; i < n && i < list.length; i++) {
        const e = list[i];
        if (e.data._remove) continue;
        if (isFrozen(e, ctx)) {
          e.data._frozen = true;
          const def = mobDef(e.type);
          if (def && despawns(e, def)) e.data._remove = true;
          continue;
        }
        e.data._frozen = false;
        tickOne(e, ctx);
      }
      purge();
      rebuildGrid();
      spawner.tick(ctx, list);
    },
    frame(dt, partialTick) {
      views.frame(list, partialTick, dt);
    },
    save() {
      const out: EntitySave[] = [];
      for (const e of list) {
        if (e.dead || e.data._remove) continue;
        const data = stripData(e.data);
        if (isMob(e.type)) {
          data.health = e.health;
          if (e.effects.length) data.effects = e.effects.map((f) => ({ ...f }));
        }
        if (PROJECTILES.has(e.type) || e.type === "tnt" || e.type === "falling_block" || e.type === "item" || e.type === "xp_orb") {
          data.vel = [e.body.vel.x, e.body.vel.y, e.body.vel.z];
          data.age = e.age;
        }
        out.push({ type: e.type, x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z, yaw: e.yaw, data });
      }
      out.push({ type: "__spawned", x: 0, y: 0, z: 0, data: { chunks: [...spawner.visited] } });
      return out;
    },
    load(saves) {
      for (const e of list) e.data._remove = true;
      purge();
      views.clear();
      for (const s of saves) {
        if (s.type === "__spawned") {
          spawner.visited.clear();
          for (const k of (s.data?.chunks as number[]) ?? []) spawner.visited.add(k);
          continue;
        }
        const data = { ...(s.data ?? {}) };
        const age = typeof data.age === "number" && !isMob(s.type) ? data.age : 0;
        if (!isMob(s.type)) delete data.age;
        const e = spawn(s.type, s.x, s.y, s.z, { ...data, yaw: s.yaw });
        if (!e) continue;
        e.age = age;
        if (typeof s.yaw === "number") {
          e.yaw = s.yaw;
          e.headYaw = s.yaw;
        }
      }
      rebuildGrid();
    },
    dispose() {
      views.dispose();
      list.length = 0;
      byId.clear();
      grid.clear();
    },
  };
}

