import type { GameCtx } from "../contracts";
import { ITEMS } from "../items/registry";
import { BLOCKS } from "../blocks/registry";
import { STRUCTS } from "../worldgen/structure-grid";
import { BIOMES } from "../worldgen/biomes";
import { EFFECTS, ENCHANTS } from "./data";
import { advancementComplete } from "../systems/advancements/command";
import { GAMERULES, RULE_NAMES } from "./gamerules";
import { SELECTORS, SELECTOR_OPTIONS, entityTypes, looksLikeSelector } from "./selector";
import { INTERNAL, blockStateProps } from "./block-states";

export interface Tok {
  text: string;
  start: number;
}

// Split on spaces outside [], {} and quotes, so "@e[type=cow, limit=1]" stays one argument.
export function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === " ") {
      i++;
      continue;
    }
    const start = i;
    let depth = 0;
    let q = "";
    for (; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === "\\") i++;
        else if (c === q) q = "";
      } else if (c === '"' || c === "'") q = c;
      else if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") depth--;
      else if (c === " " && depth <= 0) break;
    }
    out.push({ text: s.slice(start, i), start });
  }
  return out;
}

// Brigadier SharedSuggestionProvider.matchesSubStr: match at the start or after any "_".
export function matchesSubStr(input: string, s: string): boolean {
  let i = 0;
  while (!s.startsWith(input, i)) {
    const j = s.indexOf("_", i);
    if (j < 0) return false;
    i = j + 1;
  }
  return true;
}

function matchesResource(input: string, id: string): boolean {
  if (input.includes(":")) return matchesSubStr(input, id);
  const path = id.replace(/^minecraft:/, "");
  return matchesSubStr(input, "minecraft") || matchesSubStr(input, path);
}

type Kind = "lit" | "sub" | "res";
interface ArgType {
  n?: number; // tokens taken, 3 for a position
  rest?: boolean; // takes the rest of the line
  accept?: (s: string) => boolean;
  kind?: Kind;
  suggest?: (ctx: GameCtx, sub: number, prev: string[], partial: string) => string[];
}

const res = (names: Iterable<string>) => [...names].map((n) => `minecraft:${n}`);
const isCoord = (s: string) => /^[~^]?[-+]?(\d+\.?\d*|\.\d+)?$/.test(s);
const POS: ArgType = { n: 3, accept: isCoord, suggest: (_c, sub) => [["~ ~ ~", "~ ~", "~"][sub]] };
const NONE: ArgType = {};

let playerName = "Player";
export const setSyntaxPlayer = (n: string) => {
  playerName = n;
};

function selectorSuggest(_ctx: GameCtx, _sub: number, _prev: string[], partial: string): string[] {
  const open = partial.indexOf("[");
  if (open < 0) return [...SELECTORS, playerName];
  const cut = Math.max(partial.lastIndexOf(","), open) + 1;
  const pad = /^\s*/.exec(partial.slice(cut))![0].length;
  const head = partial.slice(0, cut + pad);
  const seg = partial.slice(cut + pad);
  const eq = seg.indexOf("=");
  if (eq < 0) return SELECTOR_OPTIONS.map((o) => `${head}${o}=`);
  const key = seg.slice(0, eq);
  const pre = `${head}${key}=`;
  const vals = key === "type" ? ["player", ...entityTypes()].flatMap((t) => [`minecraft:${t}`, `!minecraft:${t}`]) : key === "sort" ? ["arbitrary", "furthest", "nearest", "random"] : key === "gamemode" ? ["adventure", "creative", "spectator", "survival"].flatMap((g) => [g, `!${g}`]) : [];
  return vals.map((v) => pre + v);
}

const TARGETS: ArgType = { accept: (s) => looksLikeSelector(s), suggest: selectorSuggest, kind: "sub" };
const bool: ArgType = { suggest: () => ["false", "true"], kind: "lit" };
const resource = (list: () => string[]): ArgType => ({ kind: "res", suggest: () => list() });

function blockSuggest(_c: GameCtx, _s: number, _p: string[], partial: string): string[] {
  const open = partial.indexOf("[");
  if (open < 0) return res(BLOCKS.filter((b) => !INTERNAL.test(b.name)).map((b) => b.name));
  const props = blockStateProps(partial.slice(0, open));
  const cut = Math.max(partial.lastIndexOf(","), open) + 1;
  const head = partial.slice(0, cut);
  const seg = partial.slice(cut);
  const eq = seg.indexOf("=");
  if (eq < 0) return Object.keys(props).map((k) => `${head}${k}=`);
  const key = seg.slice(0, eq);
  const out = (props[key] ?? []).map((v) => `${head}${key}=${v}`);
  if (props[key]?.includes(seg.slice(eq + 1))) out.push(`${partial},`, `${partial}]`);
  return out;
}

const BLOCK: ArgType = { suggest: blockSuggest, kind: "res" };

const ARGS: Record<string, ArgType> = {
  targets: TARGETS,
  target: TARGETS,
  destination: TARGETS,
  vehicle: TARGETS,
  pos: POS,
  location: POS,
  from: POS,
  to: POS,
  item: resource(() => res(ITEMS.map((i) => i.name))),
  block: BLOCK,
  filter: BLOCK,
  effect: resource(() => res(Object.keys(EFFECTS))),
  enchantment: resource(() => res(Object.keys(ENCHANTS))),
  entity: resource(() => res(entityTypes())),
  structure: resource(() => res(STRUCTS.map((s) => s.name))),
  biome: resource(() => res(BIOMES.map((b) => b.name))),
  advancement: { kind: "res", suggest: (_c, _s, prev) => res(advancementComplete([...prev.slice(1), ""])) },
  gamemode: { suggest: () => ["adventure", "creative", "spectator", "survival"], kind: "lit" },
  rule: { suggest: () => RULE_NAMES, kind: "lit" },
  value: { suggest: (_c, _s, prev) => (typeof GAMERULES[prev[prev.length - 1]] === "boolean" ? ["false", "true"] : []), kind: "lit" },
  hideParticles: bool,
  action: { rest: true },
  message: { rest: true },
  nbt: { rest: true },
};

interface Item {
  lits?: string[];
  arg?: ArgType;
  text: string; // usage text
}

const cache = new Map<string, Item[]>();
function compile(line: string): Item[] {
  let c = cache.get(line);
  if (c) return c;
  c = line.split(" ").map((t) => {
    const m = /^\[?<(\w+)>\]?$/.exec(t);
    if (m) return { arg: ARGS[m[1]] ?? NONE, text: t };
    const lits = t.replace(/^[[(]|[\])]$/g, "").split("|");
    return { lits, text: t };
  });
  cache.set(line, c);
  return c;
}

export interface Suggestion {
  start: number; // index in the line where the current argument starts
  list: string[]; // replacements for line.slice(start)
  usage: string[]; // gray usage text for the next arguments
}

/** Vanilla CommandSuggestions for "/name args": matches each syntax line against the typed tokens. */
export function suggestArgs(ctx: GameCtx, syntax: string[], line: string, offset: number): Suggestion {
  const toks = tokenize(line);
  const last = toks[toks.length - 1];
  const trailing = !last || last.start + last.text.length < line.length;
  const done = trailing ? toks : toks.slice(0, -1);
  const partial = trailing ? "" : toks[toks.length - 1].text;
  const start = offset + (trailing ? line.length : toks[toks.length - 1].start);
  const found = new Map<string, Kind>();
  const usage = new Set<string>();
  const prev = done.map((t) => t.text);
  for (const s of syntax) {
    const items = compile(s);
    let p = 0, sub = 0, ok = true, rest = false;
    for (const t of prev) {
      if (p >= items.length) {
        ok = false;
        break;
      }
      const it = items[p];
      if (it.lits) {
        if (!it.lits.includes(t.toLowerCase())) {
          ok = false;
          break;
        }
        p++;
        continue;
      }
      const a = it.arg!;
      if (a.rest) {
        rest = true;
        break;
      }
      if (a.accept && !a.accept(t)) {
        ok = false;
        break;
      }
      if (++sub >= (a.n ?? 1)) {
        p++;
        sub = 0;
      }
    }
    if (!ok || rest || p >= items.length) continue;
    const it = items[p];
    if (it.lits) {
      for (const l of it.lits) found.set(l, "lit");
      continue;
    }
    const a = it.arg!;
    for (const l of a.suggest?.(ctx, sub, prev, partial) ?? []) found.set(l, a.kind ?? "sub");
    usage.add(items.slice(p).map((i) => i.text).join(" "));
  }
  const low = partial.toLowerCase();
  let list = [...found]
    .filter(([v, k]) => (k === "lit" ? v.startsWith(low) : k === "res" ? matchesResource(low, v) : matchesSubStr(low, v.toLowerCase())))
    .map(([v]) => v)
    .sort((x, y) => x.localeCompare(y));
  // Brigadier suggests from the start of the current option or property, not the whole argument.
  let cut = Math.max(partial.lastIndexOf("["), partial.lastIndexOf(","), partial.lastIndexOf("=")) + 1;
  while (cut > 0 && partial[cut] === " ") cut++;
  const head = partial.slice(0, cut);
  if (cut > 0 && list.every((v) => v.startsWith(head))) list = list.map((v) => v.slice(cut));
  else cut = 0;
  return { start: start + cut, list, usage: list.length ? [] : [...usage] };
}
