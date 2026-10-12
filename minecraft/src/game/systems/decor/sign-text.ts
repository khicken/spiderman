import * as THREE from "three";
import type { BlockEntityData, BlockState, GameCtx } from "../../contracts";
import { metaOf } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { daylight } from "../../entities/ai";
import { brightnessAt } from "../../entities/render";
import { rasterText } from "../../ui/font";

export interface SignShape {
  angle: number; // yaw of the front normal, radians (0 faces +z)
  cy: number;
  offset: number;
  hanging: boolean;
  wall: boolean;
}

export interface SignData {
  front: string[];
  back?: string[];
  color?: string;
  glowing?: boolean;
  backColor?: string;
  backGlowing?: boolean;
  waxed?: boolean;
}

export const DYE_COLORS: Record<string, number> = {
  white: 0xffffff, orange: 0xff681f, magenta: 0xff00ff, light_blue: 0x9ac0cd, yellow: 0xffff00, lime: 0xbfff00, pink: 0xff69b4, gray: 0x808080,
  light_gray: 0xd3d3d3, cyan: 0x00ffff, purple: 0xa020f0, blue: 0x0000ff, brown: 0x8b4513, green: 0x00ff00, red: 0xff0000, black: 0x000000,
};

export const isSign = (s: BlockState) => {
  const t = blockDef(s).tags;
  return !!t && (t.includes("signs") || t.includes("hanging_signs"));
};

export function signShape(s: BlockState): SignShape {
  const d = blockDef(s);
  const m = metaOf(s);
  const hanging = !!d.tags?.includes("hanging_signs");
  const wall = d.name.includes("_wall_");
  const angle = wall ? -(m & 3) * (Math.PI / 2) : -m * (Math.PI / 8);
  if (hanging) return { angle, cy: 5 / 16, offset: 1 / 16, hanging, wall };
  if (wall) return { angle, cy: 8.5 / 16, offset: 1.75 / 16 - 0.5, hanging, wall };
  return { angle, cy: 12 / 16, offset: 0.75 / 16, hanging, wall };
}

export const lineWidth = (hanging: boolean) => (hanging ? 60 : 90);
const LINE_H = (hanging: boolean) => (hanging ? 9 : 10);
const TEX_W = (hanging: boolean) => (hanging ? 64 : 96);
const TEX_H = (hanging: boolean) => LINE_H(hanging) * 4;
const SCALE = 1 / 96;

export function readSign(be: BlockEntityData | undefined): SignData {
  const d = (be?.data ?? {}) as Partial<SignData>;
  const lines = (v: unknown) => [0, 1, 2, 3].map((i) => (Array.isArray(v) && typeof v[i] === "string" ? (v[i] as string) : ""));
  return { ...d, front: lines(d.front), back: lines(d.back) };
}

const dark = (c: number, k: number) => ((((c >> 16) & 255) * k) << 16) | ((((c >> 8) & 255) * k) << 8) | ((c & 255) * k);

function paint(canvas: HTMLCanvasElement, lines: string[], color: number, glowing: boolean, hanging: boolean) {
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const lh = LINE_H(hanging);
  const body = glowing ? color : dark(color, 0.4);
  const outline = glowing ? (color === 0 ? 0xf0ebcc : dark(color, 0.4)) : -1;
  for (let i = 0; i < 4; i++) {
    const text = lines[i];
    if (!text) continue;
    const r = rasterText(text, body, false);
    const x0 = Math.floor((canvas.width - r.width) / 2);
    const y0 = i * lh + Math.floor((lh - 8) / 2);
    const img = new ImageData(new Uint8ClampedArray(r.data), r.width, r.height);
    if (outline >= 0) {
      const o = rasterText(text, outline, false);
      const oimg = new ImageData(new Uint8ClampedArray(o.data), o.width, o.height);
      const tmp = document.createElement("canvas");
      tmp.width = o.width;
      tmp.height = o.height;
      tmp.getContext("2d")!.putImageData(oimg, 0, 0);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) g.drawImage(tmp, x0 + dx, y0 + dy);
      tmp.width = r.width;
      tmp.getContext("2d")!.putImageData(img, 0, 0);
      g.drawImage(tmp, x0, y0);
    } else {
      const tmp = document.createElement("canvas");
      tmp.width = r.width;
      tmp.height = r.height;
      tmp.getContext("2d")!.putImageData(img, 0, 0);
      g.drawImage(tmp, x0, y0);
    }
  }
}

interface Side {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  tex: THREE.CanvasTexture;
  glowing: boolean;
}

interface SignView {
  key: number;
  x: number;
  y: number;
  z: number;
  group: THREE.Group;
  sides: Side[];
}

const geoCache = new Map<boolean, THREE.PlaneGeometry>();
function plane(hanging: boolean) {
  let g = geoCache.get(hanging);
  if (!g) {
    g = new THREE.PlaneGeometry(TEX_W(hanging) * SCALE, TEX_H(hanging) * SCALE);
    geoCache.set(hanging, g);
  }
  return g;
}

export function createSignTexts(ctx: GameCtx) {
  const views = new Map<number, SignView>();
  const scene = ctx.renderer.scene;

  function side(group: THREE.Group, lines: string[], color: number, glowing: boolean, sh: SignShape, back: boolean): Side | null {
    if (!lines.some((l) => l)) return null;
    const canvas = document.createElement("canvas");
    canvas.width = TEX_W(sh.hanging);
    canvas.height = TEX_H(sh.hanging);
    paint(canvas, lines, color, glowing, sh.hanging);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(plane(sh.hanging), mat);
    mesh.position.set(0, 0, sh.offset + 0.003);
    if (back) {
      mesh.position.z = -sh.offset - 0.003;
      mesh.rotation.y = Math.PI;
    }
    group.add(mesh);
    return { mesh, mat, tex, glowing };
  }

  function remove(key: number) {
    const v = views.get(key);
    if (!v) return;
    scene.remove(v.group);
    for (const s of v.sides) {
      s.mat.dispose();
      s.tex.dispose();
    }
    views.delete(key);
  }

  function refresh(key: number, x: number, y: number, z: number) {
    remove(key);
    const s = ctx.world.getBlock(x, y, z);
    if (!isSign(s)) return;
    const be = ctx.world.getBlockEntity(x, y, z);
    if (!be || be.type !== "sign") return;
    const d = readSign(be);
    const sh = signShape(s);
    const group = new THREE.Group();
    group.position.set(x + 0.5, y + sh.cy, z + 0.5);
    group.rotation.y = sh.angle;
    const sides: Side[] = [];
    const f = side(group, d.front, DYE_COLORS[d.color ?? "black"] ?? 0, !!d.glowing, sh, false);
    if (f) sides.push(f);
    if (!sh.wall) {
      const b = side(group, d.back ?? [], DYE_COLORS[d.backColor ?? "black"] ?? 0, !!d.backGlowing, sh, true);
      if (b) sides.push(b);
    }
    if (!sides.length) return;
    scene.add(group);
    const v = { key, x, y, z, group, sides };
    views.set(key, v);
    shadeOne(v, daylight(ctx));
  }

  function shadeOne(v: SignView, day: number) {
    const br = brightnessAt(ctx, v.x + 0.5, v.y + 0.5, v.z + 0.5, day);
    for (const s of v.sides) s.mat.color.setScalar(s.glowing ? 1 : br);
  }

  let frameNo = 0;
  return {
    refresh,
    remove,
    keys: () => views.keys(),
    get: (key: number) => views.get(key),
    frame() {
      if (frameNo++ % 10 !== 0) return;
      const day = daylight(ctx);
      for (const v of views.values()) shadeOne(v, day);
    },
    dispose() {
      for (const k of [...views.keys()]) remove(k);
    },
  };
}

export type SignTexts = ReturnType<typeof createSignTexts>;
