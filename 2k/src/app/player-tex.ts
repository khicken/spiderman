import * as THREE from "three";
import type { PlayerData, TeamData } from "./data/types";
import { hash01 } from "./player-skel";

// Per-athlete texture atlas (one canvas per player: jersey, shorts, skin, face, hair, socks, shoes, accessories).
// The whole body is ONE skinned mesh with ONE material, so every region of the uniform lives in this atlas.
// Rects are in canvas space (x, y, w, h), normalized, origin top-left.

export type Rect = readonly [number, number, number, number];
export const R = {
  jersey: [0, 0, 1, 0.45] as Rect, // u: 0 left side, .25 back, .5 right side, .75 front (tube u runs clockwise from above); v: 0 waist .. 1 shoulders
  shorts: [0, 0.45, 1, 0.13] as Rect, // pelvis wrap, same u convention
  legL: [0, 0.58, 0.5, 0.14] as Rect, // shorts leg / ref pants (u = around the leg, 0 = outer side)
  legR: [0.5, 0.58, 0.5, 0.14] as Rect,
  skin: [0, 0.72, 0.5, 0.14] as Rect,
  face: [0.5, 0.72, 0.25, 0.28] as Rect, // u: .5 = face front, 0/1 = back of the head; v: 1 top .. 0 under the chin
  hair: [0.75, 0.72, 0.25, 0.14] as Rect,
  sock: [0, 0.86, 0.25, 0.14] as Rect,
  shoe: [0.25, 0.86, 0.25, 0.105] as Rect, // upper (u around the foot, 0.75 = top; v: 0 heel .. 1 toe)
  sole: [0.25, 0.965, 0.25, 0.035] as Rect,
  acc: [0.75, 0.86, 0.25, 0.14] as Rect, // sleeves, headband, wristbands
};

export interface Look {
  ref: boolean;
  skin: string;
  skinShade: string;
  hair: string;
  hairStyle: PlayerData["hair"];
  beard: boolean;
  headband: boolean;
  base: string; // jersey + shorts body color
  trim: string; // collar, armholes, side panels
  ink: string; // lettering fill
  ink2: string; // lettering outline
  teamName: string;
  number: string;
  last: string;
  sock: string;
  sockStripe: string;
  shoe: string;
  shoeAccent: string;
  sole: string;
  acc: string; // sleeve / headband color
  armSleeve: -1 | 0 | 1; // 0 none, -1 left arm, 1 right arm (contract side convention)
  legSleeve: -1 | 0 | 1;
  highSocks: boolean;
  longShorts: boolean;
}

const SKIN = ["#f1cdb0", "#e2b48e", "#c99368", "#a8714a", "#8a5634", "#6b3f24", "#4d2c19", "#3a2114"];

function mix(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return `#${ca.lerp(cb, t).getHexString()}`;
}
function lum(c: string): number {
  const k = new THREE.Color(c);
  return 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b;
}

export function skinColor(t: number): string {
  const x = Math.max(0, Math.min(0.999, t)) * (SKIN.length - 1);
  const i = Math.floor(x);
  return mix(SKIN[i], SKIN[i + 1], x - i);
}

/** Uniform + body look. Home = light jersey, away = primary jersey (contract uniform rule). */
export function lookFor(p: PlayerData, team: TeamData, home: boolean): Look {
  const h = (k: number) => hash01(p.id, k);
  const skin = skinColor(p.skin);
  const hairStyle = p.hair;
  const darkHair = p.skin > 0.35 || h(1) < 0.6;
  const hair = darkHair ? (h(2) < 0.5 ? "#141110" : "#1f1712") : ["#6b4a2b", "#3d2a1a", "#a07848", "#2a1d14"][Math.floor(h(2) * 4)];
  const prim = team.primary;
  const sec = team.secondary;
  const acc = team.accent || sec;
  let base: string, trim: string, ink: string, ink2: string;
  if (home) {
    base = mix("#f6f6f3", prim, 0.04);
    ink = lum(prim) > 0.75 ? sec : prim;
    ink2 = lum(sec) > 0.8 ? acc : sec;
    if (ink2 === ink || Math.abs(lum(ink2) - lum(ink)) < 0.05) ink2 = "#ffffff";
    trim = ink;
  } else {
    base = prim;
    const light = lum(prim) > 0.55;
    ink = light ? (lum(sec) < 0.5 ? sec : "#111111") : lum(sec) > 0.35 ? sec : "#ffffff";
    if (Math.abs(lum(ink) - lum(base)) < 0.18) ink = light ? "#111111" : "#ffffff";
    ink2 = ink === "#ffffff" ? sec : "#ffffff";
    if (Math.abs(lum(ink2) - lum(base)) < 0.1) ink2 = acc;
    trim = ink;
  }
  const shoePick = h(3);
  const shoe = shoePick < 0.3 ? "#f4f4f4" : shoePick < 0.55 ? "#141414" : shoePick < 0.8 ? prim : sec;
  const shoeAccent = shoe === "#f4f4f4" ? prim : shoe === "#141414" ? (h(4) < 0.5 ? "#f4f4f4" : sec) : "#f4f4f4";
  const sole = h(5) < 0.65 ? "#f2f2ee" : h(5) < 0.85 ? "#151515" : acc;
  const sockDark = h(6) < 0.35;
  const sleeveRoll = h(7);
  return {
    ref: false,
    skin, skinShade: mix(skin, "#000000", 0.28), hair, hairStyle, beard: p.beard, headband: p.headband,
    base, trim, ink, ink2,
    teamName: team.name.toUpperCase(), number: p.jersey00 ? "00" : String(p.jersey), last: p.last.toUpperCase(),
    sock: sockDark ? "#151515" : "#f3f3f3", sockStripe: h(8) < 0.5 ? (home ? prim : sec) : sockDark ? "#151515" : "#f3f3f3",
    shoe, shoeAccent, sole,
    acc: h(9) < 0.45 ? "#151515" : h(9) < 0.75 ? "#f2f2f2" : home ? prim : sec,
    armSleeve: sleeveRoll < 0.22 ? (p.hand === "L" ? -1 : 1) : 0,
    legSleeve: h(10) < 0.18 ? (h(11) < 0.5 ? -1 : 1) : 0,
    highSocks: h(12) < 0.55,
    longShorts: h(13) < 0.5,
  };
}

export function refLook(seed: number): Look {
  const id = `ref-${seed}`;
  const skins = [0.15, 0.7, 0.45];
  return {
    ref: true,
    skin: skinColor(skins[seed % 3]), skinShade: mix(skinColor(skins[seed % 3]), "#000", 0.28),
    hair: "#1a1612", hairStyle: seed === 1 ? "bald" : "short", beard: hash01(id) < 0.4, headband: false,
    base: "#f2f2f2", trim: "#121212", ink: "#121212", ink2: "#f2f2f2",
    teamName: "", number: String([12, 27, 41][seed % 3]), last: "",
    sock: "#111111", sockStripe: "#111111", shoe: "#0f0f0f", shoeAccent: "#2a2a2a", sole: "#141414",
    acc: "#f2f2f2", armSleeve: 0, legSleeve: 0, highSocks: false, longShorts: true,
  };
}

let displayFont = "";
function fontFamily(): string {
  if (displayFont) return displayFont;
  let fam = "";
  try {
    fam = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim();
  } catch {
    fam = "";
  }
  displayFont = (fam ? fam + ", " : "") + '"Arial Narrow", "Arial Black", Impact, sans-serif';
  return displayFont;
}
/** Forget the cached font so the next paint picks up a font that finished loading. */
export function resetFontCache(): void {
  displayFont = "";
}

// --- painting helpers ---------------------------------------------------------------------------------------------
type Ctx = CanvasRenderingContext2D;

function noise(ctx: Ctx, x: number, y: number, w: number, h: number, alpha: number, scale: number, seed: number) {
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const n = Math.floor((w * h) / (scale * scale * 3));
  for (let i = 0; i < n; i++) {
    const v = rnd();
    ctx.fillStyle = v < 0.5 ? `rgba(0,0,0,${alpha * rnd()})` : `rgba(255,255,255,${alpha * rnd() * 0.7})`;
    ctx.fillRect(x + rnd() * w, y + rnd() * h, scale, scale);
  }
}

function lettering(ctx: Ctx, text: string, cx: number, cy: number, h: number, fill: string, out: string, out2: string | null, squash: number, weight = 900, spacing = 0) {
  if (!text) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(squash, 1);
  ctx.font = `${weight} ${Math.round(h)}px ${fontFamily()}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  try {
    (ctx as Ctx & { letterSpacing?: string }).letterSpacing = `${spacing}px`;
  } catch {
    /* older canvas */
  }
  ctx.lineJoin = "round";
  if (out2) {
    ctx.strokeStyle = out2;
    ctx.lineWidth = h * 0.2;
    ctx.strokeText(text, 0, 0);
  }
  ctx.strokeStyle = out;
  ctx.lineWidth = h * 0.11;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function arcText(ctx: Ctx, text: string, cx: number, cy: number, radius: number, h: number, fill: string, out: string, maxW: number) {
  if (!text) return;
  ctx.save();
  ctx.font = `900 ${Math.round(h)}px ${fontFamily()}`;
  const w = ctx.measureText(text).width;
  const squash = Math.min(0.9, maxW / Math.max(1, w));
  const total = w * squash;
  const ang = total / radius;
  ctx.translate(cx, cy + radius);
  ctx.rotate(-ang / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  for (const ch of text) {
    const cw = ctx.measureText(ch).width * squash;
    ctx.rotate(cw / 2 / radius);
    ctx.save();
    ctx.translate(0, -radius);
    ctx.scale(squash, 1);
    ctx.strokeStyle = out;
    ctx.lineWidth = h * 0.16;
    ctx.strokeText(ch, 0, 0);
    ctx.fillStyle = fill;
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    ctx.rotate(cw / 2 / radius);
  }
  ctx.restore();
}

/** Paint one athlete's atlas into ctx (size x size). */
export function paintAtlas(ctx: Ctx, size: number, L: Look): void {
  const S = size;
  const px = (r: Rect) => [r[0] * S, r[1] * S, r[2] * S, r[3] * S] as const;
  ctx.save();
  ctx.clearRect(0, 0, S, S);

  // skin (shared by arms, legs, neck, hands)
  {
    const [x, y, w, h] = px(R.skin);
    ctx.fillStyle = L.skin;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    noise(ctx, x, y, w, h, 0.06, Math.max(1, S / 512), 3);
  }
  // accessories (sleeves, headband): fabric
  {
    const [x, y, w, h] = px(R.acc);
    ctx.fillStyle = L.acc;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    if (L.ref) {
      // short sleeves in the ref stripe
      const n = 8;
      for (let i = 0; i < n; i += 2) {
        ctx.fillStyle = "#111";
        ctx.fillRect(x + (i / n) * w, y, w / n, h);
      }
    }
    noise(ctx, x, y, w, h, 0.05, Math.max(1, S / 512), 5);
  }
  // hair
  {
    const [x, y, w, h] = px(R.hair);
    ctx.fillStyle = L.hair;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 220; i++) {
      const rx = x + ((i * 37) % 97) / 97 * w;
      const ry = y + ((i * 53) % 89) / 89 * h;
      ctx.strokeStyle = i % 3 ? "#000" : mix(L.hair, "#ffffff", 0.25);
      ctx.lineWidth = Math.max(1, S / 700);
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + w * 0.02, ry + h * 0.12);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  paintFace(ctx, S, L);
  paintJersey(ctx, S, L);
  paintShorts(ctx, S, L);
  // socks: v 0 = ankle .. 1 = top of the sock section
  {
    const [x, y, w, h] = px(R.sock);
    ctx.fillStyle = L.sock;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    if (L.sockStripe !== L.sock) {
      ctx.fillStyle = L.sockStripe;
      ctx.fillRect(x - 2, y + h * 0.12, w + 4, h * 0.08);
      ctx.fillRect(x - 2, y + h * 0.26, w + 4, h * 0.05);
    }
    // ribbing
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#000";
    for (let i = 0; i < 40; i++) ctx.fillRect(x + (i / 40) * w, y, Math.max(1, w / 160), h);
    ctx.globalAlpha = 1;
  }
  // shoe upper: u around the foot (.25 top/laces, .75 bottom), v 0 heel .. 1 toe (canvas: left = heel)
  {
    const [x, y, w, h] = px(R.shoe);
    ctx.fillStyle = L.shoe;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    // the canvas region is drawn "u horizontal, v vertical": rows = along foot (top row = toe)
    // lace panel on top (u ~ .25)
    ctx.fillStyle = mix(L.shoe, "#000000", 0.18);
    ctx.fillRect(x + w * 0.69, y + h * 0.35, w * 0.12, h * 0.55);
    ctx.fillStyle = mix(L.shoe, "#ffffff", 0.25);
    for (let i = 0; i < 6; i++) ctx.fillRect(x + w * 0.7, y + h * (0.4 + i * 0.08), w * 0.1, Math.max(1, h * 0.018));
    // accent side swooshes (original shape: a rising chevron band on both sides)
    ctx.fillStyle = L.shoeAccent;
    for (const cxu of [0.0, 0.5, 1.0]) {
      ctx.beginPath();
      ctx.moveTo(x + w * (cxu - 0.12), y + h * 0.15);
      ctx.lineTo(x + w * (cxu + 0.02), y + h * 0.55);
      ctx.lineTo(x + w * (cxu + 0.12), y + h * 0.18);
      ctx.lineTo(x + w * (cxu + 0.06), y + h * 0.16);
      ctx.lineTo(x + w * (cxu + 0.01), y + h * 0.38);
      ctx.lineTo(x + w * (cxu - 0.06), y + h * 0.13);
      ctx.closePath();
      ctx.fill();
    }
    // heel counter
    ctx.fillStyle = L.shoeAccent;
    ctx.fillRect(x - 2, y + h * 0.84, w + 4, h * 0.16);
    // toe cap
    ctx.fillStyle = mix(L.shoe, "#000000", 0.1);
    ctx.fillRect(x - 2, y - 2, w + 4, h * 0.12);
  }
  {
    const [x, y, w, h] = px(R.sole);
    ctx.fillStyle = L.sole;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = mix(L.sole, "#000000", 0.35);
    ctx.fillRect(x - 2, y + h * 0.7, w + 4, h * 0.3 + 2);
  }
  ctx.restore();
}

function paintJersey(ctx: Ctx, S: number, L: Look) {
  const [x, y, w, h] = [R.jersey[0] * S, R.jersey[1] * S, R.jersey[2] * S, R.jersey[3] * S];
  const U = (u: number) => x + u * w;
  const V = (v: number) => y + (1 - v) * h; // v up
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 2, y - 2, w + 4, h + 4);
  ctx.clip();
  ctx.fillStyle = L.base;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  if (L.ref) {
    const n = 34;
    ctx.fillStyle = "#121212";
    for (let i = 0; i < n; i += 2) ctx.fillRect(U(i / n), y, w / n, h);
  } else {
    // side panels
    // wide side panels in the trim color: from the broadcast camera the sides are what identifies a team
    ctx.fillStyle = mix(L.base, L.trim, 0.9);
    for (const c of [0, 0.5, 1]) ctx.fillRect(U(c - 0.035), y, w * 0.07, h);
    ctx.fillStyle = mix(L.base, "#000000", 0.08);
    for (const c of [0, 0.5, 1]) {
      ctx.fillRect(U(c - 0.043), y, w * 0.006, h);
      ctx.fillRect(U(c + 0.037), y, w * 0.006, h);
    }
  }
  // armholes (skin) with trim
  const trimW = h * 0.028;
  for (const c of [0, 0.5, 1]) {
    ctx.beginPath();
    ctx.ellipse(U(c), V(1.02), w * 0.075, h * 0.36, 0, 0, Math.PI * 2);
    ctx.fillStyle = L.trim;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(U(c), V(1.02), w * 0.075 - trimW, h * 0.36 - trimW, 0, 0, Math.PI * 2);
    ctx.fillStyle = L.skin;
    ctx.fill();
  }
  // neckline: V at the front, scoop at the back
  const neck = (cu: number, depth: number, half: number, vShape: boolean) => {
    ctx.beginPath();
    ctx.moveTo(U(cu - half), V(1.05));
    if (vShape) ctx.lineTo(U(cu), V(depth));
    else ctx.quadraticCurveTo(U(cu), V(depth - 0.06), U(cu + half), V(1.05));
    ctx.lineTo(U(cu + half), V(1.05));
    ctx.closePath();
  };
  ctx.lineJoin = "round";
  neck(0.75, 0.85, 0.08, !L.ref);
  ctx.fillStyle = L.skin;
  ctx.fill();
  ctx.strokeStyle = L.trim;
  ctx.lineWidth = trimW * 2;
  ctx.stroke();
  neck(0.25, 0.9, 0.08, false);
  ctx.fillStyle = L.skin;
  ctx.fill();
  ctx.stroke();
  if (!L.ref) {
    // front: arched team name + number; back: name bar + big number
    const fh = h * 0.13;
    arcText(ctx, L.teamName, U(0.75), V(0.66), w * 0.42, fh, L.ink, L.ink2, w * 0.17);
    lettering(ctx, L.number, U(0.75), V(0.36), h * 0.33, L.ink, L.ink2, L.trim, 0.92);
    const nameH = h * 0.085;
    ctx.save();
    ctx.font = `800 ${Math.round(nameH)}px ${fontFamily()}`;
    const nw = ctx.measureText(L.last).width;
    ctx.restore();
    const sq = Math.min(1, (w * 0.16) / Math.max(1, nw));
    lettering(ctx, L.last, U(0.25), V(0.8), nameH, L.ink, L.ink2, null, sq, 800, nameH * 0.08);
    lettering(ctx, L.number, U(0.25), V(0.43), h * 0.5, L.ink, L.ink2, L.trim, 0.9);
    // brand tag on the chest and above the back number
    ctx.globalAlpha = 0.85;
    lettering(ctx, "HOOPS", U(0.795), V(0.86), h * 0.04, L.trim, L.base, null, 1, 800);
    ctx.globalAlpha = 1;
  } else {
    // ref: number on the back and the sleeve area
    ctx.fillStyle = "#f2f2f2";
    ctx.fillRect(U(0.2), V(0.62), w * 0.1, h * 0.22);
    lettering(ctx, L.number, U(0.25), V(0.51), h * 0.16, "#111", "#f2f2f2", null, 0.9);
  }
  // knit texture + soft vertical fold shading
  noise(ctx, x, y, w, h, 0.05, Math.max(1, S / 600), 11);
  const g = ctx.createLinearGradient(0, V(0), 0, V(0.25));
  g.addColorStop(0, "rgba(0,0,0,0.22)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x, V(0.25), w, h * 0.25);
  ctx.restore();
}

function paintShorts(ctx: Ctx, S: number, L: Look) {
  const base = L.ref ? "#121212" : L.base;
  const stripe = L.ref ? "#121212" : L.trim;
  const stripe2 = L.ref ? "#121212" : L.ink2;
  {
    const [x, y, w, h] = [R.shorts[0] * S, R.shorts[1] * S, R.shorts[2] * S, R.shorts[3] * S];
    ctx.fillStyle = base;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    // waistband at the top
    ctx.fillStyle = L.ref ? "#1b1b1b" : stripe;
    ctx.fillRect(x - 2, y - 2, w + 4, h * 0.2);
    if (!L.ref) {
      ctx.fillStyle = stripe2;
      ctx.fillRect(x - 2, y + h * 0.2, w + 4, h * 0.04);
      for (const c of [0, 0.5, 1]) {
        ctx.fillStyle = stripe;
        ctx.fillRect(x + (c - 0.03) * w, y, w * 0.06, h);
      }
      lettering(ctx, "HOOPS", x + 0.8 * w, y + h * 0.62, h * 0.18, stripe, base, null, 1, 800);
    }
    noise(ctx, x, y, w, h, 0.05, Math.max(1, S / 600), 13);
  }
  for (const r of [R.legL, R.legR]) {
    const [x, y, w, h] = [r[0] * S, r[1] * S, r[2] * S, r[3] * S];
    ctx.fillStyle = base;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    if (!L.ref) {
      // outer side stripe at u = 0 / 1 (wraps), hem at the bottom
      ctx.fillStyle = stripe;
      ctx.fillRect(x - 2, y, w * 0.07, h);
      ctx.fillRect(x + w * 0.93, y, w * 0.07 + 2, h);
      ctx.fillStyle = stripe2;
      ctx.fillRect(x + w * 0.07, y, w * 0.015, h);
      ctx.fillRect(x + w * 0.915, y, w * 0.015, h);
      ctx.fillStyle = stripe;
      ctx.fillRect(x - 2, y + h * 0.9, w + 4, h * 0.1 + 2);
      // number on the front of the left leg
      if (r === R.legL) lettering(ctx, L.number, x + w * 0.75, y + h * 0.55, h * 0.3, stripe, stripe2, null, 0.85);
    } else {
      // crease
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(x + w * 0.24, y, w * 0.02, h);
    }
    noise(ctx, x, y, w, h, 0.05, Math.max(1, S / 600), 17);
    // folds
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#000";
    for (let i = 0; i < 5; i++) ctx.fillRect(x + w * (0.12 + i * 0.19), y + h * 0.3, w * 0.03, h * 0.6);
    ctx.globalAlpha = 1;
  }
}

function paintFace(ctx: Ctx, S: number, L: Look) {
  const [x, y, w, h] = [R.face[0] * S, R.face[1] * S, R.face[2] * S, R.face[3] * S];
  const U = (u: number) => x + u * w;
  const V = (row: number) => y + row * h; // row 0 = top of head .. 1 = under the chin
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 2, y - 2, w + 4, h + 4);
  ctx.clip();
  ctx.fillStyle = L.skin;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  noise(ctx, x, y, w, h, 0.022, Math.max(1, S / 700), 23);
  const dark = L.skinShade;
  // soft shading: eye sockets, under the brow, nose sides, under the lips
  const blob = (u: number, r: number, rx: number, ry: number, col: string, a: number) => {
    const g = ctx.createRadialGradient(U(u), V(r), 0, U(u), V(r), Math.max(rx, ry));
    g.addColorStop(0, col);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(U(u), V(r));
    ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
    ctx.translate(-U(u), -V(r));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(U(u), V(r), Math.max(rx, ry), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  const eu = 0.063; // eye offset in u
  const er = 0.475; // eye row
  for (const s of [-1, 1]) blob(0.5 + s * eu, er, w * 0.045, h * 0.04, dark, 0.75);
  blob(0.5, 0.69, w * 0.06, h * 0.025, dark, 0.35);
  // eyes: dark almond with a faint white + iris
  for (const s of [-1, 1]) {
    const cx = U(0.5 + s * eu);
    const cy = V(er);
    ctx.fillStyle = "#e9e1d6";
    ctx.beginPath();
    ctx.ellipse(cx, cy, w * 0.027, h * 0.0125, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a1b12";
    ctx.beginPath();
    ctx.arc(cx + s * w * 0.002, cy, h * 0.011, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#050505";
    ctx.beginPath();
    ctx.arc(cx + s * w * 0.002, cy, h * 0.0045, 0, Math.PI * 2);
    ctx.fill();
    // upper lid line
    ctx.strokeStyle = "rgba(10,6,4,0.85)";
    ctx.lineWidth = Math.max(1, h * 0.006);
    ctx.beginPath();
    ctx.ellipse(cx, cy + h * 0.002, w * 0.026, h * 0.012, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    // brow
    ctx.strokeStyle = mix(L.hair, L.skin, 0.15);
    ctx.lineWidth = h * 0.02;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(U(0.5 + s * 0.028), V(er - 0.045));
    ctx.quadraticCurveTo(U(0.5 + s * 0.062), V(er - 0.062), U(0.5 + s * 0.095), V(er - 0.04));
    ctx.stroke();
  }
  // nose shadow + nostrils
  blob(0.5, 0.6, w * 0.03, h * 0.02, dark, 0.6);
  // lips
  ctx.fillStyle = mix(L.skin, "#5a2a22", 0.45);
  ctx.beginPath();
  ctx.ellipse(U(0.5), V(0.672), w * 0.034, h * 0.012, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(20,8,6,0.75)";
  ctx.lineWidth = Math.max(1, h * 0.005);
  ctx.beginPath();
  ctx.moveTo(U(0.468), V(0.671));
  ctx.quadraticCurveTo(U(0.5), V(0.677), U(0.532), V(0.671));
  ctx.stroke();
  // ears shading
  for (const u of [0.25, 0.75]) blob(u, 0.5, w * 0.03, h * 0.06, dark, 0.45);
  // hair (painted hairline for buzz/short/braids/locs/afro bases)
  if (L.hairStyle !== "bald") {
    ctx.fillStyle = L.hair;
    ctx.globalAlpha = L.hairStyle === "buzz" ? 0.82 : 1;
    ctx.beginPath();
    // hairline: high at the forehead (front u=.5), lower at the temples, down to the nape at the back (u 0/1)
    ctx.moveTo(U(-0.01), V(0.66));
    ctx.lineTo(U(0.18), V(0.6));
    ctx.quadraticCurveTo(U(0.25), V(0.42), U(0.32), V(0.4));
    ctx.quadraticCurveTo(U(0.38), V(0.3), U(0.5), V(0.3));
    ctx.quadraticCurveTo(U(0.62), V(0.3), U(0.68), V(0.4));
    ctx.quadraticCurveTo(U(0.75), V(0.42), U(0.82), V(0.6));
    ctx.lineTo(U(1.01), V(0.66));
    ctx.lineTo(U(1.01), V(-0.02));
    ctx.lineTo(U(-0.01), V(-0.02));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.clip();
    if (L.hairStyle === "braids") {
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = Math.max(1, w * 0.006);
      for (let i = 0; i < 14; i++) {
        const u = i / 14;
        ctx.beginPath();
        ctx.moveTo(U(u), V(0.02));
        ctx.lineTo(U(u + 0.01), V(0.6));
        ctx.stroke();
      }
    } else {
      noise(ctx, x, y, w, h * 0.6, 0.18, Math.max(1, S / 500), 29);
    }
    ctx.restore();
  }
  // beard
  if (L.beard) {
    ctx.fillStyle = L.hair;
    ctx.globalAlpha = 0.88;
    ctx.beginPath();
    ctx.moveTo(U(0.33), V(0.5));
    ctx.quadraticCurveTo(U(0.37), V(0.66), U(0.43), V(0.62));
    ctx.quadraticCurveTo(U(0.5), V(0.635), U(0.57), V(0.62));
    ctx.quadraticCurveTo(U(0.63), V(0.66), U(0.67), V(0.5));
    ctx.lineTo(U(0.7), V(1.02));
    ctx.lineTo(U(0.3), V(1.02));
    ctx.closePath();
    ctx.fill();
    // keep the lips visible
    ctx.globalAlpha = 1;
    ctx.fillStyle = mix(L.skin, "#5a2a22", 0.45);
    ctx.beginPath();
    ctx.ellipse(U(0.5), V(0.672), w * 0.03, h * 0.0095, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // under-chin / neck shadow
  const g = ctx.createLinearGradient(0, V(0.8), 0, V(1));
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = g;
  ctx.fillRect(x, V(0.8), w, h * 0.2);
  ctx.restore();
}

// --- shared roughness map (same layout for every athlete) ---------------------------------------------------------
let roughTex: THREE.CanvasTexture | null = null;
let roughUsers = 0;
export function acquireRoughness(): THREE.CanvasTexture {
  roughUsers++;
  if (roughTex) return roughTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const fill = (r: Rect, v: number) => {
    const g = Math.round(v * 255);
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.fillRect(r[0] * 128 - 1, r[1] * 128 - 1, r[2] * 128 + 2, r[3] * 128 + 2);
  };
  fill(R.jersey, 0.78);
  fill(R.shorts, 0.58);
  fill(R.legL, 0.58);
  fill(R.legR, 0.58);
  fill(R.skin, 0.52);
  fill(R.face, 0.5);
  fill(R.hair, 0.88);
  fill(R.sock, 0.92);
  fill(R.shoe, 0.42);
  fill(R.sole, 0.6);
  fill(R.acc, 0.66);
  roughTex = new THREE.CanvasTexture(c);
  roughTex.colorSpace = THREE.NoColorSpace;
  return roughTex;
}
export function releaseRoughness(): void {
  roughUsers--;
  if (roughUsers <= 0 && roughTex) {
    roughTex.dispose();
    roughTex = null;
    roughUsers = 0;
  }
}
