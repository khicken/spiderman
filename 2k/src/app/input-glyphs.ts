import type { Device, PadStyle } from "./contracts";

// Button glyphs for the UI: which label and shape to draw for an action on the active device.
// Owner: input-camera. Pure data + a tiny SVG builder, no React, no DOM. The UI decides how it looks around them.

export type { PadStyle };

/** Guess the face-button family from a Gamepad.id string. */
export function padStyleOf(id: string | null | undefined): PadStyle {
  if (!id) return "generic";
  const s = id.toLowerCase();
  // Xbox first: Chrome reports "Xbox Wireless Controller (... Vendor: 045e ...)", which also contains "wireless controller"
  if (/045e|xbox|xinput|x-box|microsoft|028e/.test(s)) return "xbox";
  // Sony's own pads report "Wireless Controller" with vendor 054c
  if (/054c|dualsense|dualshock|playstation|ps4|ps5|wireless controller/.test(s)) return "playstation";
  if (/057e|nintendo|pro controller|joy-con|switch/.test(s)) return "nintendo";
  if (/standard gamepad/.test(s)) return "xbox";
  return "generic";
}

/** "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e ...)" -> "Xbox Wireless Controller". */
export function padLabel(id: string): string {
  const cut = id.replace(/\(.*?\)/g, "").replace(/vendor:.*$/i, "").replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, "").trim();
  return cut || "Controller";
}

export type GlyphAction =
  | "move" | "sprint" | "shoot" | "pass" | "bounce" | "lob" | "screen" | "icon" | "post" | "dribble" | "steal" | "block"
  | "switch" | "charge" | "intense" | "handsUp" | "pause" | "camera" | "ok" | "back" | "tabLeft" | "tabRight" | "nav";

export type GlyphShape = "face" | "bumper" | "trigger" | "stick" | "dpad" | "key" | "wideKey" | "menu";
export type FaceSymbol = "cross" | "circle" | "square" | "triangle" | null;

export interface Glyph {
  label: string; // text inside the glyph ("A", "RT", "Shift", "J", "L"), "" when a symbol is drawn instead
  shape: GlyphShape;
  symbol: FaceSymbol; // PlayStation-style face symbols, drawn as vector shapes
  tint: string; // accent color for the glyph (face buttons get a hue, everything else is neutral)
}

// Standard-mapping button index per action. Face buttons: 0 bottom, 1 right, 2 left, 3 top.
const PAD_INDEX: Record<GlyphAction, number> = {
  move: 100, dribble: 101, handsUp: 101, nav: 102,
  pass: 0, switch: 0, ok: 0,
  bounce: 1, charge: 1, back: 1,
  shoot: 2, steal: 2,
  lob: 3, block: 3,
  screen: 4, tabLeft: 4,
  icon: 5, tabRight: 5,
  post: 6, intense: 6,
  sprint: 7,
  camera: 8,
  pause: 9,
};

const NEUTRAL = "#e9edf2";
const XBOX_FACE = ["A", "B", "X", "Y"];
const XBOX_TINT = ["#5fd068", "#ef5a4c", "#4aa3ff", "#f5c542"];
const NIN_FACE = ["B", "A", "Y", "X"]; // Nintendo layout swaps the labels on the same positions
const PS_SYM: FaceSymbol[] = ["cross", "circle", "square", "triangle"];
const PS_TINT = ["#8fb4ff", "#ff7a86", "#ef8fd6", "#5fe0bd"];
const SHOULDER: Record<PadStyle, string[]> = {
  xbox: ["LB", "RB", "LT", "RT", "View", "Menu"],
  generic: ["LB", "RB", "LT", "RT", "Back", "Start"],
  playstation: ["L1", "R1", "L2", "R2", "Create", "Options"],
  nintendo: ["L", "R", "ZL", "ZR", "−", "+"],
};

const KEY: Record<GlyphAction, string> = {
  move: "WASD", sprint: "Shift", shoot: "J", pass: "K", bounce: "L", lob: "I", screen: "E", icon: "R", post: "Q",
  dribble: "←↑→↓", steal: "L", block: "J", switch: "K", charge: "F", intense: "Q", handsUp: "↑",
  pause: "Esc", camera: "C", ok: "Enter", back: "Esc", tabLeft: "Q", tabRight: "E", nav: "↑↓",
};

/** The glyph for an action on the given device and pad family. */
export function glyph(action: GlyphAction, device: Device, style: PadStyle = "generic"): Glyph {
  if (device === "keys") {
    const label = KEY[action];
    return { label, shape: label.length > 2 ? "wideKey" : "key", symbol: null, tint: NEUTRAL };
  }
  const i = PAD_INDEX[action];
  if (i === 100) return { label: "L", shape: "stick", symbol: null, tint: NEUTRAL };
  if (i === 101) return { label: "R", shape: "stick", symbol: null, tint: NEUTRAL };
  if (i === 102) return { label: "", shape: "dpad", symbol: null, tint: NEUTRAL };
  if (i <= 3) {
    if (style === "playstation") return { label: "", shape: "face", symbol: PS_SYM[i], tint: PS_TINT[i] };
    if (style === "nintendo") return { label: NIN_FACE[i], shape: "face", symbol: null, tint: NEUTRAL };
    return { label: XBOX_FACE[i], shape: "face", symbol: null, tint: XBOX_TINT[i] };
  }
  const sh = SHOULDER[style];
  if (i === 4 || i === 5) return { label: sh[i - 4], shape: "bumper", symbol: null, tint: NEUTRAL };
  if (i === 6 || i === 7) return { label: sh[i - 4], shape: "trigger", symbol: null, tint: NEUTRAL };
  return { label: sh[i - 4], shape: "menu", symbol: null, tint: NEUTRAL };
}

/** Labels for the 4 icon-pass glyphs over teammates (A/B/X/Y order, PlayStation symbols as text, keys 1..4). */
export function iconLabels(device: Device, style: PadStyle = "generic"): string[] {
  if (device === "keys") return ["1", "2", "3", "4"];
  if (style === "playstation") return ["✕", "○", "□", "△"];
  if (style === "nintendo") return NIN_FACE;
  return XBOX_FACE;
}

/** Control sheet rows for a controls screen: offense / defense meaning of each input. */
export const CONTROL_SHEET: { action: GlyphAction; offense: string; defense: string }[] = [
  { action: "move", offense: "Move", defense: "Move" },
  { action: "sprint", offense: "Sprint", defense: "Sprint" },
  { action: "shoot", offense: "Shoot (hold, release at the top). Drive + hold: layup / dunk", defense: "Steal" },
  { action: "pass", offense: "Pass (aim with the move stick)", defense: "Switch to the defender nearest the ball" },
  { action: "bounce", offense: "Bounce pass", defense: "Take charge" },
  { action: "lob", offense: "Lob / alley-oop", defense: "Block / jump" },
  { action: "dribble", offense: "Dribble moves: flick across = crossover, back = step back, toward rim = spin", defense: "Hands up" },
  { action: "post", offense: "Post up", defense: "Intense defense" },
  { action: "screen", offense: "Call for a screen", defense: "" },
  { action: "icon", offense: "Hold for icon pass, then a face button", defense: "" },
  { action: "camera", offense: "Change camera", defense: "Change camera" },
  { action: "pause", offense: "Pause", defense: "Pause" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A self-contained SVG string for a glyph (for dangerouslySetInnerHTML or an <img src="data:...">).
 * Height = size px; keys and bumpers get wider. Colors come from `fg` / `bg` so it fits light and dark HUD skins.
 */
export function glyphSvg(g: Glyph, size = 22, fg = "#ffffff", bg = "rgba(10,14,20,0.82)"): string {
  const h = size;
  const font = `font-family="Inter Tight, system-ui, sans-serif" font-weight="800"`;
  if (g.shape === "face") {
    const r = h / 2 - 1;
    const c = h / 2;
    let inner = "";
    const sw = Math.max(1.6, h * 0.09);
    const k = h * 0.2;
    if (g.symbol === "cross") inner = `<path d="M${c - k} ${c - k}L${c + k} ${c + k}M${c + k} ${c - k}L${c - k} ${c + k}" stroke="${g.tint}" stroke-width="${sw}" stroke-linecap="round"/>`;
    else if (g.symbol === "circle") inner = `<circle cx="${c}" cy="${c}" r="${k * 1.1}" fill="none" stroke="${g.tint}" stroke-width="${sw}"/>`;
    else if (g.symbol === "square") inner = `<rect x="${c - k}" y="${c - k}" width="${2 * k}" height="${2 * k}" rx="1" fill="none" stroke="${g.tint}" stroke-width="${sw}"/>`;
    else if (g.symbol === "triangle") inner = `<path d="M${c} ${c - k * 1.15}L${c + k * 1.1} ${c + k * 0.8}L${c - k * 1.1} ${c + k * 0.8}Z" fill="none" stroke="${g.tint}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    else inner = `<text x="${c}" y="${c}" dy="0.36em" text-anchor="middle" font-size="${h * 0.56}" ${font} fill="${g.tint}">${esc(g.label)}</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${h}" height="${h}" viewBox="0 0 ${h} ${h}"><circle cx="${c}" cy="${c}" r="${r}" fill="${bg}" stroke="${g.tint}" stroke-opacity="0.55" stroke-width="1.2"/>${inner}</svg>`;
  }
  if (g.shape === "stick" || g.shape === "dpad") {
    const c = h / 2;
    const body = g.shape === "stick"
      ? `<circle cx="${c}" cy="${c}" r="${c - 1}" fill="${bg}" stroke="${fg}" stroke-opacity="0.5"/><circle cx="${c}" cy="${c}" r="${c * 0.55}" fill="none" stroke="${fg}" stroke-opacity="0.35"/><text x="${c}" y="${c}" dy="0.36em" text-anchor="middle" font-size="${h * 0.46}" ${font} fill="${fg}">${esc(g.label)}</text>`
      : `<path d="M${c - h * 0.14} 1h${h * 0.28}v${c - h * 0.14 - 1}h${c - h * 0.14 - 1}v${h * 0.28}h-${c - h * 0.14 - 1}v${c - h * 0.14 - 1}h-${h * 0.28}v-${c - h * 0.14 - 1}h-${c - h * 0.14 - 1}v-${h * 0.28}h${c - h * 0.14 - 1}z" fill="${bg}" stroke="${fg}" stroke-opacity="0.6"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${h}" height="${h}" viewBox="0 0 ${h} ${h}">${body}</svg>`;
  }
  const chars = g.label.length;
  const w = Math.max(h, Math.round(h * (0.42 + chars * 0.36)));
  const rx = g.shape === "trigger" ? h * 0.42 : g.shape === "bumper" ? h * 0.3 : h * 0.22;
  const top = g.shape === "trigger" ? `<path d="M3 ${h * 0.3}Q${w / 2} -${h * 0.1} ${w - 3} ${h * 0.3}" stroke="${fg}" stroke-opacity="0.35" fill="none"/>` : "";
  const keyShade = g.shape === "key" || g.shape === "wideKey" ? `<rect x="1.5" y="${h - 4}" width="${w - 3}" height="2.5" rx="1" fill="${fg}" fill-opacity="0.18"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="0.75" y="0.75" width="${w - 1.5}" height="${h - 1.5}" rx="${rx}" fill="${bg}" stroke="${fg}" stroke-opacity="0.45" stroke-width="1.2"/>${keyShade}${top}<text x="${w / 2}" y="${h / 2}" dy="0.36em" text-anchor="middle" font-size="${h * (chars > 3 ? 0.4 : 0.5)}" ${font} fill="${fg}">${esc(g.label)}</text></svg>`;
}
