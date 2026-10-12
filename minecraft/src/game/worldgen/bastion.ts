import { blockId as I } from "../blocks/registry";
import { chest, fill, fillFn, frame, mob, put, rnd, S, spawner, stairs } from "./build";
import { B } from "./ids";
import { createRng, idTable, type Writer } from "./rng";
import type { Start } from "./structure-grid";

const PBB = I("polished_blackstone_bricks"), CPBB = I("cracked_polished_blackstone_bricks"), GILD = I("gilded_blackstone"), BS = B.blackstone;
const PB = I("polished_blackstone"), CPB = I("chiseled_polished_blackstone"), BWALL = I("polished_blackstone_brick_wall"), BSTAIR = I("polished_blackstone_brick_stairs");
const BSLAB = I("polished_blackstone_brick_slab"), BASALT = I("polished_basalt"), CHAIN = I("chain");
const PASS = idTable(B.lava, B.fire);
const R = 18;

export function bastion(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const f = frame(w, s.x, s.y, s.z, r.int(4), s.seed);
  const treasure = r.chance(0.35);
  const brick = (x: number, y: number, z: number) => {
    const v = rnd(f, x, y, z);
    return S(v < 0.08 ? GILD : v < 0.3 ? CPBB : v < 0.45 ? BS : PBB);
  };
  for (const [a, b] of [[-R, -R], [R, -R], [-R, R], [R, R], [0, -R], [0, R], [-R, 0], [R, 0]]) {
    fillFn(f, a - 1, -40, b - 1, a + 1, -1, b + 1, (_a, _y, _b, x, wy, z) => {
      const c = w.get(x, wy, z);
      return c === 0 || PASS[c & 0xfff] ? S(BASALT) : -1;
    });
  }
  fillFn(f, -R, 0, -R, R, 22, R, (a, y, b, x, wy, z) => {
    const ea = Math.abs(a) === R, eb = Math.abs(b) === R;
    if (y === 0) return brick(x, wy, z);
    if (ea || eb) {
      if (y === 21) return (a + b) % 2 === 0 ? S(BWALL) : -1;
      if (y === 22) return -1;
      if (y <= 4 && (Math.abs(a) <= 1 || Math.abs(b) <= 1)) return 0;
      return brick(x, wy, z);
    }
    if (y === 7 || y === 14 || y === 20) {
      const hole = Math.abs(a) < 8 && Math.abs(b) < 8 && y !== 20 ? Math.abs(a) > 5 || Math.abs(b) > 5 : false;
      if (hole) return 0;
      return y === 20 ? S(PB) : rnd(f, x, wy, z) < 0.05 ? S(B.magma_block) : brick(x, wy, z);
    }
    if (y > 20) return -1;
    return 0;
  });
  for (const [a, b] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) fill(f, a - 1, 1, b - 1, a + 1, 19, b + 1, S(PBB));
  fillFn(f, -5, 7, -5, 5, 14, 5, (a, y, b, x, wy, z) => {
    const edge = Math.abs(a) === 5 || Math.abs(b) === 5;
    if (y === 7) return (a + b) % 3 === 0 ? S(B.gold_block) : S(PB);
    if (y === 14) return S(PBB);
    if (!edge) return 0;
    if (y <= 9 && (a === 0 || b === 0)) return 0;
    return y === 11 ? S(CPB) : brick(x, wy, z);
  });
  for (let k = 0; k < 7; k++) fill(f, 7 + k, k + 1, -2, 7 + k, k + 1, 2, stairs(f, BSTAIR, 3));
  for (let k = 0; k < 6; k++) fill(f, -7 - k, 8 + k, -2, -7 - k, 8 + k, 2, stairs(f, BSTAIR, 1));
  for (const [a, b] of [[-8, 0], [8, 0], [0, -8], [0, 8]]) {
    fill(f, a, 15, b, a, 19, b, S(CHAIN));
    put(f, a, 14, b, S(B.lantern, 1));
  }
  if (treasure) {
    fill(f, -2, 8, -2, 2, 8, 2, S(B.gold_block));
    chest(f, 0, 9, 0, 0, "bastion_treasure", B.chest);
    spawner(f, -3, 8, 3, "magma_cube", B.spawner);
    spawner(f, 3, 8, -3, "magma_cube", B.spawner);
    fill(f, -4, 8, -4, -4, 8, -4, S(B.lava));
  } else {
    chest(f, 0, 8, 0, 0, "bastion_other", B.chest);
    chest(f, -15, 1, 15, 0, "bastion_other", B.chest);
    chest(f, 15, 15, -15, 0, "bastion_other", B.chest);
    fill(f, -16, 1, -16, -14, 1, -14, S(B.gold_block));
  }
  fill(f, -R, 21, -R, R, 21, -R + 1, S(BSLAB));
  mob(f, 0, 1, 6, "piglin");
  mob(f, -6, 1, -4, "piglin");
  mob(f, 6, 8, 6, "piglin");
  mob(f, -9, 15, 9, "piglin");
  mob(f, 2, 8, -8, "piglin_brute");
  if (treasure) mob(f, -2, 8, 7, "piglin_brute");
  else mob(f, 10, 1, 10, "hoglin");
}
