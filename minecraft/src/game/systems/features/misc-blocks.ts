import type { BlockBehavior, Entity, GameCtx } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { mobDef } from "../../entities/registry";

const SPAWNER_BEHAVIOR: BlockBehavior = {
  use(ctx, x, y, z, _s, held) {
    if (!held?.item.endsWith("_spawn_egg")) return false;
    const mob = held.item.slice(0, -"_spawn_egg".length);
    if (!mobDef(mob)) return false;
    let be = ctx.world.getBlockEntity(x, y, z);
    if (!be || be.type !== "spawner") {
      be = { x, y, z, type: "spawner", data: { delay: 20 } };
      ctx.world.setBlockEntity(be, x, y, z);
    }
    be.data = { ...be.data, mob, entity: mob };
    if (ctx.player.gameMode !== "creative") ctx.inventory.removeHeld(1);
    ctx.emit({ type: "sound", name: "block.stone.place", x: x + 0.5, y: y + 0.5, z: z + 0.5, volume: 0.5 });
    return true;
  },
};

export const MISC_BEHAVIORS: Record<string, BlockBehavior> = { spawner: SPAWNER_BEHAVIOR };

const FRAME = new Set(["prismarine", "prismarine_bricks", "dark_prismarine", "sea_lantern"]);
const conduits = new Set<string>();
const near: Entity[] = [];

export function trackConduit(x: number, y: number, z: number, on: boolean) {
  const k = `${x},${y},${z}`;
  if (on) conduits.add(k);
  else conduits.delete(k);
}

const isWater = (ctx: GameCtx, x: number, y: number, z: number) => blockDef(ctx.world.getBlock(x, y, z)).name === "water" || !!ctx.world.isWaterlogged?.(x, y, z);

// Vanilla ConduitBlockEntity.updateShape: 3x3x3 of water and prismarine frame blocks on three 5x5 rings.
export function conduitFrames(ctx: GameCtx, x: number, y: number, z: number): number {
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) if ((i || j || k) && !isWater(ctx, x + i, y + j, z + k)) return 0;
  if (!isWater(ctx, x, y, z)) return 0;
  let n = 0;
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++)
      for (let k = -2; k <= 2; k++) {
        const a = Math.abs(i), b = Math.abs(j), c = Math.abs(k);
        if (!(a > 1 || b > 1 || c > 1)) continue;
        if (!((i === 0 && (b === 2 || c === 2)) || (j === 0 && (a === 2 || c === 2)) || (k === 0 && (a === 2 || b === 2)))) continue;
        if (FRAME.has(blockDef(ctx.world.getBlock(x + i, y + j, z + k)).name)) n++;
      }
  return n;
}

// Every 2 seconds: Conduit Power for 13 s to players in water within 16 blocks per 7 frames; a full frame hurts hostile mobs within 8.
export function tickConduits(ctx: GameCtx) {
  if (ctx.time.tick % 40 !== 0 || !conduits.size) return;
  const p = ctx.player;
  for (const key of conduits) {
    const [x, y, z] = key.split(",").map(Number);
    if (!ctx.world.isLoaded(x, z)) continue;
    if (blockDef(ctx.world.getBlock(x, y, z)).name !== "conduit") {
      conduits.delete(key);
      continue;
    }
    const n = conduitFrames(ctx, x, y, z);
    if (n < 16) continue;
    ctx.emit({ type: "sound", name: "block.conduit.ambient", x: x + 0.5, y: y + 0.5, z: z + 0.5, volume: 0.6 });
    const range = Math.floor(n / 7) * 16;
    const pp = p.body.pos;
    if ((pp.x - x - 0.5) ** 2 + (pp.y - y - 0.5) ** 2 + (pp.z - z - 0.5) ** 2 <= range * range && (p.body.inWater || ctx.time.rain > 0.2)) {
      (p as unknown as { addEffect(id: string, amp: number, ticks: number): void }).addEffect("conduit_power", 0, 260);
    }
    if (n < 42) continue;
    ctx.entities.near(x + 0.5, y + 0.5, z + 0.5, 8, near);
    const target = near.find((e) => !e.dead && mobDef(e.type)?.category === "hostile" && e.body.inWater);
    near.length = 0;
    if (target) {
      ctx.entities.damage(target.id, 4, "magic");
      ctx.emit({ type: "sound", name: "block.conduit.attack.target", x: target.body.pos.x, y: target.body.pos.y, z: target.body.pos.z });
    }
  }
}

export function conduitList(): string[] {
  return [...conduits];
}

export function loadConduits(list: unknown) {
  conduits.clear();
  if (Array.isArray(list)) for (const k of list) if (typeof k === "string") conduits.add(k);
}
