import * as THREE from "three";
import type { MeshBuffers } from "../contracts";

// three multi-draws a mesh flagged isBatchedMesh and binds its batchingTexture and batchingIdTexture,
// so a page reuses those names for the section offsets and the draw-to-slot map.
// Vertex data lives only on the GPU (GLBufferAttribute plus bufferSubData). Positions are Int16 in 1/1024 block.
export const PAGE_VERTS = 1 << 18;
const TEX = 64;
const MAX_SLOTS = TEX * TEX;
export const POS_SCALE = 1024;
const GL_BYTE = 0x1401, GL_SHORT = 0x1402, GL_USHORT = 0x1403;
const ATTRS: [string, number, number, number, boolean][] = [
  ["position", GL_SHORT, 2, 3, false],
  ["aUv", GL_BYTE, 1, 4, false],
  ["aLight", GL_BYTE, 1, 2, true],
  ["aColor", GL_BYTE, 1, 4, true],
  ["aLayer", GL_USHORT, 2, 2, false],
];
let sharedIndex: THREE.BufferAttribute | null = null;
function quadIndex() {
  if (sharedIndex) return sharedIndex;
  const a = new Uint32Array((PAGE_VERTS * 3) / 2);
  for (let q = 0, i = 0; q < PAGE_VERTS / 4; q++, i += 6) {
    const v = q * 4;
    a[i] = v; a[i + 1] = v + 1; a[i + 2] = v + 2; a[i + 3] = v; a[i + 4] = v + 2; a[i + 5] = v + 3;
  }
  return (sharedIndex = new THREE.BufferAttribute(a, 1));
}
let posScratch = new Int16Array(3 * 16384);

const CLASS: number[] = [];
for (let s = 64; s < PAGE_VERTS; s = Math.ceil((s * 1.25) / 4) * 4) CLASS.push(s);
CLASS.push(PAGE_VERTS);
function classOf(n: number) {
  let lo = 0, hi = CLASS.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (CLASS[mid] >= n) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

interface Page extends THREE.Mesh {
  buffers: WebGLBuffer[];
  next: number;
  free: Map<number, number[]>;
  freeIds: number[];
  nextId: number;
  count: number;
  offsets: Float32Array;
  offsetsDirty: boolean;
  starts: Int32Array;
  counts: Int32Array;
  ids: Uint32Array;
}

interface Slot {
  page: Page;
  id: number;
  start: number;
  cls: number;
  indexCount: number;
  verts: number;
}

const noRaycast = () => {};

export function createSectionBatches(gl: WebGL2RenderingContext, parent: THREE.Object3D, material: THREE.Material, renderOrder: number, name: string) {
  const pages: Page[] = [];
  const slots = new Map<number, Slot>();

  function newPage(): Page {
    const g = new THREE.BufferGeometry();
    const buffers: WebGLBuffer[] = [];
    for (const [n, type, bytes, size, norm] of ATTRS) {
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, PAGE_VERTS * size * bytes, gl.DYNAMIC_DRAW);
      buffers.push(buf);
      g.setAttribute(n, new THREE.GLBufferAttribute(buf, type, size, bytes as 1 | 2 | 4, PAGE_VERTS, norm) as unknown as THREE.BufferAttribute);
    }
    g.setIndex(quadIndex());
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    const offsets = new Float32Array(MAX_SLOTS * 4);
    const ids = new Uint32Array(MAX_SLOTS);
    const offTex = new THREE.DataTexture(offsets, TEX, TEX, THREE.RGBAFormat, THREE.FloatType);
    const idTex = new THREE.DataTexture(ids, TEX, TEX, THREE.RedIntegerFormat, THREE.UnsignedIntType);
    const p = Object.assign(new THREE.Mesh(g, material), {
      buffers, next: 0, free: new Map<number, number[]>(), freeIds: [] as number[], nextId: 0, count: 0,
      offsets, offsetsDirty: false, starts: new Int32Array(MAX_SLOTS), counts: new Int32Array(MAX_SLOTS), ids,
    }) as Page;
    const raw = p as unknown as Record<string, unknown>;
    raw.isBatchedMesh = true;
    raw._matricesTexture = offTex;
    raw._indirectTexture = idTex;
    raw._colorsTexture = null;
    raw._multiDrawStarts = p.starts;
    raw._multiDrawCounts = p.counts;
    raw._multiDrawCount = 0;
    p.raycast = noRaycast;
    p.frustumCulled = false;
    p.matrixAutoUpdate = false;
    p.renderOrder = renderOrder;
    p.name = name;
    p.visible = false;
    parent.add(p);
    pages.push(p);
    return p;
  }

  function alloc(cls: number): Slot {
    for (const p of pages) {
      const list = p.free.get(cls);
      if (list?.length && (p.freeIds.length || p.nextId < MAX_SLOTS)) return take(p, cls, list.pop()!);
    }
    const size = CLASS[cls];
    for (const p of pages) if (p.next + size <= PAGE_VERTS && (p.freeIds.length || p.nextId < MAX_SLOTS)) return bump(p, cls);
    return bump(newPage(), cls);
  }

  function bump(p: Page, cls: number): Slot {
    const start = p.next;
    p.next += CLASS[cls];
    return take(p, cls, start);
  }

  function take(p: Page, cls: number, start: number): Slot {
    const id = p.freeIds.length ? p.freeIds.pop()! : p.nextId++;
    return { page: p, id, start, cls, indexCount: 0, verts: 0 };
  }

  function release(s: Slot) {
    const p = s.page;
    let list = p.free.get(s.cls);
    if (!list) p.free.set(s.cls, (list = []));
    list.push(s.start);
    p.freeIds.push(s.id);
  }

  function set(key: number, b: MeshBuffers, ox: number, oy: number, oz: number) {
    const n = b.attributes.position.array.length / 3;
    let s = slots.get(key);
    if (s && CLASS[s.cls] < n) {
      release(s);
      s = undefined;
    }
    if (!s) {
      s = alloc(classOf(n));
      slots.set(key, s);
    }
    const pos = b.attributes.position.array;
    if (posScratch.length < pos.length) posScratch = new Int16Array(pos.length * 2);
    for (let i = 0; i < pos.length; i++) posScratch[i] = Math.round(pos[i] * POS_SCALE);
    for (let a = 0; a < ATTRS.length; a++) {
      const [name, , bytes, size] = ATTRS[a];
      gl.bindBuffer(gl.ARRAY_BUFFER, s.page.buffers[a]);
      if (a === 0) gl.bufferSubData(gl.ARRAY_BUFFER, s.start * size * bytes, posScratch, 0, n * size);
      else gl.bufferSubData(gl.ARRAY_BUFFER, s.start * size * bytes, b.attributes[name].array);
    }
    s.indexCount = (n / 4) * 6;
    s.verts = n;
    const o = s.id * 4;
    s.page.offsets[o] = ox;
    s.page.offsets[o + 1] = oy;
    s.page.offsets[o + 2] = oz;
    s.page.offsetsDirty = true;
  }

  function remove(key: number) {
    const s = slots.get(key);
    if (!s) return;
    release(s);
    slots.delete(key);
  }

  function begin() {
    for (const p of pages) p.count = 0;
  }

  function draw(key: number) {
    const s = slots.get(key);
    if (!s) return;
    const p = s.page;
    p.starts[p.count] = ((s.start * 3) / 2) * 4;
    p.counts[p.count] = s.indexCount;
    p.ids[p.count] = s.id;
    p.count++;
  }

  function end() {
    for (const p of pages) {
      const raw = p as unknown as Record<string, unknown>;
      raw._multiDrawCount = p.count;
      p.visible = p.count > 0;
      if (p.count) (raw._indirectTexture as THREE.DataTexture).needsUpdate = true;
      if (p.offsetsDirty) {
        p.offsetsDirty = false;
        (raw._matricesTexture as THREE.DataTexture).needsUpdate = true;
      }
    }
  }

  function usedVerts() {
    let n = 0;
    for (const s of slots.values()) n += s.verts;
    return n;
  }

  function dispose() {
    for (const p of pages) {
      const raw = p as unknown as Record<string, THREE.DataTexture>;
      parent.remove(p);
      p.geometry.dispose();
      for (const buf of p.buffers) gl.deleteBuffer(buf);
      raw._matricesTexture.dispose();
      raw._indirectTexture.dispose();
    }
    pages.length = 0;
    slots.clear();
  }

  return { set, remove, has: (key: number) => slots.has(key), begin, draw, end, dispose, pageCount: () => pages.length, usedVerts };
}

export type SectionBatches = ReturnType<typeof createSectionBatches>;
