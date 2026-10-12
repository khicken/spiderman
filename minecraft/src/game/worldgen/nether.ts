import { HEIGHT, MIN_Y, stateOf, type ChunkData } from "../contracts";
import { B } from "./ids";
import { hash01 } from "./noise";
import { N_LEVELS, NB, netherGen, type NetherGen } from "./nether-gen";
import { runOres, type OreDef } from "./ores";
import { createWriter, idTable } from "./rng";
import { netherFeatures } from "./nether-features";
import { placeDimStructures } from "./structures";

const S = stateOf;

const NETHERRACK = idTable(B.netherrack);
const ORE_ANY = idTable(B.netherrack, B.basalt, B.blackstone);
const NETHER_ORES: OreDef[] = [
  { ore: B.nether_quartz_ore, deep: 0, count: 16, size: 14, h: ["u", 10, 117], air: 0, replace: NETHERRACK },
  { ore: B.nether_quartz_ore, deep: 0, count: 16, size: 14, h: ["u", 10, 117], air: 0, replace: NETHERRACK, only: (b) => b === NB.basalt },
  { ore: B.nether_gold_ore, deep: 0, count: 10, size: 10, h: ["u", 10, 117], air: 0, replace: NETHERRACK },
  { ore: B.nether_gold_ore, deep: 0, count: 10, size: 10, h: ["u", 10, 117], air: 0, replace: NETHERRACK, only: (b) => b === NB.basalt },
  { ore: B.ancient_debris, deep: 0, count: 1, size: 3, h: ["t", 8, 24], air: 1, replace: ORE_ANY },
  { ore: B.ancient_debris, deep: 0, count: 1, size: 2, h: ["u", 8, 119], air: 1, replace: ORE_ANY },
  { ore: B.magma_block, deep: 0, count: 4, size: 33, h: ["u", 27, 36], air: 0, replace: NETHERRACK },
  { ore: B.gravel, deep: 0, count: 2, size: 33, h: ["u", 5, 41], air: 0, replace: NETHERRACK },
  { ore: B.blackstone, deep: 0, count: 2, size: 33, h: ["u", 5, 31], air: 0, replace: NETHERRACK },
  { ore: B.soul_sand, deep: 0, count: 0.3, size: 33, h: ["u", 5, 41], air: 0, replace: NETHERRACK },
];

const prof = new Float32Array(N_LEVELS);

export function generateNether(seed: number, cx: number, cz: number): ChunkData {
  const g = netherGen(seed);
  const blocks = new Uint16Array(16 * 16 * HEIGHT);
  const biomes = new Uint8Array(256);
  const RACK = S(B.netherrack), LAVA = S(B.lava), BEDROCK = S(B.bedrock);
  const ox = cx * 16, oz = cz * 16;
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const x = ox + lx, z = oz + lz, col = (lz << 4) | lx;
      biomes[col] = g.biomeAt(x, z);
      g.profile(x, z, prof);
      for (let y = 0; y < 128; y++) {
        const k = y >> 3, t = (y & 7) / 8;
        const v = prof[k] + (prof[k + 1] - prof[k]) * t;
        const i = ((y - MIN_Y) << 8) | col;
        if (v > 0) blocks[i] = RACK;
        else if (y <= 31) blocks[i] = LAVA;
      }
      blocks[((0 - MIN_Y) << 8) | col] = BEDROCK;
      blocks[((127 - MIN_Y) << 8) | col] = BEDROCK;
      for (let k = 1; k <= 4; k++) {
        if (hash01(seed, x, k, z) * 5 < 5 - k) blocks[((k - MIN_Y) << 8) | col] = BEDROCK;
        if (hash01(seed, x, 127 - k, z) * 5 < 5 - k) blocks[((127 - k - MIN_Y) << 8) | col] = BEDROCK;
      }
      netherSurface(g, blocks, col, x, z, biomes[col]);
    }
  }
  runOres(blocks, cx, cz, seed, NETHER_ORES, (x, z) => g.biomeAt(x, z), () => 0);
  const w = createWriter(cx, cz, blocks);
  netherFeatures(g, w, biomes);
  placeDimStructures(seed, "nether", null, w);
  const heightmap = new Int16Array(256);
  for (let col = 0; col < 256; col++) {
    let y = HEIGHT - 1;
    while (y > 0 && blocks[(y << 8) | col] === 0) y--;
    heightmap[col] = y + MIN_Y;
  }
  return { cx, cz, dim: "nether", blocks, biomes, heightmap, light: new Uint8Array(blocks.length), blockEntities: w.blockEntities, entities: w.entities };
}

function netherSurface(g: NetherGen, blocks: Uint16Array, col: number, x: number, z: number, biome: number) {
  const n = g.surface.sample2(x, z);
  const seed = g.seed;
  const RACK = S(B.netherrack);
  for (let y = 120; y > 5; y--) {
    const i = ((y - MIN_Y) << 8) | col;
    if (blocks[i] !== RACK) continue;
    const above = blocks[i + 256];
    const below = blocks[i - 256];
    const floor = above === 0;
    const ceil = below === 0;
    if (!floor && !ceil) continue;
    if (biome === NB.crimson && floor) blocks[i] = S(B.crimson_nylium);
    else if (biome === NB.warped && floor) blocks[i] = S(B.warped_nylium);
    else if (biome === NB.soul) {
      const soil = n + hash01(seed, x, y, z) * 0.3 > 0.1;
      blocks[i] = S(soil ? B.soul_soil : B.soul_sand);
      if (floor && y > 2) blocks[i - 256] = S(soil ? B.soul_soil : B.soul_sand);
    } else if (biome === NB.basalt) {
      blocks[i] = S(n > 0.1 ? B.blackstone : B.basalt, 0);
      if (floor && hash01(seed, x, y + 1, z) < 0.04) blocks[i] = S(B.magma_block);
    } else if (biome === NB.wastes && floor && y >= 30 && y <= 35) {
      if (n > 0.25) blocks[i] = S(B.gravel);
      else if (n < -0.3) blocks[i] = S(B.soul_sand);
    }
  }
}
