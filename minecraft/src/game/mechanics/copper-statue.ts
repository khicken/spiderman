import type { BlockState, Entity, GameCtx, ItemStack } from "../contracts";
import { AIR, SET_NO_DROP, SET_NOTIFY, metaOf } from "../contracts";
import { COPPER_STAGES } from "../blocks/names";
import { damageHeld, isReplaceable, nameOf, sound, st, withMeta } from "./util";

// Meta: bits 0-1 facing (Horizontal), bits 2-3 pose in vanilla cycle order.
export const STATUE_POSES = ["standing", "sitting", "running", "star"] as const;

export const isStatue = (s: BlockState) => nameOf(s).endsWith("copper_golem_statue");
export const statuePose = (s: BlockState) => (metaOf(s) >> 2) & 3;
export const statueFacing = (s: BlockState) => metaOf(s) & 3;
export const statueName = (stage: number, waxed: boolean) => `${waxed ? "waxed_" : ""}${COPPER_STAGES[stage]}copper_golem_statue`;

export function statueStage(s: BlockState): { stage: number; waxed: boolean } {
  const n = nameOf(s);
  const waxed = n.startsWith("waxed_");
  const bare = waxed ? n.slice(6) : n;
  const stage = COPPER_STAGES.findIndex((p) => p !== "" && bare.startsWith(p));
  return { stage: stage < 0 ? 0 : stage, waxed };
}

export const statueComparator = (s: BlockState) => statuePose(s) + 1;

// Entity forward is (-sin yaw, -cos yaw), mapped to Horizontal like util.lookH.
function yawFacing(yaw: number): number {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 3 : 1;
  return fz > 0 ? 0 : 2;
}

export function golemToStatue(ctx: GameCtx, e: Entity): boolean {
  const p = e.body.pos;
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
  if (!isReplaceable(ctx.world.getBlock(x, y, z))) return false;
  const stage = Math.max(0, Math.min(3, Number(e.data.oxidation) || 0));
  const pose = Math.floor(ctx.random() * 4);
  ctx.world.setBlock(x, y, z, st(statueName(stage, !!e.data.waxed), yawFacing(e.yaw) | (pose << 2)), SET_NOTIFY);
  e.data._remove = true;
  return true;
}

// Axe on an unaffected, unwaxed statue revives the golem; other axe and honeycomb uses fall through to copper scraping and waxing.
export function useStatue(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, held: ItemStack | null): boolean {
  const item = held?.item ?? "";
  if (item.endsWith("_axe")) {
    const { stage, waxed } = statueStage(s);
    if (stage !== 0 || waxed) return false;
    ctx.world.setBlock(x, y, z, AIR, SET_NOTIFY | SET_NO_DROP);
    const yaw = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][statueFacing(s)];
    const e = ctx.entities.spawn("copper_golem", x + 0.5, y, z + 0.5, { oxidation: 0, waxed: false, persistent: true });
    if (e) e.yaw = e.headYaw = yaw;
    sound(ctx, "item.axe.scrape", x, y, z);
    damageHeld(ctx);
    return true;
  }
  if (item === "honeycomb") return false;
  ctx.world.setBlock(x, y, z, withMeta(s, (metaOf(s) & 3) | (((statuePose(s) + 1) & 3) << 2)), SET_NOTIFY);
  sound(ctx, "block.copper.place", x, y, z, 0.5, 1.4);
  return true;
}
