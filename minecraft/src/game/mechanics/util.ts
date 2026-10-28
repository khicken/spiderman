import type { BlockDef, BlockState, GameCtx, ItemStack, WorldApi } from "../contracts";
import { AIR, Face, MIN_Y, MAX_Y, SET_NOTIFY, SET_NO_DROP, idOf, metaOf, stateOf } from "../contracts";
import { blockByName, blockDef, IS_FLUID, OPAQUE, SOLID } from "../blocks/registry";
import { computeDrops } from "../items/drops";

export const idn = (name: string): number => blockByName(name)?.id ?? -1;
export const st = (name: string, meta = 0): BlockState => {
  const i = idn(name);
  return i < 0 ? AIR : stateOf(i, meta);
};
export const has = (name: string) => blockByName(name) !== undefined;
export const nameOf = (s: BlockState) => blockDef(s).name;
export const isName = (s: BlockState, name: string) => blockDef(s).name === name;
export const withMeta = (s: BlockState, meta: number) => stateOf(idOf(s), meta & 15);

export const FX = [1, -1, 0, 0, 0, 0];
export const FY = [0, 0, 1, -1, 0, 0];
export const FZ = [0, 0, 0, 0, 1, -1];
export const OPP = [1, 0, 3, 2, 5, 4];
export const HX = [0, -1, 0, 1];
export const HZ = [1, 0, -1, 0];
export const H_FACE = [Face.South, Face.West, Face.North, Face.East];
export const FACE_H = [3, 1, -1, -1, 0, 2];
export const HORIZ_FACES = [Face.East, Face.West, Face.South, Face.North];
export const cw = (h: number) => (h + 1) & 3;
export const ccw = (h: number) => (h + 3) & 3;
export const oppH = (h: number) => (h + 2) & 3;

export function lookH(ctx: GameCtx): number {
  const d = ctx.player.lookDir();
  if (Math.abs(d.x) > Math.abs(d.z)) return d.x > 0 ? 3 : 1;
  return d.z > 0 ? 0 : 2;
}

export function lookFace(ctx: GameCtx): Face {
  const d = ctx.player.lookDir();
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  if (ay > ax && ay > az) return d.y > 0 ? Face.Up : Face.Down;
  return H_FACE[lookH(ctx)];
}

// Faces ordered by how close they are to the look direction, the same as vanilla getNearestLookingDirections.
const lookOrder: Face[] = [0, 0, 0, 0, 0, 0];
export function lookFaces(ctx: GameCtx): Face[] {
  const d = ctx.player.lookDir();
  const score = [d.x, -d.x, d.y, -d.y, d.z, -d.z];
  for (let i = 0; i < 6; i++) lookOrder[i] = i;
  lookOrder.sort((a, b) => score[b] - score[a]);
  return lookOrder;
}

export function mcYaw(ctx: GameCtx): number {
  const d = ctx.player.lookDir();
  return (Math.atan2(-d.x, d.z) * 180) / Math.PI;
}
export const rotation16 = (ctx: GameCtx) => Math.floor(((mcYaw(ctx) + 180) * 16) / 360 + 0.5) & 15;

export const def = (s: BlockState): BlockDef => blockDef(s);
export const isAir = (s: BlockState) => idOf(s) === 0 || blockDef(s).shape === "air";
export const isSolid = (s: BlockState) => SOLID[idOf(s)] === 1;
export const isOpaque = (s: BlockState) => OPAQUE[idOf(s)] === 1;
export const isFluid = (s: BlockState) => IS_FLUID[idOf(s)] === 1;
export const isReplaceable = (s: BlockState) => isAir(s) || blockDef(s).replaceable === true;
export const tag = (s: BlockState, t: string) => blockDef(s).tags?.includes(t) ?? false;
export const inRange = (y: number) => y >= MIN_Y && y <= MAX_Y;
export const randInt = (ctx: GameCtx, n: number) => Math.floor(ctx.random() * n);
export const creative = (ctx: GameCtx) => ctx.player.gameMode === "creative";

// Sturdy face check used for supports. face is the face of the supporting block that touches the attached block.
export function sturdy(world: WorldApi, x: number, y: number, z: number, face: Face): boolean {
  const s = world.getBlock(x, y, z);
  if (!isSolid(s)) return false;
  const d = blockDef(s);
  const m = metaOf(s);
  switch (d.shape) {
    case "cube":
    case "custom":
      return !d.name.endsWith("leaves") || face === Face.Up;
    case "slab":
      return m === 2 || (m === 1 && face === Face.Up) || (m === 0 && face === Face.Down);
    case "stairs": {
      const top = (m & 4) !== 0;
      if (face === Face.Up) return top;
      if (face === Face.Down) return !top;
      return H_FACE[m & 3] === face;
    }
    case "farmland":
    case "path":
      return face !== Face.Up;
    default:
      return false;
  }
}

export function supportsCenter(world: WorldApi, x: number, y: number, z: number): boolean {
  const s = world.getBlock(x, y, z);
  const sh = blockDef(s).shape;
  if (sh === "fence" || sh === "wall" || sh === "pane" || sh === "anvil" || sh === "hopper" || sh === "chain") return true;
  return sturdy(world, x, y, z, Face.Up);
}

export function sound(ctx: GameCtx, name: string, x: number, y: number, z: number, volume = 1, pitch = 1) {
  ctx.emit({ type: "sound", name, x: x + 0.5, y: y + 0.5, z: z + 0.5, volume, pitch });
}
export const blockSound = (ctx: GameCtx, s: BlockState, kind: string, x: number, y: number, z: number) =>
  sound(ctx, `block.${blockDef(s).sound}.${kind}`, x, y, z);

export function dropStack(ctx: GameCtx, stack: ItemStack, x: number, y: number, z: number) {
  ctx.entities.dropItem(stack, x + 0.5, y + 0.5, z + 0.5);
}

export function dropBlock(ctx: GameCtx, s: BlockState, x: number, y: number, z: number) {
  if (ctx.rules.doTileDrops === false) return;
  const drops = computeDrops(s, null, ctx.random);
  for (let i = 0; i < drops.length; i++) dropStack(ctx, drops[i], x, y, z);
}

// Vanilla globalLevelEvent: with globalSoundEvents the player hears it 2 blocks away toward the source, else it plays at the source.
export function globalSound(ctx: GameCtx, name: string, x: number, y: number, z: number, volume = 1) {
  if (ctx.rules.globalSoundEvents === false) return ctx.emit({ type: "sound", name, x, y, z, volume });
  const p = ctx.player.body.pos, ey = p.y + 1.62;
  const dx = x - p.x, dy = y - ey, dz = z - p.z, d = Math.hypot(dx, dy, dz);
  const k = d > 2 ? 2 / d : 1;
  ctx.emit({ type: "sound", name, x: p.x + dx * k, y: ey + dy * k, z: p.z + dz * k, volume });
}

export function breakBlock(ctx: GameCtx, x: number, y: number, z: number, drop: boolean) {
  const s = ctx.world.getBlock(x, y, z);
  if (isAir(s)) return;
  if (drop) dropBlock(ctx, s, x, y, z);
  if (!isFluid(s)) {
    ctx.emit({ type: "particles", kind: "block", x: x + 0.5, y: y + 0.5, z: z + 0.5, count: 12, state: s });
    blockSound(ctx, s, "break", x, y, z);
  }
  ctx.world.setBlock(x, y, z, AIR, SET_NOTIFY | SET_NO_DROP);
}

export function useHeld(ctx: GameCtx) {
  if (!creative(ctx)) ctx.inventory.removeHeld(1);
}
export function damageHeld(ctx: GameCtx) {
  if (!creative(ctx)) ctx.inventory.damageHeld(1);
}

export function giveOrDrop(ctx: GameCtx, stack: ItemStack, x: number, y: number, z: number) {
  const rest = ctx.inventory.add(stack);
  if (rest) dropStack(ctx, rest, x, y, z);
}

// Vanilla getRawBrightness: sky light darkened by time of day and weather.
export function skyDarken(ctx: GameCtx): number {
  const t = ctx.time.dayTime / 24000 - 0.25;
  const f = t - Math.floor(t);
  const tod = (f * 2 + (0.5 - Math.cos(f * Math.PI) / 2)) / 3;
  let d = 1 - (Math.cos(tod * Math.PI * 2) * 2 + 0.2);
  d = Math.min(1, Math.max(0, d));
  d = 1 - d;
  d *= 1 - (ctx.time.rain * 5) / 16;
  d *= 1 - (ctx.time.thunder * 5) / 16;
  return Math.floor((1 - d) * 11);
}
export function rawBrightness(ctx: GameCtx, x: number, y: number, z: number): number {
  const w = ctx.world;
  const sky = w.dim === "overworld" ? Math.max(0, w.getSkyLight(x, y, z) - skyDarken(ctx)) : 0;
  return Math.max(sky, w.getBlockLight(x, y, z));
}
export function rainingAt(ctx: GameCtx, x: number, y: number, z: number): boolean {
  if (ctx.time.rain < 0.2 || ctx.world.dim !== "overworld") return false;
  if (ctx.world.getSkyLight(x, y, z) < 15) return false;
  if (ctx.world.topY(x, z) > y) return false;
  return ctx.world.getBiome(x, z).precipitation === "rain";
}

export const isPlayerBody = (ctx: GameCtx, body: unknown) => body === ctx.player.body;

// PlayerApi has no fire field; the player module reads fireTicks when it exists.
export function setOnFire(ctx: GameCtx, body: unknown, entity: { data: Record<string, unknown> } | null, ticks: number) {
  if (entity) {
    const cur = typeof entity.data._fire === "number" ? entity.data._fire : 0;
    entity.data._fire = Math.max(cur, ticks);
  } else if (isPlayerBody(ctx, body)) {
    const p = ctx.player as unknown as { fireTicks?: number };
    p.fireTicks = Math.max(p.fireTicks ?? 0, ticks);
  }
}
