import type { BlockBehavior, GameCtx, ItemStack } from "../../contracts";
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
}

export function resetVaults() {
  queue.length = 0;
}
