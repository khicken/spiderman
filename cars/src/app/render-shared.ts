import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

// Layers: fx draws in a second pass on high+ so soft particles can read scene depth. The sky skips the normal prepass.
export const LAYER = { fx: 2, sky: 3 } as const;

export const LIGHT = {
  sunDir: { value: new THREE.Vector3(0, 1, 0) }, // toward the active light (sun or moon)
  sunColor: { value: new THREE.Color(1, 1, 1) }, // light color × intensity
  ambient: { value: new THREE.Color(0.3, 0.35, 0.4) }, // sky irradiance / π, for unlit-by-three shaders
  fogColor: { value: new THREE.Color() },
  time: { value: 0 },
  tDepth: { value: null as THREE.Texture | null },
  depthInfo: { value: new THREE.Vector4(0.1, 1000, 1, 1) }, // near, far, width, height
  soft: { value: 0 }, // 1 when tDepth holds this frame's opaque depth
  night: { value: 0 },
};

// Tree density over the terrain, written by scenery, read by the ground shader for forest floor and far canopy.
export const FOREST = { tForest: { value: null as THREE.Texture | null }, uForestBox: { value: new THREE.Vector4(0, 0, 1, 1) }, uForestOn: { value: 0 } };

// Static merged meshes never read their arrays again, so free the CPU copy once the GPU has it.
function freeArray(this: THREE.BufferAttribute) {
  (this as unknown as { array: null }).array = null;
}
export function dropAfterUpload(g: THREE.BufferGeometry) {
  for (const a of Object.values(g.attributes)) (a as THREE.BufferAttribute).onUpload(freeArray);
  g.index?.onUpload(freeArray);
  return g;
}

// Work spread over frames: render.frame pumps jobs for a few ms per frame.
const jobs: Iterator<unknown>[] = [];
export function runSoon<T extends Iterator<unknown>>(it: T) {
  jobs.push(it);
  return it;
}
export function runNow(it: Iterator<unknown>) {
  while (!it.next().done);
}
export function cancelJob(it: Iterator<unknown> | null) {
  const i = it ? jobs.indexOf(it) : -1;
  if (i >= 0) jobs.splice(i, 1);
  return i >= 0;
}
export const jobsPending = () => jobs.length > 0;
export function pumpJobs(ms: number) {
  const t0 = performance.now();
  while (jobs.length && performance.now() - t0 < ms) if (jobs[0].next().done) jobs.shift();
}

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function fsMaterial(frag: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string | number> = {}) {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false, toneMapped: false });
}

export const target = (type: THREE.TextureDataType = THREE.HalfFloatType, filter: THREE.MagnificationTextureFilter = THREE.LinearFilter) =>
  new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false, minFilter: filter, magFilter: filter });

const quad = { q: null as FullScreenQuad | null, n: 0 };
export function sharedQuad() {
  quad.q ??= new FullScreenQuad();
  quad.n++;
  return quad.q;
}
export function releaseQuad() {
  if (--quad.n > 0 || !quad.q) return;
  quad.q.dispose();
  quad.q = null;
}

export function blit(r: THREE.WebGLRenderer, m: THREE.Material, dst: THREE.WebGLRenderTarget | null) {
  const q = sharedQuad();
  q.material = m;
  r.setRenderTarget(dst);
  q.render(r);
  releaseQuad();
}

// Tileable 256² noise. r: billow fbm, g: high frequency fbm, b: worley-like cells, a: white noise.
let noise: THREE.DataTexture | null = null;
let noiseUsers = 0;
export function noiseTexture() {
  noiseUsers++;
  if (noise) return noise;
  const N = 256;
  const lat = (p: number, seed: number) => {
    const g = new Float32Array(p * p);
    let s = seed;
    for (let i = 0; i < g.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      g[i] = s / 4294967296;
    }
    return g;
  };
  const value = (g: Float32Array, p: number, x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = g[((yi % p) * p + (xi % p)) | 0], b = g[((yi % p) * p + ((xi + 1) % p)) | 0];
    const c = g[(((yi + 1) % p) * p + (xi % p)) | 0], d = g[(((yi + 1) % p) * p + ((xi + 1) % p)) | 0];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const cells = (x: number, y: number, p: number) => {
    const pts = lat(p * 2, 77);
    const cx = (x / N) * p, cy = (y / N) * p;
    let best = 9;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const gx = Math.floor(cx) + i, gy = Math.floor(cy) + j;
        const wx = ((gx % p) + p) % p, wy = ((gy % p) + p) % p;
        const k = (wy * p + wx) * 2 % pts.length;
        const dx = gx + pts[k] - cx, dy = gy + pts[k + 1] - cy;
        best = Math.min(best, dx * dx + dy * dy);
      }
    return Math.sqrt(best);
  };
  const cache = new Map<string, Float32Array>();
  const latC = (p: number, seed: number) => {
    const k = p + ":" + seed;
    let g = cache.get(k);
    if (!g) cache.set(k, (g = lat(p, seed)));
    return g;
  };
  const fbmC = (x: number, y: number, base: number, oct: number, seed: number) => {
    let s = 0, a = 0.5, w = 0;
    for (let o = 0; o < oct; o++) {
      const p = base << o;
      s += a * value(latC(p, seed + o), p, (x / N) * p, (y / N) * p);
      w += a;
      a *= 0.5;
    }
    return s / w;
  };
  const data = new Uint8Array(N * N * 4);
  const rnd = lat(N, 9);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const b = fbmC(x, y, 4, 5, 1);
      const w = 1 - Math.min(1, cells(x, y, 8) * 1.2);
      data[i] = Math.round(THREE.MathUtils.clamp((b - 0.5) * 1.6 + 0.5, 0, 1) * 255);
      data[i + 1] = Math.round(fbmC(x, y, 16, 4, 31) * 255);
      data[i + 2] = Math.round(THREE.MathUtils.clamp(w * 0.7 + fbmC(x, y, 8, 3, 57) * 0.4, 0, 1) * 255);
      data[i + 3] = Math.round(rnd[y * N + x] * 255);
    }
  noise = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  noise.magFilter = THREE.LinearFilter;
  noise.minFilter = THREE.LinearMipmapLinearFilter;
  noise.generateMipmaps = true;
  noise.needsUpdate = true;
  return noise;
}
export function releaseNoise() {
  if (--noiseUsers > 0 || !noise) return;
  noise.dispose();
  noise = null;
}

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as unknown as { __forest: unknown }).__forest = FOREST;
