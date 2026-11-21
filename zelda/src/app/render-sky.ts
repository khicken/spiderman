import * as THREE from "three";
import type { SharedUniforms } from "./contracts";
import type { Palette } from "./render-env";

// Painterly sky dome: watercolor gradient, drifting cloud bands, sun with a soft halo, a phased moon, twinkling stars.
// Its horizon color is the fog color, so distant terrain melts into it.

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const FRAG = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uFogColor; uniform vec3 uGlow; uniform vec3 uCLit; uniform vec3 uCShade;
uniform vec3 uSunPos; uniform vec3 uMoonPos; uniform vec3 uSunDir; uniform float uStars; uniform float uCloud; uniform vec2 uDrift;
uniform float uTime; uniform float uFlash; uniform float uDay;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < HM_OCT; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float e = d.y;
  // gradient with a faint posterized wash so it reads as layered pigment
  float t = pow(clamp(e, 0.0, 1.0), 0.5);
  float tq = mix(t, floor(t * 7.0 + 0.5) / 7.0, 0.18);
  vec3 col = mix(uHor, uTop, tq);
  col = mix(col, uFogColor, smoothstep(0.03, -0.04, e));
  // sun halo and disc
  float s = max(dot(d, uSunPos), 0.0);
  col += uGlow * (pow(s, 6.0) * 0.32 + pow(s, 48.0) * 0.45) * smoothstep(-0.25, 0.05, uSunPos.y);
  float sunDisc = smoothstep(0.99915, 0.99945, s);
  // moon disc with a phase shadow
  float m = dot(d, uMoonPos);
  float moonDisc = smoothstep(0.99955, 0.99972, m);
  vec3 side = normalize(cross(uMoonPos, vec3(0.0, 1.0, 0.0)) + vec3(0.0, 0.001, 0.0));
  float phase = smoothstep(0.99955, 0.99972, dot(d, normalize(uMoonPos + side * 0.012)));
  float night = 1.0 - uDay;
  col += vec3(0.55, 0.7, 0.72) * pow(max(m, 0.0), 64.0) * 0.25 * night;
  // stars
  if (uStars > 0.01 && e > 0.0) {
    vec3 p = d * 150.0;
    vec3 c = floor(p);
    float h = hash3(c);
    vec3 off = vec3(hash3(c + 3.1), hash3(c + 7.7), hash3(c + 1.9)) * 0.6 + 0.2;
    float star = step(0.965, h) * smoothstep(0.16, 0.0, length(fract(p) - off));
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
    col += vec3(0.95, 0.92, 0.8) * star * tw * uStars * smoothstep(0.0, 0.25, e) * 1.4;
  }
  // clouds: two band layers on a plane, stretched along the drift, shaded lit-top / shadowed-under
  float cov = 0.0;
  if (e > -0.02) {
    vec2 uv = d.xz / (e + 0.16);
    vec2 bandDir = normalize(uDrift + vec2(0.001, 0.0));
    mat2 rot = mat2(bandDir.x, -bandDir.y, bandDir.y, bandDir.x);
    vec2 q = rot * uv;
    q.y *= 2.6;
    vec2 dr = rot * uDrift;
    vec2 q1 = q * 0.55 - dr * 0.012;
    float n = fbm(q1);
    float thr = 1.0 - uCloud * 0.62 - 0.18;
    float c1 = smoothstep(thr, thr + 0.12, n);
    float lit = clamp((n - fbm(q1 + uSunDir.xz * 0.18)) * 5.0 + 0.55 + uSunDir.y * 0.2, 0.0, 1.0);
    vec3 cc = mix(uCShade, uCLit, smoothstep(0.35, 0.6, lit));
    // pigment pooling at the cloud edge
    float edge = c1 * (1.0 - smoothstep(thr + 0.02, thr + 0.16, n));
    cc *= 1.0 - edge * 0.12;
    cc += uGlow * pow(s, 4.0) * 0.35 * (1.0 - lit);
#ifndef HM_SKY_LOW
    vec2 q2 = q * vec2(0.22, 0.9) - dr * 0.02 + 40.0;
    float n2 = fbm(q2);
    float c2 = smoothstep(0.58 - uCloud * 0.3, 0.75 - uCloud * 0.3, n2) * 0.55;
    col = mix(col, mix(uCLit, uHor, 0.35), c2 * smoothstep(0.0, 0.2, e));
#endif
    float fadeH = smoothstep(-0.02, 0.18, e);
    cov = c1 * fadeH;
    col = mix(col, mix(uFogColor, cc, 0.35 + 0.65 * smoothstep(0.0, 0.3, e)), cov * 0.95);
  }
  col += vec3(2.6, 2.3, 1.9) * sunDisc * (1.0 - cov) * step(-0.02, uSunPos.y);
  col = mix(col, vec3(0.92, 0.94, 0.86) * mix(0.55, 1.0, phase), moonDisc * (1.0 - phase * 0.85) * (1.0 - cov * 0.8) * night);
  col = mix(col, vec3(0.8, 0.85, 0.95) * 1.4, uFlash * (0.4 + 0.6 * smoothstep(-0.05, 0.4, e)));
  gl_FragColor = vec4(col, 1.0);
}`;

export interface Sky {
  readonly mesh: THREE.Mesh;
  setLow(low: boolean): void;
  update(cam: THREE.PerspectiveCamera, pal: Palette, u: SharedUniforms, daylight: number, time: number, wind: THREE.Vector2, dt: number): void;
  dispose(): void;
}

export function createSky(): Sky {
  const geo = new THREE.SphereGeometry(1, 32, 16);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uFogColor: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() }, uCLit: { value: new THREE.Color() }, uCShade: { value: new THREE.Color() },
      uSunPos: { value: new THREE.Vector3() }, uMoonPos: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3() },
      uStars: { value: 0 }, uCloud: { value: 0.3 }, uDrift: { value: new THREE.Vector2() }, uTime: { value: 0 },
      uFlash: { value: 0 }, uDay: { value: 1 },
    },
    defines: { HM_OCT: 4 },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.matrixAutoUpdate = false;
  const drift = new THREE.Vector2();
  return {
    mesh,
    setLow(low) {
      mat.defines = low ? { HM_OCT: 3, HM_SKY_LOW: 1 } : { HM_OCT: 4 };
      mat.needsUpdate = true;
    },
    update(cam, pal, u, daylight, time, wind, dt) {
      const r = cam.far * 0.9;
      mesh.matrix.makeScale(r, r, r).setPosition(cam.position);
      mesh.matrixWorld.copy(mesh.matrix);
      const U = mat.uniforms;
      U.uTop.value.copy(pal.top);
      U.uHor.value.copy(pal.hor);
      U.uFogColor.value.copy(u.uFogColor.value);
      U.uGlow.value.copy(pal.glow);
      U.uCLit.value.copy(pal.cLit);
      U.uCShade.value.copy(pal.cShade);
      U.uSunPos.value.copy(pal.sunPos);
      U.uMoonPos.value.copy(pal.moonPos);
      U.uSunDir.value.copy(u.uSunDir.value);
      U.uStars.value = pal.stars;
      U.uCloud.value = pal.cloud;
      drift.addScaledVector(wind, dt * 0.6);
      U.uDrift.value.copy(drift);
      U.uTime.value = time;
      U.uFlash.value = pal.flash;
      U.uDay.value = daylight;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
