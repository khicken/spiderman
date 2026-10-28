import { BLOCKS } from "../blocks/registry";
import { box, cross, FL, planeY, planeZ, quad, setFL, setFLBlock, T, tiltA, tiltB, uvRect } from "./box";
import { F2H, HDX, HDZ, M, PY, PZ } from "./ctx";
import { AOCC, layerOf, layerOr, SH, TEX } from "./tables";

const E = 1, W = 2, U = 4, D = 8, S = 16, N = 32;
const SIDES = [0, 1, 4, 5];

export const enum C {
  None, Hanging, WallHanging, Dripleaf, Cocoa, Pickle, Shrieker, Candle, Banner, WallBanner, Brewing, Conduit, Bell,
  Grindstone, Stonecutter, HeavyCore, Pot, SnifferEgg, TurtleEgg, Skull, WallSkull, PistonHead, Moving, Daylight, Hook,
  Tripwire, Sensor, EndPortal, Gateway, DragonEgg, Fire,
}

export const CK = new Uint8Array(4096);
const HEAD = new Uint8Array(4096); // 0 plain, 1 piglin, 2 dragon
const FLAM = new Uint8Array(4096);
const FLAM_NAMES = /_planks$|_log$|_wood$|_stem$|_hyphae$|_wool$|_carpet$|leaves$|bookshelf|^tnt$|hay_block|vine|scaffolding|^target$|bee_nest|beehive|dried_kelp_block|azalea|moss|_fence$|_fence_gate$|_stairs$|_slab$/;

const NAMED: Record<string, C> = {
  big_dripleaf: C.Dripleaf, cocoa: C.Cocoa, sea_pickle: C.Pickle, sculk_shrieker: C.Shrieker, brewing_stand: C.Brewing,
  conduit: C.Conduit, bell: C.Bell, grindstone: C.Grindstone, stonecutter: C.Stonecutter, heavy_core: C.HeavyCore,
  decorated_pot: C.Pot, sniffer_egg: C.SnifferEgg, turtle_egg: C.TurtleEgg, piston_head: C.PistonHead,
  sticky_piston_head: C.PistonHead, moving_piston: C.Moving, daylight_detector: C.Daylight, inverted_daylight_detector: C.Daylight,
  tripwire_hook: C.Hook, tripwire: C.Tripwire, sculk_sensor: C.Sensor, calibrated_sculk_sensor: C.Sensor,
  end_portal: C.EndPortal, end_gateway: C.Gateway, dragon_egg: C.DragonEgg, fire: C.Fire, soul_fire: C.Fire,
};

for (const d of BLOCKS) {
  const n = d.name;
  const t = d.tags ?? [];
  let k = NAMED[n] ?? C.None;
  if (n.endsWith("_wall_hanging_sign")) k = C.WallHanging;
  else if (n.endsWith("_hanging_sign")) k = C.Hanging;
  else if (n.endsWith("_wall_banner")) k = C.WallBanner;
  else if (n.endsWith("_banner")) k = C.Banner;
  else if (t.includes("candles")) k = C.Candle;
  else if (/_wall_(skull|head)$/.test(n)) k = C.WallSkull;
  else if (/_(skull|head)$/.test(n) && d.shape === "custom") k = C.Skull;
  CK[d.id] = k;
  if (n.startsWith("piglin")) HEAD[d.id] = 1;
  else if (n.startsWith("dragon_")) HEAD[d.id] = 2;
  if (d.flammable || FLAM_NAMES.test(n)) FLAM[d.id] = 1;
}

const rect = (u0: number, v0: number, u1: number, v1: number) => [u0, v0, u0, v1, u1, v1, u1, v0];
const FULL_UV = rect(0, 0, 16, 16);
const texUp = () => TEX[M.id * 96 + 2];
const texF = (f: number) => TEX[M.id * 96 + f];
const nbH = (h: number) => M.blocks[M.pi + HDX[h] + HDZ[h] * PZ];
const PX4 = new Float32Array(12);

function plain() {
  T.ao = false;
  T.shade = false;
  T.cull = false;
}

function sideUv(u0: number, v0: number, u1: number, v1: number) {
  for (const f of SIDES) uvRect(f, u0, v0, u1, v1);
}

export function planeX(x: number, z0: number, z1: number, y0: number, y1: number, layer: number, uv: ArrayLike<number> = FULL_UV) {
  PX4.set([x, y1, z0, x, y0, z0, x, y0, z1, x, y1, z1]);
  quad(PX4, uv, layer);
}

export function plus(cx: number, cz: number, r: number, y0: number, y1: number, layer: number, uv: ArrayLike<number>) {
  const dbl = T.double;
  T.double = true;
  planeZ(cz, cx - r, cx + r, y0, y1, layer, uv);
  planeX(cx, cz - r, cz + r, y0, y1, layer, uv);
  T.double = dbl;
}

export function facing6(f: number) {
  if (f === 3) tiltB(1, 180);
  else if (f !== 2 && f < 6) {
    tiltB(1, -90);
    T.rot = (F2H[f] - 2) & 3;
  }
}

function hangingSign(wall: boolean) {
  const wood = texUp();
  const chain = layerOr("chain", wood);
  T.ao = false;
  if (wall) {
    T.rot = M.meta & 3;
    setFL(wood);
    box(0, 14, 6, 16, 16, 10);
  } else tiltA(2, -M.meta * 22.5);
  setFL(wood);
  box(1, 0, 7, 15, 10, 9);
  const top = wall ? 14 : 16;
  const uv = rect(6, 0, 9, top - 10);
  plus(3, 8, 1.5, 10, top, chain, uv);
  plus(13, 8, 1.5, 10, top, chain, uv);
}

function dripleaf() {
  const top = texUp();
  const side = texF(0);
  setFL(top);
  for (const f of SIDES) FL[f] = side;
  sideUv(0, 0, 16, 1);
  box(0, 14, 0, 16, 15, 16);
  T.uvMask = 0;
  plain();
  cross(layerOr("big_dripleaf_stem", side), 0.8, 15.2, 0, 14);
}


function cocoa() {
  const m = M.meta, a = Math.min(2, m >> 2);
  const l = layerOr(`cocoa_stage${a}`, texUp());
  const w = 4 + 2 * a, h = 5 + 2 * a;
  const x0 = 8 - w / 2, z0 = 15 - w;
  T.rot = m & 3;
  setFL(l);
  sideUv(x0, 4, x0 + w, 4 + h);
  uvRect(2, x0, 4, x0 + w, 4 + w);
  uvRect(3, x0, 4, x0 + w, 4 + w);
  box(x0, 12 - h, z0, x0 + w, 12, 15);
  T.uvMask = 0;
  T.double = true;
  T.ao = false;
  planeX(8, 12, 16, 12, 16, l, rect(6, 0, 10, 4));
}

const PICKLES = [
  [[6, 6, 6]],
  [[3, 3, 6], [9, 8, 4]],
  [[6, 10, 6], [2, 2, 4], [10, 4, 6]],
  [[2, 2, 6], [10, 2, 4], [2, 10, 4], [10, 10, 6]],
];
function pickles() {
  const l = texUp();
  setFL(l);
  for (const [x, z, h] of PICKLES[M.meta & 3]) {
    T.uvMask = 0;
    sideUv(6, 4, 10, 4 + h);
    uvRect(2, 6, 4, 10, 8);
    uvRect(3, 6, 4, 10, 8);
    box(x, 0, z, x + 4, h, z + 4);
  }
}

const CANDLES = [
  [[7, 7, 6]],
  [[5, 7, 6], [9, 6, 5]],
  [[7, 8, 6], [5, 5, 5], [9, 5, 3]],
  [[5, 5, 6], [9, 5, 5], [5, 9, 5], [9, 9, 3]],
];
function candles() {
  const m = M.meta;
  const l = texUp();
  const wick = m & 4 ? layerOr(`${blockNameOf()}_lit`, l) : l;
  for (const [x, z, h] of CANDLES[m & 3]) {
    setFL(l);
    T.uvMask = 0;
    sideUv(7, 8, 9, 8 + h);
    uvRect(2, 7, 8, 9, 10);
    uvRect(3, 7, 12, 9, 14);
    box(x, 0, z, x + 2, h, z + 2);
    T.uvMask = 0;
    const ao = T.ao;
    T.ao = false;
    plus(x + 1, z + 1, 0.5, h, h + 1, wick, rect(8, 7, 9, 8));
    T.ao = ao;
  }
}
const blockNameOf = () => BLOCKS[M.id].name;

function banner(wall: boolean) {
  const cloth = texUp();
  const pole = layerOf("oak_planks");
  plain();
  T.shade = true;
  if (wall) {
    T.rot = ((M.meta & 3) - 2) & 3;
    setFL(pole);
    box(1, 13, 14.5, 15, 14.5, 16);
    setFL(cloth);
    box(1, -12, 13.75, 15, 13, 14.5);
    return;
  }
  tiltA(2, -M.meta * 22.5);
  setFL(pole);
  sideUv(7, 0, 9, 16);
  box(7.25, 0, 7.25, 8.75, 28, 8.75);
  T.uvMask = 0;
  box(1, 26.5, 7.25, 15, 28, 8.75);
  setFL(cloth);
  box(1, 1.5, 8.75, 15, 26.5, 9.5);
}

function brewing() {
  const l = texUp();
  const base = texF(3);
  setFL(base);
  box(9, 0, 5, 15, 2, 11);
  box(2, 0, 1, 8, 2, 7);
  box(2, 0, 9, 8, 2, 15);
  setFL(l);
  sideUv(7, 2, 9, 16);
  uvRect(2, 7, 7, 9, 9);
  box(7, 0, 7, 9, 14, 9);
  T.uvMask = 0;
  plain();
  T.double = true;
  planeZ(8, 0, 16, 0, 16, l);
  planeX(8, 0, 16, 0, 16, l);
}

function bell() {
  const post = layerOr("stone", texF(0));
  const bar = layerOr("dark_oak_planks", texF(0));
  T.rot = M.meta & 3;
  setFL(post);
  box(2, 0, 6, 4, 16, 10);
  box(12, 0, 6, 14, 16, 10);
  setFL(bar);
  box(4, 13, 7, 12, 15, 9, 63 & ~E & ~W);
  setFLBlock(M.id, 0, TEX);
  box(5, 6, 5, 11, 13, 11, 63 & ~D);
  sideUv(0, 12, 16, 14);
  box(4, 4, 4, 12, 6, 12);
}

function grindstone() {
  T.rot = ((M.meta & 3) - 2) & 3;
  setFL(layerOr("dark_oak_log", texF(0)));
  box(12, 0, 6, 14, 7, 10);
  box(2, 0, 6, 4, 7, 10);
  setFL(texF(5));
  box(12, 7, 5, 14, 13, 11);
  box(2, 7, 5, 4, 13, 11);
  const round = texUp();
  setFL(round);
  FL[0] = FL[1] = texF(0);
  uvRect(0, 0, 0, 16, 16);
  uvRect(1, 0, 0, 16, 16);
  box(4, 4, 2, 12, 16, 14);
}

function stonecutter() {
  setFLBlock(M.id, 0, TEX);
  const saw = layerOr("stonecutter_saw", FL[5]);
  FL[4] = FL[5] = FL[0];
  box(0, 0, 0, 16, 9, 16);
  T.rot = ((M.meta & 3) - 2) & 3;
  plain();
  T.double = true;
  planeZ(8, 1, 15, 9, 16, saw, rect(1, 7, 15, 14));
}

function pot() {
  if (M.meta & 4) return;
  setFLBlock(M.id, 0, TEX);
  const side = FL[0], base = FL[2];
  box(1, 0, 1, 15, 16, 15, 63 & ~U);
  setFL(side);
  box(5, 16, 5, 11, 17, 11, 63 & ~U & ~D);
  sideUv(0, 0, 16, 3);
  FL[2] = base;
  uvRect(2, 0, 0, 16, 16);
  box(4, 17, 4, 12, 20, 12, 63 & ~D);
  T.uvMask = 0;
  T.ao = false;
  FL[2] = base;
  box(1, 15.99, 1, 15, 16, 15, U);
}

const TURTLE = [[5, 4, 4, 7], [1, 7, 4, 5], [5, 9, 4, 6], [10, 3, 3, 4]];
function turtleEggs() {
  setFL(texUp());
  const n = (M.meta & 3) + 1;
  for (let i = 0; i < n; i++) {
    const [x, z, s, h] = TURTLE[i];
    T.uvMask = 0;
    sideUv(4, 5, 12, 14);
    uvRect(2, 5, 5, 11, 11);
    uvRect(3, 5, 5, 11, 11);
    box(x, 0, z, x + s, h, z + s);
  }
}

function head(wall: boolean) {
  const l = texUp();
  const kind = HEAD[M.id];
  setFL(l);
  if (wall) T.rot = M.meta & 3;
  else tiltA(2, -M.meta * 22.5);
  const y0 = wall ? 4 : 0;
  const zb = wall ? 0 : 4;
  for (const f of [0, 1, 2, 5]) uvRect(f, 0, 0, 16, 3);
  uvRect(3, 0, 13, 16, 16);
  uvRect(4, 0, 0, 16, 16);
  if (kind === 2) {
    box(2, wall ? 2 : 0, wall ? 0 : 2, 14, (wall ? 2 : 0) + 10, wall ? 12 : 14);
    T.uvMask = 0;
    for (const f of [0, 1, 2, 3, 5]) uvRect(f, 0, 0, 16, 3);
    uvRect(4, 4, 10, 12, 14);
    const s0 = wall ? 12 : 14;
    box(5, wall ? 2 : 0, s0, 11, (wall ? 2 : 0) + 4, s0 + 4);
    return;
  }
  const x0 = kind === 1 ? 3 : 4, x1 = kind === 1 ? 13 : 12;
  box(x0, y0, zb, x1, y0 + 8, zb + 8);
  if (kind !== 1) return;
  T.uvMask = 0;
  for (const f of [0, 1, 2, 3, 5]) uvRect(f, 6, 9, 10, 10);
  uvRect(4, 5, 8, 11, 11);
  box(6, y0, zb + 8, 10, y0 + 3, zb + 9);
}

function pistonHead() {
  const front = texF(5);
  const side = texF(0);
  facing6(M.meta);
  setFL(side);
  FL[2] = FL[3] = front;
  sideUv(0, 0, 16, 4);
  box(0, 12, 0, 16, 16, 16);
  T.uvMask = 0;
  setFL(side);
  sideUv(6, 4, 10, 16);
  box(6, -4, 6, 10, 12, 10, 63 & ~U & ~D);
}

function hook() {
  const l = texUp();
  T.rot = ((M.meta & 3) - 2) & 3;
  T.ao = false;
  setFL(l);
  sideUv(6, 8, 10, 16);
  uvRect(2, 6, 8, 10, 10);
  uvRect(3, 6, 14, 10, 16);
  box(6, 1, 14, 10, 9, 16, 63 & ~S);
  T.uvMask = 0;
  sideUv(7, 3, 9, 8);
  uvRect(2, 7, 3, 9, 8);
  uvRect(3, 7, 3, 9, 8);
  box(7.5, 5, 9, 8.5, 6, 14);
  T.uvMask = 0;
  sideUv(6, 1, 10, 3);
  uvRect(2, 6, 1, 10, 3);
  uvRect(3, 6, 1, 10, 3);
  box(6.5, 4, 6, 9.5, 7, 9);
}

const isWire = (s: number) => CK[s & 0xfff] === C.Tripwire || CK[s & 0xfff] === C.Hook;
const LINK = new Uint8Array(4);
function tripwire() {
  plain();
  T.double = true;
  const l = texUp();
  let n = 0;
  for (let h = 0; h < 4; h++) {
    LINK[h] = isWire(nbH(h)) ? 1 : 0;
    n += LINK[h];
  }
  if (n === 0) LINK[0] = LINK[2] = 1;
  else if (n === 1) for (let h = 0; h < 4; h++) if (LINK[h]) { LINK[(h + 2) & 3] = 1; break; }
  const uv = [0, 7, 8, 7, 8, 8, 0, 8];
  for (let h = 0; h < 4; h++) {
    if (!LINK[h]) continue;
    T.rot = (h - 2) & 3;
    planeY(1.5, 7.75, 0, 8.25, 8, l, uv);
  }
}

function sensor() {
  setFLBlock(M.id, 0, TEX);
  box(0, 0, 0, 16, 8, 16);
  plain();
  const active = (M.meta & 4) !== 0;
  cross(layerOr(active ? "sculk_sensor_tendril_active" : "sculk_sensor_tendril_inactive", FL[2]), 0.8, 15.2, 8, 16);
  if (BLOCKS[M.id].name === "calibrated_sculk_sensor") cross(layerOr("calibrated_sculk_sensor_amethyst", FL[2]), 4, 12, 8, 16);
}

function shrieker() {
  setFLBlock(M.id, 0, TEX);
  box(0, 0, 0, 16, 8, 16);
  FL[2] = layerOr("sculk_shrieker_inner_top", FL[2]);
  sideUv(1, 1, 15, 8);
  box(1, 8, 1, 15, 15, 15, 63 & ~D);
}

function endPortal() {
  const l = texUp();
  T.ao = false;
  T.shade = false;
  T.cull = false;
  T.minBlock = 15;
  planeY(12, 0, 0, 16, 16, l);
  PX4.set([16, 6, 0, 16, 6, 16, 0, 6, 16, 0, 6, 0]);
  quad(PX4, FULL_UV, l);
}

const EGG = [
  [6, 15, 6, 10, 16, 10], [5, 14, 5, 11, 15, 11], [4, 13, 4, 12, 14, 12], [3, 11, 3, 13, 13, 13],
  [2, 8, 2, 14, 11, 14], [1, 3, 1, 15, 8, 15], [2, 1, 2, 14, 3, 14], [3, 0, 3, 13, 1, 13],
];
function dragonEgg() {
  setFL(texUp());
  T.uvLock = true;
  for (const b of EGG) box(b[0], b[1], b[2], b[3], b[4], b[5]);
}

const FIRE_T = Math.tan(Math.PI / 8);
function fire() {
  plain();
  T.double = true;
  const l = texUp();
  const below = M.blocks[M.pi - PY] & 0xfff;
  const soul = BLOCKS[M.id].name === "soul_fire";
  let sides = 0;
  if (!soul && !AOCC[below] && !FLAM[below]) {
    for (let h = 0; h < 4; h++) if (FLAM[nbH(h) & 0xfff]) sides |= 1 << h;
    if (FLAM[M.blocks[M.pi + PY] & 0xfff]) sides |= 16;
  }
  if (!sides) {
    const H = 22.4;
    const lo = (8 + 8 * FIRE_T), hi = 8 - (H - 8) * FIRE_T;
    const lo2 = 16 - lo, hi2 = 16 - hi;
    PX4.set([0, H, hi + 0.8, 0, 0, lo + 0.8, 16, 0, lo + 0.8, 16, H, hi + 0.8]);
    quad(PX4, FULL_UV, l);
    PX4.set([0, H, hi2 - 0.8, 0, 0, lo2 - 0.8, 16, 0, lo2 - 0.8, 16, H, hi2 - 0.8]);
    quad(PX4, FULL_UV, l);
    PX4.set([hi + 0.8, H, 16, lo + 0.8, 0, 16, lo + 0.8, 0, 0, hi + 0.8, H, 0]);
    quad(PX4, FULL_UV, l);
    PX4.set([hi2 - 0.8, H, 16, lo2 - 0.8, 0, 16, lo2 - 0.8, 0, 0, hi2 - 0.8, H, 0]);
    quad(PX4, FULL_UV, l);
    return;
  }
  for (let h = 0; h < 4; h++) {
    if (!(sides & (1 << h))) continue;
    T.rot = (h - 2) & 3;
    planeZ(0.01, 0, 16, 0, 22.4, l);
  }
  T.rot = 0;
  if (sides & 16) {
    PX4.set([0, 16, 0, 0, 10, 16, 16, 10, 16, 16, 16, 0]);
    quad(PX4, FULL_UV, l);
    PX4.set([16, 16, 16, 16, 10, 0, 0, 10, 0, 0, 16, 16]);
    quad(PX4, FULL_UV, l);
  }
}

export function meshShapeC(shape: number): boolean {
  if (shape !== SH.custom && shape !== SH.cross) return false;
  const k = CK[M.id];
  if (k === C.None) return shape === SH.custom;
  switch (k) {
    case C.Hanging: hangingSign(false); break;
    case C.WallHanging: hangingSign(true); break;
    case C.Dripleaf: dripleaf(); break;
    case C.Cocoa: cocoa(); break;
    case C.Pickle: pickles(); break;
    case C.Shrieker: shrieker(); break;
    case C.Candle: candles(); break;
    case C.Banner: banner(false); break;
    case C.WallBanner: banner(true); break;
    case C.Brewing: brewing(); break;
    case C.Conduit:
      setFL(texUp());
      for (let f = 0; f < 6; f++) uvRect(f, 0, 0, 16, 16);
      box(5, 5, 5, 11, 11, 11);
      break;
    case C.Bell: bell(); break;
    case C.Grindstone: grindstone(); break;
    case C.Stonecutter: stonecutter(); break;
    case C.HeavyCore:
      setFL(texUp());
      for (let f = 0; f < 6; f++) uvRect(f, 0, 0, 16, 16);
      box(4, 0, 4, 12, 8, 12);
      break;
    case C.Pot: pot(); break;
    case C.SnifferEgg:
      setFLBlock(M.id, 0, TEX);
      box(1, 0, 2, 15, 16, 14);
      break;
    case C.TurtleEgg: turtleEggs(); break;
    case C.Skull: head(false); break;
    case C.WallSkull: head(true); break;
    case C.PistonHead: pistonHead(); break;
    case C.Moving: break;
    case C.Daylight:
      setFLBlock(M.id, 0, TEX);
      box(0, 0, 0, 16, 6, 16);
      break;
    case C.Hook: hook(); break;
    case C.Tripwire: tripwire(); break;
    case C.Sensor: sensor(); break;
    case C.EndPortal: endPortal(); break;
    case C.Gateway:
      setFL(texUp());
      T.cullSame = true;
      T.minBlock = 15;
      box(0, 0, 0, 16, 16, 16);
      break;
    case C.DragonEgg: dragonEgg(); break;
    case C.Fire: fire(); break;
  }
  return true;
}

export const hasCustomMesh = (id: number) => CK[id] !== C.None && CK[id] !== C.Moving;
export function meshCustom() {
  meshShapeC(SH.custom);
}
