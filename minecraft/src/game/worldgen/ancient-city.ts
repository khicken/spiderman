import { blockId as I } from "../blocks/registry";
import { chest, fill, fillFn, frame, put, rnd, S, stairs, type Frame } from "./build";
import { createRng, type Rng, type Writer } from "./rng";
import type { Start } from "./structure-grid";

const BR = I("deepslate_bricks"), CBR = I("cracked_deepslate_bricks"), TL = I("deepslate_tiles"), POL = I("polished_deepslate"), CHIS = I("chiseled_deepslate");
const REIN = I("reinforced_deepslate"), COB = I("cobbled_deepslate"), SCULK = I("sculk"), VEIN = I("sculk_vein"), SENSOR = I("sculk_sensor");
const SHRIEK = I("sculk_shrieker"), CAT = I("sculk_catalyst"), SLANT = I("soul_lantern"), BST = I("deepslate_brick_stairs"), BSL = I("deepslate_brick_slab");
const TST = I("deepslate_tile_stairs"), WALL = I("deepslate_brick_wall"), DO = I("dark_oak_planks"), DOL = I("dark_oak_log");

const RX = 44, RZ = 36;

export function ancientCity(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const f = frame(w, s.x, s.y, s.z, r.int(4), s.seed);
  const brick = (x: number, y: number, z: number) => S(rnd(f, x, y, z) < 0.2 ? CBR : BR);
  fillFn(f, -RX, -4, -RZ, RX, 18, RZ, (a, y, b, x, wy, z) => {
    const e = (a * a) / (RX * RX) + (b * b) / (RZ * RZ);
    if (e > 1) return -1;
    const h = Math.round(16 - e * 9 + rnd(f, x, 0, z) * 2);
    if (y > h) return -1;
    if (y < 0) return y === -1 ? S(rnd(f, x, wy, z) < 0.5 ? SCULK : I("deepslate")) : -1;
    if (y === 0) {
      const street = Math.abs(a) <= 2 || Math.abs(b) <= 2 || Math.abs(a - b * 0.9) < 1.5;
      if (street) return S(rnd(f, x, wy, z) < 0.3 ? TL : POL);
      return rnd(f, x, wy, z) < 0.55 ? S(SCULK) : S(COB);
    }
    if (y === 1 && rnd(f, x, wy, z) < 0.04 && Math.abs(a) > 3 && Math.abs(b) > 3) return S(VEIN, 1 << 3);
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
  for (let k = 0; k < 24; k++) {
    const a = r.int(2 * RX - 10) - RX + 5, b = r.int(2 * RZ - 10) - RZ + 5;
    if ((a * a) / (RX * RX) + (b * b) / (RZ * RZ) > 0.8 || Math.abs(a) <= 2 || Math.abs(b) <= 2) continue;
    const roll = r.next();
    put(f, a, 1, b, S(roll < 0.4 ? SENSOR : roll < 0.7 ? SHRIEK : roll < 0.8 ? CAT : I("candle"), roll >= 0.4 && roll < 0.7 ? 1 : 0));
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
