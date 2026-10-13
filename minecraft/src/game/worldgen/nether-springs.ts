import { stateOf } from "../contracts";
import { B } from "./ids";
import { NB, type NetherGen } from "./nether-gen";
import { SOFT, blockAt, scatter } from "./nether-features";
import { idTable, type Writer } from "./rng";

const RACK_ONLY = idTable(B.netherrack);
const DELTA_ROCK = idTable(B.netherrack, B.soul_sand, B.gravel, B.magma_block, B.blackstone);
const HX = [1, -1, 0, 0], HZ = [0, 0, 1, -1];
const placed = new Map<number, number>();
const queue: number[] = [];
const key = (x: number, y: number, z: number) => ((x + 4096) * 8192 + (z + 4096)) * 128 + y;

const empty = (g: NetherGen, w: Writer, x: number, y: number, z: number) => {
  if (y <= 0 || y > 126 || placed.has(key(x, y, z))) return false;
  const s = blockAt(g, w, x, y, z);
  return s === 0 || SOFT[s & 0xfff] === 1;
};

function put(w: Writer, x: number, y: number, z: number, meta: number) {
  placed.set(key(x, y, z), meta);
  w.setIf(x, y, z, stateOf(B.lava, meta), SOFT);
  queue.push(x, y, z, meta);
}

// Runs the nether lava flow at generation time (drop-off 1, so it reaches 7 blocks), giving the open springs their lavafalls.
function flow(g: NetherGen, w: Writer, x: number, y: number, z: number) {
  placed.clear();
  queue.length = 0;
  put(w, x, y, z, 0);
  let n = 0;
  while (queue.length && n++ < 600) {
    const m = queue.pop()!, qz = queue.pop()!, qy = queue.pop()!, qx = queue.pop()!;
    if (empty(g, w, qx, qy - 1, qz)) {
      put(w, qx, qy - 1, qz, 8);
      if (m !== 0) continue;
    } else if (m !== 0 && placed.has(key(qx, qy - 1, qz))) continue;
    else if (m !== 0 && (blockAt(g, w, qx, qy - 1, qz) & 0xfff) === B.lava) continue;
    const next = m >= 8 ? 1 : m + 1;
    if (next > 7) continue;
    for (let d = 0; d < 4; d++) if (empty(g, w, qx + HX[d], qy, qz + HZ[d])) put(w, qx + HX[d], qy, qz + HZ[d], next);
  }
}

// Vanilla SpringFeature: the block above (and below) must be rock, and the 4 sides plus below hold exactly `rock` rocks and `hole` air.
function spring(g: NetherGen, w: Writer, x: number, y: number, z: number, valid: Uint8Array, rock: number, hole: number) {
  if (!valid[blockAt(g, w, x, y + 1, z) & 0xfff] || !valid[blockAt(g, w, x, y - 1, z) & 0xfff]) return;
  const self = blockAt(g, w, x, y, z);
  if (self !== 0 && !valid[self & 0xfff]) return;
  let rocks = 1, holes = 0;
  for (let d = 0; d < 4; d++) {
    const s = blockAt(g, w, x + HX[d], y, z + HZ[d]);
    if (valid[s & 0xfff]) rocks++;
    else if (s === 0) holes++;
  }
  if (rocks !== rock || holes !== hole) return;
  if (hole === 0) w.set(x, y, z, stateOf(B.lava));
  else flow(g, w, x, y, z);
}

export function springs(g: NetherGen, w: Writer, biome: (x: number, z: number) => number) {
  scatter(g, w, 0x5b01, () => 8, 10, 117, 12, (x, y, z) => {
    if (biome(x, z) !== NB.basalt) spring(g, w, x, y, z, RACK_ONLY, 4, 1);
  });
  scatter(g, w, 0x5b02, () => 16, 10, 117, 0, (x, y, z) => {
    if (biome(x, z) !== NB.basalt) spring(g, w, x, y, z, RACK_ONLY, 5, 0);
  });
  scatter(g, w, 0x5b03, () => 16, 4, 123, 12, (x, y, z) => {
    if (biome(x, z) === NB.basalt) spring(g, w, x, y, z, DELTA_ROCK, 4, 1);
  });
  scatter(g, w, 0x5b04, () => 32, 10, 117, 0, (x, y, z) => {
    if (biome(x, z) === NB.basalt) spring(g, w, x, y, z, RACK_ONLY, 5, 0);
  });
}
