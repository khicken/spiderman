import type { ChunkData, Dim } from "../contracts";
import { CHUNK, HEIGHT } from "../contracts";
import { generateChunk } from "../worldgen";

export interface GenPool {
  size: number;
  request(seed: number, dim: Dim, cx: number, cz: number, done: (c: ChunkData) => void): void;
  dispose(): void;
}

interface Job {
  done: (c: ChunkData) => void;
  w: number;
  seed: number;
  dim: Dim;
  cx: number;
  cz: number;
}

const emptyChunk = (dim: Dim, cx: number, cz: number): ChunkData => ({
  cx, cz, dim,
  blocks: new Uint16Array(CHUNK * CHUNK * HEIGHT),
  light: new Uint8Array(CHUNK * CHUNK * HEIGHT),
  biomes: new Uint8Array(CHUNK * CHUNK),
  heightmap: new Int16Array(CHUNK * CHUNK).fill(-65),
});

// A worker failure must still answer every request, or loading waits forever on that chunk.
function generateHere(j: Job, why: string) {
  console.warn(`chunk ${j.cx},${j.cz} (${j.dim}) worker failed, generating on main thread: ${why}`);
  try {
    j.done(generateChunk(j.seed, j.dim, j.cx, j.cz));
  } catch (err) {
    console.error(`chunk ${j.cx},${j.cz} (${j.dim}) generation failed, using an empty chunk`, err);
    j.done(emptyChunk(j.dim, j.cx, j.cz));
  }
}

export function createGenPool(): GenPool {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  const size = Math.max(1, Math.min(4, cores - 2));
  const workers: (Worker | null)[] = [];
  const load: number[] = [];
  const jobs = new Map<number, Job>();
  let nextId = 1;
  let disposed = false;

  const fail = (w: number, why: string) => {
    if (!workers[w]) return;
    workers[w]!.terminate();
    workers[w] = null;
    for (const [id, j] of jobs) {
      if (j.w !== w) continue;
      jobs.delete(id);
      load[w]--;
      if (!disposed) generateHere(j, why);
    }
  };

  for (let i = 0; i < size; i++) {
    const w = new Worker(new URL("../worldgen/gen.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; chunk?: ChunkData; error?: string }>) => {
      const j = jobs.get(e.data.id);
      if (!j) return;
      jobs.delete(e.data.id);
      load[j.w]--;
      if (e.data.chunk) j.done(e.data.chunk);
      else generateHere(j, e.data.error ?? "no chunk");
    };
    w.onerror = (e) => {
      e.preventDefault();
      fail(i, e.message || "worker error");
    };
    workers.push(w);
    load.push(0);
  }

  return {
    size,
    request(seed, dim, cx, cz, done) {
      let best = -1;
      for (let i = 0; i < size; i++) if (workers[i] && (best < 0 || load[i] < load[best])) best = i;
      const job: Job = { done, w: best, seed, dim, cx, cz };
      if (best < 0) {
        generateHere(job, "no live worker");
        return;
      }
      const id = nextId++;
      jobs.set(id, job);
      load[best]++;
      workers[best]!.postMessage({ id, seed, dim, cx, cz });
    },
    dispose() {
      disposed = true;
      for (const w of workers) w?.terminate();
      workers.length = 0;
      jobs.clear();
    },
  };
}
