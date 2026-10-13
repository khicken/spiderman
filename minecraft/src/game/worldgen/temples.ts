import { blockId as I } from "../blocks/registry";
import { brushable, chest, faceOf, fill, fillFn, frame, hz, insideL, mob, put, rnd, S, stairs, wx, wz, type Frame } from "./build";
import { B } from "./ids";
import { createRng, idTable, type Writer } from "./rng";
import type { Start } from "./structure-grid";

const STOP = idTable(B.stone, B.deepslate, B.dirt, B.sand, B.sandstone, B.gravel, B.grass_block, B.granite, B.diorite, B.andesite, B.terracotta,
  B.red_sand, B.snow_block, B.podzol, B.coarse_dirt, B.mud, B.clay, B.tuff, B.calcite, B.packed_ice, B.ice, B.mossy_cobblestone, B.cobblestone);

export function underfill(f: Frame, a0: number, b0: number, a1: number, b1: number, st: number, from = -1, depth = 16) {
  fillFn(f, a0, from, b0, a1, from, b1, (_a, _y, _b, x, wy, z) => {
    for (let k = 0; k < depth; k++) {
      const c = f.w.get(x, wy - k, z);
      if (c < 0 || STOP[c & 0xfff]) break;
      f.w.set(x, wy - k, z, st);
    }
    return -1;
  });
}

const ORANGE = I("orange_terracotta"), BLUE = I("blue_terracotta"), CUT = B.cut_sandstone, CHIS = I("chiseled_sandstone"), SS = B.sandstone;

export function desertPyramid(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const f = frame(w, s.x, s.y, s.z, r.int(4), s.seed);
  underfill(f, -10, -10, 10, 10, S(SS), -1, 12);
  fill(f, -10, -14, -10, 10, 0, 10, S(SS));
  for (let y = 1; y <= 10; y++) {
    const e = 11 - y;
    fillFn(f, -e, y, -e, e, y, e, (a, _y, b) => {
      const edge = Math.abs(a) === e || Math.abs(b) === e;
      if (edge) return y > 1 && Math.abs(a) < e && Math.abs(b) < e ? -1 : S(y === 1 ? CUT : SS);
      return Math.abs(a) <= 7 && Math.abs(b) <= 7 && y <= 6 ? 0 : -1;
    });
  }
  fill(f, -7, 1, -7, 7, 6, 7, 0);
  fillFn(f, -8, 1, -8, 8, 6, 8, (a, _y, b) => (Math.abs(a) === 8 || Math.abs(b) === 8 ? S(SS) : -1));
  fillFn(f, -4, 0, -4, 4, 0, 4, (a, _y, b) => {
    const d = Math.abs(a) + Math.abs(b);
    if (d === 0) return S(BLUE);
    if (d === 1 || (Math.abs(a) === 2 && b === 0) || (Math.abs(b) === 2 && a === 0)) return S(ORANGE);
    if (Math.abs(a) === 4 || Math.abs(b) === 4) return S(ORANGE);
    return S(SS);
  });
  for (const ta of [-7, 7]) tower(f, ta, -7);
  fill(f, -1, 1, -10, 1, 3, -8, 0);
  fillFn(f, -3, 1, -11, 3, 8, -11, (a, y) => (Math.abs(a) <= 1 && y <= 3 ? 0 : Math.abs(a) === 3 ? S(CUT) : y === 6 && Math.abs(a) <= 2 ? S(ORANGE) : y === 5 && a === 0 ? S(CHIS) : S(SS)));
  for (let y = -11; y <= -1; y++) put(f, 0, y, 0, 0);
  fillFn(f, -4, -14, -4, 4, -10, 4, (a, y, b) => {
    const ea = Math.abs(a) === 4, eb = Math.abs(b) === 4;
    if (y === -14) return S(a === 0 && b === 0 ? I("stone_pressure_plate") : CUT);
    if (ea || eb || y === -10) return S(y === -12 && (ea ? b === 0 : a === 0) ? CHIS : CUT);
    if (Math.abs(a) >= 2 && Math.abs(b) >= 2) return S(CUT);
    return 0;
  });
  fill(f, 0, -14, 0, 0, -14, 0, S(SS));
  put(f, 0, -13, 0, S(I("stone_pressure_plate")));
  fill(f, -1, -16, -1, 1, -16, 1, S(I("tnt")));
  put(f, 0, -15, 0, S(I("tnt")));
  for (let h = 0; h < 4; h++) {
    const a = h === 3 ? 3 : h === 1 ? -3 : 0, b = h === 0 ? 3 : h === 2 ? -3 : 0;
    fill(f, a, -13, b, a, -12, b, 0);
    chest(f, a, -13, b, (h + 2) & 3, "desert_pyramid", B.chest);
  }
  for (const [a, b] of [[-3, -3], [3, 3]]) brushable(f, a, -15, b, B.suspicious_sand, "desert_pyramid");
}

function tower(f: Frame, ta: number, tb: number) {
  fillFn(f, ta - 2, 0, tb - 2, ta + 2, 13, tb + 2, (a, y, b) => {
    const da = Math.abs(a - ta), db = Math.abs(b - tb);
    const edge = da === 2 || db === 2;
    if (!edge) return y === 0 ? S(SS) : y >= 12 ? -1 : 0;
    if (y >= 12) return da === 2 && db === 2 ? S(CUT) : -1;
    if (y === 11) return S(CUT);
    if ((y === 8 || y === 9) && (da === 0 || db === 0)) return S(ORANGE);
    if (y === 10 && (da === 1 || db === 1) && !(da === 2 && db === 2)) return S(ORANGE);
    return S(da === 2 && db === 2 ? CUT : SS);
  });
  fill(f, ta, 1, tb - 2, ta, 2, tb - 2, 0);
  for (let y = 1; y <= 10; y++) put(f, ta, y, tb + 1, S(B.ladder, hz(f, 2)));
  fill(f, ta - 1, 11, tb - 1, ta + 1, 11, tb + 1, S(SS));
  put(f, ta, 11, tb + 1, 0);
}

export function jungleTemple(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const f = frame(w, s.x, s.y, s.z, r.int(4), s.seed);
  const cob = (x: number, y: number, z: number) => S(rnd(f, x, y, z) < 0.6 ? B.mossy_cobblestone : B.cobblestone);
  underfill(f, -6, 0, 6, 14, S(B.cobblestone));
  fillFn(f, -6, -4, 0, 6, 0, 14, (_a, _y, _b, x, y, z) => cob(x, y, z));
  levelBox(f, -6, 0, 0, 6, 4, 14, cob);
  levelBox(f, -5, 4, 1, 5, 8, 13, cob);
  levelBox(f, -3, 8, 3, 3, 11, 11, cob);
  for (const y of [4, 8]) fill(f, -2, y, 6, 2, y, 8, 0);
  fill(f, -1, 1, 0, 1, 3, 0, 0);
  for (const y of [5, 9]) for (const b of [1, 3, 13, 11]) if ((y === 5 && (b === 1 || b === 13)) || (y === 9 && (b === 3 || b === 11))) fill(f, -1, y, b, 1, y + 1, b, 0);
  for (let b = -3; b < 0; b++) fill(f, -1, b + 3 - 3, b, 1, b + 3 - 3, b, stairs(f, B.cobblestone_stairs, 0));
  fill(f, -2, 10, 6, 2, 10, 8, S(I("chiseled_stone_bricks")));
  for (const a of [-5, 5]) for (const b of [2, 6, 10]) put(f, a, 2, b, S(I("chiseled_stone_bricks")));
  fill(f, -5, -3, 1, 5, -1, 13, 0);
  for (let k = 0; k < 4; k++) put(f, 4, -k, 9 + k, stairs(f, B.cobblestone_stairs, 0));
  fill(f, 4, 1, 8, 4, 1, 12, 0);
  fill(f, -5, -3, 3, -1, -1, 3, S(B.cobblestone));
  fill(f, -4, -3, 3, -4, -2, 3, 0);
  put(f, -4, -3, 2, S(I("tripwire_hook"), hz(f, 0)));
  put(f, -4, -3, 3, S(I("tripwire")));
  put(f, -4, -3, 4, S(I("tripwire")));
  put(f, -4, -3, 5, S(I("tripwire_hook"), hz(f, 2)));
  dispenser(f, -4, -2, 1, 0, 2 + r.int(6));
  chest(f, -4, -3, 1, 0, "jungle_temple", B.chest);
  fill(f, 1, -3, 1, 3, -3, 1, S(I("chiseled_stone_bricks")));
  for (let k = 0; k < 3; k++) put(f, 1 + k, -2, 2, S(I("lever"), faceOf(f, 0)));
  put(f, -1, -3, 13, S(B.redstone_wire));
  fill(f, -3, -3, 12, -2, -1, 13, S(B.mossy_cobblestone));
  chest(f, -3, -3, 13, 0, "jungle_temple", B.chest);
  put(f, -3, -3, 12, 0);
  put(f, 3, -3, 13, S(I("sticky_piston"), faceOf(f, 1)));
  for (const [a, b] of [[-4, 6], [4, 6]]) {
    put(f, a, 1, b, S(I("tripwire_hook"), hz(f, a < 0 ? 3 : 1)));
  }
  fill(f, -3, 1, 6, 3, 1, 6, S(I("tripwire")));
  dispenser(f, 0, 1, 14, 2, 2 + r.int(6));
  fill(f, -1, 1, 13, 1, 1, 13, S(B.vine));
}

function levelBox(f: Frame, a0: number, y0: number, b0: number, a1: number, y1: number, b1: number, wall: (x: number, y: number, z: number) => number) {
  fillFn(f, a0, y0, b0, a1, y1, b1, (a, y, b, x, wy, z) => (a === a0 || a === a1 || b === b0 || b === b1 || y === y0 || y === y1 ? wall(x, wy, z) : 0));
}

function dispenser(f: Frame, a: number, y: number, b: number, h: number, arrows: number) {
  put(f, a, y, b, S(I("dispenser"), faceOf(f, h)));
  const x = wx(f, a, b), z = wz(f, a, b);
  if (!f.w.inside(x, z)) return;
  const items = new Array(9).fill(null);
  items[4] = { item: "arrow", count: arrows };
  f.w.blockEntities.push({ x, y: f.y + y, z, type: "dispenser", items });
}

export function igloo(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const f = frame(w, s.x, s.y, s.z, r.int(4), s.seed);
  const SNOW = S(B.snow_block);
  underfill(f, -4, -5, 4, 4, SNOW, -1, 6);
  fill(f, -4, 0, -5, 4, 0, 4, SNOW);
  fillFn(f, -4, 1, -4, 4, 5, 4, (a, y, b) => {
    const d = Math.sqrt(a * a + b * b + (y - 1) * (y - 1) * 1.6);
    if (d > 4.7) return -1;
    return d > 3.7 ? SNOW : 0;
  });
  fill(f, -1, 1, -6, 1, 3, -4, SNOW);
  fill(f, 0, 1, -6, 0, 2, -3, 0);
  put(f, 0, 3, -2, S(B.ice));
  for (const a of [-3, 3]) put(f, a, 2, 0, S(B.ice));
  fill(f, -2, 1, -2, 2, 1, 2, S(I("white_carpet")));
  put(f, -2, 1, 1, S(I("red_bed"), hz(f, 0)));
  put(f, -2, 1, 2, S(I("red_bed"), hz(f, 0) | 4));
  put(f, 2, 1, 2, S(B.furnace, faceOf(f, 2)));
  put(f, 2, 1, 1, S(B.crafting_table));
  put(f, 2, 2, -1, S(I("redstone_wall_torch"), 1 + hz(f, 1)));
  if (!r.chance(0.5)) return;
  const depth = 4 + r.int(8);
  put(f, 0, 0, 0, S(I("oak_trapdoor"), hz(f, 0)));
  put(f, 0, 1, 0, S(I("white_carpet")));
  for (let k = 1; k <= depth; k++) {
    fillFn(f, -1, -k, -1, 1, -k, 1, (a, _y, b) => (a === 0 && b === 0 ? S(B.ladder, hz(f, 0)) : S(B.stone_bricks)));
  }
  const y0 = -depth - 4;
  fillFn(f, -4, y0, -1, 4, y0 + 4, 9, (a, y, b, x, wy, z) => {
    const edge = Math.abs(a) === 4 || b === -1 || b === 9 || y === y0 || y === y0 + 4;
    if (edge) return S(rnd(f, x, wy, z) < 0.3 ? B.mossy_stone_bricks : rnd(f, x, wy, z) < 0.4 ? B.cracked_stone_bricks : B.stone_bricks);
    return 0;
  });
  for (let y = y0 + 1; y <= -depth - 1; y++) put(f, 0, y, 0, S(B.ladder, hz(f, 0)));
  put(f, 0, y0 + 1, 8, S(I("brewing_stand")));
  put(f, 1, y0 + 1, 8, S(I("cauldron")));
  chest(f, -1, y0 + 1, 8, 2, "igloo_chest", B.chest);
  put(f, -3, y0 + 1, 2, S(I("white_carpet")));
  for (const a of [-3, 3]) {
    fill(f, a - 1, y0 + 1, 4, a + 1, y0 + 3, 4, S(I("iron_bars")));
    fill(f, a > 0 ? 2 : -2, y0 + 1, 5, a > 0 ? 2 : -2, y0 + 3, 7, S(I("iron_bars")));
    mob(f, a, y0 + 1, 6, a < 0 ? "villager" : "zombie_villager", { profession: "none" });
  }
  put(f, 0, y0 + 3, 4, S(I("redstone_wall_torch"), 1 + hz(f, 0)));
}

export function swampHut(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const f = frame(w, s.x, Math.max(s.y, 62) + 3, s.z, r.int(4), s.seed);
  for (const [a, b] of [[-2, 1], [2, 1], [-2, 6], [2, 6]]) {
    if (!insideL(f, a, b)) continue;
    for (let y = 0; y > -10; y--) {
      const x = wx(f, a, b), z = wz(f, a, b), c = f.w.get(x, f.y + y - 1, z);
      put(f, a, y - 1, b, S(B.oak_log));
      if (c >= 0 && STOP[c & 0xfff]) break;
    }
  }
  fill(f, -3, 0, 0, 3, 0, 7, S(B.spruce_planks));
  fillFn(f, -2, 1, 2, 2, 3, 7, (a, y, b) => {
    const edge = Math.abs(a) === 2 || b === 2 || b === 7;
    if (!edge) return 0;
    if ((Math.abs(a) === 2 && (b === 2 || b === 7))) return S(B.oak_log);
    if (y === 2 && ((Math.abs(a) === 2 && b === 4) || (b === 7 && a === 0))) return S(I("oak_fence"));
    return S(B.spruce_planks);
  });
  fill(f, 0, 1, 2, 0, 2, 2, 0);
  for (const a of [-3, 3]) for (const b of [0, 1]) put(f, a, 1, b, S(I("oak_fence")));
  put(f, -3, 2, 0, S(I("oak_fence")));
  for (let b = -1; b <= 8; b++) {
    put(f, -3, 4, b, stairs(f, B.spruce_stairs, 3));
    put(f, 3, 4, b, stairs(f, B.spruce_stairs, 1));
    fill(f, -2, 4, b, 2, 4, b, S(B.spruce_planks));
  }
  put(f, -1, 1, 6, S(B.crafting_table));
  put(f, 1, 1, 6, S(I("cauldron")));
  put(f, -1, 1, 3, S(I("potted_red_mushroom")));
  mob(f, 0, 1, 5, "witch");
  mob(f, 1, 1, 4, "cat", { variant: "all_black" });
}

export function outpost(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const f = frame(w, s.x, s.y, s.z, r.int(4), s.seed);
  const LOG = S(I("dark_oak_log")), PLANK = S(B.birch_planks), FENCE = S(I("dark_oak_fence")), COB = S(B.cobblestone);
  underfill(f, -4, -4, 4, 4, COB);
  fill(f, -4, 0, -4, 4, 0, 4, COB);
  fill(f, -4, 1, -4, 4, 24, 4, 0);
  fillFn(f, -3, 1, -3, 3, 18, 3, (a, y, b) => {
    const ea = Math.abs(a) === 3, eb = Math.abs(b) === 3;
    if (ea && eb) return LOG;
    if (y === 6 || y === 12) return ea || eb ? LOG : Math.abs(a) === 2 && b === 2 ? 0 : PLANK;
    if (!ea && !eb) return 0;
    if ((y % 6 === 2 || y % 6 === 3) && (a === 0 || b === 0)) return FENCE;
    return y < 6 ? COB : PLANK;
  });
  fill(f, 0, 1, -3, 0, 2, -3, 0);
  for (let y = 1; y <= 18; y++) put(f, 2, y, 2, S(B.ladder, hz(f, 2)));
  fillFn(f, -5, 18, -5, 5, 19, 5, (a, y, b) => {
    const edge = Math.abs(a) === 5 || Math.abs(b) === 5;
    if (y === 18) return Math.abs(a) === 2 && Math.abs(b) === 2 && a === 2 && b === 2 ? -1 : edge ? LOG : PLANK;
    return edge ? FENCE : -1;
  });
  for (const [a, b] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) fill(f, a, 19, b, a, 22, b, LOG);
  fillFn(f, -5, 23, -5, 5, 23, 5, () => S(I("dark_oak_slab")));
  fill(f, -4, 23, -4, 4, 23, 4, S(I("dark_oak_planks")));
  chest(f, -3, 19, 3, 2, "pillager_outpost", B.chest);
  put(f, 0, 22, 0, S(B.lantern, 1));
  mob(f, 0, 19, 0, "pillager", { captain: true });
  mob(f, -2, 19, -2, "pillager");
  mob(f, 2, 1, -6, "pillager");
  mob(f, -2, 1, -6, "pillager");
  if (r.chance(0.6)) {
    const cf = frame(w, wx(f, 9, 0), s.y, wz(f, 9, 0), f.rot, s.seed);
    fill(cf, -1, 0, -1, 1, 0, 1, S(I("dark_oak_planks")));
    fillFn(cf, -1, 1, -1, 1, 3, 1, (a, y, b) => (Math.abs(a) === 1 && Math.abs(b) === 1 ? LOG : y === 3 ? S(I("dark_oak_planks")) : a === 0 && b === 0 ? 0 : FENCE));
    mob(cf, 0, 1, 0, "allay");
  }
  const tent = frame(w, wx(f, -9, 2), s.y, wz(f, -9, 2), f.rot, s.seed);
  fillFn(tent, -2, 1, -2, 2, 3, 2, (a, y) => (Math.abs(a) <= 3 - y ? (Math.abs(a) === 3 - y ? S(I("white_wool")) : 0) : -1));
  put(tent, 0, 1, 0, S(I("pumpkin")));
}
