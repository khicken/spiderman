import { blockId as I } from "../blocks/registry";
import { chest, fill, fillFn, frame, hz, mob, put, S, stairs, type Frame } from "./build";
import { B } from "./ids";
import { createRng, type Rng, type Writer } from "./rng";
import type { Start } from "./structure-grid";
import { underfill } from "./temples";

const HW = 21, D = 34, FH = 7;

export function mansion(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const f = frame(w, s.x, s.y, s.z - (D >> 1), r.int(4), s.seed);
  const LOG = S(I("dark_oak_log")), PL = S(I("dark_oak_planks")), COB = S(B.cobblestone), BIRCH = S(B.birch_planks), GLASS = S(B.glass_pane);
  underfill(f, -HW, 0, HW, D, COB, -1, 20);
  fill(f, -HW, 0, 0, HW, 0, D, COB);
  fill(f, -HW - 2, 1, -3, HW + 2, 2 * FH + 12, D + 2, 0);
  for (let fl = 0; fl < 2; fl++) {
    const y0 = fl * FH;
    fillFn(f, -HW, y0, 0, HW, y0 + FH, D, (a, y, b) => {
      const ea = Math.abs(a) === HW, eb = b === 0 || b === D;
      const ly = y - y0;
      if (ly === 0) return ea || eb ? LOG : fl === 0 ? BIRCH : PL;
      if (ly === FH) return fl === 1 ? (ea || eb ? LOG : PL) : -1;
      if (!ea && !eb) return 0;
      const t = ea ? b : a + HW;
      if (t % 6 === 0) return LOG;
      if ((ly === 2 || ly === 3) && t % 3 !== 0) return GLASS;
      return PL;
    });
  }
  roof(f);
  fill(f, -1, 1, 0, 1, 3, 0, 0);
  put(f, -1, 1, 0, S(I("dark_oak_door"), hz(f, 0)));
  put(f, -1, 2, 0, S(I("dark_oak_door"), 8));
  put(f, 1, 1, 0, S(I("dark_oak_door"), hz(f, 0)));
  put(f, 1, 2, 0, S(I("dark_oak_door"), 8));
  fill(f, -2, 0, -2, 2, 0, -1, COB);
  fill(f, -2, 0, -3, 2, 0, -3, stairs(f, B.cobblestone_stairs, 0));
  for (let fl = 0; fl < 2; fl++) {
    const y0 = fl * FH;
    fillFn(f, -HW + 1, y0 + 1, 1, HW - 1, y0 + FH - 1, D - 1, (a, _y, b) => {
      if (Math.abs(a) === 2 && b < D - 7) return (b - 1) % 8 === 4 && _y - y0 <= 2 ? 0 : PL;
      if (Math.abs(a) > 2 && (b - 1) % 8 === 0 && b > 1) return PL;
      if (Math.abs(a) <= 1 && _y === y0 + 1) return S(I(fl === 0 ? "red_carpet" : "gray_carpet"));
      return -1;
    });
    for (let b = 4; b < D - 6; b += 8) put(f, 0, y0 + FH - 1, b, S(B.lantern, 1));
    let k = 0;
    for (let b = 1; b + 8 <= D - 7; b += 8) {
      for (const side of [-1, 1]) room(f, createRng(s.seed + fl * 100 + k++), side, y0, b, fl);
    }
  }
  for (let k = 0; k < FH - 1; k++) fill(f, -1, k + 1, D - 7 + k, 1, k + 1, D - 7 + k, stairs(f, B.oak_stairs, 0));
  fill(f, -1, FH, D - 7, 1, FH, D - 1, 0);
  mob(f, 0, 1, 3, "vindicator");
  mob(f, 4, 1, D - 3, "vindicator");
  mob(f, -4, FH + 1, D - 3, "evoker");
  mob(f, 0, FH + 1, 10, "vindicator");
  mob(f, 6, FH + 1, 5, "evoker");
}

function room(f: Frame, r: Rng, side: number, y0: number, b0: number, fl: number) {
  const a0 = side < 0 ? -HW + 1 : 3, a1 = side < 0 ? -3 : HW - 1;
  const b1 = b0 + 7;
  const kind = r.int(6);
  const ca = (a0 + a1) >> 1, cb = b0 + 4;
  if (kind === 0) {
    fill(f, a0 + 1, y0 + 1, b0 + 2, a1 - 1, y0 + 1, b1 - 2, S(I("white_carpet")));
    for (let k = 0; k < 2; k++) {
      put(f, a0 + 1 + k * 3, y0 + 1, b0 + 1, S(I("white_bed"), hz(f, 0)));
      put(f, a0 + 1 + k * 3, y0 + 1, b0 + 2, S(I("white_bed"), hz(f, 0) | 4));
    }
    chest(f, a1 - 1, y0 + 1, b1 - 1, 2, "woodland_mansion", B.chest);
  } else if (kind === 1) {
    fillFn(f, a0, y0 + 1, b0 + 1, a1, y0 + 4, b1 - 1, (a, _y, b) => (a === a0 || a === a1 || b === b0 + 1 || b === b1 - 1) && Math.abs(a) > 3 ? S(I("bookshelf")) : -1);
    put(f, ca, y0 + 1, cb, S(I("lectern")));
  } else if (kind === 2) {
    fill(f, a0 + 2, y0 + 1, cb - 1, a1 - 2, y0 + 1, cb + 1, S(B.oak_fence));
    fill(f, a0 + 2, y0 + 2, cb - 1, a1 - 2, y0 + 2, cb + 1, S(I("dark_oak_pressure_plate")));
    put(f, a0 + 1, y0 + 1, cb, stairs(f, B.oak_stairs, 1));
  } else if (kind === 3) {
    for (let k = 0; k < 3; k++) chest(f, a0 + 1 + k, y0 + 1, b1 - 1, 2, "woodland_mansion", B.chest);
    fill(f, a1 - 1, y0 + 1, b0 + 1, a1 - 1, y0 + 2, b0 + 2, S(I("cobweb")));
  } else if (kind === 4) {
    for (let a = a0 + 1; a < a1; a += 2) put(f, a, y0 + 1, b0 + 1, S(I(r.chance(0.5) ? "potted_white_tulip" : "potted_allium")));
    fill(f, ca - 1, y0, cb - 1, ca + 1, y0, cb + 1, S(B.grass_block));
    put(f, ca, y0 + 1, cb, S(I("birch_sapling")));
  } else {
    fill(f, ca - 1, y0 + 1, cb - 1, ca + 1, y0 + 3, cb + 1, S(I("white_wool")));
    fill(f, ca, y0 + 4, cb, ca, y0 + 4, cb, S(fl ? B.cobblestone : I("diamond_block")));
  }
  put(f, ca, y0 + FH - 1, cb, S(B.lantern, 1));
}

function roof(f: Frame) {
  const y0 = 2 * FH;
  const ST = I("dark_oak_stairs");
  for (let k = 0; k <= 8; k++) {
    const y = y0 + 1 + k;
    const a0 = -HW - 1 + k, a1 = HW + 1 - k, b0 = -1 + k, b1 = D + 1 - k;
    if (a0 >= a1 || b0 >= b1) break;
    fillFn(f, a0, y, b0, a1, y, b1, (a, _y, b) => {
      if (a === a0) return stairs(f, ST, 3);
      if (a === a1) return stairs(f, ST, 1);
      if (b === b0) return stairs(f, ST, 0);
      if (b === b1) return stairs(f, ST, 2);
      return k === 8 ? S(I("dark_oak_planks")) : -1;
    });
  }
  fill(f, -HW + 8, y0 + 9, 8, HW - 8, y0 + 9, D - 8, S(I("dark_oak_planks")));
}
