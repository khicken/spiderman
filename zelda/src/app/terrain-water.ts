import * as THREE from "three";
import { LAKE } from "./contracts";
import { RILL, riverInfo } from "./world-gen";
import type { WorldData } from "./world-gen";

// Water geometry: one sea disc that follows the camera, and one static mesh for the lake and the river ribbon.
// aFlow = (flow x, whitewater, flow z) in m/s. Owner: terrain.

export function makeSeaGeometry(radius: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(radius, 72).rotateX(-Math.PI / 2);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g.setAttribute("aFlow", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
  return g;
}

export function makeInlandWaterGeometry(data: WorldData): THREE.BufferGeometry {
  const pos: number[] = [];
  const flow: number[] = [];
  const idx: number[] = [];

  // lake disc: rings x segments
  const SEG = 64, RINGS = 6, R = LAKE.r + 12;
  pos.push(LAKE.x, LAKE.level, LAKE.z);
  flow.push(0, 0, 0);
  for (let r = 1; r <= RINGS; r++) {
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      const rr = (r / RINGS) * R;
      pos.push(LAKE.x + Math.cos(a) * rr, LAKE.level, LAKE.z + Math.sin(a) * rr);
      flow.push(0, 0, 0);
    }
  }
  for (let s = 0; s < SEG; s++) idx.push(0, 1 + ((s + 1) % SEG), 1 + s);
  for (let r = 1; r < RINGS; r++) {
    const a0 = 1 + (r - 1) * SEG, a1 = 1 + r * SEG;
    for (let s = 0; s < SEG; s++) {
      const s1 = (s + 1) % SEG;
      idx.push(a0 + s, a0 + s1, a1 + s);
      idx.push(a0 + s1, a1 + s1, a1 + s);
    }
  }

  // river ribbon
  const rv = data.river;
  const ri = riverInfo(data.riverKnots);
  const start = pos.length / 3;
  let rows = 0;
  for (let i = 0; i < rv.n; i++) {
    const s = rv.s[i];
    const S = ri.surf(s);
    if (S < 0.1 && i > 0) break;
    const i0 = Math.max(0, i - 1), i1 = Math.min(rv.n - 1, i + 1);
    let tx = rv.x[i1] - rv.x[i0], tz = rv.z[i1] - rv.z[i0];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const hw = ri.width(s) * 0.5 + 2.4;
    const ds = Math.max(1, rv.s[i1] - rv.s[i0]);
    const slope = Math.max(0, (ri.surf(rv.s[i0]) - ri.surf(rv.s[i1])) / ds);
    const speed = 0.9 + Math.min(4, slope * 9);
    const white = Math.min(1, Math.max(0, (slope - 0.06) * 2.5));
    for (let k = -1; k <= 1; k++) {
      pos.push(rv.x[i] - tz * hw * k, S, rv.z[i] + tx * hw * k);
      flow.push(tx * speed, white, tz * speed);
    }
    rows++;
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let k = 0; k < 2; k++) {
      const a = start + r * 3 + k, b = a + 1, c = a + 3, d = a + 4;
      idx.push(a, c, b, b, c, d);
    }
  }

  // prologue ford: a shallow ribbon at RILL.surf. The shader fades it by depth over the carved bed, so the edge is soft.
  {
    const rs = pos.length / 3;
    const x0 = RILL.x0 - RILL.fade * 0.6, x1 = RILL.x1 + RILL.fade * 0.6, RN = 14, hw = RILL.half + 2.2;
    for (let i = 0; i <= RN; i++) {
      const x = x0 + ((x1 - x0) * i) / RN;
      for (let k = -1; k <= 1; k++) {
        pos.push(x, RILL.surf, RILL.z + k * hw);
        flow.push(0.7, 0.06, 0);
      }
    }
    for (let i = 0; i < RN; i++) {
      for (let k = 0; k < 2; k++) {
        const a = rs + i * 3 + k, b = a + 1, c = a + 3, d = a + 4;
        idx.push(a, c, b, b, c, d);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aFlow", new THREE.Float32BufferAttribute(flow, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** v2 water fragment shader. Drop-in for `waterFrag` in terrain-shader.ts (same uniforms, same varyings, same WATER_VERT):
 *  terrain.ts only has to import `waterFragV2` from here instead. Adds a sky reflection with a horizon blend, sun glitter,
 *  shallow caustics, rain ripples and a dark-teal underside. */
export const waterFragV2 = (lookGlsl: string) => /* glsl */ `
uniform sampler2D uTHeightLo;
uniform sampler2D uTNoise;
uniform vec3 uWShallow;
uniform vec3 uWDeep;
uniform vec3 uWFoam;
uniform float uFade;
varying vec3 vWorld;
varying vec3 vFlow;

${lookGlsl}

float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 xz = vWorld.xz;
  float th = texture2D(uTHeightLo, (xz + 641.0) / 1282.0).r;
  float depth = vWorld.y - th;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-4);
  float t = uTime;
  vec2 flow = vFlow.xz;
  float speed = length(flow);
  vec3 up = vec3(0.0, 1.0, 0.0);

  if (!gl_FrontFacing) {
    // seen from below: murky teal that brightens toward the surface, no white plane
    vec3 under = mix(uWDeep * 0.55, uWShallow * 0.7, 0.35 + 0.3 * V.y);
    gl_FragColor = vec4(hmFogP(under, vWorld), 0.88);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }

  vec3 n = up;
  float fn = texture2D(uTNoise, xz * 0.045 + vec2(t * 0.011, -t * 0.014)).a;
  vec2 w1 = vec2(0.0), w2 = vec2(0.0);
#if WQ > 0
  w1 = texture2D(uTNoise, xz * 0.043 + vec2(t * 0.021, t * 0.012) - flow * t * 0.05).rg - 0.5;
  w2 = texture2D(uTNoise, xz * 0.071 + vec2(-t * 0.016, t * 0.023) - flow * t * 0.08).gr - 0.5;
  float amp = mix(0.26, 0.06, smoothstep(40.0, 400.0, dist)) * (1.0 + uRain * 1.2);
  vec2 sl = (w1 + w2) * amp;
  float rr = 0.0;
  if (uRain > 0.05 && dist < 70.0) {
    // rain ripples: one expanding ring per grid cell, staggered in time
    vec2 g = xz * 0.9;
    vec2 cell = floor(g);
    for (int i = 0; i < 2; i++) {
      vec2 c = cell + vec2(float(i), 0.0);
      float ph = fract(t * 0.9 + h21(c) * 7.0);
      vec2 ctr = c + vec2(h21(c + 3.1), h21(c + 8.7));
      float d = length(g - ctr);
      float ring = (1.0 - smoothstep(0.0, 0.07, abs(d - ph * 0.55))) * (1.0 - ph) * step(h21(c + 1.7), uRain);
      rr = max(rr, ring);
      sl += normalize(g - ctr + 1e-4) * ring * 0.35;
    }
  }
  n = normalize(vec3(sl.x, 1.0, sl.y));
#else
  float rr = 0.0;
#endif

  float dd = smoothstep(0.0, speed > 0.01 ? 2.8 : 9.0, depth);
  vec3 base = mix(uWShallow, uWDeep, pow(dd, 0.8));
  // caustic webs on the bed where it is shallow
  float cau = 0.0;
#if WQ > 0
  float c1 = texture2D(uTNoise, xz * 0.11 + vec2(t * 0.03, t * 0.02)).g;
  float c2 = texture2D(uTNoise, xz * 0.09 - vec2(t * 0.025, -t * 0.03)).r;
  cau = smoothstep(0.62, 0.9, 1.0 - abs(c1 - c2) * 4.0) * (1.0 - smoothstep(0.4, 2.6, depth)) * 0.22;
#endif
  vec3 col = hmShade(base, up, vWorld, V) + uSunColor * cau;

  // sky reflection: horizon color near the rim, sky color higher up, so the surface picks up the day
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uFogColor, uSkyColor * 1.35, smoothstep(0.0, 0.7, R.y));
  float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 4.0);
  col = mix(col, sky, clamp(fr * 0.85 + 0.12, 0.0, 0.9));

  // sun path glitter
  vec3 Rs = reflect(-uSunDir, n);
  float sp = pow(max(dot(Rs, V), 0.0), 120.0);
  float glint = smoothstep(0.25, 0.4, sp);
#if WQ > 0
  float spark = texture2D(uTNoise, xz * 0.35 + vec2(t * 0.05, -t * 0.04)).b;
  glint = max(glint, pow(max(dot(Rs, V), 0.0), 40.0) * smoothstep(0.7, 0.85, spark) * 1.4);
#endif
  col += uSunColor * glint * 0.9;

  float contact = 1.0 - smoothstep(0.0, 0.05 + fn * 0.14, depth);
  float foam = contact;
#if WQ > 0
  float ring = sin(depth * 4.2 - t * 1.6 + fn * 6.0);
  foam = max(foam, smoothstep(0.9, 0.96, ring) * (1.0 - smoothstep(0.1, 0.6, depth)) * (1.0 - smoothstep(120.0, 260.0, dist)) * 0.7);
  foam = max(foam, rr * 0.6);
#endif
  if (speed > 0.01) {
    vec2 dir = flow / speed;
    vec2 perp = vec2(-dir.y, dir.x);
    float s = texture2D(uTNoise, vec2(dot(xz, perp) * 0.11, dot(xz, dir) * 0.018 - t * speed * 0.03)).a;
    foam = max(foam, smoothstep(0.74, 0.8, s) * 0.8);
  }
  if (vFlow.y > 0.01) {
    float wsx = texture2D(uTNoise, vec2(dot(xz, vec2(-flow.y, flow.x) / max(speed, 0.01)) * 0.25, dot(xz, flow / max(speed, 0.01)) * 0.06 - t * 0.9)).a;
    foam = max(foam, vFlow.y * smoothstep(0.42, 0.62, wsx + fn * 0.3));
    col = mix(col, hmShade(uWFoam, up, vWorld, V), vFlow.y * 0.3);
  }
  col = mix(col, hmShade(uWFoam, up, vWorld, V), foam);

  float a = mix(0.4, 0.93, smoothstep(0.0, 4.0, depth));
  a = max(a, foam);
  a = mix(a, 1.0, fr * 0.5);
  col = hmFogP(col, vWorld);
  col = mix(col, uFogColor, smoothstep(uFade * 0.78, uFade * 0.9, dist));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
