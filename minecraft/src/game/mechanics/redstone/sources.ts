import { DAY_TICKS, Face, idOf, metaOf, stateOf, type Aabb, type BlockBehavior, type BlockState, type Entity, type GameCtx } from "../../contracts";
import { hasTag } from "../../blocks/registry";
import {
  breakBlock, DX, DY, DZ, hasTick, id, lookHorizontal, nameOf, notifyDeep, notifyNeighbors, OPP, schedule, setState, sound,
  sturdyFace, supportsCenter, ticked,
} from "./util";

// Meta bits 0-2: the Face from the support block to the lever (6 floor and 7 ceiling turned along x). Bit 3: powered.
export const attachFace = (s: BlockState): Face => {
  const f = metaOf(s) & 7;
  return f === 6 ? Face.Up : f === 7 ? Face.Down : (f as Face);
};
const supportDir = (s: BlockState) => OPP[attachFace(s)] as Face;
const isOn = (s: BlockState) => (metaOf(s) & 8) !== 0;
const withOn = (s: BlockState, on: boolean) => stateOf(idOf(s), (metaOf(s) & 7) | (on ? 8 : 0));

function attachedOk(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): boolean {
  const d = supportDir(s);
  return sturdyFace(ctx.world.getBlock(x + DX[d], y + DY[d], z + DZ[d]), attachFace(s));
}

function placeAttached(ctx: GameCtx, x: number, y: number, z: number, info: Parameters<NonNullable<BlockBehavior["place"]>>[4], def: BlockState) {
  let f: number = info.face;
  if (f === Face.Up || f === Face.Down) {
    const look = lookHorizontal(ctx, info);
    if (look === Face.East || look === Face.West) f = f === Face.Up ? 6 : 7;
  }
  const s = stateOf(idOf(def), f);
  return attachedOk(ctx, x, y, z, s) ? s : null;
}

function updateAttached(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  notifyNeighbors(ctx, x, y, z);
  const d = supportDir(s);
  notifyNeighbors(ctx, x + DX[d], y + DY[d], z + DZ[d]);
}

const attachedPower = (_c: GameCtx, _x: number, _y: number, _z: number, s: BlockState) => (isOn(s) ? 15 : 0);
const attachedStrong = (_c: GameCtx, _x: number, _y: number, _z: number, s: BlockState, toward: Face) =>
  isOn(s) && toward === supportDir(s) ? 15 : 0;

const attachedBase: BlockBehavior = {
  place: placeAttached,
  canSurvive: attachedOk,
  neighborChanged(ctx, x, y, z, s) {
    if (!attachedOk(ctx, x, y, z, s)) breakBlock(ctx, x, y, z);
  },
  onRemoved(ctx, x, y, z, s) {
    if (isOn(s)) updateAttached(ctx, x, y, z, s);
  },
  power: attachedPower,
  strongPower: attachedStrong,
};

export const LEVER_BEHAVIOR: BlockBehavior = {
  ...attachedBase,
  use(ctx, x, y, z, s) {
    const next = withOn(s, !isOn(s));
    setState(ctx, x, y, z, next);
    sound(ctx, "block.lever.click", x, y, z, 0.3, isOn(next) ? 0.6 : 0.5);
    if (isOn(next)) ctx.emit({ type: "particles", kind: "dust", x: x + 0.5, y: y + 0.5, z: z + 0.5, count: 1, color: 0xff0000 });
    updateAttached(ctx, x, y, z, next);
    return true;
  },
};

function woodSound(name: string): string {
  if (name.startsWith("cherry")) return "cherry_wood";
  if (name.startsWith("bamboo")) return "bamboo_wood";
  if (name.startsWith("crimson") || name.startsWith("warped")) return "nether_wood";
  return "wooden";
}

function buttonSound(name: string, on: boolean) {
  const kind = hasTag(stateOf(id(name)), "wooden_buttons") ? `${woodSound(name)}_button` : "stone_button";
  return `block.${kind}.click_${on ? "on" : "off"}`;
}

const ARROWS = new Set(["arrow", "spectral_arrow"]);
const entityScratch: Entity[] = [];

function arrowsIn(ctx: GameCtx, box: Aabb): boolean {
  for (const e of ctx.entities.near((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2, 1.5, entityScratch)) {
    if (ARROWS.has(e.type) && overlaps(e, box)) return true;
  }
  return false;
}

function buttonBox(x: number, y: number, z: number, s: BlockState, out: Aabb): Aabb {
  const f = attachFace(s);
  out.minX = x; out.minY = y; out.minZ = z; out.maxX = x + 1; out.maxY = y + 1; out.maxZ = z + 1;
  if (f === Face.Up) out.maxY = y + 0.125;
  else if (f === Face.Down) out.minY = y + 0.875;
  else if (f === Face.East) out.maxX = x + 0.125;
  else if (f === Face.West) out.minX = x + 0.875;
  else if (f === Face.South) out.maxZ = z + 0.125;
  else out.minZ = z + 0.875;
  return out;
}

const box: Aabb = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

function pressButton(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, ticks: number) {
  setState(ctx, x, y, z, withOn(s, true));
  updateAttached(ctx, x, y, z, s);
  sound(ctx, buttonSound(nameOf(s), true), x, y, z, 0.3, 0.6);
  schedule(ctx, x, y, z, ticks);
}

export function buttonBehavior(name: string): BlockBehavior {
  const wooden = hasTag(stateOf(id(name)), "wooden_buttons");
  const ticks = wooden ? 30 : 20;
  return {
    ...attachedBase,
    use(ctx, x, y, z, s) {
      if (isOn(s)) return true;
      pressButton(ctx, x, y, z, s, ticks);
      return true;
    },
    entityInside(ctx, x, y, z, s, _b, e) {
      if (wooden && !isOn(s) && e && ARROWS.has(e.type)) pressButton(ctx, x, y, z, s, ticks);
    },
    scheduledTick(ctx, x, y, z, s) {
      ticked(ctx, x, y, z);
      if (!isOn(s)) return;
      if (wooden && arrowsIn(ctx, buttonBox(x, y, z, s, box))) return schedule(ctx, x, y, z, ticks);
      const next = withOn(s, false);
      setState(ctx, x, y, z, next);
      updateAttached(ctx, x, y, z, next);
      sound(ctx, buttonSound(nameOf(s), false), x, y, z, 0.3, 0.5);
    },
  };
}

const NOT_LIVING = new Set([
  "item", "xp_orb", "arrow", "spectral_arrow", "trident", "snowball", "egg", "ender_pearl", "fireball", "small_fireball", "wind_charge",
  "breeze_wind_charge", "tnt", "falling_block", "boat", "chest_boat", "minecart", "chest_minecart", "hopper_minecart", "tnt_minecart",
  "furnace_minecart", "eye_of_ender", "potion", "experience_bottle", "firework_rocket", "fishing_bobber", "lightning_bolt", "item_frame",
  "glow_item_frame", "painting", "leash_knot", "area_effect_cloud", "llama_spit", "shulker_bullet", "wither_skull", "dragon_fireball",
  "evoker_fangs", "end_crystal", "ominous_item_spawner",
]);

function overlaps(e: Entity, b: Aabb): boolean {
  const p = e.body.pos;
  const hw = e.body.width / 2;
  return p.x + hw > b.minX && p.x - hw < b.maxX && p.z + hw > b.minZ && p.z - hw < b.maxZ && p.y + e.body.height > b.minY && p.y < b.maxY;
}

type PlateKind = "mobs" | "all" | "light" | "heavy";

function countOnPlate(ctx: GameCtx, x: number, y: number, z: number, kind: PlateKind): number {
  box.minX = x + 0.0625; box.maxX = x + 0.9375; box.minY = y; box.maxY = y + 0.25; box.minZ = z + 0.0625; box.maxZ = z + 0.9375;
  let n = 0;
  const pl = ctx.player;
  if (pl && !pl.dead && pl.gameMode !== "spectator") {
    const p = pl.body.pos;
    const hw = pl.body.width / 2;
    if (p.x + hw > box.minX && p.x - hw < box.maxX && p.z + hw > box.minZ && p.z - hw < box.maxZ && p.y + pl.body.height > box.minY && p.y < box.maxY) n++;
  }
  if (kind === "mobs" && n) return n;
  for (const e of ctx.entities.near(x + 0.5, y + 0.5, z + 0.5, 2, entityScratch)) {
    if (e.dead || !overlaps(e, box)) continue;
    if (kind === "mobs" && NOT_LIVING.has(e.type)) continue;
    n++;
    if (kind !== "heavy" && n >= 15) break;
  }
  return n;
}

function plateKind(name: string): PlateKind {
  if (name === "light_weighted_pressure_plate") return "light";
  if (name === "heavy_weighted_pressure_plate") return "heavy";
  if (name === "stone_pressure_plate" || name === "polished_blackstone_pressure_plate") return "mobs";
  return "all";
}

function plateSound(name: string, kind: PlateKind, on: boolean) {
  const base = kind === "light" || kind === "heavy" ? "metal" : kind === "mobs" ? "stone" : woodSound(name);
  return `block.${base}_pressure_plate.click_${on ? "on" : "off"}`;
}

export function plateBehavior(name: string): BlockBehavior {
  const kind = plateKind(name);
  const weighted = kind === "light" || kind === "heavy";
  const signalOf = (s: BlockState) => (weighted ? metaOf(s) : metaOf(s) & 1 ? 15 : 0);
  const withSignal = (s: BlockState, p: number) => stateOf(idOf(s), weighted ? p : p > 0 ? 1 : 0);
  const compute = (ctx: GameCtx, x: number, y: number, z: number) => {
    const n = countOnPlate(ctx, x, y, z, kind);
    if (kind === "light") return Math.min(n, 15);
    if (kind === "heavy") return Math.min(Math.ceil(n / 10), 15);
    return n > 0 ? 15 : 0;
  };
  const check = (ctx: GameCtx, x: number, y: number, z: number, s: BlockState) => {
    const old = signalOf(s);
    const now = compute(ctx, x, y, z);
    if (now !== old) {
      setState(ctx, x, y, z, withSignal(s, now));
      notifyNeighbors(ctx, x, y, z);
      notifyNeighbors(ctx, x, y - 1, z);
      if (old === 0 || now === 0) sound(ctx, plateSound(name, kind, now > 0), x, y, z, 0.3, now > 0 ? (weighted ? 0.9 : 0.6) : weighted ? 0.75 : 0.5);
    }
    if (now > 0) schedule(ctx, x, y, z, weighted ? 10 : 20);
  };
  const canSurvive = (ctx: GameCtx, x: number, y: number, z: number) => supportsCenter(ctx.world.getBlock(x, y - 1, z));
  const power = (_c: GameCtx, _x: number, _y: number, _z: number, s: BlockState) => signalOf(s);
  return {
    place: (ctx, x, y, z, _i, def) => (canSurvive(ctx, x, y, z) ? stateOf(idOf(def), 0) : null),
    canSurvive,
    neighborChanged(ctx, x, y, z) {
      if (!canSurvive(ctx, x, y, z)) breakBlock(ctx, x, y, z);
    },
    entityInside(ctx, x, y, z, s) {
      if (signalOf(s) === 0) check(ctx, x, y, z, s);
    },
    scheduledTick(ctx, x, y, z, s) {
      ticked(ctx, x, y, z);
      if (signalOf(s) > 0) check(ctx, x, y, z, s);
    },
    onRemoved(ctx, x, y, z, s) {
      if (signalOf(s) > 0) {
        notifyNeighbors(ctx, x, y, z);
        notifyNeighbors(ctx, x, y - 1, z);
      }
    },
    power,
    strongPower: (c, x, y, z, s, toward) => (toward === Face.Down ? power(c, x, y, z, s) : 0),
  };
}

export function hitTarget(ctx: GameCtx, x: number, y: number, z: number, hx: number, hy: number, hz: number, face: Face, arrow: boolean) {
  const s = ctx.world.getBlock(x, y, z);
  if (nameOf(s) !== "target") return;
  const fx = hx - x - 0.5, fy = hy - y - 0.5, fz = hz - z - 0.5;
  const ax = face === Face.East || face === Face.West ? 0 : Math.abs(fx);
  const ay = face === Face.Up || face === Face.Down ? 0 : Math.abs(fy);
  const az = face === Face.South || face === Face.North ? 0 : Math.abs(fz);
  const d = Math.max(ax, ay, az);
  const power = Math.max(1, Math.ceil(15 * Math.min(1, Math.max(0, (0.5 - d) / 0.5))));
  setState(ctx, x, y, z, stateOf(idOf(s), power));
  schedule(ctx, x, y, z, arrow ? 20 : 8);
}

export const TARGET_BEHAVIOR: BlockBehavior = {
  scheduledTick(ctx, x, y, z, s) {
    ticked(ctx, x, y, z);
    if (metaOf(s) > 0) setState(ctx, x, y, z, stateOf(idOf(s), 0));
  },
  power: (_c, _x, _y, _z, s) => metaOf(s),
};

const DETECTOR = id("daylight_detector");
const INVERTED = id("inverted_daylight_detector");

function skyDarken(ctx: GameCtx): number {
  const angle = celestialAngle(ctx.time.dayTime);
  const d2 = Math.min(1, Math.max(0, 0.5 + 2 * Math.cos(angle * Math.PI * 2)));
  const rain = 1 - (ctx.time.rain * 5) / 16;
  const thunder = 1 - (ctx.time.thunder * 5) / 16;
  return Math.floor((1 - d2 * rain * thunder) * 11);
}

function celestialAngle(dayTime: number): number {
  const d0 = (((dayTime / DAY_TICKS - 0.25) % 1) + 1) % 1;
  const d1 = 0.5 - Math.cos(d0 * Math.PI) / 2;
  return (d0 * 2 + d1) / 3;
}

export function daylightPower(ctx: GameCtx, x: number, y: number, z: number, inverted: boolean): number {
  let i = ctx.world.getSkyLight(x, y, z) - skyDarken(ctx);
  let f = celestialAngle(ctx.time.dayTime) * Math.PI * 2;
  if (inverted) i = 15 - i;
  else if (i > 0) {
    const target = f < Math.PI ? 0 : Math.PI * 2;
    f += (target - f) * 0.2;
    i = Math.round(i * Math.cos(f));
  }
  if (ctx.world.dim !== "overworld") i = inverted ? 15 : 0;
  return Math.min(15, Math.max(0, i));
}

function updateDetector(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const p = daylightPower(ctx, x, y, z, idOf(s) === INVERTED);
  if (p !== metaOf(s)) setState(ctx, x, y, z, stateOf(idOf(s), p));
}

export const DAYLIGHT_BEHAVIOR: BlockBehavior = {
  onPlaced(ctx, x, y, z, s) {
    updateDetector(ctx, x, y, z, s);
    schedule(ctx, x, y, z, 20);
  },
  onRemoved(ctx, x, y, z, s) {
    if (metaOf(s) > 0) notifyNeighbors(ctx, x, y, z);
  },
  neighborChanged(ctx, x, y, z) {
    if (!hasTick(ctx, x, y, z)) schedule(ctx, x, y, z, 20);
  },
  randomTick(ctx, x, y, z) {
    if (!hasTick(ctx, x, y, z)) schedule(ctx, x, y, z, 20);
  },
  scheduledTick(ctx, x, y, z, s) {
    ticked(ctx, x, y, z);
    updateDetector(ctx, x, y, z, s);
    schedule(ctx, x, y, z, 20);
  },
  use(ctx, x, y, z, s) {
    const next = stateOf(idOf(s) === INVERTED ? DETECTOR : INVERTED, metaOf(s));
    setState(ctx, x, y, z, next);
    updateDetector(ctx, x, y, z, next);
    notifyNeighbors(ctx, x, y, z);
    return true;
  },
  power: (_c, _x, _y, _z, s) => metaOf(s),
};

export const REDSTONE_BLOCK_BEHAVIOR: BlockBehavior = {
  onPlaced: (ctx, x, y, z) => notifyNeighbors(ctx, x, y, z),
  onRemoved: (ctx, x, y, z) => notifyNeighbors(ctx, x, y, z),
  power: () => 15,
};

// Meta bits 0-2: the Face the rod points to. Bit 3: powered for 8 ticks after a strike.
export function strikeLightningRod(ctx: GameCtx, x: number, y: number, z: number) {
  const s = ctx.world.getBlock(x, y, z);
  if (nameOf(s) !== "lightning_rod") return;
  setState(ctx, x, y, z, stateOf(idOf(s), metaOf(s) | 8));
  notifyDeep(ctx, x, y, z);
  schedule(ctx, x, y, z, 8);
}

export const LIGHTNING_ROD_BEHAVIOR: BlockBehavior = {
  place: (_c, _x, _y, _z, info, def) => stateOf(idOf(def), info.face),
  scheduledTick(ctx, x, y, z, s) {
    ticked(ctx, x, y, z);
    if (metaOf(s) & 8) {
      setState(ctx, x, y, z, stateOf(idOf(s), metaOf(s) & 7));
      notifyDeep(ctx, x, y, z);
    }
  },
  power: (_c, _x, _y, _z, s) => (metaOf(s) & 8 ? 15 : 0),
  strongPower: (_c, _x, _y, _z, s, toward) => (metaOf(s) & 8 && toward === OPP[metaOf(s) & 7] ? 15 : 0),
};
