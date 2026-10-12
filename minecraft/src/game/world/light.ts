import { MAX_Y, MIN_Y } from "../contracts";
import { LIGHT_FILTER, STATE_EMIT } from "../blocks/registry";
import type { Chunk, Store } from "./store";

// Index 3 is down: full sky light stays 15 going straight down through clear blocks.
const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];
const BORDERS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export interface LightEngine {
  lightChunk(c: Chunk, tickable: Uint8Array): void;
  update(x: number, y: number, z: number): void;
}

export function createLight(store: Store, hasSky: boolean): LightEngine {
  let addQ = new Int32Array(3 * 8192);
  let addHead = 0;
  let addTail = 0;
  let remQ = new Int32Array(4 * 8192);
  let remHead = 0;
  let remTail = 0;
  let quiet: Chunk | null = null;

  const pushAdd = (x: number, y: number, z: number) => {
    if (addTail + 3 > addQ.length) {
      const n = new Int32Array(Math.max(addQ.length, (addTail - addHead) * 2 + 3));
      n.set(addQ.subarray(addHead, addTail));
      addTail -= addHead;
      addHead = 0;
      addQ = n;
    }
    addQ[addTail++] = x;
    addQ[addTail++] = y;
    addQ[addTail++] = z;
  };

  const pushRem = (x: number, y: number, z: number, l: number) => {
    if (remTail + 4 > remQ.length) {
      const n = new Int32Array(Math.max(remQ.length, (remTail - remHead) * 2 + 4));
      n.set(remQ.subarray(remHead, remTail));
      remTail -= remHead;
      remHead = 0;
      remQ = n;
    }
    remQ[remTail++] = x;
    remQ[remTail++] = y;
    remQ[remTail++] = z;
    remQ[remTail++] = l;
  };

  const runAdd = (sky: boolean) => {
    const shift = sky ? 4 : 0;
    const keep = sky ? 0x0f : 0xf0;
    while (addHead < addTail) {
      const x = addQ[addHead];
      const y = addQ[addHead + 1];
      const z = addQ[addHead + 2];
      addHead += 3;
      const c = store.get(x >> 4, z >> 4);
      if (!c) continue;
      const l = (c.light[((y - MIN_Y) << 8) | ((z & 15) << 4) | (x & 15)] >> shift) & 15;
      if (l <= 1) continue;
      for (let d = 0; d < 6; d++) {
        const ny = y + DY[d];
        if (ny < MIN_Y || ny > MAX_Y) continue;
        const nx = x + DX[d];
        const nz = z + DZ[d];
        const ncx = nx >> 4;
        const ncz = nz >> 4;
        const nc = ncx === c.cx && ncz === c.cz ? c : store.get(ncx, ncz);
        if (!nc) continue;
        const ni = ((ny - MIN_Y) << 8) | ((nz & 15) << 4) | (nx & 15);
        const f = LIGHT_FILTER[nc.blocks[ni] & 0xfff];
        const nl = sky && d === 3 && l === 15 && f === 0 ? 15 : l - (f > 1 ? f : 1);
        const v = nc.light[ni];
        if (((v >> shift) & 15) >= nl) continue;
        nc.light[ni] = (v & keep) | (nl << shift);
        if (nc !== quiet) store.markDirty(nc, nx & 15, ny, nz & 15);
        pushAdd(nx, ny, nz);
      }
    }
    addHead = addTail = 0;
  };

  const runRemove = (sky: boolean) => {
    const shift = sky ? 4 : 0;
    const keep = sky ? 0x0f : 0xf0;
    while (remHead < remTail) {
      const x = remQ[remHead];
      const y = remQ[remHead + 1];
      const z = remQ[remHead + 2];
      const l = remQ[remHead + 3];
      remHead += 4;
      for (let d = 0; d < 6; d++) {
        const ny = y + DY[d];
        if (ny < MIN_Y || ny > MAX_Y) continue;
        const nx = x + DX[d];
        const nz = z + DZ[d];
        const nc = store.get(nx >> 4, nz >> 4);
        if (!nc) continue;
        const ni = ((ny - MIN_Y) << 8) | ((nz & 15) << 4) | (nx & 15);
        const v = nc.light[ni];
        const nl = (v >> shift) & 15;
        if (nl === 0) continue;
        if (nl < l || (sky && d === 3 && l === 15 && nl === 15)) {
          const e = sky ? 0 : STATE_EMIT[nc.blocks[ni]];
          nc.light[ni] = (v & keep) | (e << shift);
          store.markDirty(nc, nx & 15, ny, nz & 15);
          pushRem(nx, ny, nz, nl);
          if (e > 0) pushAdd(nx, ny, nz);
        } else {
          pushAdd(nx, ny, nz);
        }
      }
    }
    remHead = remTail = 0;
  };

  const updateChannel = (x: number, y: number, z: number, sky: boolean) => {
    const shift = sky ? 4 : 0;
    const keep = sky ? 0x0f : 0xf0;
    const c = store.get(x >> 4, z >> 4);
    if (!c) return;
    const i = ((y - MIN_Y) << 8) | ((z & 15) << 4) | (x & 15);
    const v = c.light[i];
    const old = (v >> shift) & 15;
    const e = sky ? 0 : STATE_EMIT[c.blocks[i]];
    c.light[i] = (v & keep) | (e << shift);
    if (old !== e) store.markDirty(c, x & 15, y, z & 15);
    if (old > 0) pushRem(x, y, z, old);
    runRemove(sky);
    if (e > 0) pushAdd(x, y, z);
    for (let d = 0; d < 6; d++) {
      const ny = y + DY[d];
      if (ny < MIN_Y || ny > MAX_Y) continue;
      const nx = x + DX[d];
      const nz = z + DZ[d];
      const nc = store.get(nx >> 4, nz >> 4);
      if (nc && (nc.light[((ny - MIN_Y) << 8) | ((nz & 15) << 4) | (nx & 15)] >> shift) & 15) pushAdd(nx, ny, nz);
    }
    runAdd(sky);
  };

  // Pull light from one loaded neighbor across the shared face into c.
  const seedBorder = (c: Chunk, n: Chunk, dx: number, dz: number, sky: boolean) => {
    const shift = sky ? 4 : 0;
    const keep = sky ? 0x0f : 0xf0;
    const { blocks, light } = c;
    const nlight = n.light;
    const bx = c.cx << 4;
    const bz = c.cz << 4;
    for (let t = 0; t < 16; t++) {
      const ax = dx === 1 ? 15 : dx === -1 ? 0 : t;
      const az = dz === 1 ? 15 : dz === -1 ? 0 : t;
      const aCol = (az << 4) | ax;
      const bCol = (dz === 0 ? az : 15 - az) * 16 + (dx === 0 ? ax : 15 - ax);
      for (let ry = 0; ry < 384; ry++) {
        const l = (nlight[(ry << 8) | bCol] >> shift) & 15;
        if (l <= 1) continue;
        const ai = (ry << 8) | aCol;
        const f = LIGHT_FILTER[blocks[ai] & 0xfff];
        const nl = l - (f > 1 ? f : 1);
        const v = light[ai];
        if (((v >> shift) & 15) >= nl) continue;
        light[ai] = (v & keep) | (nl << shift);
        pushAdd(bx + ax, ry + MIN_Y, bz + az);
      }
    }
  };

  const lightChunk = (c: Chunk, tickable: Uint8Array) => {
    const { blocks, light, skyTop, counts } = c;
    const hm = c.data.heightmap;
    const bx = c.cx << 4;
    const bz = c.cz << 4;
    light.fill(0);
    hm.fill(MIN_Y - 1);
    skyTop.fill(MIN_Y);
    counts.fill(0);
    c.tickable.fill(0);
    quiet = c;

    const n = blocks.length;
    for (let i = 0; i < n; i++) {
      const id = blocks[i] & 0xfff;
      if (id === 0) continue;
      const col = i & 255;
      const y = (i >> 8) + MIN_Y;
      const sec = i >> 12;
      hm[col] = y;
      counts[sec]++;
      if (tickable[id]) c.tickable[sec]++;
      if (LIGHT_FILTER[id] > 0) skyTop[col] = y + 1;
      const e = STATE_EMIT[blocks[i]];
      if (e > 0) {
        light[i] = e;
        pushAdd(bx + (col & 15), y, bz + (col >> 4));
      }
    }

    const neighbors: (Chunk | undefined)[] = [];
    for (let k = 0; k < 4; k++) neighbors.push(store.get(c.cx + BORDERS[k][0], c.cz + BORDERS[k][1]));
    let maxH = MIN_Y - 1;
    if (hasSky) {
      for (let col = 0; col < 256; col++) if (hm[col] > maxH) maxH = hm[col];
      if (maxH < MAX_Y) light.fill(0xf0, (maxH + 1 - MIN_Y) << 8);
      for (let col = 0; col < 256; col++) {
        for (let y = skyTop[col]; y <= maxH; y++) light[((y - MIN_Y) << 8) | col] |= 0xf0;
      }
    }
    for (let k = 0; k < 4; k++) {
      const nb = neighbors[k];
      if (nb) seedBorder(c, nb, BORDERS[k][0], BORDERS[k][1], false);
    }
    runAdd(false);

    if (hasSky) {
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          const top = skyTop[(lz << 4) | lx];
          if (top > MAX_Y) continue;
          let hi = top;
          for (let k = 0; k < 4; k++) {
            const ox = lx + BORDERS[k][0];
            const oz = lz + BORDERS[k][1];
            let t = top;
            if (ox >= 0 && ox < 16 && oz >= 0 && oz < 16) t = skyTop[(oz << 4) | ox];
            else {
              const nb = neighbors[k];
              if (nb) t = nb.skyTop[((oz & 15) << 4) | (ox & 15)];
            }
            if (t > hi) hi = t;
          }
          if (hi > MAX_Y + 1) hi = MAX_Y + 1;
          const below = top > MIN_Y && LIGHT_FILTER[blocks[((top - 1 - MIN_Y) << 8) | (lz << 4) | lx] & 0xfff] < 15;
          if (below || hi > top) pushAdd(bx + lx, top, bz + lz);
          for (let y = top + 1; y < hi; y++) pushAdd(bx + lx, y, bz + lz);
        }
      }
      for (let k = 0; k < 4; k++) {
        const nb = neighbors[k];
        if (nb) seedBorder(c, nb, BORDERS[k][0], BORDERS[k][1], true);
      }
      runAdd(true);
    }
    quiet = null;
  };

  return {
    lightChunk,
    update(x, y, z) {
      if (y < MIN_Y || y > MAX_Y) return;
      if (hasSky) updateChannel(x, y, z, true);
      updateChannel(x, y, z, false);
    },
  };
}
