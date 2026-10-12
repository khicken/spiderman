import * as THREE from "three";

export type Keys = readonly (readonly [number, number])[];

// Monotone cubic (Fritsch-Carlson): smooth through the keys, never overshoots.
export function curve(k: Keys): (x: number) => number {
  const n = k.length;
  const xs = k.map((p) => p[0]);
  const ys = k.map((p) => p[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1e-6));
  const m: number[] = [d[0] ?? 0];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (3 * (xs[i + 1] - xs[i - 1])) / ((2 * xs[i + 1] - xs[i] - xs[i - 1]) / d[i - 1] + (xs[i + 1] + xs[i] - 2 * xs[i - 1]) / d[i]));
  m.push(d[n - 2] ?? 0);
  return (x: number) => {
    if (n === 1 || x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// Signed power, keeps the sign: superellipse helper.
export const spow = (x: number, p: number) => Math.sign(x) * Math.pow(Math.abs(x), p);

// Grid params 0..1 with `n` even steps plus exact breakpoints, so material borders fall on grid lines.
export function steps(n: number, breaks: readonly number[] = []): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(i / n);
  for (const b of breaks) if (b > 0 && b < 1) out.push(b);
  out.sort((a, b) => a - b);
  const res: number[] = [];
  for (const v of out) if (!res.length || v - res[res.length - 1] > 1e-4) res.push(v);
  return res;
}

// Ensure the attribute set that every merged car mesh shares.
export function prep(g: THREE.BufferGeometry, uv1 = true): THREE.BufferGeometry {
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(i);
    g.setIndex(idx);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (uv1 && !g.attributes.uv1) g.setAttribute("uv1", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv" && !(uv1 && k === "uv1") && k !== "color" && k !== "lamp" && k !== "pbr") g.deleteAttribute(k);
  return g;
}

export function paint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) (a[i * 3] = c.r), (a[i * 3 + 1] = c.g), (a[i * 3 + 2] = c.b);
  g.setAttribute("color", new THREE.Float32BufferAttribute(a, 3));
  return g;
}

// Kinds in pbr.w for the shared car body material.
export const KIND = { plain: 0, paint: 1, grille: 2, carbon: 3 } as const;

// Fills the attributes every merged body part shares: color, pbr (roughness, metalness, clearcoat, kind) and lamp id.
export function finish(g: THREE.BufferGeometry, hex: number, rough: number, metal: number, cc = 0, kind = 0, lamp = 0): THREE.BufferGeometry {
  if (!g.attributes.color) paint(g, hex);
  const n = g.attributes.position.count;
  if (!g.attributes.pbr) {
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) a.set([rough, metal, cc, kind], i * 4);
    g.setAttribute("pbr", new THREE.Float32BufferAttribute(a, 4));
  }
  if (!g.attributes.lamp) g.setAttribute("lamp", new THREE.Float32BufferAttribute(new Float32Array(n).fill(lamp), 1));
  return g;
}

export function xform(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  g.applyMatrix4(m);
  return g;
}

// Mirror across x = 0 and fix the winding.
export function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone();
  m.scale(-1, 1, 1);
  const idx = m.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  return m;
}

export function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
