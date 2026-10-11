import { stateOf } from "../contracts";
import { B } from "./ids";
import type { Rng, Writer } from "./rng";
import { loot } from "./structures";

const S = stateOf;
const MOBS = ["zombie", "skeleton", "spider", "husk", "stray", "slime", "silverfish", "cave_spider", "breeze"];
const CHAMBER_LOOT: [string, number, number, number][] = [
  ["arrow", 4, 8, 20], ["bread", 1, 3, 15], ["baked_potato", 1, 3, 15], ["trial_key", 1, 1, 4], ["emerald", 1, 3, 10],
  ["iron_ingot", 1, 2, 10], ["honey_bottle", 1, 2, 10], ["wind_charge", 1, 3, 15], ["tipped_arrow", 2, 4, 5], ["glow_berries", 2, 6, 10],
];

function box(w: Writer, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, wall: (x: number, y: number, z: number) => number) {
  if (x1 < w.ox || x0 > w.ox + 15 || z1 < w.oz || z0 > w.oz + 15) return;
  for (let x = Math.max(x0, w.ox); x <= Math.min(x1, w.ox + 15); x++) {
    for (let z = Math.max(z0, w.oz); z <= Math.min(z1, w.oz + 15); z++) {
      for (let y = y0; y <= y1; y++) {
        const edge = x === x0 || x === x1 || z === z0 || z === z1 || y === y0 || y === y1;
        w.set(x, y, z, edge ? wall(x, y, z) : 0);
      }
    }
  }
}

const shell = (floorY: number, ceilY: number) => (x: number, y: number, z: number) => {
  if (y === floorY) return S((x + z) % 7 === 0 ? B.chiseled_tuff : B.polished_tuff);
  if (y === ceilY) return S((x * 3 + z) % 5 === 0 ? B.waxed_copper_grate : B.tuff_bricks);
  if (y === floorY + 3) return S(B.chiseled_tuff_bricks);
  return S((x + y + z) % 11 === 0 ? B.waxed_cut_copper : B.tuff_bricks);
};

function spawner(w: Writer, x: number, y: number, z: number, mob: string) {
  w.set(x, y - 1, z, S(B.polished_tuff));
  w.set(x, y, z, S(B.trial_spawner));
  if (w.inside(x, z)) w.blockEntities.push({ x, y, z, type: "trial_spawner", data: { entity: mob, ominous: false, state: "waiting_for_players" } });
}

export function trialChamber(w: Writer, r: Rng, cx: number, cy: number, cz: number) {
  const R = 11, H = 10;
  box(w, cx - R, cy, cz - R, cx + R, cy + H, cz + R, shell(cy, cy + H));
  for (const [px, pz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
    for (let y = cy + 1; y < cy + H; y++) w.set(cx + px, y, cz + pz, S(y === cy + H - 1 ? B.waxed_copper_bulb : B.tuff_bricks));
  }
  const mobs = [MOBS[r.int(MOBS.length)], MOBS[r.int(MOBS.length)], MOBS[r.int(MOBS.length)], "breeze"];
  const spots = [[-8, 0], [8, 0], [0, -8], [0, 8]];
  spots.forEach(([dx, dz], i) => spawner(w, cx + dx, cy + 2, cz + dz, mobs[i]));
  for (const dx of [-1, 1]) {
    const vx = cx + dx, vz = cz;
    w.set(vx, cy + 1, vz, S(B.vault, dx < 0 ? 1 : 3));
    const items = loot(r, CHAMBER_LOOT, 3);
    if (w.inside(vx, vz)) w.blockEntities.push({ x: vx, y: cy + 1, z: vz, type: "vault", data: { key: "trial_key", ominous: false, loot: items } });
  }
  for (let k = 0; k < 10; k++) {
    const side = r.int(4), t = r.int(2 * R - 3) - R + 2;
    const px = side < 2 ? cx + (side === 0 ? -R + 1 : R - 1) : cx + t;
    const pz = side >= 2 ? cz + (side === 2 ? -R + 1 : R - 1) : cz + t;
    w.set(px, cy + 1, pz, S(B.decorated_pot));
  }
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of dirs) {
    const len = 14 + r.int(8);
    const sx = cx + dx * R, sz = cz + dz * R;
    const ex = sx + dx * len, ez = sz + dz * len;
    const x0 = Math.min(sx, ex) - (dz !== 0 ? 2 : 0), x1 = Math.max(sx, ex) + (dz !== 0 ? 2 : 0);
    const z0 = Math.min(sz, ez) - (dx !== 0 ? 2 : 0), z1 = Math.max(sz, ez) + (dx !== 0 ? 2 : 0);
    box(w, x0, cy, z0, x1, cy + 5, z1, shell(cy, cy + 5));
    const rx = ex + dx * 4, rz = ez + dz * 4;
    box(w, rx - 4, cy, rz - 4, rx + 4, cy + 6, rz + 4, shell(cy, cy + 6));
    for (let a = -1; a <= 1; a++) for (let k = 1; k <= 3; k++) w.set(ex + dz * a, cy + k, ez + dx * a, 0);
    spawner(w, rx, cy + 1, rz, MOBS[r.int(MOBS.length)]);
    const chx = rx + (dz !== 0 ? 3 : 0), chz = rz + (dx !== 0 ? 3 : 0);
    w.set(chx, cy + 1, chz, S(B.chest, 0));
    const items = loot(r, CHAMBER_LOOT, 3 + r.int(4));
    if (w.inside(chx, chz)) w.blockEntities.push({ x: chx, y: cy + 1, z: chz, type: "chest", items });
    w.set(rx - (dz !== 0 ? 3 : 0), cy + 1, rz - (dx !== 0 ? 3 : 0), S(B.barrel, 2));
    w.set(rx, cy + 5, rz, S(B.waxed_copper_bulb));
  }
  for (let a = -1; a <= 1; a++) {
    for (let k = 1; k <= 3; k++) {
      w.set(cx + R, cy + k, cz + a, 0);
      w.set(cx - R, cy + k, cz + a, 0);
      w.set(cx + a, cy + k, cz + R, 0);
      w.set(cx + a, cy + k, cz - R, 0);
    }
  }
}
