import type { MobModel } from "../../contracts";
import { skinOf } from "./looks-undead";
import { Pix, shade } from "./pix";
import { attackTime, headLook, humanoidLimbs, rig, setPivot, setRot, wrap, type VPart } from "./rig";
import { attachHeld } from "./held";
import { ILLAGER } from "./humanoid";

function tentacleLengths(): number[] {
  let s = 1660;
  const next = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  return Array.from({ length: 9 }, () => Math.floor(next() * 7) + 8);
}

const LENGTHS = tentacleLengths();

export const GHAST: VPart[] = [
  { name: "body", pivot: [0, 17.6, 0], box: [-8, -8, -8, 16, 16, 16], uv: [0, 0] },
  ...LENGTHS.map((len, i): VPart => {
    const x = (((i % 3) - (Math.floor(i / 3) % 2) * 0.5 + 0.25) / 2 * 2 - 1) * 5;
    const z = (Math.floor(i / 3) / 2 * 2 - 1) * 5;
    return { name: `tentacle${i}`, pivot: [x, 24.6 - 17.6, z], parent: "body", box: [-1, 0, -1, 2, len, 2], uv: [0, 0] };
  }),
];

export function paintGhast(p: Pix, shooting: boolean): void {
  const white = [0xf0f0f0, 0xe6e6e6, 0xdcdcdc, 0xfafafa, 0xc8c8c8];
  const f = p.fillCuboid(0, 0, 16, 16, 16, white);
  for (const r of [f.right, f.left, f.back, f.top, f.bottom]) {
    for (let i = 0; i < 6; i++) p.px(r[0] + Math.floor(p.rand() * r[2]), r[1] + Math.floor(p.rand() * r[3]), 0xb4b4b4);
  }
  const g = 0x5a5a5a;
  const k = 0x2a2a2a;
  const face = shooting
    ? ["................", "................", "................", "................", "...KKK....KKK...", "...KrK....KrK...", "...KKK....KKK...", "................", "................",
      "......KKKK......", ".....KKKKKK.....", ".....KKKKKK.....", ".....KKKKKK.....", "......KKKK......", "................", "................"]
    : ["................", "................", "................", "................", "...ggg....ggg...", "...gKg....gKg...", "....g......g....", "................", "................",
      "......gggg......", "......gKKg......", "................", "................", "................", "................", "................"];
  p.map(f.front[0], f.front[1], face, { K: k, g, r: 0xb02a2a });
  if (shooting) p.map(f.front[0], f.front[1] + 6, ["...t......t.....", "...t......t....."], { t: 0x9ab0c8 });
}

export function ghastModel(): MobModel {
  const r = rig(skinOf("ghast", 64, 32, (p) => paintGhast(p, false)), GHAST);
  const shoot = skinOf("ghast_shooting", 64, 32, (p) => paintGhast(p, true)).toCanvas();
  const idleMap = r.m.material.map;
  let shootTex: import("three").Texture | null = null;
  r.m.root.scale.setScalar(4.5);
  return wrap(r, (a) => {
    for (let i = 0; i < 9; i++) setRot(r.p[`tentacle${i}`], 0.2 * Math.sin(a.age * 0.3 + i) + 0.4, 0, 0);
    const want = a.e.data.charging ? "shoot" : "idle";
    if (want === "shoot" && !shootTex && idleMap) {
      shootTex = idleMap.clone();
      shootTex.image = shoot;
      shootTex.needsUpdate = true;
    }
    const m = want === "shoot" ? shootTex : idleMap;
    if (m && r.m.material.map !== m) {
      r.m.material.map = m;
      r.m.material.emissiveMap = m;
      r.m.material.needsUpdate = true;
    }
  });
}

export const BLAZE: VPart[] = [
  { name: "head", pivot: [0, 0, 0], box: [-4, -4, -4, 8, 8, 8], uv: [0, 0] },
  ...Array.from({ length: 12 }, (_, i): VPart => ({ name: `rod${i}`, pivot: [0, 0, 0], box: [0, 0, 0, 2, 8, 2], uv: [0, 16] })),
];

export function paintBlaze(p: Pix): void {
  const gold = [0xf8c830, 0xf0a818, 0xfce060, 0xd88a10, 0xfff090];
  const h = p.fillCuboid(0, 0, 8, 8, 8, gold);
  p.map(h.front[0], h.front[1], [
    "yyyyyyyy",
    "y......y",
    "........",
    ".KK..KK.",
    ".kK..Kk.",
    "........",
    "..oooo..",
    "........",
  ], { y: 0xfce060, K: 0x3a1a00, k: 0x6a3000, o: 0xa05a00 });
  p.fillCuboid(0, 16, 2, 8, 2, [0xf0b020, 0xe89010, 0xfcd040, 0xc87008]);
}

export function blazeModel(): MobModel {
  const r = rig(skinOf("blaze", 64, 32, paintBlaze), BLAZE);
  return wrap(r, (a) => {
    headLook(r.p.head, a);
    let f = a.age * Math.PI * -0.1;
    for (let i = 0; i < 4; i++) {
      setPivot(r.p[`rod${i}`], [0, 0, 0], Math.cos(f) * 9, -2 + Math.cos((i * 2 + a.age) * 0.25), Math.sin(f) * 9);
      f++;
    }
    f = Math.PI / 4 + a.age * Math.PI * 0.03;
    for (let i = 4; i < 8; i++) {
      setPivot(r.p[`rod${i}`], [0, 0, 0], Math.cos(f) * 7, 2 + Math.cos((i * 2 + a.age) * 0.25), Math.sin(f) * 7);
      f++;
    }
    f = 0.47123894 + a.age * Math.PI * -0.05;
    for (let i = 8; i < 12; i++) {
      setPivot(r.p[`rod${i}`], [0, 0, 0], Math.cos(f) * 5, 11 + Math.cos((i * 1.5 + a.age) * 0.5), Math.sin(f) * 5);
      f++;
    }
  }, { glow: true });
}

export function paintBreeze(p: Pix): void {
  const blue = [0xb8c8f0, 0xa8b8e8, 0xc8d8f8, 0x98a8d8];
  const head = p.fillCuboid(0, 0, 8, 8, 8, blue);
  p.map(head.front[0], head.front[1], [
    "........",
    "........",
    ".WW..WW.",
    ".WE..EW.",
    "........",
    "..dddd..",
    "........",
    "........",
  ], { W: 0xffffff, E: 0x5a8ad8, d: 0x6878a8 });
  p.fillCuboid(4, 24, 10, 3, 4, [0x8898c8, 0x7888b8]);
  p.fillCuboid(0, 17, 2, 8, 2, [0x8a7ac8, 0x9a8ad8, 0x7a6ab8]);
  const wind = [0xd8e4ff, 0xc0d0f8, 0xe8f0ff, 0xb0c4f0];
  p.fillCuboid(32, 0, 6, 4, 6, wind, 150);
  p.fillCuboid(32, 12, 8, 4, 8, wind, 120);
  p.fillCuboid(32, 24, 4, 3, 4, wind, 170);
}

export const BREEZE: VPart[] = [
  { name: "head", pivot: [0, 4, 0], box: [-4, -8, -4, 8, 8, 8], uv: [0, 0], extra: [{ box: [-5, -5, -4.2, 10, 3, 4], uv: [4, 24] }] },
  { name: "rods", pivot: [0, 8, 0], box: [0, 0, 0, 0, 0, 0], uv: [0, 0] },
  { name: "rod0", parent: "rods", pivot: [2.6, -1, 1.5], box: [-1, 0, -1, 2, 8, 2], uv: [0, 17], rot: [-0.3, 0, 0.4] },
  { name: "rod1", parent: "rods", pivot: [-2.6, -1, 1.5], box: [-1, 0, -1, 2, 8, 2], uv: [0, 17], rot: [-0.3, 0, -0.4] },
  { name: "rod2", parent: "rods", pivot: [0, -1, -3], box: [-1, 0, -1, 2, 8, 2], uv: [0, 17], rot: [0.4, 0, 0] },
  { name: "wind_top", pivot: [0, 12, 0], box: [-4, 0, -4, 8, 4, 8], uv: [32, 12] },
  { name: "wind_mid", pivot: [0, 16, 0], box: [-3, 0, -3, 6, 4, 6], uv: [32, 0] },
  { name: "wind_bottom", pivot: [0, 20, 0], box: [-2, 0, -2, 4, 3, 4], uv: [32, 24] },
];

export function breezeModel(): MobModel {
  const r = rig(skinOf("breeze", 64, 32, paintBreeze), BREEZE);
  r.m.material.transparent = true;
  r.m.material.alphaTest = 0.02;
  return wrap(r, (a) => {
    headLook(r.p.head, a);
    setRot(r.p.rods, 0, a.age * 0.12, 0);
    setRot(r.p.wind_top, 0, a.age * 0.35, 0);
    setRot(r.p.wind_mid, 0, -a.age * 0.45, 0);
    setRot(r.p.wind_bottom, 0, a.age * 0.55, 0);
    const charge = a.e.data.charging ? 1 : 0;
    setPivot(r.p.head, [0, 4, 0], 0, Math.sin(a.age * 0.1) * 0.5 - charge, 0);
  });
}

export const WITCH: VPart[] = [
  { name: "head", pivot: [0, 0, 0], box: [-4, -10, -4, 8, 10, 8], uv: [0, 0] },
  { name: "hat", parent: "head", pivot: [-5, -10.03125, -5], box: [0, 0, 0, 10, 2, 10], uv: [0, 64] },
  { name: "hat2", parent: "hat", pivot: [1.75, -4, 2], box: [0, 0, 0, 7, 4, 7], uv: [0, 76], rot: [-0.05235988, 0, 0.02617994] },
  { name: "hat3", parent: "hat2", pivot: [1.75, -4, 2], box: [0, 0, 0, 4, 4, 4], uv: [0, 87], rot: [-0.10471976, 0, 0.05235988] },
  { name: "hat4", parent: "hat3", pivot: [1.75, -2, 2], box: [0, 0, 0, 1, 2, 1], uv: [0, 95], inflate: 0.25, rot: [-0.20943952, 0, 0.10471976] },
  { name: "nose", parent: "head", pivot: [0, -2, 0], box: [-1, -1, -6, 2, 4, 2], uv: [24, 0], extra: [{ box: [0, 3, -6.75, 1, 1, 1], uv: [0, 0], inflate: -0.25 }] },
  { name: "body", pivot: [0, 0, 0], box: [-4, 0, -3, 8, 12, 6], uv: [16, 20], extra: [{ box: [-4, 0, -3, 8, 20, 6], uv: [0, 38], inflate: 0.5 }] },
  { name: "arms", pivot: [0, 3, -1], box: [-4, 2, -2, 8, 4, 4], uv: [40, 38], rot: [-0.75, 0, 0], extra: [
    { box: [-8, -2, -2, 4, 8, 4], uv: [44, 22] },
    { box: [4, -2, -2, 4, 8, 4], uv: [44, 22], mirror: true },
  ] },
  { name: "right_leg", pivot: [-2, 12, 0], box: [-2, 0, -2, 4, 12, 4], uv: [0, 22] },
  { name: "left_leg", pivot: [2, 12, 0], box: [-2, 0, -2, 4, 12, 4], uv: [0, 22], mirror: true },
];

export function paintWitch(p: Pix): void {
  const skin = [0xb08a6e, 0xa47e62, 0xbc967a];
  const head = p.fillCuboid(0, 0, 8, 10, 8, skin);
  p.map(head.front[0], head.front[1], [
    "hhhhhhhh",
    "hsssssss",
    "ssssssss",
    "sbbssbbs",
    "sWGssGWs",
    "ssssssss",
    "ssssssss",
    "ssssssss",
    "ssmmmmss",
    "ssssssss",
  ], { h: 0x2a1a10, s: skin[0], b: 0x5a3a2a, W: 0xe8e8e8, G: 0x3a8a3a, m: 0x6a4a3a });
  const nose = p.fillCuboid(24, 0, 2, 4, 2, [0xa47e62, 0xb08a6e]);
  p.px(nose.front[0], nose.front[1] + 3, 0x3a7a2a);
  const robe = [0x3a2a4a, 0x4a3a5a, 0x2e2040, 0x56446a];
  p.fillCuboid(16, 20, 8, 12, 6, robe);
  p.fillCuboid(0, 38, 8, 20, 6, robe);
  const belt = p.cuboid(0, 38, 8, 20, 6);
  p.noise([belt.right[0], belt.right[1] + 7, 28, 1], [0x6a4a20, 0x7a5a2a]);
  p.fillCuboid(40, 38, 8, 4, 4, skin);
  p.fillCuboid(44, 22, 4, 8, 4, robe);
  p.fillCuboid(0, 22, 4, 12, 4, [0x2a1e30, 0x3a2a40]);
  const hat = [0x2a2a2a, 0x353535, 0x202020];
  p.fillCuboid(0, 64, 10, 2, 10, hat);
  p.fillCuboid(0, 76, 7, 4, 7, hat);
  const band = p.cuboid(0, 76, 7, 4, 7);
  p.noise([band.right[0], band.right[1] + 3, 28, 1], [0x3a7a2a, 0x4a8a3a]);
  p.fillCuboid(0, 87, 4, 4, 4, hat);
  p.fillCuboid(0, 95, 1, 2, 1, hat);
}

export function witchModel(): MobModel {
  const r = rig(skinOf("witch", 64, 128, paintWitch), WITCH);
  return wrap(r, (a) => {
    headLook(r.p.head, a);
    setRot(r.p.right_leg, Math.cos(a.phase * 0.6662) * 1.4 * a.walk * 0.5, 0, 0);
    setRot(r.p.left_leg, Math.cos(a.phase * 0.6662 + Math.PI) * 1.4 * a.walk * 0.5, 0, 0);
    setRot(r.p.nose, 0, 0, a.e.data.drinking ? 0 : Math.sin(a.age * 0.2) * 0.04);
    if (a.e.data.drinking) setRot(r.p.nose, -0.9, 0, 0);
  });
}

export function paintIllager(p: Pix, robe: number[], vindicator: boolean): void {
  const skin = [0x8a8a7a, 0x7e7e6e, 0x969686];
  const head = p.fillCuboid(0, 0, 8, 10, 8, skin);
  p.map(head.front[0], head.front[1], [
    "hhhhhhhh",
    "hhhhhhhh",
    "ssssssss",
    "kkkssKkk",
    "sGWssWGs",
    "ssssssss",
    "ssssssss",
    "ssssssss",
    "ssKKKKss",
    "ssssssss",
  ], { h: 0x2a2a2a, s: skin[0], k: 0x2a2a2a, K: 0x3a3a3a, W: 0xe0e0e0, G: 0x2a6a3a });
  p.noise(p.cuboid(0, 0, 8, 10, 8).top, [0x2a2a2a, 0x353535]);
  p.fillCuboid(24, 0, 2, 4, 2, [0x7e7e6e, 0x8a8a7a]);
  p.fillCuboid(16, 20, 8, 12, 6, robe);
  p.fillCuboid(0, 38, 8, 18, 6, robe.map((c) => shade(c, 0.9)));
  const jf = p.cuboid(0, 38, 8, 18, 6);
  p.noise([jf.front[0] + 3, jf.front[1], 2, 12], vindicator ? [0x2a2a2a] : [0x5a3a2a]);
  p.fillCuboid(40, 38, 8, 4, 4, skin);
  p.fillCuboid(44, 22, 4, 8, 4, robe);
  p.fillCuboid(40, 46, 4, 12, 4, robe);
  const hand = p.cuboid(40, 46, 4, 12, 4);
  p.noise([hand.right[0], hand.right[1] + 9, 16, 3], skin);
  p.fillCuboid(0, 22, 4, 12, 4, [0x3a3a3a, 0x2e2e2e]);
}

export function illagerModel(key: "pillager" | "vindicator", held: string): MobModel {
  const robe = key === "pillager" ? [0x3e4a5a, 0x46526a, 0x36404e] : [0x2a3a4a, 0x324458, 0x223040];
  const r = rig(skinOf(key, 64, 64, (p) => paintIllager(p, robe, key === "vindicator")), ILLAGER);
  const heldModel = attachHeld(r, held);
  return wrap(r, (a) => {
    headLook(r.p.head, a);
    humanoidLimbs(r, a, true);
    const crossed = key === "vindicator" && !a.e.data.aggressive;
    r.p.arms.visible = crossed;
    r.p.right_arm.visible = !crossed;
    r.p.left_arm.visible = !crossed;
    if (key === "pillager" && a.e.data.aggressive) {
      setRot(r.p.right_arm, -Math.PI / 2 + a.pitch, -0.3 + a.yaw, 0);
      setRot(r.p.left_arm, -Math.PI / 2 + a.pitch + (a.e.data.charging ? 0.4 : 0), 0.6 + a.yaw, 0);
    } else if (key === "vindicator" && a.e.data.aggressive) {
      const at = attackTime(a.e, a.pt);
      setRot(r.p.right_arm, -2.0 + Math.sin(at * Math.PI) * 1.4 + Math.cos(a.age * 0.09) * 0.05, 0, 0);
      setRot(r.p.left_arm, -0.6 + Math.cos(a.phase * 0.6662) * a.walk, 0, 0);
    }
    heldModel?.update(a.e);
  });
}
