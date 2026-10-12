import type { BlockEntityData, GameCtx } from "../contracts";
import { idOf } from "../contracts";
import { SOLID } from "../blocks/registry";
import type { SystemPart } from "../systems";
import { fortressBoxes } from "../worldgen/fortress";
import { findNear } from "../worldgen/structure-grid";
import { rollLoot } from ".";

const FLYING = new Set(["blaze", "breeze", "vex", "ghast", "phantom", "bat", "allay"]);
const FORTRESS_MOBS: [string, number][] = [["blaze", 10], ["zombified_piglin", 5], ["wither_skeleton", 8], ["skeleton", 2], ["magma_cube", 3]];

type D = Record<string, unknown>;
const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);

function free(ctx: GameCtx, x: number, y: number, z: number, flying: boolean): boolean {
  const w = ctx.world;
  if (SOLID[idOf(w.getBlock(x, y, z))] || SOLID[idOf(w.getBlock(x, y + 1, z))]) return false;
  return flying || SOLID[idOf(w.getBlock(x, y - 1, z))] === 1;
}

function near(ctx: GameCtx, type: string, x: number, y: number, z: number, r: number): number {
  let n = 0;
  for (const e of ctx.entities.all()) {
    if (e.type !== type || e.dead) continue;
    const p = e.body.pos;
    if (Math.abs(p.x - x) <= r && Math.abs(p.y - y) <= r && Math.abs(p.z - z) <= r) n++;
  }
  return n;
}

function spawnAround(ctx: GameCtx, be: BlockEntityData, mob: string, range: number, extra: D = {}): number {
  const flying = FLYING.has(mob);
  for (let k = 0; k < 8; k++) {
    const x = be.x + Math.floor((ctx.random() - ctx.random()) * range);
    const y = be.y + Math.floor(ctx.random() * 3) - 1;
    const z = be.z + Math.floor((ctx.random() - ctx.random()) * range);
    if (!free(ctx, x, y, z, flying)) continue;
    const e = ctx.entities.spawn(mob, x + 0.5, y, z + 0.5, { persistent: false, ...extra });
    if (!e) return -1;
    ctx.emit({ type: "particles", kind: "flame", x: x + 0.5, y: y + 0.5, z: z + 0.5, count: 12 });
    return e.id;
  }
  return -1;
}

// Vanilla mob spawner: active with a player within 16 blocks, 4 tries per cycle, 200-800 tick delay, at most 6 nearby.
function tickSpawner(ctx: GameCtx, be: BlockEntityData, d: D) {
  const p = ctx.player.body.pos;
  const dx = p.x - be.x - 0.5, dy = p.y - be.y - 0.5, dz = p.z - be.z - 0.5;
  if (dx * dx + dy * dy + dz * dz > 256 || ctx.player.gameMode === "spectator") return;
  if (ctx.time.tick % 10 === 0) ctx.emit({ type: "particles", kind: "flame", x: be.x + 0.5, y: be.y + 0.5, z: be.z + 0.5, count: 2 });
  const delay = num(d.delay, 20) - 1;
  if (delay > 0) {
    d.delay = delay;
    return;
  }
  const mob = String(d.mob ?? d.entity ?? "pig");
  d.delay = 200 + Math.floor(ctx.random() * 601);
  if (near(ctx, mob, be.x, be.y, be.z, 8) >= 6) return;
  for (let k = 0; k < 4; k++) spawnAround(ctx, be, mob, 4);
}

// Trial spawner: waves of 6 mobs (+2 per extra player), 2 at a time every 40 ticks, then reward and a 30 minute cooldown.
function tickTrial(ctx: GameCtx, be: BlockEntityData, d: D) {
  const t = ctx.time.tick;
  const p = ctx.player.body.pos;
  const dist2 = (p.x - be.x - 0.5) ** 2 + (p.y - be.y) ** 2 + (p.z - be.z - 0.5) ** 2;
  const raw = String(d.state ?? "waiting");
  const state = raw === "active" || raw === "ejecting" || raw === "cooldown" ? raw : "waiting";
  const at = { x: be.x + 0.5, y: be.y + 0.5, z: be.z + 0.5 };
  if (state === "cooldown") {
    if (t >= num(d.until)) d.state = "waiting";
    return;
  }
  if (state === "waiting") {
    if (dist2 > 14 * 14 || ctx.player.gameMode === "creative" || ctx.player.gameMode === "spectator") return;
    d.state = "active";
    d.total = 6;
    d.spawned = 0;
    d.alive = [];
    d.next = t + 20;
    ctx.emit({ type: "sound", name: "block.trial_spawner.detect_player", ...at });
    return;
  }
  if (state === "active") {
    const alive = ((d.alive as number[]) ?? []).filter((id) => {
      const e = ctx.entities.get(id);
      return !!e && !e.dead;
    });
    d.alive = alive;
    if (num(d.spawned) < num(d.total, 6)) {
      if (alive.length < 2 && t >= num(d.next)) {
        const id = spawnAround(ctx, be, String(d.mob ?? d.entity ?? "zombie"), 4, { persistent: true, trialSpawner: [be.x, be.y, be.z] });
        d.next = t + 40;
        if (id >= 0) {
          alive.push(id);
          d.spawned = num(d.spawned) + 1;
          ctx.emit({ type: "sound", name: "block.trial_spawner.spawn_mob", ...at });
        } else if (dist2 > 47 * 47) d.state = "waiting";
      }
      return;
    }
    if (alive.length) return;
    d.state = "ejecting";
    d.next = t + 40;
    ctx.emit({ type: "sound", name: "block.trial_spawner.about_to_spawn_item", ...at });
    return;
  }
  if (state === "ejecting" && t >= num(d.next)) {
    const table = ctx.random() < 0.5 ? "trial_spawner_key" : "trial_spawner_consumables";
    for (const s of rollLoot(table, Math.floor(ctx.random() * 0x7fffffff))) ctx.entities.dropItem(s, be.x + 0.5, be.y + 1.2, be.z + 0.5);
    ctx.emit({ type: "sound", name: "block.trial_spawner.eject_item", ...at });
    d.state = "cooldown";
    d.until = t + 36000;
  }
}

function tickFortress(ctx: GameCtx) {
  if (ctx.world.dim !== "nether" || ctx.time.tick % 40 !== 7 || ctx.rules.difficulty === "peaceful" || !ctx.rules.doMobSpawning) return;
  if (ctx.entities.count("hostile") >= 70) return;
  const p = ctx.player.body.pos;
  const s = findNear(ctx.world.seed, "fortress", p.x, p.z, 112);
  if (!s) return;
  const boxes = fortressBoxes(s);
  const piece = boxes[Math.floor(ctx.random() * boxes.length)];
  const x = piece.x0 + 1 + Math.floor(ctx.random() * Math.max(1, piece.x1 - piece.x0 - 1));
  const z = piece.z0 + 1 + Math.floor(ctx.random() * Math.max(1, piece.z1 - piece.z0 - 1));
  const y = piece.y + 1;
  const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
  if (d2 < 24 * 24 || d2 > 96 * 96 || !ctx.world.isLoaded(x, z)) return;
  if (ctx.world.getBlockLight(x, y, z) > 11) return;
  let total = 0;
  for (const m of FORTRESS_MOBS) total += m[1];
  let roll = ctx.random() * total;
  let mob = FORTRESS_MOBS[0][0];
  for (const [m, wgt] of FORTRESS_MOBS) {
    roll -= wgt;
    if (roll < 0) {
      mob = m;
      break;
    }
  }
  if (!free(ctx, x, y, z, false) || (mob === "wither_skeleton" && SOLID[idOf(ctx.world.getBlock(x, y + 2, z))])) return;
  ctx.entities.spawn(mob, x + 0.5, y, z + 0.5, { natural: true });
}

export function createSpawners(): SystemPart {
  return {
    name: "spawners",
    tick(ctx) {
      const w = ctx.world;
      if (!w.blockEntitiesIn) return;
      const p = ctx.player.body.pos;
      const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
      for (let cx = pcx - 2; cx <= pcx + 2; cx++) {
        for (let cz = pcz - 2; cz <= pcz + 2; cz++) {
          const list = w.blockEntitiesIn(cx, cz);
          if (!list) continue;
          for (const be of list) {
            if (be.type === "spawner") tickSpawner(ctx, be, (be.data ??= {}));
            else if (be.type === "trial_spawner") tickTrial(ctx, be, (be.data ??= {}));
          }
        }
      }
      tickFortress(ctx);
    },
  };
}
