import { hash32 } from "./noise";
import type { ChunkCtx } from "./overworld";
import { createRng, type Rng, type Writer } from "./rng";
import { BI, topBlockFor } from "./surface";
import { CAVE_LUSH } from "./terrain";
import {
  acaciaTree, azaleaTree, beeNest, BIRCH, bush, cherryTree, darkOak, fancyOak, GROUND, hugeMushroom, JUNGLE, jungleBush, jungleTree,
  mangroveTree, megaJungle, megaSpruce, OAK, oakTree, pineTree, SPRUCE, spruceTree, useTree,
} from "./tree-shapes";
import { B } from "./ids";

type Kind =
  | "oak" | "fancy" | "birch" | "tall_birch" | "spruce" | "pine" | "mega_spruce" | "mega_pine" | "jungle" | "mega_jungle"
  | "jungle_bush" | "acacia" | "dark_oak" | "red_mushroom" | "brown_mushroom" | "swamp_oak" | "mangrove" | "cherry" | "oak_bush"
  | "spruce_bush" | "azalea" | "bee_oak" | "bee_birch";

interface Spec {
  count: number;
  kinds: [Kind, number][];
  grid?: boolean;
}

const TREES = new Map<number, Spec>([
  [BI.plains, { count: 0.05, kinds: [["bee_oak", 0.05], ["fancy", 0.1], ["oak", 0.85]] }],
  [BI.sunflower, { count: 0.05, kinds: [["bee_oak", 0.05], ["fancy", 0.1], ["oak", 0.85]] }],
  [BI.meadow, { count: 0.06, kinds: [["bee_birch", 0.5], ["fancy", 0.5]] }],
  [BI.forest, { count: 10, kinds: [["birch", 0.2], ["fancy", 0.1], ["bee_oak", 0.01], ["oak", 0.69]] }],
  [BI.flowerForest, { count: 6, kinds: [["birch", 0.2], ["fancy", 0.1], ["bee_oak", 0.02], ["oak", 0.68]] }],
  [BI.birch, { count: 10, kinds: [["bee_birch", 0.002], ["birch", 0.998]] }],
  [BI.ogBirch, { count: 10, kinds: [["tall_birch", 0.8], ["birch", 0.2]] }],
  [BI.darkForest, { count: 16, grid: true, kinds: [["red_mushroom", 0.025], ["brown_mushroom", 0.05], ["dark_oak", 0.66], ["birch", 0.05], ["fancy", 0.03], ["oak", 0.185]] }],
  [BI.taiga, { count: 10, kinds: [["pine", 0.33], ["spruce", 0.67]] }],
  [BI.snowyTaiga, { count: 10, kinds: [["pine", 0.33], ["spruce", 0.67]] }],
  [BI.ogPine, { count: 10, kinds: [["mega_pine", 0.3], ["pine", 0.3], ["spruce", 0.4]] }],
  [BI.ogSpruce, { count: 10, kinds: [["mega_spruce", 0.33], ["pine", 0.33], ["spruce", 0.34]] }],
  [BI.grove, { count: 10, kinds: [["pine", 1]] }],
  [BI.snowyPlains, { count: 0.1, kinds: [["spruce", 1]] }],
  [BI.wsHills, { count: 0.1, kinds: [["spruce", 0.66], ["oak", 0.34]] }],
  [BI.wsGravelly, { count: 0.1, kinds: [["spruce", 0.66], ["oak", 0.34]] }],
  [BI.wsForest, { count: 3, kinds: [["spruce", 0.66], ["fancy", 0.1], ["oak", 0.24]] }],
  [BI.savanna, { count: 1.1, kinds: [["acacia", 0.8], ["oak", 0.2]] }],
  [BI.savannaPlateau, { count: 2, kinds: [["acacia", 0.8], ["oak", 0.2]] }],
  [BI.wsSavanna, { count: 2, kinds: [["acacia", 0.8], ["oak", 0.2]] }],
  [BI.jungle, { count: 50, kinds: [["fancy", 0.1], ["jungle_bush", 0.5], ["mega_jungle", 0.1], ["jungle", 0.3]] }],
  [BI.sparseJungle, { count: 2, kinds: [["fancy", 0.1], ["jungle_bush", 0.5], ["jungle", 0.4]] }],
  [BI.bamboo, { count: 30, kinds: [["fancy", 0.05], ["jungle_bush", 0.15], ["mega_jungle", 0.4], ["jungle", 0.4]] }],
  [BI.swamp, { count: 2, kinds: [["swamp_oak", 1]] }],
  [BI.mangrove, { count: 25, kinds: [["mangrove", 1]] }],
  [BI.cherry, { count: 10, kinds: [["cherry", 1]] }],
  [BI.wooded, { count: 5, kinds: [["oak", 1]] }],
  [BI.mushroom, { count: 1, kinds: [["red_mushroom", 0.5], ["brown_mushroom", 0.5]] }],
  [BI.stonyPeaks, { count: 0, kinds: [] }],
]);

const REACH = 8;
const rng = createRng();
const tr = createRng();

function pick(spec: Spec, roll: number): Kind {
  let acc = 0;
  for (const [k, p] of spec.kinds) {
    acc += p;
    if (roll < acc) return k;
  }
  return spec.kinds[spec.kinds.length - 1][0];
}

function grow(kind: Kind, x: number, y: number, z: number, r: Rng, ground: number) {
  switch (kind) {
    case "oak": return oakTree(x, y, z, OAK, 4 + r.int(3));
    case "bee_oak": oakTree(x, y, z, OAK, 4 + r.int(3)); return beeNest(x, y + 2, z);
    case "fancy": return fancyOak(x, y, z, OAK);
    case "birch": return oakTree(x, y, z, BIRCH, 5 + r.int(3));
    case "bee_birch": oakTree(x, y, z, BIRCH, 5 + r.int(3)); return beeNest(x, y + 2, z);
    case "tall_birch": return oakTree(x, y, z, BIRCH, 10 + r.int(5));
    case "spruce": return spruceTree(x, y, z, 6 + r.int(4));
    case "pine": return pineTree(x, y, z, 7 + r.int(5));
    case "mega_spruce": return megaSpruce(x, y, z, false);
    case "mega_pine": return megaSpruce(x, y, z, true);
    case "jungle": return jungleTree(x, y, z);
    case "mega_jungle": return megaJungle(x, y, z);
    case "jungle_bush": return jungleBush(x, y, z);
    case "acacia": return acaciaTree(x, y, z);
    case "dark_oak": return darkOak(x, y, z);
    case "red_mushroom": return hugeMushroom(x, y, z, true);
    case "brown_mushroom": return hugeMushroom(x, y, z, false);
    case "swamp_oak": return oakTree(x, y, z, OAK, 5 + r.int(4), true, 3);
    case "mangrove": return mangroveTree(x, y, z, ground);
    case "cherry": return cherryTree(x, y, z);
    case "oak_bush": return bush(x, y, z, JUNGLE);
    case "spruce_bush": return bush(x, y, z, SPRUCE);
    case "azalea": return azaleaTree(x, y, z);
  }
}

export function placeTrees(ctx: ChunkCtx, w: Writer) {
  const { ow, sn, seed } = ctx.g;
  const ox = ctx.cx * 16, oz = ctx.cz * 16;
  for (let ocz = ctx.cz - 1; ocz <= ctx.cz + 1; ocz++) {
    for (let ocx = ctx.cx - 1; ocx <= ctx.cx + 1; ocx++) {
      const own = ocx === ctx.cx && ocz === ctx.cz;
      const bx = ocx * 16, bz = ocz * 16;
      const spec = TREES.get(ow.biomeAt(bx + 8, bz + 8));
      rng.seed(hash32(seed, ocx, ocz, 0x7a3e));
      const azalea = ow.caveAt(bx + 8, bz + 8) === CAVE_LUSH && rng.chance(0.35);
      let count = 0;
      if (spec) {
        count = Math.floor(spec.count);
        if (rng.next() < spec.count - count) count++;
      }
      const total = count + (azalea ? 1 : 0);
      for (let n = 0; n < total; n++) {
        let lx: number, lz: number;
        if (spec?.grid && n < 16) {
          lx = (n & 3) * 4 + rng.int(3);
          lz = (n >> 2) * 4 + rng.int(3);
        } else {
          lx = rng.int(16);
          lz = rng.int(16);
        }
        const roll = rng.next();
        const tseed = rng.int(0x7fffffff);
        const x = bx + lx, z = bz + lz;
        if (x < ox - REACH || x > ox + 15 + REACH || z < oz - REACH || z > oz + 15 + REACH) continue;
        const biome = ow.biomeAt(x, z);
        const bspec = n >= count ? null : TREES.get(biome);
        if (n < count && !bspec) continue;
        const kind: Kind = bspec ? pick(bspec, roll) : "azalea";
        const gy = own ? ctx.surface[(lz << 4) | lx] : ow.surfaceY(x, z);
        const mangrove = kind === "mangrove";
        if (gy < (mangrove ? 57 : 63) || gy > 300) continue;
        const top = topBlockFor(sn, seed, biome, x, gy, z);
        if (!GROUND[top]) continue;
        if ((kind === "red_mushroom" || kind === "brown_mushroom") !== (top === B.mycelium) && biome === BI.mushroom) continue;
        if (top === B.snow_block && biome !== BI.grove) continue;
        tr.seed(tseed);
        useTree(w, tr);
        grow(kind, x, gy + 1, z, tr, gy);
      }
    }
  }
}
