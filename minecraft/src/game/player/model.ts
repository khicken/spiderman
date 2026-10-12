import * as THREE from "three";
import { boxModel, makeSkin, type BoxModel, type PartSpec } from "../entities/model";

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const SKIN = 0xb4846d;
const SKIN_DARK = 0x9c6e58;
const HAIR = 0x2b1e10;
const HAIR_LIGHT = 0x3b2a17;
const SHIRT = 0x00a8a8;
const SHIRT_DARK = 0x008b8b;
const PANTS = 0x463aa5;
const PANTS_DARK = 0x3a2f8c;
const SHOE = 0x4a4a4a;
const EYE = 0x4a3a8c;

function hashRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (c: number, f = 1) => {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return `rgb(${r},${g},${b})`;
};

function fill(g: Ctx2D, r: () => number, x: number, y: number, w: number, h: number, c: number, c2 = c) {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      g.fillStyle = hex(r() < 0.25 ? c2 : c, 0.94 + r() * 0.1);
      g.fillRect(x + i, y + j, 1, 1);
    }
}
const px = (g: Ctx2D, x: number, y: number, c: number) => {
  g.fillStyle = hex(c);
  g.fillRect(x, y, 1, 1);
};

function cuboid(g: Ctx2D, r: () => number, u: number, v: number, w: number, h: number, d: number, c: number, c2: number) {
  fill(g, r, u + d, v, w * 2, d, c, c2);
  fill(g, r, u, v + d, (d + w) * 2, h, c, c2);
}

export function paintSteveSkin(): HTMLCanvasElement | OffscreenCanvas {
  const { canvas, ctx: g } = makeSkin(64, 64);
  const r = hashRng(1337);
  g.clearRect(0, 0, 64, 64);
  cuboid(g, r, 0, 0, 8, 8, 8, SKIN, SKIN_DARK);
  fill(g, r, 8, 0, 8, 8, HAIR, HAIR_LIGHT);
  fill(g, r, 24, 8, 8, 8, HAIR, HAIR_LIGHT);
  for (const sx of [0, 8, 16]) {
    fill(g, r, sx, 8, 8, sx === 8 ? 2 : 3, HAIR, HAIR_LIGHT);
  }
  fill(g, r, 0, 11, 2, 2, HAIR, HAIR_LIGHT);
  fill(g, r, 22, 11, 2, 2, HAIR, HAIR_LIGHT);
  px(g, 8, 10, HAIR);
  px(g, 15, 10, HAIR);
  px(g, 9, 12, 0xffffff);
  px(g, 10, 12, EYE);
  px(g, 13, 12, EYE);
  px(g, 14, 12, 0xffffff);
  px(g, 11, 13, SKIN_DARK - 0x101010);
  px(g, 12, 13, SKIN_DARK - 0x101010);
  fill(g, r, 10, 14, 4, 1, 0x6a4030, 0x5a3626);
  fill(g, r, 11, 15, 2, 1, SKIN_DARK, SKIN_DARK);
  cuboid(g, r, 16, 16, 8, 12, 4, SHIRT, SHIRT_DARK);
  for (const [u, v] of [[40, 16], [32, 48]] as const) {
    cuboid(g, r, u, v, 4, 12, 4, SKIN, SKIN_DARK);
    fill(g, r, u, v + 4, 16, 4, SHIRT, SHIRT_DARK);
    fill(g, r, u + 4, v, 4, 4, SHIRT, SHIRT_DARK);
  }
  for (const [u, v] of [[0, 16], [16, 48]] as const) {
    cuboid(g, r, u, v, 4, 12, 4, PANTS, PANTS_DARK);
    fill(g, r, u, v + 13, 16, 3, SHOE, 0x3e3e3e);
    fill(g, r, u + 8, v, 4, 4, SHOE, 0x3e3e3e);
  }
  return canvas;
}

export const PLAYER_PARTS: PartSpec[] = [
  { name: "body", pivot: [0, 24, 0], box: [-4, -12, -2, 8, 12, 4], uv: [16, 16] },
  { name: "head", pivot: [0, 24, 0], box: [-4, 0, -4, 8, 8, 8], uv: [0, 0] },
  { name: "right_arm", pivot: [5, 22, 0], box: [-1, -10, -2, 4, 12, 4], uv: [40, 16] },
  { name: "left_arm", pivot: [-5, 22, 0], box: [-3, -10, -2, 4, 12, 4], uv: [32, 48] },
  { name: "right_leg", pivot: [1.9, 12, 0], box: [-2, -12, -2, 4, 12, 4], uv: [0, 16] },
  { name: "left_leg", pivot: [-1.9, 12, 0], box: [-2, -12, -2, 4, 12, 4], uv: [16, 48] },
];

const PART_NAMES = PLAYER_PARTS.map((s) => s.name);

// Vanilla first-person arm: the raw model-space arm (y down) is the y-up spec turned by pi about x.
const ARM_PARTS: PartSpec[] = [{ name: "arm", pivot: [5, -2, 0], box: [-1, -10, -2, 4, 12, 4], uv: [40, 16] }];

export interface PlayerModel {
  model: BoxModel;
  arm: BoxModel;
  material: THREE.MeshBasicMaterial;
  skin: THREE.Texture;
  setLight(v: number, hurt: boolean): void;
  pose(o: PoseInput): void;
  dispose(): void;
}

export interface PoseInput {
  bodyYaw: number;
  headYaw: number;
  pitch: number;
  limbSwing: number;
  limbAmount: number;
  attack: number;
  sneaking: boolean;
  usingRight: boolean;
  flying: boolean;
  riding?: boolean;
}

function useBasic(m: BoxModel, mat: THREE.MeshBasicMaterial) {
  m.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat;
  });
}

export function createPlayerModel(): PlayerModel {
  const canvas = paintSteveSkin();
  const model = boxModel(canvas, PLAYER_PARTS);
  const arm = boxModel(canvas, ARM_PARTS);
  arm.root.rotation.x = Math.PI;
  const skin = model.material.map!;
  const material = new THREE.MeshBasicMaterial({ map: skin, alphaTest: 0.1 });
  useBasic(model, material);
  useBasic(arm, material);
  const P = model.parts;
  const base = (n: string) => {
    const s = PLAYER_PARTS.find((q) => q.name === n)!;
    return new THREE.Vector3(s.pivot[0] / 16, s.pivot[1] / 16, s.pivot[2] / 16);
  };
  const pivots: Record<string, THREE.Vector3> = {};
  for (const s of PLAYER_PARTS) pivots[s.name] = base(s.name);
  return {
    model,
    arm,
    material,
    skin,
    setLight(v, hurt) {
      if (hurt) material.color.setRGB(Math.min(1, v * 1.2 + 0.3), v * 0.45, v * 0.45);
      else material.color.setScalar(v);
    },
    pose(o) {
      model.root.rotation.y = o.bodyYaw + Math.PI;
      const swing = o.limbSwing * 0.6662;
      const amt = Math.min(1, o.limbAmount);
      P.head.rotation.set(o.pitch, o.headYaw - o.bodyYaw, 0, "YXZ");
      P.right_arm.rotation.set(Math.cos(swing + Math.PI) * amt, 0, 0);
      P.left_arm.rotation.set(Math.cos(swing) * amt, 0, 0);
      P.right_leg.rotation.set(Math.cos(swing) * 1.4 * amt, 0, 0);
      P.left_leg.rotation.set(Math.cos(swing + Math.PI) * 1.4 * amt, 0, 0);
      P.right_arm.rotation.z = -(Math.cos(o.limbSwing * 0.09) * 0.05 + 0.05);
      P.left_arm.rotation.z = Math.cos(o.limbSwing * 0.09) * 0.05 + 0.05;
      if (o.attack > 0) {
        const f = o.attack;
        const e = 1 - Math.pow(1 - f, 4);
        P.body.rotation.y = Math.sin(Math.sqrt(f) * Math.PI * 2) * 0.2;
        P.right_arm.rotation.x += Math.sin(e * Math.PI) * 1.2 + Math.sin(f * Math.PI) * 0.7 * 0.75;
        P.right_arm.rotation.y = P.body.rotation.y;
      } else P.body.rotation.y = 0;
      if (o.usingRight) {
        P.right_arm.rotation.x = Math.PI / 2 + o.pitch;
        P.left_arm.rotation.x = Math.PI / 2 + o.pitch;
        P.left_arm.rotation.y = -0.4;
      } else P.left_arm.rotation.y = 0;
      for (const n of PART_NAMES) P[n].position.copy(pivots[n]);
      if (o.sneaking) {
        P.body.rotation.x = -0.5;
        P.right_arm.rotation.x += 0.4;
        P.left_arm.rotation.x += 0.4;
        P.head.position.y -= 4.2 / 16;
        P.body.position.y -= 3.2 / 16;
        P.right_arm.position.y -= 3.2 / 16;
        P.left_arm.position.y -= 3.2 / 16;
        P.right_leg.position.z += 4 / 16;
        P.left_leg.position.z += 4 / 16;
        P.right_leg.position.y -= 0.2 / 16;
        P.left_leg.position.y -= 0.2 / 16;
      } else P.body.rotation.x = 0;
      if (o.riding) {
        P.right_leg.rotation.set(1.4137, -0.3142, 0.0785);
        P.left_leg.rotation.set(1.4137, 0.3142, -0.0785);
        P.right_arm.rotation.x += 0.6283;
        P.left_arm.rotation.x += 0.6283;
      }
    },
    dispose() {
      material.dispose();
      model.dispose();
      arm.dispose();
    },
  };
}
