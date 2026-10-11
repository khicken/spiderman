import * as THREE from "three";
import type { MobModel } from "../../contracts";
import { attachBlock } from "./held";
import { skinOf } from "./looks-undead";
import { Pix, shade } from "./pix";
import { DEG, headLook, rig, setPivot, setRot, wrap, type VPart } from "./rig";

export const CREEPER: VPart[] = [
  { name: "head", pivot: [0, 6, 0], box: [-4, -8, -4, 8, 8, 8], uv: [0, 0] },
  { name: "body", pivot: [0, 6, 0], box: [-4, 0, -2, 8, 12, 4], uv: [16, 16] },
  { name: "right_hind_leg", pivot: [-2, 18, 4], box: [-2, 0, -2, 4, 6, 4], uv: [0, 16] },
  { name: "left_hind_leg", pivot: [2, 18, 4], box: [-2, 0, -2, 4, 6, 4], uv: [0, 16] },
  { name: "right_front_leg", pivot: [-2, 18, -4], box: [-2, 0, -2, 4, 6, 4], uv: [0, 16] },
  { name: "left_front_leg", pivot: [2, 18, -4], box: [-2, 0, -2, 4, 6, 4], uv: [0, 16] },
];

export function paintCreeper(p: Pix): void {
  const greens = [0x5fc24e, 0x4fae3e, 0x74d65f, 0x3e8f30, 0x8de07a, 0x2d6b22];
  for (const [u, v, w, h, d] of [[0, 0, 8, 8, 8], [16, 16, 8, 12, 4], [0, 16, 4, 6, 4]]) {
    const f = p.cuboid(u, v, w, h, d);
    for (const r of [f.top, f.bottom, f.right, f.front, f.left, f.back])
      for (let y = 0; y < r[3]; y++)
        for (let x = 0; x < r[2]; x++) {
          const t = p.rand();
          const c = t < 0.35 ? greens[0] : t < 0.55 ? greens[1] : t < 0.7 ? greens[2] : t < 0.82 ? greens[3] : t < 0.9 ? 0xc8c8c8 : t < 0.95 ? greens[4] : greens[5];
          p.px(r[0] + x, r[1] + y, c);
        }
  }
  const face = p.cuboid(0, 0, 8, 8, 8).front;
  p.map(face[0], face[1], [
    "........",
    "........",
    ".KK..KK.",
    ".KK..KK.",
    "...kk...",
    "..KKKK..",
    "..KKKK..",
    "..K..K..",
  ], { K: 0x0a0a0a, k: 0x1c1c1c });
  const legs = p.cuboid(0, 16, 4, 6, 4);
  p.noise([legs.right[0], legs.right[1] + 5, 16, 1], [0x2d6b22, 0x3e8f30]);
}

export function creeperModel(): MobModel {
  const r = rig(skinOf("creeper", 64, 32, paintCreeper), CREEPER);
  const flash = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const charge = new THREE.MeshBasicMaterial({ color: 0x80c8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  flash.userData.glow = true;
  charge.userData.glow = true;
  for (const name of Object.keys(r.rest)) {
    const mesh = r.p[name].children[0] as THREE.Mesh;
    const f = new THREE.Mesh(mesh.geometry, flash);
    f.scale.setScalar(1.02);
    const c = new THREE.Mesh(mesh.geometry, charge);
    c.scale.setScalar(1.25);
    mesh.add(f, c);
  }
  const dispose = r.m.dispose;
  r.m.dispose = () => {
    dispose();
    flash.dispose();
    charge.dispose();
  };
  return wrap(r, (a) => {
    headLook(r.p.head, a);
    const c = Math.cos(a.phase * 0.6662) * 1.4 * a.walk;
    setRot(r.p.right_hind_leg, c, 0, 0);
    setRot(r.p.left_hind_leg, -c, 0, 0);
    setRot(r.p.right_front_leg, -c, 0, 0);
    setRot(r.p.left_front_leg, c, 0, 0);
    const prev = (a.e.data.swellPrev as number) ?? 0;
    const cur = (a.e.data.swell as number) ?? 0;
    const f = Math.max(0, Math.min(1, (prev + (cur - prev) * a.pt) / 28));
    const wobble = 1 + Math.sin(f * 100) * f * 0.01;
    const f4 = f * f * f * f;
    r.m.root.scale.set((1 + f4 * 0.4) * wobble, (1 + f4 * 0.1) / wobble, (1 + f4 * 0.4) * wobble);
    flash.opacity = Math.floor(f * 10) % 2 === 0 ? 0 : Math.min(1, Math.max(0.5, f)) * 0.8;
    charge.opacity = a.e.data.powered ? 0.25 + 0.1 * Math.sin(a.age * 0.3) : 0;
  });
}

const SPIDER_LEGS: [string, number, number, number, number][] = [
  ["right_hind_leg", -1, 2, -Math.PI / 4, Math.PI / 4],
  ["left_hind_leg", 1, 2, Math.PI / 4, -Math.PI / 4],
  ["right_middle_hind_leg", -1, 1, -0.58119464, 0.3926991],
  ["left_middle_hind_leg", 1, 1, 0.58119464, -0.3926991],
  ["right_middle_front_leg", -1, 0, -0.58119464, -0.3926991],
  ["left_middle_front_leg", 1, 0, 0.58119464, 0.3926991],
  ["right_front_leg", -1, -1, -Math.PI / 4, -Math.PI / 4],
  ["left_front_leg", 1, -1, Math.PI / 4, Math.PI / 4],
];

export const SPIDER: VPart[] = [
  { name: "head", pivot: [0, 15, -3], box: [-4, -4, -8, 8, 8, 8], uv: [32, 4] },
  { name: "body0", pivot: [0, 15, 0], box: [-3, -3, -3, 6, 6, 6], uv: [0, 0] },
  { name: "body1", pivot: [0, 15, 9], box: [-5, -4, -6, 10, 8, 12], uv: [0, 12] },
  ...SPIDER_LEGS.map(([name, side, z, zr, yr]): VPart => ({
    name, pivot: [side * 4, 15, z], box: side < 0 ? [-15, -1, -1, 16, 2, 2] : [-1, -1, -1, 16, 2, 2], uv: [18, 0], rot: [0, yr, zr],
  })),
];

export function paintSpider(p: Pix, body: number[], eye: number, stripes = false): void {
  p.fillCuboid(32, 4, 8, 8, 8, body);
  p.fillCuboid(0, 0, 6, 6, 6, body);
  const ab = p.fillCuboid(0, 12, 10, 8, 12, body);
  if (stripes) for (const r of [ab.top]) for (let y = 1; y < r[3]; y += 3) p.noise([r[0] + 2, r[1] + y, 6, 1], [0x2a6a7a, 0x1f5866]);
  p.noise(ab.top, body.map((c) => shade(c, 0.85)));
  for (let i = 0; i < 6; i++) p.px(ab.top[0] + 2 + Math.floor(p.rand() * 6), ab.top[1] + 1 + Math.floor(p.rand() * 10), shade(body[0], 1.4));
  p.fillCuboid(18, 0, 16, 2, 2, body);
  for (let x = 0; x < 40; x += 3) p.px(18 + x, 2, shade(body[0], 1.5));
  const face = p.cuboid(32, 4, 8, 8, 8).front;
  p.map(face[0], face[1], [
    "........",
    "........",
    "..e..e..",
    ".EE..EE.",
    ".EE..EE.",
    "........",
    "..f..f..",
    "..f..f..",
  ], { e: eye, E: shade(eye, 0.75), f: shade(body[0], 1.6) });
}

export function spiderModel(key: "spider" | "cave_spider"): MobModel {
  const cave = key === "cave_spider";
  const pix = skinOf(key, 64, 32, (p) => cave ? paintSpider(p, [0x0f3a40, 0x0c3036, 0x154a52, 0x0a262b], 0xd01010, true) : paintSpider(p, [0x3a322c, 0x2f2924, 0x463d35, 0x241f1b], 0xd01010));
  const r = rig(pix, SPIDER);
  return wrap(r, (a) => {
    headLook(r.p.head, a);
    const w = a.walk;
    const ph = a.phase * 0.6662 * 2;
    const yr = [
      -Math.cos(ph) * 0.4 * w,
      -Math.cos(ph + Math.PI) * 0.4 * w,
      -Math.cos(ph + Math.PI / 2) * 0.4 * w,
      -Math.cos(ph + Math.PI * 1.5) * 0.4 * w,
    ];
    const zr = [
      Math.abs(Math.sin(a.phase * 0.6662) * 0.4) * w,
      Math.abs(Math.sin(a.phase * 0.6662 + Math.PI) * 0.4) * w,
      Math.abs(Math.sin(a.phase * 0.6662 + Math.PI / 2) * 0.4) * w,
      Math.abs(Math.sin(a.phase * 0.6662 + Math.PI * 1.5) * 0.4) * w,
    ];
    SPIDER_LEGS.forEach(([name, side, , z0, y0], i) => {
      const k = i >> 1;
      const s = side < 0 ? 1 : -1;
      setRot(r.p[name], 0, y0 + s * yr[k], z0 + s * zr[k]);
    });
  }, { scale: cave ? 0.7 : 1 });
}

export const ENDERMAN: VPart[] = [
  { name: "head", pivot: [0, -13, 0], box: [-4, -8, -4, 8, 8, 8], uv: [0, 0] },
  { name: "jaw", pivot: [0, -13, 0], box: [-4, -8, -4, 8, 8, 8], uv: [0, 16], inflate: -0.5 },
  { name: "body", pivot: [0, -14, 0], box: [-4, 0, -2, 8, 12, 4], uv: [32, 16] },
  { name: "right_arm", pivot: [-5, -12, 0], box: [-1, -2, -1, 2, 30, 2], uv: [56, 0] },
  { name: "left_arm", pivot: [5, -12, 0], box: [-1, -2, -1, 2, 30, 2], uv: [56, 0], mirror: true },
  { name: "right_leg", pivot: [-2, -5, 0], box: [-1, 0, -1, 2, 30, 2], uv: [56, 0] },
  { name: "left_leg", pivot: [2, -5, 0], box: [-1, 0, -1, 2, 30, 2], uv: [56, 0], mirror: true },
];

export function paintEnderman(p: Pix): void {
  const blk = [0x161616, 0x0f0f0f, 0x1d1d1d, 0x121212];
  p.fillCuboid(0, 0, 8, 8, 8, blk);
  const jaw = p.fillCuboid(0, 16, 8, 8, 8, blk);
  for (const r of [jaw.top]) p.rect(r, 0, 0);
  for (const r of [jaw.front, jaw.right, jaw.left, jaw.back]) p.rect([r[0], r[1], r[2], 4], 0, 0);
  p.fillCuboid(32, 16, 8, 12, 4, blk);
  p.fillCuboid(56, 0, 2, 30, 2, blk);
  const face = p.cuboid(0, 0, 8, 8, 8).front;
  p.map(face[0], face[1], [
    "........",
    "........",
    "........",
    "........",
    "MmMMmMmM",
    "........",
    "........",
    "........",
  ], { M: 0xe079fa, m: 0xcc00fa });
}

export function endermanModel(): MobModel {
  const r = rig(skinOf("enderman", 64, 32, paintEnderman), ENDERMAN);
  const block = attachBlock(r, r.p.body, 0, -9, -8);
  const headBase: [number, number, number] = [0, -13, 0];
  return wrap(r, (a) => {
    headLook(r.p.head, a);
    headLook(r.p.jaw, a);
    const clamp = (v: number) => Math.max(-0.4, Math.min(0.4, v));
    const sw = (o: number) => clamp(Math.cos(a.phase * 0.6662 + o) * a.walk * 0.5);
    setRot(r.p.right_arm, sw(Math.PI), 0, 0.05);
    setRot(r.p.left_arm, sw(0), 0, -0.05);
    setRot(r.p.right_leg, sw(0) * 1.4, 0, 0);
    setRot(r.p.left_leg, sw(Math.PI) * 1.4, 0, 0);
    if (a.e.data.carried) {
      setRot(r.p.right_arm, -0.5, 0, 0.05);
      setRot(r.p.left_arm, -0.5, 0, -0.05);
    }
    setPivot(r.p.head, headBase, 0, a.e.data.angry ? -5 : 0, 0);
    block.update(a.e);
  });
}

export function slimePaint(p: Pix, magma: boolean): void {
  if (magma) {
    for (let i = 0; i < 8; i++) {
      const [u, v] = i === 2 ? [24, 10] : i === 3 ? [24, 19] : [0, i];
      const f = p.cuboid(u, v, 8, 1, 8);
      const red = i === 4 || i === 5;
      for (const r of [f.top, f.bottom]) p.noise(r, [0x3a1a10, 0x4a2414, 0x2a120a]);
      for (const r of [f.right, f.front, f.left, f.back]) p.noise(r, red ? [0xd84a10, 0xf07a20, 0xb83a0a] : [0x3a1a10, 0x52281a, 0x2a120a, 0x6a3a1a]);
    }
    p.fillCuboid(0, 16, 4, 4, 4, [0xf0a020, 0xf8c840, 0xe08010]);
    const eyes = p.cuboid(24, 10, 8, 1, 8).front;
    p.map(eyes[0], eyes[1], ["eE....Ee"], { e: 0xf8d020, E: 0xd04010 });
    return;
  }
  p.fillCuboid(0, 0, 8, 8, 8, [0x70c060, 0x80d070, 0x60b050], 150);
  p.fillCuboid(0, 16, 6, 6, 6, [0x5aa848, 0x4f9a40, 0x66b454]);
  p.fillCuboid(32, 0, 2, 2, 2, [0x1a2e14]);
  p.fillCuboid(32, 4, 2, 2, 2, [0x1a2e14]);
  p.fillCuboid(32, 8, 1, 1, 1, [0x2a4a22]);
}

export const SLIME: VPart[] = [
  { name: "cube", pivot: [0, 0, 0], box: [-3, 17, -3, 6, 6, 6], uv: [0, 16] },
  { name: "right_eye", pivot: [0, 0, 0], box: [-3.25, 18, -3.5, 2, 2, 2], uv: [32, 0] },
  { name: "left_eye", pivot: [0, 0, 0], box: [1.25, 18, -3.5, 2, 2, 2], uv: [32, 4] },
  { name: "mouth", pivot: [0, 0, 0], box: [0, 21, -3.5, 1, 1, 1], uv: [32, 8] },
  { name: "outer", pivot: [0, 0, 0], box: [-4, 16, -4, 8, 8, 8], uv: [0, 0] },
];
export const MAGMA: VPart[] = [
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i): VPart => ({ name: `cube${i}`, pivot: [0, 0, 0], box: [-4, 16 + i, -4, 8, 1, 8], uv: i === 2 ? [24, 10] : i === 3 ? [24, 19] : [0, i] })),
  { name: "inside_cube", pivot: [0, 0, 0], box: [-2, 18, -2, 4, 4, 4], uv: [0, 16] },
];

export function slimeModel(magma: boolean): MobModel {
  const r = rig(skinOf(magma ? "magma_cube" : "slime", 64, 32, (p) => slimePaint(p, magma)), magma ? MAGMA : SLIME);
  if (!magma) {
    r.m.material.transparent = true;
    r.m.material.alphaTest = 0.02;
    r.m.material.depthWrite = true;
  } else r.m.material.emissive.setRGB(0.2, 0.08, 0);
  const s = r.m.root.scale;
  return wrap(r, (a) => {
    const size = (a.e.data.size as number) ?? 1;
    const sq = ((a.e.data.squishPrev as number) ?? 0) + (((a.e.data.squish as number) ?? 0) - ((a.e.data.squishPrev as number) ?? 0)) * a.pt;
    if (magma) {
      for (let i = 0; i < 8; i++) r.p[`cube${i}`].position.y = (-(4 - i) * Math.max(0, sq) * 1.7) / 16;
      s.setScalar(size);
      return;
    }
    const f = sq / (size * 0.5 + 1);
    const f1 = 1 / (f + 1);
    s.set(f1 * size, (1 / f1) * size, f1 * size);
  });
}

export const SILVERFISH_SIZES: [number, number, number][] = [[3, 2, 2], [4, 3, 2], [6, 4, 3], [3, 3, 3], [2, 2, 3], [2, 1, 2], [1, 1, 2]];
const SILVERFISH_UV: [number, number][] = [[0, 0], [0, 4], [0, 9], [0, 16], [0, 22], [11, 0], [13, 4]];
export const ENDERMITE_SIZES: [number, number, number][] = [[4, 3, 2], [6, 4, 5], [3, 3, 1], [1, 2, 1]];
const ENDERMITE_UV: [number, number][] = [[0, 0], [0, 5], [0, 14], [0, 18]];

function segmentParts(sizes: [number, number, number][], uvs: [number, number][], silverfish: boolean): VPart[] {
  const parts: VPart[] = [];
  const zs: number[] = [];
  let z = -3.5;
  sizes.forEach(([w, h, d], i) => {
    zs.push(z);
    parts.push({ name: `seg${i}`, pivot: [0, 24 - h, z], box: [-w * 0.5, 0, -d * 0.5, w, h, d], uv: uvs[i] });
    if (i < sizes.length - 1) z += (d + sizes[i + 1][2]) * 0.5;
  });
  if (silverfish) {
    parts.push({ name: "layer0", pivot: [0, 16, zs[2]], box: [-5, 0, -sizes[2][2] * 0.5, 10, 8, sizes[2][2]], uv: [20, 0] });
    parts.push({ name: "layer1", pivot: [0, 20, zs[4]], box: [-3, 0, -sizes[4][2] * 0.5, 6, 4, sizes[4][2]], uv: [20, 11] });
    parts.push({ name: "layer2", pivot: [0, 19, zs[1]], box: [-3, 0, -sizes[4][2] * 0.5, 6, 5, sizes[1][2]], uv: [20, 18] });
  }
  return parts;
}

export function paintSegments(p: Pix, sizes: [number, number, number][], uvs: [number, number][], pal: number[], silverfish: boolean): void {
  sizes.forEach(([w, h, d], i) => {
    const f = p.fillCuboid(uvs[i][0], uvs[i][1], w, h, d, pal);
    if (i === 0) {
      p.px(f.front[0], f.front[1], silverfish ? 0x202020 : 0x8a2aa0);
      p.px(f.front[0] + w - 1, f.front[1], silverfish ? 0x202020 : 0x8a2aa0);
    }
  });
  if (silverfish) {
    p.fillCuboid(20, 0, 10, 8, 3, [0x7a7a7a, 0x6a6a6a, 0x8a8a8a, 0x5a5a5a]);
    p.fillCuboid(20, 11, 6, 4, 3, [0x7a7a7a, 0x6a6a6a, 0x8a8a8a]);
    p.fillCuboid(20, 18, 6, 5, 2, [0x7a7a7a, 0x6a6a6a, 0x8a8a8a]);
  }
}

export function segmentModel(silverfish: boolean): MobModel {
  const sizes = silverfish ? SILVERFISH_SIZES : ENDERMITE_SIZES;
  const uvs = silverfish ? SILVERFISH_UV : ENDERMITE_UV;
  const parts = segmentParts(sizes, uvs, silverfish);
  const pal = silverfish ? [0x9a9a9a, 0x8a8a8a, 0xaaaaaa, 0x7a7a7a] : [0x2a1a3a, 0x352247, 0x1f1330, 0x4a2a5a];
  const r = rig(skinOf(silverfish ? "silverfish" : "endermite", 64, 32, (p) => paintSegments(p, sizes, uvs, pal, silverfish)), parts);
  const base = parts.map((p) => p.pivot);
  return wrap(r, (a) => {
    for (let i = 0; i < sizes.length; i++) {
      const t = a.age * 0.9 + i * 0.15 * Math.PI;
      const k = silverfish ? Math.abs(i - 2) : Math.abs(i - 1);
      setRot(r.p[`seg${i}`], 0, Math.cos(t) * Math.PI * (silverfish ? 0.05 : 0.01) * (1 + k), 0);
      setPivot(r.p[`seg${i}`], base[i], Math.sin(t) * Math.PI * (silverfish ? 0.2 : 0.1) * k, 0, 0);
    }
    if (silverfish) {
      for (const [layer, seg] of [["layer0", 2], ["layer1", 4], ["layer2", 1]] as const) {
        r.p[layer].rotation.y = r.p[`seg${seg}`].rotation.y;
        r.p[layer].position.x = r.p[`seg${seg}`].position.x;
      }
    }
  });
}

export const PHANTOM: VPart[] = [
  { name: "body", pivot: [0, 0, 0], box: [-3, -2, -8, 5, 3, 9], uv: [0, 8], rot: [-0.1, 0, 0] },
  { name: "tail_base", parent: "body", pivot: [0, -2, 1], box: [-2, 0, 0, 3, 2, 6], uv: [3, 20] },
  { name: "tail_tip", parent: "tail_base", pivot: [0, 0.5, 6], box: [-1, 0, 0, 1, 1, 6], uv: [4, 29] },
  { name: "left_wing_base", parent: "body", pivot: [2, -2, -8], box: [0, 0, 0, 6, 2, 9], uv: [23, 12] },
  { name: "left_wing_tip", parent: "left_wing_base", pivot: [6, 0, 0], box: [0, 0, 0, 13, 1, 9], uv: [16, 24] },
  { name: "right_wing_base", parent: "body", pivot: [-3, -2, -8], box: [-6, 0, 0, 6, 2, 9], uv: [23, 12], mirror: true },
  { name: "right_wing_tip", parent: "right_wing_base", pivot: [-6, 0, 0], box: [-13, 0, 0, 13, 1, 9], uv: [16, 24], mirror: true },
  { name: "head", parent: "body", pivot: [0, 1, -7], box: [-4, -2, -5, 7, 3, 5], uv: [0, 0], rot: [0.2, 0, 0] },
];

export function paintPhantom(p: Pix): void {
  const blue = [0x4a5a8a, 0x3f4f7a, 0x55669a, 0x34436a];
  p.fillCuboid(0, 8, 5, 3, 9, blue);
  p.fillCuboid(3, 20, 3, 2, 6, blue);
  p.fillCuboid(4, 29, 1, 1, 6, blue);
  p.fillCuboid(23, 12, 6, 2, 9, blue);
  const tip = p.fillCuboid(16, 24, 13, 1, 9, [0x6a7aa8, 0x5a6a98, 0x7a8ab8]);
  for (let i = 0; i < 10; i++) p.px(tip.top[0] + Math.floor(p.rand() * 13), tip.top[1] + Math.floor(p.rand() * 9), 0xa8b4c8);
  const head = p.fillCuboid(0, 0, 7, 3, 5, blue);
  p.map(head.front[0], head.front[1], ["G.....G", "gG...Gg", "......."], { G: 0x7ae05a, g: 0x4ab03a });
}

export function phantomModel(): MobModel {
  const r = rig(skinOf("phantom", 64, 64, paintPhantom), PHANTOM, 6);
  return wrap(r, (a) => {
    const f = (a.e.id * 3 + a.age) * 7.448451 * DEG;
    const w = Math.cos(f) * 16 * DEG;
    setRot(r.p.left_wing_base, 0, 0, w);
    setRot(r.p.left_wing_tip, 0, 0, w);
    setRot(r.p.right_wing_base, 0, 0, -w);
    setRot(r.p.right_wing_tip, 0, 0, -w);
    setRot(r.p.tail_base, -(5 + Math.cos(f * 2) * 5) * DEG, 0, 0);
    setRot(r.p.tail_tip, -(5 + Math.cos(f * 2) * 5) * DEG, 0, 0);
    setRot(r.p.body, -0.1 + a.pitch, 0, 0);
    const size = (a.e.data.size as number) ?? 0;
    r.m.root.scale.setScalar(1 + 0.15 * size);
  });
}
