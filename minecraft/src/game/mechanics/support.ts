import type { BlockState, GameCtx, WorldApi } from "../contracts";
import { AIR, Face, idOf, metaOf } from "../contracts";
import { BLOCKS, blockDef } from "../blocks/registry";
import {
  FX, FZ, H_FACE, HX, HZ, OPP, breakBlock, creative, def, isName, isSolid, nameOf, rawBrightness, sturdy, supportsCenter, tag,
} from "./util";

export const enum Sup {
  None, Bush, DeadBush, Mushroom, Fungus, Crop, Wart, Upper, Cane, Cactus, Bamboo, LilyPad, Carpet, Snow, StandingTorch,
  WallTorch, FloorSign, WallSign, Ladder, Attach, Rail, Plate, Diode, DoorLower, Bed, Cocoa, HangDown, GrowUp,
  Lantern, Fire, SoulFire, WallFan, Floor, Petals, WaterPlant, Azalea, AttachedStem, WitherRose, Frogspawn, HangingSign, Dripleaf,
}

const FAMILY = new Uint8Array(4096);

function familyOf(name: string, shape: string, tags: string[]): Sup {
  const t = (x: string) => tags.includes(x);
  if (name.endsWith("_upper")) return Sup.Upper;
  if (shape === "door") return Sup.DoorLower;
  if (shape === "bed") return Sup.Bed;
  if (name === "wither_rose") return Sup.WitherRose;
  if (t("flowers") && shape === "carpet") return Sup.Petals;
  if (t("small_flowers") || t("tall_flowers") || t("saplings") || name === "short_grass" || name === "fern" || name === "tall_grass" ||
    name === "large_fern" || name === "sweet_berry_bush" || name === "torchflower") return Sup.Bush;
  if (name === "mangrove_propagule") return Sup.Bush;
  if (name === "azalea" || name === "flowering_azalea") return Sup.Azalea;
  if (name === "dead_bush") return Sup.DeadBush;
  if (t("mushrooms")) return Sup.Mushroom;
  if (t("fungi") || name === "crimson_roots" || name === "warped_roots" || name === "nether_sprouts") return Sup.Fungus;
  if (name === "attached_melon_stem" || name === "attached_pumpkin_stem") return Sup.AttachedStem;
  if (name === "nether_wart") return Sup.Wart;
  if (name === "cocoa") return Sup.Cocoa;
  if (t("crops")) return Sup.Crop;
  if (name === "sugar_cane") return Sup.Cane;
  if (name === "cactus") return Sup.Cactus;
  if (name === "bamboo" || name === "bamboo_sapling") return Sup.Bamboo;
  if (name === "lily_pad") return Sup.LilyPad;
  if (name === "frogspawn") return Sup.Frogspawn;
  if (shape === "carpet") return Sup.Carpet;
  if (shape === "snow_layer") return Sup.Snow;
  if (shape === "torch") return name.includes("wall") ? Sup.WallTorch : Sup.StandingTorch;
  if (shape === "sign") return name.includes("wall") ? Sup.WallSign : Sup.FloorSign;
  if (name.endsWith("_banner")) return name.includes("wall") ? Sup.WallSign : Sup.FloorSign;
  if (name.endsWith("_coral_wall_fan")) return Sup.WallFan;
  if (t("corals") || name.startsWith("dead_") && (name.endsWith("_coral") || name.endsWith("_coral_fan"))) return Sup.Floor;
  if (t("hanging_signs")) return name.includes("wall") ? Sup.None : Sup.HangingSign;
  if (shape === "ladder" || name === "tripwire_hook") return Sup.Ladder;
  if (shape === "button" || shape === "lever") return Sup.Attach;
  if (shape === "rail") return Sup.Rail;
  if (shape === "pressure_plate") return Sup.Plate;
  if (shape === "repeater" || shape === "comparator" || shape === "redstone_wire") return Sup.Diode;
  if (name === "cave_vines" || name === "cave_vines_plant" || name === "weeping_vines" || name === "weeping_vines_plant" ||
    name === "hanging_roots" || name === "spore_blossom") return Sup.HangDown;
  if (name === "twisting_vines" || name === "twisting_vines_plant") return Sup.GrowUp;
  if (shape === "lantern") return Sup.Lantern;
  if (name === "fire") return Sup.Fire;
  if (name === "soul_fire") return Sup.SoulFire;
  if (name === "kelp" || name === "kelp_plant" || name === "seagrass" || name === "tall_seagrass") return Sup.WaterPlant;
  if (t("candles") || name === "sea_pickle" || name === "small_dripleaf") return Sup.Floor;
  if (name === "big_dripleaf" || name === "big_dripleaf_stem") return Sup.Dripleaf;
  return Sup.None;
}

for (const b of BLOCKS) FAMILY[b.id] = familyOf(b.name, b.shape, b.tags ?? []);

export const supportFamily = (s: BlockState): Sup => FAMILY[idOf(s)];
export const needsSupport = (s: BlockState) => FAMILY[idOf(s)] !== Sup.None;

const DIRT_EXTRA = new Set(["farmland", "muddy_mangrove_roots"]);
export const isDirtLike = (s: BlockState) => tag(s, "dirt") || DIRT_EXTRA.has(nameOf(s));
const isSandLike = (s: BlockState) => tag(s, "sand") || nameOf(s) === "suspicious_sand";
const isNylium = (s: BlockState) => nameOf(s).endsWith("_nylium");
const isTerracotta = (s: BlockState) => nameOf(s).endsWith("terracotta") && !nameOf(s).endsWith("glazed_terracotta");
const isWater = (s: BlockState) => isName(s, "water");
const isJungleLog = (s: BlockState) => {
  const n = nameOf(s);
  return n === "jungle_log" || n === "jungle_wood" || n === "stripped_jungle_log" || n === "stripped_jungle_wood";
};

export const upperBaseName = (n: string) => n.slice(0, -"_upper".length);
const fireBurns = (s: BlockState) => def(s).flammable === true;

function hasFlammableNeighbor(w: WorldApi, x: number, y: number, z: number): boolean {
  for (let f = 0; f < 6; f++) {
    const s = w.getBlock(x + FX[f], y + (f === Face.Up ? 1 : f === Face.Down ? -1 : 0), z + FZ[f]);
    if (fireBurns(s)) return true;
  }
  return false;
}

function waterBeside(w: WorldApi, x: number, y: number, z: number): boolean {
  for (let h = 0; h < 4; h++) {
    const n = w.getBlock(x + HX[h], y, z + HZ[h]);
    if (isWater(n) || isName(n, "frosted_ice")) return true;
  }
  return false;
}

export function canSurviveAt(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): boolean {
  const w = ctx.world;
  const m = metaOf(s);
  const below = () => w.getBlock(x, y - 1, z);
  const above = () => w.getBlock(x, y + 1, z);
  switch (FAMILY[idOf(s)] as Sup) {
    case Sup.None:
      return true;
    case Sup.Bush:
      return isDirtLike(below());
    case Sup.WitherRose: {
      const b = below();
      const n = nameOf(b);
      return isDirtLike(b) || n === "netherrack" || n === "soul_sand" || n === "soul_soil";
    }
    case Sup.Azalea: {
      const b = below();
      return isDirtLike(b) || nameOf(b) === "clay";
    }
    case Sup.Petals:
      return isDirtLike(below());
    case Sup.DeadBush: {
      const b = below();
      return isDirtLike(b) || isSandLike(b) || isTerracotta(b);
    }
    case Sup.Mushroom: {
      const b = below();
      const n = nameOf(b);
      if (n === "mycelium" || n === "podzol" || isNylium(b)) return true;
      return rawBrightness(ctx, x, y, z) < 13 && sturdy(w, x, y - 1, z, Face.Up) && def(b).opaque;
    }
    case Sup.Fungus: {
      const b = below();
      return isNylium(b) || isDirtLike(b) || nameOf(b) === "soul_soil";
    }
    case Sup.Crop: {
      if (!isName(below(), "farmland")) return false;
      return rawBrightness(ctx, x, y, z) >= 8 || w.getSkyLight(x, y, z) >= 15;
    }
    case Sup.AttachedStem:
      return isName(below(), "farmland");
    case Sup.Wart:
      return isName(below(), "soul_sand");
    case Sup.Upper: {
      const b = below();
      return nameOf(b) === upperBaseName(def(s).name);
    }
    case Sup.Cane: {
      const b = below();
      if (idOf(b) === idOf(s)) return true;
      if (!isDirtLike(b) && !isSandLike(b) || isName(b, "farmland")) return false;
      return waterBeside(w, x, y - 1, z);
    }
    case Sup.Cactus: {
      for (let h = 0; h < 4; h++) {
        const n = w.getBlock(x + HX[h], y, z + HZ[h]);
        if (isSolid(n) || isName(n, "lava")) return false;
      }
      const b = below();
      return (idOf(b) === idOf(s) || isSandLike(b)) && !isName(above(), "lava");
    }
    case Sup.Bamboo: {
      const b = below();
      const n = nameOf(b);
      return n === "bamboo" || n === "bamboo_sapling" || isDirtLike(b) || isSandLike(b) || n === "gravel" || n === "suspicious_gravel";
    }
    case Sup.LilyPad: {
      const b = below();
      return (isWater(b) && metaOf(b) === 0) || isName(b, "ice");
    }
    case Sup.Frogspawn:
      return isWater(below()) && metaOf(below()) === 0;
    case Sup.Carpet:
      return below() !== AIR;
    case Sup.Snow: {
      const b = below();
      const n = nameOf(b);
      if (n === "ice" || n === "packed_ice" || n === "barrier") return false;
      if (n === "honey_block" || n === "soul_sand" || n.endsWith("leaves")) return true;
      if (idOf(b) === idOf(s)) return metaOf(b) === 7;
      return sturdy(w, x, y - 1, z, Face.Up);
    }
    case Sup.StandingTorch:
      return supportsCenter(w, x, y - 1, z);
    case Sup.WallTorch: {
      if (m === 0) return supportsCenter(w, x, y - 1, z);
      const h = (m - 1) & 3;
      return sturdy(w, x - HX[h], y, z - HZ[h], H_FACE[h]);
    }
    case Sup.FloorSign:
      return isSolid(below());
    case Sup.HangingSign:
      return supportsCenter(w, x, y + 1, z) || sturdy(w, x, y + 1, z, Face.Down) || def(above()).tags?.includes("hanging_signs") === true;
    case Sup.WallSign: {
      const h = m & 3;
      return isSolid(w.getBlock(x - HX[h], y, z - HZ[h]));
    }
    case Sup.WallFan: {
      const h = m & 3;
      return sturdy(w, x - HX[h], y, z - HZ[h], H_FACE[h]);
    }
    case Sup.Floor:
      return sturdy(w, x, y - 1, z, Face.Up) || supportsCenter(w, x, y - 1, z);
    case Sup.Ladder: {
      const h = m & 3;
      return sturdy(w, x - HX[h], y, z - HZ[h], H_FACE[h]);
    }
    case Sup.Attach: {
      const f = (m & 7) as Face;
      if (f > 5) return false;
      const o = OPP[f];
      return sturdy(w, x + FX[o], y + (o === Face.Up ? 1 : o === Face.Down ? -1 : 0), z + FZ[o], f);
    }
    case Sup.Rail:
      return sturdy(w, x, y - 1, z, Face.Up);
    case Sup.Plate:
      return supportsCenter(w, x, y - 1, z);
    case Sup.Diode:
      return sturdy(w, x, y - 1, z, Face.Up);
    case Sup.DoorLower: {
      if (m & 8) {
        const b = below();
        return idOf(b) === idOf(s) && (metaOf(b) & 8) === 0;
      }
      return sturdy(w, x, y - 1, z, Face.Up);
    }
    case Sup.Bed: {
      const h = m & 3;
      const dir = m & 4 ? -1 : 1;
      const o = w.getBlock(x + HX[h] * dir, y, z + HZ[h] * dir);
      return idOf(o) === idOf(s) && (metaOf(o) & 4) !== (m & 4);
    }
    case Sup.Cocoa: {
      const h = m & 3;
      return isJungleLog(w.getBlock(x + HX[h], y, z + HZ[h]));
    }
    case Sup.HangDown: {
      const a = above();
      const n = def(s).name;
      const base = n.replace("_plant", "");
      if (nameOf(a) === base || nameOf(a) === `${base}_plant`) return true;
      return sturdy(w, x, y + 1, z, Face.Down);
    }
    case Sup.GrowUp: {
      const b = below();
      if (nameOf(b) === "twisting_vines" || nameOf(b) === "twisting_vines_plant") return true;
      return sturdy(w, x, y - 1, z, Face.Up);
    }
    case Sup.Lantern: {
      if (m & 1) return supportsCenter(w, x, y + 1, z) || sturdy(w, x, y + 1, z, Face.Down);
      return supportsCenter(w, x, y - 1, z);
    }
    case Sup.Fire:
      return sturdy(w, x, y - 1, z, Face.Up) || hasFlammableNeighbor(w, x, y, z);
    case Sup.SoulFire: {
      const n = nameOf(below());
      return n === "soul_sand" || n === "soul_soil";
    }
    case Sup.Dripleaf: {
      const b = below();
      const bn = nameOf(b);
      const onBase = bn === "big_dripleaf_stem" || bn === "clay" || bn === "moss_block" || isDirtLike(b) || (bn === "big_dripleaf" && def(s).name === "big_dripleaf");
      if (!onBase) return false;
      if (def(s).name === "big_dripleaf") return true;
      const an = nameOf(above());
      return an === "big_dripleaf_stem" || an === "big_dripleaf";
    }
    case Sup.WaterPlant: {
      const b = below();
      return isSolid(b) || nameOf(b) === "kelp_plant" || nameOf(b) === "kelp";
    }
  }
  return true;
}

// Vanilla stops the second half of a door or bed from dropping in creative.
const NO_DROP_ON_UPDATE = new Set<Sup>([Sup.DoorLower, Sup.Bed]);
const DELAYED = new Set<Sup>([Sup.Cane, Sup.Cactus, Sup.Bamboo]);

export function supportNeighborChanged(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const fam = FAMILY[idOf(s)] as Sup;
  if (DELAYED.has(fam)) {
    ctx.world.scheduleTick(x, y, z, 1);
    return;
  }
  if (fam === Sup.AttachedStem) {
    revertAttachedStem(ctx, x, y, z, s);
    if (!canSurviveAt(ctx, x, y, z, ctx.world.getBlock(x, y, z))) breakBlock(ctx, x, y, z, true);
    return;
  }
  if (fam === Sup.DoorLower && !(metaOf(s) & 8)) {
    const up = ctx.world.getBlock(x, y + 1, z);
    if (idOf(up) !== idOf(s) || !(metaOf(up) & 8)) {
      breakBlock(ctx, x, y, z, !creative(ctx));
      return;
    }
  }
  if (fam === Sup.Bush && hasTall(s)) {
    const up = ctx.world.getBlock(x, y + 1, z);
    if (nameOf(up) !== `${def(s).name}_upper`) {
      breakBlock(ctx, x, y, z, !creative(ctx));
      return;
    }
  }
  if (!canSurviveAt(ctx, x, y, z, s)) breakBlock(ctx, x, y, z, !(NO_DROP_ON_UPDATE.has(fam) && creative(ctx)));
}

const hasTall = (s: BlockState) => blockDef(s).tags?.includes("tall_flowers") === true || isTallGrass(s);
const isTallGrass = (s: BlockState) => {
  const n = nameOf(s);
  return n === "tall_grass" || n === "large_fern" || n === "pitcher_plant";
};

export function supportScheduledTick(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  if (!canSurviveAt(ctx, x, y, z, s)) breakBlock(ctx, x, y, z, true);
}

function revertAttachedStem(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const h = metaOf(s) & 3;
  const fruit = nameOf(ctx.world.getBlock(x + HX[h], y, z + HZ[h]));
  const want = def(s).name === "attached_melon_stem" ? "melon" : "pumpkin";
  if (fruit === want) return;
  const stem = blockDef(s).name.replace("attached_", "");
  const id = BLOCKS.find((b) => b.name === stem)?.id;
  if (id !== undefined) ctx.world.setBlock(x, y, z, id | (7 << 12));
}
