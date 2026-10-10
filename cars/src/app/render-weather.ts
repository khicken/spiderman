import * as THREE from "three";
import type { Weather } from "./contracts";
import { LAYER, LIGHT } from "./render-shared";

const MAX = 9000;
const BOX = new THREE.Vector3(44, 26, 44);

const RAIN_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCam; uniform vec3 uFall; uniform vec3 uCamVel; uniform vec3 uBox; uniform float uTime;
varying float vA; varying float vX;
void main() {
  vec3 p = aSeed.xyz * uBox + uFall * uTime * (0.85 + 0.3 * aSeed.w);
  p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
  vec3 rel = uFall * (0.85 + 0.3 * aSeed.w) - uCamVel;
  float sp = length(rel);
  vec3 dir = rel / max(sp, 1e-3);
  float len = clamp(sp * 0.022, 0.25, 2.6);
  vec3 view = normalize(p - cameraPosition);
  vec3 side = normalize(cross(dir, view));
  float dist = length(p - cameraPosition);
  float w = 0.01 + dist * 0.0016;
  vec3 wp = p + dir * position.y * len + side * position.x * w;
  vX = position.x;
  vA = smoothstep(1.2, 3.0, dist) * smoothstep(uBox.x * 0.5, uBox.x * 0.3, dist) * (0.5 + 0.5 * aSeed.w) * (1.0 - abs(position.y) * 1.6);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha;
varying float vA; varying float vX;
void main() {
  float a = (1.0 - abs(vX) * 2.0) * vA * uAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}`;

const SPLASH_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uFocus; uniform float uGround; uniform float uTime;
varying vec2 vP; varying float vPh;
float h1(float n) { return fract(sin(n * 91.7) * 43758.5); }
void main() {
  float rate = 1.6 + aSeed.w * 1.4;
  float c = uTime * rate + aSeed.z * 10.0;
  float cyc = floor(c);
  vPh = fract(c);
  float a = h1(cyc + aSeed.x * 77.0) * 6.2831;
  float r = 2.0 + sqrt(h1(cyc * 1.3 + aSeed.y * 51.0)) * 16.0;
  vec3 center = vec3(uFocus.x + cos(a) * r, uGround + 0.03, uFocus.z + sin(a) * r);
  float s = 0.02 + vPh * 0.09;
  vP = position.xy * 2.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(center + vec3(position.x, 0.0, position.y) * s * 2.0, 1.0);
}`;
const SPLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vP; varying float vPh;
void main() {
  float d = length(vP);
  float ring = smoothstep(0.3, 0.0, abs(d - 0.7)) * (1.0 - vPh) * (1.0 - vPh);
  if (ring < 0.01) discard;
  gl_FragColor = vec4(uColor, ring * 0.3);
}`;

const SNOW_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCam; uniform vec3 uBox; uniform float uTime; uniform float uScale; uniform vec3 uCamVel;
varying float vA;
void main() {
  vec3 p = aSeed.xyz * uBox;
  float s = aSeed.w;
  p.y -= uTime * (1.0 + s * 0.9);
  p.x += sin(uTime * 0.7 + s * 6.28) * 0.9 + uTime * 0.6;
  p.z += cos(uTime * 0.5 + s * 4.0) * 0.7;
  p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float z = -mv.z;
  gl_PointSize = clamp((0.04 + 0.03 * s) * uScale / z, 1.0, 12.0);
  vA = smoothstep(uBox.x * 0.5, uBox.x * 0.25, z) * smoothstep(0.6, 2.0, z);
  gl_Position = projectionMatrix * mv;
}`;
const SNOW_FRAG = /* glsl */ `
uniform vec3 uColor; varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, d) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a * 0.9);
}`;

function seeds(n: number) {
  const a = new Float32Array(n * 4);
  for (let i = 0; i < a.length; i++) a[i] = Math.random();
  return new THREE.InstancedBufferAttribute(a, 4);
}

function instanced(base: THREE.BufferGeometry, n: number) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.getAttribute("position"));
  g.setAttribute("aSeed", seeds(n));
  g.instanceCount = 0;
  return g;
}

export function createWeather() {
  const quad = new THREE.PlaneGeometry(1, 1);
  const shared = {
    uCam: { value: new THREE.Vector3() },
    uCamVel: { value: new THREE.Vector3() },
    uBox: { value: BOX },
    uTime: { value: 0 },
  };
  const rainColor = { value: new THREE.Color() };
  const rainMat = new THREE.ShaderMaterial({
    vertexShader: RAIN_VERT,
    fragmentShader: RAIN_FRAG,
    uniforms: { ...shared, uFall: { value: new THREE.Vector3(1.5, -11, 0.8) }, uColor: rainColor, uAlpha: { value: 0.5 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const rain = new THREE.Mesh(instanced(quad, MAX), rainMat);
  const splashMat = new THREE.ShaderMaterial({
    vertexShader: SPLASH_VERT,
    fragmentShader: SPLASH_FRAG,
    uniforms: { uFocus: { value: new THREE.Vector3() }, uGround: { value: 0 }, uTime: shared.uTime, uColor: rainColor },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const splash = new THREE.Mesh(instanced(quad, MAX / 4), splashMat);
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
  snowGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds(MAX).array, 4));
  const snowColor = { value: new THREE.Color() };
  const snowMat = new THREE.ShaderMaterial({
    vertexShader: SNOW_VERT,
    fragmentShader: SNOW_FRAG,
    uniforms: { ...shared, uScale: { value: 900 }, uColor: snowColor },
    transparent: true,
    depthWrite: false,
  });
  const snow = new THREE.Points(snowGeo, snowMat);
  const meshes = [rain, splash, snow];
  for (const m of meshes) {
    m.frustumCulled = false;
    m.layers.set(LAYER.fx);
    m.renderOrder = 10;
  }
  let kind: Weather = "clear";
  let budget = 300;
  const lastCam = new THREE.Vector3();
  const tmp = new THREE.Color();
  let first = true;

  const apply = () => {
    const n = Math.min(MAX, Math.round(budget * 1.5));
    rain.visible = splash.visible = kind === "rain";
    snow.visible = kind === "snow";
    (rain.geometry as THREE.InstancedBufferGeometry).instanceCount = n;
    (splash.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.round(n / 6);
    snowGeo.setDrawRange(0, n);
  };

  return {
    meshes,
    set(w: Weather, particles: number) {
      kind = w;
      budget = particles;
      apply();
    },
    update(dt: number, t: number, camera: THREE.Camera, focus: THREE.Vector3, height: number) {
      if (!rain.visible && !snow.visible) return;
      shared.uTime.value = t % 600;
      shared.uCam.value.copy(camera.position);
      if (first) lastCam.copy(camera.position);
      first = false;
      if (dt > 0) shared.uCamVel.value.subVectors(camera.position, lastCam).divideScalar(dt).clampLength(0, 120);
      lastCam.copy(camera.position);
      splashMat.uniforms.uFocus.value.copy(focus);
      splashMat.uniforms.uGround.value = focus.y - 0.5;
      const amb = LIGHT.ambient.value, sun = LIGHT.sunColor.value;
      rainColor.value.copy(amb).multiplyScalar(5).add(tmp.copy(sun).multiplyScalar(0.08));
      snowColor.value.copy(amb).multiplyScalar(2.6).add(tmp.copy(sun).multiplyScalar(0.25));
      snowMat.uniforms.uScale.value = height;
    },
    dispose() {
      quad.dispose();
      rain.geometry.dispose();
      splash.geometry.dispose();
      snowGeo.dispose();
      rainMat.dispose();
      splashMat.dispose();
      snowMat.dispose();
    },
  };
}
export type WeatherFx = ReturnType<typeof createWeather>;
