import * as THREE from "three";
import type { ItemStack } from "../../contracts";
import { DYE_RGB, type Dye } from "../../entities/passive/common";
import { MAP_BASE, SHADE } from "./map-colors";
import { mapById, type MapData } from "./maps";

const SIZE = 142;
const BORDER = 7;
const viewer = { x: 0, z: 0, yaw: 0, dim: "overworld" as string, moved: 0 };

interface Entry {
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  version: number;
  drawn: number;
}

const entries = new Map<number, Entry>();
const previews = new Map<number, { version: number; url: string }>();
let paper: ImageData | null = null;

export function setMapViewer(x: number, z: number, yaw: number, dim: string) {
  if (Math.abs(x - viewer.x) + Math.abs(z - viewer.z) + Math.abs(yaw - viewer.yaw) > 0.2 || dim !== viewer.dim) viewer.moved++;
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

function draw(e: Entry, m: MapData) {
  const g = e.canvas.getContext("2d")!;
  const img = g.createImageData(SIZE, SIZE);
  img.data.set(paperImage(g).data);
  for (let i = 0; i < 128 * 128; i++) {
    const v = m.colors[i];
    if (!v) continue;
    const base = MAP_BASE[v >> 2], k = SHADE[v & 3];
    const o = ((((i >> 7) + BORDER) * SIZE) + (i & 127) + BORDER) * 4;
    img.data[o] = (((base >> 16) & 255) * k) / 255;
    img.data[o + 1] = (((base >> 8) & 255) * k) / 255;
    img.data[o + 2] = ((base & 255) * k) / 255;
  }
  g.putImageData(img, 0, 0);
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
  }
  if (viewer.dim !== m.dim) return;
  const fx = (viewer.x - m.cx) / s, fz = (viewer.z - m.cz) / s;
  const off = Math.abs(fx) > 63 || Math.abs(fz) > 63;
  // Vanilla: off-map dot within 320 map pixels; past that only explorer maps keep a smaller dot.
  const far = Math.abs(fx) >= 320 || Math.abs(fz) >= 320;
  if (off && far && !m.marker) return;
  const px = Math.max(-63, Math.min(63, fx)) + 64 + BORDER;
  const pz = Math.max(-63, Math.min(63, fz)) + 64 + BORDER;
  g.save();
  g.translate(px, pz);
  if (off) {
    const r = far ? 1.5 : 2.5;
    g.fillStyle = "#fff";
    g.strokeStyle = "#222";
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  } else {
    g.rotate(-viewer.yaw);
    g.beginPath();
    g.moveTo(0, -4);
    g.lineTo(3, 4);
    g.lineTo(0, 2);
    g.lineTo(-3, 4);
    g.closePath();
    g.fillStyle = "#fff";
    g.strokeStyle = "#222";
    g.lineWidth = 1;
    g.fill();
    g.stroke();
  }
  g.restore();
}

// Live texture for a filled map stack, redrawn when its pixels change or the holder moves.
export function mapTexture(stack: ItemStack | null | undefined): THREE.Texture | null {
  if (typeof document === "undefined" || stack?.item !== "filled_map") return null;
  const id = typeof stack.data?.map === "number" ? stack.data.map : -1;
  const m = mapById(id);
  if (!m) return null;
  let e = entries.get(id);
  if (!e) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    e = { canvas, tex, version: -1, drawn: -1 };
    entries.set(id, e);
  }
  if (e.version !== m.version || e.drawn !== viewer.moved) {
    e.version = m.version;
    e.drawn = viewer.moved;
    draw(e, m);
    e.tex.needsUpdate = true;
  }
  return e.tex;
}

export function clearMapTextures() {
  for (const e of entries.values()) e.tex.dispose();
  entries.clear();
  previews.clear();
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
  canvas.width = canvas.height = SIZE;
  draw({ canvas, tex: null as unknown as THREE.CanvasTexture, version: 0, drawn: 0 }, m);
  const url = canvas.toDataURL();
  previews.set(id, { version: m.version, url });
  return url;
}
