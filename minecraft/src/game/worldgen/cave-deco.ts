import { MIN_Y, stateOf } from "../contracts";
import { B } from "./ids";
import { hash01, hash32 } from "./noise";
import type { ChunkCtx } from "./overworld";
import { createRng, idTable } from "./rng";
import { CAVE_DEEP_DARK, CAVE_DRIPSTONE, CAVE_LUSH } from "./terrain";

const S = stateOf;
const ROCK = idTable(B.stone, B.deepslate, B.granite, B.diorite, B.andesite, B.tuff, B.dirt, B.gravel, B.calcite);
const AIR = 0;
const LICHEN_UP = S(B.glow_lichen, 1 << 2);
const LICHEN_DOWN = S(B.glow_lichen, 1 << 3);
// pointed_dripstone meta: bits 0-2 thickness (0 tip, 1 frustum, 2 middle, 3 base), bit 3 hanging.
const drip = (thick: number, down: boolean) => S(B.pointed_dripstone, thick | (down ? 8 : 0));
const rng = createRng();

let blocks: Uint16Array;
const at = (lx: number, y: number, lz: number) => ((y - MIN_Y) << 8) | (lz << 4) | lx;

function dripstone(lx: number, y: number, lz: number, len: number, down: boolean) {
  const dir = down ? -1 : 1;
  for (let k = 0; k < len; k++) {
    const yy = y + k * dir;
    if (yy <= MIN_Y || yy >= 319) return;
    const i = at(lx, yy, lz);
    if (blocks[i] !== AIR) return;
    const left = len - 1 - k;
    blocks[i] = drip(left === 0 ? 0 : left === 1 ? 1 : k === 0 ? 3 : 2, down);
  }
}

function sealed(i: number): boolean {
  for (const d of [1, -1, 16, -16]) {
    const b = blocks[i + d];
    if (b === AIR || (b & 0xfff) === B.water) return false;
  }
  return true;
}

export function decorateCaves(ctx: ChunkCtx) {
  blocks = ctx.blocks;
  const { ow, seed } = ctx.g;
  const ox = ctx.cx * 16, oz = ctx.cz * 16;
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const x = ox + lx, z = oz + lz;
      const col = (lz << 4) | lx;
      const cave = ow.caveAt(x, z);
      const yTop = Math.min(ctx.surface[col] - 4, 300);
      for (let y = MIN_Y + 2; y < yTop; y++) {
        const i = at(lx, y, lz);
        if (blocks[i] !== AIR || !ctx.cave[i]) continue;
        const below = blocks[i - 256] & 0xfff, above = blocks[i + 256] & 0xfff;
        const floor = ROCK[below] === 1, ceil = ROCK[above] === 1;
        if (!floor && !ceil) continue;
        const r = hash01(seed, x, y, z);
        const kind = cave === CAVE_DEEP_DARK && y > 0 ? 0 : cave;
        if (kind === CAVE_LUSH) {
          if (floor) {
            blocks[i - 256] = S(B.moss_block);
            if ((blocks[i - 512] & 0xfff) !== 0 && ROCK[blocks[i - 512] & 0xfff] && r < 0.5) blocks[i - 512] = S(B.moss_block);
            if (r < 0.07 && lx > 0 && lx < 15 && lz > 0 && lz < 15 && sealed(i - 256)) {
              blocks[i - 256] = S(B.water);
              blocks[i - 512] = S(B.clay);
            } else if (r < 0.3) blocks[i] = S(B.moss_carpet);
            else if (r < 0.36) blocks[i] = S(B.short_grass);
            else if (r < 0.39) blocks[i] = S(B.azalea);
            else if (r < 0.41) blocks[i] = S(B.flowering_azalea);
            else if (r < 0.44 && blocks[i + 256] === AIR) {
              blocks[i] = S(B.small_dripleaf);
              blocks[i + 256] = S(B.small_dripleaf_upper);
            } else if (r < 0.47) {
              const h = 1 + Math.floor(hash01(seed, x, y + 1, z) * 3);
              let k = 0;
              while (k < h && blocks[at(lx, y + k + 1, lz)] === AIR) k++;
              for (let j = 0; j < k; j++) blocks[at(lx, y + j, lz)] = S(B.big_dripleaf_stem);
              blocks[at(lx, y + k, lz)] = S(B.big_dripleaf);
            }
          }
          if (ceil) {
            blocks[i + 256] = S(B.moss_block);
            if (r > 0.97) blocks[i] = S(B.spore_blossom);
            else if (r > 0.75) {
              const len = 1 + Math.floor(hash01(seed, x, y - 1, z) * 5);
              for (let k = 0; k < len; k++) {
                const j = at(lx, y - k, lz);
                if (blocks[j] !== AIR || (k > 0 && (blocks[j - 256] & 0xfff) !== 0 && ROCK[blocks[j - 256] & 0xfff])) break;
                const berries = hash01(seed, x, y - k, z + 7) < 0.25 ? 1 : 0;
                blocks[j] = S(k === len - 1 ? B.cave_vines : B.cave_vines_plant, berries);
              }
            } else if (r > 0.7) blocks[i] = S(B.hanging_roots);
          }
        } else if (kind === CAVE_DRIPSTONE) {
          if (floor) {
            if (r < 0.5) blocks[i - 256] = S(B.dripstone_block);
            if (r < 0.12) dripstone(lx, y, lz, 1 + Math.floor(hash01(seed, x, y + 3, z) * 4), false);
          }
          if (ceil && blocks[i] === AIR) {
            if (r > 0.45) blocks[i + 256] = S(B.dripstone_block);
            if (r > 0.86) dripstone(lx, y, lz, 1 + Math.floor(hash01(seed, x, y - 3, z) * 5), true);
          }
        } else if (kind === CAVE_DEEP_DARK) {
          const n = hash01(seed, x >> 2, y >> 2, z >> 2);
          if (floor && n < 0.6) {
            blocks[i - 256] = S(B.sculk);
            if (r < 0.02) blocks[i] = S(B.sculk_sensor);
            else if (r < 0.026) blocks[i] = S(B.sculk_shrieker, 1);
            else if (r < 0.03) blocks[i - 256] = S(B.sculk_catalyst);
            else if (r < 0.2) blocks[i] = S(B.sculk_vein, 1 << 3);
          }
          if (ceil && n < 0.4) blocks[i + 256] = S(B.sculk);
        } else {
          if (ceil && r < 0.02 && y < 60) blocks[i] = LICHEN_UP;
          else if (floor && r > 0.995) blocks[i] = LICHEN_DOWN;
        }
      }
    }
  }
  springs(ctx);
}

function springs(ctx: ChunkCtx) {
  const seed = ctx.g.seed;
  rng.seed(hash32(seed, ctx.cx, ctx.cz, 0x5921));
  for (let n = 0; n < 45; n++) {
    const lava = n >= 25;
    const lx = 1 + rng.int(14), lz = 1 + rng.int(14);
    const y = lava ? -60 + rng.int(rng.int(120) + 1) : -60 + rng.int(250);
    if (y >= ctx.surface[(lz << 4) | lx] - 2) continue;
    const i = at(lx, y, lz);
    if (!ROCK[blocks[i] & 0xfff] || !ROCK[blocks[i + 256] & 0xfff] || !ROCK[blocks[i - 256] & 0xfff]) continue;
    let open = 0, rock = 0;
    for (const d of [1, -1, 16, -16]) {
      const b = blocks[i + d];
      if (b === AIR) open++;
      else if (ROCK[b & 0xfff]) rock++;
    }
    if (open === 1 && rock === 3) blocks[i] = S(lava ? B.lava : B.water);
  }
}
