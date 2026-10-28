import * as THREE from "three";
import type { ItemStack } from "../../contracts";
import { DYE_RGB, type Dye } from "../../entities/passive/common";
import { MAP_BASE, SHADE } from "./map-colors";
import { mapById, type MapData } from "./maps";
import { rasterText } from "../../ui/font";

const SIZE = 142;
const BORDER = 7;
// Canvas pixels per map pixel, so banner names stay legible at their vanilla 6/9 text scale.
const RES = 4;
const viewer = { x: 0, z: 0, yaw: 0, dim: "overworld" as string };
// Map canvases and label rasters unused this long are freed.
const IDLE_MS = 30000;

interface Layer {
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
}

// Colors at one canvas pixel per map pixel; decorations in a separate high-res layer redrawn only when they change.
interface Entry {
  colors: Layer;
  deco: Layer | null;
  decoKey: string;
  version: number;
  used: number;
}

const entries = new Map<number, Entry>();
const framed = new Map<number, Entry>();
const previews = new Map<number, { version: number; url: string }>();
let paper: ImageData | null = null;
let base: HTMLCanvasElement | null = null;
const labels = new Map<string, { canvas: HTMLCanvasElement; used: number }>();
const markerTex: Partial<Record<"arrow" | "dot", THREE.CanvasTexture>> = {};
let sweptAt = 0;

export function setMapViewer(x: number, z: number, yaw: number, dim: string) {
  viewer.x = x;
  viewer.z = z;
  viewer.yaw = yaw;
  viewer.dim = dim;
}

function paperImage(g: CanvasRenderingContext2D): ImageData {
  if (paper) return paper;
  const img = g.createImageData(SIZE, SIZE);
  let h = 7;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      h = (h * 1103515245 + 12345) & 0x7fffffff;
      const n = (h % 9) - 4;
      const edge = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
      const c = edge < 2 ? [0x6b, 0x55, 0x3a] : edge < BORDER ? [0xc2, 0xa9, 0x7c] : [0xdb, 0xcf, 0xab];
      const i = (y * SIZE + x) * 4;
      img.data[i] = c[0] + n;
      img.data[i + 1] = c[1] + n;
      img.data[i + 2] = c[2] + n;
      img.data[i + 3] = 255;
    }
  paper = img;
  return img;
}

function arrow(g: CanvasRenderingContext2D, x: number, z: number, rot: number, fill: string) {
  g.save();
  g.translate(x, z);
  g.rotate(rot);
  arrowPath(g, fill);
  g.restore();
}

function arrowPath(g: CanvasRenderingContext2D, fill: string) {
  g.beginPath();
  g.moveTo(0, -4);
  g.lineTo(3, 4);
  g.lineTo(0, 2);
  g.lineTo(-3, 4);
  g.closePath();
  g.fillStyle = fill;
  g.strokeStyle = "#222";
  g.lineWidth = 1;
  g.fill();
  g.stroke();
}

// Vanilla MapRenderer: a named decoration gets its name centered 4 map pixels below it, white on a half-black box.
function label(g: CanvasRenderingContext2D, text: string, x: number, z: number) {
  let hit = labels.get(text);
  if (!hit) {
    const r = rasterText(text, 0xffffff, false);
    const canvas = document.createElement("canvas");
    canvas.width = r.width;
    canvas.height = r.height;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
    hit = { canvas, used: 0 };
    labels.set(text, hit);
  }
  hit.used = performance.now();
  const tmp = hit.canvas;
  const w = tmp.width - 1;
  const k = Math.min(25 / Math.max(1, w), 6 / 9);
  g.save();
  g.translate(x - (w * k) / 2, z + 4);
  g.scale(k, k);
  g.fillStyle = "rgba(0,0,0,0.5)";
  g.fillRect(-1, -1, w + 2, 10);
  g.drawImage(tmp, 0, 0);
  g.restore();
}

function paintColors(g: CanvasRenderingContext2D, m: MapData, inFrame: boolean) {
  const img = g.createImageData(SIZE, SIZE);
  // Vanilla frames draw no paper: unexplored pixels stay clear so the frame shows through.
  if (!inFrame) img.data.set(paperImage(g).data);
  for (let i = 0; i < 128 * 128; i++) {
    const v = m.colors[i];
    if (!v) continue;
    const base = MAP_BASE[v >> 2], k = SHADE[v & 3];
    const o = ((((i >> 7) + BORDER) * SIZE) + (i & 127) + BORDER) * 4;
    img.data[o] = (((base >> 16) & 255) * k) / 255;
    img.data[o + 1] = (((base >> 8) & 255) * k) / 255;
    img.data[o + 2] = ((base & 255) * k) / 255;
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

// Full map with decorations and the player marker, for 2D previews.
function draw(canvas: HTMLCanvasElement, m: MapData) {
  const out = canvas.getContext("2d")!;
  base ??= document.createElement("canvas");
  base.width = base.height = SIZE;
  paintColors(base.getContext("2d")!, m, false);
  out.imageSmoothingEnabled = false;
  out.drawImage(base, 0, 0, SIZE * RES, SIZE * RES);
  out.scale(RES, RES);
  drawMarkers(out, m);
  const p = playerMarker(m);
  if (p) {
    out.translate(p.x, p.z);
    if (p.dot) dot(out, p.dot);
    else {
      out.rotate(-p.yaw);
      arrowPath(out, "#fff");
    }
  }
}

function dot(g: CanvasRenderingContext2D, r: number) {
  g.fillStyle = "#fff";
  g.strokeStyle = "#222";
  g.lineWidth = 1;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
}

function drawMarkers(g: CanvasRenderingContext2D, m: MapData) {
  const s = 1 << m.scale;
  if (m.marker) {
    const mx = (m.marker.x - m.cx) / s + 64 + BORDER, mz = (m.marker.z - m.cz) / s + 64 + BORDER;
    g.fillStyle = "#8b1a1a";
    g.fillRect(mx - 2, mz - 2, 5, 5);
  }
  for (const b of m.banners ?? []) {
    const bx = Math.round((b.x + 0.5 - m.cx) / s + 64 + BORDER), bz = Math.round((b.z + 0.5 - m.cz) / s + 64 + BORDER);
    const c = DYE_RGB[b.color as Dye] ?? 0xffffff;
    g.fillStyle = "#3a2a1a";
    g.fillRect(bx - 3, bz - 4, 1, 8);
    g.fillRect(bx - 3, bz - 4, 7, 1);
    g.fillStyle = `#${c.toString(16).padStart(6, "0")}`;
    g.fillRect(bx - 2, bz - 3, 5, 5);
    g.fillRect(bx - 1, bz + 2, 3, 1);
    if (b.name) label(g, b.name, bx, bz);
  }
  for (const f of Object.values(m.frames ?? {})) arrow(g, (f.x + 0.5 - m.cx) / s + 64 + BORDER, (f.z + 0.5 - m.cz) / s + 64 + BORDER, f.rot, "#3fbf3f");
}

// Player marker in canvas map pixels; dot is the off-map dot radius, 0 for the arrow.
function playerMarker(m: MapData) {
  if (viewer.dim !== m.dim) return null;
  const s = 1 << m.scale;
  const fx = (viewer.x - m.cx) / s, fz = (viewer.z - m.cz) / s;
  const off = Math.abs(fx) > 63 || Math.abs(fz) > 63;
  // Vanilla: off-map dot within 320 map pixels; past that only explorer maps keep a smaller dot.
  const far = Math.abs(fx) >= 320 || Math.abs(fz) >= 320;
  if (off && far && !m.marker) return null;
  return {
    x: Math.max(-63, Math.min(63, fx)) + 64 + BORDER,
    z: Math.max(-63, Math.min(63, fz)) + 64 + BORDER,
    yaw: viewer.yaw,
    dot: off ? (far ? 1.5 : 2.5) : 0,
  };
}

const MARK = 10;

function markerTexture(kind: "arrow" | "dot") {
  let t = markerTex[kind];
  if (t) return t;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = MARK * RES;
  const g = canvas.getContext("2d")!;
  g.scale(RES, RES);
  g.translate(MARK / 2, MARK / 2);
  if (kind === "dot") dot(g, 2.5);
  else arrowPath(g, "#fff");
  t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  markerTex[kind] = t;
  return t;
}

// Player marker for a held map as a small sprite over the map plane, so walking never redraws the map.
// x and y run -0.5..0.5 across the plane (y up), size is a fraction of the plane, rot is counterclockwise.
export function mapPlayerMarker(stack: ItemStack | null | undefined) {
  if (typeof document === "undefined" || stack?.item !== "filled_map") return null;
  const m = mapById(typeof stack.data?.map === "number" ? stack.data.map : -1);
  const p = m && playerMarker(m);
  if (!p) return null;
  return {
    tex: markerTexture(p.dot ? "dot" : "arrow"),
    x: p.x / SIZE - 0.5,
    y: 0.5 - p.z / SIZE,
    size: ((p.dot ? p.dot / 2.5 : 1) * MARK) / SIZE,
    rot: p.dot ? 0 : p.yaw,
  };
}

function disposeEntry(e: Entry) {
  e.colors.tex.dispose();
  e.deco?.tex.dispose();
}

function sweep(now: number) {
  sweptAt = now;
  for (const cache of [entries, framed])
    for (const [id, e] of cache)
      if (now - e.used > IDLE_MS) {
        disposeEntry(e);
        cache.delete(id);
      }
  for (const [k, l] of labels) if (now - l.used > IDLE_MS) labels.delete(k);
}

// Live texture for a filled map stack, redrawn when its pixels change. Callers must use the returned texture each frame: idle ones are freed.
function newLayer(px: number, inFrame: boolean): Layer {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (inFrame) {
    tex.repeat.set(128 / SIZE, 128 / SIZE);
    tex.offset.set(BORDER / SIZE, BORDER / SIZE);
  }
  return { canvas, tex };
}

const decoKey = (m: MapData) => (m.marker || m.banners?.length || Object.keys(m.frames ?? {}).length ? JSON.stringify([m.marker, m.banners, m.frames]) : "");

function entryFor(stack: ItemStack | null | undefined, inFrame: boolean): Entry | null {
  if (typeof document === "undefined" || stack?.item !== "filled_map") return null;
  const id = typeof stack.data?.map === "number" ? stack.data.map : -1;
  const m = mapById(id);
  if (!m) return null;
  const cache = inFrame ? framed : entries;
  let e = cache.get(id);
  if (!e) {
    e = { colors: newLayer(SIZE, inFrame), deco: null, decoKey: "", version: -1, used: 0 };
    cache.set(id, e);
  }
  const now = performance.now();
  e.used = now;
  if (now - sweptAt > 1000) sweep(now);
  if (e.version === m.version) return e;
  e.version = m.version;
  paintColors(e.colors.canvas.getContext("2d")!, m, inFrame);
  e.colors.tex.needsUpdate = true;
  const key = decoKey(m);
  if (key === e.decoKey) return e;
  e.decoKey = key;
  if (!key) {
    e.deco?.tex.dispose();
    e.deco = null;
    return e;
  }
  e.deco ??= newLayer(SIZE * RES, inFrame);
  const g = e.deco.canvas.getContext("2d")!;
  g.setTransform(RES, 0, 0, RES, 0, 0);
  g.clearRect(0, 0, SIZE, SIZE);
  drawMarkers(g, m);
  e.deco.tex.needsUpdate = true;
  return e;
}

// Live texture of a filled map's colors, redrawn when its pixels change. Callers must use the returned texture each frame: idle ones are freed.
export function mapTexture(stack: ItemStack | null | undefined, inFrame = false): THREE.Texture | null {
  return entryFor(stack, inFrame)?.colors.tex ?? null;
}

// Transparent layer with the map's banners, frame arrows and explorer marker, or null when it has none. Shown over mapTexture.
export function mapDecorTexture(stack: ItemStack | null | undefined, inFrame = false): THREE.Texture | null {
  return entryFor(stack, inFrame)?.deco?.tex ?? null;
}

export function clearMapTextures() {
  for (const e of entries.values()) disposeEntry(e);
  for (const e of framed.values()) disposeEntry(e);
  entries.clear();
  framed.clear();
  previews.clear();
  labels.clear();
}


// Data URL of a filled map's colors for 2D screens such as the cartography table.
export function mapPreviewUrl(stack: ItemStack | null | undefined): string | null {
  if (typeof document === "undefined" || stack?.item !== "filled_map") return null;
  const id = typeof stack.data?.map === "number" ? stack.data.map : -1;
  const m = mapById(id);
  if (!m) return null;
  const hit = previews.get(id);
  if (hit && hit.version === m.version) return hit.url;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE * RES;
  draw(canvas, m);
  const url = canvas.toDataURL();
  previews.set(id, { version: m.version, url });
  return url;
}

// Blank map paper, the background of the cartography table's zoom preview.
export function mapPaperUrl(): string | null {
  if (typeof document === "undefined") return null;
  const hit = previews.get(-1);
  if (hit) return hit.url;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d")!;
  g.putImageData(paperImage(g), 0, 0);
  const url = canvas.toDataURL();
  previews.set(-1, { version: 0, url });
  return url;
}
