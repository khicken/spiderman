import { HEIGHT, MIN_Y, stateOf, type ChunkData } from "../contracts";
import { biomeId } from "./biomes";
import { B } from "./ids";
import { createOctaves, hash01, hash32, type Octaves } from "./noise";
import { createRng, createWriter, type Rng, type Writer } from "./rng";

const S = stateOf;
const EB = {
  end: biomeId("the_end"), high: biomeId("end_highlands"), mid: biomeId("end_midlands"),
  barren: biomeId("end_barrens"), small: biomeId("small_end_islands"),
};

interface EndGen {
  seed: number;
  island: Octaves;
  detail: Octaves;
  pillars: { x: number; z: number; r: number; h: number; caged: boolean }[];
}

let cached: EndGen | null = null;
function endGen(seed: number): EndGen {
  if (cached && cached.seed === seed) return cached;
  const r = createRng(hash32(seed, 0xe0d));
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = 9; i > 0; i--) {
    const j = r.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const pillars = order.map((k, i) => ({
    x: Math.floor(42 * Math.cos(2 * (-Math.PI + (Math.PI / 10) * i))),
    z: Math.floor(42 * Math.sin(2 * (-Math.PI + (Math.PI / 10) * i))),
    r: 2 + Math.floor(k / 3),
    h: 76 + k * 3,
    caged: k === 1 || k === 2,
  }));
  cached = {
    seed,
    island: createOctaves(hash32(seed, 501), 1 / 300, [1, 1, 1, 1], 1.7),
    detail: createOctaves(hash32(seed, 502), 1 / 24, [1, 1], 1.3),
    pillars,
  };
  return cached;
}

// Island top and bottom for a column, or null for void.
function column(g: EndGen, x: number, z: number, out: { top: number; bottom: number; biome: number }) {
  const d = Math.sqrt(x * x + z * z);
  const n = g.detail.sample2(x, z);
  out.biome = d < 1000 ? EB.end : EB.small;
  out.top = out.bottom = 0;
  if (d < 140) {
    const ang = Math.atan2(z, x);
    const R = 95 + 10 * Math.sin(ang * 3 + 1) + 6 * g.detail.sample2(ang * 40, 7);
    const t = 1 - (d / R) * (d / R);
    if (t <= 0) return false;
    out.top = Math.round(56 + 6 * Math.sqrt(t) + n * 1.5);
    out.bottom = Math.round(out.top - 6 - 50 * Math.pow(t, 1.4) - n * 4);
    return true;
  }
  if (d < 1000) return false;
  const v = g.island.sample2(x, z) * 1.1 - 0.12 + Math.min(0.15, (d - 1000) / 4000);
  if (v > 0) {
    out.biome = v > 0.32 ? EB.high : v > 0.12 ? EB.mid : EB.barren;
    out.top = Math.round(54 + Math.min(v, 0.6) * 22 + n * 2);
    out.bottom = Math.round(out.top - 4 - v * 70 - n * 3);
    return out.bottom < out.top;
  }
  const h = hash01(g.seed, Math.floor(x / 48), 9, Math.floor(z / 48));
  if (h < 0.05) {
    const cx = Math.floor(x / 48) * 48 + 24 + Math.floor((hash01(g.seed, Math.floor(x / 48), 10, Math.floor(z / 48)) - 0.5) * 20);
    const cz = Math.floor(z / 48) * 48 + 24 + Math.floor((hash01(g.seed, Math.floor(x / 48), 11, Math.floor(z / 48)) - 0.5) * 20);
    const rad = 3 + h * 80;
    const dd = Math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz));
    if (dd < rad) {
      const t = 1 - dd / rad;
      const cy = 55 + Math.floor(hash01(g.seed, cx, 12, cz) * 16);
      out.top = Math.round(cy + t * 2);
      out.bottom = Math.round(cy - t * rad);
      return true;
    }
  }
  return false;
}

const col = { top: 0, bottom: 0, biome: 0 };

export function generateEnd(seed: number, cx: number, cz: number): ChunkData {
  const g = endGen(seed);
  const blocks = new Uint16Array(16 * 16 * HEIGHT);
  const biomes = new Uint8Array(256);
  const END = S(B.end_stone);
  const ox = cx * 16, oz = cz * 16;
  const tops = new Int16Array(256).fill(-1);
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const x = ox + lx, z = oz + lz, c = (lz << 4) | lx;
      const solid = column(g, x, z, col);
      biomes[c] = col.biome;
      if (!solid) continue;
      tops[c] = col.top;
      for (let y = Math.max(col.bottom, 1); y <= col.top; y++) blocks[((y - MIN_Y) << 8) | c] = END;
    }
  }
  const w = createWriter(cx, cz, blocks);
  if (Math.abs(cx) <= 4 && Math.abs(cz) <= 4) {
    for (const p of g.pillars) pillar(w, p);
    exitPortal(w);
  }
  chorus(g, w, tops, biomes);
  const heightmap = new Int16Array(256);
  for (let c = 0; c < 256; c++) {
    let y = HEIGHT - 1;
    while (y > 0 && blocks[(y << 8) | c] === 0) y--;
    heightmap[c] = y + MIN_Y;
  }
  return { cx, cz, dim: "end", blocks, biomes, heightmap, light: new Uint8Array(blocks.length), blockEntities: w.blockEntities, entities: w.entities };
}

function pillar(w: Writer, p: EndGen["pillars"][number]) {
  const OBS = S(B.obsidian);
  for (let dx = -p.r; dx <= p.r; dx++) {
    for (let dz = -p.r; dz <= p.r; dz++) {
      if (dx * dx + dz * dz > p.r * p.r + 1) continue;
      for (let y = 30; y <= p.h; y++) w.set(p.x + dx, y, p.z + dz, OBS);
    }
  }
  if (p.caged) {
    const BARS = S(B.iron_bars);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy <= 3; dy++) {
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2 || dy === 3;
      if (edge) w.set(p.x + dx, p.h + 1 + dy, p.z + dz, BARS);
    }
  }
  w.set(p.x, p.h + 1, p.z, S(B.bedrock));
  w.set(p.x, p.h + 2, p.z, S(B.fire));
  if (w.inside(p.x, p.z)) w.entities.push({ type: "end_crystal", x: p.x + 0.5, y: p.h + 2, z: p.z + 0.5, data: { showBottom: true } });
}

function exitPortal(w: Writer) {
  const BED = S(B.bedrock);
  const y0 = 62;
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      const d = dx * dx + dz * dz;
      if (d > 12.5) continue;
      w.set(dx, y0, dz, BED);
      if (d > 6.25) w.set(dx, y0 + 1, dz, BED);
      else w.set(dx, y0 + 1, dz, 0);
    }
  }
  for (let y = y0 + 1; y <= y0 + 4; y++) w.set(0, y, 0, BED);
  const torch = (dx: number, dz: number, facing: number) => w.set(dx, y0 + 3, dz, S(B.wall_torch, facing));
  torch(1, 0, 4);
  torch(-1, 0, 2);
  torch(0, 1, 1);
  torch(0, -1, 3);
}

function chorus(g: EndGen, w: Writer, tops: Int16Array, biomes: Uint8Array) {
  const r = createRng(hash32(g.seed, w.cx, w.cz, 0xc405));
  const n = r.int(5);
  for (let k = 0; k < n; k++) {
    const lx = 4 + r.int(8), lz = 4 + r.int(8);
    const c = (lz << 4) | lx;
    const seedv = r.int(0x7fffffff);
    if (biomes[c] !== EB.high || tops[c] < 0) continue;
    growChorus(w, createRng(seedv), w.ox + lx, tops[c] + 1, w.oz + lz, 0);
  }
}

function growChorus(w: Writer, r: Rng, x: number, y: number, z: number, depth: number) {
  const h = 1 + r.int(depth === 0 ? 4 : 3);
  const PLANT = S(B.chorus_plant);
  for (let i = 0; i < h; i++) w.set(x, y + i, z, PLANT);
  const top = y + h - 1;
  if (depth >= 4) {
    w.set(x, top + 1, z, S(B.chorus_flower, 5));
    return;
  }
  const branches = depth === 0 ? 1 + r.int(4) : r.int(4);
  if (branches === 0) {
    w.set(x, top + 1, z, S(B.chorus_flower, 5));
    return;
  }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let b = 0; b < branches; b++) {
    const [dx, dz] = dirs[r.int(4)];
    if (w.get(x + dx, top, z + dz) !== 0) continue;
    w.set(x + dx, top, z + dz, PLANT);
    growChorus(w, r, x + dx, top + 1, z + dz, depth + 1);
  }
}

export function endBiomeAt(seed: number, x: number, z: number): number {
  column(endGen(seed), x, z, col);
  return col.biome;
}
