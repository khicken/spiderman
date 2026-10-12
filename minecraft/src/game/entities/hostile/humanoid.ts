import { Pix, ramp, shade } from "./pix";
import type { VPart } from "./rig";

export const HUMANOID: VPart[] = [
  { name: "head", pivot: [0, 0, 0], box: [-4, -8, -4, 8, 8, 8], uv: [0, 0] },
  { name: "hat", parent: "head", pivot: [0, 0, 0], box: [-4, -8, -4, 8, 8, 8], uv: [32, 0], inflate: 0.5 },
  { name: "body", pivot: [0, 0, 0], box: [-4, 0, -2, 8, 12, 4], uv: [16, 16] },
  { name: "right_arm", pivot: [-5, 2, 0], box: [-3, -2, -2, 4, 12, 4], uv: [40, 16] },
  { name: "left_arm", pivot: [5, 2, 0], box: [-1, -2, -2, 4, 12, 4], uv: [32, 48] },
  { name: "right_leg", pivot: [-1.9, 12, 0], box: [-2, 0, -2, 4, 12, 4], uv: [0, 16] },
  { name: "left_leg", pivot: [1.9, 12, 0], box: [-2, 0, -2, 4, 12, 4], uv: [16, 48] },
];

export const HUMANOID_OUTER: VPart[] = [
  { name: "jacket", parent: "body", pivot: [0, 0, 0], box: [-4, 0, -2, 8, 12, 4], uv: [16, 32], inflate: 0.25 },
  { name: "right_sleeve", parent: "right_arm", pivot: [0, 0, 0], box: [-3, -2, -2, 4, 12, 4], uv: [40, 32], inflate: 0.25 },
  { name: "left_sleeve", parent: "left_arm", pivot: [0, 0, 0], box: [-1, -2, -2, 4, 12, 4], uv: [48, 48], inflate: 0.25 },
  { name: "right_pants", parent: "right_leg", pivot: [0, 0, 0], box: [-2, 0, -2, 4, 12, 4], uv: [0, 32], inflate: 0.25 },
  { name: "left_pants", parent: "left_leg", pivot: [0, 0, 0], box: [-2, 0, -2, 4, 12, 4], uv: [0, 48], inflate: 0.25 },
];

export const SKELETON: VPart[] = [
  { name: "head", pivot: [0, 0, 0], box: [-4, -8, -4, 8, 8, 8], uv: [0, 0] },
  { name: "hat", parent: "head", pivot: [0, 0, 0], box: [-4, -8, -4, 8, 8, 8], uv: [32, 0], inflate: 0.5 },
  { name: "body", pivot: [0, 0, 0], box: [-4, 0, -2, 8, 12, 4], uv: [16, 16] },
  { name: "right_arm", pivot: [-5, 2, 0], box: [-1, -2, -1, 2, 12, 2], uv: [40, 16] },
  { name: "left_arm", pivot: [5, 2, 0], box: [-1, -2, -1, 2, 12, 2], uv: [40, 16], mirror: true },
  { name: "right_leg", pivot: [-2, 12, 0], box: [-1, 0, -1, 2, 12, 2], uv: [0, 16] },
  { name: "left_leg", pivot: [2, 12, 0], box: [-1, 0, -1, 2, 12, 2], uv: [0, 16], mirror: true },
];

export const ILLAGER: VPart[] = [
  { name: "head", pivot: [0, 0, 0], box: [-4, -10, -4, 8, 10, 8], uv: [0, 0] },
  { name: "nose", parent: "head", pivot: [0, -2, 0], box: [-1, -1, -6, 2, 4, 2], uv: [24, 0] },
  { name: "body", pivot: [0, 0, 0], box: [-4, 0, -3, 8, 12, 6], uv: [16, 20], extra: [{ box: [-4, 0, -3, 8, 18, 6], uv: [0, 38], inflate: 0.5 }] },
  { name: "right_arm", pivot: [-5, 2, 0], box: [-3, -2, -2, 4, 12, 4], uv: [40, 46] },
  { name: "left_arm", pivot: [5, 2, 0], box: [-1, -2, -2, 4, 12, 4], uv: [40, 46], mirror: true },
  { name: "arms", pivot: [0, 3, -1], box: [-4, 2, -2, 8, 4, 4], uv: [40, 38], rot: [-0.75, 0, 0], extra: [
    { box: [-8, -2, -2, 4, 8, 4], uv: [44, 22] },
    { box: [4, -2, -2, 4, 8, 4], uv: [44, 22], mirror: true },
  ] },
  { name: "right_leg", pivot: [-2, 12, 0], box: [-2, 0, -2, 4, 12, 4], uv: [0, 22] },
  { name: "left_leg", pivot: [2, 12, 0], box: [-2, 0, -2, 4, 12, 4], uv: [0, 22], mirror: true },
];

export interface HumanPalette {
  skin: number[];
  shirt: number[];
  pants: number[];
  shoes: number[];
  face: string[]; // 8x8 front of the head
  faceColors: Record<string, number>;
  hair?: number[];
  sleeveRows?: number; // shirt rows at the top of each arm
}

export function paintHumanoid(p: Pix, c: HumanPalette): void {
  const head = p.fillCuboid(0, 0, 8, 8, 8, c.skin);
  if (c.hair) {
    p.noise(head.top, c.hair);
    for (const r of [head.right, head.left, head.back]) p.noise([r[0], r[1], r[2], 2], c.hair);
    p.noise(head.back, c.hair);
  }
  p.map(head.front[0], head.front[1], c.face, c.faceColors);
  const body = p.fillCuboid(16, 16, 8, 12, 4, c.shirt);
  p.noise([body.front[0], body.front[1] + 10, 8, 2], c.pants);
  p.noise([body.right[0], body.right[1] + 10, 4, 2], c.pants);
  p.noise([body.left[0], body.left[1] + 10, 4, 2], c.pants);
  p.noise([body.back[0], body.back[1] + 10, 8, 2], c.pants);
  p.noise(body.bottom, c.pants);
  for (const [u, v] of [[40, 16], [32, 48]] as const) {
    p.fillCuboid(u, v, 4, 12, 4, c.skin);
    const s = c.sleeveRows ?? 0;
    if (s > 0) {
      p.noise([u + 4, v, 4, 4], c.shirt);
      p.noise([u, v + 4, 16, s], c.shirt);
    }
  }
  for (const [u, v] of [[0, 16], [16, 48]] as const) {
    const f = p.fillCuboid(u, v, 4, 12, 4, c.pants);
    p.noise([f.right[0], f.right[1] + 10, 16, 2], c.shoes);
    p.noise(f.bottom, c.shoes);
  }
}

export function paintSkeleton(p: Pix, bone: number[], dark: number, eye: number): void {
  const head = p.fillCuboid(0, 0, 8, 8, 8, bone);
  p.map(head.front[0], head.front[1], [
    "........",
    "........",
    "........",
    ".ee..ee.",
    "........",
    "...nn...",
    ".dddddd.",
    "..d.d.d.",
  ], { e: eye, n: dark, d: shade(dark, 1.3) });
  const body = p.cuboid(16, 16, 8, 12, 4);
  for (const r of [body.front, body.back, body.right, body.left, body.top, body.bottom]) p.rect(r, 0, 0);
  const fr = body.front;
  for (let y = 0; y < 12; y++) {
    if (y < 7 && y % 2 === 0) p.noise([fr[0], fr[1] + y, 8, 1], bone);
    p.noise([fr[0] + 3, fr[1] + y, 2, 1], bone);
    if (y >= 9) p.noise([fr[0] + 1, fr[1] + y, 6, 1], bone);
  }
  const bk = body.back;
  for (let y = 0; y < 12; y++) {
    p.noise([bk[0] + 3, bk[1] + y, 2, 1], bone);
    if (y < 7 && y % 2 === 0) p.noise([bk[0], bk[1] + y, 8, 1], bone);
    if (y >= 9) p.noise([bk[0] + 1, bk[1] + y, 6, 1], bone);
  }
  for (const s of [body.right, body.left]) for (let y = 0; y < 7; y += 2) p.noise([s[0], s[1] + y, 4, 1], bone);
  p.noise(body.top, bone);
  p.fillCuboid(40, 16, 2, 12, 2, bone);
  p.fillCuboid(0, 16, 2, 12, 2, bone);
}

export const zombieSkinColors = (base: number) => ramp(base, 4, 0.08);
