import * as THREE from "three";
import type { Entity, GameCtx } from "../contracts";
import { itemTexture } from "./block-cube";
import { brightnessAt } from "./render";

export interface ExtraView {
  root: THREE.Object3D;
  owned: (THREE.Material | THREE.BufferGeometry | THREE.Texture)[];
  update(e: Entity, pt: number, x: number, y: number, z: number): void;
}

const SEGMENTS = 16;
const tip = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const fwd = new THREE.Vector3();
const glintCol = new THREE.Color();

function bobberTexture(): THREE.Texture {
  const data = new Uint8Array(8 * 8 * 4);
  const rows = ["...WW...", "..WRRW..", ".WRRRRW.", ".WRRRRW.", ".WWWWWW.", "..WWWW..", "...GG...", "...GG..."];
  const col: Record<string, number[]> = { W: [235, 235, 235], R: [196, 34, 34], G: [70, 70, 70] };
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const c = col[rows[7 - y][x]];
      if (!c) continue;
      const i = (y * 8 + x) * 4;
      data.set([c[0], c[1], c[2], 255], i);
    }
  const t = new THREE.DataTexture(data, 8, 8, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// Vanilla FishingHookRenderer: billboard hook plus a 16-segment sagging line to the rod tip.
function rodTip(ctx: GameCtx, out: THREE.Vector3): THREE.Vector3 {
  const p = ctx.player;
  const cam = ctx.renderer.camera;
  if (p.thirdPerson === 0) {
    cam.matrixWorld.extractBasis(right, up, fwd);
    return out.copy(cam.position).addScaledVector(right, 0.8).addScaledVector(up, 0.07).addScaledVector(fwd, -0.75);
  }
  const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
  return out.set(p.body.pos.x - s * 0.8 + c * 0.35, p.body.pos.y + p.body.height * 0.75, p.body.pos.z - c * 0.8 - s * 0.35);
}

function bobberView(ctx: GameCtx): ExtraView {
  const tex = bobberTexture();
  const mat = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.1 });
  const sp = new THREE.Sprite(mat);
  sp.scale.setScalar(0.25);
  sp.position.y = 0.12;
  const pos = new Float32Array((SEGMENTS + 1) * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x000000 });
  const line = new THREE.Line(geo, lineMat);
  line.frustumCulled = false;
  const root = new THREE.Group();
  root.add(sp, line);
  return {
    root,
    owned: [tex, mat, geo, lineMat],
    update(_e, _pt, x, y, z) {
      root.position.set(x, y, z);
      rodTip(ctx, tip);
      const dx = tip.x - x, dy = tip.y - y, dz = tip.z - z;
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        pos[i * 3] = dx * t;
        pos[i * 3 + 1] = dy * (t * t + t) * 0.5 + 0.25;
        pos[i * 3 + 2] = dz * t;
      }
      geo.attributes.position.needsUpdate = true;
      mat.color.setScalar(brightnessAt(ctx, x, y, z));
    },
  };
}

function spriteView(ctx: GameCtx, item: string, scale: number, bright: boolean): ExtraView {
  const mat = new THREE.SpriteMaterial({ map: itemTexture(item), alphaTest: 0.1 });
  const sp = new THREE.Sprite(mat);
  sp.scale.setScalar(scale);
  return {
    root: sp,
    owned: [mat],
    update(_e, _pt, x, y, z) {
      sp.position.set(x, y + 0.125, z);
      mat.color.setScalar(bright ? 1 : brightnessAt(ctx, x, y, z));
    },
  };
}

let tridentGeo: THREE.BufferGeometry | null = null;
function tridentGeometry(): THREE.BufferGeometry {
  if (tridentGeo) return tridentGeo;
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: number) => {
    const g = new THREE.BoxGeometry(w / 16, h / 16, d / 16).toNonIndexed();
    g.translate(x / 16, y / 16, z / 16);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const cc = new THREE.Color(c).convertSRGBToLinear();
    for (let i = 0; i < n; i++) col.set([cc.r, cc.g, cc.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    parts.push(g);
  };
  box(1, 1, 31, 0, 0, 4, 0x4c9a92);
  box(5, 1, 1, 0, 0, -11.5, 0x8fd8cf);
  box(1, 1, 4, 0, 0, -14, 0xc9f2ec);
  box(1, 1, 3, -2, 0, -13.5, 0xc9f2ec);
  box(1, 1, 3, 2, 0, -13.5, 0xc9f2ec);
  box(1.5, 1.5, 2, 0, 0, 19, 0x2f6b66);
  const pos: number[] = [], col: number[] = [], nrm: number[] = [];
  for (const g of parts) {
    pos.push(...(g.attributes.position.array as Float32Array));
    col.push(...(g.attributes.color.array as Float32Array));
    nrm.push(...(g.attributes.normal.array as Float32Array));
    g.dispose();
  }
  tridentGeo = new THREE.BufferGeometry();
  tridentGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  tridentGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  tridentGeo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  return tridentGeo;
}

function tridentView(ctx: GameCtx): ExtraView {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(tridentGeometry(), mat);
  const root = new THREE.Group();
  root.rotation.order = "YXZ";
  root.add(mesh);
  return {
    root,
    owned: [mat],
    update(e, _pt, x, y, z) {
      root.position.set(x, y + 0.25, z);
      root.rotation.y = e.yaw;
      root.rotation.x = e.pitch;
      const glint = e.data.item && (e.data.item as { ench?: Record<string, number> }).ench ? 0.15 * Math.sin(e.age * 0.3) + 0.15 : 0;
      mat.color.setRGB(1, 1, 1).multiplyScalar(brightnessAt(ctx, x, y, z)).add(glintCol.setRGB(glint * 0.6, glint * 0.2, glint));
    },
  };
}

export function extraView(e: Entity, ctx: GameCtx): ExtraView | null {
  switch (e.type) {
    case "fishing_bobber": return bobberView(ctx);
    case "firework_rocket": return spriteView(ctx, "firework_rocket", 0.5, true);
    case "eye_of_ender": return spriteView(ctx, "ender_eye", 0.5, true);
    case "trident": return tridentView(ctx);
    default: return null;
  }
}
