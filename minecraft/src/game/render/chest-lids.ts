import * as THREE from "three";
import { metaOf, type BlockState, type MeshBuffers, type WorldApi } from "../contracts";
import { blockDef } from "../blocks/registry";
import { chestPartnerH } from "../mechanics/chest";
import { FACE_H, HX, HZ } from "../mechanics/util";
import { cellsGeometry } from "../mesh/block-geometry";
import { buffersToGeometry } from "../mesh/materials";
import { quadIndex } from "../mesh/writer";
import type { ChunkMeshes } from "./chunks";

// Vanilla ChestLidController: the lid opens 0.1 per tick and the renderer eases it with 1 - (1 - t)^3.
// While a chest is open or still closing, its blocks leave the chunk mesh and this model draws them,
// split at the top of the base so the lid can swing on its back edge.

const CUT = 10 / 16;
const TOP = 14 / 16;
const E = 1e-4;
const SPEED = 2; // openness per second (0.1 per tick)
const INSIDE = 0.45; // shade for the open faces inside the base and under the lid
const SETTLE_MS = 2000;

type Cell = [number, number, number, BlockState];

interface Lid {
  cells: Cell[];
  viewers: number;
  open: number;
  released: number; // time the cells went back to the chunk mesh, 0 while hidden
  root: THREE.Group;
  hinge: THREE.Group;
  geos: THREE.BufferGeometry[];
  light: number;
}

export function createChestLids(world: WorldApi, scene: THREE.Scene, chunks: ChunkMeshes, material: THREE.Material) {
  const lids = new Map<string, Lid>();
  const keyOf = (c: Cell) => `${c[0]},${c[1]},${c[2]}`;

  // Both halves of the chest at a block, the left half first, or null when it is not a chest.
  function cellsAt(x: number, y: number, z: number): Cell[] | null {
    const s = world.getBlock(x, y, z);
    if (blockDef(s)?.shape !== "chest") return null;
    const d = chestPartnerH(world, x, y, z, s);
    if (d < 0) return [[x, y, z, s]];
    const o: Cell = [x + HX[d], y, z + HZ[d], world.getBlock(x + HX[d], y, z + HZ[d])];
    return metaOf(s) & 8 ? [[x, y, z, s], o] : [o, [x, y, z, s]];
  }

  function hide(cells: Cell[], on: boolean) {
    for (const [x, y, z] of cells) chunks.setHidden(x, y, z, on);
  }

  function build(cells: Cell[], viewers: number, open: number): Lid {
    const [x, y, z, s] = cells[0];
    const h = FACE_H[metaOf(s) & 7];
    const fx = h >= 0 ? HX[h] : 0, fz = h >= 0 ? HZ[h] : -1;
    // The left half sits at (1, 0, 1) so its partner may be at x or z 0.
    const local: Cell[] = cells.map((c) => [c[0] - x + 1, 0, c[2] - z + 1, c[3]]);
    const { base, lid } = split(cellsGeometry(local), fx, fz);
    const geos = [buffersToGeometry(base), buffersToGeometry(lid)];
    const root = new THREE.Group();
    root.position.set(x - 1, y, z - 1);
    root.add(new THREE.Mesh(geos[0], material));
    const hx = 1.5 - fx * (7 / 16), hz = 1.5 - fz * (7 / 16);
    const hinge = new THREE.Group();
    hinge.position.set(hx, CUT, hz);
    hinge.userData.axis = new THREE.Vector3(-fz, 0, fx);
    const lidMesh = new THREE.Mesh(geos[1], material);
    lidMesh.position.set(-hx, -CUT, -hz);
    hinge.add(lidMesh);
    root.add(hinge);
    scene.add(root);
    hide(cells, true);
    return { cells, viewers, open, released: 0, root, hinge, geos, light: -1 };
  }

  function drop(key: string, l: Lid) {
    scene.remove(l.root);
    for (const g of l.geos) g.dispose();
    if (!l.released) hide(l.cells, false);
    lids.delete(key);
  }

  function sound(name: string, x?: number, y?: number, z?: number) {
    const m = /chest\.(open|close)$/.exec(name);
    if (!m || x === undefined || y === undefined || z === undefined) return;
    const cells = cellsAt(Math.floor(x), Math.floor(y), Math.floor(z));
    if (!cells) return;
    const key = keyOf(cells[0]);
    let l = lids.get(key);
    if (m[1] === "close") {
      if (l) l.viewers = Math.max(0, l.viewers - 1);
      return;
    }
    if (!l) lids.set(key, (l = build(cells, 0, 0)));
    l.viewers++;
    if (l.released) {
      l.released = 0;
      hide(l.cells, true);
    }
  }

  function update(dt: number) {
    for (const [key, l] of [...lids]) {
      const cur = cellsAt(l.cells[0][0], l.cells[0][1], l.cells[0][2]);
      if (!cur) {
        drop(key, l);
        continue;
      }
      if (cur.length !== l.cells.length || cur.some((c, i) => keyOf(c) !== keyOf(l.cells[i]) || c[3] !== l.cells[i][3])) {
        // Re-paired, re-oxidized or waxed while open: rebuild from the blocks as they are now.
        const { viewers, open } = l;
        drop(key, l);
        lids.set(keyOf(cur[0]), build(cur, viewers, open));
        continue;
      }
      l.open = Math.max(0, Math.min(1, l.open + (l.viewers > 0 ? 1 : -1) * SPEED * dt));
      if (l.viewers === 0 && l.open === 0) {
        if (!l.released) {
          l.released = performance.now();
          hide(l.cells, false);
        }
        // Keep drawing the closed chest until the section mesh has it back.
        if (l.cells.every(([x, y, z]) => chunks.settled(x, y, z)) || performance.now() - l.released > SETTLE_MS) drop(key, l);
        continue;
      }
      const f = 1 - l.open;
      l.hinge.quaternion.setFromAxisAngle(l.hinge.userData.axis as THREE.Vector3, (1 - f * f * f) * (Math.PI / 2));
      const [x, y, z] = l.cells[0];
      const light = world.getSkyLight(x, y, z) * 16 + world.getBlockLight(x, y, z);
      if (light !== l.light) {
        l.light = light;
        for (const g of l.geos) {
          const a = g.getAttribute("aLight") as THREE.BufferAttribute;
          const arr = a.array as Uint8Array;
          for (let i = 0; i < arr.length; i += 2) {
            arr[i] = (light >> 4) * 17;
            arr[i + 1] = (light & 15) * 17;
          }
          a.needsUpdate = true;
        }
      }
    }
  }

  function clear() {
    for (const [key, l] of [...lids]) drop(key, l);
  }

  return { sound, update, clear };
}

export type ChestLids = ReturnType<typeof createChestLids>;

// Splits a chest mesh at the top of the base. The latch goes with the lid, and both cut faces get a dark cap.
export function split(b: MeshBuffers, fx: number, fz: number): { base: MeshBuffers; lid: MeshBuffers } {
  const P = b.attributes.position.array as Float32Array;
  const UV = b.attributes.aUv.array as Uint8Array;
  const LT = b.attributes.aLight.array as Uint8Array;
  const COL = b.attributes.aColor.array as Uint8Array;
  const LAY = b.attributes.aLayer.array as Uint16Array;
  const base = out(), lid = out();
  const front = (v: number) => 0.5 - ((P[v * 3] - 1.5) * fx + (P[v * 3 + 2] - 1.5) * fz);
  const n = P.length / 3;
  for (let q = 0; q < n; q += 4) {
    let lo = Infinity, hi = -Infinity, latch = true;
    for (let k = 0; k < 4; k++) {
      const y = P[(q + k) * 3 + 1];
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
      if (front(q + k) > 1 / 16 + E) latch = false;
    }
    latch &&= lo >= 7 / 16 - E && hi <= 11 / 16 + E;
    const all = [q, q + 1, q + 2, q + 3];
    if (latch || lo >= CUT - E) {
      push(lid, all, null);
      if (!latch && hi - lo < E && Math.abs(lo - TOP) < E) {
        push(base, all, CUT, INSIDE);
        push(lid, [...all].reverse(), CUT, INSIDE);
      }
    } else if (hi <= CUT + E) push(base, all, null);
    else {
      push(base, all, null, 1, "below");
      push(lid, all, null, 1, "above");
    }
  }
  return { base: done(base), lid: done(lid) };

  function out() {
    return { pos: [] as number[], uv: [] as number[], lt: [] as number[], col: [] as number[], lay: [] as number[] };
  }

  // Copies one quad. flatY moves every corner to that height; clip pulls corners on the far side of CUT
  // onto it, sliding the texture coordinate along the edge to the corner with the same x and z.
  function push(o: ReturnType<typeof out>, vs: number[], flatY: number | null, shade = 1, clip?: "below" | "above") {
    for (const v of vs) {
      let y = P[v * 3 + 1], u = UV[v * 4], w = UV[v * 4 + 1];
      if (flatY !== null) y = flatY;
      else if (clip && (clip === "below" ? y > CUT + E : y < CUT - E)) {
        const p = vs.find((j) => j !== v && Math.abs(P[j * 3] - P[v * 3]) < E && Math.abs(P[j * 3 + 2] - P[v * 3 + 2]) < E);
        if (p !== undefined) {
          const t = (CUT - y) / (P[p * 3 + 1] - y);
          u += (UV[p * 4] - u) * t;
          w += (UV[p * 4 + 1] - w) * t;
        }
        y = CUT;
      }
      o.pos.push(P[v * 3], y, P[v * 3 + 2]);
      o.uv.push(Math.round(u), Math.round(w), UV[v * 4 + 2], UV[v * 4 + 3]);
      o.lt.push(LT[v * 2], LT[v * 2 + 1]);
      o.col.push(COL[v * 4], COL[v * 4 + 1], COL[v * 4 + 2], Math.round(COL[v * 4 + 3] * shade));
      o.lay.push(LAY[v * 2], LAY[v * 2 + 1]);
    }
  }

  function done(o: ReturnType<typeof out>): MeshBuffers {
    return {
      attributes: {
        position: { array: new Float32Array(o.pos), itemSize: 3 },
        aUv: { array: new Uint8Array(o.uv), itemSize: 4 },
        aLight: { array: new Uint8Array(o.lt), itemSize: 2, normalized: true },
        aColor: { array: new Uint8Array(o.col), itemSize: 4, normalized: true },
        aLayer: { array: new Uint16Array(o.lay), itemSize: 2 },
      },
      index: quadIndex(o.pos.length / 12),
    };
  }
}
