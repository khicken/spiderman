import type { MobModel } from "../../contracts";
import { skinOf } from "./looks-undead";
import { Pix } from "./pix";
import { rig, setRot, wrap, type VPart } from "./rig";

const NECK = 5;
const TAIL = 12;
const SEG = { box: [-5, -5, -10, 10, 10, 10] as VPart["box"], uv: [208, 0] as [number, number] };
const SCALE_UV: [number, number] = [208, 20];

function legParts(side: number, front: boolean): VPart[] {
  const s = side < 0 ? "right" : "left";
  const k = front ? "front" : "hind";
  if (front)
    return [
      { name: `${s}_${k}_leg`, parent: "body", pivot: [side * 12, 16, -6], box: [-4, -4, -4, 8, 24, 8], uv: [176, 0], rot: [1.3, 0, 0] },
      { name: `${s}_${k}_tip`, parent: `${s}_${k}_leg`, pivot: [0, 20, -1], box: [-3, -1, -3, 6, 24, 6], uv: [204, 88], rot: [-0.5, 0, 0] },
      { name: `${s}_${k}_foot`, parent: `${s}_${k}_tip`, pivot: [0, 23, 0], box: [-4, 0, -12, 8, 4, 16], uv: [132, 248], rot: [0.75, 0, 0] },
    ];
  return [
    { name: `${s}_${k}_leg`, parent: "body", pivot: [side * 16, 12, 34], box: [-8, -4, -8, 16, 32, 16], uv: [176, 40], rot: [1, 0, 0] },
    { name: `${s}_${k}_tip`, parent: `${s}_${k}_leg`, pivot: [0, 32, -4], box: [-6, -2, 0, 12, 32, 12], uv: [0, 248], rot: [0.5, 0, 0] },
    { name: `${s}_${k}_foot`, parent: `${s}_${k}_tip`, pivot: [0, 31, 4], box: [-9, 0, -20, 18, 6, 24], uv: [48, 248], rot: [0.75, 0, 0] },
  ];
}

function wing(side: number): VPart[] {
  const s = side < 0 ? "right" : "left";
  const m = side > 0;
  return [
    { name: `${s}_wing`, parent: "body", pivot: [side * 12, 1, -6], box: m ? [0, -4, -4, 56, 8, 8] : [-56, -4, -4, 56, 8, 8], uv: [0, 120], mirror: m,
      extra: [{ box: m ? [0, 0, 2, 56, 0, 56] : [-56, 0, 2, 56, 0, 56], uv: [0, 136], mirror: m }] },
    { name: `${s}_wing_tip`, parent: `${s}_wing`, pivot: [side * 56, 0, 0], box: m ? [0, -2, -2, 56, 4, 4] : [-56, -2, -2, 56, 4, 4], uv: [128, 120], mirror: m,
      extra: [{ box: m ? [0, 0, 2, 56, 0, 56] : [-56, 0, 2, 56, 0, 56], uv: [0, 192], mirror: m }] },
  ];
}

export const DRAGON: VPart[] = [
  { name: "body", pivot: [0, 4, 8], box: [-12, 0, -16, 24, 24, 64], uv: [0, 0], extra: [-10, 10, 30].map((z) => ({ box: [-1, -6, z, 2, 6, 12] as VPart["box"], uv: [224, 20] as [number, number] })) },
  ...Array.from({ length: NECK }, (_, i): VPart => ({
    name: `neck${i}`, parent: i === 0 ? "body" : `neck${i - 1}`, pivot: i === 0 ? [0, 6, -16] : [0, 0, -10], box: SEG.box, uv: SEG.uv,
    extra: [{ box: [-1, -9, -8, 2, 4, 6], uv: SCALE_UV }],
  })),
  { name: "head", parent: `neck${NECK - 1}`, pivot: [0, 0, -16], box: [-8, -8, -10, 16, 16, 16], uv: [0, 88], extra: [
    { box: [-6, -1, -24, 12, 5, 16], uv: [64, 88] },
    { box: [-5, -12, -4, 2, 4, 6], uv: [188, 88], mirror: true },
    { box: [3, -12, -4, 2, 4, 6], uv: [188, 88] },
    { box: [-5, -3, -22, 2, 2, 4], uv: [176, 88], mirror: true },
    { box: [3, -3, -22, 2, 2, 4], uv: [176, 88] },
  ] },
  { name: "jaw", parent: "head", pivot: [0, 4, -8], box: [-6, 0, -16, 12, 4, 16], uv: [120, 88] },
  ...Array.from({ length: TAIL }, (_, i): VPart => ({
    name: `tail${i}`, parent: i === 0 ? "body" : `tail${i - 1}`, pivot: i === 0 ? [0, 6, 48] : [0, 0, 10], box: [-5, -5, 0, 10, 10, 10], uv: SEG.uv,
    extra: [{ box: [-1, -9, 2, 2, 4, 6], uv: SCALE_UV }],
  })),
  ...wing(-1),
  ...wing(1),
  ...legParts(-1, true),
  ...legParts(1, true),
  ...legParts(-1, false),
  ...legParts(1, false),
];

export function paintDragon(p: Pix): void {
  const scales = [0x1a1a1a, 0x222222, 0x141414, 0x2a2a2a, 0x101010];
  const belly = [0x2e2e2e, 0x363636, 0x262626];
  const body = p.fillCuboid(0, 0, 24, 24, 64, scales);
  p.noise(body.bottom, belly);
  for (let y = 0; y < 64; y += 4) p.noise([body.top[0], body.top[1] + y, 24, 1], [0x0a0a0a, 0x0e0e0e]);
  for (const [u, v, w, h, d] of [[176, 0, 8, 24, 8], [176, 40, 16, 32, 16], [208, 0, 10, 10, 10], [204, 88, 6, 24, 6], [0, 248, 12, 32, 12]])
    p.fillCuboid(u, v, w, h, d, scales);
  for (const [u, v, w, h, d] of [[208, 20, 2, 4, 6], [224, 20, 2, 6, 12], [188, 88, 2, 4, 6]]) p.fillCuboid(u, v, w, h, d, [0x4a4a4a, 0x5a5a5a, 0x3a3a3a]);
  const head = p.fillCuboid(0, 88, 16, 16, 16, scales);
  p.map(head.front[0], head.front[1], [
    "................",
    "................",
    "................",
    "................",
    "..MMMM....MMMM..",
    "..mMMm....mMMm..",
    "................",
    "................",
  ], { M: 0xe060f8, m: 0xb030e0 });
  p.fillCuboid(64, 88, 12, 5, 16, scales);
  const lip = p.cuboid(64, 88, 12, 5, 16);
  p.noise([lip.right[0], lip.right[1] + 4, 56, 1], [0xd0d0d0, 0xb8b8b8]);
  p.fillCuboid(120, 88, 12, 4, 16, scales);
  const jaw = p.cuboid(120, 88, 12, 4, 16);
  p.noise([jaw.right[0], jaw.right[1], 56, 1], [0xd0d0d0, 0xb8b8b8]);
  p.fillCuboid(176, 88, 2, 2, 4, [0x0a0a0a]);
  p.fillCuboid(48, 248, 18, 6, 24, scales);
  p.fillCuboid(132, 248, 8, 4, 16, scales);
  const claws = p.cuboid(48, 248, 18, 6, 24);
  p.noise([claws.front[0], claws.front[1] + 3, 18, 3], [0x9a9a9a, 0x8a8a8a]);
  p.fillCuboid(0, 120, 56, 8, 8, scales);
  p.fillCuboid(128, 120, 56, 4, 4, scales);
  for (const v of [136, 192]) {
    const skin = [0x3a3446, 0x342e40, 0x40394c, 0x2e2838];
    p.noise([56, v, 56, 56], skin);
    p.noise([112, v, 56, 56], skin);
    for (let i = 0; i < 56; i += 9) {
      for (let j = 0; j < 56; j++) {
        p.px(56 + i, v + j, 0x1a1a1a);
        p.px(112 + i, v + j, 0x1a1a1a);
      }
    }
  }
}

export function dragonModel(): MobModel {
  const r = rig(skinOf("ender_dragon", 256, 320, paintDragon), DRAGON, 68);
  r.m.material.side = 2;
  return wrap(r, (a) => {
    const flap = ((a.e.data.flap as number) ?? a.age * 0.03) * Math.PI * 2;
    const perched = !!a.e.data.perched;
    const amp = perched ? 0.3 : 1;
    setRot(r.p.right_wing, 0.125 - Math.cos(flap) * 0.2 * amp, -0.25, -(Math.sin(flap) + 0.125) * 0.8 * amp);
    setRot(r.p.right_wing_tip, 0, 0, (Math.sin(flap + 2) + 0.5) * 0.75 * amp);
    setRot(r.p.left_wing, 0.125 - Math.cos(flap) * 0.2 * amp, 0.25, (Math.sin(flap) + 0.125) * 0.8 * amp);
    setRot(r.p.left_wing_tip, 0, 0, -(Math.sin(flap + 2) + 0.5) * 0.75 * amp);
    setRot(r.p.jaw, (Math.sin(flap) + 1) * 0.2 + ((a.e.data.roar as number) ? 0.5 : 0), 0, 0);
    for (let i = 0; i < NECK; i++) setRot(r.p[`neck${i}`], Math.sin(flap + i * 0.4) * 0.05 + (i === 0 ? -0.15 : 0.03) + (i === NECK - 1 ? a.pitch * 0.5 : 0), a.yaw / NECK, 0);
    for (let i = 0; i < TAIL; i++) setRot(r.p[`tail${i}`], Math.sin(flap + i * 0.4) * 0.04 + (i === 0 ? 0.1 : 0.02), Math.sin(a.age * 0.05 + i * 0.5) * 0.06, 0);
    setRot(r.p.head, 0.1, 0, 0);
    const legs = perched ? 0.2 : 1;
    for (const s of ["right", "left"]) {
      setRot(r.p[`${s}_front_leg`], 1.3 * legs + Math.sin(flap) * 0.1, 0, 0);
      setRot(r.p[`${s}_hind_leg`], 1 * legs + Math.sin(flap) * 0.1, 0, 0);
    }
  });
}
