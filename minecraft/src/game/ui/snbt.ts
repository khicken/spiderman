import { DYES } from "../items/data-misc";

export type Nbt = number | string | boolean | Nbt[] | { [k: string]: Nbt };

// Vanilla TagParser: compounds, lists, typed arrays, quoted or bare strings, numbers with b/s/l/f/d suffixes.
export function parseSnbt(src: string): Nbt {
  let i = 0;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const fail = (msg: string): never => {
    throw new Error(`${msg} at position ${i}`);
  };
  const expect = (c: string) => {
    ws();
    if (src[i] !== c) fail(`Expected '${c}'`);
    i++;
  };
  const quoted = (): string => {
    const q = src[i++];
    let s = "";
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") i++;
      s += src[i++];
    }
    if (src[i] !== q) fail("Unterminated string");
    i++;
    return s;
  };
  const bare = (colon = false): string => {
    const start = i;
    while (i < src.length && (/[0-9A-Za-z_\-.+]/.test(src[i]) || (colon && src[i] === ":"))) i++;
    if (i === start) fail("Expected value");
    return src.slice(start, i);
  };
  const key = (): string => {
    ws();
    return src[i] === '"' || src[i] === "'" ? quoted() : bare();
  };
  const scalar = (s: string): Nbt => {
    if (/^true$/i.test(s)) return true;
    if (/^false$/i.test(s)) return false;
    const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([bslfd]?)$/i.exec(s);
    return m ? Number(m[1]) : s;
  };
  const value = (): Nbt => {
    ws();
    const c = src[i];
    if (c === "{") {
      i++;
      const out: { [k: string]: Nbt } = {};
      ws();
      if (src[i] === "}") return i++, out;
      for (;;) {
        const k = key();
        expect(":");
        out[k] = value();
        ws();
        if (src[i] === ",") {
          i++;
          continue;
        }
        expect("}");
        return out;
      }
    }
    if (c === "[") {
      i++;
      ws();
      if (/^[BIL];/.test(src.slice(i, i + 2))) i += 2;
      const out: Nbt[] = [];
      ws();
      if (src[i] === "]") return i++, out;
      for (;;) {
        out.push(value());
        ws();
        if (src[i] === ",") {
          i++;
          continue;
        }
        expect("]");
        return out;
      }
    }
    if (c === '"' || c === "'") return quoted();
    return scalar(bare(true));
  };
  const v = value();
  ws();
  if (i < src.length) fail("Unexpected trailing data");
  return v;
}

const bool = (v: Nbt | undefined) => v === true || (typeof v === "number" && v !== 0);
const strip = (v: Nbt | undefined) => (typeof v === "string" ? v.replace(/^minecraft:/, "") : undefined);
const itemId = (v: Nbt | undefined) => (v && typeof v === "object" && !Array.isArray(v) ? strip(v.id) : undefined);
const stack = (v: Nbt | undefined) => {
  const id = itemId(v);
  if (!id || id === "air") return null;
  const c = (v as { count?: Nbt; Count?: Nbt }).count ?? (v as { Count?: Nbt }).Count;
  return { item: id, count: typeof c === "number" && c > 0 ? c : 1 };
};

// Vanilla variant ids stored as ints.
const INT_VARIANTS: Record<string, string[]> = {
  llama: ["creamy", "white", "brown", "gray"],
  trader_llama: ["creamy", "white", "brown", "gray"],
  parrot: ["red_blue", "blue", "green", "yellow_blue", "gray"],
  axolotl: ["lucy", "wild", "gold", "cyan", "blue"],
};
const HORSE_COLORS = ["white", "creamy", "chestnut", "brown", "black", "gray", "dark_brown"];
const HORSE_MARKINGS = ["none", "white", "white_field", "white_dots", "black_dots"];
const RABBITS: Record<number, string> = { 0: "brown", 1: "white", 2: "black", 3: "white_splotched", 4: "gold", 5: "salt", 99: "evil" };
const ARMOR_SLOTS = ["feet", "legs", "chest", "head"] as const;

function textOf(v: Nbt | undefined): string | undefined {
  if (typeof v !== "string") return undefined;
  try {
    const j = JSON.parse(v) as unknown;
    if (typeof j === "string") return j;
    if (j && typeof j === "object" && typeof (j as { text?: unknown }).text === "string") return (j as { text: string }).text;
  } catch {}
  return v;
}

// Maps vanilla entity NBT to our entity data. Unknown PascalCase keys are ignored; lowercase keys pass through.
export function nbtToData(type: string, tag: { [k: string]: Nbt }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(tag)) {
    switch (k) {
      case "Tame":
        if (!bool(v)) break;
        out[type === "llama" || type === "trader_llama" ? "tamed" : "tame"] = true;
        out.owner = "player";
        out.persistent = true;
        break;
      case "Owner":
        out.owner = "player";
        out.persistent = true;
        break;
      case "Sitting":
        out.sitting = bool(v);
        break;
      case "Saddle":
        if (bool(v)) out.saddle = true;
        break;
      case "SaddleItem":
        if (itemId(v) === "saddle") out.saddle = true;
        break;
      case "ArmorItem":
      case "body_armor_item": {
        const id = itemId(v);
        if (id) out.armor = id;
        break;
      }
      case "ChestedHorse":
        out.chest = bool(v);
        break;
      case "DecorItem": {
        const id = itemId(v);
        if (id?.endsWith("_carpet")) out.decor = id.slice(0, -"_carpet".length);
        break;
      }
      case "CustomName":
        out.name = textOf(v);
        break;
      case "NoAI":
        if (bool(v)) out.noAI = true;
        break;
      case "Silent":
        if (bool(v)) out.silent = true;
        break;
      case "Invulnerable":
        if (bool(v)) out.invulnerable = true;
        break;
      case "PersistenceRequired":
        if (bool(v)) out.persistent = true;
        break;
      case "NoGravity":
        if (bool(v)) out.noGravity = true;
        break;
      case "Age":
        if (typeof v === "number" && v < 0) out.grow = v;
        break;
      case "IsBaby":
        out.baby = bool(v);
        break;
      case "Health":
        if (typeof v === "number") out.health = v;
        break;
      case "HandItems":
        if (Array.isArray(v)) out.held = itemId(v[0]) ?? "";
        break;
      case "ArmorItems":
        if (Array.isArray(v)) out.equipment = Object.fromEntries(ARMOR_SLOTS.map((s, n) => [s, stack(v[n])]).filter(([, s]) => s));
        break;
      case "equipment":
        if (v && typeof v === "object" && !Array.isArray(v)) {
          if (v.mainhand) out.held = itemId(v.mainhand) ?? "";
          const eq = Object.fromEntries(ARMOR_SLOTS.map((s) => [s, stack(v[s])]).filter(([, s]) => s));
          if (Object.keys(eq).length) out.equipment = eq;
          if (v.body) out.armor = itemId(v.body);
        }
        break;
      case "Variant":
      case "variant":
        if (typeof v === "number") {
          if (type === "horse") {
            out.variant = HORSE_COLORS[(v & 0xff) % 7];
            out.markings = HORSE_MARKINGS[((v >> 8) & 0xff) % 5];
          } else if (INT_VARIANTS[type]) out.variant = INT_VARIANTS[type][v] ?? INT_VARIANTS[type][0];
        } else out.variant = strip(v);
        break;
      case "Type":
        if (typeof v === "string") out.variant = strip(v);
        break;
      case "RabbitType":
        if (typeof v === "number" && RABBITS[v]) out.variant = RABBITS[v];
        break;
      case "Color":
        if (typeof v === "number" && DYES[v]) out.color = DYES[v];
        break;
      case "CollarColor":
        if (typeof v === "number" && DYES[v]) out.collar = DYES[v];
        break;
      case "Sheared":
        out.sheared = bool(v);
        break;
      case "powered":
        out.powered = bool(v);
        break;
      case "Fuse":
        if (typeof v === "number") out.fuse = v;
        break;
      case "Motion":
        if (Array.isArray(v)) out.motion = v;
        break;
      case "Item": {
        const s = stack(v);
        if (s) out.stack = s;
        break;
      }
      case "VillagerData":
        if (v && typeof v === "object" && !Array.isArray(v)) {
          if (v.profession !== undefined) out.profession = strip(v.profession);
          if (typeof v.level === "number") out.level = v.level;
          if (v.type !== undefined) out.villagerType = strip(v.type);
        }
        break;
      default:
        if (/^[a-z]/.test(k)) out[k] = typeof v === "string" ? strip(v) : v;
    }
  }
  return out;
}
