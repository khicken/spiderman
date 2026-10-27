import type { BlockBehavior, GameCtx } from "../contracts";
import { MIN_Y, SECTIONS } from "../contracts";
import { BLOCKS, blockByName } from "../blocks/registry";
import { IMPLICIT_WATER, WATER_ID, WATER_SOURCE } from "../blocks/waterlog";
import { chunkKey, type Store } from "./store";

const MAX_SCHEDULED_PER_TICK = 65536;
// A large pour after load must not stall the frame; the rest stays due for the next tick.
const SCHEDULED_BUDGET_MS = 6;
const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const RANDOM_TICK_CHUNKS = 8;

export interface Ticker {
  tickable: Uint8Array;
  schedule(x: number, y: number, z: number, id: number, due: number): void;
  run(ctx: GameCtx, centerX: number, centerZ: number, extra?: { cx: number; cz: number }[]): void;
  pending(): number;
  unpark(key: number): void;
  clear(): void;
}

export function createTicker(store: Store, behaviors: Record<string, BlockBehavior>): Ticker {
  const tickable = new Uint8Array(4096);
  for (const name in behaviors) {
    const def = blockByName(name);
    if (def && behaviors[name].randomTick) tickable[def.id] = 1;
  }

  // Min-heap ordered by (due, seq) over parallel arrays.
  let due: number[] = [];
  let seq: number[] = [];
  let px: number[] = [];
  let py: number[] = [];
  let pz: number[] = [];
  let pid: number[] = [];
  const keys = new Set<string>();
  let counter = 0;

  const less = (a: number, b: number) => due[a] < due[b] || (due[a] === due[b] && seq[a] < seq[b]);
  const sw = (arr: number[], a: number, b: number) => {
    const t = arr[a];
    arr[a] = arr[b];
    arr[b] = t;
  };
  const swap = (a: number, b: number) => {
    sw(due, a, b);
    sw(seq, a, b);
    sw(px, a, b);
    sw(py, a, b);
    sw(pz, a, b);
    sw(pid, a, b);
  };
  const up = (i: number) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(i, p)) break;
      swap(i, p);
      i = p;
    }
  };
  const down = (i: number) => {
    const n = due.length;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < n && less(l, m)) m = l;
      if (r < n && less(r, m)) m = r;
      if (m === i) return;
      swap(i, m);
      i = m;
    }
  };
  const pop = () => {
    const last = due.length - 1;
    swap(0, last);
    due.pop();
    seq.pop();
    px.pop();
    py.pop();
    pz.pop();
    pid.pop();
    if (due.length) down(0);
  };

  const schedule = (x: number, y: number, z: number, id: number, at: number) => {
    const key = `${x},${y},${z},${id}`;
    if (keys.has(key)) return;
    keys.add(key);
    due.push(at);
    seq.push(counter++);
    px.push(x);
    py.push(y);
    pz.push(z);
    pid.push(id);
    up(due.length - 1);
  };

  const parked = new Map<number, number[]>();

  const runScheduled = (ctx: GameCtx) => {
    const now = ctx.time.tick;
    let n = 0;
    const start = clock();
    while (due.length && due[0] <= now && n < MAX_SCHEDULED_PER_TICK) {
      if ((n & 63) === 63 && clock() - start > SCHEDULED_BUDGET_MS) break;
      const x = px[0];
      const y = py[0];
      const z = pz[0];
      const id = pid[0];
      const at = due[0];
      pop();
      n++;
      const c = store.get(x >> 4, z >> 4);
      if (!c) {
        const key = chunkKey(x >> 4, z >> 4);
        let list = parked.get(key);
        if (!list) parked.set(key, (list = []));
        list.push(x, y, z, id, at);
        continue;
      }
      keys.delete(`${x},${y},${z},${id}`);
      const ci = ((y - MIN_Y) << 8) | ((z & 15) << 4) | (x & 15);
      const s = c.blocks[ci];
      if ((s & 0xfff) !== id) {
        if (id === WATER_ID && (c.wl.has(ci) || IMPLICIT_WATER[s & 0xfff])) behaviors.water?.scheduledTick?.(ctx, x, y, z, WATER_SOURCE);
        continue;
      }
      behaviors[BLOCKS[id].name]?.scheduledTick?.(ctx, x, y, z, s);
    }
  };

  const runRandom = (ctx: GameCtx, centerX: number, centerZ: number, extra?: { cx: number; cz: number }[]) => {
    const speed = ctx.rules?.randomTickSpeed ?? 3;
    if (speed <= 0) return;
    const ccx = centerX >> 4;
    const ccz = centerZ >> 4;
    const rnd = ctx.random;
    for (const c of store.chunks.values()) {
      if (Math.abs(c.cx - ccx) > RANDOM_TICK_CHUNKS || Math.abs(c.cz - ccz) > RANDOM_TICK_CHUNKS) {
        let near = false;
        if (extra) for (const e of extra) if (Math.abs(c.cx - e.cx) <= RANDOM_TICK_CHUNKS && Math.abs(c.cz - e.cz) <= RANDOM_TICK_CHUNKS) near = true;
        if (!near) continue;
      }
      if (!c.announced) continue;
      const bx = c.cx << 4;
      const bz = c.cz << 4;
      for (let sy = 0; sy < SECTIONS; sy++) {
        if (c.tickable[sy] === 0) continue;
        for (let k = 0; k < speed; k++) {
          const r = (rnd() * 4096) | 0;
          const i = (sy << 12) | r;
          const s = c.blocks[i];
          const id = s & 0xfff;
          if (!tickable[id]) continue;
          behaviors[BLOCKS[id].name].randomTick!(ctx, bx + (r & 15), (i >> 8) + MIN_Y, bz + ((r >> 4) & 15), s);
        }
      }
    }
  };

  return {
    tickable,
    schedule,
    run(ctx, centerX, centerZ, extra) {
      runScheduled(ctx);
      runRandom(ctx, centerX, centerZ, extra);
    },
    pending: () => due.length,
    unpark(key) {
      const list = parked.get(key);
      if (!list) return;
      parked.delete(key);
      for (let i = 0; i < list.length; i += 5) {
        keys.delete(`${list[i]},${list[i + 1]},${list[i + 2]},${list[i + 3]}`);
        schedule(list[i], list[i + 1], list[i + 2], list[i + 3], list[i + 4]);
      }
    },
    clear() {
      due = [];
      seq = [];
      px = [];
      py = [];
      pz = [];
      pid = [];
      keys.clear();
      parked.clear();
    },
  };
}
