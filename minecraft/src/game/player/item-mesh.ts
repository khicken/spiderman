import * as THREE from "three";
import type { BlockDef, ChunkUniforms } from "../contracts";
import { blockByName } from "../blocks/registry";
import { blockGeometry } from "../mesh/block-geometry";
import { buffersToGeometry, createHeldMaterial } from "../mesh/materials";
import { isFlatBlock } from "../textures/items-iso";
import { hasItemPainter } from "../textures/items";
import { itemDef } from "../items/registry";
import { paintBlockTexture } from "../textures/index";
import { itemSpritePixels } from "../textures/icons";
import { dialFrame, paintDial } from "../textures/dials";
import type { ItemStack } from "../contracts";
import { GLINT_STRENGTH, GLINT_TIME } from "../entities/armor-layer";
import { createShieldModel } from "./shield-model";
import { tridentGeometry } from "../entities/hostile/held";
import { packVersion } from "../packs";

export function itemKey(s: ItemStack | null): string | null {
  if (!s) return null;
  const f = dialFrame(s);
  const banner = s.item === "shield" && typeof s.data?.banner === "string" ? `~${s.data.banner}~${JSON.stringify(s.data.patterns ?? [])}` : "";
  const base = f === null ? s.item + banner : `${s.item}@${f}`;
  return s.ench && Object.keys(s.ench).length ? `${base}#glint` : base;
}

const GLINT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
varying vec3 vPos;
void main() {
  float s = fract((vPos.x * 2.0 + vPos.y) * 1.5 - uTime * 0.35);
  float k = smoothstep(0.0, 0.25, s) * smoothstep(0.6, 0.3, s);
  gl_FragColor = vec4(vec3(0.5, 0.25, 0.8) * k * 0.7 * uStrength, 1.0);
}`;
const GLINT_VERT = /* glsl */ `
varying vec3 vPos;
void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export type ItemKind = "block" | "flat" | "shield";

export interface ItemModel {
  kind: ItemKind;
  create(): THREE.Object3D;
}

const TINTS: Record<string, number> = { grass: 0x91bd59, foliage: 0x77ab2f, water: 0x3f76e4, birch: 0x80a755, spruce: 0x619961, stem: 0xe0c71c };
const BOXY = new Set(["cube", "slab", "stairs", "chest", "cactus", "farmland", "path", "carpet", "snow_layer", "cake", "enchanting_table", "end_portal_frame", "lectern", "cauldron", "hopper", "anvil", "campfire", "pressure_plate"]);
const SHADE = [0.6, 0.6, 1, 0.5, 0.8, 0.8]; // vanilla face shading: E W U D S N

const lin = (c: number) => Math.pow(c / 255, 2.2);

function tinted(src: Uint8ClampedArray, c: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  for (let i = 0; i < out.length; i += 4) {
    out[i] = (out[i] * r) / 255;
    out[i + 1] = (out[i + 1] * g) / 255;
    out[i + 2] = (out[i + 2] * b) / 255;
  }
  return out;
}

// Voxel-extruded 16x16 sprite like vanilla item/generated, in a 1x1 box centered at the origin.
export function extrudeSprite(rgba: Uint8ClampedArray): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const S = 1 / 16;
  const z0 = 7.5 / 16 - 0.5, z1 = 8.5 / 16 - 0.5;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && rgba[(y * 16 + x) * 4 + 3] > 127;
  const quad = (v: number[], r: number, g: number, b: number, shade: number) => {
    const n = pos.length / 3;
    pos.push(...v);
    for (let k = 0; k < 4; k++) col.push(r * shade, g * shade, b * shade);
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  };
  for (let py = 0; py < 16; py++)
    for (let px = 0; px < 16; px++) {
      if (!solid(px, py)) continue;
      const o = (py * 16 + px) * 4;
      const r = lin(rgba[o]), g = lin(rgba[o + 1]), b = lin(rgba[o + 2]);
      const x0 = px * S - 0.5, x1 = x0 + S;
      const y1 = 0.5 - py * S, y0 = y1 - S;
      quad([x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], r, g, b, 1);
      quad([x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0], r, g, b, 1);
      if (!solid(px, py - 1)) quad([x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], r, g, b, 1);
      if (!solid(px, py + 1)) quad([x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], r, g, b, 0.5);
      if (!solid(px - 1, py)) quad([x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0], r, g, b, 0.6);
      if (!solid(px + 1, py)) quad([x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1], r, g, b, 0.6);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

function faceKeys(def: BlockDef): string[] {
  const t = def.textures;
  const side = t.side ?? t.all ?? def.name;
  const top = t.top ?? t.end ?? t.all ?? side;
  const bottom = t.bottom ?? t.end ?? t.top ?? t.all ?? side;
  return [t.east ?? side, t.west ?? side, top, bottom, t.south ?? t.front ?? side, t.north ?? side];
}

function boxSize(def: BlockDef): [number, number, number, number] {
  switch (def.shape) {
    case "slab": return [1, 0.5, 1, -0.25];
    case "carpet": return [1, 1 / 16, 1, -0.5 + 1 / 32];
    case "pressure_plate": return [14 / 16, 1 / 16, 14 / 16, -0.5 + 1 / 32];
    case "snow_layer": return [1, 2 / 16, 1, -0.5 + 1 / 16];
    case "farmland": case "path": return [1, 15 / 16, 1, -1 / 32];
    case "chest": return [14 / 16, 14 / 16, 14 / 16, -1 / 16];
    case "cactus": return [14 / 16, 1, 14 / 16, 0];
    case "cake": return [14 / 16, 0.5, 14 / 16, -0.25];
    case "enchanting_table": return [1, 0.75, 1, -0.125];
    case "end_portal_frame": return [1, 13 / 16, 1, -3 / 32];
    case "campfire": return [1, 7 / 16, 1, -9 / 32];
    default: return [1, 1, 1, 0];
  }
}

export interface ItemMeshes {
  model(name: string): ItemModel | null;
  setLight(v: number): void;
  setLevels(sky: number, block: number): void;
  dispose(): void;
}

export function createItemMeshes(getUniforms?: () => ChunkUniforms | undefined): ItemMeshes {
  let held: ReturnType<typeof createHeldMaterial> | null = null;
  const heldMat = () => {
    const u = getUniforms?.();
    if (!held && u?.uDimLight) held = createHeldMaterial(u, true);
    return held;
  };
  const cache = new Map<string, ItemModel | null>();
  const textures = new Map<string, THREE.DataTexture>();
  const geos: THREE.BufferGeometry[] = [];
  const shaded: { mat: THREE.MeshBasicMaterial; shade: number }[] = [];
  const flatMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  shaded.push({ mat: flatMat, shade: 1 });

  const texture = (key: string, tint: number | null) => {
    const id = tint === null ? key : `${key}#${tint}`;
    let t = textures.get(id);
    if (!t) {
      const src = tint === null ? paintBlockTexture(key) : tinted(paintBlockTexture(key), tint);
      const data = new Uint8Array(16 * 16 * 4);
      for (let y = 0; y < 16; y++) data.set(src.subarray((15 - y) * 64, (16 - y) * 64), y * 64);
      t = new THREE.DataTexture(data, 16, 16, THREE.RGBAFormat);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      textures.set(id, t);
    }
    return t;
  };

  const glintMat = new THREE.ShaderMaterial({ uniforms: { uTime: GLINT_TIME, uStrength: GLINT_STRENGTH }, vertexShader: GLINT_VERT, fragmentShader: GLINT_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthFunc: THREE.LessEqualDepth });
  const shieldTexs: THREE.Texture[] = [];

  function build(key: string): ItemModel | null {
    if (key.endsWith("#glint")) {
      const inner = model(key.slice(0, -6));
      if (!inner) return null;
      return {
        kind: inner.kind,
        create: () => {
          const o = inner.create();
          const g = new THREE.Group();
          g.add(o);
          o.traverse((c) => {
            const mesh = c as THREE.Mesh;
            if (mesh.isMesh) g.add(new THREE.Mesh(mesh.geometry, glintMat));
          });
          return g;
        },
      };
    }
    const at = key.indexOf("@");
    if (at > 0) {
      const geo = extrudeSprite(paintDial(key.slice(0, at), Number(key.slice(at + 1))));
      geos.push(geo);
      return { kind: "flat", create: () => new THREE.Mesh(geo, flatMat) };
    }
    const name = key;
    if (name === "trident_in_hand" || name === "trident_throwing") return { kind: "flat", create: () => new THREE.Mesh(tridentGeometry(), flatMat) };
    if (name === "shield" || name.startsWith("shield~")) {
      const [, color, layers] = name.split("~");
      const sm = createShieldModel(color ? { color, patterns: JSON.parse(layers) } : undefined);
      geos.push(sm.geometry);
      shieldTexs.push(sm.texture);
      const mat = new THREE.MeshBasicMaterial({ map: sm.texture });
      shaded.push({ mat, shade: 1 });
      return { kind: "shield", create: () => new THREE.Mesh(sm.geometry, mat) };
    }
    const it = itemDef(name);
    const def = blockByName(it?.block ?? name);
    const solid = def && !it?.texture && !isFlatBlock(def) && !hasItemPainter(name);
    const hm = solid && def.layer !== "translucent" ? heldMat() : null;
    if (def && hm) {
      const b = blockGeometry(def.id);
      if (b.index.length) {
        const geo = buffersToGeometry(b);
        geos.push(geo);
        return { kind: "block", create: () => new THREE.Mesh(geo, hm) };
      }
    }
    if (def && solid && BOXY.has(def.shape)) {
      const [w, h, d, oy] = boxSize(def);
      const geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(0, oy, 0);
      geos.push(geo);
      const keys = faceKeys(def);
      const tint = def.tint ? TINTS[def.tint] ?? null : null;
      const mats = keys.map((k, f) => {
        const useTint = tint !== null && (def.name !== "grass_block" || f === 2);
        const mat = new THREE.MeshBasicMaterial({ map: texture(k, useTint ? tint : null), alphaTest: 0.1, transparent: def.layer === "translucent" });
        shaded.push({ mat, shade: SHADE[f] });
        return mat;
      });
      return { kind: "block", create: () => new THREE.Mesh(geo, mats) };
    }
    if (!it && !def && !hasItemPainter(name)) return null;
    const rgba = itemSpritePixels(name);
    const geo = extrudeSprite(solid && def.tint ? tinted(rgba, TINTS[def.tint] ?? 0xffffff) : rgba);
    geos.push(geo);
    return { kind: "flat", create: () => new THREE.Mesh(geo, flatMat) };
  }

  let packV = packVersion();
  const stale: THREE.DataTexture[] = [];
  function model(name: string): ItemModel | null {
    if (packV !== packVersion()) {
      packV = packVersion();
      cache.clear();
      stale.push(...textures.values());
      textures.clear();
    }
    if (!cache.has(name)) cache.set(name, build(name));
    return cache.get(name) ?? null;
  }

  return {
    model,
    setLight(v) {
      for (const s of shaded) s.mat.color.setScalar(v * s.shade);
    },
    setLevels(sky, block) {
      held?.uniforms.uHeldLight.value.set(sky / 15, block / 15);
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const t of textures.values()) t.dispose();
      for (const t of stale) t.dispose();
      for (const s of shaded) s.mat.dispose();
      glintMat.dispose();
      held?.dispose();
      for (const t of shieldTexs) t.dispose();
      cache.clear();
    },
  };
}
