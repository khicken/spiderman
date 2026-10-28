import type { WorldApi } from "../contracts";
import { idOf, metaOf } from "../contracts";
import { blockDef, BLOCKS, OPAQUE, SOLID } from "../blocks/registry";
import type { Particles } from "./particles";
import { warmEnoughToRain } from "../entities/light";

// Vanilla Block.animateTick particles, sampled like ClientLevel.doAnimateTick.
const enum K {
  None, Torch, WallTorch, SoulTorch, SoulWallTorch, RedTorch, RedWallTorch, Furnace, BlastFurnace, Smoker, Fire, Lava, Water, Candle, Table, Portal, Brewing,
  EndRod, Leaves, Cherry, EnderChest, SporeBlossom, Hive, CryingObsidian,
}

let kinds: Uint8Array | null = null;
const SHELF_RING: [number, number, number][] = [];
for (let y = 0; y <= 1; y++)
  for (let z = -2; z <= 2; z++)
    for (let x = -2; x <= 2; x++) if (Math.abs(x) === 2 || Math.abs(z) === 2) SHELF_RING.push([x, y, z]);
const HX = [0, -1, 0, 1], HZ = [1, 0, -1, 0];
const FX = [1, -1, 0, 0, 0, 0], FY = [0, 0, 1, -1, 0, 0], FZ = [0, 0, 0, 0, 1, -1];
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
    nether_portal: K.Portal, brewing_stand: K.Brewing, end_rod: K.EndRod, cherry_leaves: K.Cherry, ender_chest: K.EnderChest,
    spore_blossom: K.SporeBlossom, beehive: K.Hive, bee_nest: K.Hive, crying_obsidian: K.CryingObsidian,
  };
  BLOCKS.forEach((d, id) => {
    k[id] = by[d.name] ?? (d.tags?.includes("candles") ? K.Candle : d.tags?.includes("leaves") ? K.Leaves : K.None);
  });
  kinds = k;
  return k;
}

// Vanilla isRainingAt: raining, open to the sky and a rain (not snow) biome.
function rainingAt(world: WorldApi, rain: number, x: number, y: number, z: number) {
  if (rain <= 0.2 || world.topY(x, z) >= y) return false;
  const b = world.getBiome(x, z);
  return b.precipitation === "rain" && warmEnoughToRain(b.temperature, y);
}

export function animateBlock(world: WorldApi, fx: Particles, x: number, y: number, z: number, rain = 0) {
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
      fx.dripAt(x + r(), y - 1.05, z + r(), kind === K.Lava ? 1 : 0);
      return;
    }
    case K.EndRod: {
      const f = m < 6 ? m : 2;
      const d = 0.4 - (r() + r()) * 0.4;
      if (r() * 5 < 1) fx.endRod(x + 0.55 - r() * 0.1 + FX[f] * d, y + 0.55 - r() * 0.1 + FY[f] * d, z + 0.55 - r() * 0.1 + FZ[f] * d, gauss() * 0.005, gauss() * 0.005, gauss() * 0.005);
      return;
    }
    case K.Leaves:
    case K.Cherry: {
      const below = idOf(world.getBlock(x, y - 1, z));
      if (r() * 15 < 1 && (!OPAQUE[below] || !SOLID[below]) && rainingAt(world, rain, x, y + 1, z)) fx.dripAt(x + r(), y - 0.05, z + r(), 0);
      if (kind === K.Cherry && r() * 10 < 1 && !SOLID[below]) fx.petal(x + r(), y - 0.05, z + r());
      return;
    }
    case K.EnderChest:
      for (let i = 0; i < 3; i++) {
        const j = Math.floor(r() * 2) * 2 - 1, k = Math.floor(r() * 2) * 2 - 1;
        fx.portalAt(x + 0.5 + 0.25 * j, y + r(), z + 0.5 + 0.25 * k, r() * j, (r() - 0.5) * 0.125, r() * k);
      }
      return;
    case K.SporeBlossom:
      fx.sporeFall(x + r(), y + 0.7, z + r());
      for (let i = 0; i < 14; i++) {
        const ax = x + Math.floor(r() * 21) - 10, ay = y - Math.floor(r() * 10), az = z + Math.floor(r() * 21) - 10;
        const b = idOf(world.getBlock(ax, ay, az));
        if (!(SOLID[b] && OPAQUE[b])) fx.sporeAir(ax + r(), ay + r(), az + r());
      }
      return;
    case K.Hive: {
      if (!(m & 8) || r() < 0.3) return;
      const b = idOf(world.getBlock(x, y - 1, z));
      if ((SOLID[b] && OPAQUE[b]) || table()[b] === K.Water || table()[b] === K.Lava) return;
      fx.dripAt(x + r(), y - 0.05, z + r(), 2);
      return;
    }
    case K.CryingObsidian: {
      if (r() * 5 >= 1) return;
      const f = Math.floor(r() * 6);
      if (f === 2) return;
      const b = idOf(world.getBlock(x + FX[f], y + FY[f], z + FZ[f]));
      if (SOLID[b] && OPAQUE[b]) return;
      const ox = FX[f] === 0 ? r() : 0.5 + FX[f] * 0.6, oy = FY[f] === 0 ? r() : 0.5 + FY[f] * 0.6, oz = FZ[f] === 0 ? r() : 0.5 + FZ[f] * 0.6;
      fx.dripAt(x + ox, y + oy, z + oz, 3);
      return;
    }
  }
}

// Vanilla doAnimateTick: 667 samples within 16 and 667 within 32 blocks per client tick.
let acc = 0;
const gauss = () => Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(Math.PI * 2 * Math.random());

export function animateTick(world: WorldApi, fx: Particles, cx: number, cy: number, cz: number, dt: number, rain: number, biome?: (x: number, y: number, z: number) => void) {
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
      animateBlock(world, fx, x, y, z, rain);
      biome?.(x, y, z);
    }
  }
  if (acc > 0.1) acc = 0;
}
