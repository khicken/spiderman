import * as THREE from "three";
import type { Entity, GameCtx, ItemStack } from "../contracts";
import { itemDef } from "../items/registry";

export type ArmorSlot = "head" | "chest" | "legs" | "feet";
export type Equipment = Partial<Record<ArmorSlot, ItemStack | null>>;

const PX = 1 / 16;
const W = 64, H = 32;

const BASE: Record<string, number> = {
  leather: 0xa06540, chainmail: 0x9a9a9a, iron: 0xd8d8d8, golden: 0xf2cd3c, diamond: 0x4aedd9, netherite: 0x4a4042, turtle: 0x47a036,
};
const TRIM: Record<string, number> = {
  iron_ingot: 0xc8c8c8, copper_ingot: 0xb4684d, gold_ingot: 0xdeb12d, lapis_lazuli: 0x416e97, emerald: 0x11a036, diamond: 0x6eecd2,
  netherite_ingot: 0x625859, redstone: 0x971607, amethyst_shard: 0x9a5cc6, quartz: 0xe3d4c4,
};

export function armorMaterial(item: string): string | null {
  if (item === "turtle_helmet") return "turtle";
  const m = item.match(/^(leather|chainmail|iron|golden|diamond|netherite)_(helmet|chestplate|leggings|boots)$/);
  return m ? m[1] : null;
}

function hash(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type Rect = [number, number, number, number];

// Vanilla cuboid unwrap at (u, v): top and bottom on the first row, then right, front, left, back.
function unwrap(u: number, v: number, w: number, h: number, d: number) {
  return {
    top: [u + d, v, w, d] as Rect,
    bottom: [u + d + w, v, w, d] as Rect,
    right: [u, v + d, d, h] as Rect,
    front: [u + d, v + d, w, h] as Rect,
    left: [u + d + w, v + d, d, h] as Rect,
    back: [u + d + w + d, v + d, w, h] as Rect,
  };
}

interface Paint {
  data: Uint8ClampedArray;
  mat: string;
  color: number;
  seed: number;
}

function put(p: Paint, x: number, y: number, k: number, color = p.color) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  let f = k * (0.9 + hash(x, y, p.seed) * 0.2);
  if (p.mat === "chainmail" && (x + y) % 2 === 0 && hash(x, y, 7) < 0.6) {
    p.data[i + 3] = 0;
    return;
  }
  if (p.mat === "diamond" || p.mat === "golden" || p.mat === "iron") f *= y % 4 === 0 ? 1.12 : 1;
  p.data[i] = Math.min(255, ((color >> 16) & 255) * f);
  p.data[i + 1] = Math.min(255, ((color >> 8) & 255) * f);
  p.data[i + 2] = Math.min(255, (color & 255) * f);
  p.data[i + 3] = 255;
}

function rect(p: Paint, r: Rect, y0 = 0, y1 = r[3], k = 1, edge = true) {
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < r[2]; x++) {
      const border = edge && (y === y0 || y === y1 - 1 || x === 0 || x === r[2] - 1);
      put(p, r[0] + x, r[1] + y, border ? k * 0.72 : k);
    }
}

function sides(p: Paint, c: ReturnType<typeof unwrap>, y0: number, y1: number, k = 1) {
  rect(p, c.right, y0, y1, k * 0.85);
  rect(p, c.front, y0, y1, k);
  rect(p, c.left, y0, y1, k * 0.85);
  rect(p, c.back, y0, y1, k * 0.9);
}

const textures = new Map<string, THREE.Texture>();

function armorTexture(mat: string, layer: 1 | 2, color: number, trim: { pattern: string; material: string } | undefined): THREE.Texture {
  const key = `${mat}:${layer}:${color}:${trim ? trim.pattern + trim.material : ""}`;
  let t = textures.get(key);
  if (t) return t;
  const p: Paint = { data: new Uint8ClampedArray(W * H * 4), mat, color, seed: mat.length * 31 + layer };
  if (layer === 1) {
    const head = unwrap(0, 0, 8, 8, 8);
    rect(p, head.top);
    sides(p, head, 0, 4);
    rect(p, head.right, 4, 8, 0.85);
    rect(p, head.left, 4, 8, 0.85);
    rect(p, head.back, 4, 8, 0.9);
    rect(p, [head.front[0], head.front[1] + 4, 1, 4], 0, 4, 0.8, false);
    rect(p, [head.front[0] + 7, head.front[1] + 4, 1, 4], 0, 4, 0.8, false);
    const body = unwrap(16, 16, 8, 12, 4);
    rect(p, body.top);
    rect(p, body.bottom);
    sides(p, body, 0, 12);
    for (let y = 2; y < 10; y += 3) for (let x = 2; x < 6; x++) put(p, body.front[0] + x, body.front[1] + y, 0.7);
    const arm = unwrap(40, 16, 4, 12, 4);
    rect(p, arm.top);
    sides(p, arm, 0, 6);
    const leg = unwrap(0, 16, 4, 12, 4);
    rect(p, leg.bottom, 0, 4, 0.7);
    sides(p, leg, 8, 12, 0.95);
  } else {
    const body = unwrap(16, 16, 8, 12, 4);
    sides(p, body, 7, 12, 0.9);
    rect(p, body.bottom);
    const leg = unwrap(0, 16, 4, 12, 4);
    rect(p, leg.top);
    sides(p, leg, 0, 10);
  }
  if (trim) {
    const tc = TRIM[trim.material] ?? 0xc8c8c8;
    const s = trim.pattern.length * 13;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (p.data[i + 3] && (x + y + s) % 5 === 0 && hash(x >> 1, y >> 1, s) < 0.55) put(p, x, y, 1, tc);
      }
  }
  const tex = new THREE.DataTexture(flip(p.data), W, H, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  textures.set(key, tex);
  return tex;
}

function flip(src: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < H; y++) out.set(src.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  return out;
}

function cuboid(w: number, h: number, d: number, u: number, v: number, inflate: number, mirror: boolean): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry((w + inflate * 2) * PX, (h + inflate * 2) * PX, (d + inflate * 2) * PX);
  const r = (x: number, y: number, rw: number, rh: number) => [x / W, 1 - y / H, (x + rw) / W, 1 - (y + rh) / H];
  const faces = [r(u, v + d, d, h), r(u + d + w, v + d, d, h), r(u + d, v, w, d), r(u + d + w, v, w, d), r(u + d + w + d, v + d, w, h), r(u + d, v + d, w, h)];
  if (mirror) [faces[0], faces[1]] = [faces[1], faces[0]];
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    let [u0, v0, u1, v1] = faces[f];
    if (mirror) [u0, u1] = [u1, u0];
    uv.setXY(f * 4, u0, v0);
    uv.setXY(f * 4 + 1, u1, v0);
    uv.setXY(f * 4 + 2, u0, v1);
    uv.setXY(f * 4 + 3, u1, v1);
  }
  return g;
}

type PieceSpec = [string, 1 | 2, number, number, number, number, number, number, boolean];
const PIECES: Record<ArmorSlot, PieceSpec[]> = {
  head: [["head", 1, 8, 8, 8, 0, 0, 1, false]],
  chest: [["body", 1, 8, 12, 4, 16, 16, 1, false], ["right_arm", 1, 4, 12, 4, 40, 16, 1, false], ["left_arm", 1, 4, 12, 4, 40, 16, 1, true]],
  legs: [["body", 2, 8, 12, 4, 16, 16, 0.5, false], ["right_leg", 2, 4, 12, 4, 0, 16, 0.5, false], ["left_leg", 2, 4, 12, 4, 0, 16, 0.5, true]],
  feet: [["right_leg", 1, 4, 12, 4, 0, 16, 1, false], ["left_leg", 1, 4, 12, 4, 0, 16, 1, true]],
};
const SLOTS: ArmorSlot[] = ["head", "chest", "legs", "feet"];

const GLINT_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GLINT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
uniform sampler2D map;
varying vec2 vUv;
void main() {
  if (texture2D(map, vUv).a < 0.1) discard;
  float s = fract((vUv.x * 4.0 + vUv.y * 2.0) * 1.5 - uTime * 0.35);
  float k = smoothstep(0.0, 0.25, s) * smoothstep(0.6, 0.3, s);
  gl_FragColor = vec4(vec3(0.5, 0.25, 0.8) * k * 0.6 * uStrength, 1.0);
}`;

export const GLINT_TIME = { value: 0 };
export const GLINT_STRENGTH = { value: 1 }; // Glint Strength option over its 0.75 default

export function glintMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: GLINT_TIME, uStrength: GLINT_STRENGTH, map: { value: map } },
    vertexShader: GLINT_VERT,
    fragmentShader: GLINT_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
  });
}

export interface ArmorLayer {
  set(eq: Equipment): boolean; // true when the meshes changed
  setLight(v: number, hurt: boolean): void;
  dispose(): void;
}

const stackKey = (s: ItemStack | null | undefined) => (s ? `${s.item}:${s.data?.color ?? ""}:${s.ench ? 1 : 0}:${JSON.stringify(s.data?.trim ?? "")}` : "");

// Armor cuboids sit on the named joints, centered on each joint's own box, so humanoid rigs of any proportions can wear them.
export function createArmorLayer(parts: Record<string, THREE.Object3D>, basic: boolean): ArmorLayer {
  const keys: Record<ArmorSlot, string> = { head: "", chest: "", legs: "", feet: "" };
  const meshes: Record<ArmorSlot, THREE.Mesh[]> = { head: [], chest: [], legs: [], feet: [] };
  const mats: (THREE.MeshBasicMaterial | THREE.MeshLambertMaterial)[] = [];

  function clear(slot: ArmorSlot) {
    for (const m of meshes[slot]) {
      m.removeFromParent();
      m.geometry.dispose();
      const list = Array.isArray(m.material) ? m.material : [m.material];
      for (const mm of list) {
        mm.dispose();
        const i = mats.indexOf(mm as THREE.MeshBasicMaterial);
        if (i >= 0) mats.splice(i, 1);
      }
    }
    meshes[slot] = [];
  }

  function center(joint: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
    const own = joint.children.find((c) => (c as THREE.Mesh).isMesh && !c.userData.armor) as THREE.Mesh | undefined;
    return own ? out.copy(own.position) : out.set(0, 0, 0);
  }

  function build(slot: ArmorSlot, s: ItemStack) {
    const mat = armorMaterial(s.item);
    if (!mat) return;
    const color = mat === "leather" ? (typeof s.data?.color === "number" ? (s.data.color as number) : BASE.leather) : BASE[mat];
    const trim = s.data?.trim as { pattern: string; material: string } | undefined;
    for (const [name, layer, w, h, d, u, v, inflate, mirror] of PIECES[slot]) {
      const joint = parts[name];
      if (!joint) continue;
      if (slot === "head" && mat === "turtle" && layer !== 1) continue;
      const tex = armorTexture(mat, layer, color, trim);
      const m = basic ? new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.1 }) : new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.1 });
      mats.push(m);
      const geo = cuboid(w, h, d, u, v, inflate, mirror);
      const list: THREE.Material[] = [m];
      if (s.ench && Object.keys(s.ench).length) list.push(glintMaterial(tex));
      geo.clearGroups();
      for (let i = 0; i < list.length; i++) geo.addGroup(0, Infinity, i);
      const mesh = new THREE.Mesh(geo, list.length > 1 ? list : m);
      mesh.userData.armor = true;
      center(joint, mesh.position);
      joint.add(mesh);
      meshes[slot].push(mesh);
    }
  }

  return {
    set(eq) {
      let changed = false;
      for (const slot of SLOTS) {
        const k = stackKey(eq[slot]);
        if (k === keys[slot]) continue;
        keys[slot] = k;
        clear(slot);
        const s = eq[slot];
        if (s) build(slot, s);
        changed = true;
      }
      return changed;
    },
    setLight(v, hurt) {
      for (const m of mats) {
        if (hurt) m.color.setRGB(Math.min(1, v * 1.2 + 0.3), v * 0.45, v * 0.45);
        else m.color.setScalar(v);
      }
    },
    dispose() {
      for (const slot of SLOTS) clear(slot);
    },
  };
}

// Vanilla Monster.populateDefaultEquipmentSlots on normal difficulty: 15% for armor, tier rolls up 9.5% at a time, 50% to stop after each piece.
export function rollMobArmor(rand: () => number, difficulty: string): Equipment | null {
  const chance = difficulty === "hard" ? 0.25 : difficulty === "easy" ? 0.05 : 0.15;
  if (rand() >= chance) return null;
  let tier = rand() < 0.095 ? 1 : 0;
  if (rand() < 0.095) tier++;
  if (rand() < 0.095) tier++;
  const mat = ["leather", "golden", "chainmail", "iron", "diamond"][tier];
  const stop = difficulty === "hard" ? 0.1 : 0.25;
  const eq: Equipment = {};
  const order: [ArmorSlot, string][] = [["feet", "boots"], ["legs", "leggings"], ["chest", "chestplate"], ["head", "helmet"]];
  for (let i = 0; i < order.length; i++) {
    if (i > 0 && rand() < stop) break;
    eq[order[i][0]] = { item: `${mat}_${order[i][1]}`, count: 1 };
  }
  return eq;
}

// Rolls natural-spawn armor once and folds its points into the mob's armor value.
export function equipMob(e: Entity, ctx: GameCtx): void {
  if (e.data._armorRolled) return;
  e.data._armorRolled = true;
  const eq = (e.data.equipment as Equipment | undefined) ?? (e.data.natural ? rollMobArmor(ctx.random, ctx.rules.difficulty) : null);
  if (!eq) return;
  e.data.equipment = eq;
  let pts = 0, tough = 0;
  for (const slot of SLOTS) {
    const a = eq[slot] ? itemDef(eq[slot]!.item)?.armor : undefined;
    if (a) {
      pts += a.points;
      tough += a.toughness;
    }
  }
  e.data.armor = Number(e.data.armor ?? 0) + pts;
  e.data.toughness = Number(e.data.toughness ?? 0) + tough;
  if (eq.head) e.data.helmet = true;
}
