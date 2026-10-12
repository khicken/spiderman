import type { Effect, GameCtx, GameMode, ItemStack, Rules } from "../contracts";
import { hasItem, itemDef, ITEMS } from "../items/registry";
import { BLOCKS, blockByName } from "../blocks/registry";
import { SET_NOTIFY, stateOf } from "../contracts";
import { findNear, STRUCTS } from "../worldgen/structure-grid";
import { EFFECTS, ENCHANTS, enchantName, enchantsConflict, titleCase, type EnchantTarget } from "./data";

let playerName = "Player";
export const setPlayerName = (n: string) => {
  playerName = n;
};

type Out = string[];
class CmdError extends Error {}
const fail = (msg: string): never => {
  throw new CmdError(msg);
};

interface Cmd {
  name: string;
  aliases?: string[];
  cheat: boolean;
  usage: string[];
  run(ctx: GameCtx, a: string[]): Out;
  complete?(ctx: GameCtx, a: string[]): string[];
}

const id = (s: string) => s.toLowerCase().replace(/^minecraft:/, "").replace(/\[.*$/, "");
const isSelf = (s: string | undefined) => !!s && (/^@[spar](\[|$)/.test(s) || s.toLowerCase() === playerName.toLowerCase());
const fmtF = (v: number) => v.toFixed(6);

function int(s: string | undefined, name = "integer", min = -2147483648, max = 2147483647): number {
  if (s === undefined) return fail("Unknown or incomplete command, see below for error");
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
  if (s === undefined) return fail("Unknown or incomplete command, see below for error");
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
  return { x: coord(a[i], p.x, center), y: coord(a[i + 1], p.y, false), z: coord(a[i + 2], p.z, center) };
}

const stripTarget = (a: string[]) => (isSelf(a[0]) ? a.slice(1) : a);

const MODES: Record<string, GameMode> = { survival: "survival", creative: "creative", adventure: "adventure", spectator: "spectator", "0": "survival", "1": "creative", "2": "adventure", "3": "spectator", s: "survival", c: "creative", a: "adventure", sp: "spectator" };
const DIFFS: Rules["difficulty"][] = ["peaceful", "easy", "normal", "hard"];
const RULES = ["keepInventory", "doDaylightCycle", "doMobSpawning", "mobGriefing", "randomTickSpeed", "doFireTick"] as const;
const TIMES: Record<string, number> = { day: 1000, noon: 6000, night: 13000, midnight: 18000 };

function timeArg(s: string | undefined): number {
  if (s === undefined) return fail("Unknown or incomplete command, see below for error");
  const m = /^(\d+(?:\.\d+)?)([dst]?)$/.exec(s);
  if (!m) return fail("Expected integer");
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

function setEffect(ctx: GameCtx, eff: Effect): boolean {
  const list = ctx.player.effects;
  const cur = list.find((e) => e.id === eff.id);
  if (!cur) {
    list.push(eff);
    return true;
  }
  if (eff.amplifier > cur.amplifier || (eff.amplifier === cur.amplifier && eff.ticks > cur.ticks)) {
    cur.amplifier = eff.amplifier;
    cur.ticks = eff.ticks;
    return true;
  }
  return false;
}

function giveStack(ctx: GameCtx, stack: ItemStack) {
  const rem = ctx.inventory.add(stack);
  if (rem && rem.count > 0) {
    const p = ctx.player.body.pos;
    ctx.entities.dropItem(rem, p.x, p.y + 1, p.z);
  }
}

function killPlayer(ctx: GameCtx) {
  ctx.player.damage(3.4e38, "generic");
  if (!ctx.player.dead) ctx.player.health = 0;
}

const COMMANDS: Cmd[] = [
  {
    name: "help",
    cheat: false,
    usage: ["/help [<command>]"],
    run: (ctx, a) => {
      const list = allowed(ctx);
      if (a[0]) {
        const c = find(a[0]);
        if (!c || !list.includes(c)) return fail("Unknown command or insufficient permissions");
        return c.usage;
      }
      return list.flatMap((c) => c.usage);
    },
    complete: (ctx) => allowed(ctx).map((c) => c.name),
  },
  {
    name: "seed",
    cheat: false,
    usage: ["/seed"],
    run: (ctx) => [`Seed: [${ctx.world.seed}]`],
  },
  {
    name: "me",
    cheat: false,
    usage: ["/me <action>"],
    run: (_ctx, a) => (a.length ? [`* ${playerName} ${a.join(" ")}`] : fail("Unknown or incomplete command, see below for error")),
  },
  {
    name: "list",
    cheat: false,
    usage: ["/list", "/list uuids"],
    run: () => [`There are 1 of a max of 8 players online: ${playerName}`],
  },
  {
    name: "gamemode",
    cheat: true,
    usage: ["/gamemode <gamemode> [<target>]"],
    run: (ctx, a) => {
      const m = MODES[id(a[0] ?? "")];
      if (!m) return fail(a[0] ? `Unknown game mode: ${a[0]}` : "Unknown or incomplete command, see below for error");
      if (ctx.player.gameMode === m) return [];
      ctx.player.gameMode = m;
      if (m === "survival" || m === "adventure") ctx.player.flying = false;
      if (m === "spectator") ctx.player.flying = true;
      return [`Set own game mode to ${titleCase(m)} Mode`];
    },
    complete: () => ["survival", "creative", "adventure", "spectator"],
  },
  {
    name: "time",
    cheat: true,
    usage: ["/time (add|query|set)"],
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
        const v = q === "daytime" ? t.dayTime : q === "gametime" ? t.tick : q === "day" ? t.day : fail("Unknown or incomplete command, see below for error");
        return [`The time is ${v}`];
      }
      return fail("Unknown or incomplete command, see below for error");
    },
    complete: (_c, a) => (a.length <= 1 ? ["set", "add", "query"] : a[0] === "set" ? ["day", "noon", "night", "midnight"] : a[0] === "query" ? ["daytime", "gametime", "day"] : []),
  },
  {
    name: "weather",
    cheat: true,
    usage: ["/weather (clear|rain|thunder)"],
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
      return fail("Unknown or incomplete command, see below for error");
    },
    complete: () => ["clear", "rain", "thunder"],
  },
  {
    name: "tp",
    aliases: ["teleport"],
    cheat: true,
    usage: ["/tp <location>", "/tp <targets> <location>"],
    run: (ctx, a) => {
      const b = stripTarget(a);
      if (b.length < 3) return fail("Unknown or incomplete command, see below for error");
      const { x, y, z } = xyz(ctx, b, 0, true);
      ctx.player.teleport(x, y, z);
      return [`Teleported ${playerName} to ${fmtF(x)}, ${fmtF(y)}, ${fmtF(z)}`];
    },
  },
  {
    name: "setblock",
    cheat: true,
    usage: ["/setblock <pos> <block>"],
    run: (ctx, a) => {
      if (a.length < 4) return fail("Unknown or incomplete command, see below for error");
      const { x, y, z } = xyz(ctx, a, 0, false);
      const def = blockByName(id(a[3]));
      if (!def) return fail(`Unknown block type 'minecraft:${id(a[3])}'`);
      if (!ctx.world.setBlock(Math.floor(x), Math.floor(y), Math.floor(z), stateOf(def.id), SET_NOTIFY)) return fail("Could not set the block");
      return [`Changed the block at ${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}`];
    },
    complete: (_c, a) => (a.length === 4 ? BLOCKS.map((b) => b.name) : ["~"]),
  },
  {
    name: "fill",
    cheat: true,
    usage: ["/fill <from> <to> <block>"],
    run: (ctx, a) => {
      if (a.length < 7) return fail("Unknown or incomplete command, see below for error");
      const p = xyz(ctx, a, 0, false), q = xyz(ctx, a, 3, false);
      const def = blockByName(id(a[6]));
      if (!def) return fail(`Unknown block type 'minecraft:${id(a[6])}'`);
      const x0 = Math.floor(Math.min(p.x, q.x)), x1 = Math.floor(Math.max(p.x, q.x));
      const y0 = Math.floor(Math.min(p.y, q.y)), y1 = Math.floor(Math.max(p.y, q.y));
      const z0 = Math.floor(Math.min(p.z, q.z)), z1 = Math.floor(Math.max(p.z, q.z));
      const n = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
      if (n > 32768) return fail(`Too many blocks in the specified area (maximum 32768, specified ${n})`);
      let changed = 0;
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (ctx.world.setBlock(x, y, z, stateOf(def.id), SET_NOTIFY)) changed++;
      return changed ? [`Successfully filled ${changed} block(s)`] : fail("No blocks were filled");
    },
    complete: (_c, a) => (a.length === 7 ? BLOCKS.map((b) => b.name) : ["~"]),
  },
  {
    name: "give",
    cheat: true,
    usage: ["/give <targets> <item> [<count>]"],
    run: (ctx, a) => {
      const b = stripTarget(a);
      if (!b[0]) return fail("Unknown or incomplete command, see below for error");
      const name = id(b[0]);
      if (!hasItem(name)) return fail(`Unknown item 'minecraft:${name}'`);
      const count = b[1] === undefined ? 1 : int(b[1], "integer", 1);
      const max = itemDef(name)?.maxStack ?? 64;
      const display = itemDef(name)?.displayName ?? titleCase(name);
      if (count > max * 100) return fail(`Can't give more than ${max * 100} of [${display}]`);
      for (let left = count; left > 0; left -= max) giveStack(ctx, { item: name, count: Math.min(left, max) });
      return [`Gave ${count} [${display}] to ${playerName}`];
    },
    complete: (_c, a) => (a.length <= 1 ? ITEMS.map((i) => i.name) : []),
  },
  {
    name: "kill",
    cheat: true,
    usage: ["/kill [<targets>]"],
    run: (ctx, a) => {
      const sel = a[0];
      if (!sel || isSelf(sel) || sel === "@a" || sel === "@p") {
        killPlayer(ctx);
        return [`Killed ${playerName}`];
      }
      const m = /^@e(?:\[type=(!?)(?:minecraft:)?([a-z_]+)\])?$/.exec(sel);
      if (!m) return fail("No entity was found");
      const not = m[1] === "!";
      const type = m[2];
      let n = 0;
      const hit: { id: number; type: string }[] = [];
      for (const e of ctx.entities.all()) if (!e.dead && (!type || (not ? e.type !== type : e.type === type))) hit.push({ id: e.id, type: e.type });
      for (const e of hit) {
        ctx.entities.damage(e.id, 3.4e38, "generic");
        n++;
      }
      const includePlayer = !type || (not ? type !== "player" : type === "player");
      if (includePlayer) {
        killPlayer(ctx);
        n++;
      }
      if (!n) return fail("No entity was found");
      if (n > 1) return [`Killed ${n} entities`];
      return [`Killed ${includePlayer ? playerName : titleCase(hit[0].type)}`];
    },
  },
  {
    name: "difficulty",
    cheat: true,
    usage: ["/difficulty [peaceful|easy|normal|hard]"],
    run: (ctx, a) => {
      const cur = ctx.rules.difficulty;
      if (!a[0]) return [`The difficulty is ${titleCase(cur)}`];
      const d = DIFFS.find((x) => x === a[0].toLowerCase()) ?? DIFFS[Number(a[0])];
      if (!d) return fail(`Unknown difficulty: ${a[0]}`);
      if (d === cur) return fail(`The difficulty did not change; it is already set to ${titleCase(d)}`);
      ctx.rules.difficulty = d;
      return [`The difficulty has been set to ${titleCase(d)}`];
    },
    complete: () => DIFFS,
  },
  {
    name: "gamerule",
    cheat: true,
    usage: RULES.map((r) => `/gamerule ${r} [<value>]`),
    run: (ctx, a) => {
      const rule = RULES.find((r) => r === a[0]);
      if (!rule) return fail("Unknown or incomplete command, see below for error");
      if (a[1] === undefined) return [`Gamerule ${rule} is currently set to: ${ctx.rules[rule]}`];
      if (rule === "randomTickSpeed") ctx.rules.randomTickSpeed = int(a[1], "integer", 0);
      else ctx.rules[rule] = bool(a[1]);
      return [`Gamerule ${rule} is now set to: ${ctx.rules[rule]}`];
    },
    complete: (_c, a) => (a.length <= 1 ? [...RULES] : a[0] === "randomTickSpeed" ? ["3"] : ["true", "false"]),
  },
  {
    name: "summon",
    cheat: true,
    usage: ["/summon <entity> [<pos>]"],
    run: (ctx, a) => {
      if (!a[0]) return fail("Unknown or incomplete command, see below for error");
      const type = id(a[0]);
      const p = ctx.player.body.pos;
      const { x, y, z } = a.length >= 4 ? xyz(ctx, a, 1, true) : { x: p.x, y: p.y, z: p.z };
      const e = ctx.entities.spawn(type, x, y, z, summonData(a.slice(a.length >= 4 ? 4 : 1).join(" ")));
      if (!e) return fail(`Can't find element 'minecraft:${type}' of type 'minecraft:entity_type'`);
      return [`Summoned new ${titleCase(type)}`];
    },
  },
  {
    name: "setworldspawn",
    cheat: true,
    usage: ["/setworldspawn [<pos>] [<angle>]"],
    run: (ctx, a) => {
      const p = ctx.player.body.pos;
      const pos = a.length >= 3 ? xyz(ctx, a, 0, false) : { x: p.x, y: p.y, z: p.z };
      const s = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
      ctx.player.spawn = s;
      return [`Set the world spawn point to ${s.x}, ${s.y}, ${s.z} [${Number(a[3] ?? 0).toFixed(1)}]`];
    },
  },
  {
    name: "spawnpoint",
    cheat: true,
    usage: ["/spawnpoint [<targets>] [<pos>] [<angle>]"],
    run: (ctx, a) => {
      const b = stripTarget(a);
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
    run: (ctx, a) => {
      const sub = a[0];
      const b = stripTarget(a.slice(1));
      if (sub === "clear") {
        if (b[0]) {
          const e = id(b[0]);
          if (!EFFECTS[e]) return fail(`Can't find element 'minecraft:${e}' of type 'minecraft:mob_effect'`);
          const i = ctx.player.effects.findIndex((x) => x.id === e);
          if (i < 0) return fail("Target doesn't have the requested effect");
          ctx.player.effects.splice(i, 1);
          return [`Removed effect ${EFFECTS[e].name} from ${playerName}`];
        }
        if (!ctx.player.effects.length) return fail("Target has no effects to remove");
        ctx.player.effects.length = 0;
        return [`Removed every effect from ${playerName}`];
      }
      if (sub !== "give" || !b[0]) return fail("Unknown or incomplete command, see below for error");
      const e = id(b[0]);
      const info = EFFECTS[e];
      if (!info) return fail(`Can't find element 'minecraft:${e}' of type 'minecraft:mob_effect'`);
      const seconds = b[1] === undefined ? (info.instant ? 1 : 30) : b[1] === "infinite" ? -1 : int(b[1], "integer", 1, 1000000);
      const amp = b[2] === undefined ? 0 : int(b[2], "integer", 0, 255);
      if (b[3] !== undefined) bool(b[3]);
      if (e === "instant_health") ctx.player.heal(4 << Math.min(amp, 20));
      else if (e === "instant_damage") ctx.player.damage(6 << Math.min(amp, 20), "magic");
      else if (e === "saturation") {
        ctx.player.food = Math.min(20, ctx.player.food + amp + 1);
        ctx.player.saturation = Math.min(ctx.player.food, ctx.player.saturation + (amp + 1) * 2);
      } else if (!setEffect(ctx, { id: e, amplifier: amp, ticks: seconds < 0 ? 2147483647 : seconds * 20 })) {
        return fail("Unable to apply this effect (target is either immune to effects, or has something stronger)");
      }
      return [`Applied effect ${info.name} to ${playerName}`];
    },
    complete: (_c, a) => (a.length <= 1 ? ["give", "clear"] : a.length === 2 ? ["@s", ...Object.keys(EFFECTS)] : Object.keys(EFFECTS)),
  },
  {
    name: "enchant",
    cheat: true,
    usage: ["/enchant <targets> <enchantment> [<level>]"],
    run: (ctx, a) => {
      const b = stripTarget(a);
      if (!b[0]) return fail("Unknown or incomplete command, see below for error");
      const e = id(b[0]);
      const info = ENCHANTS[e];
      if (!info) return fail(`Can't find element 'minecraft:${e}' of type 'minecraft:enchantment'`);
      const level = b[1] === undefined ? 1 : int(b[1], "integer", 0);
      const held = ctx.inventory.held();
      if (!held) return fail(`${playerName} is not holding any item`);
      const name = itemDef(held.item)?.displayName ?? titleCase(held.item);
      if (level > info.max) return fail(`${level} is higher than the maximum level of ${info.max} supported by that enchantment`);
      const targets = enchantTargets(held.item);
      if (!info.targets.some((t) => targets.has(t))) return fail(`${name} cannot support that enchantment`);
      if (Object.keys(held.ench ?? {}).some((k) => enchantsConflict(k, e))) return fail(`${name} cannot support that enchantment`);
      ctx.inventory.setSlot(ctx.inventory.selected, { ...held, ench: { ...held.ench, [e]: level } });
      return [`Applied enchantment ${enchantName(e, level)} to ${playerName}'s item`];
    },
    complete: (_c, a) => (a.length <= 1 ? ["@s", ...Object.keys(ENCHANTS)] : Object.keys(ENCHANTS)),
  },
  {
    name: "xp",
    aliases: ["experience"],
    cheat: true,
    usage: ["/xp (add|query|set)"],
    run: (ctx, a) => {
      const sub = a[0];
      const b = stripTarget(a.slice(1));
      const pl = ctx.player;
      if (sub === "query") {
        if (b[0] === "levels") return [`${playerName} has ${pl.xpLevel} experience levels`];
        if (b[0] === "points") return [`${playerName} has ${Math.floor(pl.xpProgress * xpForLevel(pl.xpLevel))} experience points`];
        return fail("Unknown or incomplete command, see below for error");
      }
      const n = int(b[0]);
      const levels = b[1] === "levels" || b[1] === "l";
      if (b[1] !== undefined && !levels && b[1] !== "points") return fail("Unknown or incomplete command, see below for error");
      if (sub === "add") {
        if (levels) pl.xpLevel = Math.max(0, pl.xpLevel + n);
        else pl.addXp(n);
        return [`Gave ${n} experience ${levels ? "levels" : "points"} to ${playerName}`];
      }
      if (sub === "set") {
        if (n < 0) return fail(`Integer must not be less than 0, found ${n}`);
        if (levels) pl.xpLevel = n;
        else {
          const need = xpForLevel(pl.xpLevel);
          if (n > need) return fail("Unable to set experience points above the maximum points for the player's current level");
          pl.xpProgress = n / need;
        }
        return [`Set ${n} experience ${levels ? "levels" : "points"} on ${playerName}`];
      }
      return fail("Unknown or incomplete command, see below for error");
    },
    complete: (_c, a) => (a.length <= 1 ? ["add", "set", "query"] : a[0] === "query" ? ["levels", "points"] : []),
  },
  {
    name: "clear",
    cheat: true,
    usage: ["/clear [<targets>] [<item>] [<maxCount>]"],
    run: (ctx, a) => {
      const b = stripTarget(a);
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
    complete: (_c, a) => (a.length <= 1 ? ["@s"] : ITEMS.map((i) => i.name)),
  },
  {
    name: "locate",
    cheat: true,
    usage: ["/locate structure <structure>"],
    run: (ctx, a) => {
      if (a[0] !== "structure") return fail("Unknown or incomplete command, see below for error");
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
    complete: (_c, a) => (a.length <= 1 ? ["structure"] : STRUCTS.map((d) => d.name)),
  },
];

const find = (name: string) => COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
const allowed = (ctx: GameCtx) => COMMANDS.filter((c) => !c.cheat || ctx.rules.cheats);

const unknown = (line: string): Out => {
  const shown = line.length > 10 ? `...${line.slice(-10)}` : line;
  return ["§cUnknown or incomplete command, see below for error", `§7${shown}§c§o<--[HERE]`];
};

export function runCommand(ctx: GameCtx, line: string): string[] {
  const body = line.trim().replace(/^\//, "");
  const parts = body.split(/\s+/).filter(Boolean);
  const name = (parts[0] ?? "").toLowerCase().replace(/^minecraft:/, "");
  const cmd = find(name);
  if (!cmd || (cmd.cheat && !ctx.rules.cheats)) return unknown(body);
  try {
    return cmd.run(ctx, parts.slice(1));
  } catch (e) {
    if (e instanceof CmdError) return e.message.startsWith("Unknown or incomplete") ? unknown(body) : [`§c${e.message}`];
    return [`§cAn unexpected error occurred trying to execute that command`];
  }
}

export function completeCommand(ctx: GameCtx, line: string): string[] {
  if (!line.startsWith("/")) return [];
  const parts = line.slice(1).split(" ");
  const list = allowed(ctx);
  if (parts.length === 1) return list.flatMap((c) => [c.name, ...(c.aliases ?? [])]).filter((n) => n.startsWith(parts[0].toLowerCase())).sort().map((n) => `/${n}`);
  const cmd = find(parts[0].toLowerCase());
  if (!cmd || !list.includes(cmd) || !cmd.complete) return [];
  const args = parts.slice(1);
  const last = args[args.length - 1].toLowerCase();
  const head = `/${parts.slice(0, -1).join(" ")} `;
  return cmd
    .complete(ctx, args)
    .filter((o) => o.toLowerCase().startsWith(last))
    .slice(0, 200)
    .map((o) => head + o);
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
