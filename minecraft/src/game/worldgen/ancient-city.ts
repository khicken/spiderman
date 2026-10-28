import { blockId as I } from "../blocks/registry";
import { chest, fill, fillFn, frame, get, put, rnd, S, stairs, type Frame } from "./build";
import { B } from "./ids";
import { createRng, idTable, type Rng, type Writer } from "./rng";
import type { Start } from "./structure-grid";

const BR = I("deepslate_bricks"), CBR = I("cracked_deepslate_bricks"), TL = I("deepslate_tiles"), POL = I("polished_deepslate"), CHIS = I("chiseled_deepslate");
const REIN = I("reinforced_deepslate"), COB = I("cobbled_deepslate"), SCULK = I("sculk"), VEIN = I("sculk_vein"), SENSOR = I("sculk_sensor");
const SHRIEK = I("sculk_shrieker"), CAT = I("sculk_catalyst"), SLANT = I("soul_lantern"), BST = I("deepslate_brick_stairs"), BSL = I("deepslate_brick_slab");
const TST = I("deepslate_tile_stairs"), WALL = I("deepslate_brick_wall"), DO = I("dark_oak_planks"), DOL = I("dark_oak_log");

const RX = 44, RZ = 36;
// sculk_replaceable_world_gen: what a sculk patch may turn into sculk.
const REPL = idTable(B.stone, B.deepslate, B.tuff, B.granite, B.diorite, B.andesite, B.dirt, B.gravel, BR, CBR, TL, I("cracked_deepslate_tiles"), POL, COB);
const SOLID = idTable(B.stone, B.deepslate, B.tuff, B.granite, B.diorite, B.andesite, B.dirt, B.gravel, BR, CBR, TL, I("cracked_deepslate_tiles"), POL, COB, SCULK, REIN, CHIS, CAT);

export function ancientCity(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const f = frame(w, s.x, s.y, s.z, r.int(4), s.seed);
  const brick = (x: number, y: number, z: number) => S(rnd(f, x, y, z) < 0.2 ? CBR : BR);
  fillFn(f, -RX, -4, -RZ, RX, 18, RZ, (a, y, b, x, wy, z) => {
    const e = (a * a) / (RX * RX) + (b * b) / (RZ * RZ);
    if (e > 1) return -1;
    const h = Math.round(16 - e * 9 + rnd(f, x, 0, z) * 2);
    if (y > h) return -1;
    if (y < 0) return y === -1 ? S(B.deepslate) : -1;
    if (y === 0) {
      const street = Math.abs(a) <= 2 || Math.abs(b) <= 2 || Math.abs(a - b * 0.9) < 1.5;
      const v = rnd(f, x, wy, z);
      if (street) return S(v < 0.3 ? TL : POL);
      return S(v < 0.45 ? COB : v < 0.75 ? BR : v < 0.85 ? CBR : TL);
    }
    return 0;
  });
  centerPortal(f, brick);
  const spots: [number, number][] = [[-30, -18], [-30, 14], [28, -18], [28, 14], [-14, -26], [14, -26], [-16, 22], [16, 22], [-38, -2], [36, -2]];
  spots.forEach(([a, b], i) => {
    const kind = (i + r.int(3)) % 4;
    const pr = createRng(s.seed + i * 7919);
    if (kind === 0) house(f, pr, a, b, brick);
    else if (kind === 1) tower(f, pr, a, b, brick);
    else if (kind === 2) iceBox(f, a, b, brick);
    else campfire(f, pr, a, b);
  });
  const patches = sculkPatches(f, r);
  // Template sensors and shriekers (can_summon = true) sit on the patches.
  for (let k = 0; k < 40; k++) {
    const [pa, pb, pr] = patches[r.int(patches.length)];
    const a = pa + r.int(2 * pr + 1) - pr, b = pb + r.int(2 * pr + 1) - pr;
    const roll = r.next();
    if (get(f, a, 0, b) !== S(SCULK) || get(f, a, 1, b) !== 0) continue;
    put(f, a, 1, b, roll < 0.55 ? S(SENSOR) : S(SHRIEK, 1));
  }
  for (const [a, b] of [[-6, -6], [6, -6], [-6, 6], [6, 6], [-20, 0], [20, 0], [0, -20], [0, 20]]) {
    fill(f, a, 1, b, a, 3, b, S(WALL));
    put(f, a, 4, b, S(SLANT));
  }
}

function centerPortal(f: Frame, brick: (x: number, y: number, z: number) => number) {
  const b0 = 8;
  fill(f, -16, 0, b0 - 4, 16, 0, b0 + 6, S(TL));
  fill(f, -16, 1, b0 - 4, 16, 1, b0 - 4, S(BSL));
  fillFn(f, -12, 1, b0, 12, 18, b0 + 2, (a, y, _b, x, wy, z) => {
    const outer = Math.abs(a) >= 10 || y >= 15;
    const inner = Math.abs(a) <= 6 && y <= 11;
    if (inner) return 0;
    if (Math.abs(a) > 10 && y > 8 + (12 - Math.abs(a)) * 3) return -1;
    if (y > 17 || (y > 15 && Math.abs(a) > 8)) return -1;
    if (outer) return Math.abs(a) === 12 || y === 17 ? S(CHIS) : brick(x, wy, z);
    return S(REIN);
  });
  for (const a of [-12, 12]) fill(f, a, 1, b0 + 3, a, 8, b0 + 5, S(POL));
  for (const a of [-14, 14]) {
    fill(f, a - 1, 1, b0 - 2, a + 1, 3, b0 + 4, S(BR));
    fill(f, a, 4, b0 + 1, a, 4, b0 + 1, S(SLANT));
  }
  for (let k = 0; k < 3; k++) fill(f, -3 + k, 1 + k, b0 - 3 - k, 3 - k, 1 + k, b0 - 3 - k, stairs(f, BST, 0));
  fill(f, -6, 1, b0 + 1, 6, 1, b0 + 1, S(SCULK));
  put(f, 0, 2, b0 + 1, S(SHRIEK, 1));
  put(f, -4, 2, b0 + 1, S(SENSOR));
  put(f, 4, 2, b0 + 1, S(SENSOR));
  chest(f, -8, 1, b0 - 2, 0, "ancient_city", I("chest"));
  chest(f, 8, 1, b0 - 2, 0, "ancient_city", I("chest"));
}

function house(f: Frame, r: Rng, a: number, b: number, brick: (x: number, y: number, z: number) => number) {
  const hw = 3 + r.int(2), hd = 3;
  fillFn(f, a - hw, 0, b - hd, a + hw, 5, b + hd, (aa, y, bb, x, wy, z) => {
    const edge = Math.abs(aa - a) === hw || Math.abs(bb - b) === hd;
    if (y === 0) return S(TL);
    if (y === 5) return S(BSL, 0);
    if (!edge) return 0;
    if (y === 2 && (aa === a || bb === b)) return 0;
    if (y <= 2 && bb === b - hd && Math.abs(aa - a) <= 1) return 0;
    return Math.abs(aa - a) === hw && Math.abs(bb - b) === hd ? S(DOL) : brick(x, wy, z);
  });
  fill(f, a - hw + 1, 1, b + hd - 1, a - hw + 1, 1, b + hd - 1, S(I("gray_wool")));
  chest(f, a + hw - 1, 1, b + hd - 1, 2, "ancient_city", I("chest"));
  put(f, a, 4, b, S(SLANT, 1));
  put(f, a - 1, 1, b, S(SCULK));
  put(f, a - 1, 2, b, S(I("candle"), 3));
}

function tower(f: Frame, r: Rng, a: number, b: number, brick: (x: number, y: number, z: number) => number) {
  const h = 9 + r.int(5);
  fillFn(f, a - 2, 0, b - 2, a + 2, h, b + 2, (aa, y, bb, x, wy, z) => {
    const da = Math.abs(aa - a), db = Math.abs(bb - b);
    if (y === h) return da === 2 || db === 2 ? S(WALL) : S(TL);
    if (da < 2 && db < 2) return y === 0 ? S(TL) : 0;
    if (y % 4 === 2 && (da === 0 || db === 0)) return S(I("light_blue_wool"));
    return brick(x, wy, z);
  });
  for (let y = 1; y < h; y++) put(f, a, y, b + 1, S(I("ladder"), 2));
  put(f, a, h + 1, b, S(SLANT));
  fill(f, a, 1, b - 2, a, 2, b - 2, 0);
}

function iceBox(f: Frame, a: number, b: number, brick: (x: number, y: number, z: number) => number) {
  fillFn(f, a - 2, 0, b - 2, a + 2, 4, b + 2, (aa, y, bb, x, wy, z) => (Math.abs(aa - a) === 2 || Math.abs(bb - b) === 2 || y === 0 || y === 4 ? brick(x, wy, z) : 0));
  fill(f, a - 1, 1, b - 1, a + 1, 3, b + 1, S(I("packed_ice")));
  fill(f, a, 1, b, a, 2, b, S(I("snow_block")));
  fill(f, a, 1, b - 2, a, 2, b - 2, 0);
  put(f, a, 1, b - 1, 0);
  chest(f, a, 1, b - 1, 2, "ancient_city_ice_box", I("chest"));
}

function campfire(f: Frame, r: Rng, a: number, b: number) {
  fill(f, a - 2, 0, b - 2, a + 2, 0, b + 2, S(POL));
  put(f, a, 0, b, S(I("soul_sand")));
  put(f, a, 1, b, S(I("soul_fire")));
  for (const [da, db, h] of [[-2, 0, 3], [2, 0, 1], [0, -2, 0], [0, 2, 2]]) put(f, a + da, 1, b + db, stairs(f, TST, h));
  if (r.chance(0.6)) chest(f, a + 2, 1, b + 2, 2, "ancient_city", I("chest"));
  put(f, a - 2, 1, b - 2, S(I("skeleton_skull")));
  put(f, a + 2, 1, b - 2, S(CAT));
}

// Sculk patches spread from catalysts: exposed blocks near a center turn to sculk, veins fringe the edge and climb walls a little.
function sculkPatches(f: Frame, r: Rng): [number, number, number][] {
  const patches: [number, number, number][] = [];
  while (patches.length < 26) {
    const a = r.int(2 * RX) - RX, b = r.int(2 * RZ) - RZ;
    if ((a * a) / (RX * RX) + (b * b) / (RZ * RZ) > 0.85) continue;
    patches.push([a, b, 4 + r.int(6)]);
    if (r.chance(0.5)) put(f, a, 0, b, S(CAT));
  }
  const w = f.w;
  const solid = (x: number, y: number, z: number) => {
    const c = w.get(x, y, z);
    return c > 0 && SOLID[c & 0xfff] === 1;
  };
  const open = (x: number, y: number, z: number) => {
    const c = w.get(x, y, z);
    return c === 0 || (c & 0xfff) === VEIN;
  };
  let cx = NaN, cz = NaN, d = 9;
  fillFn(f, -RX, -1, -RZ, RX, 16, RZ, (a, y, b, x, wy, z) => {
    if (x !== cx || z !== cz) {
      cx = x;
      cz = z;
      d = 9;
      for (const [pa, pb, pr] of patches) d = Math.min(d, Math.hypot(a - pa, b - pb) / pr);
      d += (rnd(f, x >> 2, 7, z >> 2) - 0.5) * 0.5 + rnd(f, x, 7, z) * 0.15;
    }
    const v = d + Math.max(0, y - 1) * 0.12;
    if (v > 1.3) return -1;
    const c = w.get(x, wy, z);
    if (c > 0 && REPL[c & 0xfff]) {
      if (v >= 1) return -1;
      return open(x, wy + 1, z) || open(x + 1, wy, z) || open(x - 1, wy, z) || open(x, wy, z + 1) || open(x, wy, z - 1) ? S(SCULK) : -1;
    }
    if (c !== 0 || v < 0.95 - (y > 1 ? 0.4 : 0)) return -1;
    const wall = solid(x + 1, wy, z) || solid(x - 1, wy, z) || solid(x, wy, z + 1) || solid(x, wy, z - 1);
    return (solid(x, wy - 1, z) || wall) && rnd(f, x, wy, z) < (wall ? 0.7 : 0.5) ? S(VEIN) : -1;
  });
  return patches;
}
