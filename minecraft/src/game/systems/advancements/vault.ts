import type { BlockBehavior, BlockEntityData, GameCtx, ItemStack } from "../../contracts";
import { idOf, metaOf, stateOf } from "../../contracts";
import { BEHAVIORS } from "../../mechanics";
import { rollLoot as rollTable } from "../../loot";
import { advTrigger } from "./bus";

const queue: { x: number; y: number; z: number; items: ItemStack[]; next: number }[] = [];
let who = () => "Player";

// Vanilla vault: each player can unlock it once (rewarded_players); it keeps the key and ejects its loot one stack at a time.
const useVault: NonNullable<BlockBehavior["use"]> = (ctx, x, y, z, _s, held) => {
  const w = ctx.world;
  const be = w.getBlockEntity(x, y, z) ?? { x, y, z, type: "vault", data: { key: "trial_key", ominous: false } };
  const data = (be.data ??= {});
  const key = (data.key as string) ?? (data.ominous ? "ominous_trial_key" : "trial_key");
  if (held?.item !== key) return false;
  const rewarded = Array.isArray(data.rewardedPlayers) ? (data.rewardedPlayers as string[]) : data.rewarded === true ? ["Player"] : [];
  if (rewarded.includes(who()) || queue.some((q) => q.x === x && q.y === y && q.z === z)) {
    ctx.emit({ type: "sound", name: "block.vault.insert_item_fail", x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    return true;
  }
  if (ctx.player.gameMode !== "creative") ctx.inventory.removeHeld(1);
  const stored = ((data.loot as (ItemStack | null)[] | undefined) ?? []).filter((s): s is ItemStack => !!s && s.count > 0);
  data.rewardedPlayers = [...rewarded, who()];
  w.setBlockEntity(be, x, y, z);
  const table = typeof data.lootTable === "string" ? data.lootTable : null;
  const items = stored.length ? stored : rollTable(table ?? (key === "ominous_trial_key" ? "trial_chambers_reward_ominous" : "trial_chambers_reward"), Math.floor(ctx.random() * 0x7fffffff));
  if (stored.length) data.loot = [];
  queue.push({ x, y, z, items, next: ctx.time.tick + 20 });
  ctx.emit({ type: "sound", name: "block.vault.insert_item", x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  advTrigger({ t: "vault", ominous: key === "ominous_trial_key" });
  return true;
};

export function installVault(player: () => string) {
  who = player;
  const prev = BEHAVIORS.vault;
  const prevUse = prev?.use;
  BEHAVIORS.vault = {
    ...prev,
    use: (ctx, x, y, z, s, held) => useVault(ctx, x, y, z, s, held) || (prevUse ? prevUse(ctx, x, y, z, s, held) : false),
  };
}

export function tickVaults(ctx: GameCtx) {
  for (let i = queue.length - 1; i >= 0; i--) {
    const q = queue[i];
    if (ctx.time.tick < q.next) continue;
    const s = q.items.shift();
    if (s) {
      ctx.entities.dropItem(s, q.x + 0.5, q.y + 1.1, q.z + 0.5);
      ctx.emit({ type: "sound", name: "block.vault.eject_item", x: q.x + 0.5, y: q.y + 0.5, z: q.z + 0.5 });
    }
    q.next = ctx.time.tick + 10;
    if (!q.items.length) queue.splice(i, 1);
  }
  if (ctx.time.tick % 20 === 0 && ctx.world.blockEntitiesIn) {
    const p = ctx.player.body.pos;
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
    for (let cx = pcx - 1; cx <= pcx + 1; cx++)
      for (let cz = pcz - 1; cz <= pcz + 1; cz++) for (const be of ctx.world.blockEntitiesIn(cx, cz) ?? []) if (be.type === "vault") vaultLook(ctx, be);
  }
}

// Vanilla vault: active while an unrewarded player is within 4 blocks (4.5 to stay on). Meta bits are in contracts.ts.
function vaultLook(ctx: GameCtx, be: BlockEntityData) {
  const s = ctx.world.getBlock(be.x, be.y, be.z);
  if (!idOf(s)) return;
  const data = be.data ?? {};
  const p = ctx.player.body.pos;
  const d2 = (p.x - be.x - 0.5) ** 2 + (p.y - be.y - 0.5) ** 2 + (p.z - be.z - 0.5) ** 2;
  const rewarded = Array.isArray(data.rewardedPlayers) && (data.rewardedPlayers as string[]).includes(who());
  const on = metaOf(s) & 4 ? d2 <= 4.5 * 4.5 : d2 <= 16;
  const busy = queue.some((q) => q.x === be.x && q.y === be.y && q.z === be.z);
  const ominous = data.ominous === true || data.key === "ominous_trial_key";
  const meta = (metaOf(s) & 3) | ((busy || (on && !rewarded && ctx.player.gameMode !== "spectator")) ? 4 : 0) | (ominous ? 8 : 0);
  if (meta !== metaOf(s)) ctx.world.setBlock(be.x, be.y, be.z, stateOf(idOf(s), meta), 0);
}

export function resetVaults() {
  queue.length = 0;
}
