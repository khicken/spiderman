import { AIR, idOf, metaOf, SET_NO_DROP, stateOf, type BlockBehavior, type BlockState, type GameCtx, type ItemStack } from "../../contracts";
import { blockDef, hasTag } from "../../blocks/registry";
import { isPowered } from "./power";
import { flag, id, isAir, nameOf, notifyNeighbors, schedule, setFlag, setState, sound, ticked } from "./util";

const LAMP = id("redstone_lamp");
const LAMP_ON = id("lit_redstone_lamp");

function lampCheck(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const lit = idOf(s) === LAMP_ON;
  const p = isPowered(ctx, x, y, z);
  if (lit && !p) schedule(ctx, x, y, z, 4);
  else if (!lit && p) setState(ctx, x, y, z, stateOf(LAMP_ON));
}

export const LAMP_BEHAVIOR: BlockBehavior = {
  onPlaced: lampCheck,
  neighborChanged: lampCheck,
  scheduledTick(ctx, x, y, z, s) {
    ticked(ctx, x, y, z);
    if (idOf(s) === LAMP_ON && !isPowered(ctx, x, y, z)) setState(ctx, x, y, z, stateOf(LAMP));
  },
};

const HEAD_SOUNDS: Record<string, string> = {
  zombie_head: "zombie", zombie_wall_head: "zombie", skeleton_skull: "skeleton", skeleton_wall_skull: "skeleton",
  creeper_head: "creeper", creeper_wall_head: "creeper", dragon_head: "ender_dragon", dragon_wall_head: "ender_dragon",
  wither_skeleton_skull: "wither_skeleton", wither_skeleton_wall_skull: "wither_skeleton", piglin_head: "piglin", piglin_wall_head: "piglin",
};

const INSTRUMENT_BY_NAME: Record<string, string> = {
  gold_block: "bell", clay: "flute", packed_ice: "chime", bone_block: "xylophone", iron_block: "iron_xylophone",
  soul_sand: "cow_bell", pumpkin: "didgeridoo", emerald_block: "bit", hay_block: "banjo", glowstone: "pling",
};

export function instrumentOf(below: BlockState): string {
  const d = blockDef(below);
  const named = INSTRUMENT_BY_NAME[d.name];
  if (named) return named;
  if (hasTag(below, "wool") || d.sound === "wool") return "guitar";
  switch (d.sound) {
    case "wood":
    case "cherry_wood":
    case "bamboo_wood":
      return "bass";
    case "sand":
    case "gravel":
      return "snare";
    case "glass":
      return "hat";
    case "stone":
    case "deepslate":
    case "netherrack":
    case "nether_bricks":
    case "tuff":
    case "copper":
      return d.opaque ? "basedrum" : "harp";
    default:
      return "harp";
  }
}

function noteData(ctx: GameCtx, x: number, y: number, z: number) {
  let be = ctx.world.getBlockEntity(x, y, z);
  if (!be || be.type !== "note_block") {
    be = { x, y, z, type: "note_block", data: { note: 0, powered: false } };
    ctx.world.setBlockEntity(be, x, y, z);
  }
  be.data ??= {};
  return be;
}

function noteColor(note: number): number {
  const f = note / 24;
  const c = (o: number) => Math.round(Math.max(0, Math.sin((f + o) * Math.PI * 2) * 0.65 + 0.35) * 255);
  return (c(0) << 16) | (c(1 / 3) << 8) | c(2 / 3);
}

export function playNote(ctx: GameCtx, x: number, y: number, z: number): boolean {
  const above = ctx.world.getBlock(x, y + 1, z);
  const head = HEAD_SOUNDS[nameOf(above)];
  if (head) {
    sound(ctx, `block.note_block.imitate.${head}`, x, y, z, 1, 1);
    return true;
  }
  if (!isAir(above)) return false;
  const note = Number(noteData(ctx, x, y, z).data?.note ?? 0);
  sound(ctx, `block.note_block.${instrumentOf(ctx.world.getBlock(x, y - 1, z))}`, x, y, z, 3, Math.pow(2, (note - 12) / 12));
  ctx.emit({ type: "particles", kind: "note", x: x + 0.5, y: y + 1.2, z: z + 0.5, count: 1, color: noteColor(note) });
  return true;
}

export const NOTE_BLOCK_BEHAVIOR: BlockBehavior = {
  use(ctx, x, y, z) {
    const be = noteData(ctx, x, y, z);
    if (!HEAD_SOUNDS[nameOf(ctx.world.getBlock(x, y + 1, z))]) {
      be.data = { ...be.data, note: (Number(be.data?.note ?? 0) + 1) % 25 };
      ctx.world.setBlockEntity(be, x, y, z);
    }
    playNote(ctx, x, y, z);
    return true;
  },
  neighborChanged(ctx, x, y, z) {
    const be = noteData(ctx, x, y, z);
    const p = isPowered(ctx, x, y, z);
    if (p === Boolean(be.data?.powered)) return;
    be.data = { ...be.data, powered: p };
    ctx.world.setBlockEntity(be, x, y, z);
    if (p) playNote(ctx, x, y, z);
  },
  onRemoved(ctx, x, y, z) {
    ctx.world.setBlockEntity(null, x, y, z);
  },
};

export function primeTnt(ctx: GameCtx, x: number, y: number, z: number, fuse = 80) {
  ctx.world.setBlock(x, y, z, AIR, SET_NO_DROP);
  notifyNeighbors(ctx, x, y, z);
  ctx.entities.spawn("tnt", x + 0.5, y, z + 0.5, { fuse });
  sound(ctx, "entity.tnt.primed", x, y, z, 1, 1);
}

function tntCheck(ctx: GameCtx, x: number, y: number, z: number) {
  if (isPowered(ctx, x, y, z)) primeTnt(ctx, x, y, z);
}

export const TNT_BEHAVIOR: BlockBehavior = {
  onPlaced: tntCheck,
  neighborChanged: tntCheck,
  use(ctx, x, y, z, _s, held) {
    if (!held || (held.item !== "flint_and_steel" && held.item !== "fire_charge")) return false;
    primeTnt(ctx, x, y, z);
    if (ctx.player?.gameMode !== "creative") {
      if (held.item === "flint_and_steel") ctx.inventory.damageHeld(1);
      else ctx.inventory.removeHeld(1);
    }
    return true;
  },
};

const STAGES = ["", "exposed_", "weathered_", "oxidized_"];
interface BulbInfo { stage: number; waxed: boolean; lit: boolean }
const BULB = new Map<number, BulbInfo>();
const bulbId = (stage: number, waxed: boolean, lit: boolean) => id(`${lit ? "lit_" : ""}${waxed ? "waxed_" : ""}${STAGES[stage]}copper_bulb`);
export const BULB_NAMES: string[] = [];
for (let st = 0; st < 4; st++)
  for (const waxed of [false, true])
    for (const lit of [false, true]) {
      const i = bulbId(st, waxed, lit);
      if (i < 0) continue;
      BULB.set(i, { stage: st, waxed, lit });
      BULB_NAMES.push(blockDef(stateOf(i)).name);
    }

const bulbState = (b: BulbInfo, powered: boolean) => stateOf(bulbId(b.stage, b.waxed, b.lit), powered ? 1 : 0);

function bulbCheck(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const b = BULB.get(idOf(s));
  if (!b) return;
  const p = isPowered(ctx, x, y, z);
  if (p === ((metaOf(s) & 1) !== 0)) return;
  const next = p ? { ...b, lit: !b.lit } : b;
  if (p) sound(ctx, next.lit ? "block.copper_bulb.turn_on" : "block.copper_bulb.turn_off", x, y, z, 1, 1);
  setState(ctx, x, y, z, bulbState(next, p));
}

const OXIDIZABLE_STAGE = (s: BlockState): number => {
  if (!hasTag(s, "oxidizable")) return -1;
  const n = nameOf(s).replace(/^lit_/, "");
  return n.startsWith("exposed_") ? 1 : n.startsWith("weathered_") ? 2 : n.startsWith("oxidized_") ? 3 : 0;
};

// Vanilla weathering: nearby copper that is less weathered blocks the change, more weathered copper speeds it.
function bulbWeather(ctx: GameCtx, x: number, y: number, z: number, s: BlockState) {
  const b = BULB.get(idOf(s));
  if (!b || b.waxed || b.stage >= 3 || ctx.random() >= 0.05688889) return;
  let more = 0;
  let same = 0;
  for (let dx = -4; dx <= 4; dx++)
    for (let dy = -4; dy <= 4; dy++)
      for (let dz = -4; dz <= 4; dz++) {
        const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
        if (m === 0 || m > 4) continue;
        const st = OXIDIZABLE_STAGE(ctx.world.getBlock(x + dx, y + dy, z + dz));
        if (st < 0) continue;
        if (st < b.stage) return;
        if (st > b.stage) more++;
        else same++;
      }
  const f = (more + 1) / (more + same + 1);
  if (ctx.random() < f * f * (b.stage === 0 ? 0.75 : 1)) setState(ctx, x, y, z, bulbState({ ...b, stage: b.stage + 1 }, (metaOf(s) & 1) !== 0));
}

function bulbUse(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, held: ItemStack | null): boolean {
  const b = BULB.get(idOf(s));
  if (!b || !held) return false;
  const powered = (metaOf(s) & 1) !== 0;
  if (held.item === "honeycomb" && !b.waxed) {
    setState(ctx, x, y, z, bulbState({ ...b, waxed: true }, powered));
    sound(ctx, "item.honeycomb.wax_on", x, y, z);
    if (ctx.player?.gameMode !== "creative") ctx.inventory.removeHeld(1);
    return true;
  }
  if (held.item.endsWith("_axe") && (b.waxed || b.stage > 0)) {
    const next = b.waxed ? { ...b, waxed: false } : { ...b, stage: b.stage - 1 };
    setState(ctx, x, y, z, bulbState(next, powered));
    sound(ctx, b.waxed ? "item.axe.wax_off" : "item.axe.scrape", x, y, z);
    if (ctx.player?.gameMode !== "creative") ctx.inventory.damageHeld(1);
    return true;
  }
  return false;
}

export const COPPER_BULB_BEHAVIOR: BlockBehavior = {
  place: (_c, _x, _y, _z, _i, def) => stateOf(idOf(def), 0),
  onPlaced: bulbCheck,
  neighborChanged: bulbCheck,
  randomTick: bulbWeather,
  use: bulbUse,
  comparatorOutput: (_c, _x, _y, _z, s) => (BULB.get(idOf(s))?.lit ? 15 : 0),
};

export function bellPowerChanged(ctx: GameCtx, x: number, y: number, z: number) {
  const p = isPowered(ctx, x, y, z);
  if (p === flag(ctx, x, y, z)) return;
  setFlag(ctx, x, y, z, p);
  if (p) sound(ctx, "block.bell.use", x, y, z, 2, 1);
}
