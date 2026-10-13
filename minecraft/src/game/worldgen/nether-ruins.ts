import { blockId as I } from "../blocks/registry";
import { chest, frame, put, rnd, S } from "./build";
import { B } from "./ids";
import { createRng, type Writer } from "./rng";
import type { Start } from "./structure-grid";

const PBB = I("polished_blackstone_bricks"), CPBB = I("cracked_polished_blackstone_bricks"), BSLAB = I("polished_blackstone_brick_slab");

// Vanilla ruined_portal_nether: the overworld ruin with blackstone in place of stone bricks, netherrack, magma and lava around it.
export function ruinedPortalNether(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const f = frame(w, s.x, s.y, s.z, r.int(4), s.seed);
  const big = r.chance(0.2);
  const wid = big ? 6 : 4, hei = big ? 8 : 5;
  const rad = big ? 8 : 6;
  for (let a = -rad; a <= rad + wid; a++) {
    for (let b = -rad; b <= rad; b++) {
      const d = Math.abs(a - wid / 2) + Math.abs(b);
      const x = s.x + a, z = s.z + b;
      const v = rnd(f, x, s.y, z);
      if (d > rad || v > 0.95 - d * 0.09) continue;
      const u = rnd(f, x, s.y - 1, z);
      put(f, a - 2, -1, b, S(u < 0.12 ? B.magma_block : u < 0.2 ? B.lava : u < 0.45 ? B.blackstone : B.netherrack));
      put(f, a - 2, -2, b, S(B.netherrack));
      if (u > 0.92 && d > 1) put(f, a - 2, 0, b, S(u > 0.97 ? BSLAB : u > 0.95 ? CPBB : PBB));
    }
  }
  for (let i = 0; i < wid; i++) {
    for (let j = 0; j < hei; j++) {
      const edge = i === 0 || i === wid - 1 || j === 0 || j === hei - 1;
      const x = s.x + i, y = s.y + j;
      if (!edge) {
        put(f, i - 2, j, 0, 0);
        continue;
      }
      if (j > 1 && rnd(f, x, y, s.z) < 0.3) continue;
      put(f, i - 2, j, 0, S(rnd(f, x, y, s.z + 1) < 0.2 ? B.crying_obsidian : B.obsidian));
    }
  }
  for (let k = 0; k < 3; k++) put(f, r.int(9) - 4, 0, r.int(5) + 2, S(B.obsidian));
  if (r.chance(0.3)) put(f, -3, 0, -2, S(B.gold_block));
  chest(f, wid - 1, 0, 2, 0, "ruined_portal", B.chest);
}
