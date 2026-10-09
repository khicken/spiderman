import * as THREE from "three";
import type { Env } from "./contracts";
import { LAYER, noiseTexture, releaseNoise } from "./render-shared";

// Single scattering atmosphere. The GLSL and the CPU copy must stay in sync: the CPU copy colors fog, light and ambient.
const RE = 6360e3;
const RA = 6420e3;
const HR = 8000;
const HM = 1200;
const BR = [5.802e-6, 13.558e-6, 33.1e-6];
const G = 0.78;
export const SUN_I = 20;
// Sky radiance scale so a noon sky averages about 0.2, next to a 3.2 sun light.
export const SKY_K = 0.2;

const ATMO_GLSL = /* glsl */ `
const float RE = ${RE.toFixed(1)}, RA = ${RA.toFixed(1)}, HR = ${HR.toFixed(1)}, HM = ${HM.toFixed(1)};
const vec3 BR = vec3(${BR.map((v) => v.toExponential(4)).join(", ")});
uniform float uMie;
vec2 rsph(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd), c = dot(ro, ro) - r * r, d = b * b - c;
  if (d < 0.0) return vec2(-1.0);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}
vec3 atmosphere(vec3 rd, vec3 sun) {
  vec3 ro = vec3(0.0, RE + 300.0, 0.0);
  float tMax = rsph(ro, rd, RA).y;
  vec2 g = rsph(ro, rd, RE);
  if (g.x > 0.0) tMax = g.x;
  float ds = tMax / float(ASTEPS);
  vec3 sR = vec3(0.0), sM = vec3(0.0);
  float oR = 0.0, oM = 0.0;
  float mu = dot(rd, sun);
  float pR = 0.0596831 * (1.0 + mu * mu);
  float pM = 0.1193662 * (1.0 - ${G * G}) * (1.0 + mu * mu) / ((2.0 + ${G * G}) * pow(1.0 + ${G * G} - ${2 * G} * mu, 1.5));
  for (int i = 0; i < ASTEPS; i++) {
    vec3 p = ro + rd * (float(i) + 0.5) * ds;
    float h = length(p) - RE;
    float hr = exp(-h / HR) * ds, hm = exp(-h / HM) * ds;
    oR += hr; oM += hm;
    if (rsph(p, sun, RE).x > 0.0) continue;
    float dl = rsph(p, sun, RA).y / float(LSTEPS);
    float lR = 0.0, lM = 0.0;
    for (int j = 0; j < LSTEPS; j++) {
      float hl = length(p + sun * (float(j) + 0.5) * dl) - RE;
      lR += exp(-hl / HR) * dl; lM += exp(-hl / HM) * dl;
    }
    vec3 att = exp(-(BR * (oR + lR) + uMie * 1.11 * (oM + lM)));
    sR += att * hr; sM += att * hm;
  }
  return ${SUN_I.toFixed(1)} * ${SKY_K} * (sR * BR * pR + sM * uMie * pM);
}`;

export const mieFor = (haze: number) => 3.996e-6 * haze;

function rsph(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, r: number, far: boolean) {
  const b = ox * dx + oy * dy + oz * dz, c = ox * ox + oy * oy + oz * oz - r * r, d = b * b - c;
  if (d < 0) return -1;
  return far ? -b + Math.sqrt(d) : -b - Math.sqrt(d);
}

export function atmosphere(rd: THREE.Vector3, sun: THREE.Vector3, mie: number, out: THREE.Color, steps = 12, lsteps = 4) {
  const oy = RE + 300;
  let tMax = rsph(0, oy, 0, rd.x, rd.y, rd.z, RA, true);
  const g = rsph(0, oy, 0, rd.x, rd.y, rd.z, RE, false);
  if (g > 0) tMax = g;
  const ds = tMax / steps;
  const mu = rd.dot(sun);
  const pR = 0.0596831 * (1 + mu * mu);
  const pM = (0.1193662 * (1 - G * G) * (1 + mu * mu)) / ((2 + G * G) * Math.pow(1 + G * G - 2 * G * mu, 1.5));
  let oR = 0, oM = 0, r = 0, gg = 0, b = 0, m0 = 0, m1 = 0, m2 = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * ds;
    const px = rd.x * t, py = oy + rd.y * t, pz = rd.z * t;
    const h = Math.hypot(px, py, pz) - RE;
    const hr = Math.exp(-h / HR) * ds, hm = Math.exp(-h / HM) * ds;
    oR += hr;
    oM += hm;
    if (rsph(px, py, pz, sun.x, sun.y, sun.z, RE, false) > 0) continue;
    const dl = rsph(px, py, pz, sun.x, sun.y, sun.z, RA, true) / lsteps;
    let lR = 0, lM = 0;
    for (let j = 0; j < lsteps; j++) {
      const s = (j + 0.5) * dl;
      const hl = Math.hypot(px + sun.x * s, py + sun.y * s, pz + sun.z * s) - RE;
      lR += Math.exp(-hl / HR) * dl;
      lM += Math.exp(-hl / HM) * dl;
    }
    const tm = mie * 1.11 * (oM + lM);
    const a0 = Math.exp(-(BR[0] * (oR + lR) + tm)), a1 = Math.exp(-(BR[1] * (oR + lR) + tm)), a2 = Math.exp(-(BR[2] * (oR + lR) + tm));
    r += a0 * hr; gg += a1 * hr; b += a2 * hr;
    m0 += a0 * hm; m1 += a1 * hm; m2 += a2 * hm;
  }
  const k = SUN_I * SKY_K;
  return out.setRGB(k * (r * BR[0] * pR + m0 * mie * pM), k * (gg * BR[1] * pR + m1 * mie * pM), k * (b * BR[2] * pR + m2 * mie * pM));
}

// Sunlight color after the atmosphere, 1 = top of the atmosphere.
export function sunTransmittance(sun: THREE.Vector3, mie: number, out: THREE.Color) {
  const oy = RE + 300;
  const y = Math.max(sun.y, -0.02);
  const len = Math.hypot(sun.x, y, sun.z);
  const dx = sun.x / len, dy = y / len, dz = sun.z / len;
  if (rsph(0, oy, 0, dx, dy, dz, RE, false) > 0) return out.setRGB(0, 0, 0);
  const n = 24;
  const dl = rsph(0, oy, 0, dx, dy, dz, RA, true) / n;
  let oR = 0, oM = 0;
  for (let j = 0; j < n; j++) {
    const s = (j + 0.5) * dl;
    const h = Math.hypot(dx * s, oy + dy * s, dz * s) - RE;
    oR += Math.exp(-h / HR) * dl;
    oM += Math.exp(-h / HM) * dl;
  }
  const tm = mie * 1.11 * oM;
  return out.setRGB(Math.exp(-(BR[0] * oR + tm)), Math.exp(-(BR[1] * oR + tm)), Math.exp(-(BR[2] * oR + tm)));
}

const DEG = Math.PI / 180;
// Sun direction from local solar time. World: +x east, -z north.
export function sunDirection(env: Env, out: THREE.Vector3) {
  const lat = env.lat * DEG;
  const decl = (env.season === "summer" ? 21 : env.season === "winter" ? -21 : -4) * DEG * (env.lat < 0 ? -1 : 1);
  const H = (env.hour - 12) * 15 * DEG;
  const up = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const east = -Math.cos(decl) * Math.sin(H);
  const north = Math.cos(lat) * Math.sin(decl) - Math.sin(lat) * Math.cos(decl) * Math.cos(H);
  return out.set(east, up, -north).normalize();
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position * 50.0 + cameraPosition, 1.0);
  gl_Position.z = gl_Position.w;
}`;

const ATMO_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uSun;
${ATMO_GLSL}
void main() {
  vec3 d = normalize(vDir);
  d.y = max(d.y, -0.04);
  gl_FragColor = vec4(atmosphere(normalize(d), uSun), 1.0);
}`;

const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform samplerCube tAtmo; uniform sampler2D tNoise;
uniform vec3 uSun; uniform vec3 uSunDisc; uniform vec3 uMoon; uniform float uNight;
uniform float uCover; uniform float uDark; uniform vec2 uWind; uniform float uBase;
uniform vec3 uFog; uniform float uFogAmt; uniform vec3 uCloudSun; uniform vec3 uCloudAmb; uniform vec3 uCity; uniform float uFlash; uniform float uTime;
const float THICK = 1300.0;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float density(vec3 p, float h) {
  vec2 uv = (p.xz + uWind) / 24000.0;
  float b = texture2D(tNoise, uv).r * 0.62 + texture2D(tNoise, mat2(0.8, -0.6, 0.6, 0.8) * uv * 2.3 + 0.17).r * 0.38;
  b = mix(b, b * texture2D(tNoise, uv * 1.3 + 0.5).b * 1.5, 0.35);
  float prof = smoothstep(0.0, 0.15, h) * smoothstep(1.0, 0.2 + 0.6 * b, h);
  float d = (b * prof - (1.0 - uCover)) / max(uCover, 0.1);
  d -= (texture2D(tNoise, uv * 8.0 + vec2(h * 0.3, uTime * 0.0003)).g - 0.5) * 0.4 * (1.0 - clamp(d, 0.0, 1.0));
  return clamp(d * 1.5 * (1.0 + uDark), 0.0, 1.0);
}
float hg(float mu, float g) { return 0.0795775 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec4 clouds(vec3 ro, vec3 rd, vec3 atmo) {
  if (rd.y < 0.01 || uCover < 0.02) return vec4(0.0, 0.0, 0.0, 1.0);
  float mu = dot(rd, uSun);
  float phase = mix(hg(mu, 0.6), hg(mu, -0.25), 0.4) * 12.566;
  float t0 = (uBase - ro.y) / rd.y;
  float T = 1.0; vec3 L = vec3(0.0);
#if SLICES < 5
  vec3 p = ro + rd * ((uBase + 0.4 * THICK - ro.y) / rd.y);
  float d = density(p, 0.4);
  if (d > 0.002) {
    float od = 0.0;
    for (int j = 1; j <= LSTEPS; j++) od += density(p + uSun * float(j) * 300.0, 0.4 + 0.2 * float(j) / float(LSTEPS));
    float Tl = exp(-od * 3.0 / float(LSTEPS));
    vec3 S = uCloudSun * Tl * phase * 0.45 + uCloudAmb * 0.75 + uCity * 1.2;
    float a = 1.0 - exp(-d * 4.0 / max(rd.y * 3.0, 0.4));
    L = S * a;
    T = 1.0 - a;
  }
#else
  float len = min((THICK) / rd.y, 2600.0);
  float dt = len / float(SLICES);
  float t = t0 + dt * ign(gl_FragCoord.xy);
  for (int i = 0; i < SLICES; i++) {
    vec3 p = ro + rd * t;
    float h = clamp((p.y - uBase) / THICK, 0.0, 1.0);
    float d = density(p, h);
    if (d > 0.002) {
      float od = 0.0;
      for (int j = 1; j <= LSTEPS; j++) od += density(p + uSun * float(j) * 240.0, clamp(h + uSun.y * float(j) * 240.0 / THICK, 0.0, 1.0));
      float Tl = exp(-od * 5.0 / float(LSTEPS));
      float powder = 1.0 - exp(-d * 3.0);
      vec3 S = uCloudSun * Tl * phase * mix(0.4, 1.0, powder) * 0.45 + uCloudAmb * (0.45 + 0.65 * h) + uCity * (1.0 - h) * 1.5;
      float a = 1.0 - exp(-d * dt * 0.006);
      L += T * a * S;
      T *= 1.0 - a;
      if (T < 0.01) break;
    }
    t += dt;
  }
#endif
  float aer = 1.0 - exp(-t0 / 28000.0);
  L = mix(L, atmo * (1.0 - T), aer);
  float fade = smoothstep(0.01, 0.08, rd.y);
  return vec4(L * fade, mix(1.0, T, fade));
}
void main() {
  vec3 rd = normalize(vDir);
  vec3 col = textureCube(tAtmo, vec3(rd.x, max(rd.y, -0.04), rd.z)).rgb;
  float up = max(rd.y, 0.0);
  if (uNight > 0.0) {
    col += mix(vec3(0.012, 0.017, 0.035), vec3(0.0025, 0.004, 0.011), sqrt(up)) * uNight;
    vec2 sp = vec2(atan(rd.z, rd.x), asin(clamp(rd.y, -1.0, 1.0))) * 160.0;
    vec2 cell = floor(sp);
    float h = hash(cell);
    vec2 off = vec2(hash(cell + 7.1), hash(cell + 3.7)) - 0.5;
    float r = length(fract(sp) - 0.5 - off * 0.6);
    float tw = 0.75 + 0.25 * sin(uTime * (2.0 + 6.0 * h) + h * 50.0);
    float star = step(0.982, h) * smoothstep(0.14, 0.0, r) * (0.4 + 3.0 * pow(fract(h * 37.0), 3.0)) * tw;
    float band = exp(-pow(dot(rd, normalize(vec3(0.3, 0.55, 0.78))) * 3.2, 2.0));
    col += vec3(0.8, 0.88, 1.0) * star * smoothstep(0.0, 0.2, up) * uNight * 0.14;
    col += vec3(0.035, 0.04, 0.06) * band * texture2D(tNoise, sp / 900.0).r * uNight * 0.05;
    float m = dot(rd, uMoon);
    float disc = smoothstep(0.99985, 0.99992, m);
    col += vec3(1.0, 0.96, 0.88) * disc * 3.0 * (0.7 + 0.3 * texture2D(tNoise, rd.xz * 40.0).g) * uNight;
    col += vec3(0.25, 0.32, 0.5) * pow(max(m, 0.0), 600.0) * 0.08 * uNight;
  }
  float sm = dot(rd, uSun);
  float disc = smoothstep(0.99996, 0.99998, sm);
  col += uSunDisc * disc * (0.6 + 0.4 * sqrt(max(0.0, 1.0 - (1.0 - sm) / 0.00004)));
  col += uCity * 0.35 * exp(-up * 9.0);
  vec4 c = clouds(cameraPosition, rd, col);
  col = col * c.a + c.rgb;
  col += vec3(0.7, 0.75, 1.0) * uFlash * (1.0 - c.a * 0.7) * 2.0;
  float hz = smoothstep(0.1, -0.01, rd.y);
  col = mix(col, uFog, max(uFogAmt * (0.6 + 0.4 * hz), hz * 0.9));
  gl_FragColor = vec4(col, 1.0);
}`;

export type SkyQuality = { cloudSteps: number; lightSteps: number; atmoSize: number };

export function createSky(renderer: THREE.WebGLRenderer) {
  const geo = new THREE.SphereGeometry(1, 48, 24);
  const atmoMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: ATMO_FRAG,
    uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uMie: { value: mieFor(1) } },
    defines: { ASTEPS: 32, LSTEPS: 8 },
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
  });
  const atmoScene = new THREE.Scene();
  atmoScene.add(new THREE.Mesh(geo, atmoMat));
  let atmoRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCam = new THREE.CubeCamera(0.1, 100, atmoRT);
  const noise = noiseTexture();

  const u = {
    tAtmo: { value: atmoRT.texture as THREE.Texture },
    tNoise: { value: noise },
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uSunDisc: { value: new THREE.Color() },
    uMoon: { value: new THREE.Vector3(0, 1, 0) },
    uNight: { value: 0 },
    uCover: { value: 0.3 },
    uDark: { value: 0 },
    uWind: { value: new THREE.Vector2() },
    uBase: { value: 1400 },
    uFog: { value: new THREE.Color() },
    uFogAmt: { value: 0 },
    uCloudSun: { value: new THREE.Color() },
    uCloudAmb: { value: new THREE.Color() },
    uCity: { value: new THREE.Color() },
    uFlash: { value: 0 },
    uTime: { value: 0 },
  };
  const makeMat = (cs: number, ls: number) =>
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: u,
      defines: { SLICES: cs, LSTEPS: ls },
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
  const mesh = new THREE.Mesh(geo, makeMat(4, 2));
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;
  mesh.layers.set(LAYER.sky);
  const envMesh = new THREE.Mesh(geo, makeMat(3, 1));
  envMesh.frustumCulled = false;

  const setQuality = (q: SkyQuality) => {
    const m = mesh.material;
    m.defines.SLICES = q.cloudSteps;
    m.defines.LSTEPS = q.lightSteps;
    m.needsUpdate = true;
    if (atmoRT.width !== q.atmoSize) {
      atmoRT.dispose();
      atmoRT = new THREE.WebGLCubeRenderTarget(q.atmoSize, { type: THREE.HalfFloatType, generateMipmaps: false });
      cubeCam.renderTarget = atmoRT;
      u.tAtmo.value = atmoRT.texture;
    }
  };

  const renderAtmo = (sun: THREE.Vector3, mie: number) => {
    atmoMat.uniforms.uSun.value.copy(sun);
    atmoMat.uniforms.uMie.value = mie;
    cubeCam.update(renderer, atmoScene);
  };

  return {
    mesh,
    envMesh,
    u,
    setQuality,
    renderAtmo,
    dispose() {
      geo.dispose();
      atmoMat.dispose();
      mesh.material.dispose();
      envMesh.material.dispose();
      atmoRT.dispose();
      releaseNoise();
    },
  };
}
export type Sky = ReturnType<typeof createSky>;
