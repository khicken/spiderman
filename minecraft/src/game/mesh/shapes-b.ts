import { box, cross, FL, planeY, planeZ, quad, setFL, setFLBlock, T, tiltA, tiltB, uvRect } from "./box";
import { F2H, HDX, HDZ, M, OFF, PY, PZ } from "./ctx";
import { FLAG_LAVA, FLAG_STILL } from "./fluid";
import { torch } from "./shapes-a";
import { C, CK, meshCustom } from "./shapes-c";
import { blockName, blockTex, FULL, idOfName, K, KIND, layerOf, layerOr, REDSTONE_LINK, SH, SHAPE, TEX } from "./tables";
import { waterAt } from "./tint";

const E = 1, W = 2, U = 4, D = 8, S = 16, N = 32;
const SIDES = [0, 1, 4, 5];
const BAMBOO = idOfName("bamboo");
const BIG = [BigInt(116129781), BigInt(42317861), BigInt(11), BigInt(16)];

const rect = (u0: number, v0: number, u1: number, v1: number) => [u0, v0, u0, v1, u1, v1, u1, v0];
const texUp = () => TEX[(M.id * 16 + M.meta) * 6 + 2];
const sideState = (h: number) => M.blocks[M.pi + HDX[h] + HDZ[h] * PZ];

// Vanilla random XZ (and Y) offset for grass and flowers, from Mth.getSeed(x, 0, z).
function plantOffset() {
  let l = BigInt(Math.imul(M.wx, 3129871)) ^ (BigInt(M.wz) * BIG[0]);
  l = BigInt.asIntN(64, l * l * BIG[1] + l * BIG[2]) >> BIG[3];
  const lo = Number(BigInt.asUintN(16, l));
  const clamp = (v: number) => (v < -0.25 ? -0.25 : v > 0.25 ? 0.25 : v);
  T.ox = clamp(((lo & 15) / 15 - 0.5) * 0.5) * 16;
  T.oz = clamp((((lo >> 8) & 15) / 15 - 0.5) * 0.5) * 16;
  if (KIND[M.id] & K.OffsetY) T.oy = (((lo >> 4) & 15) / 15 - 1) * 0.2 * 16;
}

function plain() {
  T.ao = false;
  T.shade = false;
  T.cull = false;
}

function crossShape() {
  if (CK[M.id] === C.Fire) {
    meshCustom();
    return;
  }
  plain();
  if (KIND[M.id] & K.OffsetXZ) plantOffset();
  if (M.id === BAMBOO) {
    T.shade = true;
    setFL(texUp());
    for (const f of SIDES) uvRect(f, 0, 0, 3, 16);
    uvRect(2, 13, 0, 16, 3);
    box(6.5, 0, 6.5, 9.5, 16, 9.5);
    return;
  }
  cross(texUp());
}

const PX4 = new Float32Array(12);
function cropShape() {
  plain();
  T.double = true;
  const l = texUp();
  const uv = rect(0, 0, 16, 16);
  for (const x of [4, 12]) {
    PX4.set([x, 15, 0, x, -1, 0, x, -1, 16, x, 15, 16]);
    quad(PX4, uv, l);
  }
  planeZ(4, 0, 16, -1, 15, l, uv);
  planeZ(12, 0, 16, -1, 15, l, uv);
}

function rail() {
  plain();
  T.double = true;
  const name = blockName(M.id);
  const key = blockTex(M.id).all ?? name;
  const plainRail = name === "rail";
  const shape = plainRail ? M.meta : M.meta & 7;
  let l = layerOf(key);
  if (!plainRail && M.meta & 8) l = layerOr(`${key}_on`, l);
  if (shape <= 1) {
    T.rot = shape;
    planeY(1, 0, 0, 16, 16, l);
  } else if (shape <= 5) {
    T.rot = ([3, 1, 2, 0][shape - 2] - 2) & 3;
    PX4.set([0, 17, 0, 0, 1, 16, 16, 1, 16, 16, 17, 0]);
    quad(PX4, rect(0, 0, 16, 16), l);
  } else {
    T.rot = (shape - 6) & 3;
    planeY(1, 0, 0, 16, 16, layerOr(`${key}_corner`, l));
  }
}

function wireLink(h: number): number {
  const p = M.pi + HDX[h] + HDZ[h] * PZ;
  const s = M.blocks[p];
  const id = s & 0xfff;
  const sh = SHAPE[id];
  if (REDSTONE_LINK[id] || sh === SH.redstone_wire) return 1;
  if (sh === SH.repeater) return ((s >>> 12) & 1) === (h & 1) ? 1 : 0;
  if (sh === SH.comparator) return 1;
  if (!FULL[M.blocks[M.pi + PY] & 0xfff] && SHAPE[M.blocks[p + PY] & 0xfff] === SH.redstone_wire) return FULL[id] ? 2 : 1;
  if (!FULL[id] && SHAPE[M.blocks[p - PY] & 0xfff] === SH.redstone_wire) return 1;
  return 0;
}

const LINK = new Uint8Array(4);
function wire() {
  plain();
  const t = blockTex(M.id);
  const dot = layerOf(t.all ?? "redstone_dust_dot");
  const line = layerOf(t.side ?? "redstone_dust_line0");
  let count = 0;
  for (let h = 0; h < 4; h++) {
    LINK[h] = wireLink(h);
    if (LINK[h]) count++;
  }
  if (count === 0) LINK.fill(1);
  else if (count === 1) for (let h = 0; h < 4; h++) if (LINK[h] && !LINK[(h + 2) & 3]) { LINK[(h + 2) & 3] = 1; break; }
  const ns = LINK[0] && LINK[2] && !LINK[1] && !LINK[3];
  const ew = LINK[1] && LINK[3] && !LINK[0] && !LINK[2];
  if (ns || ew) {
    T.rot = ew ? 1 : 0;
    planeY(0.25, 0, 0, 16, 16, line);
  } else {
    planeY(0.25, 0, 0, 16, 16, dot);
    const half = rect(0, 0, 16, 8);
    for (let h = 0; h < 4; h++) {
      if (!LINK[h]) continue;
      T.rot = (h - 2) & 3;
      planeY(0.26, 0, 0, 16, 8, line, half);
    }
  }
  for (let h = 0; h < 4; h++) {
    if (LINK[h] !== 2) continue;
    T.rot = (h - 2) & 3;
    planeZ(0.25, 0, 16, 0, 16, line);
  }
}

function miniTorch(x: number, z: number, h: number, lit: boolean) {
  setFL(layerOr(lit ? "redstone_torch" : "redstone_torch_off", FL[2]));
  T.ao = false;
  T.uvMask = 0;
  for (const f of SIDES) uvRect(f, 7, 6, 9, 6 + h);
  uvRect(2, 7, 6, 9, 8);
  box(x, 2, z, x + 2, 2 + h, z + 2, 63 & ~D);
}

function diode(comparator: boolean) {
  const m = M.meta;
  T.rot = m & 3;
  setFLBlock(M.id, 0, TEX);
  FL[3] = FL[0];
  box(0, 0, 0, 16, 2, 16);
  const lit = (KIND[M.id] & K.Lit) !== 0;
  if (!comparator) {
    miniTorch(7, 2, 5, lit);
    miniTorch(7, 6 + 2 * ((m >> 2) & 3), 5, lit);
  } else {
    miniTorch(4, 11, 5, lit);
    miniTorch(10, 11, 5, lit);
    const sub = (m & 4) !== 0;
    miniTorch(7, 2, sub ? 3 : 2, sub);
  }
}

// Attach face points away from the support. 6 and 7 are floor and ceiling turned along x.
function attach(f: number) {
  if (f === 6) T.rot = 1;
  else if (f === 7) {
    tiltB(1, 180);
    T.rot = 1;
  } else if (f === 3) tiltB(1, 180);
  else if (f !== 2) {
    tiltB(1, -90);
    T.rot = (F2H[f] - 2) & 3;
  }
}

function button() {
  const m = M.meta;
  setFLBlock(M.id, 0, TEX);
  attach(m & 7);
  box(5, 0, 6, 11, m & 8 ? 1 : 2, 10);
}

function lever() {
  const m = M.meta;
  const t = blockTex(M.id);
  attach(m & 7);
  setFL(layerOf(t.side ?? "cobblestone"));
  box(5, 0, 4, 11, 3, 12);
  setFL(layerOf(t.all ?? "lever"));
  T.ao = false;
  for (const f of SIDES) uvRect(f, 7, 6, 9, 16);
  uvRect(2, 7, 6, 9, 8);
  tiltA(1, m & 8 ? -45 : 45, 8, 1, 8);
  box(7, 1, 7, 9, 11, 9, 63 & ~D);
}

function sign() {
  setFLBlock(M.id, 0, TEX);
  if (blockName(M.id).includes("wall_")) {
    T.rot = ((M.meta & 3) - 2) & 3;
    box(0, 4.5, 14.25, 16, 12.5, 16);
    return;
  }
  tiltA(2, -M.meta * 22.5);
  box(0, 8, 7.25, 16, 16, 8.75);
  box(7.25, 0, 7.25, 8.75, 8, 8.75, 63 & ~U);
}

function chainPlanes(l: number, y0: number, y1: number, uvA: number[], uvB: number[]) {
  const dbl = T.double;
  T.double = true;
  planeZ(8, 6.5, 9.5, y0, y1, l, uvA);
  PX4.set([8, y1, 6.5, 8, y0, 6.5, 8, y0, 9.5, 8, y1, 9.5]);
  quad(PX4, uvB, l);
  T.double = dbl;
}

// UVs follow the painted sprite layout in textures/utility.ts (body 5..11 x 4..12, cap 6..10 x 2..4, handle 7..9 x 0..2).
function lantern() {
  const hang = M.meta & 1 ? 1 : 0;
  const l = texUp();
  setFL(l);
  T.ao = false;
  for (const f of SIDES) uvRect(f, 5, 4, 11, 12);
  uvRect(2, 5, 4, 11, 5);
  uvRect(3, 5, 11, 11, 12);
  box(5, hang, 5, 11, 7 + hang, 11);
  T.uvMask = 0;
  for (const f of SIDES) uvRect(f, 6, 2, 10, 4);
  uvRect(2, 6, 2, 10, 3);
  box(6, 7 + hang, 6, 10, 9 + hang, 10, 63 & ~D);
  T.uvMask = 0;
  tiltA(2, 45);
  chainPlanes(l, 9 + hang, 11 + hang, rect(7, 0, 9, 2), rect(7, 0, 9, 2));
  if (hang) chainPlanes(layerOr("chain", l), 12, 16, rect(6, 0, 9, 4), rect(6, 0, 9, 4));
}

function facingTransform(f: number) {
  if (f === 3) tiltB(1, 180);
  else if (f !== 2) {
    tiltB(1, -90);
    T.rot = (F2H[f] - 2) & 3;
  }
}

function chain() {
  const name = blockName(M.id);
  const l = texUp();
  T.ao = false;
  if (name === "end_rod" || name === "lightning_rod") {
    setFL(l);
    facingTransform(M.meta < 6 ? M.meta : 2);
    if (name === "end_rod") {
      for (const f of SIDES) uvRect(f, 7, 2, 9, 16);
      uvRect(2, 7, 2, 9, 4);
      box(7, 1, 7, 9, 16, 9, 63 & ~D);
      T.uvMask = 0;
      for (const f of SIDES) uvRect(f, 6, 0, 10, 1);
      uvRect(2, 6, 0, 10, 2);
      uvRect(3, 6, 0, 10, 2);
      box(6, 0, 6, 10, 1, 10);
    } else {
      for (const f of SIDES) uvRect(f, 7, 4, 9, 16);
      box(7, 0, 7, 9, 12, 9, 63 & ~U);
      T.uvMask = 0;
      for (const f of SIDES) uvRect(f, 6, 0, 10, 4);
      uvRect(2, 6, 0, 10, 4);
      uvRect(3, 6, 0, 10, 4);
      box(6, 12, 6, 10, 16, 10);
    }
    return;
  }
  T.shade = false;
  tiltA(2, 45);
  if (M.meta === 1) tiltB(3, 90);
  else if (M.meta === 2) tiltB(1, 90);
  chainPlanes(l, 0, 16, rect(6, 0, 9, 16), rect(6, 0, 9, 16));
}

function anvil() {
  setFLBlock(M.id, 0, TEX);
  T.rot = M.meta & 3;
  box(2, 0, 2, 14, 4, 14);
  box(4, 4, 3, 12, 5, 13, 63 & ~U & ~D);
  box(6, 5, 4, 10, 10, 12, 63 & ~U & ~D);
  box(3, 10, 0, 13, 16, 16);
}

function basin(y0: number, y1: number, floorY: number, inner: number, floorTop: number) {
  const out = FL[0], top = FL[2], bottom = FL[3];
  const wall = (x0: number, z0: number, x1: number, z1: number, innerFace: number) => {
    FL[0] = FL[1] = FL[4] = FL[5] = out;
    FL[2] = top;
    FL[3] = bottom;
    FL[innerFace] = inner;
    box(x0, y0, z0, x1, y1, z1);
  };
  wall(0, 0, 2, 16, 0);
  wall(14, 0, 16, 16, 1);
  wall(2, 0, 14, 2, 4);
  wall(2, 14, 14, 16, 5);
  FL[2] = floorTop;
  FL[3] = bottom;
  box(2, y0, 2, 14, floorY, 14, U | D);
  FL[0] = FL[1] = FL[4] = FL[5] = out;
  FL[2] = top;
}

function contents(y: number, layer: number, buf: number, tint: number, flags: number, emit: number) {
  T.buf = buf;
  T.flags = flags;
  T.ao = false;
  T.minBlock = emit;
  const t = M.tint;
  M.tint = tint;
  planeY(y, 2, 2, 14, 14, layer);
  M.tint = t;
  T.buf = -1;
  T.flags = 0;
  T.minBlock = 0;
}

function cauldron() {
  const name = blockName(M.id);
  setFLBlock(M.id, 0, TEX);
  const m = M.meta;
  if (name === "composter") {
    basin(0, 16, 2, FL[0], FL[3]);
    if (m > 0) {
      const ready = m >= 8;
      const l = layerOr(ready ? "composter_ready" : "composter_compost", FL[2]);
      contents(ready ? 15 : 1 + 2 * Math.min(m, 7), l, -1, 0xffffff, 0, 0);
    }
    return;
  }
  const inner = layerOr("cauldron_inner", FL[0]);
  basin(3, 16, 4, inner, inner);
  for (const [x, z] of [[0, 0], [12, 0], [0, 12], [12, 12]]) {
    box(x, 0, z, x + 4, 3, z + 4, 63 & ~U);
  }
  const level = Math.min(Math.max(m, 1), 3);
  const y = [9, 12, 15][level - 1];
  if (name === "water_cauldron") contents(y, layerOf("water_still"), 2, waterAt(M.bz * 16 + M.bx), FLAG_STILL, 0);
  else if (name === "lava_cauldron") contents(15, layerOf("lava_still"), 0, 0xffffff, FLAG_STILL | FLAG_LAVA, 15);
  else if (name === "powder_snow_cauldron") contents(y, layerOf("powder_snow"), 1, 0xffffff, 0, 0);
}

function hopper() {
  setFLBlock(M.id, 0, TEX);
  const inside = FL[3];
  FL[3] = FL[0];
  basin(10, 16, 11, inside, inside);
  setFL(FL[0]);
  box(4, 4, 4, 12, 10, 12, 63 & ~U);
  const f = M.meta;
  if (f === 3 || f === 2 || f > 5) box(6, 0, 6, 10, 4, 10, 63 & ~U);
  else {
    T.rot = (F2H[f] - 2) & 3;
    box(6, 4, 0, 10, 8, 4, 63 & ~S);
  }
}

function flowerPot() {
  const t = blockTex(M.id);
  setFLBlock(M.id, 0, TEX);
  const side = FL[0], dirt = FL[2];
  T.tint = false;
  setFL(side);
  box(5, 0, 5, 6, 6, 11);
  box(10, 0, 5, 11, 6, 11);
  box(6, 0, 5, 10, 6, 6, 63 & ~E & ~W);
  box(6, 0, 10, 10, 6, 11, 63 & ~E & ~W);
  FL[2] = dirt;
  box(6, 0, 6, 10, 4, 10, U | D);
  if (!t.front) return;
  const plant = layerOf(t.front);
  T.tint = true;
  if (t.front.includes("cactus")) {
    setFL(plant);
    box(6, 4, 6, 10, 16, 10, 63 & ~D);
    return;
  }
  plain();
  cross(plant, 2.6, 13.4, 4, 16);
}

function vine() {
  plain();
  T.double = true;
  const l = texUp();
  const name = blockName(M.id);
  const fromNeighbors = name !== "vine";
  for (let h = 0; h < 4; h++) {
    const on = fromNeighbors ? FULL[sideState(h) & 0xfff] : (M.meta >> h) & 1;
    if (!on) continue;
    T.rot = (h - 2) & 3;
    planeZ(0.8, 0, 16, 0, 16, l);
  }
  T.rot = 0;
  if (FULL[M.blocks[M.pi + PY] & 0xfff]) planeY(15.2, 0, 0, 16, 16, l);
  if (fromNeighbors && FULL[M.blocks[M.pi + OFF[3]] & 0xfff]) planeY(0.8, 0, 0, 16, 16, l);
}

function portal() {
  setFLBlock(M.id, 0, TEX);
  T.ao = false;
  T.cullSame = true;
  if (M.meta === 2) box(6, 0, 0, 10, 16, 16);
  else box(0, 0, 6, 16, 16, 10);
}

function endPortalFrame() {
  setFLBlock(M.id, 0, TEX);
  const eye = layerOf(blockTex(M.id).front ?? "end_portal_frame_eye");
  FL[5] = FL[4];
  T.rot = M.meta & 3;
  box(0, 0, 0, 16, 13, 16);
  if (!(M.meta & 4)) return;
  setFL(eye);
  for (const f of SIDES) uvRect(f, 4, 0, 12, 3);
  uvRect(2, 4, 4, 12, 12);
  box(4, 13, 4, 12, 16, 12, 63 & ~D);
}

function lectern() {
  setFLBlock(M.id, 0, TEX);
  const top = FL[2], sides = FL[0], front = FL[5], bottom = FL[3];
  T.rot = ((M.meta & 3) - 2) & 3;
  setFL(layerOr("lectern_base", bottom));
  box(0, 0, 0, 16, 2, 16);
  FL[0] = FL[1] = FL[4] = sides;
  FL[5] = front;
  box(4, 2, 4, 12, 13, 12, 63 & ~U & ~D);
  setFL(sides);
  FL[2] = top;
  FL[3] = bottom;
  tiltA(1, -22.5, 8, 14, 8);
  box(0, 12, 3, 16, 16, 16);
  if (!(M.meta & 4)) return;
  setFL(layerOr("white_wool", top));
  FL[2] = layerOr("red_wool", top);
  box(3, 16, 5, 13, 17, 14, 63 & ~D);
}

function campfire() {
  const t = blockTex(M.id);
  const log = layerOf(t.side ?? "campfire_log");
  const lit = !(M.meta & 4);
  T.rot = M.meta & 3;
  setFL(log);
  box(1, 0, 0, 5, 4, 16);
  box(11, 0, 0, 15, 4, 16);
  box(0, 3, 1, 16, 7, 5);
  box(0, 3, 11, 16, 7, 15);
  setFL(lit ? layerOf(t.top ?? "campfire_log_lit") : log);
  box(5, 0, 0, 11, 1, 16, 63 & ~D);
  if (!lit) return;
  plain();
  T.minBlock = 15;
  cross(layerOf(t.front ?? "campfire_fire"));
}

export function meshShapeB(shape: number) {
  switch (shape) {
    case SH.cross: crossShape(); break;
    case SH.crop: cropShape(); break;
    case SH.rail: rail(); break;
    case SH.redstone_wire: wire(); break;
    case SH.repeater: diode(false); break;
    case SH.comparator: diode(true); break;
    case SH.button: button(); break;
    case SH.lever: lever(); break;
    case SH.pressure_plate:
      setFLBlock(M.id, 0, TEX);
      box(1, 0, 1, 15, M.meta > 0 ? 0.5 : 1, 15);
      break;
    case SH.sign: sign(); break;
    case SH.lantern: lantern(); break;
    case SH.chain: chain(); break;
    case SH.anvil: anvil(); break;
    case SH.enchanting_table:
      setFLBlock(M.id, 0, TEX);
      box(0, 0, 0, 16, 12, 16);
      break;
    case SH.cauldron: cauldron(); break;
    case SH.hopper: hopper(); break;
    case SH.flower_pot: flowerPot(); break;
    case SH.vine: vine(); break;
    case SH.portal: portal(); break;
    case SH.end_portal_frame: endPortalFrame(); break;
    case SH.lectern: lectern(); break;
    case SH.campfire: campfire(); break;
    case SH.torch: torch(-1, texUp()); break;
  }
}
