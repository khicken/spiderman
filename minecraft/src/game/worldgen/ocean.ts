import { blockId as I } from "../blocks/registry";
import { brushable, chest, fill, fillFn, frame, logA, logB, mob, put, rnd, S, stairs, type Frame } from "./build";
import { B } from "./ids";
import { overworldGen } from "./overworld";
import { createRng, idTable, type Rng, type Writer } from "./rng";
import type { Start } from "./structure-grid";
import { BI } from "./surface";
import { underfill } from "./temples";

const WATER = S(B.water);
const WOODS = ["oak", "spruce", "dark_oak", "birch", "jungle", "acacia"];

function hullHalf(b: number, y: number): number {
  const along = b > 6 ? 3 - Math.ceil((b - 6) * 0.6) : b < -9 ? 2 : 3;
  return Math.max(0, along - (y === 0 ? 2 : y === 1 ? 1 : 0));
}

export function shipwreck(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const beached = s.biome === BI.beach || s.biome === BI.snowyBeach;
  const wood = WOODS[r.int(WOODS.length)];
  const PL = I(`${wood}_planks`), LOG = I(`${wood}_log`), ST = I(`${wood}_stairs`), FEN = I(`${wood}_fence`), SL = I(`${wood}_slab`), TD = I(`${wood}_trapdoor`);
  const flip = !beached && r.chance(0.2);
  const broken = r.chance(0.4);
  const f = frame(w, s.x, s.y - (beached ? 1 : 2), s.z, r.int(4), s.seed);
  const Y = (y: number) => (flip ? 9 - y : y);
  const water = (wy: number) => (wy <= 62 ? WATER : 0);
  fillFn(f, -4, 0, -11, 4, 9, 11, (a, y, b, x, wy, z) => {
    const yy = flip ? 9 - y : y;
    if (broken && b > 3 && b < 7 && rnd(f, x, 0, z) < 0.75) return -1;
    if (broken && rnd(f, x, wy, z) < 0.12) return -1;
    if (yy <= 4) {
      const hw = hullHalf(b, yy);
      if (b === -11 || b === 11 - Math.max(0, yy - 2) || Math.abs(a) > hw) {
        if (Math.abs(a) <= hw && Math.abs(b) <= 11) return S(yy === 4 ? LOG : PL);
        return -1;
      }
      if (Math.abs(a) === hw) return yy === 4 ? logB(f, LOG) : S(PL);
      if (yy === 0) return S(PL);
      if (yy === 4) return b === 1 && Math.abs(a) <= 1 ? water(wy) : S(PL);
      return water(wy);
    }
    if (b <= -6 && b >= -11 && Math.abs(a) <= 2 && yy <= 7) {
      if (yy === 7) return S(PL);
      if (Math.abs(a) === 2 || b === -11 || b === -6) return b === -6 && a === 0 && yy <= 6 ? water(wy) : yy === 6 && a === 0 ? S(TD) : S(PL);
      return water(wy);
    }
    if (yy === 5 && Math.abs(a) === hullHalf(b, 4) && Math.abs(b) < 10) return S(FEN);
    if (a === 0 && b === 2 && yy <= 9) return S(LOG);
    if (yy === 8 && b === 2 && Math.abs(a) <= 3) return logA(f, LOG);
    return -1;
  });
  for (let b = -10; b <= -7; b++) put(f, 0, Y(4), b, flip ? S(PL) : S(SL));
  put(f, 1, Y(5), 10, stairs(f, ST, 0, flip));
  chest(f, 1, Y(5), -9, 2, "shipwreck_map", B.chest);
  chest(f, 0, Y(1), 8, 2, "shipwreck_supply", B.chest);
  chest(f, -1, Y(1), -2, 1, "shipwreck_treasure", B.chest);
}

export function oceanRuin(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const warm = s.biome === BI.warmOcean || s.biome === BI.lukewarm || s.biome === BI.deepLukewarm;
  const big = r.chance(0.3);
  ruin(frame(w, s.x, s.y, s.z, r.int(4), s.seed), r, warm, big);
  if (big) {
    const n = 2 + r.int(3);
    for (let k = 0; k < n; k++) {
      const ox = s.x + r.int(25) - 12, oz = s.z + r.int(25) - 12;
      if (Math.abs(ox - s.x) < 7 && Math.abs(oz - s.z) < 7) continue;
      const y = overworldGen(s.ws).ow.surfaceY(ox, oz);
      if (y > 60) continue;
      ruin(frame(w, ox, y, oz, r.int(4), s.seed + k), createRng(s.seed + k), warm, false);
    }
  }
}

function ruin(f: Frame, r: Rng, warm: boolean, big: boolean) {
  const pick = (x: number, y: number, z: number) => {
    const v = rnd(f, x, y, z);
    if (warm) return S(v < 0.4 ? B.sandstone : v < 0.7 ? B.cut_sandstone : v < 0.85 ? I("chiseled_sandstone") : B.smooth_sandstone);
    return S(v < 0.4 ? B.stone_bricks : v < 0.65 ? B.mossy_stone_bricks : v < 0.85 ? B.cracked_stone_bricks : B.cobblestone);
  };
  const hw = big ? 7 : 3, h = big ? 6 : 4;
  const decay = big ? 0.25 : 0.35;
  fillFn(f, -hw, 0, -hw, hw, h, hw, (a, y, b, x, wy, z) => {
    if (wy > 61) return -1;
    const edge = Math.abs(a) === hw || Math.abs(b) === hw;
    const inner = big && (Math.abs(a) === 2 || Math.abs(b) === 2) && Math.abs(a) <= 2 && Math.abs(b) <= 2;
    if (y === 0) return pick(x, wy, z);
    if (!edge && !inner) return y === h && big && rnd(f, x, wy, z) < 0.5 ? pick(x, wy, z) : -1;
    const fall = rnd(f, x, wy + 7, z) < decay + y * 0.12;
    if (fall) return -1;
    if (y === 2 && (a === 0 || b === 0)) return WATER;
    return pick(x, wy, z);
  });
  fill(f, -hw, -3, -hw, hw, -1, hw, S(warm ? B.sandstone : B.gravel));
  fill(f, 0, 1, 0, 0, 1, 0, WATER);
  chest(f, hw - 1, 1, hw - 1, 2, big ? "underwater_ruin_big" : "underwater_ruin_small", B.chest);
  mob(f, 0, 1, 0, "drowned");
  if (big) {
    mob(f, -hw + 2, 1, 2, "drowned");
    put(f, -1, 1, -1, S(B.magma_block));
    brushable(f, 1, 1, 1, warm ? B.suspicious_sand : I("suspicious_gravel"), warm ? "ocean_ruin_warm" : "ocean_ruin_cold");
  }
  if (r.chance(0.5)) put(f, -hw + 1, 1, -hw + 1, S(B.sea_pickle, 2));
  for (let k = big ? 3 : 1; k > 0; k--) if (r.chance(0.7)) brushable(f, r.int(hw * 2 - 1) - hw + 1, 0, r.int(hw * 2 - 1) - hw + 1, warm ? B.suspicious_sand : I("suspicious_gravel"), warm ? "ocean_ruin_warm" : "ocean_ruin_cold");
}

const BEACH_KEEP = idTable(B.sand, B.sandstone, B.gravel, B.stone);

export function buriedTreasure(w: Writer, s: Start) {
  const f = frame(w, s.cx * 16 + 9, s.y - 3, s.cz * 16 + 9, 0, s.seed);
  fillFn(f, -1, -1, -1, 1, 1, 1, (_a, _y, _b, x, wy, z) => (BEACH_KEEP[w.get(x, wy, z) & 0xfff] ? -1 : S(B.sand)));
  chest(f, 0, 0, 0, 0, "buried_treasure", B.chest);
}

const PRIS = I("prismarine"), BRICK = I("prismarine_bricks"), DARK = I("dark_prismarine"), LANTERN = I("sea_lantern"), SPONGE = I("wet_sponge");

export function monument(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const y0 = 39;
  const f = frame(w, s.x, y0, s.z, r.int(4), s.seed);
  fill(f, -29, 1, -29, 28, 62 - y0, 28, WATER);
  for (const a of [-28, -14, 0, 13, 27]) {
    for (const b of [-28, -14, 0, 13, 27]) {
      if (a !== -28 && a !== 27 && b !== -28 && b !== 27) continue;
      fill(f, a, -1, b, a + 1, -1, b + 1, S(PRIS));
      underfill(f, a, b, a + 1, b + 1, S(PRIS), -2, 30);
    }
  }
  fill(f, -29, 0, -29, 28, 0, 28, S(BRICK));
  const wall = (x: number, y: number, z: number) => {
    const v = rnd(f, x, y, z);
    return S(v < 0.08 ? LANTERN : v < 0.5 ? PRIS : BRICK);
  };
  shellBox(f, -29, 0, -29, 28, 5, 28, wall);
  fill(f, -22, 5, -22, 21, 5, 21, WATER);
  shellBox(f, -22, 0, -22, 21, 5, 21, wall);
  for (const side of [-1, 1]) {
    const a0 = side < 0 ? -28 : 15, a1 = side < 0 ? -16 : 27;
    shellBox(f, a0, 0, -28, a1, 12, -8, wall);
    fillFn(f, a0, 12, -28, a1, 14, -8, (a, y, b) => (y === 12 ? S(DARK) : (a === a0 || a === a1 || b === -28 || b === -8) && y === 13 ? S(BRICK) : -1));
    fill(f, (a0 + a1) >> 1, 1, -27, (a0 + a1) >> 1, 11, -27, S(LANTERN));
    mob(f, (a0 + a1) >> 1, 4, -18, "elder_guardian");
  }
  shellBox(f, -13, 0, -12, 12, 15, 20, wall);
  for (let k = 0; k < 3; k++) fillFn(f, -13 + k * 2, 15 + k, -12 + k * 2, 12 - k * 2, 15 + k, 20 - k * 2, (a, _y, b) => (Math.abs(a) <= 11 - k * 2 && b > -11 + k * 2 && b < 19 - k * 2 ? -1 : S(k === 1 ? DARK : BRICK)));
  shellBox(f, -6, 16, 0, 6, 21, 12, (x, y, z) => (y === 21 ? S(DARK) : wall(x, y, z)));
  fill(f, -2, 22, 4, 2, 22, 8, S(DARK));
  mob(f, 0, 17, 6, "elder_guardian");
  fill(f, -3, 1, -29, 2, 4, -22, WATER);
  fill(f, -3, 1, -13, 2, 4, -12, WATER);
  for (const a of [-5, 4]) fill(f, a, 1, -32, a + 1, 8, -29, S(BRICK));
  fill(f, -5, 8, -32, 5, 8, -29, S(BRICK));
  fill(f, -2, 9, -31, 2, 9, -30, S(LANTERN));
  fill(f, -4, 1, 2, 3, 6, 9, S(DARK));
  fill(f, -3, 2, 3, 2, 5, 8, WATER);
  fill(f, -1, 2, 5, 0, 3, 6, S(B.gold_block));
  fill(f, -1, 4, 5, 0, 4, 6, S(DARK));
  for (const [a, b] of [[-9, 14], [8, 14], [-9, -6], [8, -6]]) {
    fill(f, a, 1, b, a + 1, 14, b + 1, S(PRIS));
    put(f, a, 7, b, S(LANTERN));
  }
  for (let k = 0; k < 6; k++) {
    const a = -20 + r.int(40), b = -20 + r.int(40);
    if (Math.abs(a) < 14 && b > -13 && b < 21) mob(f, a, 1, b, "guardian");
    else mob(f, a, 2, b, "guardian");
  }
  const sp = r.int(3);
  if (sp > 0) fill(f, 16 + r.int(6), 1, -26 + r.int(10), 18 + r.int(6), 3, -22 + r.int(8), S(SPONGE));
}

function shellBox(f: Frame, a0: number, y0: number, b0: number, a1: number, y1: number, b1: number, wall: (x: number, y: number, z: number) => number) {
  fillFn(f, a0, y0, b0, a1, y1, b1, (a, y, b, x, wy, z) => (a === a0 || a === a1 || b === b0 || b === b1 || y === y0 || y === y1 ? wall(x, wy, z) : WATER));
}
