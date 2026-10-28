import * as THREE from "three";
import { boxModel, makeSkin, type BoxModel } from "../entities/model";
import { paintSteveSkin } from "../player/model";

// What a player looks like: a default skin or an uploaded 64x64 PNG, arm width, and an optional 64x32 cape PNG.
export interface Look {
  kind: "steve" | "alex" | "custom";
  slim: boolean;
  png?: string;
  cape?: string;
}

export type Canvas = HTMLCanvasElement | OffscreenCanvas;

const KEY = "mc-skin";
const PNG = "data:image/png;base64,";
export const MAX_PNG = 40000;

const okPng = (v: unknown): v is string => typeof v === "string" && v.startsWith(PNG) && v.length <= MAX_PNG;

export function cleanLook(v: unknown): Look {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const kind = o.kind === "alex" || o.kind === "custom" ? o.kind : "steve";
  const png = kind === "custom" && okPng(o.png) ? o.png : undefined;
  const look: Look = { kind: kind === "custom" && !png ? "steve" : kind, slim: kind === "alex" || (kind === "custom" && o.slim === true) };
  if (png) look.png = png;
  if (okPng(o.cape)) look.cape = o.cape;
  return look;
}

export function localLook(): Look {
  try {
    return cleanLook(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return { kind: "steve", slim: false };
  }
}

export function setLocalLook(l: Look) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cleanLook(l)));
  } catch {}
}

const ALEX = { hair: "#e3913a", hairDark: "#c4762a", shirt: "#5f9e42", shirtDark: "#4d8636", pants: "#6b4a2f", pantsDark: "#5a3d26", eye: "#3a7d3a" };

// Alex: the default slim skin colors painted over the Steve layout.
export function paintAlex(img: Canvas) {
  const g = img.getContext("2d") as CanvasRenderingContext2D | null;
  if (!g) return;
  const rect = (c: string, x: number, y: number, w: number, h: number) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  rect(ALEX.hair, 8, 0, 8, 8);
  rect(ALEX.hair, 24, 8, 8, 8);
  rect(ALEX.hair, 0, 8, 8, 6);
  rect(ALEX.hair, 16, 8, 8, 6);
  rect(ALEX.hair, 8, 8, 8, 2);
  rect(ALEX.hairDark, 8, 8, 2, 4);
  rect(ALEX.hairDark, 14, 8, 2, 4);
  rect(ALEX.eye, 10, 12, 1, 1);
  rect(ALEX.eye, 13, 12, 1, 1);
  rect(ALEX.shirt, 20, 16, 16, 4);
  rect(ALEX.shirt, 16, 20, 24, 12);
  rect(ALEX.shirtDark, 16, 30, 24, 2);
  for (const [u, v] of [[40, 16], [32, 48]] as const) {
    rect(ALEX.shirt, u, v + 4, 16, 4);
    rect(ALEX.shirt, u + 4, v, 4, 4);
  }
  for (const [u, v] of [[0, 16], [16, 48]] as const) {
    rect(ALEX.pants, u, v + 4, 16, 9);
    rect(ALEX.pantsDark, u, v + 12, 16, 1);
  }
}

export async function decodePng(url: string | undefined, w: number, h: number): Promise<Canvas | null> {
  if (!okPng(url)) return null;
  try {
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    if (bmp.width !== w || bmp.height !== h) return null;
    const { canvas, ctx } = makeSkin(w, h);
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return canvas;
  } catch {
    return null;
  }
}

// Vanilla ignores alpha on the base skin layer; only the outer layer may be see-through.
function opaqueBase(c: Canvas) {
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  for (const [x0, y0, x1, y1] of [[0, 0, 32, 16], [0, 16, 64, 32], [16, 48, 48, 64]]) {
    const d = g.getImageData(x0, y0, x1 - x0, y1 - y0);
    for (let i = 3; i < d.data.length; i += 4) d.data[i] = 255;
    g.putImageData(d, x0, y0);
  }
}

export interface Painted {
  slim: boolean;
  skin: Canvas;
  custom: boolean;
  cape: Canvas | null;
  ready: Promise<void>;
}

// Painted with the default now; uploaded art lands in the same canvases when it decodes.
export function paintLook(l: Look): Painted {
  const skin = paintSteveSkin();
  if (l.kind === "alex") paintAlex(skin);
  const cape = l.cape ? makeSkin(64, 32).canvas : null;
  const ready = Promise.all([
    l.kind === "custom" ? decodePng(l.png, 64, 64) : null,
    l.cape ? decodePng(l.cape, 64, 32) : null,
  ]).then(([s, c]) => {
    if (s) {
      const g = skin.getContext("2d") as CanvasRenderingContext2D;
      g.clearRect(0, 0, 64, 64);
      g.drawImage(s as CanvasImageSource, 0, 0);
      opaqueBase(skin);
    }
    if (c && cape) (cape.getContext("2d") as CanvasRenderingContext2D).drawImage(c as CanvasImageSource, 0, 0);
  });
  return { slim: l.slim, skin, custom: l.kind === "custom", cape, ready };
}

export interface CapeInput {
  x: number;
  y: number;
  z: number;
  bodyYaw: number;
  onGround: boolean;
  sneaking: boolean;
  hidden: boolean;
}

export interface Cape {
  update(o: CapeInput, dt: number): void;
  setLight(v: number): void;
  dispose(): void;
}

const D = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Vanilla CapeLayer: the cloak point trails the player by a quarter per tick and the cape swings from that lag.
export function createCape(root: THREE.Object3D, canvas: Canvas, ready?: Promise<void>): Cape {
  const m: BoxModel = boxModel(canvas, [{ name: "cape", pivot: [0, 24, 2], box: [-5, -16, 0, 10, 16, 1], uv: [0, 0] }]);
  const mat = new THREE.MeshBasicMaterial({ map: m.material.map, alphaTest: 0.1, side: THREE.DoubleSide });
  m.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat;
  });
  root.add(m.root);
  void ready?.then(() => {
    if (mat.map) mat.map.needsUpdate = true;
  });
  const joint = m.parts.cape;
  joint.rotation.order = "XZY";
  const cloak = new THREE.Vector3(NaN, 0, 0);
  const last = new THREE.Vector3(NaN, 0, 0);
  let bob = 0;
  let walk = 0;
  return {
    update(o, dt) {
      m.root.visible = !o.hidden;
      if (Number.isNaN(cloak.x) || Math.abs(o.x - cloak.x) > 10 || Math.abs(o.y - cloak.y) > 10 || Math.abs(o.z - cloak.z) > 10) cloak.set(o.x, o.y, o.z);
      if (Number.isNaN(last.x)) last.set(o.x, o.y, o.z);
      const ticks = Math.min(1, dt) * 20;
      const moved = Math.hypot(o.x - last.x, o.z - last.z);
      last.set(o.x, o.y, o.z);
      const k = 1 - Math.pow(0.75, ticks);
      cloak.x += (o.x - cloak.x) * k;
      cloak.y += (o.y - cloak.y) * k;
      cloak.z += (o.z - cloak.z) * k;
      const perTick = ticks > 0 ? moved / ticks : 0;
      bob += ((o.onGround ? Math.min(0.1, perTick) : 0) - bob) * (1 - Math.pow(0.6, ticks));
      walk += moved * 0.6;
      if (o.hidden) return;
      const dx = cloak.x - o.x, dy = cloak.y - o.y, dz = cloak.z - o.z;
      const bx = Math.sin(o.bodyYaw), bz = Math.cos(o.bodyYaw);
      let lift = clamp(dy * 10, -6, 32);
      const back = clamp((dx * bx + dz * bz) * 100, 0, 150);
      const side = clamp((dx * bz - dz * bx) * 100, -20, 20);
      lift += Math.sin(walk * 6) * 32 * bob;
      if (o.sneaking) lift += 25;
      joint.position.set(0, (24 - (o.sneaking ? 1.85 : 0)) / 16, (2 + (o.sneaking ? 1.4 : 0)) / 16);
      joint.rotation.set(-(6 + back / 2 + lift) * D, -(180 - side / 2) * D, (side / 2) * D);
    },
    setLight(v) {
      mat.color.setScalar(v);
    },
    dispose() {
      m.root.removeFromParent();
      mat.dispose();
      m.dispose();
    },
  };
}
