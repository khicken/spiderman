import { stateOf } from "../contracts";
import { B } from "./ids";
import { NB, type NetherGen } from "./nether-gen";
import { blockAt, everyLayer, rockAt, scatter, tr } from "./nether-features";
import { idTable, type Writer } from "./rng";

const S = stateOf;
const NO_DELTA = idTable(B.lava, B.magma_block, B.bedrock, B.nether_bricks, B.nether_brick_fence, B.nether_brick_stairs, B.nether_wart_block, B.chest, B.spawner);
const COLUMN_SKIP = idTable(B.lava);
COLUMN_SKIP[0] = 1;
const HX = [1, -1, 0, 0], HZ = [0, 0, 1, -1];

function blob(g: NetherGen, w: Writer, x: number, y: number, z: number, to: number) {
  const rx = 3 + tr.int(5), ry = 3 + tr.int(5), rz = 3 + tr.int(5);
  while (y > 1 && !rockAt(g, x, y, z)) y--;
  if (y <= 1) return;
  const m = Math.max(rx, ry, rz);
  const x0 = Math.max(x - rx, w.ox), x1 = Math.min(x + rx, w.ox + 15), z0 = Math.max(z - rz, w.oz), z1 = Math.min(z + rz, w.oz + 15);
  const s = S(to);
  for (let px = x0; px <= x1; px++)
    for (let pz = z0; pz <= z1; pz++)
      for (let py = Math.max(1, y - ry); py <= Math.min(126, y + ry); py++) {
        if (Math.abs(px - x) + Math.abs(py - y) + Math.abs(pz - z) > m) continue;
        if ((w.get(px, py, pz) & 0xfff) === B.netherrack) w.set(px, py, pz, s);
      }
}

function deltaClear(g: NetherGen, w: Writer, x: number, y: number, z: number) {
  const s = blockAt(g, w, x, y, z);
  if (s === 0 || NO_DELTA[s & 0xfff]) return false;
  if (blockAt(g, w, x, y + 1, z) !== 0 || blockAt(g, w, x, y - 1, z) === 0) return false;
  for (let d = 0; d < 4; d++) if (blockAt(g, w, x + HX[d], y, z + HZ[d]) === 0) return false;
  return true;
}

function delta(g: NetherGen, w: Writer, x: number, y: number, z: number) {
  const fy = y - 1;
  const rim = tr.next() < 0.9;
  const ri = rim ? tr.int(3) : 0, rj = rim ? tr.int(3) : 0;
  const rimOn = rim && ri !== 0 && rj !== 0;
  const k = 3 + tr.int(5), l = 3 + tr.int(5), m = Math.max(k, l);
  const lava = S(B.lava), magma = S(B.magma_block);
  for (let dx = -k; dx <= k; dx++) {
    for (let dz = -l; dz <= l; dz++) {
      if (Math.abs(dx) + Math.abs(dz) > m) continue;
      const px = x + dx, pz = z + dz;
      if (!deltaClear(g, w, px, fy, pz)) continue;
      if (rimOn) w.set(px, fy, pz, magma);
      if (deltaClear(g, w, px + ri, fy, pz + rj)) w.set(px + ri, fy, pz + rj, lava);
    }
  }
}

function columns(g: NetherGen, w: Writer, x: number, y: number, z: number, reach: () => number, h0: number, h1: number) {
  const j = h0 + tr.int(h1 - h0 + 1);
  const small = tr.next() < 0.9;
  const k = Math.min(j, small ? 5 : 8), tries = small ? 50 : 15;
  const basalt = S(B.basalt);
  for (let i = 0; i < tries; i++) {
    const px = x + tr.int(2 * k + 1) - k, pz = z + tr.int(2 * k + 1) - k;
    const h = j - Math.abs(px - x) - Math.abs(pz - z) + reach() - 1;
    if (h < 0 || !w.inside(px, pz)) continue;
    let py = y;
    if (COLUMN_SKIP[w.get(px, py, pz) & 0xfff]) {
      let n = 0;
      while (n++ < 8 && py > 1 && COLUMN_SKIP[w.get(px, py - 1, pz) & 0xfff]) py--;
    } else {
      let n = 0;
      while (n++ < 8 && py < 126 && !COLUMN_SKIP[w.get(px, py, pz) & 0xfff]) py++;
    }
    for (let t = 0; t <= h && py + t < 127; t++) {
      const c = w.get(px, py + t, pz);
      if (!COLUMN_SKIP[c & 0xfff] || ((c & 0xfff) === B.lava && py + t > 31)) break;
      w.set(px, py + t, pz, basalt);
    }
  }
}

export function deltaFeatures(g: NetherGen, w: Writer) {
  const inDeltas = (x: number, z: number) => g.biomeAt(x, z) === NB.basalt;
  scatter(g, w, 0xba51, () => 75, 0, 127, 8, (x, y, z) => {
    if (inDeltas(x, z)) blob(g, w, x, y, z, B.basalt);
  });
  scatter(g, w, 0xb1ac, () => 25, 0, 127, 8, (x, y, z) => {
    if (inDeltas(x, z)) blob(g, w, x, y, z, B.blackstone);
  });
  for (let ocz = w.cz - 1; ocz <= w.cz + 1; ocz++) {
    for (let ocx = w.cx - 1; ocx <= w.cx + 1; ocx++) {
      everyLayer(g, w, ocx, ocz, 0xde17, 40, 10, (x, y, z) => {
        if (inDeltas(x, z)) delta(g, w, x, y, z);
      });
      everyLayer(g, w, ocx, ocz, 0xc015, 4, 6, (x, y, z) => {
        if (inDeltas(x, z)) columns(g, w, x, y, z, () => 1, 1, 4);
      });
      everyLayer(g, w, ocx, ocz, 0xc016, 2, 11, (x, y, z) => {
        if (inDeltas(x, z)) columns(g, w, x, y, z, () => 2 + tr.int(2), 5, 10);
      });
    }
  }
}

function pillar(g: NetherGen, w: Writer, x: number, y: number, z: number) {
  if (blockAt(g, w, x, y, z) !== 0 || blockAt(g, w, x, y + 1, z) === 0) return;
  const basalt = S(B.basalt);
  const sides = [true, true, true, true];
  let py = y;
  while (py > 1 && blockAt(g, w, x, py, z) === 0) {
    w.set(x, py, z, basalt);
    for (let d = 0; d < 4; d++) {
      const stop = tr.int(5) === 0;
      if (!sides[d]) continue;
      if (stop) sides[d] = false;
      else if (blockAt(g, w, x + HX[d], py, z + HZ[d]) === 0) w.set(x + HX[d], py, z + HZ[d], basalt);
    }
    py--;
  }
  py++;
  for (let d = 0; d < 4; d++) if (tr.next() < 0.5 && blockAt(g, w, x + HX[d], py, z + HZ[d]) === 0) w.set(x + HX[d], py, z + HZ[d], basalt);
  for (let i = -3; i < 4; i++) {
    for (let j = -3; j < 4; j++) {
      if (tr.int(10) >= 10 - Math.abs(i) * Math.abs(j)) continue;
      let by = py;
      for (let n = 0; n < 3 && blockAt(g, w, x + i, by - 1, z + j) === 0; n++) by--;
      if (blockAt(g, w, x + i, by, z + j) === 0 && blockAt(g, w, x + i, by - 1, z + j) !== 0) w.set(x + i, by, z + j, basalt);
    }
  }
}

function fossil(g: NetherGen, w: Writer, x: number, y: number, z: number) {
  while (y > 32 && !(blockAt(g, w, x, y, z) === 0 && rockAt(g, x, y - 1, z))) y--;
  if (y <= 32) return;
  const bone = (ax: number) => S(B.bone_block, ax);
  const alongX = tr.next() < 0.5;
  const ax = alongX ? 1 : 2;
  const kind = tr.int(3);
  const len = 4 + tr.int(5);
  const sink = tr.int(2);
  const at = (a: number, h: number, b: number, s: number) => {
    const px = alongX ? x + a : x + b, pz = alongX ? z + b : z + a;
    w.setIf(px, y + h - sink, pz, s, FOSSIL_REPLACE);
  };
  if (kind === 2) {
    for (let a = 0; a < 3; a++)
      for (let h = 0; h < 3; h++)
        for (let b = -1; b <= 1; b++) if (!(h === 1 && a === 2 && b !== 0) && !(a === 1 && h === 1 && b === 0)) at(a, h, b, bone(0));
    return;
  }
  const height = kind === 0 ? 3 + tr.int(2) : 2;
  for (let a = 0; a < len; a++) {
    at(a, height, 0, bone(ax));
    if (a % 2 !== 0) continue;
    const half = kind === 0 ? 2 : 1 + tr.int(2);
    for (let b = 1; b <= half; b++) {
      at(a, height, b, bone(alongX ? 2 : 1));
      at(a, height, -b, bone(alongX ? 2 : 1));
    }
    for (let h = 0; h < height; h++) {
      at(a, h, half + (kind === 0 ? 1 : 0), bone(0));
      at(a, h, -half - (kind === 0 ? 1 : 0), bone(0));
    }
  }
}
const FOSSIL_REPLACE = idTable(B.soul_sand, B.soul_soil, B.netherrack, B.basalt);
FOSSIL_REPLACE[0] = 1;

export function soulValleyFeatures(g: NetherGen, w: Writer) {
  const inValley = (x: number, z: number) => g.biomeAt(x, z) === NB.soul;
  scatter(g, w, 0xbb11, () => 10, 10, 117, 4, (x, y, z) => {
    if (inValley(x, z)) pillar(g, w, x, y, z);
  });
  // Vanilla nether_fossil structure: spacing 2, separation 1, so about one per 4 chunks of soul sand valley.
  scatter(g, w, 0xf055, (r) => (r.int(4) === 0 ? 1 : 0), 32, 126, 10, (x, y, z) => {
    if (inValley(x, z)) fossil(g, w, x, y, z);
  });
}
