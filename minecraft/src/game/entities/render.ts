import * as THREE from "three";
import type { Entity, GameCtx, MobModel } from "../contracts";
import { lightmap } from "../mesh/lightmap";
import { rasterText } from "../ui/font";

type Shaded = THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;
const cache = new WeakMap<THREE.Object3D, Shaded[]>();

// Materials can set userData.base (THREE.Color, e.g. sheep wool dye) and userData.glow (full bright).
function materials(root: THREE.Object3D): Shaded[] {
  let list = cache.get(root);
  if (list) return list;
  const set = new Set<Shaded>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) if (mm instanceof THREE.MeshLambertMaterial || mm instanceof THREE.MeshBasicMaterial) set.add(mm);
  });
  list = [...set];
  for (const m of list) {
    const b = m.userData.base;
    if (!(b instanceof THREE.Color)) m.userData.base = typeof b === "number" ? new THREE.Color(b) : m.color.clone();
    if (m instanceof THREE.MeshLambertMaterial && m.map && !m.emissiveMap) {
      m.emissiveMap = m.map;
      m.needsUpdate = true;
    }
  }
  cache.set(root, list);
  return list;
}

export function forgetModel(root: THREE.Object3D) {
  cache.delete(root);
}

const RGB: [number, number, number] = [1, 1, 1];
let lastBr = -1;
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// Linear brightness 0..1 at a point from the chunk shader lightmap, so a mob matches the blocks around it.
// The lightmap color (warm in block light) is kept for the next shadeMaterials call.
export function brightnessAt(ctx: GameCtx, x: number, y: number, z: number) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  lightmap(ctx.world.getSkyLight(bx, by, bz), ctx.world.getBlockLight(bx, by, bz), RGB);
  RGB[0] = toLinear(RGB[0]);
  RGB[1] = toLinear(RGB[1]);
  RGB[2] = toLinear(RGB[2]);
  lastBr = Math.max(0.02, RGB[0], RGB[1], RGB[2]);
  return lastBr;
}

const tint = new THREE.Color();
const warm = new THREE.Color();

// Lambert color carries the lightmap; the renderer's fixed ambient 0.4 + two 0.6 lights give the vanilla entity face shade.
export function shadeModel(model: MobModel | { root: THREE.Object3D }, ctx: GameCtx, e: Entity, canHurt = true) {
  const b = e.body;
  const br = brightnessAt(ctx, b.pos.x, b.pos.y + b.height * 0.5, b.pos.z);
  const hurt = canHurt && (e.hurtTicks > 0 || (e.dead && e.type !== "item"));
  shadeMaterials(model.root, br, hurt);
}

export function shadeMaterials(root: THREE.Object3D, br: number, hurt: boolean) {
  for (const m of materials(root)) {
    const s = m.userData.glow ? 1 : br;
    tint.copy(m.userData.base as THREE.Color);
    if (s === lastBr) tint.multiply(warm.setRGB(RGB[0], RGB[1], RGB[2]));
    else tint.multiplyScalar(s);
    if (hurt) {
      tint.g *= 0.45;
      tint.b *= 0.45;
    }
    if (m instanceof THREE.MeshLambertMaterial) {
      if (m.userData.glow) {
        m.color.setScalar(0);
        m.emissive.copy(tint);
      } else {
        m.color.copy(tint);
        m.emissive.setScalar(0);
      }
      if (hurt) m.emissive.r += 0.15 * s;
    } else m.color.copy(tint);
  }
}

// Vanilla name tag: white game-font text on a translucent black plate 1 px wider than the text, faces the camera.
export function nameTag(text: string): { sprite: THREE.Sprite; dispose(): void } {
  const r = rasterText(text, 0xffffff, false);
  const scale = 4;
  const w = (r.width + 2) * scale;
  const h = 10 * scale;
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#ffffff";
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++)
      if (r.data[(y * r.width + x) * 4 + 3]) g.fillRect((x + 1) * scale, (y - r.top + 1) * scale, scale, scale);
  const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set((w / h) * 0.25, 0.25, 1);
  sprite.renderOrder = 10;
  return {
    sprite,
    dispose() {
      tex.dispose();
      mat.dispose();
    },
  };
}
