import { MIN_Y, stateOf } from "../contracts";
import { B } from "./ids";
import { idTable, type Rng, type Writer } from "./rng";
import { leaf, log } from "./tree-shapes";

const S = stateOf;

// Logical pale oak shape after vanilla DarkOakTrunkPlacer(6, 2, 1) + DarkOakFoliagePlacer, as flat x,y,z triples.
export interface PalePlan {
  logs: number[];
  leaves: number[];
  trunk: number[]; // cells with trunk logs directly above and below
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function palePlan(r: Rng, x: number, y: number, z: number): PalePlan {
  const logs: number[] = [], leaves: number[] = [], trunk: number[] = [];
  const h = 6 + r.int(3);
  const [dx, dz] = DIRS[r.int(4)];
  const bendStart = h - r.int(4);
  let bendLen = 2 - r.int(3);
  let tx = x, tz = z;
  for (let i = 0; i < h; i++) {
    if (i >= bendStart && bendLen > 0) {
      tx += dx;
      tz += dz;
      bendLen--;
    }
    for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) {
      logs.push(tx + a, y + i, tz + c);
      if (i >= 1 && i <= bendStart - 2) trunk.push(tx + a, y + i, tz + c);
    }
  }
  const top = y + h - 1;
  for (let bx = -1; bx <= 2; bx++) {
    for (let bz = -1; bz <= 2; bz++) {
      if (bx >= 0 && bx <= 1 && bz >= 0 && bz <= 1) continue;
      if (r.int(3) !== 0) continue;
      const len = 2 + r.int(3);
      for (let k = 0; k < len; k++) logs.push(tx + bx, top - k - 1, tz + bz);
    }
  }
  const crown = top + 1;
  for (let dy = -2; dy <= 1; dy++) {
    const rad = dy === 1 ? 2 : dy === -2 ? 3 : 4;
    for (let ax = -rad; ax <= rad + 1; ax++) {
      for (let az = -rad; az <= rad + 1; az++) {
        const ex = ax - 0.5, ez = az - 0.5;
        if (ex * ex + ez * ez > rad * rad + 1) continue;
        if (dy === -2 && ex * ex + ez * ez > (rad - 1) * (rad - 1) && r.chance(0.5)) continue;
        leaves.push(tx + ax, crown + dy, tz + az);
      }
    }
  }
  return { logs, leaves, trunk };
}

const MOSS_GROUND = idTable(B.grass_block, B.dirt, B.podzol, B.coarse_dirt, B.rooted_dirt, B.pale_moss_block);
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

// Worldgen pale oak. Every rng draw happens whatever the chunk, so a tree crossing chunk borders comes out the same in each.
export function paleOak(w: Writer, r: Rng, x: number, y: number, z: number, heart: boolean) {
  const p = palePlan(r, x, y, z);
  for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) {
    const b = w.get(x + a, y - 1, z + c) & 0xfff;
    if (b === B.grass_block || b === B.pale_moss_block || b === B.podzol) w.set(x + a, y - 1, z + c, S(B.dirt));
  }
  const { logs, leaves } = p;
  for (let i = 0; i < logs.length; i += 3) log(logs[i], logs[i + 1], logs[i + 2], B.pale_oak_log);
  for (let i = 0; i < leaves.length; i += 3) leaf(leaves[i], leaves[i + 1], leaves[i + 2], B.pale_oak_leaves);

  const solid = new Set<string>();
  for (let i = 0; i < logs.length; i += 3) solid.add(key(logs[i], logs[i + 1], logs[i + 2]));
  for (let i = 0; i < leaves.length; i += 3) solid.add(key(leaves[i], leaves[i + 1], leaves[i + 2]));
  const LEAF = S(B.pale_oak_leaves);
  for (let i = 0; i < leaves.length; i += 3) {
    const lx = leaves[i], ly = leaves[i + 1], lz = leaves[i + 2];
    if (solid.has(key(lx, ly - 1, lz))) continue;
    const hang = r.chance(0.15);
    const len = 1 + r.int(3);
    if (!hang || w.get(lx, ly, lz) !== LEAF) continue;
    let n = 0;
    while (n < len && w.get(lx, ly - 1 - n, lz) === 0) n++;
    for (let k = 0; k < n; k++) w.set(lx, ly - 1 - k, lz, S(B.pale_hanging_moss, k === n - 1 ? 0 : 1));
  }

  if (r.chance(0.4)) trunkMoss(w, r, x, y, z);
  if (r.chance(0.8)) mossPatch(w, r, x + 0.5, y, z + 0.5, 2 + r.int(2));

  if (heart && p.trunk.length) {
    const t = r.int(p.trunk.length / 3) * 3;
    const hx = p.trunk[t], hy = p.trunk[t + 1], hz = p.trunk[t + 2];
    const LOG = B.pale_oak_log;
    if (w.inside(hx, hz) && (w.get(hx, hy, hz) & 0xfff) === LOG && (w.get(hx, hy + 1, hz) & 0xfff) === LOG && (w.get(hx, hy - 1, hz) & 0xfff) === LOG) {
      w.set(hx, hy, hz, S(B.creaking_heart, 1 << 2));
      w.blockEntities.push({ x: hx, y: hy, z: hz, type: "creaking_heart", data: { natural: true } });
    }
  }
}

// Horizontal index h: 0 south (+z), 1 west (-x), 2 north (-z), 3 east (+x). Carpet meta bit h covers that side.
const TRUNK_MOSS_OVER = idTable(B.short_grass, B.pale_moss_carpet);
TRUNK_MOSS_OVER[0] = 1;
const H_DIRS = [[0, 1], [-1, 0], [0, -1], [1, 0]];

// Pale moss carpets on the ground ring around the 2x2 trunk base, climbing the side that faces the trunk.
// Base logs on a slope can be blocked by terrain, so in-chunk ones are read; one across the chunk border is assumed from the plan.
function trunkMoss(w: Writer, r: Rng, x: number, y: number, z: number) {
  for (let dx = -1; dx <= 2; dx++) {
    for (let dz = -1; dz <= 2; dz++) {
      const ring = (dx === -1 || dx === 2) !== (dz === -1 || dz === 2);
      if (!ring) continue;
      const keep = r.chance(0.75);
      const cx = x + dx, cz = z + dz;
      if (!keep || !w.inside(cx, cz) || !TRUNK_MOSS_OVER[w.get(cx, y, cz) & 0xfff] || !MOSS_GROUND[w.get(cx, y - 1, cz) & 0xfff]) continue;
      let sides = 0;
      for (let h = 0; h < 4; h++) {
        const nx = dx + H_DIRS[h][0], nz = dz + H_DIRS[h][1];
        if (nx < 0 || nx > 1 || nz < 0 || nz > 1) continue;
        const n = w.get(x + nx, y, z + nz);
        if (n === -1 || (n & 0xfff) === B.pale_oak_log) sides |= 1 << h;
      }
      if (sides) w.set(cx, y, cz, S(B.pale_moss_carpet, sides));
    }
  }
}

// Vanilla pale_moss_patch: pale moss replaces the ground top, with carpets on some of it.
function mossPatch(w: Writer, r: Rng, cx: number, y: number, cz: number, rad: number) {
  const ir = Math.ceil(rad);
  for (let dx = -ir; dx <= ir; dx++) {
    for (let dz = -ir; dz <= ir; dz++) {
      const roll = r.next(), carpet = r.next();
      const x = Math.floor(cx + dx), z = Math.floor(cz + dz);
      const ox = x + 0.5 - cx, oz = z + 0.5 - cz;
      if (ox * ox + oz * oz > rad * rad || roll > 0.85 || !w.inside(x, z)) continue;
      for (let gy = y + 1; gy >= y - 4 && gy > MIN_Y; gy--) {
        const g = w.get(x, gy, z) & 0xfff;
        if (!MOSS_GROUND[g]) continue;
        const above = w.get(x, gy + 1, z) & 0xfff;
        if (above !== 0 && above !== B.short_grass && above !== B.pale_moss_carpet) break;
        w.set(x, gy, z, S(B.pale_moss_block));
        if (carpet < 0.4 && above !== B.pale_moss_carpet) w.set(x, gy + 1, z, S(B.pale_moss_carpet));
        break;
      }
    }
  }
}

export function paleGroundPlant(blocks: Uint16Array, i: number, ground: number, r: number, r2: number): boolean {
  if (ground === B.pale_moss_block) {
    if (r < 0.012) blocks[i] = S(B.closed_eyeblossom);
    else if (r2 < 0.45) blocks[i] = S(B.pale_moss_carpet);
    return true;
  }
  if (ground === B.grass_block || ground === B.dirt || ground === B.podzol || ground === B.coarse_dirt) {
    if (r < 0.012) blocks[i] = S(B.closed_eyeblossom);
    else if (ground === B.grass_block && r2 < 0.04) blocks[i] = S(B.short_grass);
    return true;
  }
  return false;
}
