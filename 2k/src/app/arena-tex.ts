import * as THREE from "three";
import type { TeamData } from "./contracts";

// Canvas + color helpers shared by the arena's procedural textures, and the original HOOPS team emblem.

export function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  return [c, ctx];
}

export function canvasTexture(c: HTMLCanvasElement, srgb = true, anisotropy = 4): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

let displayFamily = "";
/** CSS font stack for the display face. next/font registers it under a hashed family name, so look it up. */
export function displayFont(): string {
  if (displayFamily) return displayFamily;
  let fam = "";
  if (typeof document !== "undefined" && document.fonts) {
    document.fonts.forEach((f) => {
      if (!fam && /big.?shoulders/i.test(f.family) && !/fallback/i.test(f.family)) fam = f.family;
    });
  }
  if (fam && !/^["']/.test(fam)) fam = `"${fam}"`;
  displayFamily = `${fam ? fam + ", " : ""}"Big Shoulders", "Arial Narrow", Impact, "Helvetica Neue", sans-serif`;
  return displayFamily;
}

/** Calls cb once when web fonts finish loading (so canvas text can be redrawn with the real face). */
export function whenFontsReady(cb: () => void): () => void {
  let live = true;
  if (typeof document === "undefined" || !document.fonts) return () => {};
  const fam = displayFont();
  Promise.all([document.fonts.load(`900 64px ${fam}`), document.fonts.load(`700 64px ${fam}`)])
    .then(() => document.fonts.ready)
    .then(() => {
      displayFamily = "";
      if (live) cb();
    })
    .catch(() => {});
  return () => {
    live = false;
  };
}

const tmpA = new THREE.Color();
export function hexMix(a: string, b: string, t: number): string {
  tmpA.set(a).lerp(new THREE.Color(b), t);
  return `#${tmpA.getHexString()}`;
}
export function shade(hex: string, k: number): string {
  return k < 0 ? hexMix(hex, "#000000", -k) : hexMix(hex, "#ffffff", k);
}
export function luminance(hex: string): number {
  tmpA.set(hex);
  return 0.2126 * tmpA.r + 0.7152 * tmpA.g + 0.0722 * tmpA.b;
}
/** The more contrasting of two colors against `bg`. */
export function contrastOn(bg: string, a: string, b: string): string {
  const lb = luminance(bg);
  return Math.abs(luminance(a) - lb) >= Math.abs(luminance(b) - lb) ? a : b;
}
/** Team accent that reads on dark LED backgrounds. */
export function ledColor(t: TeamData): string {
  const cands = [t.primary, t.secondary, t.accent];
  let best = cands[0];
  let score = -1;
  for (const c of cands) {
    tmpA.set(c);
    const hsl = { h: 0, s: 0, l: 0 };
    tmpA.getHSL(hsl);
    const sc = hsl.s * 1.2 + (hsl.l > 0.25 && hsl.l < 0.8 ? 0.6 : 0) - (hsl.l < 0.12 ? 1 : 0);
    if (sc > score) {
      score = sc;
      best = c;
    }
  }
  return best;
}

export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Fit `text` into maxW at the largest size <= size; returns the size used. Font set on ctx. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxW: number, spacing = 0): number {
  let s = size;
  for (let i = 0; i < 24; i++) {
    ctx.font = `${weight} ${s}px ${displayFont()}`;
    const w = ctx.measureText(text).width + spacing * s * Math.max(0, text.length - 1);
    if (w <= maxW) break;
    s *= Math.max(0.6, (maxW / w) * 0.98);
  }
  ctx.font = `${weight} ${s}px ${displayFont()}`;
  return s;
}

/** Text with letter spacing (em) centered at (x, y). */
export function spacedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, em: number, mode: "fill" | "stroke" = "fill") {
  const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? "16");
  const sp = em * size;
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width;
  total += sp * Math.max(0, text.length - 1);
  let cx = x - total / 2;
  const align = ctx.textAlign;
  ctx.textAlign = "left";
  for (const ch of text) {
    if (mode === "fill") ctx.fillText(ch, cx, y);
    else ctx.strokeText(ch, cx, y);
    cx += ctx.measureText(ch).width + sp;
  }
  ctx.textAlign = align;
}

/**
 * Original HOOPS emblem: a team-colored shield-ring with ball seams, chevron crown and the team abbreviation.
 * Not any real logo. Drawn centered at (x, y) with radius r.
 */
export function drawEmblem(ctx: CanvasRenderingContext2D, t: TeamData, x: number, y: number, r: number, opts: { alpha?: number; glow?: boolean } = {}) {
  const prim = t.primary;
  const sec = t.secondary;
  const acc = t.accent;
  const ink = contrastOn(prim, "#ffffff", shade(prim, -0.75));
  const rnd = seeded(hashStr(t.abbr));
  const variant = Math.floor(rnd() * 3);
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.translate(x, y);
  if (opts.glow) {
    ctx.shadowColor = sec;
    ctx.shadowBlur = r * 0.25;
  }
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = sec;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
  ctx.fillStyle = shade(prim, -0.35);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.84, 0, Math.PI * 2);
  ctx.fillStyle = prim;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = shade(prim, -0.25);
  ctx.lineWidth = r * 0.045;
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.lineTo(r, 0);
  ctx.moveTo(0, -r);
  ctx.lineTo(0, r);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-r * 1.05, 0, r * 0.78, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(r * 1.05, 0, r * 0.78, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.stroke();
  if (variant === 1) {
    ctx.fillStyle = acc;
    ctx.globalAlpha *= 0.55;
    ctx.beginPath();
    ctx.moveTo(-r, r * 0.35);
    ctx.lineTo(r, -r * 0.55);
    ctx.lineTo(r, -r * 0.3);
    ctx.lineTo(-r, r * 0.6);
    ctx.fill();
    ctx.globalAlpha = opts.alpha ?? 1;
  }
  ctx.restore();
  ctx.fillStyle = sec;
  const cy = -r * 0.56;
  for (let i = -1; i <= 1; i++) {
    const s = i === 0 ? 1 : 0.7;
    ctx.beginPath();
    ctx.moveTo(i * r * 0.2 - r * 0.07 * s, cy + r * 0.05);
    ctx.lineTo(i * r * 0.2, cy - r * 0.12 * s);
    ctx.lineTo(i * r * 0.2 + r * 0.07 * s, cy + r * 0.05);
    ctx.closePath();
    ctx.fill();
  }
  if (variant !== 2) {
    ctx.fillStyle = acc === prim ? sec : acc;
    for (let i = -1; i <= 1; i++) star(ctx, i * r * 0.17, r * 0.6, r * 0.055);
  } else {
    ctx.fillStyle = sec;
    ctx.fillRect(-r * 0.32, r * 0.55, r * 0.64, r * 0.06);
  }
  const size = fitText(ctx, t.abbr, 900, r * 0.78, r * 1.36, 0.02);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = shade(prim, -0.6);
  spacedText(ctx, t.abbr, 0, r * 0.04, 0.02, "stroke");
  ctx.fillStyle = ink;
  spacedText(ctx, t.abbr, 0, r * 0.04, 0.02);
  ctx.lineWidth = size * 0.035;
  ctx.strokeStyle = sec;
  spacedText(ctx, t.abbr, 0, r * 0.04, 0.02, "stroke");
  ctx.restore();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}
