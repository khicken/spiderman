import type { ChunkData, Dim } from "../contracts";

export interface GenPool {
  size: number;
  request(seed: number, dim: Dim, cx: number, cz: number, done: (c: ChunkData) => void): void;
  dispose(): void;
}

export function createGenPool(): GenPool {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  const size = Math.max(1, Math.min(4, cores - 2));
  const workers: Worker[] = [];
  const load: number[] = [];
  const callbacks = new Map<number, { done: (c: ChunkData) => void; w: number }>();
  let nextId = 1;
  let warned = false;

  for (let i = 0; i < size; i++) {
    const w = new Worker(new URL("../worldgen/gen.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; chunk: ChunkData }>) => {
      const cb = callbacks.get(e.data.id);
      if (!cb) return;
      callbacks.delete(e.data.id);
      load[cb.w]--;
      cb.done(e.data.chunk);
    };
    w.onerror = (e) => {
      if (!warned) console.error("worldgen worker failed", e.message);
      warned = true;
    };
    workers.push(w);
    load.push(0);
  }

  return {
    size,
    request(seed, dim, cx, cz, done) {
      let best = 0;
      for (let i = 1; i < size; i++) if (load[i] < load[best]) best = i;
      const id = nextId++;
      callbacks.set(id, { done, w: best });
      load[best]++;
      workers[best].postMessage({ id, seed, dim, cx, cz });
    },
    dispose() {
      for (const w of workers) w.terminate();
      workers.length = 0;
      callbacks.clear();
    },
  };
}
