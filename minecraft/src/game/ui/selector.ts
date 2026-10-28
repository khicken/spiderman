import type { Entity, GameCtx } from "../contracts";
import { allMobs, mobDef } from "../entities/registry";
import { titleCase } from "./data";

export type Target = Entity | "player";
type Fail = (m: string) => never;

export const SELECTORS = ["@a", "@e", "@n", "@p", "@r", "@s"];
export const SELECTOR_OPTIONS = ["distance", "dx", "dy", "dz", "gamemode", "level", "limit", "name", "sort", "tag", "team", "type", "x", "x_rotation", "y", "y_rotation", "z"];
const MISC = ["area_effect_cloud", "arrow", "egg", "ender_pearl", "experience_bottle", "experience_orb", "eye_of_ender", "falling_block", "fireball", "firework_rocket", "item", "potion", "small_fireball", "snowball", "spectral_arrow", "tnt", "trident", "wind_charge"];

export function entityTypes(): string[] {
  const out = new Set(MISC);
  for (const d of allMobs()) out.add(d.type);
  return [...out].sort();
}

// Vanilla id for our internal entity type names.
export const vanillaType = (t: string) => (t === "xp_orb" ? "experience_orb" : t);

export const targetName = (t: Target, player: string) => (t === "player" ? player : (t.data.name as string | undefined) ?? mobDef(t.type)?.displayName ?? titleCase(t.type));

export const looksLikeSelector = (s: string) => s.startsWith("@") || /^[A-Za-z0-9_]{1,16}$/.test(s) && !/^[-+]?\d/.test(s);

interface Range {
  lo: number;
  hi: number;
}

function range(s: string, fail: Fail, int: boolean): Range {
  const num = (v: string) => {
    if (v === "") return NaN;
    if (int ? !/^[-+]?\d+$/.test(v) : isNaN(Number(v))) return fail(int ? `Invalid integer '${v}'` : `Invalid double '${v}'`);
    return Number(v);
  };
  if (!s) return fail("Expected value or range of values");
  const [a, b] = s.includes("..") ? s.split("..") : [s, s];
  const lo = num(a), hi = num(b);
  if (isNaN(lo) && isNaN(hi)) return fail("Expected value or range of values");
  if (!isNaN(lo) && !isNaN(hi) && lo > hi) return fail("Min cannot be bigger than max");
  return { lo: isNaN(lo) ? -Infinity : lo, hi: isNaN(hi) ? Infinity : hi };
}

// Split "a=1,b=\"x,y\"" into pairs, keeping quoted commas.
function splitOptions(body: string, fail: Fail): [string, string][] {
  const out: [string, string][] = [];
  let i = 0;
  while (i < body.length) {
    while (body[i] === " ") i++;
    if (i >= body.length) break;
    let k = "";
    while (i < body.length && body[i] !== "=" && body[i] !== ",") k += body[i++];
    k = k.trim();
    if (body[i] !== "=") return fail(`Expected value for option '${k}'`);
    i++;
    while (body[i] === " ") i++;
    let v = "";
    if (body[i] === '"' || body[i] === "'") {
      const q = body[i++];
      while (i < body.length && body[i] !== q) v += body[i++] === "\\" ? body[i++] : body[i - 1];
      if (body[i] !== q) return fail("Unclosed quoted string");
      i++;
      while (body[i] === " ") i++;
    } else {
      while (i < body.length && body[i] !== ",") v += body[i++];
      v = v.trim();
    }
    out.push([k, v]);
    if (i < body.length && body[i] !== ",") return fail("Expected end of options");
    i++;
  }
  return out;
}

interface Pos {
  x: number;
  y: number;
  z: number;
}

/**
 * Vanilla EntitySelectorParser for one player plus world entities.
 * single: the argument takes one entity. players: the argument takes only players.
 */
export function selectTargets(ctx: GameCtx, s: string | undefined, player: string, fail: Fail, opts: { single?: boolean; players?: boolean } = {}): Target[] {
  if (s === undefined || s === "") return fail("Unknown or incomplete command, see below for error");
  const noneMsg = opts.players ? "No player was found" : "No entity was found";
  if (!s.startsWith("@")) {
    if (!/^[A-Za-z0-9_]{1,16}$/.test(s) && !/^[0-9a-f-]{36}$/i.test(s)) return fail("Invalid name or UUID");
    if (s.toLowerCase() === player.toLowerCase()) return ["player"];
    return fail(noneMsg);
  }
  const m = /^@([a-z]?)(?:\[([^]*)\])?$/.exec(s);
  if (!m) return fail(s.includes("[") ? "Expected end of options" : `Unknown selector type '${s}'`);
  const kind = m[1];
  if (!kind) return fail("Missing selector type");
  if (!"aenprs".includes(kind)) return fail(`Unknown selector type '@${kind}'`);
  const me = ctx.player.body.pos;
  const origin: Pos = { x: me.x, y: me.y, z: me.z };
  let limit = kind === "a" || kind === "e" ? Infinity : 1;
  let sort = kind === "p" || kind === "n" ? "nearest" : kind === "r" ? "random" : "arbitrary";
  let playersOnly = kind === "a" || kind === "p" || kind === "r" || kind === "s";
  const tests: ((t: Target, p: Pos) => boolean)[] = [];
  let dist: Range | null = null;
  let box: Pos | null = null;
  const seen = new Set<string>();
  for (const [k, raw] of splitOptions(m[2] ?? "", fail)) {
    const not = raw.startsWith("!");
    const v = not ? raw.slice(1) : raw;
    const repeatable = (k === "type" || k === "name" || k === "gamemode" || k === "team") && not || k === "tag";
    if (seen.has(k) && !repeatable) return fail(`Option '${k}' isn't applicable here`);
    seen.add(k);
    switch (k) {
      case "limit": {
        if (kind === "s" || kind === "n") return fail(`Option '${k}' isn't applicable here`);
        if (!/^[-+]?\d+$/.test(raw)) return fail(`Invalid integer '${raw}'`);
        limit = Number(raw);
        if (limit < 1) return fail("Limit must be at least 1");
        break;
      }
      case "sort": {
        if (kind === "s" || kind === "n") return fail(`Option '${k}' isn't applicable here`);
        if (!["nearest", "furthest", "random", "arbitrary"].includes(raw)) return fail(`Invalid or unknown sort type '${raw}'`);
        sort = raw;
        break;
      }
      case "type": {
        if (kind === "a" || kind === "p") return fail(`Option '${k}' isn't applicable here`);
        const t = v.replace(/^minecraft:/, "");
        const internal = t === "experience_orb" ? "xp_orb" : t;
        if (t !== "player" && !entityTypes().includes(t)) return fail(`Invalid or unknown entity type '${v}'`);
        if (kind !== "s") playersOnly = !not && t === "player";
        tests.push((e) => ((e === "player" ? "player" : e.type) === internal) !== not);
        break;
      }
      case "name":
        tests.push((e) => (e === "player" ? player : (e.data.name as string | undefined)) === v !== not);
        break;
      case "tag":
        tests.push((e) => {
          const tags = e === "player" ? [] : ((e.data.tags as string[] | undefined) ?? []);
          return (v === "" ? tags.length === 0 : tags.includes(v)) !== not;
        });
        break;
      case "team":
        tests.push(() => (v === "") !== not);
        break;
      case "gamemode": {
        if (!["survival", "creative", "adventure", "spectator"].includes(v)) return fail(`Invalid or unknown game mode '${v}'`);
        tests.push((e) => (e === "player" && ctx.player.gameMode === v) !== not);
        break;
      }
      case "level": {
        const r = range(raw, fail, true);
        if (r.lo < 0) return fail("Level shouldn't be negative");
        tests.push((e) => e === "player" && ctx.player.xpLevel >= r.lo && ctx.player.xpLevel <= r.hi);
        break;
      }
      case "distance": {
        dist = range(raw, fail, false);
        if (dist.lo < 0) return fail("Distance cannot be negative");
        break;
      }
      case "x_rotation":
      case "y_rotation": {
        const r = range(raw, fail, false);
        tests.push((e) => {
          const rad = e === "player" ? (k === "x_rotation" ? ctx.player.pitch : ctx.player.yaw) : k === "x_rotation" ? e.pitch : e.yaw;
          let d = (rad * 180) / Math.PI;
          if (k === "x_rotation") d = -d;
          d = ((d % 360) + 540) % 360 - 180;
          return d >= r.lo && d <= r.hi;
        });
        break;
      }
      case "x":
      case "y":
      case "z":
      case "dx":
      case "dy":
      case "dz": {
        if (isNaN(Number(raw)) || raw === "") return fail(`Invalid double '${raw}'`);
        if (k.length === 1) origin[k as "x"] = Number(raw);
        else (box ??= { x: 0, y: 0, z: 0 })[k[1] as "x"] = Number(raw);
        break;
      }
      default:
        return fail(`Unknown option '${k}'`);
    }
  }
  if (opts.single && limit > 1) return fail(opts.players ? "Only one player is allowed, but the provided selector allows more than one" : "Only one entity is allowed, but the provided selector allows more than one");
  if (opts.players && !playersOnly) return fail("Only players may be affected by this command, but the provided selector includes entities");
  if (kind === "s") {
    return tests.every((f) => f("player", me)) ? ["player"] : fail(noneMsg);
  }
  const cands: { t: Target; d: number }[] = [];
  const b = box as Pos | null;
  const consider = (t: Target, p: Pos, w: number, h: number) => {
    const d = Math.hypot(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    if (dist && (d < dist.lo || d > dist.hi)) return;
    if (b) {
      const x0 = Math.min(origin.x, origin.x + b.x), x1 = Math.max(origin.x, origin.x + b.x) + 1;
      const y0 = Math.min(origin.y, origin.y + b.y), y1 = Math.max(origin.y, origin.y + b.y) + 1;
      const z0 = Math.min(origin.z, origin.z + b.z), z1 = Math.max(origin.z, origin.z + b.z) + 1;
      if (p.x + w / 2 < x0 || p.x - w / 2 > x1 || p.y + h < y0 || p.y > y1 || p.z + w / 2 < z0 || p.z - w / 2 > z1) return;
    }
    if (tests.every((f) => f(t, p))) cands.push({ t, d });
  };
  if (!ctx.player.dead || kind === "a") consider("player", me, ctx.player.body.width, ctx.player.body.height);
  if (!playersOnly) for (const e of ctx.entities.all()) if (!e.dead && !e.data._remove) consider(e, e.body.pos, e.body.width, e.body.height);
  if (sort === "nearest") cands.sort((p, q) => p.d - q.d);
  else if (sort === "furthest") cands.sort((p, q) => q.d - p.d);
  else if (sort === "random") {
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random() * (i + 1));
      [cands[i], cands[j]] = [cands[j], cands[i]];
    }
  }
  const out = cands.slice(0, limit).map((c) => c.t);
  return out.length ? out : fail(noneMsg);
}
