"use client";

import type { ItemDef, ItemStack } from "../contracts";
import { itemDef } from "../items/registry";
import { itemIconUrl } from "../textures/icons";
import { textWidth } from "./font";
import { Text } from "./gui";
import { ENCHANTS, enchantName, titleCase } from "./data";

export const maxDurability = (d: ItemDef | undefined) => d?.tool?.durability ?? d?.armor?.durability ?? d?.durability ?? 0;

const GLINT_CSS = `@keyframes mc-glint{0%{background-position:0 0}100%{background-position:64px 64px}}`;

export function ItemIcon({ stack, x, y, count = true }: { stack: ItemStack; x: number; y: number; count?: boolean }) {
  const def = itemDef(stack.item);
  const url = itemIconUrl(stack.item);
  const max = maxDurability(def);
  const dmg = stack.damage ?? 0;
  const glint = !!stack.ench && Object.keys(stack.ench).length > 0;
  const frac = max > 0 ? Math.max(0, (max - dmg) / max) : 1;
  const barW = Math.round(13 - (dmg * 13) / Math.max(1, max));
  const n = stack.count;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 16, height: 16, pointerEvents: "none" }}>
      <img alt="" src={url} width={16} height={16} draggable={false} style={{ position: "absolute", left: 0, top: 0, imageRendering: "pixelated" }} />
      {glint && (
        <>
          <style>{GLINT_CSS}</style>
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: "repeating-linear-gradient(135deg, rgba(160,80,255,0) 0px, rgba(160,80,255,0.55) 8px, rgba(160,80,255,0) 16px)",
              animation: "mc-glint 3s linear infinite",
              maskImage: `url(${url})`,
              WebkitMaskImage: `url(${url})`,
              maskSize: "16px 16px",
              WebkitMaskSize: "16px 16px",
              mixBlendMode: "screen",
            }}
          />
        </>
      )}
      {max > 0 && dmg > 0 && (
        <>
          <div style={{ position: "absolute", left: 2, top: 13, width: 13, height: 2, background: "#000" }} />
          <div style={{ position: "absolute", left: 2, top: 13, width: barW, height: 1, background: `hsl(${frac * 120}, 100%, 50%)` }} />
        </>
      )}
      {count && n !== 1 && <Text text={String(n)} color={n <= 0 ? 0xff5555 : 0xffffff} x={17 - textWidth(String(n))} y={9} />}
    </div>
  );
}

const RARITY_COLOR = { common: "§f", uncommon: "§e", rare: "§b", epic: "§d" } as const;
const BUMP = { common: "rare", uncommon: "rare", rare: "epic", epic: "epic" } as const;

export function itemName(stack: ItemStack): string {
  return stack.name ?? itemDef(stack.item)?.displayName ?? titleCase(stack.item);
}

export function tooltipLines(stack: ItemStack, advanced = false): string[] {
  const def = itemDef(stack.item);
  const ench = stack.ench ?? {};
  const enchanted = Object.keys(ench).length > 0;
  const base = def?.rarity ?? "common";
  const rarity = enchanted ? BUMP[base] : base;
  const lines = [`${RARITY_COLOR[rarity]}${stack.name ? "§o" : ""}${itemName(stack)}`];
  for (const [id, lvl] of Object.entries(ench)) lines.push(`${ENCHANTS[id]?.curse ? "§c" : "§7"}${enchantName(id, lvl)}`);
  if (def?.tool) {
    const sharp = ench.sharpness ? 0.5 * ench.sharpness + 0.5 : 0;
    const fmt = (v: number) => String(Math.round(v * 100) / 100);
    lines.push("", "§7When in Main Hand:", `§2 ${fmt(def.tool.attackDamage + sharp)} Attack Damage`, `§2 ${fmt(def.tool.attackSpeed)} Attack Speed`);
  }
  if (def?.armor) {
    const where = { head: "Head", chest: "Body", legs: "Legs", feet: "Feet" }[def.armor.slot];
    lines.push("", `§7When on ${where}:`, `§9+${def.armor.points} Armor`);
    if (def.armor.toughness) lines.push(`§9+${def.armor.toughness} Armor Toughness`);
    if (def.armor.knockbackResistance) lines.push(`§9+${def.armor.knockbackResistance * 10} Knockback Resistance`);
  }
  const max = maxDurability(def);
  if (advanced) {
    if (max > 0) lines.push(`§fDurability: ${max - (stack.damage ?? 0)} / ${max}`);
    lines.push(`§8minecraft:${stack.item}`);
  }
  return lines;
}
