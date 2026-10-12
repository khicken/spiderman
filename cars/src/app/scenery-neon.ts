import * as THREE from "three";
import type { MapData, Track } from "./contracts";
import { clockwise } from "./scenery-buildings";
import { Geo, rng, U, type RoadIndex } from "./scenery-kit";

// Abstract light patterns only: panels, borders, chase bulbs, LED gradients. No glyph shapes.
const FRAG = /* glsl */ `
varying vec4 vSign; uniform float uNight; uniform float uTime;
float nh(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
`;

const MAIN = /* glsl */ `
float kind = floor(vSign.w + 0.5); vec2 p = vSign.xy; float h = vSign.z;
vec3 sc = vec3(0.0); float lum = 0.0;
if (kind < 0.5) {
  float cell = floor(p.y / 1.15); vec2 f = vec2(fract(p.x / 1.6), fract(p.y / 1.15));
  float rn = nh(vec2(cell, h * 100.0));
  vec3 base = hue(h + rn * 0.18);
  float panel = step(0.08, f.x) * step(f.x, 0.92) * step(0.08, f.y) * step(f.y, 0.92);
  float inner = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.75);
  float bulbs = step(0.5, fract(p.y * 3.0 - uTime * 2.0 * step(0.5, rn))) * (1.0 - panel);
  sc = mix(base * 0.35, base, panel) + vec3(1.0, 0.95, 0.85) * inner * step(0.55, rn) * 0.7 + vec3(1.0, 0.9, 0.7) * bulbs;
  lum = 1.0;
} else if (kind < 1.5) {
  float t = uTime * 0.25 + h * 10.0;
  vec3 a = hue(fract(h + 0.1 * sin(t + p.x * 0.15)));
  vec3 b = hue(fract(h + 0.5 + 0.1 * cos(t * 0.7 + p.y * 0.2)));
  float m = 0.5 + 0.5 * sin(p.x * 0.35 + p.y * 0.25 + t * 1.7);
  sc = mix(a, b, m) * (0.6 + 0.4 * sin(t * 3.0 + p.y));
  float px = step(0.25, fract(p.x * 12.0)) * step(0.25, fract(p.y * 12.0));
  sc *= 0.75 + 0.25 * px;
  lum = 0.85;
} else if (kind < 2.5) {
  float edge = smoothstep(0.0, 0.12, p.y) * smoothstep(1.0, 0.88, p.y);
  sc = mix(hue(h) * 0.5, vec3(1.0, 0.97, 0.9), edge * 0.6);
  lum = 0.9;
} else if (kind < 3.5) {
  sc = vec3(0.04);
} else {
  float split = 0.35 + 0.3 * nh(vec2(h, 7.0));
  vec3 a = hue(h), b = mix(vec3(0.95), hue(h + 0.5), 0.3);
  sc = mix(a, b, step(split * 12.0, p.x));
  sc *= 0.75 + 0.25 * smoothstep(0.0, 5.0, p.y);
  lum = 0.6;
}
diffuseColor.rgb = mix(vec3(0.05), sc * 0.55, lum);
`;

function neonMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide });
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = U.night;
    s.uniforms.uTime = U.time;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aFac; varying vec4 vSign;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSign = aFac;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG)
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + MAIN)
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += sc * lum * (0.25 + 3.2 * uNight);");
  };
  m.customProgramCacheKey = () => "neon1";
  return m;
}

// Box face with sign coordinates in meters: u along the face, v up.
function face(g: Geo, a: number[], b: number[], h: number, kind: number, hueV: number, w: number) {
  const up = (V: number[]) => [V[0], V[1] + h, V[2]];
  g.fac = [0, 0, hueV, kind];
  g.quad(a, b, up(b), up(a), [0, 0, w, 0, w, kind === 2 ? 1 : h, 0, kind === 2 ? 1 : h]);
}

export function buildNeon(map: MapData, track: Track, roads: RoadIndex, detail: number) {
  const g = new Geo();
  const r = rng(808);
  const B = map.buildings;
  const hues = [0.0, 0.08, 0.13, 0.33, 0.5, 0.58, 0.83, 0.92, 0.95];
  let i = 0;
  const limit = detail >= 2 ? 1 : 0.6;
  const near = trackNear(track);
  let boards = 0;
  while (i < B.length) {
    const n = B[i], h = B[i + 1], o = i + 2;
    i = o + n * 2;
    if (n < 3 || h < 9) continue;
    const raw: number[] = [];
    for (let k = 0; k < n; k++) raw.push(B[o + k * 2], B[o + k * 2 + 1]);
    const pts = clockwise(raw);
    let lo = 1e9, hi = -1e9;
    for (let k = 0; k < n; k++) {
      const y = track.heightAt(pts[k * 2], pts[k * 2 + 1]);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    let roofSign = h < 45 && r() < 0.5;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const ax = pts[k * 2], az = pts[k * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 6) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len, ox = -dz, oz = dx;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const e0 = roads.edge(mx, mz);
      if (e0 > 140 || e0 < 1.5 || roads.edge(mx + ox * 6, mz + oz * 6) >= e0 || r() > limit) continue;
      const hv = hues[Math.floor(r() * hues.length)] + r() * 0.03;
      if (r() < 0.75) {
        const t = 0.15 + r() * 0.7, px = ax + dx * len * t, pz = az + dz * len * t;
        const y0 = lo + 4.5, top = Math.min(lo + h - 1, y0 + 8 + r() * 16), H = top - y0;
        if (H > 4) {
          const out = 1.6, th = 0.18;
          const A = [px - dx * th, y0, pz - dz * th], Bp = [px - dx * th + ox * out, y0, pz - dz * th + oz * out];
          const C = [px + dx * th + ox * out, y0, pz + dz * th + oz * out], D = [px + dx * th, y0, pz + dz * th];
          face(g, A, Bp, H, 0, hv, out);
          face(g, C, D, H, 0, hv + 0.02, out);
          face(g, Bp, C, H, 3, 0, th * 2);
          g.fac = [0, 0, 0, 3];
          g.quad([A[0], top, A[2]], [Bp[0], top, Bp[2]], [C[0], top, C[2]], [D[0], top, D[2]]);
        }
      }
      if (h > 22 && r() < 0.45) {
        const w = Math.min(len * 0.7, 6 + r() * 10), hh = Math.min(h * 0.4, 4 + r() * 7), t = 0.5 + (r() - 0.5) * (1 - w / len);
        const cx = ax + dx * len * t + ox * 0.25, cz = az + dz * len * t + oz * 0.25, y0 = lo + Math.max(7, Math.min(h - hh - 3, 8 + r() * (h * 0.5)));
        const A = [cx - dx * w / 2, y0, cz - dz * w / 2], Bp = [cx + dx * w / 2, y0, cz + dz * w / 2];
        face(g, A, Bp, hh, 1, hv, w);
        g.fac = [0, 0, 0, 3];
        const A2 = [A[0] - ox * 0.25, y0, A[2] - oz * 0.25], B2 = [Bp[0] - ox * 0.25, y0, Bp[2] - oz * 0.25];
        face(g, A2, A, hh, 3, 0, 0.25);
        face(g, Bp, B2, hh, 3, 0, 0.25);
      }
      if (r() < 0.6) {
        const A = [ax + ox * 0.35, lo + 3.3, az + oz * 0.35], Bp = [bx + ox * 0.35, lo + 3.3, bz + oz * 0.35];
        face(g, A, Bp, 0.9, 2, hv + 0.4, len);
      }
      const tk = near(mx + ox * 2, mz + oz * 2);
      if (tk.d < 75 && len > 9 && (tk.x - mx) * ox + (tk.z - mz) * oz > tk.d * 0.4 && r() < 0.55 && boards < (detail >= 2 ? 500 : 200)) {
        boards++;
        const w = Math.min(len * 0.8, 8 + r() * 10), hh = 4 + r() * 5, t = 0.5 + (r() - 0.5) * (1 - w / len);
        const y0 = Math.max(lo + 6, tk.y + 4.5 + r() * 8), roofTop = lo + h;
        const cx = ax + dx * len * t + ox * 0.3, cz = az + dz * len * t + oz * 0.3;
        const A = [cx - (dx * w) / 2, y0, cz - (dz * w) / 2], Bp = [cx + (dx * w) / 2, y0, cz + (dz * w) / 2];
        face(g, A, Bp, hh, r() < 0.5 ? 1 : 4, hv, w);
        if (y0 + hh > roofTop) {
          face(g, Bp, A, hh, 3, 0, w);
          g.fac = [0, 0, 0, 3];
          for (const q of [0.12, 0.88]) g.box(cx + dx * w * (q - 0.5) - ox * 0.3, roofTop, cz + dz * w * (q - 0.5) - oz * 0.3, 0.25, y0 - roofTop + 0.2, 0.25);
        }
        continue;
      }
      if (roofSign && len > 8 && e0 < 90) {
        roofSign = false;
        const w = Math.min(len * 0.85, 9 + r() * 7), t = 0.5, y0 = hi + h + 1.2, hh = 4 + r() * 2.5;
        const cx = ax + dx * len * t - ox * 1.5, cz = az + dz * len * t - oz * 1.5;
        const A = [cx - (dx * w) / 2, y0, cz - (dz * w) / 2], Bp = [cx + (dx * w) / 2, y0, cz + (dz * w) / 2];
        face(g, A, Bp, hh, 4, hv, w);
        face(g, Bp, A, hh, 3, 0, w);
        g.fac = [0, 0, 0, 3];
        for (const q of [0.15, 0.5, 0.85]) {
          const px = cx + dx * w * (q - 0.5), pz = cz + dz * w * (q - 0.5);
          g.box(px - ox * 0.8, y0 - 1.3, pz - oz * 0.8, 0.2, hh + 1.3, 0.2);
          g.box(px - ox * 0.4, y0 - 1.3, pz - oz * 0.4, 0.15, 1.3, 1.6, Math.atan2(-dz, dx));
        }
      }
    }
  }
  if (!g.count) return null;
  const mesh = new THREE.Mesh(g.build(), neonMaterial());
  mesh.name = "neon";
  return mesh;
}

// Nearest centerline sample within 120 m: distance, deck height and the point, from a 40 m hash grid.
function trackNear(track: Track) {
  const C = 40, P = track.map.center, cells = new Map<number, number[]>();
  const key = (i: number, j: number) => i * 65536 + j;
  for (let k = 0; k < P.length; k += 6) {
    const kk = key(Math.floor(P[k] / C), Math.floor(P[k + 2] / C));
    let a = cells.get(kk);
    if (!a) cells.set(kk, (a = []));
    a.push(P[k], P[k + 1], P[k + 2]);
  }
  const out = { d: 1e9, y: 0, x: 0, z: 0 };
  return (x: number, z: number) => {
    out.d = 1e9;
    const ci = Math.floor(x / C), cj = Math.floor(z / C);
    for (let i = ci - 3; i <= ci + 3; i++)
      for (let j = cj - 3; j <= cj + 3; j++) {
        const a = cells.get(key(i, j));
        if (a) for (let k = 0; k < a.length; k += 3) {
          const d = Math.hypot(a[k] - x, a[k + 2] - z);
          if (d < out.d) { out.d = d; out.x = a[k]; out.y = a[k + 1]; out.z = a[k + 2]; }
        }
      }
    return out;
  };
}
