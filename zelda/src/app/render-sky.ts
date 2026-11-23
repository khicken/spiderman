import * as THREE from "three";
import type { SharedUniforms } from "./contracts";
import type { Palette } from "./render-env";
import { createClouds } from "./render-clouds";
import { createShafts } from "./render-shafts";

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
uniform float uTime; uniform float uFlash; uniform float uDay; uniform float uRainbow;
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
  vec3 col = mix(uHor, uTop, smoothstep(0.0, 1.0, t));
  // painted wash: a very faint low-frequency tonal drift, never stepped
  col *= 1.0 + (noise(d.xz * 5.0 / (e + 0.4) + 3.0) - 0.5) * 0.035 * smoothstep(0.0, 0.3, e);
  col = mix(col, uFogColor, (1.0 - smoothstep(-0.04, 0.03, e)));
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
    float star = step(0.965, h) * (1.0 - smoothstep(0.0, 0.16, length(fract(p) - off)));
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
    col += vec3(0.95, 0.92, 0.8) * star * tw * uStars * smoothstep(0.0, 0.25, e) * 1.4;
  }
  // Painted cloud cards (render-clouds, child mesh) carry the main clouds. This layer is only a high thin veil, so
  // the sky still has weather if the cards are off. No radial stretch: the plane is far above the camera.
  float cov = 0.0;
  if (e > 0.0) {
    vec2 uv = d.xz / (e + 0.55);
    vec2 q = uv * vec2(0.9, 1.5) - uDrift * 0.004;
    float n = fbm(q + 11.0);
    float veil = smoothstep(0.52 - uCloud * 0.2, 0.9, n) * (0.16 + 0.3 * uCloud) * smoothstep(0.08, 0.4, e);
    col = mix(col, mix(uCLit, uHor, 0.3) + uGlow * pow(s, 3.0) * 0.18, veil);
    cov = veil;
  }
  // rainbow: opposite the sun, only while the sun is low and the air has just cleared
  if (uRainbow > 0.01) {
    float ang = acos(clamp(dot(d, -uSunPos), -1.0, 1.0));
    float rb = (ang - 0.715) / 0.045;
    float band = (1.0 - smoothstep(0.0, 1.0, abs(rb)));
    vec3 hue = clamp(abs(mod(rb * 0.5 + 0.5 + vec3(0.0, 0.667, 0.333) * 1.0, 1.0) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
    hue = mix(vec3(1.0), hue, 0.8);
    col += hue * band * band * uRainbow * 0.22 * smoothstep(0.0, 0.12, e);
  }
  col += vec3(2.6, 2.3, 1.9) * sunDisc * (1.0 - cov) * step(-0.02, uSunPos.y);
  vec3 up2 = cross(uMoonPos, side);
  vec2 mq = vec2(dot(d, side), dot(d, up2)) / 0.0268;
  vec3 moonCol = vec3(0.92, 0.94, 0.86) * (0.8 + 0.2 * noise(mq * 2.6 + 5.0)) * (0.9 + 0.1 * smoothstep(0.2, 0.9, fbm(mq * 1.7 + 2.0)));
  col = mix(col, moonCol * mix(0.55, 1.0, phase), moonDisc * (1.0 - phase * 0.85) * (1.0 - cov * 0.8) * night);
  col = mix(col, vec3(0.8, 0.85, 0.95) * 1.4, uFlash * (0.4 + 0.6 * smoothstep(-0.05, 0.4, e)));
  // triangular dither, about 1.5/255: kills 8-bit banding in the gradient
  float dn = hash(gl_FragCoord.xy + fract(uTime) * 61.0) + hash(gl_FragCoord.yx * 1.7 + 9.0) - 1.0;
  col += dn * (1.5 / 255.0);
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
      uFlash: { value: 0 }, uDay: { value: 1 }, uRainbow: { value: 0 },
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
  // Clouds and shafts hang off the dome so render.ts needs no new wiring: the dome's world matrix is theirs too.
  const clouds = createClouds();
  const shafts = createShafts();
  mesh.add(clouds.mesh, shafts.mesh);
  let prevRain = 0, rainbow = 0, rainbowOn = 0;
  return {
    mesh,
    setLow(low) {
      mat.defines = low ? { HM_OCT: 3, HM_SKY_LOW: 1 } : { HM_OCT: 4 };
      mat.needsUpdate = true;
      clouds.setLow(low);
      shafts.setLow(low);
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
      const rain = u.uRain.value;
      // a rainbow rises when rain clears in daylight with a low sun, holds about 80 s, then fades
      if (prevRain > 0.35 && rain < prevRain - 0.002 && rain < 0.35 && daylight > 0.5 && pal.sunPos.y < 0.7 && pal.sunPos.y > 0.08) rainbowOn = 80;
      prevRain = Math.max(rain, prevRain - dt * 0.05);
      rainbowOn = Math.max(0, rainbowOn - dt);
      rainbow += ((rainbowOn > 0 && rain < 0.15 ? 1 : 0) - rainbow) * Math.min(1, dt * 0.5);
      U.uRainbow.value = rainbow;
      clouds.mesh.matrixWorld.copy(mesh.matrixWorld);
      clouds.update(pal, pal.sunPos, u.uFogColor.value, daylight, rain, drift);
      shafts.update(cam.position, pal, u.uSunDir.value, daylight, rain, time, u.uFogFar.value);
    },
    dispose() {
      clouds.dispose();
      shafts.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}
