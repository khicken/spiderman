import { MIN_Y, stateOf } from "../contracts";
import { B } from "./ids";
import { hash32 } from "./noise";
import type { ChunkCtx } from "./overworld";
import { createRng, idTable } from "./rng";

// Legacy worm caves and canyons. Each origin chunk within RANGE runs its own walk; only this chunk's blocks change.
const RANGE = 8;
const rng = createRng();

const CARVABLE = idTable(
  B.stone, B.deepslate, B.dirt, B.grass_block, B.coarse_dirt, B.podzol, B.mycelium, B.sand, B.red_sand, B.sandstone, B.gravel,
  B.terracotta, B.white_terracotta, B.orange_terracotta, B.yellow_terracotta, B.brown_terracotta, B.red_terracotta, B.light_gray_terracotta,
  B.calcite, B.tuff, B.granite, B.diorite, B.andesite, B.snow_block, B.packed_ice, B.powder_snow, B.mud, B.clay,
);
const WATER = stateOf(B.water), LAVA = stateOf(B.lava), GRASS = stateOf(B.grass_block), DIRT = B.dirt;

let blocks: Uint16Array;
let caveMask: Uint8Array;
let ox = 0, oz = 0;

function carveBlock(lx: number, y: number, lz: number) {
  const i = ((y - MIN_Y) << 8) | (lz << 4) | lx;
  const b = blocks[i];
  if (!CARVABLE[b & 0xfff]) return;
  if (y < 319 && blocks[i + 256] === WATER) return;
  if (lx > 0 && blocks[i - 1] === WATER) return;
  if (lx < 15 && blocks[i + 1] === WATER) return;
  if (lz > 0 && blocks[i - 16] === WATER) return;
  if (lz < 15 && blocks[i + 16] === WATER) return;
  blocks[i] = y <= -55 ? LAVA : 0;
  caveMask[i] = 1;
  if ((b & 0xfff) === B.grass_block || (b & 0xfff) === B.mycelium) {
    const below = i - 256;
    if (y > MIN_Y + 1 && (blocks[below] & 0xfff) === DIRT) blocks[below] = GRASS;
  }
}

function ellipsoid(cx: number, cy: number, cz: number, rh: number, rv: number, floor: number) {
  const x0 = Math.max(Math.floor(cx - rh) - ox, 0), x1 = Math.min(Math.floor(cx + rh) - ox, 15);
  const z0 = Math.max(Math.floor(cz - rh) - oz, 0), z1 = Math.min(Math.floor(cz + rh) - oz, 15);
  if (x0 > x1 || z0 > z1) return;
  const y0 = Math.max(Math.floor(cy - rv), MIN_Y + 1), y1 = Math.min(Math.floor(cy + rv), 300);
  for (let lx = x0; lx <= x1; lx++) {
    const dx = (lx + ox + 0.5 - cx) / rh;
    for (let lz = z0; lz <= z1; lz++) {
      const dz = (lz + oz + 0.5 - cz) / rh;
      const dxz = dx * dx + dz * dz;
      if (dxz >= 1) continue;
      for (let y = y1; y >= y0; y--) {
        const dy = (y + 0.5 - cy) / rv;
        if (dy <= floor || dxz + dy * dy >= 1) continue;
        carveBlock(lx, y, lz);
      }
    }
  }
}

function tunnel(seedv: number, x: number, y: number, z: number, width: number, yaw: number, pitch: number, start: number, len: number, vScale: number) {
  const r = createRng(seedv);
  const branch = r.int(len / 2) + len / 4;
  const steep = r.int(6) === 0;
  let dYaw = 0, dPitch = 0;
  const midX = ox + 8, midZ = oz + 8;
  for (let i = start; i < len; i++) {
    const rh = 1.5 + Math.sin((Math.PI * i) / len) * width;
    const rv = rh * vScale;
    const cp = Math.cos(pitch);
    x += Math.cos(yaw) * cp;
    y += Math.sin(pitch);
    z += Math.sin(yaw) * cp;
    pitch *= steep ? 0.92 : 0.7;
    pitch += dPitch * 0.1;
    yaw += dYaw * 0.1;
    dPitch = dPitch * 0.9 + (r.next() - r.next()) * r.next() * 2;
    dYaw = dYaw * 0.75 + (r.next() - r.next()) * r.next() * 4;
    if (i === branch && width > 1) {
      tunnel(r.int(0x7fffffff), x, y, z, r.next() * 0.5 + 0.5, yaw - Math.PI / 2, pitch / 3, i, len, 1);
      tunnel(r.int(0x7fffffff), x, y, z, r.next() * 0.5 + 0.5, yaw + Math.PI / 2, pitch / 3, i, len, 1);
      return;
    }
    if (r.int(4) === 0) continue;
    const dx = x - midX, dz = z - midZ;
    const left = len - i, reach = width + 18;
    if (dx * dx + dz * dz - left * left > reach * reach) return;
    if (Math.abs(dx) > 8 + rh * 2 || Math.abs(dz) > 8 + rh * 2) continue;
    ellipsoid(x, y, z, rh, rv, -0.7);
  }
}

function canyon(seedv: number, x: number, y: number, z: number, width: number, yaw: number, pitch: number, len: number) {
  const r = createRng(seedv);
  const rs = new Float32Array(256);
  let f = 1;
  for (let i = 0; i < 256; i++) {
    if (i === 0 || r.int(3) === 0) f = 1 + r.next() * r.next();
    rs[i] = f * f;
  }
  let dYaw = 0, dPitch = 0;
  const midX = ox + 8, midZ = oz + 8;
  for (let i = 0; i < len; i++) {
    const rh = 1.5 + Math.sin((Math.PI * i) / len) * width;
    const rv = rh * 3 * (r.next() * 0.25 + 0.75);
    const cp = Math.cos(pitch);
    x += Math.cos(yaw) * cp;
    y += Math.sin(pitch);
    z += Math.sin(yaw) * cp;
    pitch *= 0.7;
    pitch += dPitch * 0.05;
    yaw += dYaw * 0.05;
    dPitch = dPitch * 0.8 + (r.next() - r.next()) * r.next() * 2;
    dYaw = dYaw * 0.5 + (r.next() - r.next()) * r.next() * 4;
    if (r.int(4) === 0) continue;
    const dx = x - midX, dz = z - midZ;
    if (Math.abs(dx) > 8 + rh * 2 || Math.abs(dz) > 8 + rh * 2) continue;
    const x0 = Math.max(Math.floor(x - rh) - ox, 0), x1 = Math.min(Math.floor(x + rh) - ox, 15);
    const z0 = Math.max(Math.floor(z - rh) - oz, 0), z1 = Math.min(Math.floor(z + rh) - oz, 15);
    const y0 = Math.max(Math.floor(y - rv), MIN_Y + 1), y1 = Math.min(Math.floor(y + rv), 300);
    for (let lx = x0; lx <= x1; lx++) {
      const ddx = (lx + ox + 0.5 - x) / rh;
      for (let lz = z0; lz <= z1; lz++) {
        const ddz = (lz + oz + 0.5 - z) / rh;
        const dxz = ddx * ddx + ddz * ddz;
        if (dxz >= 1) continue;
        for (let yy = y1; yy >= y0; yy--) {
          const dy = (yy + 0.5 - y) / rv;
          if (dxz * rs[(yy - MIN_Y) & 255] + (dy * dy) / 6 >= 1) continue;
          carveBlock(lx, yy, lz);
        }
      }
    }
  }
}

export function carve(ctx: ChunkCtx) {
  blocks = ctx.blocks;
  caveMask = ctx.cave;
  ox = ctx.cx * 16;
  oz = ctx.cz * 16;
  const seed = ctx.g.seed;
  for (let ocx = ctx.cx - RANGE; ocx <= ctx.cx + RANGE; ocx++) {
    for (let ocz = ctx.cz - RANGE; ocz <= ctx.cz + RANGE; ocz++) {
      rng.seed(hash32(seed, ocx, ocz, 0xca7e));
      if (rng.next() < 0.14) {
        const n = rng.int(rng.int(rng.int(15) + 1) + 1);
        for (let k = 0; k < n; k++) {
          const x = ocx * 16 + rng.int(16);
          const y = -56 + rng.int(rng.int(180) + 8);
          const z = ocz * 16 + rng.int(16);
          let tunnels = 1;
          if (rng.int(4) === 0) {
            const rr = 1 + rng.next() * 6;
            if (Math.abs(x - ox - 8) < 24 && Math.abs(z - oz - 8) < 24) ellipsoid(x + 1, y, z, 1.5 + rr, (1.5 + rr) * 0.5, -0.7);
            tunnels += rng.int(4);
          }
          for (let j = 0; j < tunnels; j++) {
            const yaw = rng.next() * Math.PI * 2;
            const pitch = (rng.next() - 0.5) / 4;
            let width = rng.next() * 2 + rng.next();
            if (rng.int(10) === 0) width *= rng.next() * rng.next() * 3 + 1;
            const len = RANGE * 16 - 16 - rng.int(28);
            tunnel(rng.int(0x7fffffff), x, y, z, width, yaw, pitch, 0, len, 1);
          }
        }
      }
      rng.seed(hash32(seed, ocx, ocz, 0xca70));
      if (rng.next() < 0.02) {
        const x = ocx * 16 + rng.int(16);
        const y = 10 + rng.int(58);
        const z = ocz * 16 + rng.int(16);
        const yaw = rng.next() * Math.PI * 2;
        const pitch = (rng.next() - 0.5) / 4;
        const width = (rng.next() * 2 + rng.next()) * 2;
        canyon(rng.int(0x7fffffff), x, y, z, width, yaw, pitch, RANGE * 16 - 16 - rng.int(28));
      }
    }
  }
}
