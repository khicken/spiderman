import type { WorldApi } from "../contracts";
import { idOf, metaOf } from "../contracts";
import { blockDef, BLOCKS, OPAQUE, SOLID } from "../blocks/registry";
import type { Particles } from "./particles";

// Vanilla Block.animateTick particles, sampled like ClientLevel.doAnimateTick.
const enum K { None, Torch, WallTorch, SoulTorch, SoulWallTorch, RedTorch, RedWallTorch, Furnace, BlastFurnace, Smoker, Fire, Lava, Water, Candle, Table, Portal, Brewing }

let kinds: Uint8Array | null = null;
const SHELF_RING: [number, number, number][] = [];
for (let y = 0; y <= 1; y++)
  for (let z = -2; z <= 2; z++)
    for (let x = -2; x <= 2; x++) if (Math.abs(x) === 2 || Math.abs(z) === 2) SHELF_RING.push([x, y, z]);
const HX = [0, -1, 0, 1], HZ = [1, 0, -1, 0];
const FX = [1, -1, 0, 0, 0, 0], FZ = [0, 0, 0, 0, 1, -1];
const CANDLE_WICKS = [
  [[0.5, 0.5, 0.5]],
  [[0.375, 0.44, 0.5], [0.625, 0.5, 0.44]],
  [[0.5, 0.313, 0.625], [0.375, 0.44, 0.5], [0.56, 0.5, 0.44]],
  [[0.44, 0.313, 0.56], [0.625, 0.44, 0.56], [0.375, 0.44, 0.375], [0.56, 0.5, 0.375]],
];

function table(): Uint8Array {
  if (kinds) return kinds;
  const k = new Uint8Array(4096);
  const by: Record<string, K> = {
    torch: K.Torch, wall_torch: K.WallTorch, soul_torch: K.SoulTorch, soul_wall_torch: K.SoulWallTorch,
    redstone_torch: K.RedTorch, redstone_wall_torch: K.RedWallTorch, lit_furnace: K.Furnace, lit_blast_furnace: K.BlastFurnace,
    lit_smoker: K.Smoker, fire: K.Fire, soul_fire: K.Fire, lava: K.Lava, water: K.Water, enchanting_table: K.Table,
    nether_portal: K.Portal, brewing_stand: K.Brewing,
  };
  BLOCKS.forEach((d, id) => {
    k[id] = by[d.name] ?? (d.tags?.includes("candles") ? K.Candle : K.None);
  });
  kinds = k;
  return k;
}

export function animateBlock(world: WorldApi, fx: Particles, x: number, y: number, z: number) {
  const s = world.getBlock(x, y, z);
  const id = idOf(s);
  const kind = table()[id];
  if (kind === K.None) return;
  const r = Math.random;
  const m = metaOf(s);
  switch (kind) {
    case K.Torch:
    case K.SoulTorch:
      fx.smokeAt(x + 0.5, y + 0.7, z + 0.5, 0, 0, 0, 1);
      fx.flameAt(x + 0.5, y + 0.7, z + 0.5, kind === K.SoulTorch, 1);
      return;
    case K.WallTorch:
    case K.SoulWallTorch: {
      const f = (m - 1) & 3;
      const px = x + 0.5 - 0.27 * HX[f], py = y + 0.92, pz = z + 0.5 - 0.27 * HZ[f];
      fx.smokeAt(px, py, pz, 0, 0, 0, 1);
      fx.flameAt(px, py, pz, kind === K.SoulWallTorch, 1);
      return;
    }
    case K.RedTorch:
      fx.dustAt(x + 0.5 + (r() - 0.5) * 0.2, y + 0.7 + (r() - 0.5) * 0.2, z + 0.5 + (r() - 0.5) * 0.2, 0xff0000);
      return;
    case K.RedWallTorch: {
      const f = (m - 1) & 3;
      fx.dustAt(x + 0.5 + (r() - 0.5) * 0.2 - 0.27 * HX[f], y + 0.92 + (r() - 0.5) * 0.2, z + 0.5 + (r() - 0.5) * 0.2 - 0.27 * HZ[f], 0xff0000);
      return;
    }
    case K.Furnace:
    case K.BlastFurnace: {
      const f = m < 6 ? m : 4;
      const side = r() * 0.6 - 0.3;
      const px = x + 0.5 + (FX[f] !== 0 ? FX[f] * 0.52 : side), py = y + (r() * 6) / 16, pz = z + 0.5 + (FZ[f] !== 0 ? FZ[f] * 0.52 : side);
      fx.smokeAt(px, py, pz, 0, 0, 0, 1);
      if (kind === K.Furnace) fx.flameAt(px, py, pz, false, 1);
      return;
    }
    case K.Smoker:
      fx.smokeAt(x + 0.5, y + 1.1, z + 0.5, 0, 0, 0, 1);
      return;
    case K.Brewing:
      fx.smokeAt(x + 0.4 + r() * 0.2, y + 0.7 + r() * 0.3, z + 0.4 + r() * 0.2, 0, 0, 0, 1);
      return;
    case K.Fire:
      if (!SOLID[idOf(world.getBlock(x, y - 1, z))]) return;
      for (let i = 0; i < 3; i++) fx.smokeAt(x + r(), y + r() * 0.5 + 0.5, z + r(), 0, 0, 0, 2.5);
      return;
    case K.Candle: {
      if (!(m & 4)) return;
      for (const w of CANDLE_WICKS[m & 3]) {
        if (r() < 0.3) fx.smokeAt(x + w[0], y + w[1], z + w[2], 0, 0, 0, 1);
        fx.flameAt(x + w[0], y + w[1], z + w[2], false, 0.5);
      }
      return;
    }
    case K.Table:
      for (const o of SHELF_RING) {
        if (r() * 16 >= 1) continue;
        if (blockDef(world.getBlock(x + o[0], y + o[1], z + o[2])).name !== "bookshelf") continue;
        if (SOLID[idOf(world.getBlock(x + (o[0] >> 1), y + o[1], z + (o[2] >> 1)))]) continue;
        fx.enchant(x + 0.5, y + 2, z + 0.5, o[0] + r() - 0.5, o[1] - r() - 1, o[2] + r() - 0.5);
      }
      return;
    case K.Portal:
      for (let i = 0; i < 4; i++) {
        let px = x + r(), pz = z + r(), vx = (r() - 0.5) * 0.5, vz = (r() - 0.5) * 0.5;
        const py = y + r(), vy = (r() - 0.5) * 0.5, j = Math.floor(r() * 2) * 2 - 1;
        if (idOf(world.getBlock(x - 1, y, z)) !== id && idOf(world.getBlock(x + 1, y, z)) !== id) { px = x + 0.5 + 0.25 * j; vx = r() * 2 * j; }
        else { pz = z + 0.5 + 0.25 * j; vz = r() * 2 * j; }
        fx.portalAt(px, py, pz, vx, vy, vz);
      }
      return;
    case K.Lava:
    case K.Water: {
      if (kind === K.Lava && r() * 100 < 1 && idOf(world.getBlock(x, y + 1, z)) === 0) fx.lavaPop(x + r(), y + 1, z + r());
      if (r() * 10 >= 1) return;
      const below = idOf(world.getBlock(x, y - 1, z));
      if (!OPAQUE[below] || !SOLID[below]) return;
      const under = idOf(world.getBlock(x, y - 2, z));
      if (SOLID[under] || table()[under] === K.Water || table()[under] === K.Lava) return;
      fx.dripAt(x + r(), y - 1.05, z + r(), kind === K.Lava);
      return;
    }
  }
}

// Vanilla doAnimateTick: 667 samples within 16 and 667 within 32 blocks per client tick.
let acc = 0;
export function animateTick(world: WorldApi, fx: Particles, cx: number, cy: number, cz: number, dt: number, biome?: (x: number, y: number, z: number) => void) {
  acc += dt;
  let ticks = 0;
  while (acc >= 0.05 && ticks < 2) {
    acc -= 0.05;
    ticks++;
    const bx = Math.floor(cx), by = Math.floor(cy), bz = Math.floor(cz);
    for (let n = 0; n < 1334; n++) {
      const r = n & 1 ? 32 : 16;
      const x = bx + Math.floor(Math.random() * r) - Math.floor(Math.random() * r);
      const y = by + Math.floor(Math.random() * r) - Math.floor(Math.random() * r);
      const z = bz + Math.floor(Math.random() * r) - Math.floor(Math.random() * r);
      animateBlock(world, fx, x, y, z);
      biome?.(x, y, z);
    }
  }
  if (acc > 0.1) acc = 0;
}
