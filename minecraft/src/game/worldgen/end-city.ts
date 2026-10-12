import { blockId as I } from "../blocks/registry";
import { chest, faceOf, fill, fillFn, frame, mob, put, S, stairs, wx, wz, type Frame } from "./build";
import { createRng, type Rng, type Writer } from "./rng";
import type { Start } from "./structure-grid";

const PUR = I("purpur_block"), PIL = I("purpur_pillar"), PST = I("purpur_stairs"), PSL = I("purpur_slab"), ESB = I("end_stone_bricks");
const ROD = I("end_rod"), GLASS = I("magenta_stained_glass"), CHEST = I("chest"), OBS = I("obsidian");

export function endCity(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const f = frame(w, s.x, s.y, s.z, r.int(4), s.seed);
  fill(f, -5, 0, -5, 5, 0, 5, S(ESB));
  fillFn(f, -5, -6, -5, 5, -1, 5, (_a, _y, _b, x, wy, z) => (w.get(x, wy, z) === 0 ? S(ESB) : -1));
  const floors = 3 + r.int(2);
  const top = tower(f, r, 0, 0, floors);
  fatTop(f, top);
  const side = r.chance(0.5) ? 1 : -1;
  const t2 = tower(f, r, 14 * side, 2, 2);
  fillFn(f, 3 * side, 10, 1, 11 * side, 10, 3, () => S(PUR));
  fill(f, 3 * side, 11, 1, 11 * side, 11, 1, S(PSL));
  fill(f, 3 * side, 11, 3, 11 * side, 11, 3, S(PSL));
  smallTop(f, 14 * side, t2, 2);
  ship(frame(w, wx(f, -side * 6, 22), s.y + top - 4, wz(f, -side * 6, 22), f.rot, s.seed));
}

function tower(f: Frame, r: Rng, a: number, b: number, floors: number): number {
  const H = 5;
  for (let k = 0; k < floors; k++) {
    const y0 = 1 + k * H;
    fillFn(f, a - 3, y0, b - 3, a + 3, y0 + H - 1, b + 3, (aa, y, bb) => {
      const da = Math.abs(aa - a), db = Math.abs(bb - b);
      if (da === 3 && db === 3) return S(PIL);
      if (y === y0 && k > 0) return da < 3 && db < 3 ? S(PUR) : S(PUR);
      if (da < 3 && db < 3) return 0;
      if (y === y0 + 2 && (da === 0 || db === 0)) return S(GLASS);
      return S(PUR);
    });
    for (let y = y0; y < y0 + H; y++) put(f, a, y, b + 2, S(I("ladder"), 2));
    put(f, a - 2, y0 + 3, b - 2, S(ROD));
    if (r.chance(0.6)) mob(f, a + 3, y0 + 2, b, "shulker");
  }
  fill(f, a, 1, b - 3, a, 2, b - 3, 0);
  return 1 + floors * H;
}

function fatTop(f: Frame, y0: number) {
  fillFn(f, -6, y0, -6, 6, y0 + 6, 6, (a, y, b) => {
    const ea = Math.abs(a) === 6, eb = Math.abs(b) === 6;
    if (y === y0) return S(PUR);
    if (y === y0 + 6) return ea || eb ? stairs(f, PST, ea ? (a > 0 ? 1 : 3) : b > 0 ? 2 : 0) : S(PUR);
    if (ea && eb) return S(PIL);
    if (ea || eb) return y === y0 + 3 && (a % 3 === 0 || b % 3 === 0) ? S(GLASS) : S(PUR);
    return 0;
  });
  put(f, 0, y0, 2, 0);
  chest(f, -4, y0 + 1, 4, 0, "end_city_treasure", CHEST);
  chest(f, 4, y0 + 1, 4, 0, "end_city_treasure", CHEST);
  for (const [a, b] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) put(f, a, y0 + 5, b, S(ROD));
  mob(f, 0, y0 + 1, -5, "shulker");
  mob(f, -5, y0 + 1, 0, "shulker");
  fill(f, 0, y0 + 7, 0, 0, y0 + 9, 0, S(PIL));
  put(f, 0, y0 + 10, 0, S(ROD));
}

function smallTop(f: Frame, a: number, y0: number, b: number) {
  fillFn(f, a - 4, y0, b - 4, a + 4, y0 + 1, b + 4, (aa, y, bb) => {
    const edge = Math.abs(aa - a) === 4 || Math.abs(bb - b) === 4;
    return y === y0 ? S(PUR) : edge ? S(PSL) : -1;
  });
  put(f, a, y0, b + 2, 0);
  chest(f, a + 2, y0 + 1, b - 2, 0, "end_city_treasure", CHEST);
  mob(f, a - 2, y0 + 1, b + 2, "shulker");
}

function ship(f: Frame) {
  fillFn(f, -4, 0, -12, 4, 9, 12, (a, y, b) => {
    const len = 12 - Math.max(0, 3 - y) * 2;
    const hw = y === 0 ? 1 : y === 1 ? 2 : y <= 4 ? 3 : 0;
    if (y <= 4) {
      if (Math.abs(b) > len || Math.abs(a) > hw) return -1;
      if (y === 0) return S(OBS);
      if (Math.abs(a) === hw || Math.abs(b) === len) return S(PUR);
      return y === 2 ? S(PUR) : 0;
    }
    if (a === 0 && (b === 0 || b === -6) && y <= 9) return S(PIL);
    if (y === 9 && b === 0 && Math.abs(a) <= 3) return S(PSL);
    if (y === 5 && Math.abs(a) === 3 && Math.abs(b) <= 10) return S(PSL);
    return -1;
  });
  put(f, 0, 3, 12, S(I("dragon_head"), 0));
  fill(f, -1, 5, -11, 1, 7, -8, S(PUR));
  fill(f, 0, 5, -10, 0, 6, -9, 0);
  const x = wx(f, 0, -11), z = wz(f, 0, -11);
  if (f.w.inside(x, z)) {
    const face = faceOf(f, 0);
    f.w.entities.push({ type: "item_frame", x: x + 0.5, y: f.y + 4, z: z + 0.5, data: { x, y: f.y + 4, z, face, item: { item: "elytra", count: 1 }, persistent: true } });
  }
  chest(f, -2, 3, -4, 0, "end_city_treasure", CHEST);
  chest(f, 2, 3, -4, 0, "end_city_treasure", CHEST);
  put(f, 0, 3, -2, S(I("brewing_stand")));
  mob(f, 0, 3, 8, "shulker");
  mob(f, 0, 3, -8, "shulker");
}
