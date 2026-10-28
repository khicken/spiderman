// Reads a pack's bitmap font: font/default.json providers (with references), else ascii.png in the vanilla grid.
import type { Img } from "./img";
import { packFontDocs, packImage } from "./index";

// Rows of glyph pixels; y is the first row relative to our row 0 (7 rows above the baseline).
export interface PackGlyph {
  width: number;
  rows: Uint8Array;
  h: number;
  y: number;
}

interface Provider {
  type?: string;
  file?: string;
  id?: string;
  height?: number;
  ascent?: number;
  chars?: string[];
  advances?: Record<string, number>;
  filter?: Record<string, boolean>;
}

// ascii.png rows 2-15 in vanilla order (code page 437 with a few swaps), used when no font JSON is in the stack.
const ASCII_ROWS = [
  " !\"#$%&'()*+,-./", "0123456789:;<=>?", "@ABCDEFGHIJKLMNO", "PQRSTUVWXYZ[\\]^_", "`abcdefghijklmno", "pqrstuvwxyz{|}~",
  "ÇüéâäàåçêëèïîìÄÅ", "ÉæÆôöòûùÿÖÜø£Ø×ƒ", "áíóúñÑªº¿®¬½¼¡«»", "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐", "└┴┬├─┼╞╟╚╔╩╦╠═╬╧", "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀",
  "αβΓπΣσμτΦΘΩδ∞∅∈∩", "≡±≥≤⌠⌡÷≈°∙·√ⁿ²■",
];
const DEFAULT: Provider[] = [{ type: "bitmap", file: "minecraft:font/ascii.png", ascent: 7, chars: ["", "", ...ASCII_ROWS] }];

const loc = (id: string) => id.replace(/^minecraft:/, "");

function bitmap(p: Provider, out: Map<string, PackGlyph>): void {
  const img: Img | null = p.file ? packImage(loc(p.file).replace(/\.png$/, "")) : null;
  const chars = (p.chars ?? []).map((r) => Array.from(r));
  if (!img || !chars.length || typeof p.ascent !== "number") return;
  const cols = Math.max(...chars.map((r) => r.length));
  const cw = img.w / cols, ch = img.h / chars.length;
  const h = Math.max(1, Math.round(p.height ?? 8)), k = ch / h;
  const ink = (x: number, y: number) => img.data[(Math.floor(y) * img.w + Math.floor(x)) * 4 + 3] > 127;
  chars.forEach((row, ry) =>
    row.forEach((c, rx) => {
      if (c === "\u0000" || c === " " || out.has(c)) return;
      const ox = rx * cw, oy = ry * ch;
      let last = -1;
      for (let x = 0; x < cw; x++) for (let y = 0; y < ch; y++) if (ink(ox + x, oy + y)) last = Math.max(last, x);
      if (last < 0) return;
      const width = Math.max(1, Math.floor(0.5 + (last + 1) / k));
      const rows = new Uint8Array(h * width);
      for (let gy = 0; gy < h; gy++)
        for (let gx = 0; gx < width; gx++) if (ink(ox + gx * k + k / 2, oy + gy * k + k / 2)) rows[gy * width + gx] = 1;
      out.set(c, { width, rows, h, y: 7 - p.ascent! });
    }),
  );
}

function walk(providers: Provider[], out: Map<string, PackGlyph>, depth: number): void {
  for (const p of providers) {
    if (!p || typeof p !== "object" || p.filter?.jp || p.filter?.uniform) continue;
    if (p.type === "bitmap") bitmap(p, out);
    else if (p.type === "reference" && p.id && depth < 4) for (const d of packFontDocs(`font/${loc(p.id)}.json`)) walk(providersOf(d), out, depth + 1);
    else if (p.type === "space")
      for (const [c, adv] of Object.entries(p.advances ?? {}))
        if (!out.has(c) && typeof adv === "number" && adv >= 1) out.set(c, { width: adv - 1, rows: new Uint8Array(0), h: 0, y: 0 });
  }
}

const providersOf = (d: unknown): Provider[] => {
  const list = (d as { providers?: unknown } | null)?.providers;
  return Array.isArray(list) ? (list as Provider[]) : [];
};

// First provider to define a character wins, matching vanilla; null when the stack has no font art.
export function packGlyphs(): Map<string, PackGlyph> | null {
  const out = new Map<string, PackGlyph>();
  const docs = packFontDocs("font/default.json");
  if (docs.length) for (const d of docs) walk(providersOf(d), out, 0);
  walk(DEFAULT, out, 0);
  return out.size ? out : null;
}
