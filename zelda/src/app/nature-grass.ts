import * as THREE from "three";
import type { Look, QualityPreset, World } from "./contracts";
import { LANDMARKS } from "./contracts";
import { clamp01, fbm2, hash2, mulberry32, riverEdge, shaderMat, sstep } from "./nature-util";

// Grass and wildflowers. Both are procedural fields streamed around the camera in 8 m cells: each cell generates its
// blades once (deterministic from the cell and the world seed), tiers get sparser with distance, and the vertex shader
// thins and widens blades smoothly. One instanced draw call per field. Grass and flowers draw in the main pass only:
// no shadow casting, and alpha 1 keeps them out of the bloom glow mask.

const STRIDE = 8; // x y z | yaw scale rank tone | cutTime
const CELL = 8;
const G = 176;
const GO = G / 2;

interface Cell {
  cx: number; cz: number;
  tier: number;
  state: 0 | 1; // 1 = generated
  count: number;
  data: Float32Array | null;
  view: Float32Array | null;
}

interface FieldOpts {
  edges: number[];
  th: number[];
  cap0: number;
  maxBlades: number;
  gen(cx: number, cz: number, tier: number, th: number, out: Float32Array, cap: number): number;
}

class StreamField {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private buf: THREE.InstancedInterleavedBuffer;
  private packed: Float32Array;
  private cells: (Cell | null)[] = new Array<Cell | null>(G * G).fill(null);
  private active: Cell[] = [];
  private pool: Float32Array[][];
  private qIdx = new Int32Array(4096);
  private qTier = new Uint8Array(4096);
  private qD = new Float32Array(4096);
  private qN = 0; private qHead = 0;
  private lastCx = 1e9; private lastCz = 1e9;
  private dirty = true;
  private lastPack = -1;
  private packFx = 0; private packFz = 0;
  private recentCuts = new Float32Array(16 * 4);
  private cutN = 0;
  total = 0;
  generatedRecently = 0;

  constructor(private group: THREE.Group, base: THREE.BufferGeometry, mat: THREE.Material, private o: FieldOpts) {
    this.pool = o.edges.map(() => []);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    for (const k of Object.keys(base.attributes)) this.geo.setAttribute(k, base.attributes[k]);
    this.packed = new Float32Array(o.maxBlades * STRIDE);
    this.buf = new THREE.InstancedInterleavedBuffer(this.packed, STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("aPos", new THREE.InterleavedBufferAttribute(this.buf, 3, 0));
    this.geo.setAttribute("aData", new THREE.InterleavedBufferAttribute(this.buf, 4, 3));
    this.geo.setAttribute("aCut", new THREE.InterleavedBufferAttribute(this.buf, 1, 7));
    this.geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.userData.hmNoShadow = true;
    this.mesh.userData.hmPass = "grass";
    group.add(this.mesh);
  }

  private tierFor(d: number, cur: number): number {
    const e = this.o.edges;
    for (let t = 0; t < e.length; t++) {
      const hi = e[t] + (cur === t ? 4 : cur > t ? -4 : 0);
      if (d < hi) return t;
    }
    return -1;
  }

  private acquire(tier: number): Float32Array {
    const p = this.pool[tier];
    if (p.length) return p.pop() as Float32Array;
    return new Float32Array(Math.ceil(this.o.cap0 * this.o.th[tier] * 1.2 + 24) * STRIDE);
  }

  private release(c: Cell): void {
    if (c.data) this.pool[c.tier].push(c.data);
    c.data = null; c.view = null; c.count = 0; c.state = 0;
  }

  private scan(camX: number, camZ: number): void {
    const outer = this.o.edges[this.o.edges.length - 1];
    const r = Math.ceil(outer / CELL) + 1;
    const ccx = Math.floor(camX / CELL), ccz = Math.floor(camZ / CELL);
    this.qN = 0; this.qHead = 0;
    for (let j = this.active.length - 1; j >= 0; j--) {
      const c = this.active[j];
      const dx = (c.cx + 0.5) * CELL - camX, dz = (c.cz + 0.5) * CELL - camZ;
      if (dx * dx + dz * dz > (outer + CELL * 2) ** 2) {
        this.release(c);
        this.cells[(c.cz + GO) * G + c.cx + GO] = null;
        this.active[j] = this.active[this.active.length - 1];
        this.active.pop();
        this.dirty = true;
      }
    }
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = ccx + dx, cz = ccz + dz;
        if (cx < -GO + 1 || cx >= GO - 1 || cz < -GO + 1 || cz >= GO - 1) continue;
        const mx = (cx + 0.5) * CELL - camX, mz = (cz + 0.5) * CELL - camZ;
        const d = Math.sqrt(mx * mx + mz * mz);
        const ci = (cz + GO) * G + cx + GO;
        const cell = this.cells[ci];
        const tier = this.tierFor(d, cell ? cell.tier : -1);
        if (tier < 0) continue;
        if (cell && cell.state === 1 && cell.tier === tier) continue;
        if (this.qN >= this.qIdx.length) continue;
        let k = this.qN++;
        while (k > 0 && this.qD[k - 1] > d) {
          this.qIdx[k] = this.qIdx[k - 1]; this.qTier[k] = this.qTier[k - 1]; this.qD[k] = this.qD[k - 1];
          k--;
        }
        this.qIdx[k] = ci; this.qTier[k] = tier; this.qD[k] = d;
      }
    }
  }

  private applyCuts(c: Cell, now: number): void {
    if (!c.data) return;
    for (let k = 0; k < Math.min(this.cutN, 16); k++) {
      const cx = this.recentCuts[k * 4], cz = this.recentCuts[k * 4 + 1], cr = this.recentCuts[k * 4 + 2], ct = this.recentCuts[k * 4 + 3];
      if (now - ct > 28) continue;
      for (let i = 0; i < c.count; i++) {
        const o = i * STRIDE;
        const dx = c.data[o] - cx, dz = c.data[o + 2] - cz;
        if (dx * dx + dz * dz < cr * cr) c.data[o + 7] = ct;
      }
    }
  }

  cut(x: number, z: number, r: number, now: number): number {
    const k = this.cutN++ % 16;
    this.recentCuts[k * 4] = x; this.recentCuts[k * 4 + 1] = z; this.recentCuts[k * 4 + 2] = r; this.recentCuts[k * 4 + 3] = now;
    let n = 0;
    const c0x = Math.floor((x - r) / CELL), c1x = Math.floor((x + r) / CELL), c0z = Math.floor((z - r) / CELL), c1z = Math.floor((z + r) / CELL);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        if (cx < -GO || cx >= GO || cz < -GO || cz >= GO) continue;
        const c = this.cells[(cz + GO) * G + cx + GO];
        if (!c || !c.data) continue;
        for (let i = 0; i < c.count; i++) {
          const o = i * STRIDE;
          const dx = c.data[o] - x, dz = c.data[o + 2] - z;
          if (dx * dx + dz * dz < r * r) { c.data[o + 7] = now; n++; }
        }
      }
    }
    if (n) this.dirty = true;
    return n;
  }

  private pack(camX: number, camZ: number, fx: number, fz: number, now: number): void {
    let n = 0;
    const cap = this.packed.length;
    const cull = fx !== 0 || fz !== 0;
    const near2 = (this.o.edges[0] + CELL) ** 2;
    for (let i = 0; i < this.active.length; i++) {
      const c = this.active[i];
      if (!c.view || c.count === 0) continue;
      const mx = (c.cx + 0.5) * CELL - camX, mz = (c.cz + 0.5) * CELL - camZ;
      if (cull && mx * mx + mz * mz > near2 && mx * fx + mz * fz < -CELL * 1.6) continue;
      const len = c.count * STRIDE;
      if (n + len > cap) continue;
      this.packed.set(c.view, n);
      n += len;
    }
    this.geo.instanceCount = n / STRIDE;
    this.total = n / STRIDE;
    this.buf.clearUpdateRanges();
    if (n > 0) this.buf.addUpdateRange(0, n);
    this.buf.needsUpdate = true;
    this.lastPack = now;
    this.packFx = fx; this.packFz = fz;
    this.dirty = false;
  }

  /** budgetMs: time allowed for generating cells this frame. */
  update(camX: number, camZ: number, fx: number, fz: number, now: number, budgetMs: number): void {
    const ccx = Math.floor(camX / CELL), ccz = Math.floor(camZ / CELL);
    if (ccx !== this.lastCx || ccz !== this.lastCz) {
      this.lastCx = ccx; this.lastCz = ccz;
      this.scan(camX, camZ);
    }
    const t0 = performance.now();
    while (this.qHead < this.qN) {
      const ci = this.qIdx[this.qHead], tier = this.qTier[this.qHead];
      this.qHead++;
      const cx = (ci % G) - GO, cz = Math.floor(ci / G) - GO;
      let c = this.cells[ci];
      if (!c) {
        c = { cx, cz, tier, state: 0, count: 0, data: null, view: null };
        this.cells[ci] = c;
        this.active.push(c);
      } else if (c.data) {
        this.release(c);
      }
      c.tier = tier;
      const data = this.acquire(tier);
      const cap = Math.floor(data.length / STRIDE);
      const n = this.o.gen(cx, cz, tier, this.o.th[tier], data, cap);
      c.count = n;
      c.state = 1;
      if (n === 0) { this.pool[tier].push(data); c.data = null; c.view = null; } else { c.data = data; c.view = data.subarray(0, n * STRIDE); this.applyCuts(c, now); }
      this.dirty = true;
      if (performance.now() - t0 > budgetMs) break;
    }
    if (this.cutN > 0 && false) this.dirty = true;
    const turned = fx * this.packFx + fz * this.packFz < 0.9;
    if (this.dirty && (now - this.lastPack > 0.12 || this.lastPack < 0)) this.pack(camX, camZ, fx, fz, now);
    else if (turned && now - this.lastPack > 0.12) this.pack(camX, camZ, fx, fz, now);
  }

  pending(): number { return this.qN - this.qHead; }

  clear(): void {
    for (const c of this.active) this.release(c);
    this.active.length = 0;
    this.cells.fill(null);
    this.qN = 0; this.qHead = 0;
    this.lastCx = 1e9;
    this.geo.instanceCount = 0;
    this.dirty = true;
  }

  dispose(): void {
    this.group.remove(this.mesh);
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------------------------------------------------
const SHARED_VS_HEAD = /* glsl */ `
attribute vec3 aPos; attribute vec4 aData; attribute float aCut;
uniform float uDist; uniform float uD0; uniform float uThin; uniform float uH; uniform float uWidth;
`;

const GRASS_VS = SHARED_VS_HEAD + /* glsl */ `
varying float vH; varying vec3 vW; varying float vTone; varying float vVar; varying float vPush;
void main() {
  float yaw = aData.x, sc = aData.y, rank = aData.z;
  float tone = floor(aData.w); float vr = fract(aData.w);
  float d = length(aPos.xz - cameraPosition.xz);
  float f = pow(1.0 - clamp((d - uD0) / (uDist - uD0), 0.0, 1.0), uThin);
  float vis = clamp((f - rank) * 14.0, 0.0, 1.0);
  if (vis <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float gr = aCut > -1000.0 ? mix(0.18, 1.0, smoothstep(0.0, 30.0, uTime - aCut)) : 1.0;
  float hs = uH * sc * vis * gr;
  float w = uWidth * (1.0 + (1.0 - f) * 2.4) * (0.8 + 0.4 * vr) * (0.4 + 0.6 * vis);
  float t = position.y;
  vec2 face = vec2(sin(yaw), cos(yaw));
  vec2 side = vec2(face.y, -face.x);
  vec2 pv = aPos.xz - uPlayerPos.xz;
  float pd = length(pv);
  float push = (1.0 - smoothstep(0.3, 2.1, pd)) * (1.0 - smoothstep(1.4, 3.2, abs(aPos.y - uPlayerPos.y)));
  vec2 pdir = pv / max(pd, 0.001);
  float sw = nt_sway(aPos.xz);
  float tt = t * t;
  vec2 off = (face * (0.22 + 0.1 * vr) + nt_wdir() * sw * 0.42 + side * sin(uTime * 2.1 + aPos.x * 3.1 + aPos.z * 2.3) * 0.05 * (0.4 + length(uWind) * 0.15) + pdir * push * 1.05) * hs * tt;
  float L = t * hs;
  float dl = length(off);
  if (dl > L * 0.96) off *= L * 0.96 / max(dl, 0.0001);
  float y = sqrt(max(L * L - dot(off, off), 0.0));
  vec3 wp = vec3(aPos.x + off.x + side.x * position.x * w, aPos.y + y, aPos.z + off.y + side.y * position.x * w);
  vH = t; vW = wp; vTone = tone; vVar = vr; vPush = push;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const GRASS_FS = /* glsl */ `
varying float vH; varying vec3 vW; varying float vTone; varying float vVar; varying float vPush;
uniform vec3 uBase[4]; uniform vec3 uTip[4];
void main() {
  int ti = int(vTone + 0.5);
  vec3 base = uBase[ti], tip = uTip[ti];
  float t = vH;
  vec3 col = mix(base, tip, smoothstep(0.0, 0.95, t) * (0.78 + 0.3 * vVar));
  float wave = nt_n(vW.xz * 0.045 + nt_wdir() * uTime * 0.55);
  float patch1 = nt_n(vW.xz * 0.11 + 7.0);
  col *= 0.86 + 0.26 * wave;
  col = mix(col, col * vec3(1.08, 1.04, 0.84), smoothstep(0.62, 0.9, patch1) * 0.5);
  col *= 0.6 + 0.4 * smoothstep(0.0, 0.5, t);
  col += tip * 0.16 * pow(t, 3.0) * (0.6 + 0.8 * wave);
  vec3 V = normalize(cameraPosition - vW);
  vec3 c = hmShade(col, normalize(vec3(0.0, 1.0, 0.0) + (vec3(0.0, 0.0, 0.0))), vW, V);
  c = hmFog(c, length(cameraPosition - vW));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Flowers are crossed painted cards (fix 16): two quads with a clump of 3 blossoms on stems. The card texture holds
// masks, not colors: R petals, G centers, B stems, so one texture serves every palette color.
const FLOWER_VS = SHARED_VS_HEAD + /* glsl */ `
attribute vec2 aUv;
varying vec2 vUv; varying float vIdx; varying vec3 vW; varying float vVar;
void main() {
  float yaw = aData.x, sc = aData.y, rank = aData.z;
  float idx = floor(aData.w); float vr = fract(aData.w);
  float d = length(aPos.xz - cameraPosition.xz);
  float f = pow(1.0 - clamp((d - uD0) / (uDist - uD0), 0.0, 1.0), uThin);
  float vis = clamp((f - rank) * 14.0, 0.0, 1.0);
  if (vis <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float gr = aCut > -1000.0 ? mix(0.18, 1.0, smoothstep(0.0, 30.0, uTime - aCut)) : 1.0;
  float hs = uH * sc * vis * gr * (1.0 + d * 0.01);
  float cs = cos(yaw), sn = sin(yaw);
  vec2 pv = aPos.xz - uPlayerPos.xz;
  float pd = length(pv);
  float push = (1.0 - smoothstep(0.3, 1.9, pd)) * (1.0 - smoothstep(1.4, 3.2, abs(aPos.y - uPlayerPos.y)));
  vec2 pdir = pv / max(pd, 0.001);
  float sw = nt_sway(aPos.xz + 3.0);
  float t = position.y;
  vec2 off = (nt_wdir() * sw * 0.3 + pdir * push * 0.9) * hs * t * t;
  vec3 local = vec3(position.x * uWidth * hs, 0.0, position.z * uWidth * hs);
  vec3 rl = vec3(local.x * cs + local.z * sn, 0.0, -local.x * sn + local.z * cs);
  vec3 wp = vec3(aPos.x + off.x + rl.x, aPos.y + t * hs, aPos.z + off.y + rl.z);
  vUv = aUv; vIdx = idx; vW = wp; vVar = vr;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FLOWER_FS = /* glsl */ `
varying vec2 vUv; varying float vIdx; varying vec3 vW; varying float vVar;
uniform vec3 uPal[6]; uniform sampler2D uCard;
void main() {
  vec4 m = texture2D(uCard, vUv);
  if (m.a < 0.5) discard;
  vec3 w = m.rgb / max(m.r + m.g + m.b, 1e-3);
  vec3 petal = uPal[int(vIdx + 0.5)] * (0.9 + 0.2 * vVar);
  vec3 stem = mix(vec3(0.07, 0.17, 0.05), vec3(0.22, 0.38, 0.12), vUv.y);
  vec3 col = w.r * petal + w.g * vec3(0.95, 0.66, 0.1) + w.b * stem;
  vec3 V = normalize(cameraPosition - vW);
  vec3 c = hmShade(col, vec3(0.0, 1.0, 0.0), vW, V);
  c = hmFog(c, length(cameraPosition - vW));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function flowerCardTexture(): THREE.Texture {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  if (g) {
    // (x, head height, radius) per blossom, in card units (x -0.5..0.5, y 0..1 bottom-up)
    const heads: [number, number, number][] = [[-0.22, 0.66, 0.15], [0.12, 0.92, 0.16], [0.28, 0.5, 0.13]];
    const X = (x: number) => (x + 0.5) * S, Y = (y: number) => (1 - y) * S;
    g.strokeStyle = "rgb(0,0,255)";
    g.lineWidth = 2.2;
    g.lineCap = "round";
    for (const [x, y] of heads) {
      g.beginPath();
      g.moveTo(X(x * 0.3), Y(0));
      g.quadraticCurveTo(X(x * 0.8), Y(y * 0.5), X(x), Y(y));
      g.stroke();
    }
    for (const [x, y, r] of heads) {
      g.fillStyle = "rgb(255,0,0)";
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + x * 3;
        g.beginPath();
        g.ellipse(X(x) + Math.cos(a) * r * S * 0.5, Y(y) + Math.sin(a) * r * S * 0.5, r * S * 0.42, r * S * 0.27, a, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "rgb(0,255,0)";
      g.beginPath();
      g.arc(X(x), Y(y), r * S * 0.24, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** 5 triangles, or 3 on low (the bend shows less at phone resolution). */
function bladeGeometry(low: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const ys = low ? [0, 0.5, 1] : [0, 0.34, 0.68, 1];
  const ws = low ? [1, 0.62, 0] : [1, 0.82, 0.5, 0];
  const rows = ys.length - 1;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < rows; i++) pos.push(-ws[i] * 0.5, ys[i], 0, ws[i] * 0.5, ys[i], 0);
  pos.push(0, 1, 0);
  for (let i = 0; i < rows - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const a = (rows - 1) * 2;
  idx.push(a, a + 1, a + 2);
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function flowerGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < 2; k++) {
    const b = k * 4;
    const ax = k === 0 ? 1 : 0, az = k === 0 ? 0 : 1;
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      pos.push((u - 0.5) * ax, v, (u - 0.5) * az);
      uv.push(u, v);
    }
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aUv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// Grass system
// ---------------------------------------------------------------------------------------------------------------------
const SHRINE = LANDMARKS.find((l) => l.id === "shrine");
const FLAT_OTHER = LANDMARKS.filter((l) => l.flat > 0 && l.id !== "shrine");

function thinF(d: number, d0: number, D: number, p: number): number {
  return Math.pow(1 - clamp01((d - d0) / (D - d0)), p);
}

const SUB = 4; // sub-blocks per cell side
const SUBS = CELL / SUB;

export class GrassSystem {
  private grass!: StreamField;
  private flowers!: StreamField;
  private gMat!: THREE.ShaderMaterial;
  private fMat!: THREE.ShaderMaterial;
  private q!: QualityPreset;
  private nrm = new THREE.Vector3();
  private edge = { w: 0 };
  private dens = new Float32Array(SUB * SUB);
  private tone = new Uint8Array(SUB * SUB);
  private wl = new Float32Array(SUB * SUB);
  private fl = new Float32Array(SUB * SUB);
  private seed: number;
  private edgeW = { w: 0 };
  private blades = 0;
  private card: THREE.Texture | null = null;

  constructor(private group: THREE.Group, private look: Look, private world: World, q: QualityPreset) {
    this.seed = world.seed | 0;
    this.build(q);
  }

  private build(q: QualityPreset): void {
    this.q = q;
    const D = q.grassDist;
    const cap0 = Math.max(8, Math.round(CELL * CELL * 24 * q.grassDensity));
    const d0 = D * 0.14;
    const edges = [0.2 * D, 0.38 * D, 0.62 * D, D + 2];
    const th = edges.map((e, i) => (i === 0 ? 1 : thinF(e - CELL * 0.75, d0, D, 1.5)));
    let maxBlades = 0;
    edges.forEach((e, i) => {
      const lo = i ? edges[i - 1] : 0;
      maxBlades += (Math.PI * (e * e - lo * lo) / (CELL * CELL) * 1.25 + 10) * cap0 * th[i] * 0.9;
    });
    const gMat = shaderMat(this.look, GRASS_VS, GRASS_FS, {
      uDist: { value: D }, uD0: { value: d0 }, uThin: { value: 1.5 }, uH: { value: 0.5 }, uWidth: { value: 0.085 },
      uBase: { value: ["#5d8a3a", "#3a5a30", "#8a8a4c", "#4c8a48"].map((c) => new THREE.Color(c)) },
      uTip: { value: ["#aecb6e", "#7a9a58", "#cbbd7c", "#9ccf74"].map((c) => new THREE.Color(c)) },
    }, { side: THREE.DoubleSide });
    this.gMat = gMat;
    this.grass = new StreamField(this.group, bladeGeometry(q.grassDensity < 0.2), gMat, {
      edges, th, cap0, maxBlades: Math.ceil(maxBlades), gen: (cx, cz, tier, t, out, cap) => this.genGrass(cx, cz, th[tier] === t ? t : t, out, cap, cap0),
    });

    const Df = Math.max(24, D * 0.8);
    const fcap0 = Math.max(4, Math.round(CELL * CELL * 0.7 * q.grassDensity));
    const fd0 = Df * 0.2;
    const fedges = [0.4 * Df, 0.7 * Df, Df + 2];
    const fth = fedges.map((e, i) => (i === 0 ? 1 : thinF(e - CELL * 0.75, fd0, Df, 1.2)));
    let fmax = 0;
    fedges.forEach((e, i) => {
      const lo = i ? fedges[i - 1] : 0;
      fmax += (Math.PI * (e * e - lo * lo) / (CELL * CELL) * 1.25 + 10) * fcap0 * fth[i] * 0.45;
    });
    const pal = ["#f6efe0", "#f4cf45", "#e987a8", "#9a84dc", "#f08a3c", "#7fa8e6"].map((c) => new THREE.Color(c));
    this.card ??= flowerCardTexture();
    const fMat = shaderMat(this.look, FLOWER_VS, FLOWER_FS, {
      uDist: { value: Df }, uD0: { value: fd0 }, uThin: { value: 1.2 }, uH: { value: 0.38 }, uWidth: { value: 0.95 }, uPal: { value: pal },
      uCard: { value: this.card },
    }, { side: THREE.DoubleSide });
    this.fMat = fMat;
    this.flowers = new StreamField(this.group, flowerGeometry(), fMat, {
      edges: fedges, th: fth, cap0: fcap0, maxBlades: Math.ceil(fmax) + 64, gen: (cx, cz, tier, t, out, cap) => this.genFlowers(cx, cz, out, cap, fcap0, t),
    });
  }

  setQuality(q: QualityPreset): void {
    this.grass.dispose();
    this.flowers.dispose();
    this.build(q);
  }

  /** Per sub-block ground classification: density 0..1, tone 0..3, water level. */
  private classify(x0: number, z0: number, flowers: boolean): void {
    const w = this.world;
    for (let j = 0; j < SUB; j++) {
      for (let i = 0; i < SUB; i++) {
        const k = j * SUB + i;
        const x = x0 + (i + 0.5) * SUBS, z = z0 + (j + 0.5) * SUBS;
        const h = w.heightAt(x, z);
        this.wl[k] = w.waterAt(x, z);
        const biome = w.biomeAt(x, z);
        w.normalAt(x, z, this.nrm);
        let d = 0, tone = 0;
        switch (biome) {
          case "meadow": d = 1; tone = 0; break;
          case "forest": d = 0.82; tone = 1; break;
          case "lakeshore": d = 1; tone = 3; break;
          case "highland": d = 0.7 * (1 - 0.6 * sstep(70, 140, h)); tone = 2; break;
          case "beach": d = h > 2.4 ? 0.28 : 0; tone = 2; break;
          case "ash": d = 0.1; tone = 2; break;
          default: d = 0;
        }
        const ny = this.nrm.y;
        d *= sstep(0.42, 0.72, ny);
        if (d > 0) {
          const n = fbm2(x * 0.05, z * 0.05, this.seed + 3);
          d *= 0.5 + 0.5 * sstep(0.18, 0.46, n);
          const re = riverEdge(x, z, this.edge);
          if (re < 0.6) d = 0;
          else if (re < 2) d *= 0.5;
          for (let q = 0; q < FLAT_OTHER.length; q++) {
            const l = FLAT_OTHER[q];
            const dd = Math.hypot(x - l.x, z - l.z);
            if (dd < l.flat) d *= 0.22;
            else if (dd < l.flat + 5) d *= 0.6;
          }
          if (SHRINE) {
            const dd = Math.hypot(x - SHRINE.x, z - SHRINE.z);
            if (dd < 7) d *= 0.4;
          }
        }
        this.dens[k] = d;
        this.tone[k] = tone;
        if (flowers) {
          const n = fbm2(x * 0.034, z * 0.034, this.seed + 17);
          let f = sstep(0.52, 0.66, n) + 0.025;
          if (biome === "forest") f *= 0.25;
          else if (biome === "highland") f *= 0.35;
          else if (biome === "beach" || biome === "ash") f *= 0.1;
          this.fl[k] = f * (d > 0 ? Math.min(1, d + 0.2) : 0);
        }
      }
    }
  }

  private genGrass(cx: number, cz: number, th: number, out: Float32Array, cap: number, cap0: number): number {
    const x0 = cx * CELL, z0 = cz * CELL;
    if (x0 * x0 + z0 * z0 > 600 * 600) return 0;
    this.classify(x0, z0, false);
    let any = false;
    for (let k = 0; k < SUB * SUB; k++) if (this.dens[k] > 0.02) { any = true; break; }
    if (!any) return 0;
    const rnd = mulberry32(((cx * 73856093) ^ (cz * 19349663) ^ (this.seed * 83492791)) >>> 0);
    const w = this.world;
    let n = 0;
    for (let i = 0; i < cap0 && n < cap; i++) {
      const r1 = rnd(), r2 = rnd(), r3 = rnd(), rank = rnd(), r5 = rnd(), r6 = rnd();
      if (rank >= th) continue;
      const si = Math.min(SUB - 1, Math.floor(r1 * SUB)), sj = Math.min(SUB - 1, Math.floor(r2 * SUB));
      const k = sj * SUB + si;
      if (r5 > this.dens[k]) continue;
      const x = x0 + r1 * CELL, z = z0 + r2 * CELL;
      const h = w.heightAt(x, z);
      const wl = this.wl[k];
      if (wl !== -Infinity && h < wl + 0.12) continue;
      const tone = this.tone[k];
      const hm = tone === 1 ? 0.72 : tone === 2 ? 0.62 : tone === 3 ? 1.15 : 1;
      const clump = 0.78 + 0.5 * vnoiseFast(x * 0.09, z * 0.09, this.seed);
      const o = n * STRIDE;
      out[o] = x; out[o + 1] = h - 0.03; out[o + 2] = z;
      out[o + 3] = r3 * Math.PI * 2;
      out[o + 4] = (0.65 + r6 * 0.7) * hm * clump;
      out[o + 5] = rank;
      out[o + 6] = tone + Math.min(0.99, hash2(i, cx + cz * 131, 9));
      out[o + 7] = -1e4;
      n++;
    }
    this.blades += n;
    return n;
  }

  private genFlowers(cx: number, cz: number, out: Float32Array, cap: number, cap0: number, th: number): number {
    const x0 = cx * CELL, z0 = cz * CELL;
    if (x0 * x0 + z0 * z0 > 600 * 600) return 0;
    this.classify(x0, z0, true);
    let any = false;
    for (let k = 0; k < SUB * SUB; k++) if (this.fl[k] > 0.02) { any = true; break; }
    if (!any) return 0;
    const rnd = mulberry32(((cx * 2654435761) ^ (cz * 40503) ^ (this.seed * 97)) >>> 0);
    const w = this.world;
    let n = 0;
    for (let i = 0; i < cap0 && n < cap; i++) {
      const r1 = rnd(), r2 = rnd(), r3 = rnd(), rank = rnd(), r5 = rnd(), r6 = rnd(), r7 = rnd();
      if (rank >= th) continue;
      const si = Math.min(SUB - 1, Math.floor(r1 * SUB)), sj = Math.min(SUB - 1, Math.floor(r2 * SUB));
      const k = sj * SUB + si;
      if (r5 > this.fl[k]) continue;
      const x = x0 + r1 * CELL, z = z0 + r2 * CELL;
      const h = w.heightAt(x, z);
      const wl = this.wl[k];
      if (wl !== -Infinity && h < wl + 0.15) continue;
      const patchColor = Math.floor(hash2(Math.floor(x / 7), Math.floor(z / 7), this.seed + 5) * 6);
      const idx = r7 < 0.72 ? patchColor : Math.floor(r6 * 6) % 6;
      const o = n * STRIDE;
      out[o] = x; out[o + 1] = h - 0.03; out[o + 2] = z;
      out[o + 3] = r3 * Math.PI * 2;
      out[o + 4] = 0.8 + r6 * 0.5;
      out[o + 5] = rank;
      out[o + 6] = idx + Math.min(0.99, r7);
      out[o + 7] = -1e4;
      n++;
    }
    return n;
  }

  update(camX: number, camZ: number, fx: number, fz: number, now: number, budgetMs: number): void {
    this.grass.update(camX, camZ, fx, fz, now, budgetMs);
    this.flowers.update(camX, camZ, fx, fz, now, budgetMs * 0.4);
  }

  /** Generate everything near (x, z) synchronously, up to maxMs. */
  prewarm(x: number, z: number, maxMs: number): void {
    const t0 = performance.now();
    while (performance.now() - t0 < maxMs && (this.grass.pending() > 0 || this.grass.total === 0)) {
      this.grass.update(x, z, 0, 0, 0, 40);
      this.flowers.update(x, z, 0, 0, 0, 20);
      if (this.grass.pending() === 0) break;
    }
  }

  cut(x: number, z: number, r: number, now: number): number {
    return this.grass.cut(x, z, r, now) + this.flowers.cut(x, z, r, now);
  }

  stats(): { grass: number; flowers: number } {
    return { grass: this.grass.total, flowers: this.flowers.total };
  }

  dispose(): void {
    this.grass.dispose();
    this.flowers.dispose();
    this.card?.dispose();
  }
}

function vnoiseFast(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
