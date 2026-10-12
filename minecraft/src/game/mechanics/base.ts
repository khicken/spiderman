import type { BlockBehavior, BlockDef, BlockState, Body, Entity, GameCtx } from "../contracts";
import { idOf, metaOf } from "../contracts";
import { BLOCKS } from "../blocks/registry";
import { creative, has, isPlayerBody, isSolid, st, withMeta } from "./util";
import { HAS_CUSTOM_BOXES, shapeBoxes } from "./shapes";
import { canSurviveAt, needsSupport, supportNeighborChanged, supportScheduledTick, supportFamily, Sup } from "./support";
import {
  placeAnvil, placeAttachFace, placeAxis, placeBed, placeClickedFace, placeCocoa, placeDoor, placeFloorOrWall, placeFront6,
  placeFrontToPlayer, placeHangingSign, placeHopper, placeLadder, placeLantern, placeLookH, placeObserver, placeRail, placeSlab, placeSnow,
  placeStairs, placeSupported, placeTallPlant, placeTowardH, placeTrapdoor, type PlaceFn,
} from "./placement";
import { LAVA_BEHAVIOR, WATER_BEHAVIOR } from "./fluids";
import { CONCRETE_POWDER_BEHAVIOR, DRAGON_EGG_BEHAVIOR, GRAVITY_BEHAVIOR } from "./gravity";
import { FIRE_BEHAVIOR, SOUL_FIRE_BEHAVIOR } from "./fire";
import { END_PORTAL_BEHAVIOR, NETHER_PORTAL_BEHAVIOR } from "./portal";
import { RANDOM_TICKS, farmlandToDirt, leavesRandomTick, saplingRandomTick } from "./growth";
import { copperRandomTick, oxidizes } from "./copper";
import { bedScheduledTick, blockUseFor, composterScheduledTick } from "./interact";
import { CHEST_BEHAVIOR, placeChest } from "./chest";

const AXIS = new Set([
  "basalt", "polished_basalt", "quartz_pillar", "purpur_pillar", "hay_block", "bone_block", "deepslate", "infested_deepslate",
  "ochre_froglight", "verdant_froglight", "pearlescent_froglight", "muddy_mangrove_roots", "chain", "end_rod", "lightning_rod",
]);
const FRONT6 = new Set(["dispenser", "dropper", "piston", "sticky_piston", "barrel", "crafter"]);
const TOWARD_H = new Set(["end_portal_frame", "campfire", "soul_campfire", "lectern", "stonecutter", "grindstone", "bell", "decorated_pot", "vault", "calibrated_sculk_sensor"]);
const FRONT_CUBES = new Set(["carved_pumpkin", "jack_o_lantern", "loom", "beehive", "bee_nest", "chiseled_bookshelf", "furnace", "blast_furnace", "smoker"]);
const CLICKED_FACE = new Set(["small_amethyst_bud", "medium_amethyst_bud", "large_amethyst_bud", "amethyst_cluster"]);
const NON_LIVING = new Set(["item", "xp_orb", "arrow", "spectral_arrow", "trident", "falling_block", "tnt", "snowball", "egg", "ender_pearl", "fireball", "small_fireball", "wind_charge", "breeze_wind_charge", "experience_bottle", "potion", "firework_rocket", "boat", "minecart", "item_frame", "painting", "armor_stand", "end_crystal"]);

const isLiving = (e: Entity | null) => !e || !NON_LIVING.has(e.type);

function hurt(ctx: GameCtx, body: Body, entity: Entity | null, amount: number, source: "cactus" | "fire" | "generic") {
  if (entity) {
    if (isLiving(entity)) ctx.entities.damage(entity.id, amount, source);
  } else if (isPlayerBody(ctx, body)) {
    const m = ctx.player.gameMode;
    if (m !== "creative" && m !== "spectator") ctx.player.damage(amount, source);
  }
}

function placeFor(b: BlockDef): PlaceFn | undefined {
  const n = b.name;
  const t = b.tags ?? [];
  switch (b.shape) {
    case "stairs": return placeStairs;
    case "slab": return placeSlab;
    case "door": return placeDoor;
    case "trapdoor": return placeTrapdoor;
    case "bed": return placeBed;
    case "fence_gate": return placeLookH;
    case "ladder": return placeLadder;
    case "torch": return n.includes("wall") ? undefined : placeFloorOrWall;
    case "sign": return n.includes("wall") ? undefined : placeFloorOrWall;
    case "button":
    case "lever": return placeAttachFace;
    case "rail": return placeRail;
    case "lantern": return placeLantern;
    case "snow_layer": return placeSnow;
    case "anvil": return placeAnvil;
    case "chest": return placeChest;
    case "hopper": return placeHopper;
  }
  if (AXIS.has(n) || t.includes("logs")) return placeAxis;
  if (n === "observer") return placeObserver;
  if (FRONT6.has(n)) return placeFront6;
  if (TOWARD_H.has(n)) return placeTowardH;
  if (n.endsWith("shulker_box") || CLICKED_FACE.has(n)) return placeClickedFace;
  if (FRONT_CUBES.has(n) || n.endsWith("glazed_terracotta")) return placeFrontToPlayer;
  if (n === "cocoa") return placeCocoa;
  if (n === "tripwire_hook") return placeLadder;
  if (t.includes("hanging_signs") && !n.includes("wall")) return placeHangingSign;
  if ((n.endsWith("_banner") || t.includes("skulls")) && !n.includes("wall")) return placeFloorOrWall;
  if (n.endsWith("_coral_fan")) return placeFloorOrWall;
  if (has(`${n}_upper`) && n !== "pitcher_crop") return placeTallPlant;
  if (t.includes("leaves")) return (_c, _x, _y, _z, _i, s) => withMeta(s, metaOf(s) | 1);
  if (n === "farmland") return (ctx, x, y, z, _i, s) => (isSolid(ctx.world.getBlock(x, y + 1, z)) ? st("dirt") : s);
  if (needsSupport(b.id)) return placeSupported;
  return undefined;
}

type Hook = "neighborChanged" | "scheduledTick" | "randomTick" | "onPlaced" | "onRemoved" | "entityInside";
const HOOKS: Hook[] = ["neighborChanged", "scheduledTick", "randomTick", "onPlaced", "onRemoved", "entityInside"];

// Later parts run only while the block is unchanged, so one hook cannot act on a block another hook removed.
function compose(parts: BlockBehavior[]): BlockBehavior {
  const out: BlockBehavior = {};
  for (const p of parts) {
    for (const k of Object.keys(p) as (keyof BlockBehavior)[]) {
      if (!(HOOKS as string[]).includes(k) && out[k] === undefined) (out as Record<string, unknown>)[k] = p[k];
    }
  }
  for (const k of HOOKS) {
    const fns = parts.map((p) => p[k]).filter((f): f is NonNullable<typeof f> => !!f) as ((...a: unknown[]) => void)[];
    if (fns.length === 1) (out as Record<string, unknown>)[k] = fns[0];
    else if (fns.length > 1) {
      (out as Record<string, unknown>)[k] = (...a: unknown[]) => {
        const ctx = a[0] as GameCtx;
        const [x, y, z, s] = a.slice(1, 5) as [number, number, number, BlockState];
        for (const f of fns) {
          if (k !== "onRemoved" && ctx.world.getBlock(x, y, z) !== s) return;
          f(...a);
        }
      };
    }
  }
  return out;
}

const cactusInside: BlockBehavior = { entityInside: (ctx, _x, _y, _z, _s, body, e) => hurt(ctx, body, e, 1, "cactus") };
const berryInside: BlockBehavior = {
  entityInside(ctx, _x, _y, _z, s, body, e) {
    if (metaOf(s) === 0 || (e && (e.type === "fox" || e.type === "bee"))) return;
    if (Math.abs(body.vel.x) >= 0.003 || Math.abs(body.vel.z) >= 0.003) hurt(ctx, body, e, 1, "generic");
  },
};
const campfireInside: BlockBehavior = {
  entityInside(ctx, _x, _y, _z, s, body, e) {
    if (metaOf(s) & 4) return;
    hurt(ctx, body, e, BLOCKS[idOf(s)].name === "soul_campfire" ? 2 : 1, "fire");
  },
};
const witherRoseInside: BlockBehavior = {
  entityInside(ctx, _x, _y, _z, _s, body, e) {
    if (ctx.rules.difficulty === "peaceful") return;
    const list = e ? (isLiving(e) && e.type !== "wither" ? e.effects : null) : isPlayerBody(ctx, body) && !creative(ctx) ? ctx.player.effects : null;
    if (list && !list.some((f) => f.id === "wither")) list.push({ id: "wither", amplifier: 0, ticks: 40 });
  },
};
const farmlandBehavior: BlockBehavior = {
  neighborChanged(ctx, x, y, z) {
    const above = ctx.world.getBlock(x, y + 1, z);
    if (isSolid(above) && BLOCKS[idOf(above)].shape !== "fence_gate" && supportFamily(above) === Sup.None) farmlandToDirt(ctx, x, y, z);
  },
  entityInside(ctx, x, y, z, _s, body, e) {
    if (!isLiving(e) || (e && !ctx.rules.mobGriefing)) return;
    if (body.fallDistance > 0.5 && ctx.random() < body.fallDistance - 0.5) farmlandToDirt(ctx, x, y, z);
  },
};
const supportBehavior = (b: BlockDef): BlockBehavior => {
  const fam = supportFamily(b.id);
  const delayed = fam === Sup.Cane || fam === Sup.Cactus || fam === Sup.Bamboo;
  return {
    canSurvive: canSurviveAt,
    neighborChanged: supportNeighborChanged,
    ...(delayed ? { scheduledTick: supportScheduledTick } : {}),
  };
};

function behaviorFor(b: BlockDef): BlockBehavior | null {
  const n = b.name;
  const t = b.tags ?? [];
  const parts: BlockBehavior[] = [];
  const place = placeFor(b);
  if (place) parts.push({ place });
  if (n === "water") parts.push(WATER_BEHAVIOR);
  else if (n === "lava") parts.push(LAVA_BEHAVIOR);
  else if (n === "fire") parts.push(FIRE_BEHAVIOR);
  else if (n === "soul_fire") parts.push(SOUL_FIRE_BEHAVIOR);
  else if (n === "nether_portal") parts.push(NETHER_PORTAL_BEHAVIOR);
  else if (n === "end_portal") parts.push(END_PORTAL_BEHAVIOR);
  else if (n === "dragon_egg") parts.push(DRAGON_EGG_BEHAVIOR);
  else if (n.endsWith("_concrete_powder")) parts.push(CONCRETE_POWDER_BEHAVIOR);
  else if (b.gravity || b.shape === "anvil") parts.push(GRAVITY_BEHAVIOR);
  if (needsSupport(b.id) && n !== "fire" && n !== "soul_fire") parts.push(supportBehavior(b));
  const rt = RANDOM_TICKS[n] ?? (t.includes("saplings") ? saplingRandomTick : t.includes("leaves") ? leavesRandomTick : oxidizes(b.id) ? copperRandomTick : undefined);
  if (rt) parts.push({ randomTick: rt });
  if (n === "cactus") parts.push(cactusInside);
  if (n === "sweet_berry_bush") parts.push(berryInside);
  if (n === "wither_rose") parts.push(witherRoseInside);
  if (b.shape === "campfire") parts.push(campfireInside);
  if (n === "farmland") parts.push(farmlandBehavior);
  if (b.shape === "bed") parts.push({ scheduledTick: bedScheduledTick });
  if (b.shape === "chest") parts.push(CHEST_BEHAVIOR);
  if (n === "composter") parts.push({ scheduledTick: composterScheduledTick });
  const use = blockUseFor(n, b.shape, t);
  if (use) parts.push({ use });
  if (HAS_CUSTOM_BOXES_SET.has(n)) parts.push({ boxes: shapeBoxes });
  return parts.length ? compose(parts) : null;
}

const HAS_CUSTOM_BOXES_SET = new Set(HAS_CUSTOM_BOXES);

export const BASE_BEHAVIORS: Record<string, BlockBehavior> = {};
for (const b of BLOCKS) {
  if (b.shape === "air") continue;
  const beh = behaviorFor(b);
  if (beh) BASE_BEHAVIORS[b.name] = beh;
}
