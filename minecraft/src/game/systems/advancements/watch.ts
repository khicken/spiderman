import * as THREE from "three";
import type { Entity, GameCtx, GameEvent } from "../../contracts";
import { idOf, metaOf } from "../../contracts";
import { blockByName, blockDef } from "../../blocks/registry";
import { findNear } from "../../worldgen/structure-grid";
import { advTrigger, type Dim3 } from "./bus";

// [name, horizontal reach, vertical half-height around the start y or 0 for any]
const STRUCTS: Record<Dim3, [string, number, number][]> = {
  overworld: [["trial_chambers", 40, 0], ["stronghold", 90, 40]],
  nether: [["fortress", 96, 0], ["bastion_remnant", 56, 0]],
  end: [["end_city", 48, 0]],
};
const HONEY = blockByName("honey_block")?.id;
const POWDER = blockByName("powder_snow")?.id;
const SENSORS = new Set(["sculk_sensor", "calibrated_sculk_sensor"].map((n) => blockByName(n)?.id).filter((v): v is number => v !== undefined));
const TAMEABLE = new Set(["wolf", "cat", "parrot", "horse", "donkey", "mule", "llama", "trader_llama", "camel", "skeleton_horse", "zombie_horse"]);
const eye = new THREE.Vector3();
const near: Entity[] = [];

interface Track {
  inv: string;
  fx: string;
  sleeping: boolean;
  totem: number;
  levStart: number | null;
  levBest: number;
  airPeak: number | null;
  launch: { y: number; peak: number; tick: number } | null;
  wild: Set<number>;
  dragon: number | null;
  rideX: number;
  rideZ: number;
  rideDist: number;
  structs: string[];
}

const fresh = (): Track => ({ inv: "", fx: "", sleeping: false, totem: 0, levStart: null, levBest: 0, airPeak: null, launch: null, wild: new Set(), dragon: null, rideX: NaN, rideZ: NaN, rideDist: 0, structs: [] });

export function createWatcher(isDone: (id: string) => boolean) {
  let s = fresh();

  function inventory(ctx: GameCtx) {
    const slots = ctx.inventory.slots;
    let sig = "";
    for (const st of slots) sig += (st?.item ?? "") + ",";
    if (sig === s.inv) return;
    s.inv = sig;
    const items = new Set<string>();
    for (const st of slots) if (st) items.add(st.item);
    advTrigger({ t: "inventory_changed", items, armor: [36, 37, 38, 39].map((i) => slots[i]?.item ?? null) });
  }

  function structures(ctx: GameCtx) {
    const p = ctx.player.body.pos;
    const out: string[] = [];
    for (const [name, reach, dy] of STRUCTS[ctx.world.dim as Dim3] ?? []) {
      const st = findNear(ctx.world.seed, name, p.x, p.z, reach);
      if (st && (!dy || Math.abs(p.y - st.y) <= dy)) out.push(name);
    }
    if (out.includes("trial_chambers") && p.y > 0) out.splice(out.indexOf("trial_chambers"), 1);
    s.structs = out;
  }

  function location(ctx: GameCtx) {
    const p = ctx.player.body.pos;
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    const biome = (ctx.world.getBiomeAt?.(x, y, z) ?? ctx.world.getBiome(x, z)).name;
    const v = ctx.player.vehicle != null ? ctx.entities.get(ctx.player.vehicle) : undefined;
    advTrigger({ t: "location", dim: ctx.world.dim as Dim3, biome, structures: s.structs, y: p.y, vehicle: v?.type, inLava: v?.body.inLava });
    if (v?.type.endsWith("boat") && ctx.entities.near(v.body.pos.x, v.body.pos.y, v.body.pos.z, 1.6, near).some((e) => e.type === "goat")) advTrigger({ t: "ride_with", vehicle: v.type, passenger: "goat" });
  }

  function ride(ctx: GameCtx) {
    const v = ctx.player.vehicle != null ? ctx.entities.get(ctx.player.vehicle) : undefined;
    if (!v || v.type !== "strider" || !v.body.inLava) {
      s.rideDist = 0;
      s.rideX = NaN;
      return;
    }
    const p = v.body.pos;
    if (!Number.isNaN(s.rideX)) s.rideDist += Math.hypot(p.x - s.rideX, p.z - s.rideZ);
    s.rideX = p.x;
    s.rideZ = p.z;
    advTrigger({ t: "ride_distance", vehicle: "strider", dim: ctx.world.dim as Dim3, distance: s.rideDist, lava: true });
  }

  function effects(ctx: GameCtx) {
    const ids = ctx.player.effects.map((e) => e.id).sort();
    const sig = ids.join(",");
    if (sig === s.fx) return;
    s.fx = sig;
    advTrigger({ t: "effects_changed", effects: ids });
  }

  function body(ctx: GameCtx) {
    const pl = ctx.player, b = pl.body;
    const lev = pl.effects.some((e) => e.id === "levitation");
    if (lev) {
      s.levStart ??= b.pos.y;
      const d = Math.floor(b.pos.y - s.levStart);
      if (d > s.levBest) {
        s.levBest = d;
        advTrigger({ t: "levitation", distance: d });
      }
    } else {
      s.levStart = null;
      s.levBest = 0;
    }
    const grounded = b.onGround || b.inWater || b.inLava || b.onClimbable || pl.flying || pl.dead || pl.vehicle != null;
    if (!grounded) s.airPeak = Math.max(s.airPeak ?? b.pos.y, b.pos.y);
    else if (s.airPeak !== null) {
      if (!pl.dead && s.airPeak - b.pos.y > 3) advTrigger({ t: "fall_from_height", startY: s.airPeak, endY: b.pos.y });
      s.airPeak = null;
    }
    const L = s.launch;
    if (L) {
      L.peak = Math.max(L.peak, b.pos.y);
      if ((b.vel.y <= 0 && ctx.time.tick - L.tick > 2) || ctx.time.tick - L.tick > 100) {
        advTrigger({ t: "wind_launch", height: L.peak - L.y });
        s.launch = null;
      }
    }
    if (!b.onGround && b.vel.y < -0.08 && HONEY !== undefined) {
      const x = b.pos.x, y = Math.floor(b.pos.y), z = b.pos.z, r = b.width / 2 + 0.05;
      const w = ctx.world;
      if ((idOf(w.getBlock(Math.floor(x + r), y, Math.floor(z))) === HONEY) || (idOf(w.getBlock(Math.floor(x - r), y, Math.floor(z))) === HONEY) || (idOf(w.getBlock(Math.floor(x), y, Math.floor(z + r))) === HONEY) || (idOf(w.getBlock(Math.floor(x), y, Math.floor(z - r))) === HONEY))
        advTrigger({ t: "honey_slide" });
    }
    if (b.onGround && POWDER !== undefined && ctx.inventory.slots[39]?.item === "leather_boots") {
      const id = idOf(ctx.world.getBlock(Math.floor(b.pos.x), Math.floor(b.pos.y - 0.01), Math.floor(b.pos.z)));
      if (id === POWDER) advTrigger({ t: "powder_snow_walk" });
    }
    if (pl.sleeping && !s.sleeping) advTrigger({ t: "slept" });
    s.sleeping = pl.sleeping;
    const totem = (pl as { totemTicks?: number }).totemTicks ?? 0;
    if (totem > s.totem) advTrigger({ t: "used_totem" });
    s.totem = totem;
  }

  function spyglass(ctx: GameCtx) {
    if ((ctx.player as { using?: { kind: string } | null }).using?.kind !== "spyglass") return;
    eye.copy(ctx.player.eye());
    const hit = ctx.entities.raycast(eye, ctx.player.lookDir(), 256);
    const e = hit && ctx.entities.get(hit.id);
    if (e) advTrigger({ t: "spyglass", target: e.type });
  }

  function sneak(ctx: GameCtx) {
    const pl = ctx.player, b = pl.body;
    if (!pl.sneaking || !b.onGround || Math.hypot(b.vel.x, b.vel.z) < 0.01) return;
    const x = Math.floor(b.pos.x), y = Math.floor(b.pos.y), z = Math.floor(b.pos.z);
    let hit = ctx.entities.near(b.pos.x, b.pos.y, b.pos.z, 16, near).some((e) => e.type === "warden");
    for (let dy = -8; dy <= 8 && !hit; dy++)
      for (let dz = -8; dz <= 8 && !hit; dz++)
        for (let dx = -8; dx <= 8; dx++)
          if (SENSORS.has(idOf(ctx.world.getBlock(x + dx, y + dy, z + dz)))) {
            hit = true;
            break;
          }
    if (hit) advTrigger({ t: "avoid_vibration" });
  }

  function pets(ctx: GameCtx) {
    const p = ctx.player.body.pos;
    for (const e of ctx.entities.near(p.x, p.y, p.z, 24, near)) {
      if (!TAMEABLE.has(e.type)) continue;
      if (e.data.owner === "player") {
        if (s.wild.delete(e.id)) advTrigger({ t: "tamed", type: e.type, variant: e.data.variant as string | undefined });
      } else if (!e.data.owner) s.wild.add(e.id);
    }
    if (s.wild.size > 512) s.wild.clear();
  }

  function dragon(ctx: GameCtx) {
    if (ctx.world.dim !== "end") return;
    let id: number | null = null;
    for (const e of ctx.entities.all()) if (e.type === "ender_dragon" && !e.dead) id = e.id;
    if (id !== null && id !== s.dragon && isDone("end/kill_dragon")) advTrigger({ t: "respawn_dragon" });
    s.dragon = id;
  }

  return {
    stage(ctx: GameCtx) {
      const keep = s.inv;
      s = fresh();
      s.inv = keep;
      structures(ctx);
    },
    tick(ctx: GameCtx) {
      const t = ctx.time.tick;
      body(ctx);
      if (t % 10 === 0) inventory(ctx);
      if (t % 5 === 0) spyglass(ctx);
      if (t % 20 === 5) {
        effects(ctx);
        location(ctx);
        ride(ctx);
      }
      if (t % 40 === 15) structures(ctx);
      if (t % 20 === 10) pets(ctx);
      if (t % 20 === 15 && !isDone("adventure/avoid_vibration")) sneak(ctx);
      if (t % 40 === 30) dragon(ctx);
    },
    onEvent(ctx: GameCtx, e: GameEvent) {
      const p = ctx.player.body.pos;
      if (e.type === "particles" && e.kind === "gust" && (e.x - p.x) ** 2 + (e.y - p.y - 0.5) ** 2 + (e.z - p.z) ** 2 < 9) s.launch = { y: p.y, peak: p.y, tick: ctx.time.tick };
      else if (e.type === "block_changed" && blockDef(e.to).name === "respawn_anchor" && metaOf(e.to) >= 4 && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 + (e.z - p.z) ** 2 < 64)
        advTrigger({ t: "item_used_on_block", item: "glowstone", block: "respawn_anchor", to: "charged", x: e.x, y: e.y, z: e.z });
      else if (e.type === "open_container" && (e.kind === "chest" || e.kind === "large_chest" || e.kind === "barrel") && e.x !== undefined && e.z !== undefined && ctx.world.dim === "nether") {
        if (findNear(ctx.world.seed, "bastion_remnant", e.x, e.z, 56)) advTrigger({ t: "container_loot", structure: "bastion_remnant" });
      }
    },
    reset() {
      s = fresh();
    },
  };
}
