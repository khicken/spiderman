import type { MobModel } from "../../contracts";
import { paintPiglin, skinOf } from "./looks-undead";
import { Pix, shade, type Rect } from "./pix";
import { attackTime, headLook, rig, setPivot, setRot, wrap, type AnimArgs, type Rig, type VPart } from "./rig";

const legSwing = (a: AnimArgs, amp = 1.4) => Math.cos(a.phase * 0.6662) * amp * a.walk;

function dots(p: Pix, r: Rect, n: number, c: number) {
  for (let i = 0; i < n; i++) p.px(r[0] + Math.floor(p.rand() * r[2]), r[1] + Math.floor(p.rand() * r[3]), c);
}

// ---------- Warden ----------

export const WARDEN: VPart[] = [
  { name: "body", pivot: [0, 3, 0], box: [-9, -13, -4, 18, 21, 11], uv: [0, 0] },
  { name: "right_ribcage", parent: "body", pivot: [-7, -2, -4], box: [-2, -11, -0.1, 9, 21, 0], uv: [90, 11] },
  { name: "left_ribcage", parent: "body", pivot: [7, -2, -4], box: [-7, -11, -0.1, 9, 21, 0], uv: [90, 11], mirror: true },
  { name: "head", parent: "body", pivot: [0, -13, 0], box: [-8, -16, -5, 16, 16, 10], uv: [0, 32] },
  { name: "right_tendril", parent: "head", pivot: [-8, -12, 0], box: [-16, -13, 0, 16, 16, 0], uv: [52, 32] },
  { name: "left_tendril", parent: "head", pivot: [8, -12, 0], box: [0, -13, 0, 16, 16, 0], uv: [58, 0] },
  { name: "right_arm", parent: "body", pivot: [-13, -13, 1], box: [-4, 0, -4, 8, 28, 8], uv: [44, 50] },
  { name: "left_arm", parent: "body", pivot: [13, -13, 1], box: [-4, 0, -4, 8, 28, 8], uv: [0, 58] },
  { name: "right_leg", pivot: [-5.9, 11, 0], box: [-3, 0, -3, 6, 13, 6], uv: [76, 48] },
  { name: "left_leg", pivot: [5.9, 11, 0], box: [-3, 0, -3, 6, 13, 6], uv: [76, 76] },
];

const W_DARK = [0x0f3a3f, 0x0c3236, 0x134449, 0x0a2b2f];
const W_SOUL = 0x29dfeb;

function tendril(p: Pix, x0: number, y0: number, inner: "left" | "right") {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const t = inner === "right" ? 15 - x : x;
      const cy = 13 - t * 0.55;
      const half = 2.6 - t * 0.12;
      if (Math.abs(y - cy) < half && t < 15) p.px(x0 + x, y0 + y, t > 10 ? (p.rand() < 0.6 ? W_SOUL : 0x6ff6ff) : p.rand() < 0.5 ? 0x1c5a60 : 0x16484d);
      else p.px(x0 + x, y0 + y, 0, 0);
    }
}

export function paintWarden(p: Pix) {
  p.rect([0, 0, 128, 128], 0, 0);
  const body = p.fillCuboid(0, 0, 18, 21, 11, W_DARK);
  const f = body.front;
  p.noise([f[0] + 2, f[1] + 2, 14, 13], [0x05191c, 0x071f22, 0x041416]);
  for (const [x, y] of [[5, 5], [11, 7], [7, 10], [12, 12], [4, 13]]) {
    p.px(f[0] + x, f[1] + y, W_SOUL);
    p.px(f[0] + x + 1, f[1] + y, 0x8af8ff);
    p.px(f[0] + x, f[1] + y + 1, 0x1cb5c0);
  }
  for (const r of [body.top, body.right, body.left, body.back]) dots(p, r, 14, 0x1f5f63);
  p.noise([body.back[0] + 6, body.back[1] + 3, 6, 10], [0x1a5257, 0x164a4f]);
  for (let y = 0; y < 21; y++)
    for (let x = 0; x < 9; x++) {
      const rib = y % 4 === 1 && y < 18 && x > 1;
      const spine = x >= 7;
      const c = rib || spine ? (p.rand() < 0.5 ? 0x4f8f8a : 0x41807b) : 0;
      p.px(90 + x, 11 + y, c, c ? 255 : 0);
      p.px(99 + x, 11 + y, c, c ? 255 : 0);
    }
  const head = p.fillCuboid(0, 32, 16, 16, 10, W_DARK);
  const hf = head.front;
  p.noise([hf[0], hf[1], 16, 3], [0x1a5055, 0x16484d]);
  p.noise([hf[0] + 2, hf[1] + 10, 12, 3], [0x03100f, 0x061a1b]);
  for (let x = 3; x < 13; x += 2) {
    p.px(hf[0] + x, hf[1] + 10, 0xb9d2c8);
    p.px(hf[0] + x, hf[1] + 12, 0xb9d2c8);
  }
  for (const r of [head.top, head.right, head.left, head.back]) dots(p, r, 10, 0x1f5f63);
  tendril(p, 52, 32, "right");
  tendril(p, 68, 32, "left");
  tendril(p, 58, 0, "left");
  tendril(p, 74, 0, "right");
  for (const [u, v] of [[44, 50], [0, 58]] as const) {
    const arm = p.fillCuboid(u, v, 8, 28, 8, W_DARK);
    p.noise([arm.right[0], arm.right[1] + 22, 32, 6], [0x1d5a5f, 0x184c50]);
    dots(p, arm.front, 6, W_SOUL);
  }
  for (const [u, v] of [[76, 48], [76, 76]] as const) {
    const leg = p.fillCuboid(u, v, 6, 13, 6, W_DARK);
    p.noise([leg.right[0], leg.right[1] + 10, 24, 3], [0x1d5a5f, 0x184c50]);
  }
}

export function wardenModel(): MobModel {
  const r = rig(skinOf("warden", 128, 128, paintWarden), WARDEN);
  const root = r.m.root;
  return wrap(r, (a) => {
    const e = a.e;
    headLook(r.p.head, a);
    const s = legSwing(a, 1.0);
    setRot(r.p.right_leg, s, 0, 0);
    setRot(r.p.left_leg, -s, 0, 0);
    setRot(r.p.right_arm, -s * 0.7, 0, 0);
    setRot(r.p.left_arm, s * 0.7, 0, 0);
    setRot(r.p.body, 0, 0, Math.sin(a.phase * 0.6662) * 0.1 * a.walk);
    const anger = typeof e.data.anger === "number" ? e.data.anger / 150 : 0;
    const wig = Math.sin(a.age * (0.1 + anger * 0.6)) * (0.1 + anger * 0.3);
    setRot(r.p.left_tendril, 0, 0, wig);
    setRot(r.p.right_tendril, 0, 0, -wig);
    const at = attackTime(e, a.pt);
    if (at > 0) {
      const k = Math.sin(at * Math.PI);
      setRot(r.p.right_arm, -k * 1.6, 0, 0);
      setRot(r.p.left_arm, -k * 1.6, 0, 0);
    }
    const boom = typeof e.data.boom === "number" ? e.data.boom : 0;
    if (boom > 0) {
      const k = Math.min(1, (60 - boom) / 20);
      setRot(r.p.head, -0.6 * k + a.pitch, a.yaw, 0);
      setRot(r.p.right_arm, -0.4 * k, 0, 0.6 * k);
      setRot(r.p.left_arm, -0.4 * k, 0, -0.6 * k);
    }
    const emerge = typeof e.data.emerge === "number" ? e.data.emerge : 0;
    const dig = typeof e.data.dig === "number" ? e.data.dig : 0;
    const under = emerge > 0 ? emerge / 134 : dig > 0 ? 1 - dig / 100 : 0;
    root.position.y = -under * 2.9;
  });
}

// ---------- Hoglin / Zoglin ----------

export const HOGLIN: VPart[] = [
  { name: "body", pivot: [0, 7, 0], box: [-8, -7, -13, 16, 14, 26], uv: [1, 1] },
  { name: "mane", parent: "body", pivot: [0, -14, -5], box: [0, 0, -9, 0, 10, 19], uv: [90, 33], inflate: 0.001 },
  { name: "head", pivot: [0, 2, -12], box: [-7, -3, -19, 14, 6, 19], uv: [61, 1], rot: [0.87266463, 0, 0] },
  { name: "right_ear", parent: "head", pivot: [-6, -2, -3], box: [-6, -1, -2, 6, 1, 4], uv: [1, 1], rot: [0, 0, -0.6981317] },
  { name: "left_ear", parent: "head", pivot: [6, -2, -3], box: [0, -1, -2, 6, 1, 4], uv: [1, 6], rot: [0, 0, 0.6981317] },
  { name: "right_horn", parent: "head", pivot: [-7, 2, -12], box: [-1, -11, -1, 2, 11, 2], uv: [10, 13] },
  { name: "left_horn", parent: "head", pivot: [7, 2, -12], box: [-1, -11, -1, 2, 11, 2], uv: [1, 13] },
  { name: "right_front_leg", pivot: [-4, 10, -8.5], box: [-3, 0, -3, 6, 14, 6], uv: [66, 42] },
  { name: "left_front_leg", pivot: [4, 10, -8.5], box: [-3, 0, -3, 6, 14, 6], uv: [41, 42] },
  { name: "right_hind_leg", pivot: [-5, 13, 10], box: [-2.5, 0, -2.5, 5, 11, 5], uv: [21, 45] },
  { name: "left_hind_leg", pivot: [5, 13, 10], box: [-2.5, 0, -2.5, 5, 11, 5], uv: [0, 45] },
];

export function paintHoglin(p: Pix, zombie: boolean) {
  p.rect([0, 0, 128, 64], 0, 0);
  const skin = zombie ? [0xe2b4a8, 0xd9a497, 0xecc4b8, 0xc89488] : [0xc4785e, 0xb86c54, 0xcf8669, 0xa95f4a];
  const hair = zombie ? [0xcfc8c0, 0xbdb5ac, 0xe0dad2] : [0x5c3a2a, 0x4d3022, 0x6a4532];
  const rot = [0x7a9a6a, 0x6a8a5a, 0x8aa87a];
  const body = p.fillCuboid(1, 1, 16, 14, 26, skin);
  p.noise(body.top, hair);
  for (const r of [body.right, body.left, body.front, body.back]) {
    p.noise([r[0], r[1], r[2], 4], hair);
    for (let i = 0; i < r[2]; i += 2) if (p.rand() < 0.6) p.px(r[0] + i, r[1] + 4, hair[0]);
  }
  if (zombie) for (const r of [body.right, body.left, body.top]) {
    for (let i = 0; i < 4; i++) p.noise([r[0] + Math.floor(p.rand() * (r[2] - 4)), r[1] + Math.floor(p.rand() * (r[3] - 3)), 4, 3], rot);
    for (let i = 0; i < 3; i++) p.rect([r[0] + Math.floor(p.rand() * (r[2] - 1)), r[1] + 6 + Math.floor(p.rand() * 6), 1, 4], 0xe8e2d0);
  }
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 19; x++) {
      const c = zombie ? (p.rand() < 0.5 ? 0xe4ded6 : 0xcfc8be) : p.rand() < 0.5 ? 0xe6c46a : 0xd2ab52;
      const keep = y > 10 - (3 + ((x * 7) % 5) + (x > 3 && x < 16 ? 4 : 0));
      p.px(90 + x, 52 + y, c, keep ? 255 : 0);
      p.px(109 + x, 52 + y, c, keep ? 255 : 0);
    }
  const head = p.fillCuboid(61, 1, 14, 6, 19, skin);
  p.noise(head.top, hair);
  const hf = head.front;
  p.noise([hf[0] + 2, hf[1] + 1, 10, 4], skin.map((c) => shade(c, 1.08)));
  p.px(hf[0] + 4, hf[1] + 2, 0x3a1c14);
  p.px(hf[0] + 9, hf[1] + 2, 0x3a1c14);
  const eye = zombie ? 0xc8201a : 0x1a1a1a;
  p.px(head.right[0] + 15, head.right[1] + 1, eye);
  p.px(head.left[0] + 3, head.left[1] + 1, eye);
  p.fillCuboid(1, 1, 6, 1, 4, skin);
  p.fillCuboid(1, 6, 6, 1, 4, skin);
  const tusk = zombie ? [0xd6d0be, 0xc8c2ae] : [0xf0e8d0, 0xe2dac0, 0xfaf4e0];
  p.fillCuboid(10, 13, 2, 11, 2, tusk);
  p.fillCuboid(1, 13, 2, 11, 2, tusk);
  for (const [u, v, w, h] of [[66, 42, 6, 14], [41, 42, 6, 14], [21, 45, 5, 11], [0, 45, 5, 11]] as const) {
    const leg = p.fillCuboid(u, v, w, h, w, skin);
    p.noise([leg.right[0], leg.right[1], 4 * w, 3], hair);
    p.noise([leg.right[0], leg.right[1] + h - 2, 4 * w, 2], zombie ? [0x8a8478, 0x7a7468] : [0x3a2418, 0x2e1c12]);
  }
}

export function hoglinModel(zombie: boolean): MobModel {
  const key = zombie ? "zoglin" : "hoglin";
  const r = rig(skinOf(key, 128, 64, (p) => paintHoglin(p, zombie)), HOGLIN);
  return wrap(r, (a) => {
    const s = legSwing(a, 1.2);
    setRot(r.p.right_front_leg, s, 0, 0);
    setRot(r.p.left_front_leg, -s, 0, 0);
    setRot(r.p.right_hind_leg, -s, 0, 0);
    setRot(r.p.left_hind_leg, s, 0, 0);
    const at = attackTime(a.e, a.pt);
    const lift = at > 0 ? -Math.sin(at * Math.PI) * 0.9 : 0;
    setRot(r.p.head, 0.87266463 + lift + Math.max(-0.4, Math.min(0.4, a.pitch)), a.yaw * 0.6, 0);
    setRot(r.p.right_ear, 0, 0, -0.6981317 - a.walk * Math.sin(a.phase) * 0.3);
    setRot(r.p.left_ear, 0, 0, 0.6981317 + a.walk * Math.sin(a.phase) * 0.3);
  });
}

// ---------- Strider ----------

export const STRIDER: VPart[] = [
  { name: "right_leg", pivot: [-4, 8, 0], box: [-2, 0, -2, 4, 16, 4], uv: [0, 32] },
  { name: "left_leg", pivot: [4, 8, 0], box: [-2, 0, -2, 4, 16, 4], uv: [0, 55] },
  { name: "body", pivot: [0, 1, 0], box: [-8, -6, -8, 16, 14, 16], uv: [0, 0] },
  { name: "right_bottom_bristle", parent: "body", pivot: [-8, 4, -8], box: [-12, 0, 0, 12, 0, 16], uv: [16, 65], rot: [0, 0, -1.2217305] },
  { name: "right_middle_bristle", parent: "body", pivot: [-8, -1, -8], box: [-12, 0, 0, 12, 0, 16], uv: [16, 49], rot: [0, 0, -1.134464] },
  { name: "right_top_bristle", parent: "body", pivot: [-8, -5, -8], box: [-12, 0, 0, 12, 0, 16], uv: [16, 33], rot: [0, 0, -0.87266463] },
  { name: "left_top_bristle", parent: "body", pivot: [8, -6, -8], box: [0, 0, 0, 12, 0, 16], uv: [16, 33], rot: [0, 0, 0.87266463], mirror: true },
  { name: "left_middle_bristle", parent: "body", pivot: [8, -2, -8], box: [0, 0, 0, 12, 0, 16], uv: [16, 49], rot: [0, 0, 1.134464], mirror: true },
  { name: "left_bottom_bristle", parent: "body", pivot: [8, 3, -8], box: [0, 0, 0, 12, 0, 16], uv: [16, 65], rot: [0, 0, 1.2217305], mirror: true },
];

const BRISTLES = ["right_bottom_bristle", "right_middle_bristle", "right_top_bristle", "left_top_bristle", "left_middle_bristle", "left_bottom_bristle"];

export function paintStrider(p: Pix, cold: boolean) {
  p.rect([0, 0, 64, 128], 0, 0);
  const base = cold ? [0x7e6a86, 0x705e78, 0x8c7894, 0x64526c] : [0x9c3436, 0x8e2e30, 0xaa3e3e, 0x7e2628];
  const spot = cold ? 0x9a88a2 : 0xc25048;
  const body = p.fillCuboid(0, 0, 16, 14, 16, base);
  for (const r of [body.top, body.right, body.left, body.back, body.front]) dots(p, r, 12, spot);
  const f = body.front;
  p.map(f[0], f[1] + 4, [
    "................",
    "..WWW......WWW..",
    "..WKW......WKW..",
    "..WWW......WWW..",
    "................",
    "................",
    "....mmmmmmmm....",
    "....mMMMMMMm....",
    "....mmmmmmmm....",
  ], { W: cold ? 0xd8cce0 : 0xf2d6c8, K: cold ? 0x3a2a4a : 0x4a1030, m: shade(base[0], 0.7), M: cold ? 0x2a2030 : 0x2a0a10 });
  const leg = cold ? [0x6a5872, 0x5e4e66, 0x76647e] : [0x6e2c3c, 0x622636, 0x7a3444];
  for (const v of [32, 55]) {
    const l = p.fillCuboid(0, v, 4, 16, 4, leg);
    p.noise([l.right[0], l.right[1] + 14, 16, 2], [0x2a1a20, 0x221418]);
  }
  const hair = cold ? [0x5a4a62, 0x6a5a72, 0x4e4056] : [0x5c2236, 0x6e2a40, 0x4e1c2c];
  for (const v of [33, 49, 65]) {
    for (const x0 of [32, 44])
      for (let x = 0; x < 12; x++)
        for (let y = 0; y < 16; y++) {
          const len = 3 + ((x * 5 + y * 3 + v) % 9);
          p.px(x0 + x, v + y, hair[(x + y) % hair.length], x < len ? 255 : 0);
        }
  }
}

function paintStriderSaddle(p: Pix) {
  p.rect([0, 0, 64, 128], 0, 0);
  const s = p.cuboid(0, 0, 16, 14, 16);
  const leather = [0x6a3e22, 0x5a341c, 0x7a4a2a];
  p.noise([s.top[0] + 3, s.top[1] + 2, 10, 12], leather);
  for (const r of [s.right, s.left]) p.noise([r[0] + 6, r[1], 4, 6], leather);
  p.noise([s.right[0] + 7, s.right[1] + 6, 2, 2], [0x9a9a9a, 0x7a7a7a]);
  p.noise([s.left[0] + 7, s.left[1] + 6, 2, 2], [0x9a9a9a, 0x7a7a7a]);
}

export function striderModel(): MobModel {
  const warm = rig(skinOf("strider", 64, 128, (p) => paintStrider(p, false)), STRIDER);
  const coldTex = skinOf("strider_cold", 64, 128, (p) => paintStrider(p, true)).toCanvas();
  const saddleRig = rig(skinOf("strider_saddle", 64, 128, paintStriderSaddle), [{ name: "body", pivot: [0, 1, 0], box: [-8, -6, -8, 16, 14, 16], uv: [0, 0], inflate: 0.5 }]);
  return striderWrap(warm, saddleRig, coldTex);
}

function striderWrap(r: Rig, saddle: Rig, coldCanvas: HTMLCanvasElement | OffscreenCanvas): MobModel {
  r.m.root.children[0].add(saddle.p.body);
  const warmMap = r.m.material.map;
  let coldMap: typeof warmMap = null;
  const m = wrap(r, (a) => {
    const e = a.e;
    const cold = e.data.cold === true;
    if (cold && !coldMap && warmMap) {
      coldMap = warmMap.clone();
      coldMap.image = coldCanvas;
      coldMap.needsUpdate = true;
    }
    const map = cold ? coldMap : warmMap;
    if (map && r.m.material.map !== map) {
      r.m.material.map = map;
      r.m.material.needsUpdate = true;
    }
    saddle.p.body.visible = e.data.saddle === true;
    const s = Math.cos(a.phase * 1.5) * 2 * Math.min(0.25, a.walk);
    setRot(r.p.right_leg, s, 0, 0);
    setRot(r.p.left_leg, -s, 0, 0);
    const bob = Math.abs(Math.cos(a.phase * 0.75)) * 2 * a.walk;
    const shiver = cold ? Math.sin(a.age * 2.5) * 0.06 : 0;
    setRot(r.p.body, 0, 0, Math.sin(a.phase * 0.75) * 0.15 * a.walk + shiver);
    setPivot(r.p.body, [0, 1, 0], 0, -bob, 0);
    setPivot(r.p.right_leg, [-4, 8, 0], 0, -bob, 0);
    setPivot(r.p.left_leg, [4, 8, 0], 0, -bob, 0);
    saddle.p.body.position.copy(r.p.body.position);
    saddle.p.body.rotation.copy(r.p.body.rotation);
    for (let i = 0; i < BRISTLES.length; i++) {
      const rest = r.rest[BRISTLES[i]][2];
      setRot(r.p[BRISTLES[i]], 0, 0, rest + Math.sin(a.age * 0.1 + i) * 0.08 + (cold ? 0 : a.walk * 0.2 * Math.sign(rest)));
    }
  });
  const dispose = m.dispose;
  m.dispose = () => {
    dispose();
    saddle.m.dispose();
    coldMap?.dispose();
  };
  return m;
}

// ---------- Ravager ----------

export const RAVAGER: VPart[] = [
  { name: "neck", pivot: [0, -7, 5.5], box: [-5, -1, -18, 10, 10, 18], uv: [68, 73] },
  { name: "head", parent: "neck", pivot: [0, 16, -17], box: [-8, -20, -14, 16, 20, 16], uv: [0, 0], extra: [{ box: [-2, -6, -18, 4, 8, 4], uv: [0, 0] }] },
  { name: "right_horn", parent: "head", pivot: [-10, -14, -8], box: [0, -14, -2, 2, 14, 4], uv: [74, 55], rot: [1.0995574, 0, 0] },
  { name: "left_horn", parent: "head", pivot: [8, -14, -8], box: [0, -14, -2, 2, 14, 4], uv: [74, 55], rot: [1.0995574, 0, 0], mirror: true },
  { name: "mouth", parent: "head", pivot: [0, -2, 2], box: [-8, 0, -16, 16, 3, 16], uv: [0, 36] },
  { name: "body", pivot: [0, 1, 2], box: [-7, -10, -7, 14, 16, 20], uv: [0, 55], rot: [Math.PI / 2, 0, 0], extra: [{ box: [-6, 6, -7, 12, 13, 18], uv: [0, 91] }] },
  { name: "right_hind_leg", pivot: [-8, -13, 18], box: [-4, 0, -4, 8, 37, 8], uv: [96, 0] },
  { name: "left_hind_leg", pivot: [8, -13, 18], box: [-4, 0, -4, 8, 37, 8], uv: [96, 0], mirror: true },
  { name: "right_front_leg", pivot: [-8, -13, -5], box: [-4, 0, -4, 8, 37, 8], uv: [64, 0] },
  { name: "left_front_leg", pivot: [8, -13, -5], box: [-4, 0, -4, 8, 37, 8], uv: [64, 0], mirror: true },
];

export function paintRavager(p: Pix) {
  p.rect([0, 0, 128, 128], 0, 0);
  const grey = [0x5f5a54, 0x57524c, 0x68635c, 0x4e4944];
  const dark = [0x3e3a36, 0x36322e, 0x46423d];
  const head = p.fillCuboid(0, 0, 16, 20, 16, grey);
  const hf = head.front;
  p.noise([hf[0], hf[1] + 5, 16, 4], dark);
  p.map(hf[0], hf[1] + 6, ["................", "...WWW....WWW...", "...WKW....WKW..."], { W: 0xd8d2c4, K: 0x101010 });
  p.noise([hf[0] + 3, hf[1] + 12, 10, 8], [0x4a4540, 0x524d47]);
  p.noise([0, 0, 4, 4], [0x3a3632, 0x302c28]);
  p.fillCuboid(74, 55, 2, 14, 4, [0xd8cfb8, 0xcac0a6, 0xe4dcc8]);
  const mouth = p.fillCuboid(0, 36, 16, 3, 16, dark);
  p.noise(mouth.top, [0x5a2a2a, 0x4a2020]);
  for (let x = 0; x < 16; x += 2) p.px(mouth.front[0] + x, mouth.front[1], 0xe8e0c8);
  const neck = p.fillCuboid(68, 73, 10, 10, 18, grey);
  p.noise(neck.top, dark);
  const body = p.fillCuboid(0, 55, 14, 16, 20, grey);
  p.noise([body.right[0], body.right[1], 68, 4], dark);
  p.noise(body.front, dark);
  p.fillCuboid(0, 91, 12, 13, 18, [0x6e6962, 0x77726a, 0x655f58]);
  for (const u of [96, 64]) {
    const leg = p.fillCuboid(u, 0, 8, 37, 8, grey);
    p.noise([leg.right[0], leg.right[1] + 33, 32, 4], [0x2a2622, 0x22201c]);
    p.noise([leg.right[0], leg.right[1], 32, 6], dark);
  }
}

export function ravagerModel(): MobModel {
  const r = rig(skinOf("ravager", 128, 128, paintRavager), RAVAGER);
  return wrap(r, (a) => {
    const e = a.e;
    const s = legSwing(a, 0.4 * 2);
    setRot(r.p.right_hind_leg, s, 0, 0);
    setRot(r.p.left_hind_leg, -s, 0, 0);
    setRot(r.p.right_front_leg, -s, 0, 0);
    setRot(r.p.left_front_leg, s, 0, 0);
    setRot(r.p.head, a.pitch * 0.6, a.yaw * 0.6, 0);
    const at = attackTime(e, a.pt);
    const roar = typeof e.data.roar === "number" ? e.data.roar : 0;
    const stun = typeof e.data.stun === "number" ? e.data.stun : 0;
    let open = at > 0 ? Math.sin(at * Math.PI) * 0.8 : 0;
    if (roar > 0) {
      open = 0.9;
      setRot(r.p.head, -0.5, Math.sin(a.age) * 0.1, 0);
    }
    if (stun > 0) setRot(r.p.head, 0, Math.sin(a.age * 0.8) * 0.3, 0);
    setRot(r.p.mouth, open, 0, 0);
    setPivot(r.p.neck, [0, -7, 5.5], 0, at > 0 ? Math.sin(at * Math.PI) * 2 : 0, at > 0 ? -Math.sin(at * Math.PI) * 3 : 0);
  });
}

// ---------- Piglin brute ----------

export function paintPiglinBrute(p: Pix) {
  paintPiglin(p);
  const cloth = [0x2a2a2e, 0x323236, 0x232326];
  const body = p.cuboid(16, 16, 8, 12, 4);
  for (const r of [body.front, body.back, body.right, body.left]) p.noise([r[0], r[1], r[2], 8], cloth);
  p.noise([body.front[0], body.front[1] + 8, 8, 1], [0xe8c23a, 0xd4ad2a]);
  p.noise([body.back[0], body.back[1] + 8, 8, 1], [0xe8c23a, 0xd4ad2a]);
  for (const [u, v] of [[40, 16], [32, 48]] as const) {
    const arm = p.cuboid(u, v, 4, 12, 4);
    p.noise([arm.right[0], arm.right[1], 16, 4], cloth);
    p.noise([arm.right[0], arm.right[1] + 4, 16, 1], [0xe8c23a]);
  }
  for (const [u, v] of [[0, 16], [16, 48]] as const) p.noise(p.cuboid(u, v, 4, 12, 4).right.map((n, i) => (i === 2 ? 16 : i === 3 ? 10 : n)) as Rect, [0x1e1e22, 0x26262a]);
  const head = p.cuboid(0, 0, 10, 8, 8);
  p.noise([head.front[0], head.front[1], 10, 2], [0x1a1a1a, 0x252525]);
}
