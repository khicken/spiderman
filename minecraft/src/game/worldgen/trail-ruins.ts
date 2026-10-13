import { blockId as I } from "../blocks/registry";
import { fillFn, frame, rnd, S, wx, wz, type Frame } from "./build";
import { hash01 } from "./noise";
import { createRng, type Writer } from "./rng";
import type { Start } from "./structure-grid";

const TERRACOTTA = ["terracotta", "yellow_terracotta", "orange_terracotta", "light_gray_terracotta", "brown_terracotta", "blue_terracotta", "light_blue_terracotta", "red_terracotta", "white_terracotta"];
const WALL = ["mud_bricks", "mud_bricks", "packed_mud", "bricks", "cobblestone", "mossy_cobblestone"];

function brushCell(f: Frame, x: number, y: number, z: number, rare: boolean) {
  f.w.set(x, y, z, S(I("suspicious_gravel")));
  f.w.blockEntities.push({ x, y, z, type: "brushable", data: { loot: rare ? "trail_ruins_rare" : "trail_ruins_common" } });
}

// One buried room: decayed walls of mud bricks and terracotta, a gravel floor seeded with suspicious gravel.
function ruinRoom(f: Frame, a0: number, b0: number, size: number, height: number, rare: number) {
  const a1 = a0 + size - 1, b1 = b0 + size - 1;
  const ter = S(I(TERRACOTTA[Math.floor(hash01(f.seed, a0, 7, b0) * TERRACOTTA.length)]));
  fillFn(f, a0, -1, b0, a1, height, b1, (a, y, b, x, wy, z) => {
    const edge = a === a0 || a === a1 || b === b0 || b === b1;
    const h = rnd(f, x, wy, z);
    if (y === -1) return S(I(h < 0.5 ? "gravel" : "packed_mud"));
    if (y === 0) {
      if (edge) return S(I(WALL[Math.floor(h * WALL.length)]));
      if (h < 0.14) {
        brushCell(f, x, wy, z, hash01(f.seed, x, wy + 1, z) < rare);
        return -1;
      }
      return S(I(h < 0.6 ? "gravel" : h < 0.8 ? "dirt" : "coarse_dirt"));
    }
    if (!edge) return y <= 2 && h < 0.08 ? S(I("gravel")) : -1;
    if (h < 0.18 + y * 0.12) return -1;
    if (y === height) return ter;
    return S(I(h < 0.55 ? WALL[Math.floor(h * 11) % WALL.length] : TERRACOTTA[Math.floor(h * 97) % TERRACOTTA.length]));
  });
}

// Vanilla trail ruins: a buried cluster of rooms and a tower whose top breaks the surface.
export function trailRuins(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const depth = 8 + r.int(5);
  const f = frame(w, s.x, s.y - depth, s.z, r.int(4), s.seed);
  const rooms = 3 + r.int(3);
  for (let i = 0; i < rooms; i++) {
    const size = 5 + r.int(4);
    const a = i === 0 ? -3 : r.int(25) - 14, b = i === 0 ? -3 : r.int(25) - 14;
    ruinRoom(f, a, b, size, 2 + r.int(3), 0.08);
  }
  const ta = r.int(9) - 4, tb = r.int(9) - 4;
  const tower = S(I("mud_bricks")), ter = S(I(TERRACOTTA[r.int(TERRACOTTA.length)]));
  fillFn(f, ta - 2, 0, tb - 2, ta + 2, depth + 2, tb + 2, (a, y, b, x, wy, z) => {
    const edge = Math.abs(a - ta) === 2 || Math.abs(b - tb) === 2;
    const h = rnd(f, x, wy, z);
    if (y === 0 && !edge) {
      if (h < 0.3) {
        brushCell(f, x, wy, z, hash01(f.seed, x, wy + 3, z) < 0.25);
        return -1;
      }
      return S(I("gravel"));
    }
    if (!edge) return y < depth - 1 ? S(I(h < 0.7 ? "dirt" : "gravel")) : -1;
    if (y > depth && h < 0.5) return -1;
    return y % 4 === 3 ? ter : tower;
  });
  const cx = wx(f, ta, tb), cz = wz(f, ta, tb);
  if (w.inside(cx, cz) && r.chance(0.5)) brushCell(f, cx, f.y + depth - 2, cz, true);
}
