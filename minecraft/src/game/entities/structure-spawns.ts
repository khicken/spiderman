import type { GameCtx } from "../contracts";
import { CHUNK } from "../contracts";
import { forStarts, STRUCT, type Start } from "../worldgen/structure-grid";

export interface StructureSpawn {
  mob: string;
  group: [number, number];
  water?: boolean;
  anyLight?: boolean;
}

interface Rule extends StructureSpawn {
  name: string;
  box: (s: Start, out: number[]) => void;
}

// Vanilla structure spawn overrides: inside the box the monster list is replaced by this one mob.
const RULES: Rule[] = [
  { name: "ocean_monument", mob: "guardian", group: [2, 4], water: true, box: (s, o) => set(o, s.x - 29, 39, s.z - 29, s.x + 29, 62, s.z + 29) },
  { name: "pillager_outpost", mob: "pillager", group: [1, 1], anyLight: true, box: (s, o) => set(o, s.x - 10, s.y - 2, s.z - 10, s.x + 10, s.y + 24, s.z + 10) },
  { name: "swamp_hut", mob: "witch", group: [1, 1], box: (s, o) => set(o, s.x - 7, Math.max(s.y, 62) + 2, s.z - 7, s.x + 7, Math.max(s.y, 62) + 9, s.z + 7) },
];

function set(o: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  o[0] = x0; o[1] = y0; o[2] = z0; o[3] = x1; o[4] = y1; o[5] = z1;
}

const box: number[] = [0, 0, 0, 0, 0, 0];

export function structureSpawn(ctx: GameCtx, x: number, y: number, z: number): StructureSpawn | null {
  if (ctx.world.dim !== "overworld") return null;
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  let hit: Rule | null = null;
  for (const r of RULES) {
    forStarts(ctx.world.seed, STRUCT[r.name], cx, cz, (s) => {
      if (hit) return;
      r.box(s, box);
      if (x >= box[0] && x <= box[3] && y >= box[1] && y <= box[4] && z >= box[2] && z <= box[5]) hit = r;
    });
    if (hit) return hit;
  }
  return null;
}
