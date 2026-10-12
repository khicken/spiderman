import { MIN_Y, stateOf, type Dim } from "../contracts";
import { ancientCity } from "./ancient-city";
import { bastion } from "./bastion";
import { chest, frame } from "./build";
import { endCity } from "./end-city";
import { fortress } from "./fortress";
import { B } from "./ids";
import { mansion } from "./mansion";
import { mineshaft } from "./mineshaft";
import { hash32 } from "./noise";
import { buriedTreasure, monument, oceanRuin, shipwreck } from "./ocean";
import type { ChunkCtx } from "./overworld";
import { createRng, idTable, type Rng, type Writer } from "./rng";
import { forStarts, STRUCTS, type Start } from "./structure-grid";
import { stronghold } from "./stronghold";
import { BI } from "./surface";
import { desertPyramid, igloo, jungleTemple, outpost, swampHut } from "./temples";
import { trialChamber } from "./trial";
import { village, villageRects } from "./village";

const S = stateOf;
const rng = createRng();

type Gen = (ctx: ChunkCtx | null, w: Writer, s: Start) => void;

const GENS: Record<string, Gen> = {
  village: (c, w, s) => village(c!, w, s),
  desert_pyramid: (_c, w, s) => desertPyramid(w, s),
  jungle_temple: (_c, w, s) => jungleTemple(w, s),
  igloo: (_c, w, s) => igloo(w, s),
  swamp_hut: (_c, w, s) => swampHut(w, s),
  pillager_outpost: (_c, w, s) => outpost(w, s),
  ocean_ruin: (_c, w, s) => oceanRuin(w, s),
  shipwreck: (_c, w, s) => shipwreck(w, s),
  buried_treasure: (_c, w, s) => buriedTreasure(w, s),
  ocean_monument: (_c, w, s) => monument(w, s),
  woodland_mansion: (_c, w, s) => mansion(w, s),
  mineshaft: (_c, w, s) => mineshaft(w, s),
  ancient_city: (_c, w, s) => ancientCity(w, s),
  trial_chambers: (_c, w, s) => trialChamber(w, s),
  ruined_portal: (_c, w, s) => ruinedPortal(w, s),
  stronghold: (_c, w, s) => stronghold(w, s),
  fortress: (_c, w, s) => fortress(w, s),
  bastion_remnant: (_c, w, s) => bastion(w, s),
  end_city: (_c, w, s) => endCity(w, s),
};

// Underground pieces first so surface structures and their foundations win where they overlap.
const ORDER: Record<Dim, string[]> = {
  overworld: ["mineshaft", "stronghold", "trial_chambers", "ancient_city", "buried_treasure", "ocean_ruin", "shipwreck", "ocean_monument",
    "ruined_portal", "desert_pyramid", "jungle_temple", "igloo", "swamp_hut", "pillager_outpost", "woodland_mansion", "village"],
  nether: ["fortress", "bastion_remnant"],
  end: ["end_city"],
};

export function placeDimStructures(seed: number, dim: Dim, ctx: ChunkCtx | null, w: Writer) {
  for (const name of ORDER[dim]) {
    const d = STRUCTS.find((x) => x.name === name)!;
    forStarts(seed, d, w.cx, w.cz, (s) => GENS[name](ctx, w, s));
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
  placeDimStructures(seed, "overworld", ctx, w);
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

function ruinedPortal(w: Writer, s: Start) {
  const r: Rng = createRng(s.seed);
  const x = s.x, z = s.z, y = s.y - (r.chance(0.3) ? 0 : 1);
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
      const edge = i === 0 || i === wid - 1 || j === 0 || j === hei - 1;
      if (!edge) continue;
      if (j > 1 && r.chance(0.3)) continue;
      const px = alongX ? x + i - 2 : x, pz = alongX ? z : z + i - 2;
      w.set(px, y + 1 + j, pz, S(r.chance(0.2) ? B.crying_obsidian : B.obsidian));
    }
  }
  for (let k = 0; k < 3; k++) w.set(x + r.int(9) - 4, y + 1, z + r.int(9) - 4, S(B.obsidian));
  const cx = alongX ? x + 3 : x + 2, cz = alongX ? z + 2 : z + 3;
  chest(frame(w, cx, y + 1, cz, 0, s.seed), 0, 0, 0, 0, "ruined_portal", B.chest);
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
    w.blockEntities.push({ x, y, z, type: "spawner", data: { mob, delay: 20 } });
    const chests = 1 + dr.int(2);
    for (let c = 0; c < chests; c++) {
      const side = dr.int(4);
      const cx = side === 0 ? lx - rx + 1 : side === 1 ? lx + rx - 1 : lx - rx + 1 + dr.int(rx * 2 - 1);
      const cz = side === 2 ? lz - rz + 1 : side === 3 ? lz + rz - 1 : lz - rz + 1 + dr.int(rz * 2 - 1);
      if (cx === lx && cz === lz) continue;
      const facing = side === 0 ? 0 : side === 1 ? 1 : side === 2 ? 4 : 5;
      blocks[at(cx, y, cz)] = S(B.chest, facing);
      w.blockEntities.push({ x: w.ox + cx, y, z: w.oz + cz, type: "chest", items: new Array(27).fill(null), data: { lootTable: "simple_dungeon", lootSeed: hash32(seed, w.ox + cx, y, w.oz + cz) } });
    }
    break;
  }
}

const TREE_FREE: [string, number][] = [["desert_pyramid", 13], ["jungle_temple", 17], ["igloo", 8], ["swamp_hut", 10], ["pillager_outpost", 16], ["woodland_mansion", 44]];
const rectOut: number[] = [];

export function surfaceRects(seed: number, cx: number, cz: number): number[] {
  rectOut.length = 0;
  for (const [name, r] of TREE_FREE) {
    const d = STRUCTS.find((x) => x.name === name)!;
    forStarts(seed, d, cx, cz, (s) => rectOut.push(s.x - r, s.z - r, s.x + r, s.z + r));
  }
  forStarts(seed, STRUCTS.find((x) => x.name === "village")!, cx, cz, (s) => villageRects(s, rectOut));
  return rectOut;
}

export function inRects(r: number[], x: number, z: number): boolean {
  for (let i = 0; i < r.length; i += 4) if (x >= r[i] && x <= r[i + 2] && z >= r[i + 1] && z <= r[i + 3]) return true;
  return false;
}
