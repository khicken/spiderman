"use client";

import type { ItemDef, ItemStack } from "../contracts";
import { itemDef } from "../items/registry";
import { itemIconUrl, itemSpritePixels, potIconUrl, tintedIconUrl } from "../textures/icons";
import { SHIELD } from "../textures/items-gear";
import { dialFrame, dialIconUrl } from "../textures/dials";
import { isPotionItem, potionItemName, potionOf, potionTooltip, stackPotionColor } from "../items/potions";
import { textWidth } from "./font";
import { Text } from "./gui";
import { packUrl, pixelUrl } from "./sprites";
import { activeSettings } from "./settings";
import { BH, BW, bannerPixels, type Layer } from "../systems/features/banner-art";
import { ENCHANTS, enchantName, titleCase } from "./data";
import { DISCS, discLabel } from "../systems/blocks-a/discs";
import { PATTERN_NAMES } from "../items/data-misc";
import { WEAPON_STATS } from "../items/data-gear";

export const maxDurability = (d: ItemDef | undefined) => d?.tool?.durability ?? d?.armor?.durability ?? d?.durability ?? 0;

const GLINT_CSS = `@keyframes mc-glint{0%{background-position:0 0}100%{background-position:64px 64px}}`;

// Banner item sprite with its pattern layers painted over the cloth (x 3..12, y 3..11).
function bannerIconUrl(stack: ItemStack): string | null {
  const layers = Array.isArray(stack.data?.patterns) ? (stack.data!.patterns as Layer[]) : [];
  if (!layers.length || !stack.item.endsWith("_banner")) return null;
  const base = itemSpritePixels(stack.item);
  const face = bannerPixels(stack.item.slice(0, -7), layers);
  return pixelUrl(`banner_icon:${stack.item}:${JSON.stringify(layers)}`, 16, 16, (x, y) => {
    let o = (y * 16 + x) * 4;
    let src = base;
    if (x >= 3 && x <= 12 && y >= 3 && y <= 11) {
      o = (Math.floor(((y - 3 + 0.5) * BH) / 9) * BW + Math.floor(((x - 3 + 0.5) * BW) / 10)) * 4;
      src = face;
    }
    const a = src === face ? 255 : base[o + 3];
    return ((a << 24) | (src[o] << 16) | (src[o + 1] << 8) | src[o + 2]) >>> 0;
  });
}

// Shield sprite with the banner face painted over its plate (rim and face cells x 4..11, y 2..14).
function shieldIconUrl(stack: ItemStack): string | null {
  if (stack.item !== "shield" || typeof stack.data?.banner !== "string") return null;
  const layers = Array.isArray(stack.data.patterns) ? (stack.data.patterns as Layer[]) : [];
  const base = itemSpritePixels("shield");
  const face = bannerPixels(stack.data.banner, layers);
  return pixelUrl(`shield_icon:${stack.data.banner}:${JSON.stringify(layers)}`, 16, 16, (x, y) => {
    let o = (y * 16 + x) * 4;
    let src = base;
    if ("3%".includes(SHIELD[y][x])) {
      o = (Math.floor(((y - 2 + 0.5) * BH) / 13) * BW + Math.floor(((x - 4 + 0.5) * BW) / 8)) * 4;
      src = face;
    }
    return ((src[o + 3] << 24) | (src[o] << 16) | (src[o + 1] << 8) | src[o + 2]) >>> 0;
  });
}

const potSherds = (stack: ItemStack) =>
  stack.item === "decorated_pot" && Array.isArray(stack.data?.sherds) && stack.data.sherds.length === 4 ? (stack.data.sherds as string[]) : null;

export function ItemIcon({ stack, x, y, count = true }: { stack: ItemStack; x: number; y: number; count?: boolean }) {
  const def = itemDef(stack.item);
  const frame = dialFrame(stack);
  const sherds = potSherds(stack);
  const url = bannerIconUrl(stack) ?? shieldIconUrl(stack) ?? (sherds ? potIconUrl(sherds) : null) ?? (isPotionItem(stack.item) ? tintedIconUrl(stack.item, stackPotionColor(stack)) : frame !== null ? dialIconUrl(stack.item, frame) : itemIconUrl(stack.item));
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
              backgroundImage: packUrl("misc/enchanted_glint_item")
                ? `url(${packUrl("misc/enchanted_glint_item")})`
                : "repeating-linear-gradient(135deg, rgba(160,80,255,0) 0px, rgba(160,80,255,0.55) 8px, rgba(160,80,255,0) 16px)",
              backgroundSize: packUrl("misc/enchanted_glint_item") ? "64px 64px" : undefined,
              animation: activeSettings().glintSpeed > 0 ? `mc-glint ${1.5 / activeSettings().glintSpeed}s linear infinite` : "none",
              opacity: Math.min(1, activeSettings().glintStrength / 0.75),
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
  if (stack.name) return stack.name;
  if (isPotionItem(stack.item)) return potionItemName(stack.item, potionOf(stack));
  if (stack.item === "compass" && stack.data?.lodestone) return "Lodestone Compass";
  if (stack.item === "shield" && typeof stack.data?.banner === "string") return `${titleCase(stack.data.banner)} Shield`;
  if (stack.item === "filled_map" && typeof stack.data?.map === "number") return `Map #${stack.data.map}`;
  return itemDef(stack.item)?.displayName ?? titleCase(stack.item);
}

export function tooltipLines(stack: ItemStack, advanced = false): string[] {
  const def = itemDef(stack.item);
  const ench = stack.ench ?? {};
  const enchanted = Object.keys(ench).length > 0;
  const base = def?.rarity ?? "common";
  const rarity = enchanted ? BUMP[base] : base;
  const lines = [`${RARITY_COLOR[rarity]}${stack.name ? "§o" : ""}${itemName(stack)}`];
  for (const [id, lvl] of Object.entries(ench)) lines.push(`${ENCHANTS[id]?.curse ? "§c" : "§7"}${enchantName(id, lvl)}`);
  if (isPotionItem(stack.item)) lines.push(...potionTooltip(stack.item, potionOf(stack)));
  const stored = stack.data?.stored as Record<string, number> | undefined;
  if (stored) for (const [id, lvl] of Object.entries(stored)) lines.push(`${ENCHANTS[id]?.curse ? "§c" : "§7"}${enchantName(id, lvl)}`);
  const melee = def?.tool && def.tool.kind !== "shears" ? def.tool : WEAPON_STATS[stack.item];
  if (melee) {
    const sharp = ench.sharpness ? 0.5 * ench.sharpness + 0.5 : 0;
    const fmt = (v: number) => String(Math.round(v * 100) / 100);
    lines.push("", "§7When in Main Hand:", `§2 ${fmt(melee.attackDamage + sharp)} Attack Damage`, `§2 ${fmt(melee.attackSpeed)} Attack Speed`);
  }
  const layers = Array.isArray(stack.data?.patterns) ? (stack.data!.patterns as { pattern: string; color: string }[]) : [];
  for (const l of layers) lines.push(`§7${titleCase(l.color)} ${PATTERN_NAMES[l.pattern] ?? l.pattern}`);
  const pat = stack.item.match(/^(.+)_banner_pattern$/);
  if (pat) lines.push(`§7${PATTERN_NAMES[pat[1]] ?? pat[1]}`);
  const sherds = stack.item === "decorated_pot" && Array.isArray(stack.data?.sherds) ? (stack.data!.sherds as string[]) : [];
  if (sherds.length) lines.push("", ...sherds.map((n) => `§7${itemDef(n)?.displayName ?? titleCase(n)}`));
  if (stack.item === "filled_map") {
    if (stack.data?.locked) lines.push("§7Locked");
    if (advanced && typeof stack.data?.map === "number") {
      const sc = Number(stack.data.scale ?? 0);
      lines.push(`§7Id #${stack.data.map}`, `§7Scaling at 1:${1 << sc}`, `§7(Level ${sc}/4)`);
    }
  }
  if (def?.armor) {
    const where = { head: "Head", chest: "Body", legs: "Legs", feet: "Feet" }[def.armor.slot];
    lines.push("", `§7When on ${where}:`, `§9+${def.armor.points} Armor`);
    if (def.armor.toughness) lines.push(`§9+${def.armor.toughness} Armor Toughness`);
    if (def.armor.knockbackResistance) lines.push(`§9+${def.armor.knockbackResistance * 10} Knockback Resistance`);
  }
  if (DISCS[stack.item]) lines.push(`§7${discLabel(stack.item)}`);
  const lode = stack.data?.lodestone as { x: number; y: number; z: number; dim?: string } | undefined;
  if (lode && stack.item === "compass") lines.push(`§7Lodestone: ${lode.x}, ${lode.y}, ${lode.z}${lode.dim ? ` (${lode.dim})` : ""}`);
  const max = maxDurability(def);
  if (advanced) {
    if (max > 0) lines.push(`§fDurability: ${max - (stack.damage ?? 0)} / ${max}`);
    lines.push(`§8minecraft:${stack.item}`);
  }
  return lines;
}
