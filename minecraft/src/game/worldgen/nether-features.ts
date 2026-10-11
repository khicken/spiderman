import { MIN_Y, stateOf } from "../contracts";
import { B } from "./ids";
import { hash01, hash32 } from "./noise";
import { NB, N_LEVELS, type NetherGen } from "./nether-gen";
import { createRng, idTable, type Writer } from "./rng";

const S = stateOf;
const rng = createRng();
const tr = createRng();
const prof = new Float32Array(N_LEVELS);
const AIR_ONLY = idTable();
AIR_ONLY[0] = 1;
const SOFT = idTable(B.crimson_roots, B.warped_roots, B.nether_sprouts, B.crimson_fungus, B.warped_fungus, B.fire, B.weeping_vines, B.weeping_vines_plant, B.twisting_vines, B.twisting_vines_plant);
SOFT[0] = 1;

const solid = (y: number) => {
  if (y <= 0 || y >= 127) return true;
  const k = y >> 3;
  return prof[k] + (prof[k + 1] - prof[k]) * ((y & 7) / 8) > 0;
};

function findFloor(g: NetherGen, x: number, z: number, from: number): number {
  g.profile(x, z, prof);
  for (let y = from; y > 31; y--) if (solid(y) && !solid(y + 1)) return y;
  return -1;
}

function findCeiling(g: NetherGen, x: number, z: number, from: number): number {
  g.profile(x, z, prof);
  for (let y = from; y < 126; y++) if (!solid(y) && solid(y + 1)) return y;
  return -1;
}

function hugeFungus(w: Writer, x: number, y: number, z: number, crimson: boolean) {
  const stem = S(crimson ? B.crimson_stem : B.warped_stem);
  const wart = S(crimson ? B.nether_wart_block : B.warped_wart_block);
  let h = 4 + tr.int(10);
  if (tr.chance(1 / 12)) h *= 2;
  for (let i = 0; i < h; i++) w.setIf(x, y + i, z, stem, SOFT);
  const capH = Math.min(h, 3 + tr.int(Math.max(1, Math.floor(h / 3))));
  for (let dy = 0; dy <= capH; dy++) {
    const yy = y + h - dy;
    const rad = dy === 0 ? 1 : dy < 2 ? 2 : 3;
    for (let dx = -rad; dx <= rad; dx++) {
      for (let dz = -rad; dz <= rad; dz++) {
        const edge = Math.abs(dx) === rad || Math.abs(dz) === rad;
        const corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
        if (corner && tr.chance(0.7)) continue;
        if (!edge && dy > 1 && !tr.chance(0.1)) continue;
        const r = tr.next();
        w.setIf(x + dx, yy, z + dz, r < 0.06 ? S(B.shroomlight) : wart, SOFT);
        if (crimson && edge && dy === capH && tr.chance(0.3)) {
          const len = 1 + tr.int(4);
          for (let k = 1; k <= len; k++) w.setIf(x + dx, yy - k, z + dz, S(k === len ? B.weeping_vines : B.weeping_vines_plant), AIR_ONLY);
        }
      }
    }
  }
  w.setIf(x, y + h, z, wart, SOFT);
}

function glowstone(w: Writer, x: number, y: number, z: number) {
  const n = 30 + tr.int(60);
  const g = S(B.glowstone);
  w.setIf(x, y, z, g, AIR_ONLY);
  let cx = x, cy = y, cz = z;
  for (let i = 0; i < n; i++) {
    const d = tr.int(6);
    if (d === 0) cx++;
    else if (d === 1) cx--;
    else if (d === 2) cz++;
    else if (d === 3) cz--;
    else cy--;
    if (Math.abs(cx - x) > 3 || Math.abs(cz - z) > 3 || y - cy > 9) {
      cx = x;
      cy = y;
      cz = z;
    }
    w.setIf(cx, cy, cz, g, AIR_ONLY);
  }
}

export function netherFeatures(g: NetherGen, w: Writer, biomes: Uint8Array) {
  const seed = g.seed;
  const cx = w.cx, cz = w.cz;
  for (let ocz = cz - 1; ocz <= cz + 1; ocz++) {
    for (let ocx = cx - 1; ocx <= cx + 1; ocx++) {
      const bx = ocx * 16, bz = ocz * 16;
      rng.seed(hash32(seed, ocx, ocz, 0x6105));
      for (let n = 0; n < 10; n++) {
        const x = bx + rng.int(16), z = bz + rng.int(16), y = 4 + rng.int(118);
        const ts = rng.int(0x7fffffff);
        if (x < w.ox - 3 || x > w.ox + 18 || z < w.oz - 3 || z > w.oz + 18) continue;
        const cy = findCeiling(g, x, z, y);
        if (cy < 0) continue;
        tr.seed(ts);
        glowstone(w, x, cy, z);
      }
      rng.seed(hash32(seed, ocx, ocz, 0xf0f0));
      for (let n = 0; n < 10; n++) {
        const x = bx + rng.int(16), z = bz + rng.int(16), y = 40 + rng.int(80);
        const ts = rng.int(0x7fffffff);
        if (x < w.ox - 4 || x > w.ox + 19 || z < w.oz - 4 || z > w.oz + 19) continue;
        const biome = g.biomeAt(x, z);
        if (biome !== NB.crimson && biome !== NB.warped) continue;
        const fy = findFloor(g, x, z, y);
        if (fy < 0) continue;
        tr.seed(ts);
        hugeFungus(w, x, fy + 1, z, biome === NB.crimson);
      }
    }
  }
  smallFeatures(g, w, biomes);
}

function smallFeatures(g: NetherGen, w: Writer, biomes: Uint8Array) {
  const seed = g.seed;
  const blocks = w.blocks;
  const at = (lx: number, y: number, lz: number) => ((y - MIN_Y) << 8) | (lz << 4) | lx;
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const x = w.ox + lx, z = w.oz + lz;
      const biome = biomes[(lz << 4) | lx];
      for (let y = 32; y < 122; y++) {
        const i = at(lx, y, lz);
        if (blocks[i] !== 0) continue;
        const below = blocks[i - 256] & 0xfff, above = blocks[i + 256] & 0xfff;
        const r = hash01(seed, x, y, z);
        if (below && below !== B.lava && !SOFT[below]) {
          if (biome === NB.crimson && below === B.crimson_nylium) {
            if (r < 0.2) blocks[i] = S(B.crimson_roots);
            else if (r < 0.24) blocks[i] = S(B.crimson_fungus);
          } else if (biome === NB.warped && below === B.warped_nylium) {
            if (r < 0.14) blocks[i] = S(B.warped_roots);
            else if (r < 0.28) blocks[i] = S(B.nether_sprouts);
            else if (r < 0.31) blocks[i] = S(B.warped_fungus);
            else if (r < 0.34) {
              const len = 1 + Math.floor(hash01(seed, z, y, x) * 8);
              for (let k = 0; k < len && blocks[at(lx, y + k, lz)] === 0; k++) blocks[at(lx, y + k, lz)] = S(k === len - 1 ? B.twisting_vines : B.twisting_vines_plant);
            }
          } else if (biome === NB.soul) {
            if (r < 0.01 && below === B.soul_soil) blocks[i] = S(B.soul_fire);
            else if (r > 0.997) {
              for (let k = 0; k < 40 && blocks[at(lx, y + k, lz)] === 0; k++) blocks[at(lx, y + k, lz)] = S(B.basalt);
            } else if (r > 0.99 && below === B.soul_sand && hash01(seed, x, y, z + 3) < 0.3) {
              blocks[i] = S(B.bone_block);
            }
          } else if (biome === NB.basalt) {
            if (r < 0.06) {
              const h = 1 + Math.floor(hash01(seed, z, y, x) * 5);
              for (let k = 0; k < h && blocks[at(lx, y + k, lz)] === 0; k++) blocks[at(lx, y + k, lz)] = S(B.basalt);
            } else if (r < 0.08 && lx > 0 && lx < 15 && lz > 0 && lz < 15) {
              blocks[i - 256] = S(B.lava);
              for (const d of [1, -1, 16, -16]) if (blocks[i - 256 + d] !== S(B.lava)) blocks[i - 256 + d] = S(B.magma_block);
            }
          } else if (biome === NB.wastes && below === B.netherrack) {
            if (r < 0.004) blocks[i] = S(B.fire);
            else if (r < 0.008) blocks[i] = S(r < 0.006 ? B.brown_mushroom : B.red_mushroom);
          }
        } else if (above && !SOFT[above] && above !== B.glowstone) {
          if (biome === NB.crimson && r < 0.05) {
            const len = 1 + Math.floor(hash01(seed, z, y, x) * 8);
            for (let k = 0; k < len && blocks[at(lx, y - k, lz)] === 0; k++) blocks[at(lx, y - k, lz)] = S(k === len - 1 ? B.weeping_vines : B.weeping_vines_plant);
          }
        }
      }
    }
  }
  const rr = createRng(hash32(seed, w.cx, w.cz, 0x1a7a));
  for (let n = 0; n < 16; n++) {
    const lx = 1 + rr.int(14), lz = 1 + rr.int(14), y = 8 + rr.int(112);
    const i = at(lx, y, lz);
    if (blocks[i] !== S(B.netherrack)) continue;
    let open = 0;
    for (const d of [1, -1, 16, -16]) if (blocks[i + d] === 0) open++;
    if (open === 1 && blocks[i + 256] !== 0 && blocks[i - 256] !== 0) blocks[i] = S(B.lava);
  }
}
