import { CHUNK, MIN_Y } from "../contracts";

export const sectionKey = (cx: number, sy: number, cz: number) => ((cx + 32768) * 65536 + (cz + 32768)) * 32 + sy;
export const chunkKey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

export interface SectionJob {
  key: number;
  cx: number;
  sy: number;
  cz: number;
  dist: number;
  queued: boolean;
  fast: boolean;
}

export function createMeshQueue() {
  const jobs = new Map<number, SectionJob>();
  const fast: SectionJob[] = [];
  const slow: SectionJob[] = [];
  let needsSort = false;
  let count = 0;
  let camX = 0, camY = 0, camZ = 0;
  let sortX = Infinity, sortY = 0, sortZ = 0;

  const distTo = (j: SectionJob) => {
    const dx = j.cx * CHUNK + 8 - camX, dy = MIN_Y + j.sy * CHUNK + 8 - camY, dz = j.cz * CHUNK + 8 - camZ;
    return dx * dx + dy * dy + dz * dz;
  };

  function push(cx: number, sy: number, cz: number, high: boolean) {
    const key = sectionKey(cx, sy, cz);
    let j = jobs.get(key);
    if (!j) {
      j = { key, cx, sy, cz, dist: 0, queued: false, fast: false };
      jobs.set(key, j);
    }
    if (high && !j.fast) {
      j.fast = true;
      fast.push(j);
      if (!j.queued) count++;
      j.queued = true;
      return;
    }
    if (j.queued) return;
    j.queued = true;
    count++;
    j.dist = distTo(j);
    slow.push(j);
    needsSort = true;
  }

  function pop(): SectionJob | null {
    while (fast.length) {
      const j = fast.shift()!;
      if (!j.queued || !j.fast) continue;
      return take(j);
    }
    if (needsSort) {
      for (let i = 0; i < slow.length; i++) slow[i].dist = distTo(slow[i]);
      slow.sort((a, b) => b.dist - a.dist);
      needsSort = false;
    }
    while (slow.length) {
      const j = slow.pop()!;
      if (!j.queued) continue;
      return take(j);
    }
    return null;
  }

  function take(j: SectionJob) {
    j.queued = false;
    j.fast = false;
    count--;
    jobs.delete(j.key);
    return j;
  }

  function setCamera(x: number, y: number, z: number) {
    camX = x; camY = y; camZ = z;
    const dx = x - sortX, dy = y - sortY, dz = z - sortZ;
    if (dx * dx + dy * dy + dz * dz > 64) {
      sortX = x; sortY = y; sortZ = z;
      if (slow.length) needsSort = true;
    }
  }

  function removeChunk(cx: number, cz: number, sections: number) {
    for (let sy = 0; sy < sections; sy++) {
      const j = jobs.get(sectionKey(cx, sy, cz));
      if (j && j.queued) {
        j.queued = false;
        j.fast = false;
        count--;
        jobs.delete(j.key);
      }
    }
  }

  function clear() {
    jobs.clear();
    fast.length = 0;
    slow.length = 0;
    count = 0;
  }

  return { push, pop, setCamera, removeChunk, clear, size: () => count, hasFast: () => fast.some((j) => j.queued && j.fast) };
}

export type MeshQueue = ReturnType<typeof createMeshQueue>;
