import { stateOf } from "../contracts";
import { B } from "./ids";
import { idTable, type Rng, type Writer } from "./rng";

const S = stateOf;
export const SOFT = idTable(
  B.short_grass, B.fern, B.tall_grass, B.tall_grass_upper, B.large_fern, B.large_fern_upper, B.snow, B.dead_bush, B.vine,
  B.dandelion, B.poppy, B.sweet_berry_bush, B.glow_lichen, B.pink_petals, B.moss_carpet, B.sugar_cane, B.brown_mushroom, B.red_mushroom,
);
SOFT[0] = 1;
const LOG_OK = new Uint8Array(SOFT);
for (const id of [B.oak_leaves, B.birch_leaves, B.spruce_leaves, B.jungle_leaves, B.acacia_leaves, B.dark_oak_leaves, B.mangrove_leaves, B.cherry_leaves, B.azalea_leaves, B.flowering_azalea_leaves, B.water, B.mangrove_roots, B.mangrove_propagule]) if (id) LOG_OK[id] = 1;
const ROOT_OK = new Uint8Array(LOG_OK);
for (const id of [B.mud, B.grass_block, B.dirt]) ROOT_OK[id] = 1;
export const GROUND = idTable(B.grass_block, B.dirt, B.podzol, B.coarse_dirt, B.mud, B.rooted_dirt, B.moss_block, B.mycelium, B.snow_block);

export interface Wood {
  log: number;
  leaves: number;
}
export const OAK: Wood = { log: B.oak_log, leaves: B.oak_leaves };
export const BIRCH: Wood = { log: B.birch_log, leaves: B.birch_leaves };
export const SPRUCE: Wood = { log: B.spruce_log, leaves: B.spruce_leaves };
export const JUNGLE: Wood = { log: B.jungle_log, leaves: B.jungle_leaves };
export const ACACIA: Wood = { log: B.acacia_log, leaves: B.acacia_leaves };
export const DARK_OAK: Wood = { log: B.dark_oak_log, leaves: B.dark_oak_leaves };
export const CHERRY: Wood = { log: B.cherry_log, leaves: B.cherry_leaves };

let w: Writer;
let r: Rng;
export function useTree(writer: Writer, rng: Rng) {
  w = writer;
  r = rng;
}

export const log = (x: number, y: number, z: number, id: number, axis = 0) => w.setIf(x, y, z, S(id, axis), LOG_OK);
export const leaf = (x: number, y: number, z: number, id: number) => w.setIf(x, y, z, S(id), SOFT);
export const put = (x: number, y: number, z: number, s: number) => w.setIf(x, y, z, s, SOFT);
const dirtUnder = (x: number, y: number, z: number) => {
  const b = w.get(x, y, z) & 0xfff;
  if (b === B.grass_block || b === B.mycelium || b === B.podzol) w.set(x, y, z, S(B.dirt));
};

function trunk(x: number, y: number, z: number, h: number, id: number) {
  dirtUnder(x, y - 1, z);
  for (let i = 0; i < h; i++) log(x, y + i, z, id);
}

// Vine meta is the pre-1.13 support bitmask: 1 south, 2 west, 4 north, 8 east.
function vinesAround(x: number, y: number, z: number, chance: number, maxLen: number) {
  const dirs = [[1, 0, 2], [-1, 0, 8], [0, 1, 4], [0, -1, 1]];
  for (const [dx, dz, m] of dirs) {
    if (!r.chance(chance)) continue;
    const len = 1 + r.int(maxLen);
    for (let k = 0; k < len; k++) {
      const yy = y - k;
      if (w.get(x + dx, yy, z + dz) !== 0) break;
      w.set(x + dx, yy, z + dz, S(B.vine, m));
    }
  }
}

function blob(x: number, top: number, z: number, id: number, layers: number, radius: number) {
  for (let dy = -layers; dy <= 0; dy++) {
    const rad = dy >= -1 ? radius - 1 : radius;
    for (let dx = -rad; dx <= rad; dx++) {
      for (let dz = -rad; dz <= rad; dz++) {
        if (Math.abs(dx) === rad && Math.abs(dz) === rad && rad > 0 && (dy === 0 || r.chance(0.5))) continue;
        leaf(x + dx, top + dy, z + dz, id);
      }
    }
  }
}

function sphere(x: number, y: number, z: number, rh: number, rv: number, id: number, holes = 0) {
  const ih = Math.ceil(rh), iv = Math.ceil(rv);
  for (let dx = -ih; dx <= ih; dx++) {
    for (let dy = -iv; dy <= iv; dy++) {
      for (let dz = -ih; dz <= ih; dz++) {
        const d = (dx * dx + dz * dz) / (rh * rh) + (dy * dy) / (rv * rv);
        if (d > 1) continue;
        if (holes > 0 && d > 0.6 && r.chance(holes)) continue;
        leaf(x + dx, y + dy, z + dz, id);
      }
    }
  }
}

export function oakTree(x: number, y: number, z: number, wood: Wood, h: number, vines = false, radius = 3) {
  trunk(x, y, z, h, wood.log);
  blob(x, y + h, z, wood.leaves, 3, radius);
  if (vines) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.abs(dx) === radius || Math.abs(dz) === radius) vinesAround(x + dx, y + h - 2, z + dz, 0.25, 4);
      }
    }
  }
}

export function fancyOak(x: number, y: number, z: number, wood: Wood) {
  const h = 6 + r.int(7);
  trunk(x, y, z, h, wood.log);
  const clusters = 2 + Math.floor(h / 4);
  for (let c = 0; c < clusters; c++) {
    const cy = y + h - c * 2 - r.int(2);
    if (cy < y + 3) break;
    const ang = r.next() * Math.PI * 2;
    const dist = c === 0 ? 0 : 1 + r.next() * 3;
    const cx = Math.round(x + Math.cos(ang) * dist), cz = Math.round(z + Math.sin(ang) * dist);
    const steps = Math.max(Math.abs(cx - x), Math.abs(cz - z));
    for (let s = 1; s <= steps; s++) {
      const bx = Math.round(x + ((cx - x) * s) / steps), bz = Math.round(z + ((cz - z) * s) / steps);
      const by = cy - 2 - Math.round(((steps - s) * 1) / Math.max(1, steps));
      log(bx, by, bz, wood.log, Math.abs(cx - x) >= Math.abs(cz - z) ? 1 : 2);
    }
    sphere(cx, cy, cz, 2.6, 1.8, wood.leaves, 0.15);
  }
}

// Square leaf row skipping the four corners, like FoliagePlacer.placeLeavesRow for spruce and pine.
function row(x: number, y: number, z: number, rad: number) {
  for (let dx = -rad; dx <= rad; dx++) {
    for (let dz = -rad; dz <= rad; dz++) {
      if (rad > 0 && Math.abs(dx) === rad && Math.abs(dz) === rad) continue;
      leaf(x + dx, y, z + dz, B.spruce_leaves);
    }
  }
}

// SpruceFoliagePlacer: radius 2-3, offset 0-2, foliage height max(4, h - 1..2); rows alternate between 1 and the radius below the tip.
export function spruceTree(x: number, y: number, z: number, h: number) {
  trunk(x, y, z, h, B.spruce_log);
  const radius = 2 + r.int(2), offset = r.int(3), fh = Math.max(4, h - 1 - r.int(2));
  let i = r.int(2), j = 1, k = 0;
  for (let l = offset; l >= -fh; l--) {
    row(x, y + h + l, z, i);
    if (i >= j) {
      i = k;
      k = 1;
      j = Math.min(j + 1, radius);
    } else i++;
  }
}

// PineFoliagePlacer: radius 1-2, offset 1, foliage height 3-4; a short tuft over a bare trunk.
export function pineTree(x: number, y: number, z: number, h: number) {
  trunk(x, y, z, h, B.spruce_log);
  const radius = 1 + r.int(2), fh = 3 + r.int(2);
  let i = 0;
  for (let j = 1; j >= 1 - fh; j--) {
    row(x, y + h + j, z, i);
    if (i >= 1 && j === 1 - fh + 1) i--;
    else if (i < radius) i++;
  }
}

function trunk2(x: number, y: number, z: number, h: number, id: number) {
  for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) {
    dirtUnder(x + dx, y - 1, z + dz);
    for (let i = 0; i < h; i++) log(x + dx, y + i, z + dz, id);
  }
}

function disc(x: number, y: number, z: number, rad: number, id: number, two: boolean) {
  const o = two ? 0.5 : 0;
  for (let dx = -rad - 1; dx <= rad + 1; dx++) {
    for (let dz = -rad - 1; dz <= rad + 1; dz++) {
      const ex = dx - o, ez = dz - o;
      if (ex * ex + ez * ez > rad * rad + 0.5) continue;
      leaf(x + dx, y, z + dz, id);
    }
  }
}

// GiantTrunkPlacer + MegaPineFoliagePlacer: crown 13-17 (spruce) or 3-7 (pine), radius widening to 3 with every other row stepped out.
export function megaSpruce(x: number, y: number, z: number, pine: boolean) {
  const h = 13 + r.int(3) + r.int(15);
  trunk2(x, y, z, h, B.spruce_log);
  const fh = pine ? 3 + r.int(5) : 13 + r.int(5);
  let prev = 0;
  for (let yy = y + h - fh; yy <= y + h; yy++) {
    const k = y + h - yy, l = Math.floor((k / fh) * 3.5);
    const m = k > 0 && l === prev && (yy & 1) === 0 ? l + 1 : l;
    for (let dx = -m; dx <= m + 1; dx++) {
      for (let dz = -m; dz <= m + 1; dz++) {
        const ax = dx > 0 ? dx - 1 : -dx, az = dz > 0 ? dz - 1 : -dz;
        if (ax + az >= 7 || ax * ax + az * az > m * m) continue;
        leaf(x + dx, yy, z + dz, B.spruce_leaves);
      }
    }
    prev = l;
  }
}

export function megaJungle(x: number, y: number, z: number) {
  const h = 10 + r.int(20);
  trunk2(x, y, z, h, B.jungle_log);
  for (let k = -1; k <= 1; k++) disc(x, y + h + k, z, k === 1 ? 2 : 3, B.jungle_leaves, true);
  for (let by = y + h - 3; by > y + 4; by -= 2 + r.int(4)) {
    const ang = r.next() * Math.PI * 2;
    const len = 2 + r.int(3);
    let bx = x, bz = z;
    for (let s = 1; s <= len; s++) {
      bx = Math.round(x + 0.5 + Math.cos(ang) * s);
      bz = Math.round(z + 0.5 + Math.sin(ang) * s);
      log(bx, by + Math.floor(s / 2), bz, B.jungle_log, Math.abs(Math.cos(ang)) > 0.7 ? 1 : 2);
    }
    disc(bx, by + Math.floor(len / 2) + 1, bz, 2, B.jungle_leaves, false);
    disc(bx, by + Math.floor(len / 2) + 2, bz, 1, B.jungle_leaves, false);
  }
  for (let i = 0; i < h; i++) {
    for (const [dx, dz, m] of [[-1, 0, 8], [-1, 1, 8], [2, 0, 2], [2, 1, 2], [0, -1, 1], [1, -1, 1], [0, 2, 4], [1, 2, 4]]) {
      if (r.chance(0.25)) put(x + dx, y + i, z + dz, S(B.vine, m));
    }
  }
}

// Cocoa meta: bits 0-1 facing toward the log (0 south, 1 west, 2 north, 3 east), bits 2-3 age.
export function jungleTree(x: number, y: number, z: number) {
  const h = 4 + r.int(7);
  oakTree(x, y, z, JUNGLE, h, true);
  for (let i = 1; i < h - 2; i++) {
    for (const [dx, dz, face, vm] of [[1, 0, 1, 2], [-1, 0, 3, 8], [0, 1, 2, 4], [0, -1, 0, 1]]) {
      if (h > 5 && r.chance(0.06)) put(x + dx, y + i, z + dz, S(B.cocoa, face | (r.int(3) << 2)));
      else if (r.chance(0.3)) put(x + dx, y + i, z + dz, S(B.vine, vm));
    }
  }
}

export function jungleBush(x: number, y: number, z: number) {
  dirtUnder(x, y - 1, z);
  log(x, y, z, B.jungle_log);
  for (let dy = 0; dy <= 2; dy++) {
    const rad = 2 - dy;
    for (let dx = -rad; dx <= rad; dx++) {
      for (let dz = -rad; dz <= rad; dz++) {
        if (rad > 0 && Math.abs(dx) === rad && Math.abs(dz) === rad && r.chance(0.6)) continue;
        leaf(x + dx, y + dy, z + dz, B.oak_leaves);
      }
    }
  }
}

export function acaciaTree(x: number, y: number, z: number) {
  const h = 5 + r.int(3) + r.int(3);
  const bendAt = h - r.int(4) - 1;
  const bends = 1 + r.int(3);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const [dx, dz] = dirs[r.int(4)];
  dirtUnder(x, y - 1, z);
  let tx = x, tz = z, top = y;
  for (let i = 0; i < h; i++) {
    if (i >= bendAt && i - bendAt < bends) {
      tx += dx;
      tz += dz;
    }
    log(tx, y + i, tz, B.acacia_log);
    top = y + i;
  }
  canopy(tx, top + 1, tz);
  const [ex, ez] = dirs[r.int(4)];
  if ((ex !== dx || ez !== dz) && r.chance(0.6)) {
    let bx = x, bz = z;
    const start = bendAt - 1 - r.int(2);
    let by = y + start;
    const len = 1 + r.int(3);
    for (let i = 0; i < len; i++) {
      bx += ex;
      bz += ez;
      by++;
      log(bx, by, bz, B.acacia_log);
    }
    canopy(bx, by + 1, bz);
  }
}

function canopy(x: number, y: number, z: number) {
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
      if ((Math.abs(dx) === 3 || Math.abs(dz) === 3) && Math.abs(dx) + Math.abs(dz) > 4) continue;
      leaf(x + dx, y - 1, z + dz, B.acacia_leaves);
    }
  }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) leaf(x + dx, y, z + dz, B.acacia_leaves);
  leaf(x + 2, y, z, B.acacia_leaves);
  leaf(x - 2, y, z, B.acacia_leaves);
  leaf(x, y, z + 2, B.acacia_leaves);
  leaf(x, y, z - 2, B.acacia_leaves);
}

export function darkOak(x: number, y: number, z: number) {
  const h = 6 + r.int(3) + r.int(2);
  trunk2(x, y, z, h, B.dark_oak_log);
  const top = y + h;
  for (let dy = -2; dy <= 1; dy++) {
    const rad = dy === 1 ? 2 : dy === -2 ? 3 : 4;
    for (let dx = -rad; dx <= rad + 1; dx++) {
      for (let dz = -rad; dz <= rad + 1; dz++) {
        const ex = dx - 0.5, ez = dz - 0.5;
        if (ex * ex + ez * ez > rad * rad + 1) continue;
        if (dy === -2 && ex * ex + ez * ez > (rad - 1) * (rad - 1) && r.chance(0.5)) continue;
        leaf(x + dx, top + dy, z + dz, B.dark_oak_leaves);
      }
    }
  }
  for (let k = 0; k < 2; k++) {
    if (!r.chance(0.6)) continue;
    const bx = x + (r.chance(0.5) ? -1 : 2), bz = z + r.int(2);
    const bh = 1 + r.int(3);
    for (let i = 0; i < bh; i++) log(bx, top - 2 - i, bz, B.dark_oak_log);
  }
}

export function hugeMushroom(x: number, y: number, z: number, red: boolean) {
  const h = 4 + r.int(3) + (r.chance(1 / 12) ? 4 : 0);
  dirtUnder(x, y - 1, z);
  for (let i = 0; i < h; i++) log(x, y + i, z, B.mushroom_stem);
  if (red) {
    for (let dy = h - 3; dy <= h; dy++) {
      const rad = dy === h ? 1 : 2;
      for (let dx = -rad; dx <= rad; dx++) {
        for (let dz = -rad; dz <= rad; dz++) {
          const edge = Math.abs(dx) === rad || Math.abs(dz) === rad;
          if (dy < h && !edge) continue;
          if (dy < h && Math.abs(dx) === rad && Math.abs(dz) === rad) continue;
          put(x + dx, y + dy, z + dz, S(B.red_mushroom_block));
        }
      }
    }
  } else {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
        put(x + dx, y + h, z + dz, S(B.brown_mushroom_block));
      }
    }
  }
}

export function mangroveTree(x: number, y: number, z: number, groundY: number) {
  const lift = 2 + r.int(3);
  const base = Math.max(y, 63) + lift - (y < 63 ? 0 : 1);
  const h = 4 + r.int(5);
  for (let i = 0; i < h; i++) log(x, base + i, z, B.mangrove_log);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  const roots = 3 + r.int(4);
  for (let k = 0; k < roots; k++) {
    const [dx, dz] = dirs[(k + r.int(8)) % 8];
    let rx = x, rz = z;
    for (let yy = base - 1, s = 0; yy >= groundY - 1; yy--, s++) {
      if (s === 1 || s === 3) {
        rx += dx;
        rz += dz;
      }
      const b = w.get(rx, yy, rz) & 0xfff;
      if (b === B.mud || b === B.dirt || b === B.grass_block) {
        w.set(rx, yy, rz, S(B.muddy_mangrove_roots));
        break;
      }
      if (ROOT_OK[b] || b === 0) w.set(rx, yy, rz, S(B.mangrove_roots));
    }
  }
  const top = base + h;
  sphere(x, top - 1, z, 3.2, 2.2, B.mangrove_leaves, 0.2);
  for (let k = 0; k < 4; k++) {
    const px = x + r.int(7) - 3, pz = z + r.int(7) - 3;
    const py = top - 3 - r.int(2);
    if (w.get(px, py, pz) === 0 && (w.get(px, py + 1, pz) & 0xfff) === B.mangrove_leaves) w.set(px, py, pz, S(B.mangrove_propagule, 8));
  }
  for (let k = 0; k < 6; k++) vinesAround(x + r.int(7) - 3, top - 3, z + r.int(7) - 3, 0.2, 3);
}

export function cherryTree(x: number, y: number, z: number) {
  const h = 4 + r.int(3);
  trunk(x, y, z, h, B.cherry_log);
  const branches = 1 + r.int(2) + (r.chance(0.3) ? 1 : 0);
  const ang0 = r.next() * Math.PI * 2;
  sphere(x, y + h + 1, z, 3.5, 2, B.cherry_leaves, 0.25);
  for (let b = 0; b < branches; b++) {
    const ang = ang0 + (b * Math.PI * 2) / branches;
    const len = 2 + r.int(3);
    let bx = x, bz = z, by = y + h - 2 - r.int(2);
    for (let s = 1; s <= len; s++) {
      bx = Math.round(x + Math.cos(ang) * s);
      bz = Math.round(z + Math.sin(ang) * s);
      if (s > 1) by++;
      log(bx, by, bz, B.cherry_log, Math.abs(Math.cos(ang)) > 0.7 ? 1 : 2);
    }
    log(bx, by + 1, bz, B.cherry_log);
    sphere(bx, by + 2, bz, 3.8, 2.2, B.cherry_leaves, 0.3);
  }
}

export function azaleaTree(x: number, y: number, z: number) {
  const h = 3 + r.int(2);
  w.set(x, y - 1, z, S(B.rooted_dirt));
  let tx = x, tz = z;
  for (let i = 0; i < h; i++) {
    if (i === h - 1 && r.chance(0.5)) tx += r.chance(0.5) ? 1 : -1;
    log(tx, y + i, tz, B.oak_log);
  }
  const top = y + h;
  for (let dy = -1; dy <= 1; dy++) {
    const rad = dy === 1 ? 1 : 2;
    for (let dx = -rad; dx <= rad; dx++) {
      for (let dz = -rad; dz <= rad; dz++) {
        if (Math.abs(dx) === rad && Math.abs(dz) === rad && r.chance(0.6)) continue;
        leaf(tx + dx, top + dy, tz + dz, r.chance(0.3) ? B.flowering_azalea_leaves : B.azalea_leaves);
      }
    }
  }
  for (let k = 1; k < 5; k++) {
    const b = w.get(x, y - 1 - k, z) & 0xfff;
    if (b === B.stone || b === B.dirt || b === B.deepslate) w.set(x, y - 1 - k, z, S(B.rooted_dirt));
    else if (b === 0) {
      w.set(x, y - 1 - k, z, S(B.hanging_roots));
      break;
    }
  }
}

export function bush(x: number, y: number, z: number, wood: Wood) {
  log(x, y, z, wood.log);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) leaf(x + dx, y, z + dz, wood.leaves);
  leaf(x, y + 1, z, wood.leaves);
}

export function beeNest(x: number, y: number, z: number) {
  put(x, y, z + 1, S(B.bee_nest, 4));
  if (!w.inside(x, z + 1) || (w.get(x, y, z + 1) & 0xfff) !== B.bee_nest) return;
  const n = 2 + r.int(2);
  for (let i = 0; i < n; i++) w.entities.push({ type: "bee", x: x + 0.5, y: y + 0.2, z: z + 2.5, data: { hive: [x, y, z + 1] } });
}
