import * as THREE from "three";
import type { ItemStack } from "../../contracts";
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
  if (viewer.dim !== m.dim) return;
  let px = (viewer.x - m.cx) / s + 64, pz = (viewer.z - m.cz) / s + 64;
  const off = px < 0 || px > 127 || pz < 0 || pz > 127;
  px = Math.max(0, Math.min(127, px)) + BORDER;
  pz = Math.max(0, Math.min(127, pz)) + BORDER;
  g.save();
  g.translate(px, pz);
  if (off) {
    g.fillStyle = "#fff";
    g.fillRect(-2, -2, 4, 4);
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
}
