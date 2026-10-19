import type { BlockBehavior, GameCtx, ItemStack } from "../../contracts";
import { BEHAVIORS } from "../../mechanics";
import { rollLoot as rollTable } from "../../loot";
import { advTrigger } from "./bus";

const VAULT_LOOT: [string, number, number][] = [
  ["emerald", 2, 4], ["arrow", 2, 8], ["iron_ingot", 1, 2], ["wind_charge", 1, 3], ["honey_bottle", 1, 2], ["ominous_bottle", 1, 1],
  ["shield", 1, 1], ["golden_apple", 1, 1], ["diamond", 1, 2], ["crossbow", 1, 1], ["iron_axe", 1, 1], ["bolt_armor_trim_smithing_template", 1, 1],
];

const queue: { x: number; y: number; z: number; items: ItemStack[]; next: number }[] = [];

function rollLoot(ctx: GameCtx): ItemStack[] {
  const out: ItemStack[] = [];
  const n = 2 + Math.floor(ctx.random() * 3);
  for (let i = 0; i < n; i++) {
    const [item, a, b] = VAULT_LOOT[Math.floor(ctx.random() * VAULT_LOOT.length)];
    out.push({ item, count: a + Math.floor(ctx.random() * (b - a + 1)) });
  }
  return out;
}

// One reward per vault for the single player; the vault keeps the key and ejects its loot one stack at a time.
const useVault: NonNullable<BlockBehavior["use"]> = (ctx, x, y, z, _s, held) => {
  const w = ctx.world;
  const be = w.getBlockEntity(x, y, z) ?? { x, y, z, type: "vault", data: { key: "trial_key", ominous: false } };
  const data = (be.data ??= {});
  const key = (data.key as string) ?? (data.ominous ? "ominous_trial_key" : "trial_key");
  if (held?.item !== key) return false;
  if (data.rewarded || queue.some((q) => q.x === x && q.y === y && q.z === z)) {
    ctx.emit({ type: "sound", name: "block.vault.insert_item_fail", x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    return true;
  }
  if (ctx.player.gameMode !== "creative") ctx.inventory.removeHeld(1);
  const stored = ((data.loot as (ItemStack | null)[] | undefined) ?? []).filter((s): s is ItemStack => !!s && s.count > 0);
  data.rewarded = true;
  w.setBlockEntity(be, x, y, z);
  const table = typeof data.lootTable === "string" ? data.lootTable : null;
  const items = stored.length ? stored : table ? rollTable(table, Math.floor(ctx.random() * 0x7fffffff)) : rollLoot(ctx);
  queue.push({ x, y, z, items, next: ctx.time.tick + 20 });
  ctx.emit({ type: "sound", name: "block.vault.insert_item", x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  advTrigger({ t: "vault", ominous: key === "ominous_trial_key" });
  return true;
};

export function installVault() {
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
