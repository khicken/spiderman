import type { Entity, GameCtx, HudState } from "../../contracts";
import { MIN_Y } from "../../contracts";
import { moveTo } from "../../entities/ai";
import { nearestPoi, requestArea } from "./poi";

type Bar = HudState["bossBars"][number];
type Raider = "pillager" | "vindicator" | "ravager" | "witch" | "evoker";

// Vanilla Raid.RaiderType spawnsPerWaveBeforeBonus, indexed by wave 1..7.
const WAVES: [Raider, number[]][] = [
  ["vindicator", [0, 0, 2, 0, 1, 4, 2, 5]],
  ["evoker", [0, 0, 0, 0, 0, 1, 1, 2]],
  ["pillager", [0, 4, 3, 3, 4, 4, 4, 2]],
  ["witch", [0, 0, 0, 0, 3, 0, 0, 1]],
  ["ravager", [0, 0, 0, 1, 0, 1, 0, 2]],
];
const GROUPS = { peaceful: 0, easy: 3, normal: 5, hard: 7 };
const COOLDOWN = 300;
const OMEN_TICKS = 600;

export interface RaidState {
  x: number;
  y: number;
  z: number;
  level: number;
  groups: number;
  wave: number;
  cooldown: number;
  status: "ongoing" | "victory" | "defeat";
  endTimer: number;
  ticks: number;
  waveHealth: number;
  hadVillagers: boolean;
}

export interface OmenState {
  pending: { x: number; y: number; z: number; level: number; ticks: number } | null;
  raid: RaidState | null;
}

const near: Entity[] = [];

function bonusSpawns(type: Raider, ctx: GameCtx, wave: number, bonus: boolean): number {
  const d = ctx.rules.difficulty;
  let i = 0;
  if (type === "pillager" || type === "vindicator") i = d === "easy" ? Math.floor(ctx.random() * 2) : d === "normal" ? 1 : 2;
  else if (type === "witch") i = d === "easy" || wave <= 2 || wave === 4 ? 0 : 1;
  else if (type === "ravager") i = d !== "easy" && bonus ? 1 : 0;
  return i > 0 ? Math.floor(ctx.random() * (i + 1)) : 0;
}

function villageCenter(ctx: GameCtx, x: number, y: number, z: number): { x: number; y: number; z: number } {
  requestArea(ctx, x, y, z, 32);
  const bell = nearestPoi(ctx, "bell", x, y, z, 64);
  return bell ? { x: bell.x + 0.5, y: bell.y, z: bell.z + 0.5 } : { x, y, z };
}

export function nearVillage(ctx: GameCtx): boolean {
  const p = ctx.player.body.pos;
  ctx.entities.near(p.x, p.y, p.z, 32, near);
  const v = near.some((o) => o.type === "villager" && !o.dead);
  near.length = 0;
  return v;
}

function spawnSpot(ctx: GameCtx, r: RaidState): { x: number; y: number; z: number } | null {
  const w = ctx.world;
  for (let i = 0; i < 20; i++) {
    const a = ctx.random() * Math.PI * 2;
    const d = 32 - i;
    const x = Math.floor(r.x + Math.cos(a) * d), z = Math.floor(r.z + Math.sin(a) * d);
    if (!w.isLoaded(x, z)) continue;
    const y = w.topY(x, z);
    if (y <= MIN_Y) continue;
    return { x: x + 0.5, y: y + 1, z: z + 0.5 };
  }
  return null;
}

function spawnWave(ctx: GameCtx, r: RaidState) {
  const bonus = r.wave === r.groups && r.level > 1;
  r.wave++;
  const idx = bonus ? r.groups : r.wave;
  r.waveHealth = 0;
  const spot = spawnSpot(ctx, r);
  if (!spot) return;
  ctx.emit({ type: "sound", name: "event.raid.horn", x: spot.x, y: spot.y, z: spot.z, volume: 64 });
  for (const [type, table] of WAVES) {
    const n = (table[Math.min(idx, 7)] ?? 0) + bonusSpawns(type, ctx, r.wave, bonus);
    for (let i = 0; i < n; i++) {
      const data = { raid: true, persistent: true, patrolX: r.x, patrolZ: r.z, captain: false };
      const sx = spot.x + (ctx.random() - 0.5) * 4, sz = spot.z + (ctx.random() - 0.5) * 4;
      const e = ctx.entities.spawn(type, sx, spot.y, sz, data) ?? ctx.entities.spawn("vindicator", sx, spot.y, sz, data);
      if (e) r.waveHealth += e.maxHealth;
    }
  }
}

function raiders(ctx: GameCtx): Entity[] {
  const out: Entity[] = [];
  for (const e of ctx.entities.all()) if (e.data.raid && !e.dead) out.push(e);
  return out;
}

function villagersNear(ctx: GameCtx, r: RaidState): Entity[] {
  ctx.entities.near(r.x, r.y, r.z, 96, near);
  const out = near.filter((o) => o.type === "villager" && !o.dead);
  near.length = 0;
  return out;
}

function steer(ctx: GameCtx, r: RaidState, list: Entity[], villagers: Entity[]) {
  for (const e of list) {
    if (e.data._target !== undefined) continue;
    const p = e.body.pos;
    let best: Entity | null = null;
    let bd = 16 * 16;
    for (const v of villagers) {
      const d = v.body.pos.distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (best && (e.age + e.id) % 10 === 0) e.data._target = best.id;
    else if ((p.x - r.x) ** 2 + (p.z - r.z) ** 2 > 64) moveTo(e, ctx, r.x, r.y, r.z, 0.35);
  }
}

export function startRaid(ctx: GameCtx, x: number, y: number, z: number, level: number): RaidState {
  const c = villageCenter(ctx, Math.floor(x), Math.floor(y), Math.floor(z));
  const groups = GROUPS[ctx.rules.difficulty] || 3;
  return { ...c, level, groups, wave: 0, cooldown: COOLDOWN, status: "ongoing", endTimer: 0, ticks: 0, waveHealth: 0, hadVillagers: false };
}

export function tickRaid(ctx: GameCtx, r: RaidState): boolean {
  r.ticks++;
  if (r.status !== "ongoing") return --r.endTimer > 0;
  const list = raiders(ctx);
  const villagers = villagersNear(ctx, r);
  if (villagers.length) r.hadVillagers = true;
  const total = r.groups + (r.level > 1 ? 1 : 0);
  if ((r.hadVillagers && !villagers.length && r.wave > 0) || r.ticks > 48000) {
    r.status = "defeat";
    r.endTimer = 200;
    ctx.emit({ type: "sound", name: "event.raid.horn", x: r.x, y: r.y, z: r.z, volume: 0.5 });
    return true;
  }
  if (!list.length) {
    if (r.wave >= total) {
      r.status = "victory";
      r.endTimer = 200;
      const pl = ctx.player as typeof ctx.player & { addEffect?(id: string, amp: number, ticks: number): void };
      const pp = pl.body.pos;
      if ((pp.x - r.x) ** 2 + (pp.z - r.z) ** 2 < 96 * 96 && !pl.dead) {
        pl.addEffect?.("hero_of_the_village", Math.min(4, r.level - 1), 48000);
        ctx.emit({ type: "advancement", title: "Hero of the Village" });
      }
      ctx.emit({ type: "sound", name: "ui.toast.challenge_complete", volume: 0.6 });
      return true;
    }
    r.cooldown--;
    if (r.cooldown <= 0) {
      spawnWave(ctx, r);
      r.cooldown = COOLDOWN;
    }
    return true;
  }
  if (ctx.time.tick % 2 === 0) steer(ctx, r, list, villagers);
  return true;
}

export function raidBar(ctx: GameCtx, r: RaidState): Bar {
  if (r.status === "victory") return { id: "raid", name: "Raid - Victory", progress: 0, color: "red" };
  if (r.status === "defeat") return { id: "raid", name: "Raid - Defeat", progress: 0, color: "red" };
  const list = raiders(ctx);
  if (!list.length) return { id: "raid", name: "Raid", progress: 1 - r.cooldown / COOLDOWN, color: "red" };
  const hp = list.reduce((a, e) => a + Math.max(0, e.health), 0);
  const name = list.length <= 2 ? `Raid - Raiders Remaining: ${list.length}` : "Raid";
  return { id: "raid", name, progress: Math.min(1, hp / Math.max(1, r.waveHealth)), color: "red" };
}

export function tickOmen(ctx: GameCtx, s: OmenState) {
  const pl = ctx.player as typeof ctx.player & { addEffect?(id: string, amp: number, ticks: number): void };
  if (ctx.world.dim !== "overworld" || ctx.rules.difficulty === "peaceful") return;
  if (s.pending) {
    s.pending.ticks--;
    const omen = pl.effects.find((f) => f.id === "raid_omen");
    if (!omen) {
      if (s.pending.ticks <= 5 && !s.raid) s.raid = startRaid(ctx, s.pending.x, s.pending.y, s.pending.z, s.pending.level);
      s.pending = null;
    }
    return;
  }
  if (s.raid || ctx.time.tick % 20 !== 0) return;
  const bad = pl.effects.find((f) => f.id === "bad_omen");
  if (!bad || !nearVillage(ctx)) return;
  pl.effects.splice(pl.effects.indexOf(bad), 1);
  pl.addEffect?.("raid_omen", bad.amplifier, OMEN_TICKS);
  if (!pl.effects.some((f) => f.id === "raid_omen")) pl.effects.push({ id: "raid_omen", amplifier: bad.amplifier, ticks: OMEN_TICKS });
  const p = pl.body.pos;
  s.pending = { x: p.x, y: p.y, z: p.z, level: bad.amplifier + 1, ticks: OMEN_TICKS };
  ctx.emit({ type: "sound", name: "event.mob_effect.raid_omen", x: p.x, y: p.y, z: p.z });
}
