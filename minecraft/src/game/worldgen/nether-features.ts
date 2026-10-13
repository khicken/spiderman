import { stateOf } from "../contracts";
import { B } from "./ids";
import { hash32 } from "./noise";
import { NB, N_LEVELS, type NetherGen } from "./nether-gen";
import { createRng, idTable, type Rng, type Writer } from "./rng";
import { deltaFeatures, soulValleyFeatures } from "./nether-deltas";
import { springs } from "./nether-springs";

const S = stateOf;
const rng = createRng();
export const tr = createRng();
const prof = new Float32Array(N_LEVELS);
export const AIR_ONLY = idTable();
AIR_ONLY[0] = 1;
export const SOFT = idTable(B.crimson_roots, B.warped_roots, B.nether_sprouts, B.crimson_fungus, B.warped_fungus, B.fire, B.soul_fire, B.weeping_vines, B.weeping_vines_plant, B.twisting_vines, B.twisting_vines_plant, B.brown_mushroom, B.red_mushroom);
SOFT[0] = 1;
const ROOF = idTable(B.netherrack, B.nether_wart_block);
const TWIST_BASE = idTable(B.netherrack, B.warped_nylium, B.warped_wart_block);
const GLOW_ROOF = idTable(B.netherrack, B.basalt, B.blackstone);
const NYLIUM = idTable(B.crimson_nylium, B.warped_nylium);
const PLANT_BASE = idTable(B.crimson_nylium, B.warped_nylium, B.soul_soil);
const LAVA = S(B.lava);
const RACK = S(B.netherrack);

let colX = NaN, colZ = NaN, colG: NetherGen | null = null;
export function rockAt(g: NetherGen, x: number, y: number, z: number): boolean {
  if (y <= 0 || y >= 127) return true;
  if (x !== colX || z !== colZ || g !== colG) {
    g.profile(x, z, prof);
    colX = x;
    colZ = z;
    colG = g;
  }
  const k = y >> 3;
  return prof[k] + (prof[k + 1] - prof[k]) * ((y & 7) / 8) > 0;
}

// Real blocks inside the chunk, the noise terrain outside it, so features that cross chunk borders agree.
export function blockAt(g: NetherGen, w: Writer, x: number, y: number, z: number): number {
  if (y < 0 || y > 127) return 0;
  const s = w.get(x, y, z);
  if (s >= 0) return s;
  return rockAt(g, x, y, z) ? RACK : y <= 31 ? LAVA : 0;
}

const floors = new Int16Array(64);
export function floorsOf(g: NetherGen, x: number, z: number): number {
  let n = 0;
  for (let y = 126; y > 31 && n < 64; y--) if (!rockAt(g, x, y, z) && rockAt(g, x, y - 1, z)) floors[n++] = y;
  return n;
}

// Vanilla CountOnEveryLayerPlacement: `count` random columns per floor layer, top layer first.
export function everyLayer(g: NetherGen, w: Writer, ocx: number, ocz: number, salt: number, count: number, margin: number, fn: (x: number, y: number, z: number) => void) {
  rng.seed(hash32(g.seed, ocx, ocz, salt));
  const bx = ocx * 16, bz = ocz * 16;
  for (let layer = 0; layer < 16; layer++) {
    let any = false;
    for (let i = 0; i < count; i++) {
      const x = bx + rng.int(16), z = bz + rng.int(16), ts = rng.int(0x7fffffff);
      const n = floorsOf(g, x, z);
      if (layer >= n) continue;
      any = true;
      if (x < w.ox - margin || x > w.ox + 15 + margin || z < w.oz - margin || z > w.oz + 15 + margin) continue;
      tr.seed(ts);
      fn(x, floors[layer], z);
    }
    if (!any) break;
  }
}

export function scatter(g: NetherGen, w: Writer, salt: number, count: (r: Rng) => number, y0: number, y1: number, margin: number, fn: (x: number, y: number, z: number) => void) {
  for (let ocz = w.cz - 1; ocz <= w.cz + 1; ocz++) {
    for (let ocx = w.cx - 1; ocx <= w.cx + 1; ocx++) {
      rng.seed(hash32(g.seed, ocx, ocz, salt));
      const n = count(rng);
      for (let i = 0; i < n; i++) {
        const x = ocx * 16 + rng.int(16), z = ocz * 16 + rng.int(16), y = y0 + rng.int(y1 - y0 + 1), ts = rng.int(0x7fffffff);
        if (x < w.ox - margin || x > w.ox + 15 + margin || z < w.oz - margin || z > w.oz + 15 + margin) continue;
        tr.seed(ts);
        fn(x, y, z);
      }
    }
  }
}

const weepColumn = (w: Writer, g: NetherGen, x: number, y: number, z: number, len: number) => {
  for (let k = 0; k < len; k++) {
    if (blockAt(g, w, x, y - k, z) !== 0) break;
    const last = k === len - 1 || blockAt(g, w, x, y - k - 1, z) !== 0;
    w.setIf(x, y - k, z, S(last ? B.weeping_vines : B.weeping_vines_plant), AIR_ONLY);
    if (last) break;
  }
};

function hatBlock(w: Writer, g: NetherGen, x: number, y: number, z: number, wart: number, decor: number, hat: number, vine: number) {
  const a = tr.next(), b = tr.next(), c = tr.next(), len = 1 + tr.int(5), dbl = tr.int(7) === 0;
  if (a < decor) w.setIf(x, y, z, S(B.shroomlight), SOFT);
  else if (b < hat) {
    w.setIf(x, y, z, wart, SOFT);
    if (c < vine) weepColumn(w, g, x, y - 1, z, dbl ? len * 2 : len);
  }
}

function hugeFungus(g: NetherGen, w: Writer, x: number, y: number, z: number, crimson: boolean) {
  const stem = S(crimson ? B.crimson_stem : B.warped_stem);
  const wart = S(crimson ? B.nether_wart_block : B.warped_wart_block);
  let h = 4 + tr.int(10);
  if (tr.int(12) === 0) h *= 2;
  if (y + h + 1 >= 127) return;
  const thick = tr.next() < 0.06;
  const r = thick ? 1 : 0;
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      const corner = thick && dx !== 0 && dz !== 0;
      for (let k = 0; k < h; k++) {
        const skip = tr.next() < 0.1;
        if (corner && skip) continue;
        w.setIf(x + dx, y + k, z + dz, stem, SOFT);
      }
    }
  }
  const hatH = Math.min(tr.int(1 + Math.floor(h / 3)) + 5, h);
  const j = h - hatH;
  for (let l = j; l <= h; l++) {
    let rad = l < h - tr.int(3) ? 2 : 1;
    if (hatH > 8 && l < j + 4) rad = 3;
    if (thick) rad++;
    for (let dx = -rad; dx <= rad; dx++) {
      for (let dz = -rad; dz <= rad; dz++) {
        const ex = dx === -rad || dx === rad, ez = dz === -rad || dz === rad;
        const inner = !ex && !ez && l !== h, corner = ex && ez;
        const px = x + dx, py = y + l, pz = z + dz;
        if (l < j + 3) {
          const roll = tr.next(), v = tr.int(11);
          if (inner) continue;
          if ((blockAt(g, w, px, py - 1, pz) & 0xfff) === (wart & 0xfff)) w.setIf(px, py, pz, wart, SOFT);
          else if (roll < 0.15) {
            w.setIf(px, py, pz, wart, SOFT);
            if (crimson && v === 0) weepColumn(w, g, px, py - 1, pz, 1);
          }
        } else if (inner) hatBlock(w, g, px, py, pz, wart, 0.1, 0.2, crimson ? 0.1 : 0);
        else if (corner) hatBlock(w, g, px, py, pz, wart, 0.01, 0.7, crimson ? 0.083 : 0);
        else hatBlock(w, g, px, py, pz, wart, 0.0005, 0.98, crimson ? 0.07 : 0);
      }
    }
  }
}

const GX = 17, GY = 14;
const cells = new Uint8Array(GX * GY * GX);
const cell = (dx: number, dy: number, dz: number) => ((dy + 12) * GX + dz + 8) * GX + dx + 8;
const NB6 = [1, -1, GX, -GX, GX * GX, -GX * GX];

// Vanilla GlowstoneFeature: starts only right under a netherrack, basalt or blackstone roof.
function glowstone(g: NetherGen, w: Writer, x: number, y: number, z: number) {
  if (blockAt(g, w, x, y, z) !== 0 || !GLOW_ROOF[blockAt(g, w, x, y + 1, z) & 0xfff]) return;
  for (let dz = -8; dz <= 8; dz++)
    for (let dx = -8; dx <= 8; dx++)
      for (let dy = -12; dy <= 1; dy++) cells[cell(dx, dy, dz)] = blockAt(g, w, x + dx, y + dy, z + dz) !== 0 ? 1 : 0;
  cells[cell(0, 0, 0)] = 2;
  for (let i = 0; i < 1500; i++) {
    const c = cell(tr.int(8) - tr.int(8), -tr.int(12), tr.int(8) - tr.int(8));
    if (cells[c] !== 0) continue;
    let n = 0;
    for (let k = 0; k < 6 && n < 2; k++) if (cells[c + NB6[k]] === 2) n++;
    if (n === 1) cells[c] = 2;
  }
  const s = S(B.glowstone);
  for (let dz = -7; dz <= 7; dz++)
    for (let dx = -7; dx <= 7; dx++)
      for (let dy = -11; dy <= 0; dy++) if (cells[cell(dx, dy, dz)] === 2) w.setIf(x + dx, y + dy, z + dz, s, AIR_ONLY);
}

function spread(g: NetherGen, w: Writer, x: number, y: number, z: number, tries: number, xz: number, yr: number, pick: (r: number) => number, base: Uint8Array) {
  for (let k = 0; k < tries; k++) {
    const px = x + tr.int(xz) - tr.int(xz), py = y + tr.int(yr) - tr.int(yr), pz = z + tr.int(xz) - tr.int(xz), st = pick(tr.next());
    if (!w.inside(px, pz) || py <= 31 || py > 126) continue;
    if (w.get(px, py, pz) === 0 && base[w.get(px, py - 1, pz) & 0xfff]) w.set(px, py, pz, st);
  }
}

const crimsonPlant = (r: number) => S(r < 87 / 99 ? B.crimson_roots : r < 98 / 99 ? B.crimson_fungus : B.warped_fungus);
const warpedPlant = (r: number) => S(r < 0.85 ? B.warped_roots : r < 0.86 ? B.crimson_roots : r < 0.99 ? B.warped_fungus : B.crimson_fungus);
const sprout = () => S(B.nether_sprouts);

function weepingVines(g: NetherGen, w: Writer, x: number, y: number, z: number) {
  if (blockAt(g, w, x, y, z) !== 0 || !ROOF[blockAt(g, w, x, y + 1, z) & 0xfff]) return;
  const wart = S(B.nether_wart_block);
  w.set(x, y, z, wart);
  for (let i = 0; i < 200; i++) {
    const px = x + tr.int(6) - tr.int(6), py = y + tr.int(2) - tr.int(5), pz = z + tr.int(6) - tr.int(6);
    if (!w.inside(px, pz) || w.get(px, py, pz) !== 0) continue;
    let n = 0;
    for (const [dx, dy, dz] of DIRS) if (ROOF[blockAt(g, w, px + dx, py + dy, pz + dz) & 0xfff] && ++n > 1) break;
    if (n === 1) w.set(px, py, pz, wart);
  }
  for (let i = 0; i < 100; i++) {
    const px = x + tr.int(8) - tr.int(8), py = y + tr.int(2) - tr.int(7), pz = z + tr.int(8) - tr.int(8);
    let len = 1 + tr.int(8);
    if (tr.int(6) === 0) len *= 2;
    if (tr.int(5) === 0) len = 1;
    if (!w.inside(px, pz) || w.get(px, py, pz) !== 0 || !ROOF[w.get(px, py + 1, pz) & 0xfff]) continue;
    weepColumn(w, g, px, py, pz, len);
  }
}
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function twistingVines(g: NetherGen, w: Writer, x: number, y: number, z: number) {
  if (blockAt(g, w, x, y, z) !== 0 || !TWIST_BASE[blockAt(g, w, x, y - 1, z) & 0xfff]) return;
  for (let i = 0; i < 64; i++) {
    const px = x + tr.int(17) - 8, pz = z + tr.int(17) - 8;
    let py = y + tr.int(9) - 4;
    let len = 1 + tr.int(8);
    if (tr.int(6) === 0) len *= 2;
    if (!w.inside(px, pz) || py <= 32 || py > 126) continue;
    if (w.get(px, py, pz) !== 0) continue;
    while (py > 32 && w.get(px, py - 1, pz) === 0) py--;
    if (!TWIST_BASE[w.get(px, py - 1, pz) & 0xfff]) continue;
    for (let k = 0; k < len; k++) {
      const last = k === len - 1 || w.get(px, py + k + 1, pz) !== 0;
      if (w.get(px, py + k, pz) !== 0) break;
      w.set(px, py + k, pz, S(last ? B.twisting_vines : B.twisting_vines_plant));
      if (last) break;
    }
  }
}

function patch(g: NetherGen, w: Writer, x: number, y: number, z: number, st: number, base: Uint8Array) {
  for (let k = 0; k < 96; k++) {
    const px = x + tr.int(8) - tr.int(8), py = y + tr.int(4) - tr.int(4), pz = z + tr.int(8) - tr.int(8);
    if (!w.inside(px, pz) || py <= 31 || py > 126) continue;
    if (w.get(px, py, pz) === 0 && base[w.get(px, py - 1, pz) & 0xfff]) w.set(px, py, pz, st);
  }
}

const FIRE_BASE = idTable(B.netherrack);
const SOUL_FIRE_BASE = idTable(B.soul_soil);
const MUSHROOM_BASE = idTable(B.netherrack, B.soul_sand, B.soul_soil, B.basalt, B.blackstone, B.gravel, B.crimson_nylium, B.warped_nylium, B.magma_block);
MUSHROOM_BASE[B.magma_block] = 0;

export function netherFeatures(g: NetherGen, w: Writer, _biomes: Uint8Array) {
  const biome = (x: number, z: number) => g.biomeAt(x, z);
  deltaFeatures(g, w);
  soulValleyFeatures(g, w);
  const uniform05 = (r: Rng) => r.int(6);
  scatter(g, w, 0xf1e, uniform05, 4, 123, 8, (x, y, z) => {
    patch(g, w, x, y, z, S(B.fire), FIRE_BASE);
  });
  scatter(g, w, 0x50f1, uniform05, 4, 123, 8, (x, y, z) => {
    if (biome(x, z) !== NB.crimson) patch(g, w, x, y, z, S(B.soul_fire), SOUL_FIRE_BASE);
  });
  scatter(g, w, 0x6105, (r) => r.int(r.int(10) + 1), 4, 123, 8, (x, y, z) => glowstone(g, w, x, y, z));
  scatter(g, w, 0x6106, () => 10, 0, 127, 8, (x, y, z) => glowstone(g, w, x, y, z));
  for (let ocz = w.cz - 1; ocz <= w.cz + 1; ocz++) {
    for (let ocx = w.cx - 1; ocx <= w.cx + 1; ocx++) {
      everyLayer(g, w, ocx, ocz, 0xf0f0, 8, 4, (x, y, z) => {
        const b = biome(x, z);
        if (b === NB.crimson || b === NB.warped) hugeFungus(g, w, x, y, z, b === NB.crimson);
      });
    }
  }
  for (let ocz = w.cz - 1; ocz <= w.cz + 1; ocz++) {
    for (let ocx = w.cx - 1; ocx <= w.cx + 1; ocx++) {
      everyLayer(g, w, ocx, ocz, 0x7e6, 6, 8, (x, y, z) => {
        if (biome(x, z) === NB.crimson) spread(g, w, x, y, z, 64, 8, 4, crimsonPlant, NYLIUM);
      });
      everyLayer(g, w, ocx, ocz, 0x7e7, 5, 8, (x, y, z) => {
        if (biome(x, z) === NB.warped) spread(g, w, x, y, z, 64, 8, 4, warpedPlant, NYLIUM);
      });
      everyLayer(g, w, ocx, ocz, 0x7e8, 4, 8, (x, y, z) => {
        if (biome(x, z) === NB.warped) spread(g, w, x, y, z, 64, 8, 4, sprout, NYLIUM);
      });
    }
  }
  scatter(g, w, 0x3ee, () => 10, 0, 127, 10, (x, y, z) => {
    if (biome(x, z) === NB.crimson) weepingVines(g, w, x, y, z);
  });
  scatter(g, w, 0x3ef, () => 10, 0, 127, 10, (x, y, z) => {
    if (biome(x, z) === NB.warped) twistingVines(g, w, x, y, z);
  });
  scatter(g, w, 0xb20, (r) => (r.int(2) === 0 ? 1 : 0), 0, 127, 8, (x, y, z) => {
    if (biome(x, z) === NB.wastes) patch(g, w, x, y, z, S(B.brown_mushroom), MUSHROOM_BASE);
  });
  scatter(g, w, 0xb21, (r) => (r.int(2) === 0 ? 1 : 0), 0, 127, 8, (x, y, z) => {
    if (biome(x, z) === NB.wastes) patch(g, w, x, y, z, S(B.red_mushroom), MUSHROOM_BASE);
  });
  scatter(g, w, 0xc77, () => 1, 0, 127, 8, (x, y, z) => {
    if (biome(x, z) === NB.soul) patch(g, w, x, y, z, S(B.crimson_roots), PLANT_BASE);
  });
  springs(g, w, biome);
}

