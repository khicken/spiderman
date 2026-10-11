import { MIN_Y, stateOf } from "../contracts";
import { B } from "./ids";
import { hash32 } from "./noise";
import type { ChunkCtx } from "./overworld";
import { createRng, idTable, type Rng, type Writer } from "./rng";
import { BI } from "./surface";

const S = stateOf;
export const VILLAGE_BIOMES = new Set([BI.plains, BI.sunflower, BI.desert, BI.savanna, BI.taiga, BI.snowyPlains, BI.meadow]);

interface Style {
  floor: number;
  wall: number;
  corner: number;
  roof: number;
  path: number;
  door: number;
  fence: number;
}

const STYLES = {
  plains: { floor: B.cobblestone, wall: B.oak_planks, corner: B.oak_log, roof: B.oak_slab, path: B.dirt_path, door: B.oak_door, fence: B.oak_fence },
  desert: { floor: B.smooth_sandstone, wall: B.sandstone, corner: B.cut_sandstone, roof: B.smooth_sandstone, path: B.smooth_sandstone, door: B.oak_door, fence: B.sandstone_wall },
  savanna: { floor: B.acacia_planks, wall: B.acacia_planks, corner: B.acacia_log, roof: B.acacia_planks, path: B.dirt_path, door: B.oak_door, fence: B.acacia_fence },
  taiga: { floor: B.cobblestone, wall: B.spruce_planks, corner: B.spruce_log, roof: B.spruce_planks, path: B.dirt_path, door: B.spruce_door, fence: B.spruce_fence },
};

const JOBS: [string, number][] = [
  ["farmer", B.composter], ["librarian", B.crafting_table], ["armorer", B.furnace], ["toolsmith", B.crafting_table],
  ["butcher", B.furnace], ["cartographer", B.crafting_table], ["fletcher", B.crafting_table], ["shepherd", B.crafting_table],
];
const CLEAR = idTable(B.short_grass, B.tall_grass, B.tall_grass_upper, B.fern, B.large_fern, B.large_fern_upper, B.dandelion, B.poppy, B.snow,
  B.oak_leaves, B.birch_leaves, B.spruce_leaves, B.acacia_leaves, B.cornflower, B.azure_bluet, B.oxeye_daisy, B.dead_bush, B.cactus, B.sugar_cane,
  B.sunflower, B.sunflower_upper, B.pumpkin, B.allium);
const PATH_ON = idTable(B.grass_block, B.dirt, B.sand, B.coarse_dirt, B.podzol, B.snow_block, B.gravel, B.red_sand, B.mud);

function styleFor(biome: number): Style {
  if (biome === BI.desert) return STYLES.desert;
  if (biome === BI.savanna) return STYLES.savanna;
  if (biome === BI.taiga || biome === BI.snowyPlains) return STYLES.taiga;
  return STYLES.plains;
}

export function village(ctx: ChunkCtx, w: Writer, scx: number, scz: number, x0: number, y0: number, z0: number) {
  const { ow, seed } = ctx.g;
  const r = createRng(hash32(seed, scx, scz, 0x7112));
  const st = styleFor(ow.biomeAt(x0, z0));
  meeting(w, x0, y0, z0, st);
  if (w.inside(x0, z0)) w.entities.push({ type: "iron_golem", x: x0 + 2.5, y: y0 + 1, z: z0 + 2.5 });
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of dirs) {
    const len = 18 + r.int(14);
    for (let s = 3; s <= len; s++) {
      for (let k = -1; k <= 1; k++) road(ctx, w, x0 + dx * s + dz * k, z0 + dz * s + dx * k, st, r.next());
    }
    for (let s = 7; s + 3 <= len; s += 8 + r.int(3)) {
      const side = r.chance(0.5) ? 1 : -1;
      const kind = r.next();
      const off = kind < 0.25 ? 7 : 5;
      const bx = x0 + dx * s + dz * side * off, bz = z0 + dz * s + dx * side * off;
      const by = ow.surfaceY(bx, bz);
      const bseed = r.int(0x7fffffff);
      if (by < 63 || Math.abs(by - y0) > 10) continue;
      const facing = dz !== 0 ? (side * dz > 0 ? 1 : 3) : side * dx > 0 ? 2 : 0;
      const br = createRng(bseed);
      if (kind < 0.25) farm(w, br, bx, by, bz);
      else if (kind < 0.35) lamp(w, bx, by, bz, st);
      else house(w, br, bx, by, bz, st, facing, dz !== 0 ? -side * dz : -side * dx, dz !== 0);
    }
  }
}

function road(ctx: ChunkCtx, w: Writer, x: number, z: number, st: Style, roll: number) {
  if (!w.inside(x, z)) return;
  const lx = x - w.ox, lz = z - w.oz;
  const y = ctx.surface[(lz << 4) | lx];
  if (y < 63) return;
  const i = ((y - MIN_Y) << 8) | (lz << 4) | lx;
  const b = ctx.blocks[i] & 0xfff;
  if (PATH_ON[b] || roll < 0.1) ctx.blocks[i] = S(st.path);
  for (let k = 1; k < 4; k++) {
    const j = i + k * 256;
    if (CLEAR[ctx.blocks[j] & 0xfff]) ctx.blocks[j] = 0;
  }
}

function foundation(w: Writer, x: number, y: number, z: number, rx: number, rz: number, block: number) {
  for (let dx = -rx; dx <= rx; dx++) {
    for (let dz = -rz; dz <= rz; dz++) {
      for (let dy = -4; dy < 0; dy++) {
        const b = w.get(x + dx, y + dy, z + dz);
        if (b === 0 || (b >= 0 && CLEAR[b & 0xfff]) || (b & 0xfff) === B.water) w.set(x + dx, y + dy, z + dz, S(block));
      }
      for (let dy = 1; dy < 9; dy++) w.set(x + dx, y + dy, z + dz, 0);
    }
  }
}

function meeting(w: Writer, x: number, y: number, z: number, st: Style) {
  foundation(w, x, y, z, 2, 2, B.cobblestone);
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) w.set(x + dx, y, z + dz, S(Math.abs(dx) === 2 || Math.abs(dz) === 2 ? st.path : B.cobblestone));
  w.set(x, y + 1, z, S(B.cobblestone));
  w.set(x, y + 2, z, S(B.bell));
}

function lamp(w: Writer, x: number, y: number, z: number, st: Style) {
  w.set(x, y, z, S(B.cobblestone));
  w.set(x, y + 1, z, S(st.fence));
  w.set(x, y + 2, z, S(st.fence));
  w.set(x, y + 3, z, S(B.torch));
}

function farm(w: Writer, r: Rng, x: number, y: number, z: number) {
  foundation(w, x, y, z, 3, 4, B.dirt);
  const crop = [B.wheat, B.wheat, B.carrots, B.potatoes][r.int(4)];
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      const edge = Math.abs(dx) === 3 || Math.abs(dz) === 4;
      if (edge) w.set(x + dx, y, z + dz, S(B.oak_log, Math.abs(dx) === 3 ? 2 : 1));
      else if (dx === 0) w.set(x + dx, y, z + dz, S(B.water));
      else {
        w.set(x + dx, y, z + dz, S(B.farmland, 7));
        w.set(x + dx, y + 1, z + dz, S(crop, r.int(8)));
      }
    }
  }
}

function house(w: Writer, r: Rng, x: number, y: number, z: number, st: Style, facing: number, toward: number, alongZ: boolean) {
  foundation(w, x, y, z, 2, 2, B.cobblestone);
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      w.set(x + dx, y, z + dz, S(st.floor));
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
      for (let dy = 1; dy <= 3; dy++) {
        if (corner) w.set(x + dx, y + dy, z + dz, S(st.corner));
        else if (edge) w.set(x + dx, y + dy, z + dz, dy === 2 && (dx === 0 || dz === 0) ? S(B.glass_pane) : S(st.wall));
      }
      w.set(x + dx, y + 4, z + dz, S(st.roof));
    }
  }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.set(x + dx, y + 5, z + dz, S(st.roof));
  const doorX = alongZ ? x + toward * 2 : x, doorZ = alongZ ? z : z + toward * 2;
  w.set(doorX, y + 1, doorZ, S(st.door, facing));
  w.set(doorX, y + 2, doorZ, S(st.door, facing | 8));
  w.set(alongZ ? doorX + toward : doorX, y, alongZ ? doorZ : doorZ + toward, S(B.cobblestone));
  const [job, site] = JOBS[r.int(JOBS.length)];
  const bx = alongZ ? x - toward : x + 1, bz = alongZ ? z + 1 : z - toward;
  w.set(bx, y + 1, bz, S(B.white_bed, facing));
  w.set(alongZ ? bx - toward : bx, y + 1, alongZ ? bz : bz - toward, S(B.white_bed, facing | 4));
  w.set(alongZ ? x - toward : x - 1, y + 1, alongZ ? z - 1 : z - toward, S(site));
  w.set(x, y + 3, z, S(B.lantern));
  if (w.inside(x, z)) w.entities.push({ type: "villager", x: x + 0.5, y: y + 1, z: z + 0.5, data: { profession: job, level: 1 } });
}
