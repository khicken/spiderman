import type { Effect, GameCtx, GameMode, ItemStack, Rules } from "../contracts";
import { hasItem, itemDef } from "../items/registry";
import { MAX_Y, MIN_Y, SET_NOTIFY, idOf, metaOf } from "../contracts";
import { findNear, STRUCTS } from "../worldgen/structure-grid";
import { biomeAtXZ } from "../worldgen";
import { BIOMES } from "../worldgen/biomes";
import { mobDef } from "../entities/registry";
import { breakBlock } from "../mechanics/util";
import { EFFECTS, ENCHANTS, enchantName, enchantsConflict, titleCase, type EnchantTarget } from "./data";
import { advancementCommand } from "../systems/advancements/command";
import { rideCommand } from "./ride-command";
import { selectTargets, targetName, type Target } from "./selector";
import { parseBlockState, type ParsedBlock } from "./block-states";
import { GAMERULES, RULE_NAMES, getRule, ruleMax, ruleMin, setRule } from "./gamerules";
import { setSyntaxPlayer, suggestArgs, tokenize, type Suggestion } from "./command-syntax";

let playerName = "Player";
export const setPlayerName = (n: string) => {
  playerName = n;
  setSyntaxPlayer(n);
};

type Out = string[];
class CmdError extends Error {}
const fail = (msg: string): never => {
  throw new CmdError(msg);
};
const INCOMPLETE = "Unknown or incomplete command, see below for error";

interface Cmd {
  name: string;
  aliases?: string[];
  cheat: boolean;
  usage: string[];
  syntax: string[]; // argument grammar for suggestions, without the command name
  run(ctx: GameCtx, a: string[], raw: string): Out;
}

const id = (s: string) => s.toLowerCase().replace(/^minecraft:/, "");
const fmtF = (v: number) => v.toFixed(6);

function int(s: string | undefined, name = "integer", min = -2147483648, max = 2147483647): number {
  if (s === undefined) return fail(INCOMPLETE);
  if (!/^[-+]?\d+$/.test(s)) return fail(`Expected ${name === "integer" ? "integer" : name}`);
  const n = Number(s);
  if (n < min) return fail(`Integer must not be less than ${min}, found ${n}`);
  if (n > max) return fail(`Integer must not be more than ${max}, found ${n}`);
  return n;
}

function bool(s: string): boolean {
  if (s === "true") return true;
  if (s === "false") return false;
  return fail(`Invalid boolean, expected 'true' or 'false' but found '${s}'`);
}

function coord(s: string | undefined, base: number, center: boolean): number {
  if (s === undefined) return fail(INCOMPLETE);
  if (s.startsWith("^")) return fail("Mixing of world & local coordinates is not allowed");
  if (s.startsWith("~")) {
    const rest = s.slice(1);
    if (rest && isNaN(Number(rest))) return fail("Expected double");
    return base + (rest ? Number(rest) : 0);
  }
  if (isNaN(Number(s))) return fail("Expected double");
  const n = Number(s);
  return center && /^[-+]?\d+$/.test(s) ? n + 0.5 : n;
}

function xyz(ctx: GameCtx, a: string[], i: number, center: boolean) {
  const p = ctx.player.body.pos;
  if (a[i + 2] === undefined) return fail(a[i] === undefined ? INCOMPLETE : "Incomplete (expected 3 coordinates)");
  return { x: coord(a[i], p.x, center), y: coord(a[i + 1], p.y, false), z: coord(a[i + 2], p.z, center) };
}

const isCoord = (s: string | undefined) => !!s && /^[~^]|^[-+]?[\d.]/.test(s);
const targets = (ctx: GameCtx, s: string | undefined, opts: { single?: boolean; players?: boolean } = {}) => selectTargets(ctx, s, playerName, fail, opts);
// Every player selector resolves to the local player: this world has one.
const players = (ctx: GameCtx, s: string | undefined, single = false) => targets(ctx, s, { players: true, single }) as "player"[];
const nameOf = (t: Target) => targetName(t, playerName);
const many = (list: Target[], one: string, n: string) => (list.length === 1 ? one.replace("%s", nameOf(list[0])) : n.replace("%s", String(list.length)));

const MODES: GameMode[] = ["survival", "creative", "adventure", "spectator"];
const DIFFS: Rules["difficulty"][] = ["peaceful", "easy", "normal", "hard"];
const TIMES: Record<string, number> = { day: 1000, noon: 6000, night: 13000, midnight: 18000 };

function timeArg(s: string | undefined): number {
  if (s === undefined) return fail(INCOMPLETE);
  const m = /^(\d+(?:\.\d+)?)([dst]?)$/.exec(s);
  if (!m) return fail(/^-/.test(s) ? "Tick count must be non-negative" : "Invalid unit");
  const k = m[2] === "d" ? 24000 : m[2] === "s" ? 20 : 1;
  return Math.round(Number(m[1]) * k);
}

export function xpForLevel(level: number): number {
  return level >= 30 ? 9 * level - 158 : level >= 15 ? 5 * level - 38 : 2 * level + 7;
}

export function enchantTargets(item: string): Set<EnchantTarget> {
  const d = itemDef(item);
  const t = new Set<EnchantTarget>();
  if (!d) return t;
  const kind = d.tool?.kind;
  if (kind === "sword") t.add("sword").add("weapon");
  if (kind === "axe") t.add("weapon").add("mining");
  if (kind === "pickaxe" || kind === "shovel" || kind === "hoe" || kind === "shears") t.add("mining");
  if (d.armor) {
    t.add("armor").add(d.armor.slot);
  }
  if (item === "turtle_helmet") t.add("armor").add("head");
  if (item === "elytra") t.add("elytra_feet");
  for (const n of ["bow", "crossbow", "trident", "fishing_rod", "mace"] as const) if (item === n) t.add(n);
  const durable = !!(d.tool?.durability || d.armor?.durability || d.durability);
  if (durable) t.add("durability").add("vanishable");
  if (item === "compass" || item === "recovery_compass" || item === "carved_pumpkin") t.add("vanishable");
  if (item === "carved_pumpkin" || item === "elytra" || item.endsWith("_head") || item.endsWith("_skull")) t.add("armor");
  return t;
}

function setEffect(list: Effect[], eff: Effect): boolean {
  const cur = list.find((e) => e.id === eff.id);
  if (!cur) list.push(eff);
  else if (eff.amplifier > cur.amplifier || (eff.amplifier === cur.amplifier && eff.ticks > cur.ticks)) {
    cur.amplifier = eff.amplifier;
    cur.ticks = eff.ticks;
  } else return false;
  return true;
}

function clearAbsorption(ctx: GameCtx) {
  const p = ctx.player as typeof ctx.player & { absorption?: number };
  if (p.absorption !== undefined && !ctx.player.effects.some((e) => e.id === "absorption")) p.absorption = 0;
}

// Vanilla MobEffectCommands.giveEffect for one target. Non-living entities take no effects.
function giveEffect(ctx: GameCtx, t: Target, e: string, amp: number, ticks: number): boolean {
  if (t === "player") {
    if (e === "instant_health") ctx.player.heal(4 << Math.min(amp, 20));
    else if (e === "instant_damage") ctx.player.damage(6 << Math.min(amp, 20), "magic");
    else if (e === "saturation") {
      ctx.player.food = Math.min(20, ctx.player.food + amp + 1);
      ctx.player.saturation = Math.min(ctx.player.food, ctx.player.saturation + (amp + 1) * 2);
    } else {
      if (!setEffect(ctx.player.effects, { id: e, amplifier: amp, ticks })) return false;
      const p = ctx.player as typeof ctx.player & { absorption?: number };
      if (e === "absorption" && p.absorption !== undefined) p.absorption = Math.max(p.absorption, 4 * (amp + 1));
    }
    return true;
  }
  if (!mobDef(t.type) || t.dead) return false;
  if (e === "instant_health") t.health = Math.min(t.maxHealth, t.health + (4 << Math.min(amp, 20)));
  else if (e === "instant_damage") ctx.entities.damage(t.id, 6 << Math.min(amp, 20), "magic");
  else return setEffect(t.effects, { id: e, amplifier: amp, ticks });
  return true;
}

function giveStack(ctx: GameCtx, stack: ItemStack) {
  const rem = ctx.inventory.add(stack);
  if (rem && rem.count > 0) {
    const p = ctx.player.body.pos;
    ctx.entities.dropItem(rem, p.x, p.y + 1, p.z);
  }
}

function killTarget(ctx: GameCtx, t: Target) {
  if (t === "player") {
    ctx.player.damage(3.4e38, "generic");
    if (!ctx.player.dead) ctx.player.health = 0;
    return;
  }
  if (mobDef(t.type)) ctx.entities.damage(t.id, 3.4e38, "generic");
  if (!t.dead || !mobDef(t.type)) {
    t.dead = true;
    t.data._remove = true;
  }
}

function teleport(ctx: GameCtx, t: Target, x: number, y: number, z: number) {
  if (t === "player") return ctx.player.teleport(x, y, z);
  t.body.pos.set(x, y, z);
  t.body.vel.set(0, 0, 0);
}

const posOf = (ctx: GameCtx, t: Target) => (t === "player" ? ctx.player.body.pos : t.body.pos);

// Vanilla BlockPosArgument.getLoadedBlockPos.
function loadedPos(ctx: GameCtx, x: number, y: number, z: number) {
  if (!ctx.world.isLoaded(x, z)) return fail("That position is not loaded");
  if (y < MIN_Y || y > MAX_Y) return fail("That position is out of this world");
}

// Vanilla BlockInput.place: set the state, then waterlogging when the state names it.
function placeBlock(ctx: GameCtx, b: ParsedBlock, x: number, y: number, z: number): boolean {
  const w = ctx.world;
  let changed = w.getBlock(x, y, z) !== b.state && w.setBlock(x, y, z, b.state, SET_NOTIFY);
  const wet = b.waterlogged ?? false;
  if (w.setWaterlogged && wet !== (w.isWaterlogged?.(x, y, z) ?? false)) changed = w.setWaterlogged(x, y, z, wet) || changed;
  return changed;
}

const matches = (ctx: GameCtx, f: ParsedBlock, x: number, y: number, z: number) => {
  const s = ctx.world.getBlock(x, y, z);
  if (idOf(s) !== idOf(f.state)) return false;
  return Object.keys(f.props).length === 0 || metaOf(s) === metaOf(f.state);
};

function setblock(ctx: GameCtx, a: string[]): Out {
  const p = xyz(ctx, a, 0, false);
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
  loadedPos(ctx, x, y, z);
  if (a[3] === undefined) return fail(INCOMPLETE);
  const b = parseBlockState(a[3], fail);
  const mode = a[4] ?? "replace";
  if (!["replace", "destroy", "keep"].includes(mode) || a.length > 5) return fail(INCOMPLETE);
  if (mode === "keep" && ctx.world.getBlock(x, y, z) !== 0) return fail("Could not set the block");
  if (mode === "destroy") breakBlock(ctx, x, y, z, true);
  if (!placeBlock(ctx, b, x, y, z)) return fail("Could not set the block");
  return [`Changed the block at ${x}, ${y}, ${z}`];
}

function fill(ctx: GameCtx, a: string[]): Out {
  const p = xyz(ctx, a, 0, false), q = xyz(ctx, a, 3, false);
  if (a[6] === undefined) return fail(INCOMPLETE);
  const b = parseBlockState(a[6], fail);
  const mode = a[7] ?? "replace";
  if (!["replace", "destroy", "hollow", "keep", "outline"].includes(mode) || (mode !== "replace" && a.length > 8)) return fail(INCOMPLETE);
  const filter = mode === "replace" && a[8] !== undefined ? parseBlockState(a[8], fail) : null;
  if (a.length > 9) return fail(INCOMPLETE);
  const x0 = Math.floor(Math.min(p.x, q.x)), x1 = Math.floor(Math.max(p.x, q.x));
  const y0 = Math.floor(Math.min(p.y, q.y)), y1 = Math.floor(Math.max(p.y, q.y));
  const z0 = Math.floor(Math.min(p.z, q.z)), z1 = Math.floor(Math.max(p.z, q.z));
  const n = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
  const limit = getRule(ctx.rules, "commandModificationBlockLimit") as number;
  if (n > limit) return fail(`Too many blocks in the specified area (maximum ${limit}, specified ${n})`);
  const w = ctx.world;
  let loaded = y1 >= MIN_Y && y0 <= MAX_Y;
  for (let cx = x0 >> 4; loaded && cx <= x1 >> 4; cx++) for (let cz = z0 >> 4; loaded && cz <= z1 >> 4; cz++) loaded = w.isLoaded(cx << 4, cz << 4);
  if (!loaded) return fail("That position is not loaded");
  const air = parseBlockState("air", fail);
  let changed = 0;
  for (let y = Math.max(y0, MIN_Y); y <= Math.min(y1, MAX_Y); y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const edge = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
        let put: ParsedBlock | null = b;
        if (mode === "hollow") put = edge ? b : air;
        else if (mode === "outline" && !edge) put = null;
        else if (mode === "keep" && w.getBlock(x, y, z) !== 0) put = null;
        else if (filter && !matches(ctx, filter, x, y, z)) put = null;
        if (!put) continue;
        if (mode === "destroy") breakBlock(ctx, x, y, z, true);
        if (placeBlock(ctx, put, x, y, z)) changed++;
      }
    }
  }
  return changed ? [`Successfully filled ${changed} block(s)`] : fail("No blocks were filled");
}

const COMMANDS: Cmd[] = [
  {
    name: "help",
    cheat: false,
    usage: ["/help [<command>]"],
    syntax: ["[<command>]"],
    run: (ctx, a) => {
      const list = allowed(ctx);
      if (a[0]) {
        const c = find(a[0]);
        if (!c || !list.includes(c)) return fail("Unknown command or insufficient permissions");
        return c.usage;
      }
      return list.flatMap((c) => c.usage);
    },
  },
  {
    name: "seed",
    cheat: false,
    usage: ["/seed"],
    syntax: [],
    run: (ctx) => [`Seed: [${ctx.world.seed}]`],
  },
  {
    name: "me",
    cheat: false,
    usage: ["/me <action>"],
    syntax: ["<action>"],
    run: (_ctx, _a, raw) => (raw.trim() ? [`* ${playerName} ${raw.trim()}`] : fail(INCOMPLETE)),
  },
  {
    name: "list",
    cheat: false,
    usage: ["/list", "/list uuids"],
    syntax: ["uuids"],
    run: () => [`There are 1 of a max of 8 players online: ${playerName}`],
  },
  {
    name: "gamemode",
    cheat: true,
    usage: ["/gamemode <gamemode> [<target>]"],
    syntax: ["<gamemode> [<targets>]"],
    run: (ctx, a) => {
      if (a[0] === undefined) return fail(INCOMPLETE);
      const m = MODES.find((x) => x === a[0]);
      if (!m) return fail(`Unknown game mode: ${a[0]}`);
      if (a[1] !== undefined) players(ctx, a[1]);
      if (ctx.player.gameMode === m) return [];
      ctx.player.gameMode = m;
      if (m === "survival" || m === "adventure") ctx.player.flying = false;
      if (m === "spectator") ctx.player.flying = true;
      return [`Set own game mode to ${titleCase(m)} Mode`];
    },
  },
  {
    name: "time",
    cheat: true,
    usage: ["/time (add|query|set)"],
    syntax: ["add <time>", "query (daytime|gametime|day)", "set (day|night|noon|midnight)", "set <time>"],
    run: (ctx, a) => {
      const t = ctx.time;
      if (a[0] === "set") {
        const v = a[1] !== undefined && a[1] in TIMES ? TIMES[a[1]] : timeArg(a[1]);
        t.day = Math.floor(v / 24000);
        t.dayTime = v % 24000;
        return [`Set the time to ${v}`];
      }
      if (a[0] === "add") {
        const total = t.day * 24000 + t.dayTime + timeArg(a[1]);
        t.day = Math.floor(total / 24000);
        t.dayTime = ((total % 24000) + 24000) % 24000;
        return [`Set the time to ${t.dayTime}`];
      }
      if (a[0] === "query") {
        const q = a[1];
        const v = q === "daytime" ? t.dayTime : q === "gametime" ? t.tick : q === "day" ? t.day : fail(INCOMPLETE);
        return [`The time is ${v}`];
      }
      return fail(INCOMPLETE);
    },
  },
  {
    name: "weather",
    cheat: true,
    usage: ["/weather (clear|rain|thunder)"],
    syntax: ["(clear|rain|thunder) [<duration>]"],
    run: (ctx, a) => {
      if (a[1] !== undefined) timeArg(a[1]);
      if (a[0] === "clear") {
        ctx.time.rain = 0;
        ctx.time.thunder = 0;
        return ["Set the weather to clear"];
      }
      if (a[0] === "rain") {
        ctx.time.rain = 1;
        ctx.time.thunder = 0;
        return ["Set the weather to rain"];
      }
      if (a[0] === "thunder") {
        ctx.time.rain = 1;
        ctx.time.thunder = 1;
        return ["Set the weather to rain & thunder"];
      }
      return fail(INCOMPLETE);
    },
  },
  {
    name: "tp",
    aliases: ["teleport"],
    cheat: true,
    usage: ["/tp <location>", "/tp <destination>", "/tp <targets> <location>", "/tp <targets> <destination>"],
    syntax: ["<location>", "<destination>", "<targets> <location>", "<targets> <destination>"],
    run: (ctx, a) => {
      if (a[0] === undefined) return fail(INCOMPLETE);
      const who: Target[] = isCoord(a[0]) ? ["player"] : targets(ctx, a[0]);
      const rest = isCoord(a[0]) ? a : a.slice(1);
      if (rest.length === 0) {
        const dest = targets(ctx, a[0], { single: true })[0];
        const d = posOf(ctx, dest);
        teleport(ctx, "player", d.x, d.y, d.z);
        return [`Teleported ${playerName} to ${nameOf(dest)}`];
      }
      if (!isCoord(rest[0])) {
        const dest = targets(ctx, rest[0], { single: true })[0];
        const d = posOf(ctx, dest);
        for (const t of who) teleport(ctx, t, d.x, d.y, d.z);
        return [many(who, `Teleported %s to ${nameOf(dest)}`, `Teleported %s entities to ${nameOf(dest)}`)];
      }
      const { x, y, z } = xyz(ctx, rest, 0, true);
      for (const t of who) teleport(ctx, t, x, y, z);
      const at = `${fmtF(x)}, ${fmtF(y)}, ${fmtF(z)}`;
      return [many(who, `Teleported %s to ${at}`, `Teleported %s entities to ${at}`)];
    },
  },
  {
    name: "setblock",
    cheat: true,
    usage: ["/setblock <pos> <block> [destroy|keep|replace]"],
    syntax: ["<pos> <block> [destroy|keep|replace]"],
    run: (ctx, a) => setblock(ctx, a),
  },
  {
    name: "fill",
    cheat: true,
    usage: ["/fill <from> <to> <block> [destroy|hollow|keep|outline|replace]"],
    syntax: ["<from> <to> <block> [destroy|hollow|keep|outline|replace]", "<from> <to> <block> replace [<filter>]"],
    run: (ctx, a) => fill(ctx, a),
  },
  {
    name: "give",
    cheat: true,
    usage: ["/give <targets> <item> [<count>]"],
    syntax: ["<targets> <item> [<count>]"],
    run: (ctx, a) => {
      const who = players(ctx, a[0]);
      if (a[1] === undefined) return fail(INCOMPLETE);
      const name = id(a[1]).replace(/[[{].*$/, "");
      if (!hasItem(name)) return fail(`Unknown item 'minecraft:${name}'`);
      const count = a[2] === undefined ? 1 : int(a[2], "integer", 1);
      const max = itemDef(name)?.maxStack ?? 64;
      const display = itemDef(name)?.displayName ?? titleCase(name);
      if (count > max * 100) return fail(`Can't give more than ${max * 100} of [${display}]`);
      for (let left = count; left > 0; left -= max) giveStack(ctx, { item: name, count: Math.min(left, max) });
      return [many(who, `Gave ${count} [${display}] to %s`, `Gave ${count} [${display}] to %s players`)];
    },
  },
  {
    name: "kill",
    cheat: true,
    usage: ["/kill [<targets>]"],
    syntax: ["[<targets>]"],
    run: (ctx, a) => {
      const list = a[0] === undefined ? (["player"] as Target[]) : targets(ctx, a[0]);
      const names = list.length === 1 ? nameOf(list[0]) : "";
      for (const t of list) killTarget(ctx, t);
      return [list.length === 1 ? `Killed ${names}` : `Killed ${list.length} entities`];
    },
  },
  {
    name: "difficulty",
    cheat: true,
    usage: ["/difficulty [peaceful|easy|normal|hard]"],
    syntax: ["[peaceful|easy|normal|hard]"],
    run: (ctx, a) => {
      const cur = ctx.rules.difficulty;
      if (!a[0]) return [`The difficulty is ${titleCase(cur)}`];
      const d = DIFFS.find((x) => x === a[0]);
      if (!d) return fail(INCOMPLETE);
      if (d === cur) return fail(`The difficulty did not change; it is already set to ${titleCase(d)}`);
      ctx.rules.difficulty = d;
      return [`The difficulty has been set to ${titleCase(d)}`];
    },
  },
  {
    name: "gamerule",
    cheat: true,
    usage: RULE_NAMES.map((r) => `/gamerule ${r} [<value>]`),
    syntax: ["<rule> [<value>]"],
    run: (ctx, a) => {
      const rule = RULE_NAMES.find((r) => r === a[0]);
      if (!rule || a.length > 2) return fail(INCOMPLETE);
      if (a[1] === undefined) return [`Gamerule ${rule} is currently set to: ${getRule(ctx.rules, rule)}`];
      const v = typeof GAMERULES[rule] === "boolean" ? bool(a[1]) : int(a[1], "integer", ruleMin(rule), ruleMax(rule));
      setRule(ctx.rules, rule, v);
      return [`Gamerule ${rule} is now set to: ${v}`];
    },
  },
  {
    name: "summon",
    cheat: true,
    usage: ["/summon <entity> [<pos>] [<nbt>]"],
    syntax: ["<entity> [<pos>] [<nbt>]"],
    run: (ctx, a) => {
      if (!a[0]) return fail(INCOMPLETE);
      const raw = id(a[0]);
      const type = raw === "experience_orb" ? "xp_orb" : raw;
      const p = ctx.player.body.pos;
      const hasPos = isCoord(a[1]);
      const { x, y, z } = hasPos ? xyz(ctx, a, 1, true) : { x: p.x, y: p.y, z: p.z };
      if (y < -2.0e7 || Math.abs(x) > 3.0e7 || Math.abs(z) > 3.0e7) return fail("Invalid position for summon");
      const e = ctx.entities.spawn(type, x, y, z, summonData(a.slice(hasPos ? 4 : 1).join(" ")));
      if (!e) return fail(type === "player" ? "Unable to summon entity" : `Can't find element 'minecraft:${raw}' of type 'minecraft:entity_type'`);
      return [`Summoned new ${nameOf(e)}`];
    },
  },
  {
    name: "setworldspawn",
    cheat: true,
    usage: ["/setworldspawn [<pos>] [<angle>]"],
    syntax: ["[<pos>] [<angle>]"],
    run: (ctx, a) => {
      const p = ctx.player.body.pos;
      const pos = a.length >= 3 ? xyz(ctx, a, 0, false) : { x: p.x, y: p.y, z: p.z };
      const s = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
      ctx.player.spawn = s;
      if (ctx.world.spawn) Object.assign(ctx.world.spawn, s);
      return [`Set the world spawn point to ${s.x}, ${s.y}, ${s.z} [${Number(a[3] ?? 0).toFixed(1)}]`];
    },
  },
  {
    name: "spawnpoint",
    cheat: true,
    usage: ["/spawnpoint [<targets>] [<pos>] [<angle>]"],
    syntax: ["[<targets>] [<pos>] [<angle>]"],
    run: (ctx, a) => {
      const b = a[0] !== undefined && !isCoord(a[0]) ? (players(ctx, a[0]), a.slice(1)) : a;
      const p = ctx.player.body.pos;
      const pos = b.length >= 3 ? xyz(ctx, b, 0, false) : { x: p.x, y: p.y, z: p.z };
      const s = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
      ctx.player.spawn = s;
      return [`Set spawn point to ${s.x}, ${s.y}, ${s.z} [${Number(b[3] ?? 0).toFixed(1)}] in minecraft:${ctx.world.dim === "overworld" ? "overworld" : ctx.world.dim === "nether" ? "the_nether" : "the_end"} for ${playerName}`];
    },
  },
  {
    name: "effect",
    cheat: true,
    usage: ["/effect clear [<targets>] [<effect>]", "/effect give <targets> <effect> [<seconds>] [<amplifier>] [<hideParticles>]"],
    syntax: ["clear [<targets>] [<effect>]", "give <targets> <effect> [<seconds>] [<amplifier>] [<hideParticles>]", "give <targets> <effect> infinite [<amplifier>] [<hideParticles>]"],
    run: (ctx, a) => {
      const sub = a[0];
      if (sub === "clear") {
        const list = a[1] === undefined ? (["player"] as Target[]) : targets(ctx, a[1]);
        const fx = (t: Target) => (t === "player" ? ctx.player.effects : t.effects);
        if (a[2] !== undefined) {
          const e = id(a[2]);
          if (!EFFECTS[e]) return fail(`Can't find element 'minecraft:${e}' of type 'minecraft:mob_effect'`);
          let n = 0;
          for (const t of list) {
            const l = fx(t);
            const i = l.findIndex((x) => x.id === e);
            if (i >= 0) {
              l.splice(i, 1);
              n++;
            }
          }
          clearAbsorption(ctx);
          if (!n) return fail("Target doesn't have the requested effect");
          return [many(list, `Removed effect ${EFFECTS[e].name} from %s`, `Removed effect ${EFFECTS[e].name} from %s targets`)];
        }
        let n = 0;
        for (const t of list) {
          if (fx(t).length) n++;
          fx(t).length = 0;
        }
        clearAbsorption(ctx);
        if (!n) return fail("Target has no effects to remove");
        return [many(list, "Removed every effect from %s", "Removed every effect from %s targets")];
      }
      if (sub !== "give" || a[2] === undefined) return fail(INCOMPLETE);
      const list = targets(ctx, a[1]);
      const e = id(a[2]);
      const info = EFFECTS[e];
      if (!info) return fail(`Can't find element 'minecraft:${e}' of type 'minecraft:mob_effect'`);
      const seconds = a[3] === undefined ? (info.instant ? 1 : 30) : a[3] === "infinite" ? -1 : int(a[3], "integer", 1, 1000000);
      const amp = a[4] === undefined ? 0 : int(a[4], "integer", 0, 255);
      if (a[5] !== undefined) bool(a[5]);
      const ticks = seconds < 0 ? 2147483647 : info.instant ? 1 : seconds * 20;
      const ok = list.filter((t) => giveEffect(ctx, t, e, amp, ticks));
      if (!ok.length) return fail("Unable to apply this effect (target is either immune to effects, or has something stronger)");
      return [many(ok, `Applied effect ${info.name} to %s`, `Applied effect ${info.name} to %s targets`)];
    },
  },
  {
    name: "enchant",
    cheat: true,
    usage: ["/enchant <targets> <enchantment> [<level>]"],
    syntax: ["<targets> <enchantment> [<level>]"],
    run: (ctx, a) => {
      const list = targets(ctx, a[0]);
      if (a[1] === undefined) return fail(INCOMPLETE);
      const e = id(a[1]);
      const info = ENCHANTS[e];
      if (!info) return fail(`Can't find element 'minecraft:${e}' of type 'minecraft:enchantment'`);
      const level = a[2] === undefined ? 1 : int(a[2], "integer", 0);
      if (level > info.max) return fail(`${level} is higher than the maximum level of ${info.max} supported by that enchantment`);
      if (!list.includes("player")) return fail(`${nameOf(list[0])} is not a valid entity for this command`);
      const held = ctx.inventory.held();
      if (!held) return fail(`${playerName} is not holding any item`);
      const name = itemDef(held.item)?.displayName ?? titleCase(held.item);
      const targetsOk = enchantTargets(held.item);
      if (!info.targets.some((t) => targetsOk.has(t))) return fail(`${name} cannot support that enchantment`);
      if (Object.keys(held.ench ?? {}).some((k) => enchantsConflict(k, e))) return fail(`${name} cannot support that enchantment`);
      ctx.inventory.setSlot(ctx.inventory.selected, { ...held, ench: { ...held.ench, [e]: level } });
      return [`Applied enchantment ${enchantName(e, level)} to ${playerName}'s item`];
    },
  },
  {
    name: "xp",
    aliases: ["experience"],
    cheat: true,
    usage: ["/xp (add|query|set)"],
    syntax: ["add <targets> <amount> [levels|points]", "set <targets> <amount> [levels|points]", "query <targets> (levels|points)"],
    run: (ctx, a) => {
      const sub = a[0];
      if (sub !== "add" && sub !== "set" && sub !== "query") return fail(INCOMPLETE);
      players(ctx, a[1], sub === "query");
      const b = a.slice(2);
      const pl = ctx.player;
      if (sub === "query") {
        if (b[0] === "levels") return [`${playerName} has ${pl.xpLevel} experience levels`];
        if (b[0] === "points") return [`${playerName} has ${Math.floor(pl.xpProgress * xpForLevel(pl.xpLevel))} experience points`];
        return fail(INCOMPLETE);
      }
      const n = int(b[0]);
      const levels = b[1] === "levels";
      if (b[1] !== undefined && !levels && b[1] !== "points") return fail(INCOMPLETE);
      if (sub === "add") {
        if (levels) pl.xpLevel = Math.max(0, pl.xpLevel + n);
        else pl.addXp(n);
        return [`Gave ${n} experience ${levels ? "levels" : "points"} to ${playerName}`];
      }
      if (n < 0) return fail(`Integer must not be less than 0, found ${n}`);
      if (levels) pl.xpLevel = n;
      else {
        const need = xpForLevel(pl.xpLevel);
        if (n > need) return fail("Unable to set experience points above the maximum points for the player's current level");
        pl.xpProgress = n / need;
      }
      return [`Set ${n} experience ${levels ? "levels" : "points"} on ${playerName}`];
    },
  },
  {
    name: "clear",
    cheat: true,
    usage: ["/clear [<targets>] [<item>] [<maxCount>]"],
    syntax: ["[<targets>] [<item>] [<maxCount>]"],
    run: (ctx, a) => {
      if (a[0] !== undefined) players(ctx, a[0]);
      const b = a.slice(1);
      const filter = b[0] ? id(b[0]) : null;
      if (filter && !hasItem(filter)) return fail(`Unknown item 'minecraft:${filter}'`);
      const max = b[1] === undefined ? -1 : int(b[1], "integer", 0);
      const inv = ctx.inventory;
      let n = 0;
      for (let i = 0; i < inv.slots.length; i++) {
        const s = inv.slots[i];
        if (!s || (filter && s.item !== filter)) continue;
        if (max === 0) {
          n += s.count;
          continue;
        }
        const take = max < 0 ? s.count : Math.min(s.count, max - n);
        if (take <= 0) break;
        n += take;
        inv.setSlot(i, take >= s.count ? null : { ...s, count: s.count - take });
      }
      if (!n) return fail(`No items were found on player ${playerName}`);
      return [max === 0 ? `Found ${n} matching item(s) on player ${playerName}` : `Removed ${n} item(s) from player ${playerName}`];
    },
  },
  {
    name: "advancement",
    cheat: true,
    usage: ["/advancement (grant|revoke) <targets> (everything|only|from|through|until) <advancement>"],
    syntax: ["(grant|revoke) <targets> everything", "(grant|revoke) <targets> (only|from|through|until) <advancement>"],
    run: (ctx, a) => {
      if (a[1] !== undefined) players(ctx, a[1]);
      return advancementCommand(ctx, a);
    },
  },
  {
    name: "locate",
    cheat: true,
    usage: ["/locate structure <structure>", "/locate biome <biome>"],
    syntax: ["structure <structure>", "biome <biome>"],
    run: (ctx, a) => {
      if (a[0] === "biome") return locateBiome(ctx, id(a[1] ?? ""));
      if (a[0] !== "structure") return fail(INCOMPLETE);
      const name = id(a[1] ?? "");
      const def = STRUCTS.find((d) => d.name === name);
      if (!def) return fail(`There is no structure with type "${a[1] ?? ""}"`);
      const p = ctx.player.body.pos;
      if (def.dim !== ctx.world.dim) return fail(`Could not find a structure of type "${name}" nearby`);
      const s = findNear(ctx.world.seed, name, p.x, p.z, 6400);
      if (!s) return fail(`Could not find a structure of type "${name}" nearby`);
      const dist = Math.floor(Math.hypot(s.x - p.x, s.z - p.z));
      return [`The nearest minecraft:${name} is at [${s.x}, ${def.dim === "overworld" && s.y >= 50 ? "~" : s.y}, ${s.z}] (${dist} blocks away)`];
    },
  },
  {
    name: "ride",
    cheat: true,
    usage: ["/ride <target> mount <vehicle>", "/ride <target> dismount"],
    syntax: ["<target> mount <vehicle>", "<target> dismount"],
    run: (ctx, a) => rideCommand(ctx, a, playerName, fail),
  },
];

// Vanilla /locate biome: spiral out to 6400 blocks in 32-block steps.
function locateBiome(ctx: GameCtx, name: string): Out {
  const b = BIOMES.find((d) => d.name === name);
  if (!b) return fail(`There is no biome with type "${name}"`);
  const p = ctx.player.body.pos;
  const ox = Math.floor(p.x), oz = Math.floor(p.z);
  const at = (x: number, z: number) => biomeAtXZ(ctx.world.seed, ctx.world.dim, x, z) === b.id;
  for (let r = 0; r <= 200; r++) {
    for (let i = -r; i <= r; i++) {
      for (const [dx, dz] of [[i, -r], [i, r], [-r, i], [r, i]]) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const x = ox + dx * 32, z = oz + dz * 32;
        if (!at(x, z)) continue;
        const dist = Math.floor(Math.hypot(x - p.x, z - p.z));
        return [`The nearest minecraft:${name} is at [${x}, ~, ${z}] (${dist} blocks away)`];
      }
    }
  }
  return fail(`Could not find a biome of type "${name}" within reasonable distance`);
}

const find = (name: string) => COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
const allowed = (ctx: GameCtx) => COMMANDS.filter((c) => !c.cheat || ctx.rules.cheats);

const unknown = (line: string): Out => {
  const shown = line.length > 10 ? `...${line.slice(-10)}` : line;
  return ["§cUnknown or incomplete command, see below for error", `§7${shown}§c§o<--[HERE]`];
};

export function runCommand(ctx: GameCtx, line: string): string[] {
  const body = line.trim().replace(/^\//, "");
  const toks = tokenize(body);
  const name = (toks[0]?.text ?? "").toLowerCase().replace(/^minecraft:/, "");
  const cmd = find(name);
  if (!cmd || (cmd.cheat && !ctx.rules.cheats)) return unknown(body);
  try {
    const out = cmd.run(ctx, toks.slice(1).map((t) => t.text), toks[1] ? body.slice(toks[1].start) : "");
    return cmd.cheat && !getRule(ctx.rules, "sendCommandFeedback") ? [] : out;
  } catch (e) {
    if (e instanceof CmdError) return e.message.startsWith("Unknown or incomplete") ? unknown(body) : [`§c${e.message}`];
    return [`§cAn unexpected error occurred trying to execute that command`];
  }
}

/** Popup suggestions and the gray usage text for the chat line, like vanilla CommandSuggestions. */
export function suggestCommand(ctx: GameCtx, line: string): Suggestion {
  const none = { start: line.length, list: [], usage: [] };
  if (!line.startsWith("/")) return none;
  const body = line.slice(1);
  const sp = body.indexOf(" ");
  const list = allowed(ctx);
  if (sp < 0) {
    const low = body.toLowerCase();
    return { start: 1, list: list.flatMap((c) => [c.name, ...(c.aliases ?? [])]).filter((n) => n.startsWith(low)).sort(), usage: [] };
  }
  const cmd = find(body.slice(0, sp).toLowerCase());
  if (!cmd || !list.includes(cmd)) return none;
  if (cmd.name === "help") {
    const rest = body.slice(sp + 1);
    if (rest.includes(" ")) return none;
    return { start: sp + 2, list: list.map((c) => c.name).filter((n) => n.startsWith(rest.toLowerCase())).sort(), usage: [] };
  }
  return suggestArgs(ctx, cmd.syntax, body.slice(sp + 1), sp + 2);
}

/** Full-line candidates for Tab. */
export function completeCommand(ctx: GameCtx, line: string): string[] {
  const s = suggestCommand(ctx, line);
  return s.list.slice(0, 200).map((o) => line.slice(0, s.start) + o);
}

export const COMMAND_NAMES = COMMANDS.map((c) => c.name);

// Flat key:value pairs from SNBT, e.g. {VillagerData:{profession:"minecraft:librarian",level:3}}.
function summonData(snbt: string): Record<string, unknown> | undefined {
  if (!snbt.trim().startsWith("{")) return undefined;
  const out: Record<string, unknown> = {};
  for (const m of snbt.matchAll(/(\w+)\s*:\s*"?([\w.:-]+)"?/g)) {
    const v = m[2].replace(/^minecraft:/, "");
    out[m[1]] = /^-?\d+(\.\d+)?[bsLfd]?$/.test(v) ? parseFloat(v) : v === "true" || v === "1b" ? true : v === "false" ? false : v;
  }
  if (out.NoAI) out.noAI = true;
  if (out.Age !== undefined && Number(out.Age) < 0) out.grow = Number(out.Age);
  return out;
}

