import { blockId as I } from "../blocks/registry";
import { chest, fill, fillFn, frame, mob, put, rnd, S, spawner, stairs, wx, wz, type Frame } from "./build";
import { B } from "./ids";
import { createRng, idTable, type Rng, type Writer } from "./rng";
import type { Start } from "./structure-grid";

const PBB = I("polished_blackstone_bricks"), CPBB = I("cracked_polished_blackstone_bricks"), GILD = I("gilded_blackstone"), BS = B.blackstone;
const PB = I("polished_blackstone"), CPB = I("chiseled_polished_blackstone"), BWALL = I("polished_blackstone_brick_wall"), BSTAIR = I("polished_blackstone_brick_stairs");
const BSLAB = I("polished_blackstone_brick_slab"), PBASALT = I("polished_basalt"), CHAIN = I("chain"), BSWALL = I("blackstone_wall");
const DOWN_THROUGH = idTable(B.lava, B.fire, B.soul_fire, B.crimson_roots, B.warped_roots, B.nether_sprouts, B.weeping_vines, B.weeping_vines_plant, B.twisting_vines, B.twisting_vines_plant);
DOWN_THROUGH[0] = 1;

type Kind = "units" | "stables" | "treasure" | "bridge";
type Pal = (x: number, y: number, z: number) => number;

export const bastionKind = (s: Start): Kind => (["units", "stables", "treasure", "bridge"] as const)[createRng(s.seed).int(4)];

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

// Degradation processors: about a third of the bricks crack, blackstone fills gaps, a little turns gilded.
const pal = (f: Frame, crack = 0.3, bs = 0.12, gild = 0.01): Pal => (x, y, z) => {
  const v = rnd(f, x, y, z);
  return S(v < gild ? GILD : v < gild + bs ? BS : v < gild + bs + crack ? CPBB : PBB);
};

function legs(f: Frame, a0: number, b0: number, a1: number, b1: number, step: number) {
  for (let a = a0; a <= a1; a += step) {
    for (let b = b0; b <= b1; b += step) {
      fillFn(f, a, -40, b, Math.min(a + 1, a1), -1, Math.min(b + 1, b1), (_a, _y, _b, x, wy, z) => {
        const c = f.w.get(x, wy, z);
        return c >= 0 && DOWN_THROUGH[c & 0xfff] ? S(rnd(f, x, wy, z) < 0.5 ? B.basalt : BS) : -1;
      });
    }
  }
}

function walls(f: Frame, a0: number, b0: number, a1: number, b1: number, y0: number, y1: number, p: Pal, t = 1) {
  fillFn(f, a0, y0, b0, a1, y1, b1, (a, _y, b, x, wy, z) => (a < a0 + t || a > a1 - t || b < b0 + t || b > b1 - t ? p(x, wy, z) : -1));
}

function cren(f: Frame, a0: number, b0: number, a1: number, b1: number, y: number) {
  fillFn(f, a0, y, b0, a1, y, b1, (a, _y, b, x, wy, z) => {
    if (a !== a0 && a !== a1 && b !== b0 && b !== b1) return -1;
    const corner = (a === a0 || a === a1) && (b === b0 || b === b1);
    return corner || (a + b) % 3 !== 0 ? S(rnd(f, x, wy, z) < 0.15 ? BSWALL : BWALL) : -1;
  });
}

function floor(f: Frame, a0: number, y: number, b0: number, a1: number, b1: number, p: Pal) {
  fillFn(f, a0, y, b0, a1, y, b1, (_a, _y, _b, x, wy, z) => p(x, wy, z));
}

function pillar(f: Frame, a: number, b: number, y0: number, y1: number) {
  fill(f, a, y0, b, a, y1, b, S(PBASALT));
}

function windows(f: Frame, a0: number, b0: number, a1: number, b1: number, y: number, step: number) {
  fillFn(f, a0, y, b0, a1, y + 1, b1, (a, _y, b) => {
    const onA = a === a0 || a === a1, onB = b === b0 || b === b1;
    if (onA === onB) return -1;
    const k = onA ? b - b0 : a - a0;
    return k % step === step >> 1 ? S(BSWALL) : -1;
  });
}

function ramp(f: Frame, a: number, y0: number, b: number, len: number, dir: 0 | 1 | 2 | 3, under?: Pal) {
  const da = dir === 3 ? 1 : dir === 1 ? -1 : 0, db = dir === 0 ? 1 : dir === 2 ? -1 : 0;
  for (let k = 0; k < len; k++) {
    for (let side = -1; side <= 1; side++) {
      const pa = a + da * k + (db !== 0 ? side : 0), pb = b + db * k + (da !== 0 ? side : 0);
      if (under) fillFn(f, pa, y0, pb, pa, y0 + k - 1, pb, (_a, _y, _b, x, wy, z) => under(x, wy, z));
      put(f, pa, y0 + k, pb, stairs(f, BSTAIR, dir));
      fill(f, pa, y0 + k + 1, pb, pa, y0 + k + 3, pb, 0);
    }
  }
}

function piglins(f: Frame, r: Rng, spots: [number, number, number][], brute = 0.2) {
  for (const [a, y, b] of spots) mob(f, a, y, b, r.chance(brute) ? "piglin_brute" : "piglin");
}

// Housing units: four two-story units around a cross-shaped courtyard inside a rampart wall.
function units(f: Frame, r: Rng) {
  const wall = pal(f), base = pal(f, 0.2, 0.45, 0.005), R = 23;
  legs(f, -R, -R, R, R, 7);
  fill(f, -R, 1, -R, R, 20, R, 0);
  fillFn(f, -R, 0, -R, R, 0, R, (a, _y, b, x, wy, z) => (Math.abs(a) <= 6 || Math.abs(b) <= 6 ? S(rnd(f, x, wy, z) < 0.2 ? CPBB : PB) : base(x, wy, z)));
  walls(f, -R, -R, R, R, 1, 16, wall, 2);
  floor(f, -R, 16, -R, R, -R + 3, wall);
  floor(f, -R, 16, R - 3, R, R, wall);
  floor(f, -R, 16, -R, -R + 3, R, wall);
  floor(f, R - 3, 16, -R, R, R, wall);
  cren(f, -R, -R, R, R, 17);
  for (const k of [-R + 2, -8, 8, R - 2]) for (const s of [-R + 1, R - 1]) {
    pillar(f, k, s, 1, 15);
    pillar(f, s, k, 1, 15);
  }
  windows(f, -R, -R, R, R, 9, 6);
  for (const d of [0, 1, 2, 3] as const) gate(f, d, R);
  for (let gi = -1; gi <= 1; gi += 2) {
    for (let gj = -1; gj <= 1; gj += 2) unit(f, r, gi * 13, gj * 13, gi, gj, wall);
  }
  for (const s of [-13, 13]) {
    fillFn(f, -6, 12, s - 1, 6, 13, s + 1, (_a, y, b, x, wy, z) => (y === 12 ? wall(x, wy, z) : Math.abs(b - s) === 1 && rnd(f, x, wy, z) > 0.25 ? S(BWALL) : -1));
    fillFn(f, s - 1, 12, -6, s + 1, 13, 6, (a, y, _b, x, wy, z) => (y === 12 ? wall(x, wy, z) : Math.abs(a - s) === 1 && rnd(f, x, wy, z) > 0.25 ? S(BWALL) : -1));
  }
  floor(f, -3, 1, -3, 3, 3, () => S(PB));
  for (const [a, b] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) pillar(f, a, b, 2, 9);
  fillFn(f, -3, 10, -3, 3, 10, 3, (a, _y, b, x, wy, z) => (Math.abs(a) === 3 || Math.abs(b) === 3 ? S(BSLAB) : rnd(f, x, wy, z) < 0.4 ? S(BSLAB) : -1));
  for (const [a, b] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) fill(f, a, 7, b, a, 9, b, S(CHAIN));
  put(f, 0, 2, 0, S(B.gold_block));
  chest(f, 0, 2, 1, 0, "bastion_other", B.chest);
  piglins(f, r, [[4, 1, 4], [-4, 1, -4], [0, 1, -10], [10, 1, 0], [0, 17, -R + 2]], 0.25);
}

function gate(f: Frame, d: 0 | 1 | 2 | 3, R: number) {
  const s = d < 2 ? 1 : -1, alongA = d === 0 || d === 2;
  for (let k = -1; k <= 1; k++) for (let t = 0; t <= 1; t++) {
    const a = alongA ? k : s * (R - t), b = alongA ? s * (R - t) : k;
    fill(f, a, 1, b, a, 4, b, 0);
  }
  if (alongA) put(f, 0, 5, s * R, S(CPB));
  else put(f, s * R, 5, 0, S(CPB));
}

function unit(f: Frame, r: Rng, ca: number, cb: number, gi: number, gj: number, wall: Pal) {
  const a0 = ca - 6, a1 = ca + 6, b0 = cb - 6, b1 = cb + 6;
  walls(f, a0, b0, a1, b1, 1, 12, wall);
  floor(f, a0, 6, b0, a1, b1, wall);
  floor(f, a0, 12, b0, a1, b1, wall);
  cren(f, a0, b0, a1, b1, 13);
  for (const [a, b] of [[a0, b0], [a1, b0], [a0, b1], [a1, b1]]) pillar(f, a, b, 1, 12);
  windows(f, a0, b0, a1, b1, 3, 4);
  windows(f, a0, b0, a1, b1, 8, 4);
  const da = gi > 0 ? a0 : a1, db = gj > 0 ? b0 : b1;
  for (const y of [1, 7]) {
    fill(f, da, y, cb - 1, da, y + 2, cb + 1, 0);
    fill(f, ca - 1, y, db, ca + 1, y + 2, db, 0);
  }
  fill(f, ca - 1, 12, cb - 1, ca + 1, 12, cb + 1, 0);
  const ra = ca - gi * 4;
  fill(f, ra - 1, 6, cb - 4, ra + 1, 6, cb + 2, 0);
  ramp(f, ra, 1, cb - 4, 5, 0, wall);
  fill(f, ca + gi * 4 - 1, 12, cb - 2, ca + gi * 4 + 1, 12, cb + 4, 0);
  ramp(f, ca + gi * 4, 7, cb + 4, 5, 2, wall);
  for (const y of [1, 7]) {
    const ka = ca + gi * 5, kb = cb + gj * 5;
    chest(f, ka, y, kb, gj > 0 ? 2 : 0, "bastion_other", B.chest);
    if (r.chance(0.5)) put(f, ka - gi, y, kb, S(B.gold_block));
    mob(f, ca, y, cb + gj * 2, r.chance(0.15) ? "piglin_brute" : "piglin");
  }
  if (r.chance(0.5)) mob(f, ca + gi * 2, 13, cb, "piglin");
}

// Hoglin stables: stalls along both long walls, a ramp to the back gallery and a second ramp to the roof walk.
function stables(f: Frame, r: Rng) {
  const wall = pal(f, 0.32, 0.18, 0.008), A = 19, Bz = 17;
  legs(f, -A, -Bz, A, Bz, 6);
  fill(f, -A, 1, -Bz, A, 24, Bz, 0);
  fillFn(f, -A, 0, -Bz, A, 0, Bz, (_a, _y, _b, x, wy, z) => {
    const v = rnd(f, x, wy, z);
    return S(v < 0.04 ? B.magma_block : v < 0.45 ? BS : v < 0.6 ? CPBB : PBB);
  });
  walls(f, -A, -Bz, A, Bz, 1, 20, wall);
  for (let k = -Bz + 4; k <= Bz - 4; k += 8) for (const s of [-A, A]) pillar(f, s, k, 0, 21);
  for (let k = -A + 3; k <= A - 3; k += 8) for (const s of [-Bz, Bz]) pillar(f, k, s, 0, 21);
  windows(f, -A, -Bz, A, Bz, 5, 6);
  windows(f, -A, -Bz, A, Bz, 15, 6);
  fill(f, -2, 1, -Bz, 2, 5, -Bz, 0);
  put(f, 0, 6, -Bz, S(CPB));
  for (const s of [-1, 1]) {
    const inner = s * 12, outer = s * (A - 1);
    for (const p of [-16, -8, 0, 8, 16]) fillFn(f, Math.min(inner, outer), 1, p, Math.max(inner, outer), 3, p, (_a, y, _b, x, wy, z) => (y === 3 ? S(BSWALL) : wall(x, wy, z)));
    for (const c of [-12, -4, 4, 12]) {
      fillFn(f, inner, 1, c - 3, inner, 2, c + 3, (_a, y, b) => (Math.abs(b - c) <= 1 ? -1 : y === 2 ? S(BSWALL) : S(PBB)));
      const n = r.chance(0.75) ? 1 + r.int(2) : 0;
      for (let k = 0; k < n; k++) mob(f, s * (15 + k), 1, c + k - 1, "hoglin", r.chance(0.25) ? { grow: -24000 } : {});
    }
  }
  fillFn(f, -A + 1, 10, 4, A - 1, 10, Bz - 1, (_a, _y, _b, x, wy, z) => wall(x, wy, z));
  fillFn(f, -A + 1, 11, 4, A - 1, 11, 4, (a, _y, _b, x, wy, z) => (Math.abs(a) <= 1 ? -1 : rnd(f, x, wy, z) < 0.8 ? S(BWALL) : -1));
  ramp(f, 0, 1, -6, 10, 0, wall);
  fillFn(f, -2, 20, 10, A - 1, 20, Bz - 1, (_a, _y, _b, x, wy, z) => wall(x, wy, z));
  fillFn(f, -2, 21, 10, A - 1, 21, 10, (a, _y, _b, x, wy, z) => (rnd(f, x, wy, z) < 0.75 && a > -2 ? S(BWALL) : -1));
  ramp(f, -12, 11, 13, 10, 3, wall);
  fill(f, -A, 20, -Bz, A, 20, -Bz + 1, S(PBB));
  fill(f, -A, 20, -Bz, -A + 1, 20, Bz, S(PBB));
  fill(f, A - 1, 20, -Bz, A, 20, Bz, S(PBB));
  cren(f, -A, -Bz, A, Bz, 21);
  chest(f, -A + 2, 11, Bz - 2, 2, "bastion_hoglin_stable", B.chest);
  chest(f, A - 2, 21, Bz - 2, 2, "bastion_hoglin_stable", B.chest);
  if (r.chance(0.6)) chest(f, -A + 2, 1, -Bz + 2, 0, "bastion_other", B.chest);
  put(f, A - 3, 21, Bz - 2, S(B.gold_block));
  piglins(f, r, [[-8, 11, 8], [8, 11, 8], [0, 11, 13], [10, 21, 14], [0, 1, -12]], 0.25);
}

// Treasure room: lava pit, a lava-filled brick base in the middle with the gold pile and chest on top, bridges from the ramparts.
function treasure(f: Frame, r: Rng) {
  const wall = pal(f, 0.35, 0.1, 0.02), R = 19, T = 14;
  legs(f, -R, -R, R, R, 6);
  fill(f, -R, 1, -R, R, 28, R, 0);
  floor(f, -R, 0, -R, R, R, pal(f, 0.2, 0.5, 0.01));
  walls(f, -R, -R, R, R, 1, 24, wall, 2);
  fill(f, -R + 2, 1, -R + 2, R - 2, 2, R - 2, S(B.lava));
  fillFn(f, -R + 2, T, -R + 2, R - 2, T, R - 2, (a, _y, b, x, wy, z) => (Math.max(Math.abs(a), Math.abs(b)) >= R - 3 ? wall(x, wy, z) : -1));
  for (const k of [-R + 3, 0, R - 3]) for (const s of [-R + 2, R - 2]) {
    pillar(f, k, s, 3, T - 1);
    pillar(f, s, k, 3, T - 1);
  }
  windows(f, -R, -R, R, R, 18, 6);
  cren(f, -R, -R, R, R, 25);
  fillFn(f, -6, 0, -6, 6, T, 6, (a, y, b, x, wy, z) => {
    const ring = Math.max(Math.abs(a), Math.abs(b));
    if (y === T) return ring === 6 || ring === 3 ? S(CPB) : S(rnd(f, x, wy, z) < 0.25 ? GILD : PB);
    if (ring === 6 || y === 0) {
      const v = rnd(f, x, wy, z);
      return v < 0.1 ? S(B.magma_block) : v < 0.14 ? S(GILD) : wall(x, wy, z);
    }
    return S(B.lava);
  });
  for (const [a, b] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) pillar(f, a, b, 1, T - 1);
  fillFn(f, -2, T + 1, -3, 2, T + 3, 1, (a, y, b, x, wy, z) => {
    const ring = Math.max(Math.abs(a), Math.abs(b + 1));
    const v = rnd(f, x, wy, z);
    if (y === T + 1) return ring <= 1 || v < 0.6 ? S(B.gold_block) : -1;
    if (y === T + 2) return ring <= 1 && v < 0.8 ? S(B.gold_block) : -1;
    return ring === 0 ? S(B.gold_block) : -1;
  });
  chest(f, 0, T + 1, 3, 0, "bastion_treasure", B.chest);
  for (const d of [0, 1, 2, 3]) {
    const da = d === 3 ? 1 : d === 1 ? -1 : 0, db = d === 0 ? 1 : d === 2 ? -1 : 0;
    for (let k = 7; k <= R - 4; k++) {
      for (let side = -1; side <= 1; side++) {
        const a = da * k + (db ? side : 0), b = db * k + (da ? side : 0);
        const x = wx(f, a, b), z = wz(f, a, b);
        put(f, a, T, b, side === 0 ? S(PB) : wall(x, T, z));
        if (side !== 0 && rnd(f, x, T + 1, z) < 0.7) put(f, a, T + 1, b, S(BWALL));
      }
      if (k % 4 === 1) fill(f, da * k, 3, db * k, da * k, T - 1, db * k, S(CHAIN));
    }
  }
  for (const [a, b] of [[-14, -14], [14, 14]]) {
    fillFn(f, a - 1, 1, b - 1, a + 1, 2, b + 1, (_a, _y, _b, x, wy, z) => wall(x, wy, z));
    spawner(f, a, 3, b, "magma_cube", B.spawner);
  }
  fillFn(f, -15, 0, -R - 3, 2, T - 1, -R - 1, (a, y, _b, x, wy, z) => (y <= Math.min(T - 1, a + 14) ? wall(x, wy, z) : -1));
  ramp(f, -15, 1, -R - 2, T, 3);
  floor(f, -1, T, -R - 3, 2, -R - 1, wall);
  fill(f, 0, T + 1, -R - 3, 2, T + 3, -R + 1, 0);
  chest(f, -R + 3, T + 1, R - 3, 2, "bastion_other", B.chest);
  chest(f, R - 3, T + 1, -R + 3, 0, "bastion_other", B.chest);
  for (const [a, b] of [[2, -1], [-2, 1], [2, 2]]) mob(f, a, T + 1, b, "piglin_brute");
  if (r.chance(0.5)) mob(f, -2, T + 1, -2, "piglin_brute");
  piglins(f, r, [[-R + 3, T + 1, 0], [R - 3, T + 1, 0], [0, T + 1, R - 3]], 0);
}

// Bridge: a gate rampart, a wide bridge on arches over the lava, and the main rampart with the gold pile.
function bridge(f: Frame, r: Rng) {
  const wall = pal(f), D = 12;
  legs(f, -6, -44, 6, -32, 4);
  fill(f, -6, 1, -44, 6, 22, -32, 0);
  fill(f, -3, D - 1, -31, 3, D + 4, -11, 0);
  floor(f, -6, 0, -44, 6, -32, pal(f, 0.2, 0.5));
  walls(f, -6, -44, 6, -32, 1, 18, wall);
  floor(f, -5, D, -43, 5, -33, wall);
  cren(f, -6, -44, 6, -32, 19);
  for (const [a, b] of [[-6, -44], [6, -44], [-6, -32], [6, -32]]) pillar(f, a, b, 0, 19);
  windows(f, -6, -44, 6, -32, 15, 4);
  fill(f, -1, 1, -44, 1, 4, -44, 0);
  fill(f, 2, D, -43, 4, D, -33, 0);
  ramp(f, 3, 1, -43, D - 1, 0, wall);
  floor(f, 2, D - 1, -32 - 1, 4, -33, wall);
  fill(f, -2, D + 1, -32, 2, D + 4, -32, 0);
  mob(f, 0, D + 1, -38, "piglin");
  fillFn(f, -3, D - 2, -31, 3, D + 1, -11, (a, y, b, x, wy, z) => {
    const edge = Math.abs(a) === 3;
    if (y === D) return Math.abs(a) <= 1 ? S(rnd(f, x, wy, z) < 0.15 ? CPBB : PB) : wall(x, wy, z);
    if (y === D + 1) return edge && rnd(f, x, wy, z) < 0.8 ? S(BWALL) : -1;
    const pier = Math.min(Math.abs(b + 25), Math.abs(b + 17));
    if (y === D - 1) return wall(x, wy, z);
    return pier <= 1 + (edge ? 0 : 1) ? wall(x, wy, z) : -1;
  });
  for (const pb of [-25, -17]) {
    fillFn(f, -3, 0, pb - 1, 3, D - 3, pb + 1, (_a, _y, _b, x, wy, z) => wall(x, wy, z));
    legs(f, -3, pb - 1, 3, pb + 1, 1);
  }
  for (const b of [-28, -21, -14]) fill(f, 3, D - 6, b, 3, D - 2, b, S(CHAIN));
  chest(f, -2, D + 1, -21, 3, "bastion_bridge", B.chest);
  piglins(f, r, [[0, D + 1, -27], [1, D + 1, -15]], 0.2);
  const a0 = -13, a1 = 13, b0 = -10, b1 = 14;
  legs(f, a0, b0, a1, b1, 6);
  fill(f, a0, 1, b0, a1, 26, b1, 0);
  floor(f, a0, 0, b0, a1, b1, pal(f, 0.2, 0.5));
  walls(f, a0, b0, a1, b1, 1, 22, wall);
  for (let k = b0; k <= b1; k += 6) for (const s of [a0, a1]) pillar(f, s, k, 0, 23);
  windows(f, a0, b0, a1, b1, 4, 6);
  windows(f, a0, b0, a1, b1, 16, 6);
  cren(f, a0, b0, a1, b1, 23);
  fillFn(f, a0 + 1, D, b0 + 1, a1 - 1, D, b1 - 1, (a, _y, b, x, wy, z) => (Math.abs(a) <= 3 && b >= -2 && b <= 6 ? -1 : wall(x, wy, z)));
  fillFn(f, -4, D + 1, -3, 4, D + 1, 7, (a, _y, b, x, wy, z) => ((Math.abs(a) === 4 || b === -3 || b === 7) && rnd(f, x, wy, z) < 0.85 ? S(BWALL) : -1));
  fill(f, -2, D + 1, b0, 2, D + 4, b0, 0);
  fill(f, -1, 1, b1, 1, 4, b1, 0);
  fill(f, a0 + 2, D, b0 + 2, a0 + 4, D, b0 + 12, 0);
  ramp(f, a0 + 3, 1, b0 + 2, D, 0, wall);
  fillFn(f, -2, D + 1, b1 - 3, 2, D + 2, b1 - 1, (a, y, b, x, wy, z) => (y === D + 1 || (Math.abs(a) <= 1 && b === b1 - 2) || rnd(f, x, wy, z) < 0.3 ? S(B.gold_block) : -1));
  chest(f, 4, D + 1, b1 - 2, 1, "bastion_bridge", B.chest);
  chest(f, a1 - 2, 1, b1 - 2, 1, "bastion_other", B.chest);
  chest(f, a1 - 2, 1, b0 + 2, 1, "bastion_other", B.chest);
  for (const [a, b] of [[-6, 3], [6, 3], [0, 8]]) fill(f, a, D + 6, b, a, 21, b, S(CHAIN));
  piglins(f, r, [[6, D + 1, 9], [-6, D + 1, 9], [8, D + 1, -6], [0, 1, 4], [-6, 1, 10]], 0.3);
}
