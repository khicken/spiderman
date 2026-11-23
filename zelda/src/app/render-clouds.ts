import * as THREE from "three";
import type { Palette } from "./render-env";

// Painted cloud cards: one instanced draw. Each card is a camera-facing quad on a ring around the camera, at 3 heights,
// drawn right after the sky dome (opaque list, no depth), so terrain and trees cover it. The mesh is a child of the sky
// dome: it inherits the dome's position and scale, so cards live on a unit-ish sphere (radius 0.86).

const RING = 0.86;

const VERT = /* glsl */ `
attribute vec4 aP; // azimuth, elevation (rad), half-size (rad), seed
attribute vec4 aQ; // aspect, drift speed, layer (0 low .. 1 high), cover threshold
uniform float uDrift; uniform vec3 uSunDir;
varying vec2 vUv; varying vec4 vS; varying vec2 vSun; varying float vEl; varying float vThr;
void main() {
  float az = aP.x + uDrift * aQ.y;
  float el = aP.y;
  vec3 dir = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), dir));
  vec3 upv = cross(dir, right);
  float sz = aP.z;
  vec3 wp = dir * ${RING.toFixed(2)} + (right * position.x * aQ.x + upv * position.y) * sz * ${RING.toFixed(2)};
  vUv = position.xy;
  vS = vec4(aP.w, aQ.z, aQ.x, 0.0);
  vSun = vec2(dot(uSunDir, right), dot(uSunDir, upv));
  vEl = el;
  vThr = aQ.w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
  gl_Position.z = gl_Position.w * 0.999;
}`;

const FRAG = /* glsl */ `
uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uFog; uniform vec3 uGlow; uniform vec3 uSunPos;
uniform float uCover; uniform float uDark; uniform float uAlpha; uniform float uDay;
varying vec2 vUv; varying vec4 vS; varying vec2 vSun; varying float vEl; varying float vThr;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// cloud body: a flat-bottomed cumulus mass from a few lobes plus noise erosion
float body(vec2 p, float seed) {
  vec2 q = vec2(p.x, p.y * 1.0);
  float lobes = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float h = hash(vec2(seed * 7.0 + fi, 3.7));
    vec2 c = vec2((fi - 1.5) * 0.36 + (h - 0.5) * 0.18, 0.1 + 0.22 * sin(fi * 1.9 + seed * 6.0) + (h - 0.5) * 0.1);
    float r = 0.42 + 0.2 * hash(vec2(fi, seed * 13.0));
    lobes = max(lobes, 1.0 - length((q - c) / vec2(r * 1.15, r)));
  }
  float base = smoothstep(-0.34, -0.2, p.y);
  float n = noise(p * 4.2 + seed * 31.0) * 0.5 + noise(p * 9.0 - seed * 17.0) * 0.25;
  return (lobes * 0.85 + n * 0.55 - 0.3) * base;
}
void main() {
  float seed = vS.x;
  vec2 p = vUv;
  float d = body(p, seed);
  float a = smoothstep(0.02, 0.34, d) * (1.0 - smoothstep(0.62, 0.95, max(abs(p.x), abs(p.y))));
  if (a < 0.004) discard;
  // light from the sun side: compare density with a nudge toward the sun
  vec2 sd = normalize(vSun + vec2(0.0001, 0.0001));
  float d2 = body(p + sd * 0.1, seed);
  float lit = clamp((d - d2) * 5.5 + 0.55 + (p.y * 0.35) + uSunPos.y * 0.15, 0.0, 1.0);
  lit = lit * (1.0 - uDark * 0.8);
  vec3 col = mix(mix(uShade, uLit, 0.4), uLit, smoothstep(0.15, 0.7, lit));
  // silver edge toward the sun and warm underlight at golden hour
  float facing = clamp(dot(sd, normalize(p + 0.001)), 0.0, 1.0);
  float edge = (1.0 - smoothstep(0.0, 0.3, d)) * smoothstep(0.0, 1.0, length(vSun));
  col += uGlow * edge * facing * 0.45;
  // storm clouds go heavy and slate
  col = mix(col, vec3(0.34, 0.37, 0.4) * (0.4 + 0.6 * uDay), uDark * 0.75);
  // aerial perspective: low cards melt into the horizon
  float farF = 1.0 - smoothstep(0.02, 0.32, vEl);
  col = mix(col, uFog, farF * 0.7);
  float alpha = a * uAlpha * smoothstep(0.0, 0.1, vEl + 0.02) * (1.0 - farF * 0.35);
  alpha *= smoothstep(vThr, vThr + 0.18, uCover + 0.18);
  gl_FragColor = vec4(col * alpha, alpha);
}`;

export interface Clouds {
  readonly mesh: THREE.Mesh;
  setLow(low: boolean): void;
  update(pal: Palette, sunDir: THREE.Vector3, fog: THREE.Color, daylight: number, rain: number, drift: THREE.Vector2): void;
  dispose(): void;
}

function mulberry(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createClouds(): Clouds {
  const MAX = 20;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const A = new Float32Array(MAX * 4), B = new Float32Array(MAX * 4);
  const rnd = mulberry(90210);
  // three layers: big flat horizon banks, mid cumulus, a few high small cards. Azimuths are spread, never clustered
  const layers = [
    { n: 8, el: [0.05, 0.16], sz: [0.2, 0.3], asp: [2.2, 3], layer: 0 },
    { n: 8, el: [0.2, 0.5], sz: [0.15, 0.22], asp: [1.7, 2.3], layer: 0.5 },
    { n: 4, el: [0.6, 0.95], sz: [0.12, 0.17], asp: [1.5, 2], layer: 1 },
  ];
  let k = 0;
  for (const L of layers) {
    for (let i = 0; i < L.n && k < MAX; i++, k++) {
      const az = ((i + rnd() * 0.7) / L.n) * Math.PI * 2 + L.layer;
      A[k * 4] = az;
      A[k * 4 + 1] = L.el[0] + rnd() * (L.el[1] - L.el[0]);
      A[k * 4 + 2] = L.sz[0] + rnd() * (L.sz[1] - L.sz[0]);
      A[k * 4 + 3] = rnd();
      B[k * 4] = L.asp[0] + rnd() * (L.asp[1] - L.asp[0]);
      B[k * 4 + 1] = 0.6 + L.layer * 0.8 + rnd() * 0.3;
      B[k * 4 + 2] = L.layer;
      B[k * 4 + 3] = rnd() * 0.75; // cover threshold: cards appear one by one as cover rises
    }
  }
  geo.setAttribute("aP", new THREE.InstancedBufferAttribute(A, 4));
  geo.setAttribute("aQ", new THREE.InstancedBufferAttribute(B, 4));
  geo.instanceCount = MAX;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uDrift: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uLit: { value: new THREE.Color() },
      uShade: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
      uSunPos: { value: new THREE.Vector3(0, 1, 0) }, uCover: { value: 0.3 }, uDark: { value: 0 }, uAlpha: { value: 0.95 }, uDay: { value: 1 },
    },
    transparent: false, // stays in the opaque list so it draws right after the sky; blending below still applies
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -999;
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldAutoUpdate = false;
  let low = false;
  return {
    mesh,
    setLow(l) {
      low = l;
      geo.instanceCount = l ? 12 : MAX;
    },
    update(pal, sunDir, fog, daylight, rain, drift) {
      const U = mat.uniforms;
      // aQ.y scales uDrift per cloud, so a 2π wrap makes every cloud jump; this period is weeks of play and still float-safe
      U.uDrift.value = (drift.x * 0.0009 + drift.y * 0.0006) % 4096;
      U.uSunDir.value.copy(sunDir);
      U.uSunPos.value.copy(pal.sunPos);
      U.uLit.value.copy(pal.cLit);
      U.uShade.value.copy(pal.cShade);
      U.uFog.value.copy(fog);
      U.uGlow.value.copy(pal.glow);
      U.uCover.value = Math.min(1, pal.cloud + rain * 0.6);
      U.uDark.value = Math.min(1, rain * 1.2);
      U.uDay.value = daylight;
      U.uAlpha.value = low ? 0.92 : 0.95;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
