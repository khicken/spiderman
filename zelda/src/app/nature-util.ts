import * as THREE from "three";
import type { Look, World } from "./contracts";
import { LAKE, LANDMARKS, RIVER } from "./contracts";

// Shared helpers for the nature module: seeded random, value noise, shader chunks, geometry builder, instanced layers,
// the 64 m scatter grid and the placement helpers. Owner: nature.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0,1]. */
export function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export function fbm2(x: number, z: number, seed: number): number {
  return vnoise(x, z, seed) * 0.62 + vnoise(x * 2.07 + 17.3, z * 2.07 - 9.1, seed + 1) * 0.38;
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export function sstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------------------------------------------------
// Shader chunks. Everything in this module is a ShaderMaterial that pastes look.glsl and spreads look.uniforms.
// ---------------------------------------------------------------------------------------------------------------------
export const NT_GLSL = /* glsl */ `
float nt_h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nt_n(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(nt_h(i), nt_h(i + vec2(1.0, 0.0)), f.x), mix(nt_h(i + vec2(0.0, 1.0)), nt_h(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec2 nt_wdir() { float l = length(uWind); return l > 0.001 ? uWind / l : vec2(1.0, 0.0); }
// signed sway scalar: positive lean downwind plus a travelling oscillation
float nt_sway(vec2 xz) {
  float l = length(uWind);
  vec2 d = nt_wdir();
  float along = dot(xz, d);
  float gust = 0.5 + 0.5 * sin(uTime * 0.7 + along * 0.05);
  float osc = sin(uTime * (1.5 + l * 0.25) + along * 0.32 + dot(xz, vec2(-d.y, d.x)) * 0.11);
  return (0.30 + l * 0.16) * (0.55 + 0.7 * gust) + (0.10 + l * 0.05) * osc;
}
`;

export function shaderMat(
  look: Look, vs: string, fs: string, uniforms: Record<string, THREE.IUniform>, opts: THREE.ShaderMaterialParameters = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: look.glsl + NT_GLSL + vs,
    fragmentShader: look.glsl + NT_GLSL + fs,
    uniforms: { ...look.uniforms, ...uniforms },
    ...opts,
  });
}

/** Material for merged vertex-coloured meshes (trees, bushes, rocks, driftwood): attributes aCol, aSway; instance matrix + tint. */
const MESH_VS = /* glsl */ `
attribute vec3 aCol;
attribute float aSway;
uniform float uSwayAmt;
varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying vec3 vTint;
void main() {
  vec4 wp = instanceMatrix * vec4(position, 1.0);
  vec3 base = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float s = nt_sway(base.xz + vec2(position.y * 0.7, 0.0));
  float flutter = sin(uTime * 4.3 + position.x * 2.7 + position.z * 3.1 + base.x * 0.7) * 0.5 + 0.5;
  vec2 d = nt_wdir();
  wp.xz += d * (s + flutter * 0.12) * aSway * uSwayAmt;
  vN = normalize(mat3(instanceMatrix) * normal);
  vW = wp.xyz;
  vCol = aCol;
#ifdef USE_INSTANCING_COLOR
  vTint = instanceColor;
#else
  vTint = vec3(1.0);
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const MESH_FS = /* glsl */ `
varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying vec3 vTint;
uniform vec3 uMoss; uniform float uMossAmt; uniform float uPatch;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  vec3 n = normalize(vN);
  float nz = nt_n(vW.xz * 0.9 + vW.y * 0.6);
  vec3 alb = vCol * vTint * (1.0 - uPatch + uPatch * 2.0 * nz);
  float up = smoothstep(0.55, 0.92, n.y);
  alb = mix(alb, uMoss * (0.8 + 0.4 * nz), up * uMossAmt);
  vec3 c = hmShade(alb, n, vW, V);
  c = hmFog(c, length(cameraPosition - vW));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
export function meshMat(look: Look, o: { sway: number; moss?: number; patch?: number; mossColor?: string; side?: THREE.Side }): THREE.ShaderMaterial {
  return shaderMat(look, MESH_VS, MESH_FS, {
    uSwayAmt: { value: o.sway }, uMossAmt: { value: o.moss ?? 0 }, uMoss: { value: new THREE.Color(o.mossColor ?? "#7a9a4a") },
    uPatch: { value: o.patch ?? 0.16 },
  }, { side: o.side ?? THREE.FrontSide });
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry builder: merges primitives into one vertex-coloured geometry (aCol linear, aSway weight).
// ---------------------------------------------------------------------------------------------------------------------
type ColorFn = (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void;
type SwayFn = (p: THREE.Vector3) => number;
type LocalFn = (p: THREE.Vector3, n: THREE.Vector3) => void;

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  sway: number[] = [];
  private p = new THREE.Vector3();
  private n = new THREE.Vector3();
  private c = new THREE.Color();
  private nm = new THREE.Matrix3();

  add(g0: THREE.BufferGeometry, m: THREE.Matrix4, color: ColorFn, sway: SwayFn, local?: LocalFn): void {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const P = g.getAttribute("position"), N = g.getAttribute("normal");
    this.nm.getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      this.p.fromBufferAttribute(P, i);
      this.n.fromBufferAttribute(N, i);
      if (local) local(this.p, this.n);
      this.p.applyMatrix4(m);
      this.n.applyMatrix3(this.nm).normalize();
      color(this.p, this.n, this.c);
      this.pos.push(this.p.x, this.p.y, this.p.z);
      this.nor.push(this.n.x, this.n.y, this.n.z);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.sway.push(sway(this.p));
    }
    if (g !== g0) g.dispose();
    g0.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("aCol", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("aSway", new THREE.Float32BufferAttribute(this.sway, 1));
    return g;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Instanced layer: one InstancedMesh per type, rewritten from the scatter set when the camera moves.
// ---------------------------------------------------------------------------------------------------------------------
export class InstLayer {
  readonly meshes: THREE.InstancedMesh[] = [];
  private n: Int32Array;
  constructor(readonly group: THREE.Group, geoms: THREE.BufferGeometry[], mat: THREE.Material, caps: number[], cast: boolean) {
    this.n = new Int32Array(geoms.length);
    geoms.forEach((g, i) => {
      const m = new THREE.InstancedMesh(g, mat, Math.max(1, caps[i]));
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, caps[i]) * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = cast;
      m.count = 0;
      group.add(m);
      this.meshes.push(m);
    });
  }
  reset(): void { this.n.fill(0); }
  push(type: number, mats: Float32Array, i: number, tint: Float32Array): void {
    const m = this.meshes[type];
    const k = this.n[type];
    if (k >= m.instanceMatrix.count) return;
    const dst = m.instanceMatrix.array as Float32Array, src = i * 16, o = k * 16;
    for (let j = 0; j < 16; j++) dst[o + j] = mats[src + j];
    const tc = (m.instanceColor as THREE.InstancedBufferAttribute).array as Float32Array;
    tc[k * 3] = tint[i * 3]; tc[k * 3 + 1] = tint[i * 3 + 1]; tc[k * 3 + 2] = tint[i * 3 + 2];
    this.n[type] = k + 1;
  }
  commit(): void {
    for (let t = 0; t < this.meshes.length; t++) {
      const m = this.meshes[t];
      m.count = this.n[t];
      m.visible = m.count > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
  dispose(): void {
    for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); m.dispose(); }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Scatter set: static items (matrix + tint + type) bucketed into a coarse grid for cheap distance / hemisphere culling.
// ---------------------------------------------------------------------------------------------------------------------
export const SCATTER_CELL = 64;
const SG = 22; // cells per axis, covers +-704 m
const SOFF = SG / 2;

export class ScatterSet {
  count = 0;
  type: Uint8Array;
  mats: Float32Array;
  tint: Float32Array;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  scale: Float32Array;
  private cellOf: Int32Array;
  private start = new Int32Array(SG * SG + 1);
  private order: Int32Array;
  constructor(readonly cap: number) {
    this.type = new Uint8Array(cap);
    this.mats = new Float32Array(cap * 16);
    this.tint = new Float32Array(cap * 3);
    this.px = new Float32Array(cap); this.py = new Float32Array(cap); this.pz = new Float32Array(cap);
    this.scale = new Float32Array(cap);
    this.cellOf = new Int32Array(cap);
    this.order = new Int32Array(cap);
  }
  /** m: composed instance matrix elements (column major). */
  add(type: number, x: number, y: number, z: number, scale: number, m: THREE.Matrix4, tint: THREE.Color): number {
    if (this.count >= this.cap) return -1;
    const i = this.count++;
    this.type[i] = type;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.scale[i] = scale;
    const e = m.elements;
    for (let j = 0; j < 16; j++) this.mats[i * 16 + j] = e[j];
    this.tint[i * 3] = tint.r; this.tint[i * 3 + 1] = tint.g; this.tint[i * 3 + 2] = tint.b;
    return i;
  }
  finalize(): void {
    const cnt = new Int32Array(SG * SG);
    for (let i = 0; i < this.count; i++) {
      const cx = Math.min(SG - 1, Math.max(0, Math.floor(this.px[i] / SCATTER_CELL) + SOFF));
      const cz = Math.min(SG - 1, Math.max(0, Math.floor(this.pz[i] / SCATTER_CELL) + SOFF));
      const c = cz * SG + cx;
      this.cellOf[i] = c;
      cnt[c]++;
    }
    let acc = 0;
    for (let c = 0; c < SG * SG; c++) { this.start[c] = acc; acc += cnt[c]; }
    this.start[SG * SG] = acc;
    const fill = new Int32Array(SG * SG);
    for (let i = 0; i < this.count; i++) {
      const c = this.cellOf[i];
      this.order[this.start[c] + fill[c]++] = i;
    }
  }
  /** Calls cb(item, dist2) for items within maxDist of the camera that are not clearly behind it. */
  near(camX: number, camZ: number, fx: number, fz: number, maxDist: number, cb: (i: number, d2: number) => void): void {
    const r = Math.ceil(maxDist / SCATTER_CELL) + 1;
    const ccx = Math.floor(camX / SCATTER_CELL) + SOFF, ccz = Math.floor(camZ / SCATTER_CELL) + SOFF;
    const md2 = maxDist * maxDist;
    const cull = fx !== 0 || fz !== 0;
    for (let cz = Math.max(0, ccz - r); cz <= Math.min(SG - 1, ccz + r); cz++) {
      for (let cx = Math.max(0, ccx - r); cx <= Math.min(SG - 1, ccx + r); cx++) {
        const mx = (cx - SOFF + 0.5) * SCATTER_CELL - camX, mz = (cz - SOFF + 0.5) * SCATTER_CELL - camZ;
        const dd = mx * mx + mz * mz;
        const lim = maxDist + SCATTER_CELL * 0.75;
        if (dd > lim * lim) continue;
        if (cull && dd > 40 * 40 && mx * fx + mz * fz < -SCATTER_CELL * 1.1 - 22) continue;
        const c = cz * SG + cx;
        for (let k = this.start[c]; k < this.start[c + 1]; k++) {
          const i = this.order[k];
          const dx = this.px[i] - camX, dz = this.pz[i] - camZ;
          const d2 = dx * dx + dz * dz;
          if (d2 > md2) continue;
          if (cull && d2 > 30 * 30 && dx * fx + dz * fz < -26) continue;
          cb(i, d2);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Placement helpers
// ---------------------------------------------------------------------------------------------------------------------
const FLAT_SITES = LANDMARKS.filter((l) => l.flat > 0);

/** True when (x, z) is inside any landmark flat zone plus `margin`. */
export function inFlatZone(x: number, z: number, margin: number): boolean {
  for (let i = 0; i < FLAT_SITES.length; i++) {
    const l = FLAT_SITES[i];
    const dx = x - l.x, dz = z - l.z, r = l.flat + margin;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

/** Distance to the river centreline minus half its width (negative inside the channel), plus the width there. */
export function riverEdge(x: number, z: number, out: { w: number }): number {
  let best = 1e9, bw = 0;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const a = RIVER[i], b = RIVER[i + 1];
    const abx = b.x - a.x, abz = b.z - a.z;
    const t = clamp01(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz));
    const dx = x - (a.x + abx * t), dz = z - (a.z + abz * t);
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < best) { best = d; bw = a.w + (b.w - a.w) * t; }
  }
  out.w = bw;
  return best - bw * 0.5;
}

export function lakeEdge(x: number, z: number): number {
  return Math.hypot(x - LAKE.x, z - LAKE.z) - LAKE.r;
}

export interface PlaceEnv {
  world: World;
  rnd: () => number;
  seed: number;
  nrm: THREE.Vector3;
  /** Ground y when dry above water by `minDry` m, or NaN. */
  dryHeight(x: number, z: number, minDry: number): number;
}

export function makePlaceEnv(world: World): PlaceEnv {
  const rnd = mulberry32((world.seed ^ 0x9e3779b1) >>> 0);
  return {
    world, rnd, seed: world.seed | 0, nrm: new THREE.Vector3(),
    dryHeight(x, z, minDry) {
      const h = world.heightAt(x, z);
      if (h < 0.05) return NaN;
      const w = world.waterAt(x, z);
      if (w !== -Infinity && h < w + minDry) return NaN;
      return h;
    },
  };
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
/** Compose an instance matrix: translate, yaw, optional tilt toward `n`, scale. */
export function composeMat(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, tiltX = 0, tiltZ = 0): THREE.Matrix4 {
  _e.set(tiltX, yaw, tiltZ, "YXZ");
  _q.setFromEuler(_e);
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

export function hsl(h: number, s: number, l: number): THREE.Color {
  return new THREE.Color().setHSL(h, s, l);
}
