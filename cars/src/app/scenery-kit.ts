import * as THREE from "three";
import type { MapData, MapId, Quality, Track } from "./contracts";

export type Tier = { far: number; detail: number; trees: number; treeNear: number; treeFar: number; treeShadow: boolean; crowd: number; props: number };

// render.ts owns QUALITY for the screen. These are the scenery budgets per preset.
export const TIERS: Record<Quality, Tier> = {
  low: { far: 700, detail: 0, trees: 2000, treeNear: 45, treeFar: 600, treeShadow: false, crowd: 0.25, props: 0.4 },
  medium: { far: 1300, detail: 1, trees: 8000, treeNear: 90, treeFar: 1100, treeShadow: false, crowd: 0.5, props: 0.7 },
  high: { far: 2200, detail: 2, trees: 20000, treeNear: 160, treeFar: 1800, treeShadow: true, crowd: 0.8, props: 1 },
  ultra: { far: 4000, detail: 3, trees: 64000, treeNear: 320, treeFar: 3200, treeShadow: true, crowd: 1, props: 1 },
};

export type TreeKind = "spruce" | "pine" | "larch" | "oak" | "beech" | "palm" | "plane" | "cypress";

// Facade styles, read by the building shader: 0 belle epoque, 1 concrete tower, 2 glass curtain, 3 victorian, 4 alpine, 5 pit, 6 roof, 7 trim, 8 railing.
export type Style = {
  facade: number[]; // weighted facade styles
  tall: number; // height above which a building uses the tower styles
  wall: string[]; // facade palette
  roof: string[];
  gable: boolean; // pitched roofs on small quads
  balcony: boolean;
  bay: boolean;
  lit: number; // share of lit windows at night
  trees: TreeKind[];
  street: TreeKind | null; // trees along other roads
  wild: number; // forest density outside the green polygons, 0..1
  treeline: number; // no trees above this height
  snowline: number;
  autumn: number; // 0..1 share of autumn crowns
  lights: boolean; // street lights along the track
  fence: boolean; // catch fences along the barriers
  stands: number; // grandstand count near the start
  marshal: boolean;
  pit: boolean;
  yachts: boolean;
  ocean: boolean;
  ring: "alps" | "hills" | "coast" | "city" | "bay";
  neon: boolean;
  soundWall: boolean;
  cable: boolean;
};

const base: Style = {
  facade: [1], tall: 30, wall: ["#bdb4a6", "#a9a39a", "#c9c0b0", "#8f8a84"], roof: ["#55524f", "#6a6560"], gable: false, balcony: false, bay: false, lit: 0.45,
  trees: ["oak", "beech"], street: null, wild: 0, treeline: 9999, snowline: 9999, autumn: 0, lights: false, fence: false, stands: 1, marshal: false, pit: false,
  yachts: false, ocean: false, ring: "hills", neon: false, soundWall: false, cable: false,
};

export const STYLES: Record<MapId, Style> = {
  monaco: {
    ...base, facade: [0, 0, 0, 0, 1], tall: 40, wall: ["#e8d6b0", "#e3c48f", "#f0e2c6", "#e9b98f", "#f2d9c9", "#d9c7a0", "#efe6d2", "#e6cfa3", "#f3c9a8"],
    roof: ["#b45f3c", "#a8573a", "#9c9890", "#b8b2a6", "#8e8a83", "#a9a399", "#c9c3b6"], balcony: true, lit: 0.38, trees: ["palm", "palm", "plane", "cypress"], street: "palm",
    lights: true, fence: true, stands: 3, yachts: true, ocean: true, ring: "coast",
  },
  tokyo: {
    ...base, facade: [1, 1, 2], tall: 25, wall: ["#9a9a96", "#b4b1aa", "#7d7f82", "#c8c4bb", "#6c6e70", "#a7a39a"], roof: ["#4d4d4d", "#5c5c5a"],
    lit: 0.45, trees: ["plane", "oak"], street: "plane", lights: true, stands: 0, ring: "city", neon: true, soundWall: true,
  },
  sanfrancisco: {
    ...base, facade: [3, 3, 3, 1], tall: 22, wall: ["#d9a7a0", "#a8c4c9", "#e8d9a0", "#b9c9a4", "#d8c3d8", "#f0ebe0", "#9fb4cf", "#e6b98c", "#c4d8cc"],
    roof: ["#4f4f52", "#5d5a56"], bay: true, lit: 0.5, trees: ["cypress", "plane", "oak"], street: "plane", lights: true, stands: 1, ocean: true, ring: "bay", cable: true,
  },
  nordschleife: {
    ...base, facade: [4], wall: ["#e8e2d6", "#d8cdb8", "#c9bba2", "#efe9df"], roof: ["#3d3a3a", "#5a2e24", "#4a4440"], gable: true,
    trees: ["spruce", "spruce", "spruce", "beech", "beech", "oak"], wild: 0.85, autumn: 0.75, stands: 2, marshal: true, pit: true, fence: true,
  },
  spa: {
    ...base, facade: [4], wall: ["#e6e0d4", "#cfc6b4", "#bfb39c", "#ebe4d8"], roof: ["#36383b", "#4a4440"], gable: true,
    trees: ["spruce", "spruce", "spruce", "beech", "oak"], wild: 0.8, autumn: 0.15, stands: 3, marshal: true, pit: true, fence: true,
  },
  stelvio: {
    ...base, facade: [4], wall: ["#ece6da", "#d2c4a8", "#b8a888"], roof: ["#4b4744", "#5f5a55"], gable: true,
    trees: ["larch", "spruce", "spruce", "larch"], wild: 0.55, treeline: 2150, snowline: 2600, stands: 0, ring: "alps",
  },
};

export const U = { time: { value: 0 }, night: { value: 0 }, snow: { value: 0 } };

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296;
}

export function hash2(x: number, z: number) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function noise2(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x: number, z: number) {
  return noise2(x, z) * 0.5 + noise2(x * 2.1, z * 2.1) * 0.3 + noise2(x * 4.3, z * 4.3) * 0.2;
}

export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function pick<T>(r: () => number, a: readonly T[]) {
  return a[Math.floor(r() * a.length) % a.length];
}

export function pointIn(poly: ArrayLike<number>, o: number, n: number, x: number, z: number) {
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[o + i * 2], zi = poly[o + i * 2 + 1], xj = poly[o + j * 2], zj = poly[o + j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Records of `n, a, then n x,z pairs`; extra = number of header values after n.
export function eachRecord(arr: readonly number[], extra: number, fn: (o: number, n: number, head: number) => void) {
  let i = 0;
  while (i < arr.length) {
    const n = arr[i];
    fn(i + 1 + extra, n, i);
    i += 1 + extra + n * 2;
  }
}

// Distance from a point to the drivable corridor (road plus runoff). Negative inside.
export type RoadIndex = { edge(x: number, z: number): number; nearest: number; side: number };

export function createRoadIndex(map: MapData): RoadIndex {
  const C = 40, P = map.center, N = P.length / 3;
  const cells = new Map<number, number[]>();
  const half = (i: number) => map.width[i] / 2 + map.runoff[i] + 0.6;
  const segs = map.closed ? N : N - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % N, r = Math.max(half(i), half(j)) + 40;
    const x0 = Math.floor((Math.min(P[i * 3], P[j * 3]) - r) / C), x1 = Math.floor((Math.max(P[i * 3], P[j * 3]) + r) / C);
    const z0 = Math.floor((Math.min(P[i * 3 + 2], P[j * 3 + 2]) - r) / C), z1 = Math.floor((Math.max(P[i * 3 + 2], P[j * 3 + 2]) + r) / C);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const k = cx * 73856093 + cz;
        let l = cells.get(k);
        if (!l) cells.set(k, (l = []));
        l.push(i);
      }
  }
  const idx: RoadIndex = {
    nearest: -1,
    side: 0,
    edge(x, z) {
      const l = cells.get(Math.floor(x / C) * 73856093 + Math.floor(z / C));
      let best = 40;
      idx.nearest = -1;
      if (!l) return best;
      for (const i of l) {
        const j = (i + 1) % N;
        const ax = P[i * 3], az = P[i * 3 + 2], dx = P[j * 3] - ax, dz = P[j * 3 + 2] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        const px = x - ax - dx * t, pz = z - az - dz * t;
        const d = Math.hypot(px, pz) - (half(i) * (1 - t) + half(j) * t);
        if (d < best) {
          best = d;
          idx.nearest = i;
          idx.side = dx * pz - dz * px > 0 ? -1 : 1; // +1 left of travel (x east, z south)
        }
      }
      return best;
    },
  };
  return idx;
}

// Track frame helper without the Track contract: centerline index to position and left vector.
export function centerAt(map: MapData, i: number, pos: THREE.Vector3, left: THREE.Vector3) {
  const P = map.center, N = P.length / 3;
  const a = ((i % N) + N) % N, b = map.closed ? (a + 1) % N : Math.min(a + 1, N - 1), c = b === a ? Math.max(a - 1, 0) : a;
  pos.set(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]);
  const dx = P[b * 3] - P[c * 3], dz = P[b * 3 + 2] - P[c * 3 + 2], l = Math.hypot(dx, dz) || 1;
  left.set(dz / l, 0, -dx / l); // forward (dx,dz) turned 90° to the left with x east, z south
  return pos;
}

export function sinkY(track: Track, x: number, z: number, r: number) {
  return Math.min(track.heightAt(x - r, z - r), track.heightAt(x + r, z - r), track.heightAt(x - r, z + r), track.heightAt(x + r, z + r), track.heightAt(x, z));
}

// Writes a yaw + scale + translation into an instanceMatrix array.
export function writeInst(a: Float32Array, i: number, x: number, y: number, z: number, yaw: number, sx: number, sy = sx, sz = sx) {
  const c = Math.cos(yaw), s = Math.sin(yaw), o = i * 16;
  a[o] = c * sx; a[o + 1] = 0; a[o + 2] = -s * sx; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = s * sz; a[o + 9] = 0; a[o + 10] = c * sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}

// Geometry builder for merged static meshes: position, normal, color, plus a vec4 facade attribute.
export class Geo {
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  f: number[] = [];
  t: number[] = [];
  col = new THREE.Color();
  fac = [0, 0, 0, 7];
  top = 0;
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, fa?: number[], fb?: number[], fc?: number[]) {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    this.p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let k = 0; k < 3; k++) {
      this.n.push(nx, ny, nz);
      this.c.push(this.col.r, this.col.g, this.col.b);
      this.t.push(this.top);
    }
    const f = this.fac;
    this.f.push(...(fa ?? f), ...(fb ?? f), ...(fc ?? f));
  }
  // Quad a b c d counterclockwise seen from the front. u/v per corner go into the facade attribute.
  quad(a: number[], b: number[], c: number[], d: number[], uv?: number[]) {
    const f = this.fac;
    const fa = uv ? [uv[0], uv[1], f[2], f[3]] : f, fb = uv ? [uv[2], uv[3], f[2], f[3]] : f, fc = uv ? [uv[4], uv[5], f[2], f[3]] : f, fd = uv ? [uv[6], uv[7], f[2], f[3]] : f;
    this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], fa, fb, fc);
    this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], fa, fc, fd);
  }
  // Axis box rotated by yaw around its base center.
  box(x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (lx: number, ly: number, lz: number) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const W = w / 2, D = d / 2;
    const v = [P(-W, 0, D), P(W, 0, D), P(W, h, D), P(-W, h, D), P(-W, 0, -D), P(W, 0, -D), P(W, h, -D), P(-W, h, -D)];
    this.quad(v[0], v[1], v[2], v[3]);
    this.quad(v[5], v[4], v[7], v[6]);
    this.quad(v[1], v[5], v[6], v[2]);
    this.quad(v[4], v[0], v[3], v[7]);
    this.quad(v[3], v[2], v[6], v[7]);
  }
  get count() {
    return this.p.length / 3;
  }
  build(withFac = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    if (withFac) {
      g.setAttribute("aFac", new THREE.Float32BufferAttribute(this.f, 4));
      g.setAttribute("aTop", new THREE.Float32BufferAttribute(this.t, 1));
    }
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) for (const x of Array.isArray(mat) ? mat : [mat]) {
      for (const v of Object.values(x)) if (v instanceof THREE.Texture) v.dispose();
      x.dispose();
    }
  });
}

// Far backdrop: keep the direction, write depth at the far plane, and fog it as if it stood at uRingD.
export const RING_D = { value: 1500 };
export function farPatch(s: { uniforms: Record<string, THREE.IUniform>; vertexShader: string }) {
  s.uniforms.uRingD = RING_D;
  const pos = THREE.ShaderChunk.fog_vertex.includes("vFogPos");
  s.vertexShader = s.vertexShader
    .replace("#include <common>", "#include <common>\nuniform float uRingD;")
    .replace(
      "#include <fog_vertex>",
      `#include <fog_vertex>
      gl_Position.z = gl_Position.w * 0.99999;
      #ifdef USE_FOG
      vFogDepth = min(vFogDepth, uRingD);
      ${pos ? "vFogPos *= min(1.0, uRingD / max(length(vFogPos), 1.0));" : ""}
      #endif`,
    );
}
