import type { MobModel } from "../../contracts";
import { HUMANOID, HUMANOID_OUTER, ILLAGER, SKELETON, paintHumanoid, paintSkeleton } from "./humanoid";
import { Pix, shade } from "./pix";
import { attackTime, headLook, humanoidLimbs, rig, setRot, wrap, zombieArms, type VPart } from "./rig";
import { attachHeld } from "./held";
import { createArmorLayer, type Equipment } from "../armor-layer";
import { forgetModel } from "../render";

const ZOMBIE_FACE = [
  "hhhhhhhh",
  "hssssssh",
  "ssssssss",
  "sKksskKs",
  "sssnnsss",
  "ssmmmmss",
  "ssssssss",
  "ssssssss",
];

export function paintZombie(p: Pix): void {
  const skin = [0x5d9142, 0x548a3b, 0x6aa04c, 0x4a7c34];
  paintHumanoid(p, {
    skin,
    hair: [0x3f6d2b, 0x4a7c34, 0x365e25],
    shirt: [0x00a3a3, 0x00afaf, 0x009090, 0x1a8f99],
    pants: [0x3d3a8f, 0x463f9e, 0x34307a],
    shoes: [0x5b5b5b, 0x4a4a4a],
    sleeveRows: 0,
    face: ZOMBIE_FACE,
    faceColors: { h: 0x3f6d2b, s: 0x5d9142, K: 0x10260b, k: 0x223f16, n: 0x3c6b2c, m: 0x2f5323 },
  });
}

export function paintHusk(p: Pix): void {
  paintHumanoid(p, {
    skin: [0x9c8a63, 0x8f7e58, 0xab9970, 0x7f6f4c],
    hair: [0x6e5e3f, 0x7b6a48, 0x5f5035],
    shirt: [0x6e6345, 0x786c4c, 0x625839],
    pants: [0x5d5136, 0x4f452d, 0x695b3d],
    shoes: [0x3f3727, 0x352e20],
    sleeveRows: 3,
    face: ZOMBIE_FACE,
    faceColors: { h: 0x6e5e3f, s: 0x9c8a63, K: 0x3a3020, k: 0xd9c38a, n: 0x7f6f4c, m: 0x5c4f35 },
  });
}

export function paintDrowned(p: Pix): void {
  paintHumanoid(p, {
    skin: [0x4e9c95, 0x45918a, 0x5aaba3, 0x3c8079],
    hair: [0x2f6b5a, 0x3b7d63, 0x285a4c],
    shirt: [0x5f7a3c, 0x6b8744, 0x4f6631, 0x8a8e57],
    pants: [0x4f6e8c, 0x587aa0, 0x45607a],
    shoes: [0x2f4f4a, 0x26403c],
    sleeveRows: 4,
    face: ZOMBIE_FACE,
    faceColors: { h: 0x2f6b5a, s: 0x4e9c95, K: 0x7ff3e6, k: 0x3fd6c9, n: 0x3c8079, m: 0x2b5f59 },
  });
  const hat = p.cuboid(32, 0, 8, 8, 8);
  for (let i = 0; i < 6; i++) {
    const x = hat.right[0] + Math.floor(p.rand() * 32);
    for (let y = 0; y < 3 + Math.floor(p.rand() * 4); y++) p.px(x, hat.right[1] + y, i % 2 ? 0x3c7a2a : 0x2f6b25);
  }
  const jacket = p.cuboid(16, 32, 8, 12, 4);
  for (let i = 0; i < 5; i++) {
    const x = jacket.right[0] + Math.floor(p.rand() * 24);
    for (let y = 4 + Math.floor(p.rand() * 4); y < 12; y++) p.px(x, jacket.right[1] + y, 0x5f7a3c);
  }
}

export function paintZombieVillager(p: Pix): void {
  const skin = [0x5d9142, 0x548a3b, 0x6aa04c];
  const head = p.fillCuboid(0, 0, 8, 10, 8, skin);
  p.map(head.front[0], head.front[1], [
    "hhhhhhhh",
    "ssssssss",
    "ssssssss",
    "sbbssbbs",
    "sKksskKs",
    "ssssssss",
    "ssssssss",
    "ssssssss",
    "ssmmmmss",
    "ssssssss",
  ], { h: 0x3f6d2b, s: 0x5d9142, b: 0x2f5323, K: 0x10260b, k: 0xb83a2a, m: 0x2f5323 });
  p.fillCuboid(24, 0, 2, 4, 2, [0x4f8238, 0x5d9142]);
  const robe = [0x6b4a2e, 0x5e4027, 0x765335];
  p.fillCuboid(16, 20, 8, 12, 6, robe);
  p.fillCuboid(0, 38, 8, 18, 6, [0x5e4027, 0x6b4a2e, 0x4f3520]);
  const jf = p.cuboid(0, 38, 8, 18, 6);
  p.rect([jf.front[0], jf.front[1] + 16, 8, 2], 0, 0);
  p.fillCuboid(44, 22, 4, 12, 4, skin);
  p.noise([44, 26, 16, 4], robe);
  p.fillCuboid(0, 22, 4, 12, 4, [0x4f3a26, 0x5a432c]);
}

export function paintSkeletonSkin(p: Pix): void {
  paintSkeleton(p, [0xbcbcbc, 0xc8c8c8, 0xa9a9a9, 0xd4d4d4], 0x4a4a4a, 0x2c2c2c);
}

export function paintStray(p: Pix): void {
  paintSkeleton(p, [0xb6c2c2, 0xc3cfcf, 0xa3b0b0, 0xd0dada], 0x475757, 0x2a3636);
  const head = p.cuboid(32, 0, 8, 8, 8);
  p.noise(head.top, [0x6b7a7c, 0x5c6b6e]);
  for (const r of [head.right, head.left, head.back]) p.noise([r[0], r[1], r[2], 3], [0x6b7a7c, 0x5c6b6e]);
  p.noise([head.front[0], head.front[1], 8, 2], [0x6b7a7c, 0x5c6b6e]);
  const body = p.cuboid(16, 16, 8, 12, 4);
  for (const r of [body.front, body.back, body.right, body.left]) {
    for (let y = 0; y < 10; y++) for (let x = 0; x < r[2]; x++) if (y < 7 || p.rand() < 0.6) p.px(r[0] + x, r[1] + y, p.rand() < 0.5 ? 0x8a9799 : 0x7a8789);
  }
  for (let y = 0; y < 5; y++) p.noise([40, 18 + y, 8, 1], [0x8a9799, 0x7a8789]);
}

export function paintBogged(p: Pix): void {
  paintSkeleton(p, [0xa3a781, 0x959a72, 0xb0b38d, 0x878b65], 0x3e4a2e, 0x203018);
  const body = p.cuboid(16, 16, 8, 12, 4);
  for (let i = 0; i < 14; i++) p.px(body.front[0] + Math.floor(p.rand() * 24), body.front[1] + Math.floor(p.rand() * 12), 0x4f6b2c);
  const head = p.cuboid(0, 0, 8, 8, 8);
  p.noise(head.top, [0x6b7a3a, 0x5a6b30, 0x8a9a4a]);
  p.map(50, 16, ["..rr..", ".rwrr.", "rrrrrw", "..ss..", "..ss.."], { r: 0xc8302a, w: 0xe6dada, s: 0xd8c8a8 });
  p.map(50, 22, ["......", ".bbbb.", "bbbbbb", "..ss..", "..ss.."], { b: 0x9a6f4a, s: 0xd8c8a8 });
}

export function paintWitherSkeleton(p: Pix): void {
  paintSkeleton(p, [0x2a2a2a, 0x333333, 0x222222, 0x3a3a3a], 0x0a0a0a, 0x0f0f0f);
}

const PIGLIN_EXTRA: VPart[] = [
  { name: "snout", parent: "head", pivot: [0, 0, 0], box: [-2, -4, -5, 4, 4, 1], uv: [31, 1], extra: [
    { box: [2, -2, -5, 1, 2, 1], uv: [2, 4] },
    { box: [-3, -2, -5, 1, 2, 1], uv: [2, 0] },
  ] },
  { name: "left_ear", parent: "head", pivot: [4.5, -6, 0], box: [0, 0, -2, 1, 5, 4], uv: [51, 6], rot: [0, 0, -Math.PI / 6] },
  { name: "right_ear", parent: "head", pivot: [-4.5, -6, 0], box: [-1, 0, -2, 1, 5, 4], uv: [39, 6], rot: [0, 0, Math.PI / 6] },
];
const PIGLIN: VPart[] = HUMANOID.map((p) => (p.name === "head" ? { ...p, box: [-5, -8, -4, 10, 8, 8] as VPart["box"] } : p))
  .filter((p) => p.name !== "hat")
  .concat(PIGLIN_EXTRA);

function paintPiglinBase(p: Pix, skin: number[], zombified: boolean): void {
  const head = p.fillCuboid(0, 0, 10, 8, 8, skin);
  const front = head.front;
  p.map(front[0], front[1], zombified
    ? ["ssssssssss", "ssssssssss", "sssssssbbs", "sKwssssggs", "ssssssssss", "ssssssssss", "ssssssssss", "ssssssssss"]
    : ["ssssssssss", "ssssssssss", "ssssssssss", "sKwsssswKs", "ssssssssss", "ssssssssss", "ssssssssss", "ssssssssss"],
  { s: skin[0], K: 0x2a1a10, w: 0xf0f0f0, b: 0xc9c2a8, g: 0xe0dccc });
  p.fillCuboid(31, 1, 4, 4, 1, [shade(skin[0], 1.08), skin[0]]);
  const sn = p.cuboid(31, 1, 4, 4, 1);
  p.px(sn.front[0] + 1, sn.front[1] + 1, 0x6a2a2a);
  p.px(sn.front[0] + 2, sn.front[1] + 1, 0x6a2a2a);
  p.fillCuboid(2, 4, 1, 2, 1, [0xf2ecd8]);
  p.fillCuboid(2, 0, 1, 2, 1, [0xf2ecd8]);
  p.fillCuboid(51, 6, 1, 5, 4, skin);
  p.fillCuboid(39, 6, 1, 5, 4, skin);
  const loin = zombified ? [0x6b5a3a, 0x5a4a2e] : [0x8a5a2a, 0x7a4d22, 0xc4a23a];
  p.fillCuboid(16, 16, 8, 12, 4, skin);
  const body = p.cuboid(16, 16, 8, 12, 4);
  p.noise([body.right[0], body.right[1] + 8, 24, 4], loin);
  if (!zombified) p.noise([body.front[0] + 1, body.front[1] + 8, 6, 1], [0xe8c23a, 0xd4ad2a]);
  else {
    for (let y = 2; y < 7; y++) p.noise([body.front[0] + 4, body.front[1] + y, 3, 1], [0xc9c2a8, 0xb7af96]);
  }
  for (const [u, v] of [[40, 16], [32, 48]] as const) p.fillCuboid(u, v, 4, 12, 4, skin);
  for (const [u, v] of [[0, 16], [16, 48]] as const) {
    p.fillCuboid(u, v, 4, 12, 4, zombified ? [0x5a4a2e, 0x4f412a] : [0x5a3a1a, 0x4d3216]);
    p.noise([u, v + 4 + 10, 16, 2], [0x2a2018]);
  }
}

export const paintPiglin = (p: Pix) => paintPiglinBase(p, [0xe8a08a, 0xdf9580, 0xf0ad96, 0xd08a75], false);
export const paintZombifiedPiglin = (p: Pix) => paintPiglinBase(p, [0xd9917e, 0x7ea36a, 0xc98270, 0x8fb37a], true);

function makePix(w: number, h: number, seed: number, paint: (p: Pix) => void): Pix {
  const p = new Pix(w, h, seed);
  paint(p);
  return p;
}

const cache = new Map<string, Pix>();
export function skinOf(key: string, w: number, h: number, paint: (p: Pix) => void): Pix {
  let p = cache.get(key);
  if (!p) cache.set(key, (p = makePix(w, h, key.length * 977 + 13, paint)));
  return p;
}

export interface UndeadOpts {
  key: string;
  paint: (p: Pix) => void;
  parts: "humanoid" | "humanoid_outer" | "skeleton" | "villager" | "piglin";
  arms: "zombie" | "bow" | "sword" | "piglin";
  scale?: number;
  held?: string;
  hat?: boolean;
}

export function undeadModel(o: UndeadOpts): MobModel {
  const parts = o.parts === "skeleton" ? SKELETON : o.parts === "villager" ? villagerZombie : o.parts === "piglin" ? PIGLIN
    : o.parts === "humanoid_outer" ? [...HUMANOID, ...HUMANOID_OUTER] : HUMANOID;
  const extra = o.key === "bogged" ? BOGGED_SHROOMS : [];
  const h = o.parts === "skeleton" || o.parts === "villager" ? 32 : 64;
  const r = rig(skinOf(o.key, 64, o.parts === "villager" ? 64 : h, o.paint), [...parts, ...extra]);
  const held = attachHeld(r, o.held);
  const armor = o.parts === "villager" || o.parts === "piglin" ? null : createArmorLayer(r.p, false);
  const model = wrap(r, (a) => {
    if (armor?.set((a.e.data.equipment as Equipment | undefined) ?? {})) forgetModel(model.root);
    headLook(r.p.head, a);
    humanoidLimbs(r, a, o.arms === "sword");
    const aggressive = !!a.e.data.aggressive;
    const aims = o.arms === "bow" || (o.arms === "piglin" && a.e.data.held === "crossbow");
    if (o.arms === "zombie" || (o.arms === "piglin" && !a.e.data.held)) zombieArms(r, a, aggressive);
    else if (aims) {
      if (aggressive) {
        setRot(r.p.right_arm, -Math.PI / 2 + a.pitch, -0.1 + a.yaw, 0);
        setRot(r.p.left_arm, -Math.PI / 2 + a.pitch, 0.1 + a.yaw + 0.4, 0);
      } else humanoidLimbs(r, a, true);
    } else if (o.arms === "sword" || o.arms === "piglin") {
      const at = attackTime(a.e, a.pt);
      if (at > 0) setRot(r.p.right_arm, -Math.sin(at * Math.PI) * 1.6 - (aggressive ? 0.6 : 0), 0, 0);
      else if (aggressive) setRot(r.p.right_arm, -0.6 + Math.cos(a.phase * 0.6662 + Math.PI) * a.walk, 0, 0);
    }
    if (o.arms === "piglin" && (a.e.data.barter as number) > 0) {
      setRot(r.p.right_arm, -0.9, -0.5, 0);
      setRot(r.p.head, 0.5, 0, 0);
    }
    if (r.p.bogged_shroom) r.p.bogged_shroom.visible = !a.e.data.sheared;
    if (r.p.bogged_shroom2) r.p.bogged_shroom2.visible = !a.e.data.sheared;
    held?.update(a.e);
  }, { scale: o.scale });
  if (armor) {
    const base = model.dispose.bind(model);
    model.dispose = () => {
      armor.dispose();
      base();
    };
  }
  return model;
}

const villagerZombie: VPart[] = ILLAGER.filter((p) => p.name !== "arms").map((p) =>
  p.name === "right_arm" || p.name === "left_arm" ? { ...p, uv: [44, 22] as [number, number] } : p,
);

const BOGGED_SHROOMS: VPart[] = [
  { name: "bogged_shroom", parent: "head", pivot: [3, -8, 3], box: [-3, -5, 0, 6, 5, 0], uv: [50, 16], rot: [0, Math.PI / 4, 0] },
  { name: "bogged_shroom2", parent: "head", pivot: [-3, -8, -2], box: [-3, -5, 0, 6, 5, 0], uv: [50, 22], rot: [0, -Math.PI / 4, 0] },
];

