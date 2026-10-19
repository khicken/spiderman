import { blockId as I } from "../blocks/registry";
import { chest, fill, fillFn, frame, mob, put, rnd, S, spawner, stairs, type Frame } from "./build";
import { B } from "./ids";
import { createRng, idTable, type Rng, type Writer } from "./rng";
import type { Start } from "./structure-grid";

const PBB = I("polished_blackstone_bricks"), CPBB = I("cracked_polished_blackstone_bricks"), GILD = I("gilded_blackstone"), BS = B.blackstone;
const PB = I("polished_blackstone"), CPB = I("chiseled_polished_blackstone"), BWALL = I("polished_blackstone_brick_wall"), BSTAIR = I("polished_blackstone_brick_stairs");
const BSLAB = I("polished_blackstone_brick_slab"), PBASALT = I("polished_basalt"), CHAIN = I("chain"), BSWALL = I("blackstone_wall");
const DOWN_THROUGH = idTable(B.lava, B.fire, B.soul_fire, B.crimson_roots, B.warped_roots, B.nether_sprouts, B.weeping_vines, B.weeping_vines_plant, B.twisting_vines, B.twisting_vines_plant);
DOWN_THROUGH[0] = 1;

type Kind = "units" | "stables" | "treasure" | "bridge";

// Vanilla bastion_remnant start pool: housing units, hoglin stables, treasure room and bridge, equally weighted.
export function bastion(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const kind: Kind = (["units", "stables", "treasure", "bridge"] as const)[r.int(4)];
  const f = frame(w, s.x, s.y, s.z, r.int(4), s.seed);
  if (kind === "units") units(f, r);
  else if (kind === "stables") stables(f, r);
  else if (kind === "treasure") treasure(f, r);
  else bridge(f, r);
}

const brick = (f: Frame) => (x: number, y: number, z: number) => {
  const v = rnd(f, x, y, z);
  return S(v < 0.02 ? GILD : v < 0.27 ? CPBB : v < 0.42 ? BS : PBB);
};

function legs(f: Frame, a0: number, b0: number, a1: number, b1: number, step: number) {
  for (let a = a0; a <= a1; a += step) {
    for (let b = b0; b <= b1; b += step) {
      fillFn(f, a, -40, b, a + 1, -1, b + 1, (_a, _y, _b, x, wy, z) => {
        const c = f.w.get(x, wy, z);
        return c >= 0 && DOWN_THROUGH[c & 0xfff] ? S(rnd(f, x, wy, z) < 0.5 ? B.basalt : BS) : -1;
      });
    }
  }
}

function box(f: Frame, a0: number, y0: number, b0: number, a1: number, y1: number, b1: number, floors: number[]) {
  const br = brick(f);
  fillFn(f, a0, y0, b0, a1, y1, b1, (a, y, b, x, wy, z) => {
    const edge = a === a0 || a === a1 || b === b0 || b === b1;
    if (y === y0 || floors.includes(y)) return br(x, wy, z);
    if (y === y1) return edge ? ((a + b) & 1 ? S(BWALL) : -1) : -1;
    if (edge) {
      const window = y % 4 === 2 && ((a - a0) % 4 === 2 || (b - b0) % 4 === 2) && !(a === a0 && b === b0);
      return window ? S(BSWALL) : br(x, wy, z);
    }
    return 0;
  });
}

function door(f: Frame, a: number, y: number, b: number, alongA: boolean) {
  for (let k = -1; k <= 1; k++) fill(f, alongA ? a + k : a, y + 1, alongA ? b : b + k, alongA ? a + k : a, y + 3, alongA ? b : b + k, 0);
}

function ramp(f: Frame, a: number, y0: number, b: number, len: number, dir: 0 | 1 | 2 | 3) {
  const da = dir === 3 ? 1 : dir === 1 ? -1 : 0, db = dir === 0 ? 1 : dir === 2 ? -1 : 0;
  for (let k = 0; k < len; k++) {
    for (let side = -1; side <= 1; side++) {
      const pa = a + da * k + (db !== 0 ? side : 0), pb = b + db * k + (da !== 0 ? side : 0);
      put(f, pa, y0 + k, pb, stairs(f, BSTAIR, dir));
      fill(f, pa, y0 + k + 1, pb, pa, y0 + k + 3, pb, 0);
    }
  }
}

function units(f: Frame, r: Rng) {
  const br = brick(f);
  const R = 22;
  legs(f, -R, -R, R, R, 11);
  fillFn(f, -R, 0, -R, R, 14, R, (a, y, b, x, wy, z) => {
    const edge = Math.abs(a) === R || Math.abs(b) === R;
    if (y === 0) return br(x, wy, z);
    if (!edge) return 0;
    if (y === 14) return (a + b) & 1 ? S(BWALL) : -1;
    if (y <= 4 && (Math.abs(a) <= 1 || Math.abs(b) <= 1)) return 0;
    return br(x, wy, z);
  });
  for (let gi = -1; gi <= 1; gi++) {
    for (let gj = -1; gj <= 1; gj++) {
      if (gi === 0 && gj === 0) continue;
      const ca = gi * 13, cb = gj * 13, tiers = 1 + r.int(3);
      const top = tiers * 6;
      box(f, ca - 4, 1, cb - 4, ca + 4, top + 1, cb + 4, [7, 13, 19].filter((y) => y < top + 1));
      door(f, ca, 1, gj === 0 ? cb + (gi > 0 ? -4 : 4) : cb - gj * 4, gj !== 0);
      for (let t = 0; t < tiers; t++) {
        const y = 1 + t * 6;
        if (r.chance(0.5)) chest(f, ca + 3, y + 1, cb + 3, r.int(4), "bastion_other", B.chest);
        if (r.chance(0.35)) put(f, ca - 3, y + 1, cb - 3, S(B.gold_block));
        if (t > 0) ramp(f, ca - 2, y - 6 + 1, cb - 3, 5, 0);
        if (r.chance(0.6)) mob(f, ca, y + 1, cb, "piglin");
      }
    }
  }
  fill(f, -6, 1, -6, 6, 1, 6, S(PB));
  for (const [a, b] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) fill(f, a, 1, b, a, 10, b, S(PBASALT));
  fill(f, -5, 11, -5, 5, 11, 5, S(BSLAB));
  for (const [a, b] of [[-3, 0], [3, 0], [0, -3], [0, 3]]) fill(f, a, 6, b, a, 10, b, S(CHAIN));
  chest(f, 0, 2, 0, 0, "bastion_other", B.chest);
  put(f, 0, 1, 0, S(B.gold_block));
  mob(f, 2, 1, 2, "piglin");
  mob(f, -2, 1, -2, "piglin");
  mob(f, 8, 1, 0, "piglin_brute");
}

function stables(f: Frame, r: Rng) {
  const br = brick(f);
  const R = 18;
  legs(f, -R, -R, R, R, 9);
  fillFn(f, -R, 0, -R, R, 22, R, (a, y, b, x, wy, z) => {
    const edge = Math.abs(a) === R || Math.abs(b) === R;
    if (y === 0 || y === 11) return br(x, wy, z);
    if (y === 21) return edge ? br(x, wy, z) : rnd(f, x, wy, z) < 0.6 ? br(x, wy, z) : 0;
    if (y === 22) return edge && (a + b) & 1 ? S(BWALL) : -1;
    if (!edge) return 0;
    if (y <= 4 && Math.abs(a) <= 2 && b === -R) return 0;
    return br(x, wy, z);
  });
  for (const sa of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const a = sa * 10, b = -12 + k * 10;
      fillFn(f, a - 4, 1, b - 4, a + 4, 4, b + 4, (pa, _y, pb, x, wy, z) => (Math.abs(pa - a) === 4 || Math.abs(pb - b) === 4) && !(pa === a - sa * 4 && Math.abs(pb - b) <= 1) ? br(x, wy, z) : -1);
      if (r.chance(0.7)) mob(f, a, 1, b, "hoglin");
      if (r.chance(0.3)) mob(f, a + 1, 1, b + 1, "hoglin", { grow: -24000 });
    }
  }
  ramp(f, -2, 1, 6, 10, 0);
  fill(f, -2, 11, 6, 2, 11, 16, 0);
  ramp(f, 2, 12, -16, 9, 0);
  fill(f, 1, 21, -16, 3, 21, -7, 0);
  chest(f, -14, 12, -14, 0, "bastion_hoglin_stable", B.chest);
  chest(f, 14, 12, 14, 2, "bastion_hoglin_stable", B.chest);
  put(f, 14, 12, -14, S(B.gold_block));
  for (let k = 0; k < 4; k++) mob(f, -8 + k * 5, 12, 0, k === 0 ? "piglin_brute" : "piglin");
}

function treasure(f: Frame, r: Rng) {
  const br = brick(f);
  const R = 17, H = 30;
  legs(f, -R, -R, R, R, 8);
  fillFn(f, -R, -2, -R, R, H, R, (a, y, b, x, wy, z) => {
    const edge = Math.abs(a) >= R - 1 || Math.abs(b) >= R - 1;
    if (y <= -1) return br(x, wy, z);
    if (edge) {
      if (y === H) return (a + b) & 1 ? S(BWALL) : -1;
      if (y % 7 === 4 && (Math.abs(a) % 6 === 3 || Math.abs(b) % 6 === 3) && !(Math.abs(a) >= R - 1 && Math.abs(b) >= R - 1)) return S(BSWALL);
      return br(x, wy, z);
    }
    if (y <= 2) return S(B.lava);
    if (y === H - 1) return rnd(f, x, wy, z) < 0.85 ? br(x, wy, z) : 0;
    return 0;
  });
  fillFn(f, -5, 0, -5, 5, 14, 5, (a, y, b, x, wy, z) => {
    const ring = Math.max(Math.abs(a), Math.abs(b));
    if (y === 14) return ring <= 4 ? S(B.gold_block) : br(x, wy, z);
    if (y === 13) return ring === 5 ? S(BWALL) : br(x, wy, z);
    if (ring === 5) return y % 4 === 0 ? S(CPB) : br(x, wy, z);
    return rnd(f, x, wy, z) < 0.12 ? S(B.magma_block) : br(x, wy, z);
  });
  fill(f, -4, 15, -4, 4, 15, 4, 0);
  for (const [a, b] of [[-4, -4], [4, 4]]) spawner(f, a, 15, b, "magma_cube", B.spawner);
  put(f, 4, 15, -4, S(B.gold_block));
  put(f, -4, 15, 4, S(B.gold_block));
  chest(f, 0, 15, 1, 0, "bastion_treasure", B.chest);
  chest(f, 0, 15, -1, 2, "bastion_treasure", B.chest);
  for (const d of [0, 1, 2, 3]) {
    const da = d === 3 ? 1 : d === 1 ? -1 : 0, db = d === 0 ? 1 : d === 2 ? -1 : 0;
    for (let k = 6; k < R - 1; k++) for (let side = -1; side <= 1; side++) put(f, da * k + (db ? side : 0), 14, db * k + (da ? side : 0), side === 0 ? S(PB) : br(f.x + k, 14, f.z + side));
    for (let k = 6; k < R - 1; k += 3) fill(f, da * k, 15, db * k, da * k, 22, db * k, S(CHAIN));
    fill(f, da * (R - 1) + (db ? -1 : 0), 15, db * (R - 1) + (da ? -1 : 0), da * (R - 1) + (db ? 1 : 0), 17, db * (R - 1) + (da ? 1 : 0), 0);
  }
  mob(f, 2, 15, 2, "piglin_brute");
  mob(f, -2, 15, -2, "piglin_brute");
  if (r.chance(0.5)) mob(f, 2, 15, -2, "piglin_brute");
  mob(f, 10, 15, 0, "piglin");
  mob(f, -10, 15, 0, "piglin");
}

function bridge(f: Frame, r: Rng) {
  const br = brick(f);
  legs(f, -9, -44, 9, -30, 6);
  fillFn(f, -7, 0, -44, 7, 18, -32, (a, y, b, x, wy, z) => {
    const edge = Math.abs(a) === 7 || b === -44 || b === -32;
    if (y === 0 || y === 12) return br(x, wy, z);
    if (y === 18) return edge && (a + b) & 1 ? S(BWALL) : -1;
    if (!edge) return 0;
    if (y >= 13 && y <= 15 && b === -32 && Math.abs(a) <= 1) return 0;
    if (y <= 4 && b === -44 && Math.abs(a) <= 1) return 0;
    return br(x, wy, z);
  });
  ramp(f, 4, 1, -42, 11, 0);
  fillFn(f, -2, 9, -31, 2, 14, -11, (a, y, b, x, wy, z) => {
    if (y === 12) return br(x, wy, z);
    if (y === 13 && Math.abs(a) === 2) return S(BWALL);
    if (y === 11 && Math.abs(a) <= 1) return rnd(f, x, wy, z) < 0.7 ? br(x, wy, z) : -1;
    if (y === 10 && a === 0 && (b & 3) === 0) return S(CHAIN);
    return -1;
  });
  for (let b = -28; b <= -12; b += 8) legs(f, -1, b, -1, b, 1);
  legs(f, -12, -10, 12, 12, 8);
  fillFn(f, -12, 0, -10, 12, 22, 12, (a, y, b, x, wy, z) => {
    const edge = Math.abs(a) === 12 || b === -10 || b === 12;
    if (y === 0 || y === 12) return br(x, wy, z);
    if (y === 22) return edge && (a + b) & 1 ? S(BWALL) : -1;
    if (y === 21) return br(x, wy, z);
    if (!edge) return 0;
    if (y >= 13 && y <= 15 && b === -10 && Math.abs(a) <= 1) return 0;
    if (y % 5 === 3 && Math.abs(a) % 4 === 2) return S(BSWALL);
    return br(x, wy, z);
  });
  ramp(f, -9, 1, -7, 11, 0);
  fill(f, -10, 12, -7, -8, 12, 4, 0);
  fill(f, -2, 13, 3, 2, 13, 7, S(B.gold_block));
  chest(f, 0, 14, 5, 2, "bastion_bridge", B.chest);
  chest(f, 9, 13, 9, 2, "bastion_bridge", B.chest);
  chest(f, -9, 1, 9, 0, "bastion_other", B.chest);
  put(f, 9, 1, -7, S(B.gold_block));
  mob(f, 0, 13, 0, "piglin");
  mob(f, 4, 13, 8, "piglin");
  mob(f, 0, 13, -20, "piglin");
  mob(f, -4, 1, 4, r.chance(0.5) ? "piglin_brute" : "piglin");
}
