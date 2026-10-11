// Vanilla-like bitmap font: 8 rows per glyph (rows 0-6 above the baseline, row 7 descender), advance = width + 1.

const G: Record<string, string[]> = {
  "!": ["#", "#", "#", "#", "#", "", "#"],
  '"': ["#.#", "#.#"],
  "#": [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
  $: ["..#..", ".####", "#....", ".###.", "....#", "####.", "..#.."],
  "%": ["#...#", "#..#.", "...#.", "..#..", ".#...", ".#..#", "#...#"],
  "&": ["..#..", ".#.#.", "..#..", ".##.#", "#..#.", "#..#.", ".##.#"],
  "'": ["#", "#"],
  "(": ["..##", ".#..", "#...", "#...", "#...", ".#..", "..##"],
  "*": ["", "", "#..#", ".##.", "#..#"],
  "+": ["", "..#..", "..#..", "#####", "..#..", "..#.."],
  ",": ["", "", "", "", "", "#", "#", "#"],
  "-": ["", "", "", "#####"],
  ".": ["", "", "", "", "", "", "#"],
  "/": ["....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", "#####"],
  "2": [".###.", "#...#", "....#", "..##.", ".#...", "#...#", "#####"],
  "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  "4": ["...##", "..#.#", ".#..#", "#...#", "#####", "....#", "....#"],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "#...#", "....#", "...#.", "..#..", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  ":": ["", "#", "#", "", "", "#", "#"],
  ";": ["", "#", "#", "", "", "#", "#", "#"],
  "<": ["...#", "..#.", ".#..", "#...", ".#..", "..#.", "...#"],
  "=": ["", "", "#####", "", "", "#####"],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", "", "..#.."],
  "@": [".####.", "#....#", "#.##.#", "#.##.#", "#.####", "#.....", ".####."],
  A: [".###.", "#...#", "#####", "#...#", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "####.", "#...#", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "###..", "#....", "#....", "#....", "#####"],
  F: ["#####", "#....", "###..", "#....", "#....", "#....", "#...."],
  G: [".####", "#....", "#..##", "#...#", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#####", "#...#", "#...#", "#...#", "#...#"],
  I: ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
  J: ["....#", "....#", "....#", "....#", "....#", "#...#", ".###."],
  K: ["#...#", "#..#.", "###..", "#..#.", "#...#", "#...#", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "####.", "#....", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#...#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "####.", "#...#", "#...#", "#...#", "#...#"],
  S: [".####", "#....", ".###.", "....#", "....#", "#...#", ".###."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", ".#.#.", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#", "#...#"],
  Y: ["#...#", ".#.#.", "..#..", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "[": ["###", "#..", "#..", "#..", "#..", "#..", "###"],
  "^": ["..#..", ".#.#.", "#...#"],
  _: ["", "", "", "", "", "", "", "#####"],
  "`": ["#.", ".#"],
  a: ["", "", ".###.", "....#", ".####", "#...#", ".####"],
  b: ["#....", "#....", "#.##.", "##..#", "#...#", "#...#", "####."],
  c: ["", "", ".###.", "#...#", "#....", "#...#", ".###."],
  d: ["....#", "....#", ".##.#", "#..##", "#...#", "#...#", ".####"],
  e: ["", "", ".###.", "#...#", "#####", "#....", ".####"],
  f: ["..##", ".#..", "####", ".#..", ".#..", ".#..", ".#.."],
  g: ["", "", ".####", "#...#", "#...#", ".####", "....#", "####."],
  h: ["#....", "#....", "#.##.", "##..#", "#...#", "#...#", "#...#"],
  i: ["#", "", "#", "#", "#", "#", "#"],
  j: ["....#", "", "....#", "....#", "....#", "#...#", "#...#", ".###."],
  k: ["#...", "#...", "#..#", "#.#.", "##..", "#.#.", "#..#"],
  l: ["#.", "#.", "#.", "#.", "#.", "#.", ".#"],
  m: ["", "", "##.#.", "#.#.#", "#.#.#", "#...#", "#...#"],
  n: ["", "", "####.", "#...#", "#...#", "#...#", "#...#"],
  o: ["", "", ".###.", "#...#", "#...#", "#...#", ".###."],
  p: ["", "", "#.##.", "##..#", "#...#", "####.", "#....", "#...."],
  q: ["", "", ".##.#", "#..##", "#...#", ".####", "....#", "....#"],
  r: ["", "", "#.##.", "##..#", "#....", "#....", "#...."],
  s: ["", "", ".####", "#....", ".###.", "....#", "####."],
  t: [".#.", ".#.", "###", ".#.", ".#.", ".#.", "..#"],
  u: ["", "", "#...#", "#...#", "#...#", "#...#", ".####"],
  v: ["", "", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  w: ["", "", "#...#", "#...#", "#.#.#", "#.#.#", ".####"],
  x: ["", "", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  y: ["", "", "#...#", "#...#", "#...#", ".####", "....#", "####."],
  z: ["", "", "#####", "...#.", "..#..", ".#...", "#####"],
  "{": ["..##", ".#..", ".#..", "#...", ".#..", ".#..", "..##"],
  "|": ["#", "#", "#", "#", "#", "#", "#", "#"],
  "~": [".##..#", "#..##."],
};

const mirror = (rows: string[]) => rows.map((r) => r.split("").reverse().join(""));
G[")"] = mirror(G["("]);
G[">"] = mirror(G["<"]);
G["\\"] = mirror(G["/"]);
G["]"] = mirror(G["["]);
G["}"] = mirror(G["{"]);

export const GLYPH_ROWS = 8;
export const LINE_HEIGHT = 9;

export interface Glyph {
  width: number;
  rows: Uint8Array; // GLYPH_ROWS * width, 1 = ink
}

export const GLYPHS: Record<string, Glyph> = {};
for (const [ch, src] of Object.entries(G)) {
  const width = Math.max(1, ...src.map((r) => r.length));
  const rows = new Uint8Array(GLYPH_ROWS * width);
  src.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) if (r[x] === "#") rows[y * width + x] = 1;
  });
  GLYPHS[ch] = { width, rows };
}
GLYPHS[" "] = { width: 3, rows: new Uint8Array(GLYPH_ROWS * 3) };

export const glyphOf = (ch: string): Glyph => GLYPHS[ch] ?? GLYPHS["?"];


export const COLOR_CODES: Record<string, number> = {
  "0": 0x000000, "1": 0x0000aa, "2": 0x00aa00, "3": 0x00aaaa, "4": 0xaa0000, "5": 0xaa00aa, "6": 0xffaa00, "7": 0xaaaaaa,
  "8": 0x555555, "9": 0x5555ff, a: 0x55ff55, b: 0x55ffff, c: 0xff5555, d: 0xff55ff, e: 0xffff55, f: 0xffffff,
};
const FORMAT_CODES = "klmnor";

export const shadowOf = (c: number) => (c & 0xfcfcfc) >> 2;

export interface Run {
  text: string;
  color: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  obfuscated: boolean;
}

export function parseRuns(text: string, color = 0xffffff, amp = false): Run[] {
  const runs: Run[] = [];
  let cur: Run = { text: "", color, bold: false, italic: false, underline: false, strike: false, obfuscated: false };
  const flush = () => {
    if (cur.text) runs.push(cur);
    cur = { ...cur, text: "" };
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = text[i + 1]?.toLowerCase();
    if ((ch === "§" || (amp && ch === "&")) && code && (code in COLOR_CODES || FORMAT_CODES.includes(code))) {
      flush();
      i++;
      if (code in COLOR_CODES) cur = { ...cur, color: COLOR_CODES[code], bold: false, italic: false, underline: false, strike: false, obfuscated: false };
      else if (code === "r") cur = { ...cur, color, bold: false, italic: false, underline: false, strike: false, obfuscated: false };
      else if (code === "l") cur.bold = true;
      else if (code === "o") cur.italic = true;
      else if (code === "n") cur.underline = true;
      else if (code === "m") cur.strike = true;
      else if (code === "k") cur.obfuscated = true;
      continue;
    }
    cur.text += ch;
  }
  flush();
  return runs;
}

export const stripCodes = (text: string, amp = false) => parseRuns(text, 0, amp).map((r) => r.text).join("");

const advance = (ch: string, bold: boolean) => glyphOf(ch).width + 1 + (bold ? 1 : 0);

export function textWidth(text: string, amp = false): number {
  let w = 0;
  for (const r of parseRuns(text, 0, amp)) for (const ch of r.text) w += advance(ch, r.bold);
  return w;
}

export function wrapText(text: string, maxWidth: number, amp = false): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    let lineW = 0;
    let prefix = "";
    for (const word of para.split(/(?= )/)) {
      const w = textWidth(word, amp);
      if (lineW + w > maxWidth && line) {
        lines.push(line);
        const codes = line.match(amp ? /[§&][0-9a-fk-or]/gi : /§[0-9a-fk-or]/gi);
        prefix = codes ? codes.join("") : prefix;
        line = prefix + word.replace(/^ /, "");
        lineW = textWidth(line, amp);
      } else {
        line += word;
        lineW += w;
      }
    }
    lines.push(line);
  }
  return lines;
}


export interface TextRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA
}

const OBF = "ABCDEFGHJKLMNOPRSTUVWXYZabdeghnopqsuvwxyz0123456789";

export function rasterText(text: string, color = 0xffffff, shadow = true, amp = false): TextRaster {
  const runs = parseRuns(text, color, amp);
  let w = 0;
  for (const r of runs) for (const ch of r.text) w += advance(ch, r.bold);
  const width = Math.max(1, w + (shadow ? 1 : 0));
  const height = LINE_HEIGHT;
  const data = new Uint8ClampedArray(width * height * 4);
  const put = (x: number, y: number, c: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 4;
    data[o] = (c >> 16) & 255;
    data[o + 1] = (c >> 8) & 255;
    data[o + 2] = c & 255;
    data[o + 3] = 255;
  };
  const pass = (dx: number, dy: number, isShadow: boolean) => {
    let x = 0;
    for (const r of runs) {
      const c = isShadow ? shadowOf(r.color) : r.color;
      const startX = x;
      for (let ch of r.text) {
        if (r.obfuscated && ch !== " ") ch = OBF[Math.floor(Math.random() * OBF.length)];
        const g = glyphOf(ch);
        for (let gy = 0; gy < GLYPH_ROWS; gy++) {
          const slant = r.italic ? (gy < 3 ? 1 : 0) : 0;
          for (let gx = 0; gx < g.width; gx++) {
            if (!g.rows[gy * g.width + gx]) continue;
            put(x + gx + dx + slant, gy + dy, c);
            if (r.bold) put(x + gx + dx + slant + 1, gy + dy, c);
          }
        }
        x += advance(ch, r.bold);
      }
      for (let lx = startX - (r.underline ? 1 : 0); lx < x; lx++) {
        if (r.underline) put(lx + dx, 8 + dy, c);
        if (r.strike) put(lx + dx, 3 + dy, c);
      }
    }
  };
  if (shadow) pass(1, 1, true);
  pass(0, 0, false);
  return { width, height, data };
}


const URLS = new Map<string, { url: string; width: number; height: number }>();

export function textImage(text: string, color = 0xffffff, shadow = true, amp = false) {
  const key = `${color}|${shadow ? 1 : 0}|${amp ? 1 : 0}|${text}`;
  const hit = URLS.get(key);
  if (hit) return hit;
  const r = rasterText(text, color, shadow, amp);
  const canvas = document.createElement("canvas");
  canvas.width = r.width;
  canvas.height = r.height;
  const g = canvas.getContext("2d");
  if (g) g.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  const out = { url: canvas.toDataURL(), width: r.width, height: r.height };
  if (URLS.size > 3000) URLS.clear();
  if (!/§k|&k/i.test(text)) URLS.set(key, out);
  return out;
}
