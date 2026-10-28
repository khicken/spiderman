import type { GameCtx } from "../contracts";
import { CHUNK } from "../contracts";
import { forStarts, STRUCT, type Start } from "../worldgen/structure-grid";
import { fortressBoxes } from "../worldgen/fortress";

export interface StructureSpawn {
  mob: string;
  group: [number, number];
  water?: boolean;
  anyLight?: boolean;
}

interface Rule extends StructureSpawn {
  name: string;
  dim?: "overworld" | "nether";
  box?: (s: Start, out: number[]) => void;
  inside?: (s: Start, x: number, y: number, z: number) => boolean;
  mobs?: [string, number, number, number][];
}

// Vanilla fortress spawns fill every piece box, not only nether brick floors.
const inFortress = (s: Start, x: number, y: number, z: number) => {
  for (const p of fortressBoxes(s)) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && y >= p.y - 1 && y <= p.y + 8) return true;
  return false;
};
const FORTRESS_MOBS: [string, number, number, number][] = [["blaze", 10, 2, 3], ["zombified_piglin", 5, 4, 4], ["wither_skeleton", 8, 5, 5], ["skeleton", 2, 5, 5], ["magma_cube", 3, 4, 4]];

// Vanilla structure spawn overrides: inside the box the monster list is replaced by this one mob.
const RULES: Rule[] = [
  { name: "ocean_monument", mob: "guardian", group: [2, 4], water: true, box: (s, o) => set(o, s.x - 29, 39, s.z - 29, s.x + 29, 62, s.z + 29) },
  { name: "pillager_outpost", mob: "pillager", group: [1, 1], anyLight: true, box: (s, o) => set(o, s.x - 10, s.y - 2, s.z - 10, s.x + 10, s.y + 24, s.z + 10) },
  { name: "fortress", dim: "nether", mob: "blaze", group: [2, 3], anyLight: true, inside: inFortress, mobs: FORTRESS_MOBS },
  { name: "swamp_hut", mob: "witch", group: [1, 1], box: (s, o) => set(o, s.x - 7, Math.max(s.y, 62) + 2, s.z - 7, s.x + 7, Math.max(s.y, 62) + 9, s.z + 7) },
];

function set(o: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  o[0] = x0; o[1] = y0; o[2] = z0; o[3] = x1; o[4] = y1; o[5] = z1;
}

const box: number[] = [0, 0, 0, 0, 0, 0];

const MONUMENT = RULES.find((r) => r.name === "ocean_monument")!;

export function inMonument(ctx: GameCtx, x: number, y: number, z: number): boolean {
  if (ctx.world.dim !== "overworld") return false;
  let hit = false;
  forStarts(ctx.world.seed, STRUCT.ocean_monument, Math.floor(x / CHUNK), Math.floor(z / CHUNK), (s) => {
    MONUMENT.box!(s, box);
    if (x >= box[0] && x <= box[3] && y >= box[1] && y <= box[4] && z >= box[2] && z <= box[5]) hit = true;
  });
  return hit;
}

const picked: StructureSpawn = { mob: "", group: [1, 1] };

export function structureSpawn(ctx: GameCtx, x: number, y: number, z: number): StructureSpawn | null {
  const dim = ctx.world.dim;
  if (dim === "end") return null;
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  let hit: Rule | null = null;
  for (const r of RULES) {
    if ((r.dim ?? "overworld") !== dim) continue;
    forStarts(ctx.world.seed, STRUCT[r.name], cx, cz, (s) => {
      if (hit) return;
      if (r.inside) {
        if (r.inside(s, x, y, z)) hit = r;
        return;
      }
      r.box!(s, box);
      if (x >= box[0] && x <= box[3] && y >= box[1] && y <= box[4] && z >= box[2] && z <= box[5]) hit = r;
    });
    if (!hit) continue;
    const h: Rule = hit;
    if (!h.mobs) return h;
    let total = 0;
    for (const m of h.mobs) total += m[1];
    let roll = ctx.random() * total;
    for (const m of h.mobs) {
      if ((roll -= m[1]) >= 0) continue;
      picked.mob = m[0];
      picked.group = [m[2], m[3]];
      picked.anyLight = m[0] === "blaze" || m[0] === "zombified_piglin" || m[0] === "magma_cube";
      return picked;
    }
    return h;
  }
  return null;
}
