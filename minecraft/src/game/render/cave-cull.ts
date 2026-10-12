import { SECTIONS } from "../contracts";
import { ALL_VIS, pairBit } from "../mesh/vis";
import { sectionKey } from "./mesh-queue";

// Vanilla cave culling: a breadth-first walk from the camera section that only crosses a section
// between two faces joined by open blocks, and never turns back toward the camera.
const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];
const OPP = [1, 0, 3, 2, 5, 4];
const PB = new Int32Array(36);
for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) PB[a * 6 + b] = a === b ? 0 : pairBit(a, b);
const REBUILD_MS = 100;
export const CAVE_CULL = { on: true };

export function createCaveCull(isLoaded: (cx: number, cz: number) => boolean) {
  const vis = new Map<number, number>();
  let w = 0;
  let seen = new Uint8Array(0);
  let entry = new Uint8Array(0);
  let dirs = new Uint8Array(0);
  let queue = new Int32Array(0);
  let cols = new Uint8Array(0);
  let ox = 0, oz = 0;
  let camCx = NaN, camSy = NaN, camCz = NaN;
  let dirty = true;
  let off = true;
  let builtAt = -Infinity;

  function rebuild(r: number) {
    const nw = 2 * r + 3;
    if (nw !== w) {
      w = nw;
      const n = w * w * SECTIONS;
      seen = new Uint8Array(n);
      entry = new Uint8Array(n);
      dirs = new Uint8Array(n);
      queue = new Int32Array(n);
      cols = new Uint8Array(w * w);
    } else seen.fill(0);
    ox = camCx - r - 1;
    oz = camCz - r - 1;
    for (let z = 0; z < w; z++) for (let x = 0; x < w; x++) cols[z * w + x] = isLoaded(ox + x, oz + z) ? 1 : 0;
    const start = (camSy * w + (camCz - oz)) * w + (camCx - ox);
    seen[start] = 1;
    entry[start] = 6;
    dirs[start] = 0;
    let head = 0, tail = 0;
    queue[tail++] = start;
    while (head < tail) {
      const n = queue[head++];
      const x = n % w, z = ((n / w) | 0) % w, y = (n / (w * w)) | 0;
      const e = entry[n];
      const v = e === 6 ? ALL_VIS : vis.get(sectionKey(ox + x, y, oz + z)) ?? ALL_VIS;
      const dn = dirs[n];
      for (let d = 0; d < 6; d++) {
        if (dn & (1 << OPP[d])) continue;
        if (e !== 6 && !(v & PB[e * 6 + d])) continue;
        const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (nx < 0 || nz < 0 || nx >= w || nz >= w || ny < 0 || ny >= SECTIONS) continue;
        if (!cols[nz * w + nx]) continue;
        const m = (ny * w + nz) * w + nx;
        if (seen[m]) continue;
        seen[m] = 1;
        entry[m] = OPP[d];
        dirs[m] = dn | (1 << d);
        queue[tail++] = m;
      }
    }
  }

  return {
    setVis(key: number, mask: number) {
      if ((vis.get(key) ?? ALL_VIS) === mask) return;
      if (mask === ALL_VIS) vis.delete(key);
      else vis.set(key, mask);
      dirty = true;
    },
    touch() {
      dirty = true;
    },
    clearChunk(cx: number, cz: number) {
      for (let sy = 0; sy < SECTIONS; sy++) vis.delete(sectionKey(cx, sy, cz));
      dirty = true;
    },
    update(cx: number, sy: number, cz: number, r: number, now: number) {
      off = sy < 0 || sy >= SECTIONS;
      if (off) return;
      const moved = cx !== camCx || sy !== camSy || cz !== camCz || 2 * r + 3 !== w;
      if (!moved && !(dirty && now - builtAt > REBUILD_MS)) return;
      camCx = cx; camSy = sy; camCz = cz;
      dirty = false;
      builtAt = now;
      rebuild(r);
    },
    visible(cx: number, sy: number, cz: number) {
      if (off || !CAVE_CULL.on) return true;
      const x = cx - ox, z = cz - oz;
      if (x < 0 || z < 0 || x >= w || z >= w) return false;
      return seen[(sy * w + z) * w + x] === 1;
    },
    clear() {
      vis.clear();
      dirty = true;
    },
  };
}
