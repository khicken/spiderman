import type { BlockBehavior, GameCtx } from "../contracts";
import { AIR, SET_NO_DROP, SET_NOTIFY } from "../contracts";
import { blockDef } from "../blocks/registry";
import { advTrigger } from "../systems/advancements/bus";

type Cell = [number, number, number];
const is = (...names: string[]) => (n: string) => names.includes(n);
const SKULL = is("wither_skeleton_skull", "wither_skeleton_wall_skull");
const SOUL = is("soul_sand", "soul_soil");
const IRON = is("iron_block");
const SNOW = is("snow_block");

const SNOW_GOLEM: [number, number, (n: string) => boolean][] = [[0, -1, SNOW], [0, -2, SNOW]];
const IRON_GOLEM: [number, number, (n: string) => boolean][] = [[0, -1, IRON], [-1, -1, IRON], [1, -1, IRON], [0, -2, IRON]];
const WITHER_BODY: [number, number, (n: string) => boolean][] = [[0, 0, SKULL], [0, -1, SOUL], [-1, -1, SOUL], [1, -1, SOUL], [0, -2, SOUL], [-1, 0, SKULL], [1, 0, SKULL]];
const IRON_EMPTY: [number, number][] = [[-1, -2], [1, -2]];

const name = (ctx: GameCtx, x: number, y: number, z: number) => blockDef(ctx.world.getBlock(x, y, z)).name;

export function findPattern(ctx: GameCtx, x: number, y: number, z: number, cells: [number, number, (n: string) => boolean][], empty: [number, number][] = [], shift = [0]): Cell[] | null {
  for (const ax of [0, 1])
    for (const s of shift) {
      const at = (a: number, dy: number): [number, number, number] => (ax === 0 ? [x + a + s, y + dy, z] : [x, y + dy, z + a + s]);
      const out: Cell[] = [];
      let ok = true;
      for (const [a, dy, test] of cells) {
        const [cx, cy, cz] = at(a, dy);
        if (!test(name(ctx, cx, cy, cz))) {
          ok = false;
          break;
        }
        out.push([cx, cy, cz]);
      }
      if (!ok) continue;
      if (empty.some(([a, dy]) => {
        const [cx, cy, cz] = at(a, dy);
        return ctx.world.getBlock(cx, cy, cz) !== AIR;
      })) continue;
      return out;
    }
  return null;
}

function clear(ctx: GameCtx, cells: [number, number, number][]) {
  for (const [x, y, z] of cells) {
    const s = ctx.world.getBlock(x, y, z);
    ctx.emit({ type: "particles", kind: "block", x: x + 0.5, y: y + 0.5, z: z + 0.5, state: s });
    ctx.world.setBlock(x, y, z, AIR, SET_NOTIFY | SET_NO_DROP);
  }
}

function headPlaced(ctx: GameCtx, x: number, y: number, z: number) {
  const snow = findPattern(ctx, x, y, z, SNOW_GOLEM);
  if (snow) {
    clear(ctx, [[x, y, z], ...snow]);
    ctx.entities.spawn("snow_golem", x + 0.5, y - 2, z + 0.5, { persistent: true });
    return;
  }
  const iron = findPattern(ctx, x, y, z, IRON_GOLEM, IRON_EMPTY);
  if (iron) {
    clear(ctx, [[x, y, z], ...iron]);
    if (ctx.entities.spawn("iron_golem", x + 0.5, y - 2, z + 0.5, { playerCreated: true, persistent: true })) advTrigger({ t: "summoned", type: "iron_golem" });
  }
}

function skullPlaced(ctx: GameCtx, x: number, y: number, z: number) {
  const body = findPattern(ctx, x, y, z, WITHER_BODY, [[-1, -2], [1, -2]], [0, -1, 1]);
  if (!body) return;
  const cx = body[0][0], cz = body[0][2];
  clear(ctx, body);
  const w = ctx.entities.spawn("wither", cx + 0.5, y - 2, cz + 0.5, { persistent: true, invul: 220 });
  if (w) ctx.emit({ type: "sound", name: "entity.wither.spawn", x: cx + 0.5, y, z: cz + 0.5, volume: 1 });
  if (w) advTrigger({ t: "summoned", type: "wither" });
}

const head: BlockBehavior = { onPlaced: (ctx, x, y, z) => headPlaced(ctx, x, y, z) };
const skull: BlockBehavior = { onPlaced: (ctx, x, y, z) => skullPlaced(ctx, x, y, z) };

export const BUILD_BEHAVIORS: Record<string, BlockBehavior> = {
  carved_pumpkin: head,
  jack_o_lantern: head,
  wither_skeleton_skull: skull,
  wither_skeleton_wall_skull: skull,
};

export function mergeBuild(all: Record<string, BlockBehavior>) {
  for (const [n, b] of Object.entries(BUILD_BEHAVIORS)) {
    const prev = all[n]?.onPlaced;
    all[n] = {
      ...all[n],
      onPlaced(ctx, x, y, z, s) {
        prev?.(ctx, x, y, z, s);
        if (ctx.world.getBlock(x, y, z) === s) b.onPlaced!(ctx, x, y, z, s);
      },
    };
  }
  return all;
}
