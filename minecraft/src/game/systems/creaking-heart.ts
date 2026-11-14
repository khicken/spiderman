import type { BlockEntityData, BlockState, Entity, GameCtx } from "../contracts";
import { AIR, idOf, metaOf, stateOf } from "../contracts";
import { blockDef, blockId, hasBlock, SOLID } from "../blocks/registry";
import type { SystemPart } from "./index";

export const UPROOTED = 0, DORMANT = 1, AWAKE = 2;
export const HEART_RANGE = 32;
export const TWITCH_TICKS = 18;
// Vanilla CreakingHeartBlock: a natural heart drops UniformInt.of(20, 24) experience.
export const HEART_XP: [number, number] = [20, 24];
const RESIN_COLOR = 0xfc7812;
const AXES = [[0, 1, 0], [1, 0, 0], [0, 0, 1]];
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const PALE_LOGS = new Set(["pale_oak_log", "pale_oak_wood", "stripped_pale_oak_log", "stripped_pale_oak_wood"]);

export interface HeartPos { x: number; y: number; z: number }

type Player = GameCtx["player"];
// The multiplayer host installs playersAll (host plus every client in this dimension); single player has only ctx.player.
export const allPlayers = (ctx: GameCtx): Player[] => (ctx as GameCtx & { playersAll?: () => Player[] }).playersAll?.() ?? [ctx.player];

let heartId = -1, resinId = -1;
const heart = () => (heartId >= 0 ? heartId : (heartId = hasBlock("creaking_heart") ? blockId("creaking_heart") : 0));
const resin = () => (resinId >= 0 ? resinId : (resinId = hasBlock("resin_clump") ? blockId("resin_clump") : 0));

export const isHeart = (s: BlockState) => heart() !== 0 && idOf(s) === heart();
export const isPaleLog = (s: BlockState) => PALE_LOGS.has(blockDef(s).name);
export const heartStateOf = (s: BlockState) => (metaOf(s) >> 2) & 3;
export const withHeartState = (s: BlockState, st: number) => stateOf(idOf(s), (metaOf(s) & 3) | (st << 2));

// Vanilla isNaturalNight: a natural dimension (overworld here) and the sky dark enough to count as night.
export function naturalNight(ctx: GameCtx): boolean {
  if (ctx.world.dim !== "overworld") return false;
  const t = ((ctx.time.dayTime % 24000) + 24000) % 24000;
  return t >= 13000 && t < 23000;
}

export function heartState(ctx: GameCtx, x: number, y: number, z: number, s = ctx.world.getBlock(x, y, z)): number {
  const [dx, dy, dz] = AXES[metaOf(s) & 3] ?? AXES[0];
  const w = ctx.world;
  if (!isPaleLog(w.getBlock(x + dx, y + dy, z + dz)) || !isPaleLog(w.getBlock(x - dx, y - dy, z - dz))) return UPROOTED;
  return naturalNight(ctx) ? AWAKE : DORMANT;
}

const claims = (e: Entity, x: number, y: number, z: number) => {
  const h = e.data.heart as HeartPos | undefined;
  return e.type === "creaking" && !e.dead && !e.data._remove && !twitching(e) && !!h && h.x === x && h.y === y && h.z === z;
};

// Entity ids change on reload, so a stale id falls back to the creaking whose saved heart is this one.
export function heartCreaking(ctx: GameCtx, be: BlockEntityData): Entity | undefined {
  const d = (be.data ??= {});
  const cur = typeof d.creaking === "number" ? ctx.entities.get(d.creaking) : undefined;
  if (cur && claims(cur, be.x, be.y, be.z)) return cur;
  for (const e of ctx.entities.all()) {
    if (claims(e, be.x, be.y, be.z)) {
      d.creaking = e.id;
      return e;
    }
  }
  delete d.creaking;
  return undefined;
}

export function trail(ctx: GameCtx, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  const n = Math.min(24, Math.max(4, Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) * 1.5)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    ctx.emit({ type: "particles", kind: "dust", x: ax + (bx - ax) * t, y: ay + (by - ay) * t, z: az + (bz - az) * t, count: 1, color: RESIN_COLOR });
  }
}

export const twitching = (e: Entity) => typeof e.data._twitch === "number" && e.data._twitch > 0;

// Vanilla tearDown: the creaking twitches in place for a moment before it crumbles away.
export function crumble(ctx: GameCtx, e: Entity): void {
  if (e.data._remove || twitching(e)) return;
  e.data._twitch = TWITCH_TICKS;
  const p = e.body.pos;
  ctx.emit({ type: "sound", name: "entity.creaking.twitch", x: p.x, y: p.y + 1.3, z: p.z });
}

// Returns whether the creaking is gone.
export function twitchTick(ctx: GameCtx, e: Entity): boolean {
  const t = (e.data._twitch as number) - 1;
  e.data._twitch = t;
  if (t > 0) return false;
  const p = e.body.pos;
  const wood = hasBlock("pale_oak_wood") ? stateOf(blockId("pale_oak_wood")) : AIR;
  const rb = hasBlock("resin_block") ? stateOf(blockId("resin_block")) : AIR;
  for (let i = 0; i < 3; i++) ctx.emit({ type: "particles", kind: "block", x: p.x, y: p.y + 0.4 + i * 0.9, z: p.z, count: 14, state: wood });
  ctx.emit({ type: "particles", kind: "block", x: p.x, y: p.y + 1.6, z: p.z, count: 8, state: rb });
  ctx.emit({ type: "sound", name: "entity.creaking.death", x: p.x, y: p.y + 1.3, z: p.z });
  e.data._remove = true;
  return true;
}

export function naturalHeartXp(w: GameCtx["world"], x: number, y: number, z: number, s: BlockState): [number, number] | undefined {
  return isHeart(s) && w.getBlockEntity(x, y, z)?.data?.natural ? HEART_XP : undefined;
}

// Creakings a player made (spawn egg, /summon, spawner) are unlinked by design; this marks them so a creaking
// that lost its heart (older saves) can still be told apart and discarded.
export const unlinkedData = (type: string): Record<string, unknown> => (type === "creaking" ? { unlinked: true } : {});
export const keepsUnlinked = (e: Entity) => !!e.data.unlinked;

export function linkHolds(ctx: GameCtx, e: Entity): boolean {
  const h = e.data.heart as HeartPos | undefined;
  if (!h) return true;
  const w = ctx.world;
  if (!w.isLoaded(h.x, h.z)) return true;
  const s = w.getBlock(h.x, h.y, h.z);
  if (!isHeart(s) || heartState(ctx, h.x, h.y, h.z, s) !== AWAKE) return false;
  const p = e.body.pos;
  if ((p.x - h.x - 0.5) ** 2 + (p.y - h.y - 0.5) ** 2 + (p.z - h.z - 0.5) ** 2 > HEART_RANGE * HEART_RANGE) return false;
  const be = w.getBlockEntity(h.x, h.y, h.z);
  return !!be && heartCreaking(ctx, be) === e;
}

// Vanilla spreadResin: breadth-first through pale oak logs (depth 2, 64 blocks), one clump on the first free face.
function spreadResin(ctx: GameCtx, hx: number, hy: number, hz: number): boolean {
  const w = ctx.world;
  const rid = resin();
  if (!rid) return false;
  const seen = new Set<string>([`${hx},${hy},${hz}`]);
  let layer: number[][] = [[hx, hy, hz]];
  const shuffled = () => [...DIRS].sort(() => ctx.random() - 0.5);
  for (let depth = 0; depth <= 2 && seen.size <= 64; depth++) {
    const next: number[][] = [];
    for (const [x, y, z] of layer) {
      if (depth > 0) {
        for (const [dx, dy, dz] of shuffled()) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (w.getBlock(nx, ny, nz) !== AIR) continue;
          // Meta is the Face index of the log the clump hangs on; DIRS follows Face order.
          const face = DIRS.findIndex((d) => d[0] === -dx && d[1] === -dy && d[2] === -dz);
          w.setBlock(nx, ny, nz, stateOf(rid, face));
          ctx.emit({ type: "sound", name: "block.resin.place", x: nx + 0.5, y: ny + 0.5, z: nz + 0.5 });
          return true;
        }
      }
      for (const [dx, dy, dz] of shuffled()) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        const k = `${nx},${ny},${nz}`;
        if (seen.has(k) || !isPaleLog(w.getBlock(nx, ny, nz))) continue;
        seen.add(k);
        next.push([nx, ny, nz]);
      }
    }
    layer = next;
  }
  return false;
}

export function heartHurt(ctx: GameCtx, h: HeartPos, from: Entity): void {
  const p = from.body.pos;
  trail(ctx, h.x + 0.5, h.y + 0.5, h.z + 0.5, p.x, p.y + from.body.height * 0.5, p.z);
  ctx.emit({ type: "sound", name: "block.creaking_heart.hurt", x: h.x + 0.5, y: h.y + 0.5, z: h.z + 0.5 });
  const n = 2 + Math.floor(ctx.random() * 2);
  for (let i = 0; i < n; i++) {
    if (!spreadResin(ctx, h.x, h.y, h.z)) ctx.entities.dropItem({ item: "resin_clump", count: 1 }, h.x + 0.5, h.y + 1.1, h.z + 0.5);
  }
}

// Vanilla SpawnUtil ON_TOP_OF_COLLIDER_NO_LEAVES: 16 out, 8 up or down, standing on a non-leaf collider.
function spawnSpot(ctx: GameCtx, hx: number, hy: number, hz: number): [number, number, number] | null {
  const w = ctx.world;
  for (let a = 0; a < 5; a++) {
    const x = hx + Math.floor(ctx.random() * 33) - 16;
    const z = hz + Math.floor(ctx.random() * 33) - 16;
    if (!w.isLoaded(x, z)) continue;
    for (let y = hy + 8; y >= hy - 8; y--) {
      const below = w.getBlock(x, y - 1, z);
      if (!SOLID[idOf(below)] || blockDef(below).tags?.includes("leaves")) continue;
      if (SOLID[idOf(w.getBlock(x, y, z))] || SOLID[idOf(w.getBlock(x, y + 1, z))] || SOLID[idOf(w.getBlock(x, y + 2, z))]) continue;
      return [x, y, z];
    }
  }
  return null;
}

export function trySpawn(ctx: GameCtx, be: BlockEntityData): Entity | null {
  if (ctx.rules.difficulty === "peaceful" || ctx.rules.doMobSpawning === false) return null;
  const near = allPlayers(ctx).some((pl) => {
    if (pl.dead || (pl.gameMode !== "survival" && pl.gameMode !== "adventure")) return false;
    const pp = pl.body.pos;
    return (pp.x - be.x - 0.5) ** 2 + (pp.y - be.y - 0.5) ** 2 + (pp.z - be.z - 0.5) ** 2 <= HEART_RANGE * HEART_RANGE;
  });
  if (!near) return null;
  if (heartCreaking(ctx, be)) return null;
  const spot = spawnSpot(ctx, be.x, be.y, be.z);
  if (!spot) return null;
  const e = ctx.entities.spawn("creaking", spot[0] + 0.5, spot[1], spot[2] + 0.5, { heart: { x: be.x, y: be.y, z: be.z }, noDespawn: true });
  if (!e) return null;
  (be.data ??= {}).creaking = e.id;
  trail(ctx, spot[0] + 0.5, spot[1] + 1.3, spot[2] + 0.5, be.x + 0.5, be.y + 0.5, be.z + 0.5);
  ctx.emit({ type: "sound", name: "entity.creaking.spawn", x: spot[0] + 0.5, y: spot[1] + 1, z: spot[2] + 0.5 });
  ctx.emit({ type: "sound", name: "block.creaking_heart.spawn", x: be.x + 0.5, y: be.y + 0.5, z: be.z + 0.5 });
  return e;
}

export function tickHeart(ctx: GameCtx, be: BlockEntityData): void {
  const w = ctx.world;
  const s = w.getBlock(be.x, be.y, be.z);
  if (!isHeart(s)) return;
  const st = heartState(ctx, be.x, be.y, be.z, s);
  if (st !== heartStateOf(s)) w.setBlock(be.x, be.y, be.z, withHeartState(s, st));
  if (st !== AWAKE) return;
  if (ctx.random() < 1 / 200) ctx.emit({ type: "sound", name: "block.creaking_heart.idle", x: be.x + 0.5, y: be.y + 0.5, z: be.z + 0.5, volume: 0.6 });
  if ((ctx.time.tick + be.x * 7 + be.y * 13 + be.z * 31) % 100 === 0) trySpawn(ctx, be);
}

export function createCreakingHeart(): SystemPart {
  return {
    name: "creaking_heart",
    tick(ctx) {
      const w = ctx.world;
      if (!w.blockEntitiesIn || !heart()) return;
      const chunks = new Set<string>();
      for (const pl of allPlayers(ctx)) {
        const pcx = Math.floor(pl.body.pos.x) >> 4, pcz = Math.floor(pl.body.pos.z) >> 4;
        for (let cx = pcx - 3; cx <= pcx + 3; cx++) {
          for (let cz = pcz - 3; cz <= pcz + 3; cz++) {
            const k = `${cx},${cz}`;
            if (chunks.has(k)) continue;
            chunks.add(k);
            const list = w.blockEntitiesIn(cx, cz);
            if (!list) continue;
            for (const be of list) if (be.type === "creaking_heart") tickHeart(ctx, be);
          }
        }
      }
    },
    onEvent(ctx, ev) {
      if (ev.type !== "block_changed" || !heart()) return;
      const was = isHeart(ev.from), now = isHeart(ev.to);
      if (was && !now) {
        for (const e of ctx.entities.all()) if (claims(e, ev.x, ev.y, ev.z)) crumble(ctx, e);
      } else if (now && !was && !ctx.world.getBlockEntity(ev.x, ev.y, ev.z)) {
        ctx.world.setBlockEntity({ x: ev.x, y: ev.y, z: ev.z, type: "creaking_heart", data: {} }, ev.x, ev.y, ev.z);
      }
    },
  };
}
