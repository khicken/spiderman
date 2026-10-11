import { MIN_Y, stateOf, type ItemStack } from "../contracts";
import { B } from "./ids";
import { hash32 } from "./noise";
import type { ChunkCtx } from "./overworld";
import { createRng, idTable, type Rng, type Writer } from "./rng";
import { BI } from "./surface";
import { trialChamber } from "./trial";
import { village, VILLAGE_BIOMES } from "./village";

const S = stateOf;
const rng = createRng();

// Vanilla random spread placement: one candidate chunk per region of `spacing` chunks.
export function regionStart(seed: number, salt: number, rx: number, rz: number, spacing: number, separation: number, out: { x: number; z: number }) {
  const h = hash32(seed, rx, rz, salt);
  const span = spacing - separation;
  out.x = rx * spacing + (h % span);
  out.z = rz * spacing + ((h >>> 16) % span);
}

const start = { x: 0, z: 0 };

function forStarts(ctx: ChunkCtx, salt: number, spacing: number, separation: number, reach: number, fn: (scx: number, scz: number) => void) {
  const seen = new Set<number>();
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dz = -reach; dz <= reach; dz++) {
      const rx = Math.floor((ctx.cx + dx) / spacing), rz = Math.floor((ctx.cz + dz) / spacing);
      const key = rx * 65536 + rz;
      if (seen.has(key)) continue;
      seen.add(key);
      regionStart(ctx.g.seed, salt, rx, rz, spacing, separation, start);
      if (Math.abs(start.x - ctx.cx) <= reach && Math.abs(start.z - ctx.cz) <= reach) fn(start.x, start.z);
    }
  }
}

export function placeStructures(ctx: ChunkCtx, w: Writer) {
  const { ow, seed } = ctx.g;
  for (let ocx = ctx.cx - 1; ocx <= ctx.cx + 1; ocx++) {
    for (let ocz = ctx.cz - 1; ocz <= ctx.cz + 1; ocz++) {
      rng.seed(hash32(seed, ocx, ocz, 0xde11));
      if (!rng.chance(1 / 500)) continue;
      const x = ocx * 16 + 4 + rng.int(8), z = ocz * 16 + 4 + rng.int(8);
      if (ow.biomeAt(x, z) !== BI.desert) continue;
      const y = ow.surfaceY(x, z);
      if (y >= 63) desertWell(w, x, y, z);
    }
  }
  forStarts(ctx, 0x9071, 40, 15, 1, (scx, scz) => {
    const x = scx * 16 + 8, z = scz * 16 + 8;
    const y = ow.surfaceY(x, z);
    if (y < 40) return;
    rng.seed(hash32(seed, scx, scz, 0x9072));
    ruinedPortal(w, rng, x, Math.max(y, 63) - (rng.chance(0.3) ? 0 : 1), z);
  });
  forStarts(ctx, 0x7111, 34, 8, 3, (scx, scz) => {
    const x = scx * 16 + 8, z = scz * 16 + 8;
    if (!VILLAGE_BIOMES.has(ow.biomeAt(x, z))) return;
    const y = ow.surfaceY(x, z);
    if (y < 63 || y > 120) return;
    village(ctx, w, scx, scz, x, y, z);
  });
  forStarts(ctx, 0x7a1a, 34, 12, 3, (scx, scz) => {
    rng.seed(hash32(seed, scx, scz, 0x7a1b));
    trialChamber(w, rng, scx * 16 + 8, -40 + rng.int(20), scz * 16 + 8);
  });
  dungeons(ctx, w);
}

function desertWell(w: Writer, x: number, y: number, z: number) {
  const SS = S(B.sandstone), SLAB = S(B.sandstone_slab), WATER = S(B.water);
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = -3; dy <= 0; dy++) w.set(x + dx, y + dy, z + dz, SS);
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      w.set(x + dx, y + 1, z + dz, edge ? SLAB : 0);
      for (let dy = 2; dy <= 4; dy++) w.set(x + dx, y + dy, z + dz, 0);
    }
  }
  for (let dy = -2; dy <= 0; dy++) w.set(x, y + dy, z, WATER);
  w.set(x, y - 3, z, S(B.suspicious_sand));
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) w.set(x + dx, y, z + dz, WATER);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (dx === 0 && dz === 0) continue;
    if (Math.abs(dx) === 1 && Math.abs(dz) === 1) {
      for (let dy = 1; dy <= 3; dy++) w.set(x + dx, y + dy, z + dz, SS);
    } else w.set(x + dx, y + 1, z + dz, SS);
  }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.set(x + dx, y + 4, z + dz, dx === 0 && dz === 0 ? SS : SLAB);
}

function ruinedPortal(w: Writer, r: Rng, x: number, y: number, z: number) {
  const alongX = r.chance(0.5);
  const wid = 4, hei = 5;
  for (let dx = -4; dx <= 4 + wid; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      const d = Math.abs(dx - wid / 2) + Math.abs(dz);
      if (d > 6 || !r.chance(0.75 - d * 0.08)) continue;
      const px = alongX ? x + dx - 2 : x + dz, pz = alongX ? z + dz : z + dx - 2;
      w.set(px, y, pz, S(r.chance(0.15) ? B.magma_block : r.chance(0.2) ? B.gold_block : B.netherrack));
      w.set(px, y - 1, pz, S(B.netherrack));
    }
  }
  for (let i = 0; i < wid; i++) {
    for (let j = 0; j < hei; j++) {
      const frame = i === 0 || i === wid - 1 || j === 0 || j === hei - 1;
      if (!frame) continue;
      if (j > 1 && r.chance(0.3)) continue;
      const px = alongX ? x + i - 2 : x, pz = alongX ? z : z + i - 2;
      w.set(px, y + 1 + j, pz, S(r.chance(0.2) ? B.crying_obsidian : B.obsidian));
    }
  }
  for (let k = 0; k < 3; k++) {
    const px = x + r.int(9) - 4, pz = z + r.int(9) - 4;
    w.set(px, y + 1, pz, S(B.obsidian));
  }
  const cx = alongX ? x + 3 : x + 2, cz = alongX ? z + 2 : z + 3;
  w.set(cx, y + 1, cz, S(B.chest, 0));
  const items = loot(r, PORTAL_LOOT, 4 + r.int(5));
  if (w.inside(cx, cz)) w.blockEntities.push({ x: cx, y: y + 1, z: cz, type: "chest", items });
}

type Loot = [item: string, min: number, max: number, weight: number];
const PORTAL_LOOT: Loot[] = [
  ["obsidian", 1, 2, 40], ["flint", 1, 4, 40], ["iron_nugget", 9, 18, 40], ["flint_and_steel", 1, 1, 40], ["fire_charge", 1, 1, 40],
  ["golden_apple", 1, 1, 15], ["gold_nugget", 4, 24, 15], ["golden_sword", 1, 1, 15], ["golden_axe", 1, 1, 15], ["golden_hoe", 1, 1, 15],
  ["golden_shovel", 1, 1, 15], ["golden_pickaxe", 1, 1, 15], ["golden_boots", 1, 1, 15], ["golden_chestplate", 1, 1, 15],
  ["golden_helmet", 1, 1, 15], ["golden_leggings", 1, 1, 15], ["glistering_melon_slice", 4, 12, 5], ["golden_horse_armor", 1, 1, 5],
  ["light_weighted_pressure_plate", 1, 1, 5], ["golden_carrot", 4, 12, 5], ["clock", 1, 1, 5], ["gold_ingot", 2, 8, 5],
  ["bell", 1, 1, 1], ["enchanted_golden_apple", 1, 1, 1], ["gold_block", 1, 2, 1],
];
export const DUNGEON_LOOT: Loot[] = [
  ["saddle", 1, 1, 20], ["golden_apple", 1, 1, 15], ["enchanted_golden_apple", 1, 1, 2], ["music_disc_otherside", 1, 1, 2],
  ["music_disc_13", 1, 1, 15], ["music_disc_cat", 1, 1, 15], ["name_tag", 1, 1, 20], ["golden_horse_armor", 1, 1, 10],
  ["iron_horse_armor", 1, 1, 15], ["diamond_horse_armor", 1, 1, 5], ["enchanted_book", 1, 1, 10], ["iron_ingot", 1, 4, 10],
  ["gold_ingot", 1, 4, 5], ["bread", 1, 1, 20], ["wheat", 1, 4, 20], ["bucket", 1, 1, 10], ["redstone", 1, 4, 15], ["coal", 1, 4, 15],
  ["melon_seeds", 2, 4, 10], ["pumpkin_seeds", 2, 4, 10], ["beetroot_seeds", 2, 4, 10], ["bone", 1, 8, 10], ["gunpowder", 1, 8, 10],
  ["rotten_flesh", 1, 8, 10], ["string", 1, 8, 10],
];

export function loot(r: Rng, table: Loot[], rolls: number): (ItemStack | null)[] {
  const items: (ItemStack | null)[] = new Array(27).fill(null);
  let total = 0;
  for (const t of table) total += t[3];
  for (let k = 0; k < rolls; k++) {
    let roll = r.next() * total;
    let pick = table[0];
    for (const t of table) {
      roll -= t[3];
      if (roll <= 0) {
        pick = t;
        break;
      }
    }
    const stack: ItemStack = { item: pick[0], count: r.range(pick[1], pick[2]) };
    if (pick[0] === "enchanted_book") stack.ench = { [["sharpness", "protection", "efficiency", "unbreaking", "power", "mending"][r.int(6)]]: 1 + r.int(3) };
    items[r.int(27)] = stack;
  }
  return items;
}

const ROOM_OK = idTable(B.stone, B.deepslate, B.granite, B.diorite, B.andesite, B.tuff, B.dirt, B.gravel, B.cobblestone, B.mossy_cobblestone);

function dungeons(ctx: ChunkCtx, w: Writer) {
  const { seed } = ctx.g;
  const blocks = ctx.blocks;
  const r = createRng(hash32(seed, ctx.cx, ctx.cz, 0xd0e6));
  const at = (lx: number, y: number, lz: number) => ((y - MIN_Y) << 8) | (lz << 4) | lx;
  for (let n = 0; n < 6; n++) {
    const lx = 4 + r.int(8), lz = 4 + r.int(8);
    const y = n < 4 ? -58 + r.int(120) : -58 + r.int(60);
    const rx = r.chance(0.5) ? 3 : 4, rz = r.chance(0.5) ? 3 : 4;
    const ts = r.int(0x7fffffff);
    if (y + 5 >= ctx.surface[(lz << 4) | lx] - 4) continue;
    if (lx - rx < 0 || lx + rx > 15 || lz - rz < 0 || lz + rz > 15) continue;
    let holes = 0, bad = false;
    for (let dx = -rx; dx <= rx && !bad; dx++) {
      for (let dz = -rz; dz <= rz && !bad; dz++) {
        const fl = blocks[at(lx + dx, y - 1, lz + dz)] & 0xfff, ce = blocks[at(lx + dx, y + 4, lz + dz)] & 0xfff;
        if (!ROOM_OK[fl] || !ROOM_OK[ce]) bad = true;
        const edge = Math.abs(dx) === rx || Math.abs(dz) === rz;
        if (edge && blocks[at(lx + dx, y, lz + dz)] === 0 && blocks[at(lx + dx, y + 1, lz + dz)] === 0) holes++;
      }
    }
    if (bad || holes < 1 || holes > 5) continue;
    const dr = createRng(ts);
    for (let dx = -rx; dx <= rx; dx++) {
      for (let dz = -rz; dz <= rz; dz++) {
        for (let dy = -1; dy <= 4; dy++) {
          const i = at(lx + dx, y + dy, lz + dz);
          const edge = Math.abs(dx) === rx || Math.abs(dz) === rz;
          if (dy === -1) blocks[i] = S(dr.chance(0.25) ? B.mossy_cobblestone : B.cobblestone);
          else if (dy === 4) blocks[i] = S(B.cobblestone);
          else if (edge) {
            if (blocks[i] !== 0) blocks[i] = S(B.cobblestone);
          } else blocks[i] = 0;
        }
      }
    }
    const x = w.ox + lx, z = w.oz + lz;
    blocks[at(lx, y, lz)] = S(B.spawner);
    const mob = ["zombie", "zombie", "skeleton", "spider"][dr.int(4)];
    w.blockEntities.push({ x, y, z, type: "spawner", data: { entity: mob, delay: 20 } });
    const chests = 1 + dr.int(2);
    for (let c = 0; c < chests; c++) {
      const side = dr.int(4);
      const cx = side === 0 ? lx - rx + 1 : side === 1 ? lx + rx - 1 : lx - rx + 1 + dr.int(rx * 2 - 1);
      const cz = side === 2 ? lz - rz + 1 : side === 3 ? lz + rz - 1 : lz - rz + 1 + dr.int(rz * 2 - 1);
      if (cx === lx && cz === lz) continue;
      const facing = side === 0 ? 0 : side === 1 ? 1 : side === 2 ? 4 : 5;
      blocks[at(cx, y, cz)] = S(B.chest, facing);
      w.blockEntities.push({ x: w.ox + cx, y, z: w.oz + cz, type: "chest", items: loot(dr, DUNGEON_LOOT, 4 + dr.int(5)) });
    }
    break;
  }
}
